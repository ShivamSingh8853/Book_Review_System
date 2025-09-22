const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)@\w+([.-]?\w+)(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  bio: {
    type: String,
    maxlength: 500
  },
  avatar: {
    type: String,
    default: ''
  },
  favoriteGenres: [{
    type: String,
    enum: ['Fiction', 'Non-Fiction', 'Mystery', 'Romance', 'Sci-Fi', 'Fantasy', 'Biography', 'History', 'Self-Help', 'Poetry']
  }],
  readingGoal: {
    type: Number,
    min: 0,
    max: 365,
    default: 12
  },
  booksRead: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book'
  }],
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book'
  }],
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isVerified: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Get user stats
userSchema.virtual('stats').get(function() {
  return {
    booksRead: this.booksRead.length,
    followers: this.followers.length,
    following: this.following.length,
    wishlistBooks: this.wishlist.length
  };
});

userSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('User', userSchema);