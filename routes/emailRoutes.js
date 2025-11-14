/**
 * Email Routes
 * Defines all email-related API endpoints
 */

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const authMiddleware = require('../middlewares/authMiddleware');

// Public routes (no authentication required for email service setup)

/**
 * @route   GET /api/email/auth
 * @desc    Get authentication URL for Microsoft Graph API
 * @access  Public
 */
router.get('/auth', emailController.initiateAuth);

/**
 * @route   GET /api/email/callback
 * @desc    Handle OAuth callback from Microsoft
 * @access  Public
 */
router.get('/callback', emailController.handleCallback);

/**
 * @route   GET /api/email/status
 * @desc    Check email service authentication status
 * @access  Public
 */
router.get('/status', emailController.checkAuthStatus);

/**
 * @route   GET /api/email/templates
 * @desc    Get available email templates
 * @access  Public
 */
router.get('/templates', emailController.getTemplates);

// Protected routes (require user authentication)

/**
 * @route   POST /api/email/send
 * @desc    Send a single email
 * @access  Private (requires user authentication)
 * @body    { to, subject, body, contentType?, cc?, bcc?, toName?, saveToSentItems? }
 */
router.post('/send', authMiddleware, emailController.sendEmail);

/**
 * @route   POST /api/email/send-template
 * @desc    Send email using predefined templates
 * @access  Private (requires user authentication)
 * @body    { template, to, data }
 */
router.post('/send-template', authMiddleware, emailController.sendTemplateEmail);

/**
 * @route   POST /api/email/ticket-notification
 * @desc    Send ticket-related notification emails
 * @access  Private (requires user authentication)
 * @body    { ticketId, userEmail, userName, title?, severityLevel?, status?, type?, comments?, updatedBy? }
 */
router.post('/ticket-notification', authMiddleware, emailController.sendTicketNotification);

/**
 * @route   GET /api/email/messages/:count?
 * @desc    Get email messages from mailbox
 * @access  Private (requires user authentication)
 * @param   count - Number of messages to retrieve (default: 10, max: 100)
 */
router.get('/messages/:count', authMiddleware, emailController.getEmails);
router.get('/messages', authMiddleware, emailController.getEmails);

/**
 * @route   POST /api/email/logout
 * @desc    Clear email service session
 * @access  Private (requires user authentication)
 */
router.post('/logout', authMiddleware, emailController.logout);

module.exports = router;