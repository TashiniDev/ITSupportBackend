const express = require('express');
const router = express.Router();
const emailTestController = require('../controllers/emailTestController');

// Test routes for debugging email functionality
router.post('/test-email', emailTestController.testEmailService);
router.post('/test-status-email', emailTestController.testStatusUpdateEmail);

module.exports = router;