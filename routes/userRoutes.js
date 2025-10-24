const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const { getUserProfile, sendContactUsForm, getUsersByCategory} = require('../controllers/userController');

const router = express.Router();

// Protected route (Only logged-in users can access this)
router.get('/profile', authMiddleware, getUserProfile);

// Get users by category - Protected route
router.get('/category/:categoryId/users', authMiddleware, getUsersByCategory);

module.exports = router;
