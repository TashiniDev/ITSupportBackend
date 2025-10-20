const express = require('express');
const { register, login, forgotPassword, resetPassword } = require('../controllers/authController');

const router = express.Router();

// Register Route
router.post('/register', register);

// Login Route
router.post('/login', login);

// Forgot Password
router.post('/forgot-password', forgotPassword);

// Reset Password (expects JSON { token, password })
router.post('/reset-password', resetPassword);

module.exports = router;
