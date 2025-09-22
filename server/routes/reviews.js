const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Review = require('../models/Review');
const Book = require('../models/Book');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/reviews
// @desc    Get all reviews with pagination and filtering
// @access  Public
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('book').optional().isMongoId(),
  query('user').optional().isMongoId(),
  query('rating').optional().isInt({ min: 1, max: 5 }),
  query('sortBy').optional().isIn(['createdAt', 'rating', 'helpful']),
  query('order').optional().isIn(['asc', 'desc'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Invalid query parameters',
        errors: errors.array()
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.book) filter.book = req.query.book;
    if (req.query.user) filter.user = req.query.user;
    if (req.query.rating) filter.rating = req.query.rating;

    // Build sort object
    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const reviews = await Review.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user', 'username firstName lastName avatar')
      .populate('book', 'title author coverImage')
      .select('-__v');

    const total = await Review.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      reviews,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit
      }
    });

  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ message: 'Server error while fetching reviews' });
  }
});

// @route   GET /api/reviews/book/:bookId
// @desc    Get all reviews for a specific book
// @access  Public
router.get('/book/:bookId', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('sortBy').optional().isIn(['createdAt', 'rating', 'helpful']),
  query('order').optional().isIn(['asc', 'desc'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Invalid query parameters',
        errors: errors.array()
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const reviews = await Review.find({ book: req.params.bookId })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user', 'username firstName lastName avatar')
      .select('-__v');

    const total = await Review.countDocuments({ book: req.params.bookId });
    const totalPages = Math.ceil(total / limit);

    // Get rating distribution
    const mongoose = require('mongoose');
    const ratingDistribution = await Review.aggregate([
      { $match: { book: new mongoose.Types.ObjectId(req.params.bookId) } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } }
    ]);

    res.json({
      reviews,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit
      },
      ratingDistribution
    });

  } catch (error) {
    console.error('Get book reviews error:', error);
    res.status(500).json({ message: 'Server error while fetching book reviews' });
  }
});

// @route   GET /api/reviews/:id
// @desc    Get single review by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('user', 'username firstName lastName avatar')
      .populate('book', 'title author coverImage')
      .select('-__v');

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });

  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({ message: 'Server error while fetching review' });
  }
});

// @route   POST /api/reviews
// @desc    Create new review
// @access  Private
router.post('/', [
  auth,
  body('book').isMongoId().withMessage('Valid book ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('title').notEmpty().withMessage('Review title is required').isLength({ max: 100 }),
  body('content').notEmpty().withMessage('Review content is required').isLength({ max: 2000 }),
  body('spoilerWarning').optional().isBoolean(),
  body('readingProgress').optional().isIn(['completed', 'currently-reading', 'dnf']),
  body('readingStartDate').optional().isISO8601(),
  body('readingEndDate').optional().isISO8601(),
  body('pros').optional().isArray(),
  body('cons').optional().isArray(),
  body('recommendedFor').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { book: bookId } = req.body;

    // Check if book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Check if user has already reviewed this book
    const existingReview = await Review.findOne({
      book: bookId,
      user: req.user._id
    });

    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this book' });
    }

    const review = new Review({
      ...req.body,
      user: req.user._id
    });

    await review.save();
    await review.populate('user', 'username firstName lastName avatar');
    await review.populate('book', 'title author coverImage');

    // Add book to user's read books if not already there
    const user = await User.findById(req.user._id);
    if (!user.booksRead.includes(bookId)) {
      user.booksRead.push(bookId);
      await user.save();
    }

    res.status(201).json({
      message: 'Review created successfully',
      review
    });

  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ message: 'Server error while creating review' });
  }
});

// @route   PUT /api/reviews/:id
// @desc    Update review
// @access  Private (review owner only)
router.put('/:id', [
  auth,
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('title').optional().isLength({ max: 100 }),
  body('content').optional().isLength({ max: 2000 }),
  body('spoilerWarning').optional().isBoolean(),
  body('readingProgress').optional().isIn(['completed', 'currently-reading', 'dnf']),
  body('readingStartDate').optional().isISO8601(),
  body('readingEndDate').optional().isISO8601(),
  body('pros').optional().isArray(),
  body('cons').optional().isArray(),
  body('recommendedFor').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user owns the review
    if (review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this review' });
    }

    // Store previous content for edit history
    const previousContent = review.content;

    const allowedUpdates = [
      'rating', 'title', 'content', 'pros', 'cons', 'recommendedFor',
      'spoilerWarning', 'readingProgress', 'readingStartDate', 'readingEndDate'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // Add to edit history if content changed
    if (req.body.content && req.body.content !== previousContent) {
      updates.$push = {
        editHistory: {
          editedAt: new Date(),
          previousContent
        }
      };
    }

    const updatedReview = await Review.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    )
      .populate('user', 'username firstName lastName avatar')
      .populate('book', 'title author coverImage');

    res.json({
      message: 'Review updated successfully',
      review: updatedReview
    });

  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({ message: 'Server error while updating review' });
  }
});

// @route   DELETE /api/reviews/:id
// @desc    Delete review
// @access  Private (review owner or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check if user owns the review or is admin
    if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this review' });
    }

    await Review.findByIdAndDelete(req.params.id);

    res.json({ message: 'Review deleted successfully' });

  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ message: 'Server error while deleting review' });
  }
});

// @route   POST /api/reviews/:id/like
// @desc    Like/Unlike a review
// @access  Private
router.post('/:id/like', auth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const userIndex = review.likes.indexOf(req.user._id);
    
    if (userIndex === -1) {
      // User hasn't liked the review, so add like
      review.likes.push(req.user._id);
    } else {
      // User has already liked the review, so remove like
      review.likes.splice(userIndex, 1);
    }

    await review.save();

    res.json({
      message: userIndex === -1 ? 'Review liked' : 'Review unliked',
      likesCount: review.likes.length,
      isLiked: userIndex === -1
    });

  } catch (error) {
    console.error('Like review error:', error);
    res.status(500).json({ message: 'Server error while liking review' });
  }
});

// @route   POST /api/reviews/:id/helpful
// @desc    Mark review as helpful/not helpful
// @access  Private
router.post('/:id/helpful', [
  auth,
  body('isHelpful').isBoolean().withMessage('isHelpful must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const { isHelpful } = req.body;
    const userId = req.user._id;

    // Find existing vote
    const existingVoteIndex = review.helpful.findIndex(
      vote => vote.user.toString() === userId.toString()
    );

    if (existingVoteIndex !== -1) {
      // Update existing vote
      review.helpful[existingVoteIndex].isHelpful = isHelpful;
    } else {
      // Add new vote
      review.helpful.push({ user: userId, isHelpful });
    }

    await review.save();

    const helpfulVotes = review.helpful.filter(vote => vote.isHelpful).length;
    const totalVotes = review.helpful.length;

    res.json({
      message: 'Helpfulness vote recorded',
      helpfulVotes,
      totalVotes,
      helpfulnessScore: totalVotes > 0 ? (helpfulVotes / totalVotes) * 100 : 0
    });

  } catch (error) {
    console.error('Mark helpful error:', error);
    res.status(500).json({ message: 'Server error while recording helpfulness vote' });
  }
});

module.exports = router;