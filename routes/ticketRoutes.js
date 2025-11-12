const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');
const { createTicket, getTicket, getAllTickets, getMyTickets, updateTicketStatus, updateTicketAssignment, addComment, getComments, bulkUpdateTicketsWithCommentsToProcessing } = require('../controllers/ticketController');

const router = express.Router();

// Configure multer for file uploads
// Store files in memory for processing, then save to disk in controller
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit per file
        files: 10 // Maximum 10 files per request
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types
        const allowedMimes = [
            'image/jpeg',
            'image/png', 
            'image/gif',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'text/csv'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`), false);
        }
    }
});

// Get all tickets with filtering, pagination, and sorting - Protected route
router.get('/', authMiddleware, getAllTickets);

// Get tickets related to the logged-in user - Protected route
router.get('/my-tickets', authMiddleware, getMyTickets);

// Bulk update tickets with comments from NEW to PROCESSING - Protected route
router.put('/bulk-update-status', authMiddleware, bulkUpdateTicketsWithCommentsToProcessing);

// Create new ticket with optional file attachments - Protected route
router.post('/', 
    authMiddleware, 
    upload.array('attachments', 10), // 'attachments' matches frontend FormData key
    createTicket
);

// Get ticket by ID - Protected route
router.get('/:ticketId', authMiddleware, getTicket);

// Update ticket status - Protected route
router.put('/:ticketId/status', authMiddleware, updateTicketStatus);

// Update ticket assignment - Protected route
router.put('/:ticketId/assign', authMiddleware, updateTicketAssignment);

// Add comment to ticket - Protected route
router.post('/:ticketId/comments', authMiddleware, addComment);

// Get comments for ticket - Protected route
router.get('/:ticketId/comments', authMiddleware, getComments);

// Error handling middleware for multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                message: 'File too large. Maximum size is 10MB per file.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                message: 'Too many files. Maximum is 10 files per request.'
            });
        }
        return res.status(400).json({
            message: 'File upload error',
            error: error.message
        });
    }
    
    if (error.message && error.message.includes('File type')) {
        return res.status(400).json({
            message: error.message
        });
    }
    
    next(error);
});

module.exports = router;