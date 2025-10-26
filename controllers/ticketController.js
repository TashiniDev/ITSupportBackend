const { getPool } = require('../config/db');
const path = require('path');
const fs = require('fs').promises;

/**
 * Create a new ticket with optional file attachments
 * Handles FormData from frontend with text fields and files
 */
exports.createTicket = async (req, res) => {
    const connection = await getPool().getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Extract form data (sent as FormData from frontend)
        const {
            fullName,
            contactNumber,
            department,
            company,
            category,
            assignedTo,
            issueType,
            requestType,
            priority,
            description
        } = req.body;
        
        // Validate required fields
        if (!fullName || !description) {
            await connection.rollback();
            return res.status(400).json({
                message: 'Full name and description are required fields'
            });
        }
        
        // Get user info from auth middleware
        const createdBy = req.user?.name || req.user?.email || 'System';
        
        // Insert ticket into database
        const [ticketResult] = await connection.query(
            `INSERT INTO ticket (
                Name, ContactNumber, AssignerId, IssueId, RequestTypeId, 
                CompanyId, DepartmentId, Description, CategoryId, Status, 
                SeniorityLevel, CreatedBy, CreatedDate, IsActive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', 'LOW', ?, NOW(), 1)`,
            [
                fullName,
                contactNumber || null,
                assignedTo ? parseInt(assignedTo) : null,
                issueType ? parseInt(issueType) : null,
                requestType ? parseInt(requestType) : null,
                company ? parseInt(company) : null,
                department ? parseInt(department) : null,
                description,
                category ? parseInt(category) : null,
                createdBy
            ]
        );
        
        const ticketId = ticketResult.insertId;
        
        // Handle file attachments if any
        const attachmentIds = [];
        if (req.files && req.files.length > 0) {
            // Ensure uploads directory exists
            const uploadsDir = path.join(__dirname, '..', 'uploads');
            try {
                await fs.access(uploadsDir);
            } catch {
                await fs.mkdir(uploadsDir, { recursive: true });
            }
            
            for (const file of req.files) {
                // Generate unique filename
                const timestamp = Date.now();
                const uniqueName = `${timestamp}_${file.originalname}`;
                const filePath = path.join(uploadsDir, uniqueName);
                
                // Move file to uploads directory
                await fs.writeFile(filePath, file.buffer);
                
                // Insert attachment record
                const [attachmentResult] = await connection.query(
                    `INSERT INTO attachments (Path, TicketId, CreatedBy, CreatedDate, IsActive) 
                     VALUES (?, ?, ?, NOW(), 1)`,
                    [
                        `/uploads/${uniqueName}`, // Store relative path
                        ticketId,
                        createdBy
                    ]
                );
                
                attachmentIds.push(attachmentResult.insertId);
            }
        }
        
        await connection.commit();
        
        res.status(201).json({
            message: 'Ticket created successfully',
            data: {
                ticketId: ticketId,
                status: 'NEW',
                attachmentCount: attachmentIds.length,
                attachmentIds: attachmentIds
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error('Error creating ticket:', error);
        res.status(500).json({
            message: 'Error creating ticket',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

/**
 * Get ticket by ID with attachments
 */
exports.getTicket = async (req, res) => {
    try {
        const { ticketId } = req.params;
        
        if (!ticketId || isNaN(ticketId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        const pool = getPool();
        
        // Get ticket details with joined related data
        const [ticketRows] = await pool.query(
            `SELECT 
                t.Id as id,
                CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                t.Name as title,
                t.Name as fullName,
                t.ContactNumber as contactNumber,
                t.Description as description,
                t.Status as status,
                t.SeniorityLevel as priority,
                t.CreatedDate as createdAt,
                t.UpdatedDate as updatedAt,
                t.DepartmentId,
                d.Name as departmentName,
                t.CompanyId,
                comp.Name as companyName,
                t.CategoryId,
                c.Name as categoryName,
                t.IssueId,
                it.Name as issueTypeName,
                t.RequestTypeId,
                rt.Name as requestTypeName,
                t.AssignerId,
                u.Name as assignedToName,
                t.UpdatedDate as assignedAt
             FROM ticket t
             LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
             LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
             LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
             LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
             LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
             LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
             WHERE t.Id = ? AND t.IsActive = 1`,
            [parseInt(ticketId)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        // Get attachments for this ticket with file details
        const [attachmentRows] = await pool.query(
            `SELECT Id, Path, CreatedBy, CreatedDate
             FROM attachments 
             WHERE TicketId = ? AND IsActive = 1
             ORDER BY CreatedDate ASC`,
            [parseInt(ticketId)]
        );
        
        const ticket = ticketRows[0];
        
        // Format attachments with proper file information
        const attachments = attachmentRows.map(attachment => {
            const path = attachment.Path;
            const fileName = path.split('/').pop(); // Get filename from path
            const originalName = fileName.split('_').slice(1).join('_'); // Remove timestamp prefix
            
            return {
                id: attachment.Id,
                originalName: originalName || fileName,
                fileName: fileName,
                size: null, // Size not stored in DB, would need file system check
                mimeType: null, // MIME type not stored in DB
                url: attachment.Path
            };
        });
        
        // Format the response according to the specified structure
        const response = {
            success: true,
            data: {
                id: ticket.id.toString(),
                ticketNumber: ticket.ticketNumber,
                title: ticket.title,
                description: ticket.description,
                status: ticket.status,
                priority: ticket.priority,
                fullName: ticket.fullName,
                contactNumber: ticket.contactNumber,
                department: ticket.DepartmentId ? {
                    id: ticket.DepartmentId,
                    name: ticket.departmentName
                } : null,
                company: ticket.CompanyId ? {
                    id: ticket.CompanyId,
                    name: ticket.companyName
                } : null,
                category: ticket.CategoryId ? {
                    id: ticket.CategoryId,
                    name: ticket.categoryName
                } : null,
                issueType: ticket.IssueId ? {
                    id: ticket.IssueId,
                    name: ticket.issueTypeName
                } : null,
                requestType: ticket.RequestTypeId ? {
                    id: ticket.RequestTypeId,
                    name: ticket.requestTypeName
                } : null,
                assignedTo: ticket.AssignerId ? {
                    id: ticket.AssignerId,
                    name: ticket.assignedToName
                } : null,
                assignedAt: ticket.assignedAt,
                createdAt: ticket.createdAt,
                updatedAt: ticket.updatedAt,
                attachments: attachments
            }
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching ticket',
            error: error.message
        });
    }
};

/**
 * Get all tickets with filtering, pagination, and sorting
 * Query parameters: category, assignedTo, dateFrom, dateTo, page, limit, sort, order
 */
exports.getAllTickets = async (req, res) => {
    try {
        const {
            category,
            assignedTo,
            dateFrom,
            dateTo,
            page = 1,
            limit = 10,
            sort = 'createdAt',
            order = 'desc'
        } = req.query;

        const pool = getPool();
        
        // Build WHERE clause with filters
        let whereConditions = ['t.IsActive = 1'];
        let queryParams = [];
        
        if (category) {
            whereConditions.push('t.CategoryId = ?');
            queryParams.push(parseInt(category));
        }
        
        if (assignedTo) {
            whereConditions.push('t.AssignerId = ?');
            queryParams.push(parseInt(assignedTo));
        }
        
        if (dateFrom) {
            whereConditions.push('DATE(t.CreatedDate) >= ?');
            queryParams.push(dateFrom);
        }
        
        if (dateTo) {
            whereConditions.push('DATE(t.CreatedDate) <= ?');
            queryParams.push(dateTo);
        }
        
        const whereClause = whereConditions.join(' AND ');
        
        // Validate and sanitize sort field
        const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'priority', 'fullName'];
        const sortField = allowedSortFields.includes(sort) ? sort : 'createdAt';
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        
        // Map sort fields to actual column names
        const sortFieldMap = {
            'createdAt': 't.CreatedDate',
            'updatedAt': 't.UpdatedDate',
            'status': 't.Status',
            'priority': 't.SeniorityLevel',
            'fullName': 't.Name'
        };
        
        const actualSortField = sortFieldMap[sortField];
        
        // Calculate pagination
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Max 100 items per page
        const offset = (pageNum - 1) * limitNum;
        
        // Get total count for pagination
        const countQuery = `
            SELECT COUNT(*) as total
            FROM ticket t
            WHERE ${whereClause}
        `;
        
        const [countResult] = await pool.query(countQuery, queryParams);
        const totalItems = countResult[0].total;
        const totalPages = Math.ceil(totalItems / limitNum);
        
        // Get summary counts
        const summaryQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN t.Status = 'NEW' THEN 1 ELSE 0 END) as new,
                SUM(CASE WHEN t.Status = 'PROCESSING' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN t.Status IN ('RESOLVED', 'COMPLETED') THEN 1 ELSE 0 END) as completed
            FROM ticket t
            WHERE ${whereClause}
        `;
        
        const [summaryResult] = await pool.query(summaryQuery, queryParams);
        const summary = summaryResult[0];
        
        // Get tickets with related data
        const ticketsQuery = `
            SELECT 
                t.Id as id,
                CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                t.Name as fullName,
                t.CategoryId,
                c.Name as categoryName,
                t.AssignerId,
                u.Name as assignedToName,
                t.IssueId,
                it.Name as issueTypeName,
                t.RequestTypeId,
                rt.Name as requestTypeName,
                t.SeniorityLevel as priority,
                t.Status as status,
                t.CreatedDate as createdAt,
                t.UpdatedDate as updatedAt,
                t.Description as description
            FROM ticket t
            LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
            LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
            LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
            LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
            WHERE ${whereClause}
            ORDER BY ${actualSortField} ${sortOrder}
            LIMIT ? OFFSET ?
        `;
        
        const paginationParams = [...queryParams, limitNum, offset];
        const [ticketRows] = await pool.query(ticketsQuery, paginationParams);
        
        // Format the tickets data
        const tickets = ticketRows.map(row => ({
            id: row.id,
            ticketNumber: row.ticketNumber,
            fullName: row.fullName,
            category: row.CategoryId ? {
                id: row.CategoryId,
                name: row.categoryName
            } : null,
            assignedTo: row.AssignerId ? {
                id: row.AssignerId,
                name: row.assignedToName
            } : null,
            issueType: row.IssueId ? {
                id: row.IssueId,
                name: row.issueTypeName
            } : null,
            requestType: row.RequestTypeId ? {
                id: row.RequestTypeId,
                name: row.requestTypeName
            } : null,
            priority: row.priority,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            description: row.description
        }));
        
        res.status(200).json({
            message: 'Tickets retrieved successfully',
            data: {
                tickets: tickets,
                pagination: {
                    currentPage: pageNum,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    itemsPerPage: limitNum
                },
                summary: {
                    total: parseInt(summary.total),
                    new: parseInt(summary.new),
                    processing: parseInt(summary.processing),
                    completed: parseInt(summary.completed)
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({
            message: 'Error fetching tickets',
            error: error.message
        });
    }
};

/**
 * Add comment to a ticket
 * POST /api/tickets/:ticketId/comments
 */
exports.addComment = async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { comment } = req.body;
        
        // Validate parameters
        if (!ticketId || isNaN(ticketId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Comment text is required'
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(ticketId)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        // Get user info from auth middleware
        const createdBy = req.user?.name || req.user?.email || 'System';
        
        // Get user ID from auth middleware (assuming req.user has id property)
        const userId = req.user?.id || null;
        const userName = req.user?.name || req.user?.email || 'Anonymous';
        
        // Insert the comment
        const [commentResult] = await pool.query(
            `INSERT INTO comment (
                TicketId, Comment, UserId, Name, CreatedBy, CreatedDate, IsActive
            ) VALUES (?, ?, ?, ?, ?, NOW(), 1)`,
            [
                parseInt(ticketId),
                comment.trim(),
                userId,
                userName,
                createdBy
            ]
        );
        
        // Get the inserted comment with details
        const [newCommentRows] = await pool.query(
            `SELECT Id, Comment, UserId, Name, CreatedBy, CreatedDate 
             FROM comment 
             WHERE Id = ?`,
            [commentResult.insertId]
        );
        
        const newComment = newCommentRows[0];
        
        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: {
                id: newComment.Id,
                comment: newComment.Comment,
                userId: newComment.UserId,
                name: newComment.Name,
                createdBy: newComment.CreatedBy,
                createdAt: newComment.CreatedDate,
                ticketId: parseInt(ticketId)
            }
        });
        
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding comment',
            error: error.message
        });
    }
};

/**
 * Get comments for a ticket
 * GET /api/tickets/:ticketId/comments
 */
exports.getComments = async (req, res) => {
    try {
        const { ticketId } = req.params;
        
        // Validate parameters
        if (!ticketId || isNaN(ticketId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(ticketId)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        // Get all comments for this ticket
        const [commentRows] = await pool.query(
            `SELECT Id, Comment, Name, CreatedDate
             FROM comment 
             WHERE TicketId = ? AND IsActive = 1
             ORDER BY CreatedDate ASC`,
            [parseInt(ticketId)]
        );
        
        // Format comments according to frontend expectation
        const comments = commentRows.map(comment => ({
            id: comment.Id,
            comment: comment.Comment,
            author: comment.Name || 'Anonymous',
            createdAt: comment.CreatedDate
        }));
        
        res.status(200).json({
            success: true,
            data: comments
        });
        
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching comments',
            error: error.message
        });
    }
};