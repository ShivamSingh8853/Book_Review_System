const express = require('express');
const { query, validationResult } = require('express-validator');
const User = require('../models/User');
const Review = require('../models/Review');
const Book = require('../models/Book');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users with pagination and search
// @access  Public
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('search').optional().isString(),
  query('sortBy').optional().isIn(['username', 'createdAt', 'firstName']),
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
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.search) {
      filter.$or = [
        { username: { $regex: req.query.search, $options: 'i' } },
        { firstName: { $regex: req.query.search, $options: 'i' } },
        { lastName: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Build sort object
    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const users = await User.find(filter)
      .select('-password -email')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      users,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
});

// @route   GET /api/users/:id
// @desc    Get user profile by ID
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -email')
      .populate('booksRead', 'title author coverImage averageRating')
      .populate('wishlist', 'title author coverImage averageRating')
      .populate('followers', 'username firstName lastName avatar')
      .populate('following', 'username firstName lastName avatar');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's recent reviews
    const recentReviews = await Review.find({ user: user._id })
      .populate('book', 'title author coverImage')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('rating title content createdAt book');

    // Get user's reading stats
    const reviewStats = await Review.aggregate([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          favoriteGenre: { $first: '$book.genre' }
        }
      }
    ]);

    const stats = {
      booksRead: user.booksRead.length,
      reviews: reviewStats[0]?.totalReviews || 0,
      averageRating: reviewStats[0]?.averageRating || 0,
      followers: user.followers.length,
      following: user.following.length,
      wishlistBooks: user.wishlist.length
    };

    // Check if current user is following this user
    let isFollowing = false;
    if (req.user) {
      isFollowing = user.followers.some(
        follower => follower._id.toString() === req.user._id.toString()
      );
    }

    res.json({
      user,
      recentReviews,
      stats,
      isFollowing
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ message: 'Server error while fetching user profile' });
  }
});

// @route   GET /api/users/:id/reviews
// @desc    Get user's reviews with pagination
// @access  Public
router.get('/:id/reviews', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('sortBy').optional().isIn(['createdAt', 'rating']),
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

    const reviews = await Review.find({ user: req.params.id })
      .populate('book', 'title author coverImage')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const total = await Review.countDocuments({ user: req.params.id });
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
    console.error('Get user reviews error:', error);
    res.status(500).json({ message: 'Server error while fetching user reviews' });
  }
});

// @route   POST /api/users/:id/follow
// @desc    Follow/Unfollow a user
// @access  Private
router.post('/:id/follow', auth, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user._id;

    if (targetUserId === currentUserId.toString()) {
      return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isFollowing = currentUser.following.includes(targetUserId);

    if (isFollowing) {
      // Unfollow
      currentUser.following.pull(targetUserId);
      targetUser.followers.pull(currentUserId);
    } else {
      // Follow
      currentUser.following.push(targetUserId);
      targetUser.followers.push(currentUserId);
    }

    await currentUser.save();
    await targetUser.save();

    res.json({
      message: isFollowing ? 'User unfollowed' : 'User followed',
      isFollowing: !isFollowing,
      followersCount: targetUser.followers.length
    });

  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({ message: 'Server error while following user' });
  }
});

// @route   POST /api/users/wishlist/:bookId
// @desc    Add/Remove book from wishlist
// @access  Private
router.post('/wishlist/:bookId', auth, async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const user = await User.findById(req.user._id);

    // Check if book exists
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    const isInWishlist = user.wishlist.includes(bookId);

    if (isInWishlist) {
      // Remove from wishlist
      user.wishlist.pull(bookId);
    } else {
      // Add to wishlist
      user.wishlist.push(bookId);
    }

    await user.save();

    res.json({
      message: isInWishlist ? 'Book removed from wishlist' : 'Book added to wishlist',
      inWishlist: !isInWishlist,
      wishlistCount: user.wishlist.length
    });

  } catch (error) {
    console.error('Wishlist error:', error);
    res.status(500).json({ message: 'Server error while updating wishlist' });
  }
});

// @route   GET /api/users/:id/reading-stats
// @desc    Get user's reading statistics
// @access  Public
router.get('/:id/reading-stats', async (req, res) => {
  try {
    const userId = req.params.id;

    // Basic stats
    const user = await User.findById(userId).select('readingGoal booksRead');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Reading statistics from reviews
    const mongoose = require('mongoose');
    const stats = await Review.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(user._id) } },
      {
        $lookup: {
          from: 'books',
          localField: 'book',
          foreignField: '_id',
          as: 'bookInfo'
        }
      },
      { $unwind: '$bookInfo' },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          totalPages: { $sum: '$bookInfo.pageCount' },
          genreDistribution: {
            $push: '$bookInfo.genre'
          }
        }
      }
    ]);

    // Genre statistics
    const genreStats = await Review.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(user._id) } },
      {
        $lookup: {
          from: 'books',
          localField: 'book',
          foreignField: '_id',
          as: 'bookInfo'
        }
      },
      { $unwind: '$bookInfo' },
      {
        $group: {
          _id: '$bookInfo.genre',
          count: { $sum: 1 },
          averageRating: { $avg: '$rating' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Monthly reading progress (current year)
    const currentYear = new Date().getFullYear();
    const monthlyProgress = await Review.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(user._id),
          createdAt: {
            $gte: new Date(currentYear, 0, 1),
            $lt: new Date(currentYear + 1, 0, 1)
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          booksRead: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const readingStats = {
      booksRead: user.booksRead.length,
      readingGoal: user.readingGoal,
      totalReviews: stats[0]?.totalReviews || 0,
      averageRating: stats[0]?.averageRating || 0,
      totalPages: stats[0]?.totalPages || 0,
      genreDistribution: genreStats,
      monthlyProgress: monthlyProgress,
      progressPercentage: Math.round((user.booksRead.length / user.readingGoal) * 100)
    };

    res.json({ readingStats });

  } catch (error) {
    console.error('Get reading stats error:', error);
    res.status(500).json({ message: 'Server error while fetching reading statistics' });
  }
});

// @route   GET /api/users/:id/recommendations
// @desc    Get book recommendations for user based on their reading history
// @access  Public
router.get('/:id/recommendations', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('booksRead', 'genre')
      .populate('favoriteGenres');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's favorite genres from their reading history
    const readGenres = user.booksRead.map(book => book.genre);
    const favoriteGenres = [...new Set([...user.favoriteGenres, ...readGenres])];

    // Get highly rated books in user's favorite genres
    const recommendations = await Book.find({
      genre: { $in: favoriteGenres },
      _id: { $nin: user.booksRead },
      averageRating: { $gte: 4 },
      ratingsCount: { $gte: 5 }
    })
      .sort({ averageRating: -1, ratingsCount: -1 })
      .limit(12)
      .populate('addedBy', 'username firstName lastName');

    res.json({ recommendations });

  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ message: 'Server error while fetching recommendations' });
  }
});

module.exports = router;