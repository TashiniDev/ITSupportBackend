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
        
        // Send email notifications using Microsoft Graph API
        try {
            const emailServiceApp = require('../services/emailServiceApp');
            
            // Get category team members (users in the ticket's specific category)
            let categoryTeamQuery = `
                SELECT DISTINCT u.email, u.name 
                FROM user u 
                WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' 
                AND u.categoryId = ?
            `;
            
            // Get IT Head (users with role ID 3)
            let itHeadQuery = `
                SELECT DISTINCT u.email, u.name 
                FROM user u 
                WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' 
                AND u.roleId = 3
                LIMIT 1
            `;
            
            const [categoryTeamUsers] = await connection.query(categoryTeamQuery, [category ? parseInt(category) : null]);
            const [itHeadUsers] = await connection.query(itHeadQuery);
            
            if (categoryTeamUsers.length > 0 || itHeadUsers.length > 0) {
                // Generate ticket number for email
                const ticketNumber = `TK-${new Date().getFullYear()}-${String(ticketId).padStart(3, '0')}`;
                
                // Get comprehensive ticket details for email
                const [ticketDetails] = await connection.query(`
                    SELECT 
                        t.Name as fullName,
                        t.ContactNumber,
                        t.Description,
                        d.Name as departmentName,
                        comp.Name as companyName,
                        c.Name as categoryName,
                        it.Name as issueTypeName,
                        rt.Name as requestTypeName,
                        u.Name as assignedToName
                    FROM ticket t
                    LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
                    LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
                    LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
                    LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
                    LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
                    LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
                    WHERE t.Id = ?
                `, [ticketId]);
                
                const ticket = ticketDetails[0] || {};
                
                // Prepare ticket data for email service
                const ticketData = {
                    ticketId: ticketNumber,
                    category: ticket.categoryName || 'Uncategorized',
                    assignedTeam: ticket.categoryName || 'General',
                    requesterName: ticket.fullName || fullName || 'N/A',
                    requesterContact: ticket.ContactNumber || contactNumber || 'N/A',
                    requesterDepartment: ticket.departmentName || 'N/A',
                    requesterCompany: ticket.companyName || 'N/A',
                    issueType: ticket.issueTypeName || 'N/A',
                    assignedTo: ticket.assignedToName || 'Unassigned',
                    assignedDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    createdDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    lastUpdated: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    title: ticket.fullName || fullName || '',
                    description: ticket.Description || description || 'No description provided',
                    priority: 'LOW'
                };
                
                // Get IT Head email
                const itHeadEmail = itHeadUsers.length > 0 ? itHeadUsers[0].email : null;
                
                // Send ticket creation email using Microsoft Graph API
                try {
                    await emailServiceApp.sendTicketCreationEmail(ticketData, categoryTeamUsers, itHeadEmail);
                    console.log(`📧 Ticket creation emails sent successfully for ticket ${ticketNumber}`);
                } catch (emailError) {
                    console.error(`📧 Failed to send ticket creation emails:`, emailError.message);
                    // Don't fail the ticket creation if email fails
                }
            } else {
                console.log('No users found to notify for this ticket category/role');
            }
        } catch (emailError) {
            console.error('Error sending notification emails:', emailError);
            // Don't fail the ticket creation if email fails
        }
        
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
 * Get all tickets related to the logged-in user's category
 * Returns all tickets that belong to the same category as the logged-in user
 * Query parameters: dateFrom, dateTo, page, limit, sort, order
 */
exports.getMyTickets = async (req, res) => {
    try {
        const {
            dateFrom,
            dateTo,
            page = 1,
            limit = 10,
            sort = 'createdAt',
            order = 'desc'
        } = req.query;

        const pool = getPool();
        
        // Get logged-in user info
        const userId = req.user?.uid;
        const userEmail = req.user?.email;
        
        if (!userId && !userEmail) {
            return res.status(401).json({
                message: 'User authentication required'
            });
        }
        
        // First, get the user's category
        const [userRows] = await pool.query(
            'SELECT categoryId FROM user WHERE uid = ? AND IsActive = 1',
            [userId]
        );
        
        if (userRows.length === 0 || !userRows[0].categoryId) {
            return res.status(400).json({
                message: 'User category not found or user not assigned to a category'
            });
        }
        
        const userCategoryId = userRows[0].categoryId;
        
        // Build WHERE clause with filters for tickets in user's category
        let whereConditions = [
            't.IsActive = 1',
            't.CategoryId = ?'
        ];
        let queryParams = [userCategoryId];
        
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
        
        // Get team tickets count (all tickets in user's category)
        const teamTicketsQuery = `
            SELECT COUNT(*) as teamTotal
            FROM ticket t
            WHERE t.IsActive = 1 AND t.CategoryId = ?
        `;
        
        const [teamTicketsResult] = await pool.query(teamTicketsQuery, [userCategoryId]);
        const teamTicketsCount = teamTicketsResult[0].teamTotal;
        
        // Get summary counts for user's personal tickets (assigned to or created by user)
        const summaryQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN t.Status = 'NEW' THEN 1 ELSE 0 END) as new,
                SUM(CASE WHEN t.Status = 'PROCESSING' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN t.Status IN ('RESOLVED', 'COMPLETED') THEN 1 ELSE 0 END) as completed
            FROM ticket t
            WHERE t.IsActive = 1 AND t.CategoryId = ? AND 
                  (t.AssignerId = (SELECT Id FROM user WHERE uid = ? AND IsActive = 1) OR t.CreatedBy = ?)
        `;
        
        const [summaryResult] = await pool.query(summaryQuery, [userCategoryId, userId, userEmail || userId]);
        const summary = summaryResult[0];
        
        // Get tickets in user's category with related data
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
                t.Description as description,
                t.CreatedBy
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
            description: row.description,
            createdBy: row.CreatedBy
        }));
        
        res.status(200).json({
            message: 'Category tickets retrieved successfully',
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
                    completed: parseInt(summary.completed),
                    teamTickets: parseInt(teamTicketsCount)
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching category tickets:', error);
        res.status(500).json({
            message: 'Error fetching category tickets',
            error: error.message
        });
    }
};

/**
 * Update ticket status
 * PUT /api/tickets/:ticketId/status
 * Request body: { statusId: "NEW" | "PROCESSING" | "RESOLVED" | "COMPLETED" | "CLOSED" }
 */
exports.updateTicketStatus = async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { statusId } = req.body;
        
        // Validate parameters
        if (!ticketId || isNaN(ticketId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        if (!statusId || typeof statusId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Status ID is required'
            });
        }
        
        // Validate status values
        const allowedStatuses = ['NEW', 'PROCESSING', 'COMPLETED'];
        if (!allowedStatuses.includes(statusId.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id, Status FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(ticketId)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        const currentStatus = ticketRows[0].Status;
        const newStatus = statusId.toUpperCase();
        
        // Check if status is already the same
        if (currentStatus === newStatus) {
            return res.status(200).json({
                success: true,
                message: 'Ticket status is already set to this value',
                data: {
                    ticketId: parseInt(ticketId),
                    status: newStatus,
                    previousStatus: currentStatus
                }
            });
        }
        
        // Get user info from auth middleware
        const updatedBy = req.user?.name || req.user?.email || 'System';
        
        // Update the ticket status
        const [updateResult] = await pool.query(
            `UPDATE ticket 
             SET Status = ?, UpdatedBy = ?, UpdatedDate = NOW() 
             WHERE Id = ? AND IsActive = 1`,
            [newStatus, updatedBy, parseInt(ticketId)]
        );
        
        if (updateResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update ticket status'
            });
        }
        
        // Get the updated ticket information
        const [updatedTicketRows] = await pool.query(
            `SELECT 
                Id,
                CONCAT('TK-', YEAR(CreatedDate), '-', LPAD(Id, 3, '0')) as ticketNumber,
                Status,
                UpdatedBy,
                UpdatedDate
             FROM ticket 
             WHERE Id = ?`,
            [parseInt(ticketId)]
        );
        
        const updatedTicket = updatedTicketRows[0];
        
        // Send email notifications for status updates (only for PROCESSING and COMPLETED)
        if (newStatus === 'PROCESSING' || newStatus === 'COMPLETED') {
            console.log(`🔔 Triggering email notifications for status change: ${currentStatus} → ${newStatus}`);
            try {
                const emailServiceApp = require('../services/emailServiceApp');
                
                // Get comprehensive ticket details for email
                const [ticketDetailsRows] = await pool.query(`
                    SELECT 
                        t.Id,
                        CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                        t.Name as fullName,
                        t.ContactNumber,
                        t.Description,
                        t.Status,
                        t.SeniorityLevel as priority,
                        t.CreatedDate,
                        t.UpdatedDate,
                        t.CreatedBy,
                        t.CategoryId,
                        d.Name as departmentName,
                        comp.Name as companyName,
                        c.Name as categoryName,
                        it.Name as issueTypeName,
                        rt.Name as requestTypeName,
                        u.Name as assignedToName
                    FROM ticket t
                    LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
                    LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
                    LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
                    LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
                    LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
                    LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
                    WHERE t.Id = ?
                `, [parseInt(ticketId)]);
                
                const ticketDetails = ticketDetailsRows[0];
                console.log(`📋 Ticket details found:`, ticketDetails ? 'Yes' : 'No');
                
                if (ticketDetails) {
                    console.log(`📊 Ticket Category ID: ${ticketDetails.CategoryId}`);
                    console.log(`👤 Current user email: ${req.user?.email || 'Not available'}`);
                    
                    // Get category team members (including all active users in category - we'll filter later if needed)
                    const [categoryTeamUsers] = await pool.query(`
                        SELECT DISTINCT u.email, u.name 
                        FROM user u 
                        WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' 
                        AND u.categoryId = ?
                    `, [ticketDetails.CategoryId]);
                    
                    // Filter out the current user if they are in the same category (to avoid self-notification)
                    const filteredTeamUsers = categoryTeamUsers.filter(user => 
                        user.email !== (req.user?.email || '')
                    );
                    
                    console.log(`👥 Total category team members: ${categoryTeamUsers.length}`);
                    console.log(`👥 Filtered team members (excluding current user): ${filteredTeamUsers.length}`);
                    filteredTeamUsers.forEach(member => console.log(`   - ${member.name} (${member.email})`));
                    
                    // Get IT Head
                    const [itHeadUsers] = await pool.query(`
                        SELECT DISTINCT u.email, u.name 
                        FROM user u 
                        WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' 
                        AND u.roleId = 3
                        LIMIT 1
                    `);
                    
                    console.log(`👑 IT Head found: ${itHeadUsers.length > 0 ? itHeadUsers[0].email : 'None'}`);
                    
                    // Get ticket creator email (try to find in users table first, fallback to CreatedBy field)
                    let ticketCreatorEmail = null;
                    const [creatorUsers] = await pool.query(`
                        SELECT email FROM user 
                        WHERE email = ? AND IsActive = 1
                    `, [ticketDetails.CreatedBy]);
                    
                    if (creatorUsers.length > 0) {
                        ticketCreatorEmail = creatorUsers[0].email;
                    } else if (ticketDetails.CreatedBy && ticketDetails.CreatedBy.includes('@')) {
                        ticketCreatorEmail = ticketDetails.CreatedBy;
                    }
                    
                    console.log(`📝 Ticket creator email: ${ticketCreatorEmail || 'Not found'}`);
                    
                    // Prepare ticket data for email
                    const ticketData = {
                        ticketId: ticketDetails.ticketNumber,
                        category: ticketDetails.categoryName || 'Uncategorized',
                        assignedTeam: ticketDetails.categoryName || 'General',
                        requesterName: ticketDetails.fullName || 'N/A',
                        requesterContact: ticketDetails.ContactNumber || 'N/A',
                        requesterDepartment: ticketDetails.departmentName || 'N/A',
                        requesterCompany: ticketDetails.companyName || 'N/A',
                        issueType: ticketDetails.issueTypeName || 'N/A',
                        assignedTo: ticketDetails.assignedToName || 'Unassigned',
                        createdDate: ticketDetails.CreatedDate ? new Date(ticketDetails.CreatedDate).toLocaleDateString() + ' ' + new Date(ticketDetails.CreatedDate).toLocaleTimeString() : 'N/A',
                        updatedDate: ticketDetails.UpdatedDate ? new Date(ticketDetails.UpdatedDate).toLocaleDateString() + ' ' + new Date(ticketDetails.UpdatedDate).toLocaleTimeString() : 'N/A',
                        title: ticketDetails.fullName || '',
                        description: ticketDetails.Description || 'No description provided',
                        priority: ticketDetails.priority || 'LOW'
                    };
                    
                    const itHeadEmail = itHeadUsers.length > 0 ? itHeadUsers[0].email : null;
                    
                    console.log(`📧 Attempting to send status update emails...`);
                    
                    // Send status update emails
                    await emailServiceApp.sendTicketStatusUpdateEmail(
                        ticketData,
                        filteredTeamUsers,
                        itHeadEmail,
                        ticketCreatorEmail,
                        currentStatus,
                        newStatus,
                        updatedBy
                    );
                    
                    console.log(`✅ Status update emails sent successfully for ticket ${ticketDetails.ticketNumber} (${currentStatus} → ${newStatus})`);
                } else {
                    console.log(`❌ No ticket details found for ticket ID: ${ticketId}`);
                }
            } catch (emailError) {
                console.error('❌ Error sending status update emails:', emailError.message);
                console.error('Full email error:', emailError);
                // Don't fail the status update if email fails
            }
        } else {
            console.log(`ℹ️ No email notifications needed for status change: ${currentStatus} → ${newStatus} (only PROCESSING/COMPLETED trigger emails)`);
        }
        
        res.status(200).json({
            success: true,
            message: 'Ticket status updated successfully',
            data: {
                ticketId: updatedTicket.Id,
                ticketNumber: updatedTicket.ticketNumber,
                status: updatedTicket.Status,
                previousStatus: currentStatus,
                updatedBy: updatedTicket.UpdatedBy,
                updatedAt: updatedTicket.UpdatedDate
            }
        });
        
    } catch (error) {
        console.error('Error updating ticket status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ticket status',
            error: error.message
        });
    }
};

/**
 * Update ticket assignment
 * PUT /api/tickets/:ticketId/assign
 * Request body: { assignToId: number }
 */
exports.updateTicketAssignment = async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { assignToId } = req.body;
        
        // Validate parameters
        if (!ticketId || isNaN(ticketId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        if (assignToId !== null && assignToId !== undefined && isNaN(assignToId)) {
            return res.status(400).json({
                success: false,
                message: 'Assign to ID must be a valid number or null'
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id, AssignerId FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(ticketId)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        const currentAssignerId = ticketRows[0].AssignerId;
        const newAssignerId = assignToId ? parseInt(assignToId) : null;
        
        // If assignToId is provided, verify the user exists and is active
        let assignedToName = null;
        if (newAssignerId) {
            const [userRows] = await pool.query(
                'SELECT Id, Name FROM user WHERE Id = ? AND IsActive = 1',
                [newAssignerId]
            );
            
            if (userRows.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Assigned user not found or inactive'
                });
            }
            
            assignedToName = userRows[0].Name;
        }
        
        // Check if assignment is already the same
        if (currentAssignerId === newAssignerId) {
            return res.status(200).json({
                success: true,
                message: 'Ticket is already assigned to this user',
                data: {
                    ticketId: parseInt(ticketId),
                    assignedTo: newAssignerId ? {
                        id: newAssignerId,
                        name: assignedToName
                    } : null,
                    previousAssignedTo: currentAssignerId
                }
            });
        }
        
        // Get user info from auth middleware
        const updatedBy = req.user?.name || req.user?.email || 'System';
        
        // Update the ticket assignment
        const [updateResult] = await pool.query(
            `UPDATE ticket 
             SET AssignerId = ?, UpdatedBy = ?, UpdatedDate = NOW() 
             WHERE Id = ? AND IsActive = 1`,
            [newAssignerId, updatedBy, parseInt(ticketId)]
        );
        
        if (updateResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Failed to update ticket assignment'
            });
        }
        
        // Get the updated ticket information
        const [updatedTicketRows] = await pool.query(
            `SELECT 
                t.Id,
                CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                t.AssignerId,
                u.Name as assignedToName,
                t.UpdatedBy,
                t.UpdatedDate
             FROM ticket t
             LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
             WHERE t.Id = ?`,
            [parseInt(ticketId)]
        );
        
        const updatedTicket = updatedTicketRows[0];
        
        // Send email notification to the newly assigned user using Microsoft Graph API
        if (newAssignerId) {
            try {
                const emailServiceApp = require('../services/emailServiceApp');
                
                // Get the assigned user's email
                const [assignedUserRows] = await pool.query(
                    'SELECT email, name FROM user WHERE Id = ? AND IsActive = 1',
                    [newAssignerId]
                );
                
                if (assignedUserRows.length > 0 && assignedUserRows[0].email) {
                    const assignedUser = assignedUserRows[0];
                    
                    // Get comprehensive ticket details for email
                    const [ticketDetailsRows] = await pool.query(`
                        SELECT 
                            t.Name as fullName,
                            t.ContactNumber,
                            t.Description,
                            t.Status,
                            t.SeniorityLevel as priority,
                            t.CreatedDate,
                            d.Name as departmentName,
                            comp.Name as companyName,
                            c.Name as categoryName,
                            it.Name as issueTypeName,
                            rt.Name as requestTypeName,
                            creator.Name as createdByName
                        FROM ticket t
                        LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
                        LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
                        LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
                        LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
                        LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
                        LEFT JOIN user creator ON t.CreatedBy = creator.email AND creator.IsActive = 1
                        WHERE t.Id = ?
                    `, [parseInt(ticketId)]);
                    
                    const ticketDetails = ticketDetailsRows[0] || {};
                    
                    // Check if ticket has attachments
                    const [attachmentRows] = await pool.query(
                        'SELECT COUNT(*) as attachmentCount FROM attachments WHERE TicketId = ? AND IsActive = 1',
                        [parseInt(ticketId)]
                    );
                    const attachmentCount = attachmentRows[0].attachmentCount;
                    
                    // Create simplified assignment notification email content
                    const assignmentEmailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #2c5aa0; text-align: center;">🎯 Ticket Assigned to You</h2>
                            <p><strong>Hello ${assignedUser.name},</strong></p>
                            <p>A ticket has been assigned to you: <strong>${updatedTicket.ticketNumber}</strong></p>
                            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <h3>Ticket Details:</h3>
                                <p><strong>Category:</strong> ${ticketDetails.categoryName || 'N/A'}</p>
                                <p><strong>Requester:</strong> ${ticketDetails.fullName || 'N/A'}</p>
                                <p><strong>Priority:</strong> ${ticketDetails.priority || 'N/A'}</p>
                                <p><strong>Description:</strong> ${ticketDetails.Description || 'No description provided'}</p>
                                ${attachmentCount > 0 ? `<p><strong>Attachments:</strong> ${attachmentCount} file(s)</p>` : ''}
                            </div>
                            <p>Please log into the IT Support system to review full details and update the ticket status.</p>
                            <p style="color: #6c757d; font-size: 12px;">This is an automated notification from the IT Support System.</p>
                        </div>
                    `;

                    // Send assignment notification using Microsoft Graph API
                    const emailData = {
                        to: assignedUser.email,
                        toName: assignedUser.name,
                        subject: `Ticket Assigned to You: ${updatedTicket.ticketNumber}`,
                        body: assignmentEmailHtml,
                        contentType: 'HTML'
                    };

                    await emailServiceApp.sendEmailAsUser(emailData);
                    console.log(`📧 Assignment notification email sent successfully to ${assignedUser.email}`);
                } else {
                    console.log('Assigned user email not found or empty');
                }
            } catch (emailError) {
                console.error('Error sending assignment notification email:', emailError);
                // Don't fail the assignment update if email fails
            }
        }
        
        res.status(200).json({
            success: true,
            message: 'Ticket assignment updated successfully',
            data: {
                ticketId: updatedTicket.Id,
                ticketNumber: updatedTicket.ticketNumber,
                assignedTo: updatedTicket.AssignerId ? {
                    id: updatedTicket.AssignerId,
                    name: updatedTicket.assignedToName
                } : null,
                previousAssignedTo: currentAssignerId,
                updatedBy: updatedTicket.UpdatedBy,
                updatedAt: updatedTicket.UpdatedDate
            }
        });
        
    } catch (error) {
        console.error('Error updating ticket assignment:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ticket assignment',
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