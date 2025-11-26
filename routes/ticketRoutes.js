const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/authMiddleware');
const {
    createTicket,
    getTicket,
    getAllTickets,
    getMyTickets,
    updateTicketStatus,
    updateTicketAssignment,
    addComment,
    getComments,
    bulkUpdateTicketsWithCommentsToProcessing,
    approveTicket,
    rejectTicket,
    updateTicketToProcessing,
    updateTicketToCompleted,
    downloadAttachment,
   
} = require('../controllers/ticketController');


const router = express.Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 10
    }
});

// Routes
router.get('/', authMiddleware, getAllTickets);
router.get('/my-tickets', authMiddleware, getMyTickets);
router.put('/bulk-update-status', authMiddleware, bulkUpdateTicketsWithCommentsToProcessing);

router.post('/', authMiddleware, upload.array('attachments', 10), createTicket);

// Download an attachment by id (must come before the '/:ticketId' route to avoid param shadowing)
router.get('/attachments/:attachmentId/download', authMiddleware, downloadAttachment);

router.get('/:ticketId', authMiddleware, getTicket);
router.put('/:ticketId/status', authMiddleware, updateTicketStatus);
router.put('/:ticketId/assign', authMiddleware, updateTicketAssignment);
router.put('/:id/processing', authMiddleware, updateTicketToProcessing);
router.put('/:id/complete', authMiddleware, updateTicketToCompleted);
router.post('/:ticketId/comments', authMiddleware, addComment);
router.get('/:ticketId/comments', authMiddleware, getComments);
 

// Protected API endpoints for approve/reject (for authenticated IT Head)
router.put('/:id/approve', authMiddleware, approveTicket);
router.put('/:id/reject', authMiddleware, rejectTicket);

// GET approval page (confirmation UI) - optional public page used by email link
const { getPool } = require('../config/db');
router.get('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const token = req.query && req.query.token ? String(req.query.token) : null;
        const itHeadId = req.query && req.query.itHeadId ? String(req.query.itHeadId) : null;

        const pool = getPool();
        const [rows] = await pool.query('SELECT ApprovalStatus, ApprovalToken, TokenExpiry, ActionedBy FROM ticket WHERE Id = ? AND IsActive = 1', [id]);
        if (rows.length === 0) return res.status(404).send(`<html><body><h3>Ticket not found</h3></body></html>`);
        const ticket = rows[0];

        // If ticket already actioned, show friendly message
        if (ticket.ApprovalStatus && ticket.ApprovalStatus.toLowerCase() !== 'pending') {
            // Try to lookup actionedBy name
            let actionerName = null;
            if (ticket.ActionedBy) {
                const [u] = await pool.query('SELECT Name FROM user WHERE Id = ? LIMIT 1', [ticket.ActionedBy]);
                if (u && u.length > 0) actionerName = u[0].Name;
            }
            const statusLabel = ticket.ApprovalStatus || 'Processed';
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${statusLabel}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;"><div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e6edf3;"><h2>Ticket ${statusLabel}</h2><p>This ticket has been <strong>${statusLabel}</strong>${actionerName ? ` by <strong>${actionerName}</strong>` : ''}.</p></div></body></html>`;
            return res.send(html);
        }

        // Validate token
        if (!token) return res.status(400).send(`<html><body><h3>Approval token missing</h3></body></html>`);
        if (!ticket.ApprovalToken || ticket.ApprovalToken !== token) return res.status(403).send(`<html><body><h3>Invalid or expired approval token</h3></body></html>`);
        const expiry = ticket.TokenExpiry ? new Date(ticket.TokenExpiry) : null;
        if (!expiry || expiry < new Date()) return res.status(403).send(`<html><body><h3>Approval token expired</h3></body></html>`);

        // Build action URL preserving both token and itHeadId
        const actionUrl = `/api/tickets/${id}/approve?token=${encodeURIComponent(token)}${itHeadId ? `&itHeadId=${encodeURIComponent(itHeadId)}` : ''}`;
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Approve Ticket</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;background:#f8fafc;">
            <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e6edf3;">
                <h2>Approve Ticket</h2>
                <p>You're about to approve <strong>TK-${new Date().getFullYear()}-${String(id).padStart(3,'0')}</strong>.</p>
                <form method="POST" action="${actionUrl}">
                    <label>Comments (optional)</label><br/>
                    <textarea name="comments" rows="4" style="width:100%;"></textarea>
                    <div style="margin-top:12px;"><button type="submit" style="background:#059669;color:#fff;padding:10px 16px;border:none;border-radius:6px;">Confirm Approval</button></div>
                </form>
            </div></body></html>`;
        res.send(page);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading approval page');
    }
});

// GET rejection page (confirmation UI)
router.get('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const token = req.query && req.query.token ? String(req.query.token) : null;
        const itHeadId = req.query && req.query.itHeadId ? String(req.query.itHeadId) : null;
        const pool = getPool();
        const [rows] = await pool.query('SELECT ApprovalStatus, ApprovalToken, TokenExpiry, ActionedBy FROM ticket WHERE Id = ? AND IsActive = 1', [id]);
        if (rows.length === 0) return res.status(404).send(`<html><body><h3>Ticket not found</h3></body></html>`);
        const ticket = rows[0];

        // If ticket already actioned, show friendly message
        if (ticket.ApprovalStatus && ticket.ApprovalStatus.toLowerCase() !== 'pending') {
            let actionerName = null;
            if (ticket.ActionedBy) {
                const [u] = await pool.query('SELECT Name FROM user WHERE Id = ? LIMIT 1', [ticket.ActionedBy]);
                if (u && u.length > 0) actionerName = u[0].Name;
            }
            const statusLabel = ticket.ApprovalStatus || 'Processed';
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${statusLabel}</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;"><div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e6edf3;"><h2>Ticket ${statusLabel}</h2><p>This ticket has been <strong>${statusLabel}</strong>${actionerName ? ` by <strong>${actionerName}</strong>` : ''}.</p></div></body></html>`;
            return res.send(html);
        }

        // Validate token
        if (!token) return res.status(400).send(`<html><body><h3>Rejection token missing</h3></body></html>`);
        if (!ticket.ApprovalToken || ticket.ApprovalToken !== token) return res.status(403).send(`<html><body><h3>Invalid or expired rejection token</h3></body></html>`);
        const expiry = ticket.TokenExpiry ? new Date(ticket.TokenExpiry) : null;
        if (!expiry || expiry < new Date()) return res.status(403).send(`<html><body><h3>Rejection token expired</h3></body></html>`);

        // Build action URL preserving both token and itHeadId
        const actionUrl = `/api/tickets/${id}/reject?token=${encodeURIComponent(token)}${itHeadId ? `&itHeadId=${encodeURIComponent(itHeadId)}` : ''}`;
        const page = `<!doctype html><html><head><meta charset="utf-8"><title>Reject Ticket</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;background:#fff5f5;">
            <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e6edf3;">
                <h2>Reject Ticket</h2>
                <p>You're about to reject <strong>TK-${new Date().getFullYear()}-${String(id).padStart(3,'0')}</strong>.</p>
                <form method="POST" action="${actionUrl}">
                    <label>Reason (required)</label><br/>
                    <textarea name="reason" rows="4" required style="width:100%;"></textarea>
                    <div style="margin-top:12px;"><button type="submit" style="background:#dc2626;color:#fff;padding:10px 16px;border:none;border-radius:6px;">Confirm Rejection</button></div>
                </form>
            </div></body></html>`;
        res.send(page);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading rejection page');
    }
});

// POST handlers — forward to controller (controller handles token-based approvals too)
router.post('/:id/approve', async (req, res, next) => {
    try {
        await approveTicket(req, res);
    } catch (err) {
        next(err);
    }
});

router.post('/:id/reject', async (req, res, next) => {
    try {
        await rejectTicket(req, res);
    } catch (err) {
        next(err);
    }
});

// Multer/file upload error handler
router.use((error, req, res, next) => {
    if (error && error.code && error.code.startsWith('LIMIT_')) {
        return res.status(400).json({ message: error.message });
    }
    next(error);
});

module.exports = router;

            // Multer/file upload error handler
            router.use((error, req, res, next) => {
                if (error && error.code && error.code.startsWith('LIMIT_')) {
                    return res.status(400).json({ message: error.message });
                }
                next(error);
            });

            module.exports = router;
