const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Book = require('../models/Book');
const Review = require('../models/Review');
const User = require('../models/User');
const { auth, adminAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/books
// @desc    Get all books with filtering and pagination
// @access  Public
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('genre').optional().isString(),
  query('author').optional().isString(),
  query('search').optional().isString(),
  query('sortBy').optional().isIn(['title', 'author', 'averageRating', 'createdAt', 'publishedDate']),
  query('order').optional().isIn(['asc', 'desc'])
], async (req, res) => {
  try {
    console.log('POST /api/books received', { body: req.body, user: req.user?._id });
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
    
    if (req.query.genre) {
      filter.genre = req.query.genre;
    }
    
    if (req.query.author) {
      filter.author = { $regex: req.query.author, $options: 'i' };
    }
    
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    // Build sort object
    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    // Add text score to sort if searching
    if (req.query.search) {
      sort.score = { $meta: 'textScore' };
    }

    const books = await Book.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('addedBy', 'username firstName lastName')
      .select('-__v');

    const total = await Book.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      books,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit
      }
    });

  } catch (error) {
    console.error('Get books error:', error);
    res.status(500).json({ message: 'Server error while fetching books' });
  }
});

// @route   GET /api/books/featured
// @desc    Get featured books
// @access  Public
router.get('/featured', async (req, res) => {
  try {
    const books = await Book.find({ featured: true })
      .sort({ averageRating: -1, createdAt: -1 })
      .limit(8)
      .populate('addedBy', 'username firstName lastName')
      .select('-__v');

    res.json({ books });
  } catch (error) {
    console.error('Get featured books error:', error);
    res.status(500).json({ message: 'Server error while fetching featured books' });
  }
});

// @route   GET /api/books/trending
// @desc    Get trending books (high rated, recently added)
// @access  Public
router.get('/trending', async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const books = await Book.find({
      createdAt: { $gte: oneMonthAgo },
      averageRating: { $gte: 4 },
      ratingsCount: { $gte: 3 }
    })
      .sort({ averageRating: -1, ratingsCount: -1 })
      .limit(10)
      .populate('addedBy', 'username firstName lastName')
      .select('-__v');

    res.json({ books });
  } catch (error) {
    console.error('Get trending books error:', error);
    res.status(500).json({ message: 'Server error while fetching trending books' });
  }
});

 // @route   GET /api/books/:id
// @desc    Get single book by ID (includes paginated reviews)
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id)
      .populate('addedBy', 'username firstName lastName avatar')
      .select('-__v');

    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const sortBy = req.query.sortBy || 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;
    const sort = { [sortBy]: order };

    const [reviews, totalReviews] = await Promise.all([
      Review.find({ book: book._id })
        .populate('user', 'username firstName lastName avatar')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-__v'),
      Review.countDocuments({ book: book._id })
    ]);

    // Check if current user has reviewed this book
    let userReview = null;
    if (req.user) {
      userReview = await Review.findOne({ 
        book: book._id, 
        user: req.user._id 
      }).populate('user', 'username firstName lastName avatar');
    }

    res.json({ 
      book, 
      reviews,
      userReview,
      reviewsCount: totalReviews,
      pagination: {
        current: page,
        pages: Math.ceil(totalReviews / limit),
        total: totalReviews,
        limit
      }
    });

  } catch (error) {
    console.error('Get book error:', error);
    res.status(500).json({ message: 'Server error while fetching book' });
  }
});

// @route   POST /api/books/:id/reviews
// @desc    Submit a review for a book (one per user)
// @access  Private
router.post('/:id/reviews', [
  auth,
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

    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Check if user has already reviewed this book
    const existingReview = await Review.findOne({
      book: book._id,
      user: req.user._id
    });

    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this book' });
    }

    const review = new Review({
      ...req.body,
      book: book._id,
      user: req.user._id
    });

    await review.save();
    await review.populate('user', 'username firstName lastName avatar');
    await review.populate('book', 'title author coverImage');

    // Add book to user's read books if not already there
    const user = await User.findById(req.user._id);
    if (user && !user.booksRead.includes(book._id)) {
      user.booksRead.push(book._id);
      await user.save();
    }

    res.status(201).json({
      message: 'Review created successfully',
      review
    });

  } catch (error) {
    console.error('Create nested review error:', error);
    res.status(500).json({ message: 'Server error while creating review' });
  }
});

// @route   POST /api/books
// @desc    Add new book
// @access  Private
router.post('/', [
  auth,
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('author').notEmpty().withMessage('Author is required').isLength({ max: 100 }),
  body('description').notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('genre').notEmpty().withMessage('Genre is required'),
  body('publishedDate').notEmpty().withMessage('Published date is required').isISO8601(),
  body('publisher').notEmpty().withMessage('Publisher is required').isLength({ max: 100 }),
  body('pageCount').isInt({ min: 1 }).withMessage('Page count must be a positive number'),
  body('coverImage').notEmpty().withMessage('Cover image is required'),
  body('isbn').optional().matches(/^(\d{10}|\d{13})$/).withMessage('Invalid ISBN format')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check if book with same ISBN already exists
    if (req.body.isbn) {
      const existingBook = await Book.findOne({ isbn: req.body.isbn });
      if (existingBook) {
        return res.status(400).json({ message: 'Book with this ISBN already exists' });
      }
    }

    const book = new Book({
      ...req.body,
      addedBy: req.user._id
    });

    console.log('Saving book to DB...');
    await book.save();
    console.log('Book saved, populating addedBy...');
    await book.populate('addedBy', 'username firstName lastName');
    console.log('Book populated; sending response');

    res.status(201).json({
      message: 'Book added successfully',
      book
    });

  } catch (error) {
    console.error('Add book error:', error);
    res.status(500).json({ message: 'Server error while adding book' });
  }
});

// @route   PUT /api/books/:id
// @desc    Update book
// @access  Private (book owner or admin)
router.put('/:id', [
  auth,
  body('title').optional().isLength({ max: 200 }),
  body('author').optional().isLength({ max: 100 }),
  body('description').optional().isLength({ max: 2000 }),
  body('pageCount').optional().isInt({ min: 1 }),
  body('isbn').optional().matches(/^(\d{10}|\d{13})$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Check if user owns the book or is admin
    if (book.addedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this book' });
    }

    // Check ISBN uniqueness if being updated
    if (req.body.isbn && req.body.isbn !== book.isbn) {
      const existingBook = await Book.findOne({ isbn: req.body.isbn });
      if (existingBook) {
        return res.status(400).json({ message: 'Book with this ISBN already exists' });
      }
    }

    const allowedUpdates = [
      'title', 'author', 'description', 'genre', 'subGenres', 
      'publishedDate', 'publisher', 'pageCount', 'language', 
      'coverImage', 'price', 'availability', 'tags', 'series', 'awards', 'isbn'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedBook = await Book.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('addedBy', 'username firstName lastName');

    res.json({
      message: 'Book updated successfully',
      book: updatedBook
    });

  } catch (error) {
    console.error('Update book error:', error);
    res.status(500).json({ message: 'Server error while updating book' });
  }
});

// @route   DELETE /api/books/:id
// @desc    Delete book
// @access  Private (book owner or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    // Check if user owns the book or is admin
    if (book.addedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this book' });
    }

    // Delete all reviews for this book
    await Review.deleteMany({ book: req.params.id });

    await Book.findByIdAndDelete(req.params.id);

    res.json({ message: 'Book and associated reviews deleted successfully' });

  } catch (error) {
    console.error('Delete book error:', error);
    res.status(500).json({ message: 'Server error while deleting book' });
  }
});

// @route   POST /api/books/:id/toggle-featured
// @desc    Toggle featured status of book
// @access  Admin only
router.post('/:id/toggle-featured', adminAuth, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    book.featured = !book.featured;
    await book.save();

    res.json({
      message: `Book ${book.featured ? 'featured' : 'unfeatured'} successfully`,
      book
    });

  } catch (error) {
    console.error('Toggle featured error:', error);
    res.status(500).json({ message: 'Server error while updating featured status' });
  }
});

module.exports = router;