const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  author: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  isbn: {
    type: String,
    unique: true,
    sparse: true,
    match: [/^(\d{10}|\d{13})$/, 'Please enter a valid ISBN']
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  genre: {
    type: String,
    required: true,
    enum: ['Fiction', 'Non-Fiction', 'Mystery', 'Romance', 'Sci-Fi', 'Fantasy', 'Biography', 'History', 'Self-Help', 'Poetry']
  },
  subGenres: [{
    type: String,
    maxlength: 50
  }],
  publishedDate: {
    type: Date,
    required: true
  },
  publisher: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  pageCount: {
    type: Number,
    required: true,
    min: 1
  },
  language: {
    type: String,
    required: true,
    default: 'English'
  },
  coverImage: {
    type: String,
    required: true
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  ratingsCount: {
    type: Number,
    default: 0
  },
  price: {
    amount: {
      type: Number,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  availability: {
    type: String,
    enum: ['Available', 'Out of Stock', 'Coming Soon'],
    default: 'Available'
  },
  tags: [{
    type: String,
    maxlength: 30
  }],
  series: {
    name: String,
    number: Number
  },
  awards: [{
    name: String,
    year: Number
  }],
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for search functionality
bookSchema.index({ title: 'text', author: 'text', description: 'text', tags: 'text' });
bookSchema.index({ genre: 1 });
bookSchema.index({ averageRating: -1 });
bookSchema.index({ createdAt: -1 });

// Update average rating when reviews change
bookSchema.methods.updateAverageRating = async function() {
  const Review = mongoose.model('Review');
  const stats = await Review.aggregate([
    { $match: { book: this._id } },
    {
      $group: {
        _id: '$book',
        averageRating: { $avg: '$rating' },
        ratingsCount: { $sum: 1 }
      }
    }
  ]);

  if (stats.length > 0) {
    this.averageRating = Math.round(stats[0].averageRating * 10) / 10; // Round to 1 decimal
    this.ratingsCount = stats[0].ratingsCount;
  } else {
    this.averageRating = 0;
    this.ratingsCount = 0;
  }

  return this.save();
};

module.exports = mongoose.model('Book', bookSchema);