const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  pros: [{
    type: String,
    maxlength: 200
  }],
  cons: [{
    type: String,
    maxlength: 200
  }],
  recommendedFor: [{
    type: String,
    maxlength: 100
  }],
  spoilerWarning: {
    type: Boolean,
    default: false
  },
  readingProgress: {
    type: String,
    enum: ['completed', 'currently-reading', 'dnf'], // did not finish
    default: 'completed'
  },
  readingStartDate: Date,
  readingEndDate: Date,
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  helpful: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isHelpful: Boolean
  }],
  verified: {
    type: Boolean,
    default: false
  },
  flagged: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    editedAt: {
      type: Date,
      default: Date.now
    },
    previousContent: String
  }]
}, {
  timestamps: true
});

// Compound index to ensure one review per user per book
reviewSchema.index({ book: 1, user: 1 }, { unique: true });

// Index for sorting by helpfulness and date
reviewSchema.index({ helpful: -1, createdAt: -1 });

// Calculate helpfulness score
reviewSchema.virtual('helpfulnessScore').get(function() {
  if (this.helpful.length === 0) return 0;
  
  const helpfulVotes = this.helpful.filter(vote => vote.isHelpful).length;
  const totalVotes = this.helpful.length;
  
  return (helpfulVotes / totalVotes) * 100;
});

// Get reading duration in days
reviewSchema.virtual('readingDuration').get(function() {
  if (!this.readingStartDate || !this.readingEndDate) return null;
  
  const timeDiff = this.readingEndDate.getTime() - this.readingStartDate.getTime();
  const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
  
  return daysDiff;
});

// Update book's average rating after review save/update/delete
reviewSchema.post('save', async function() {
  const Book = mongoose.model('Book');
  const book = await Book.findById(this.book);
  if (book) {
    await book.updateAverageRating();
  }
});

reviewSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    const Book = mongoose.model('Book');
    const book = await Book.findById(doc.book);
    if (book) {
      await book.updateAverageRating();
    }
  }
});

reviewSchema.post('findOneAndUpdate', async function(doc) {
  if (doc) {
    const Book = mongoose.model('Book');
    const book = await Book.findById(doc.book);
    if (book) {
      await book.updateAverageRating();
    }
  }
});

reviewSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Review', reviewSchema);