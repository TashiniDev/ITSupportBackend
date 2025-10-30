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
        
        // Send email notifications to relevant users
        try {
            // Get users to notify: users in the ticket's category OR users with role ID 3
            let emailQuery = `
                SELECT DISTINCT u.email, u.name 
                FROM user u 
                WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' 
                AND (u.categoryId = ? OR u.roleId = 3)
            `;
            
            const [emailUsers] = await connection.query(emailQuery, [category ? parseInt(category) : null]);
            
            if (emailUsers.length > 0) {
                const nodemailer = require('nodemailer');
                
                // Configure nodemailer with improved compatibility
                const transporter = nodemailer.createTransport({
                    host: 'smtp.gmail.com',
                    port: 587,
                    secure: false, // Use STARTTLS
                    auth: {
                        user: '3treecrops2@gmail.com',
                        pass: 'txjwjrctbiahfldg'
                    },
                    tls: {
                        rejectUnauthorized: false
                    }
                });
                
                // Generate ticket number for email
                const ticketNumber = `TK-${new Date().getFullYear()}-${String(ticketId).padStart(3, '0')}`;
                
                // Send email to each user
                for (const user of emailUsers) {
                    try {
                        // Get additional ticket details for email
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
                        
                        await transporter.sendMail({
                            from: '"IT Support System" <3treecrops2@gmail.com>',
                            to: user.email,
                            subject: `New Ticket Created: ${ticketNumber}`,
                            html: `
                                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                                    <h2 style="color: #2c5aa0; text-align: center; margin-bottom: 30px;">🎫 New Support Ticket Created</h2>
                                    
                                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="color: #495057; margin-top: 0;">Ticket Information</h3>
                                        <table style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold; width: 30%;">Ticket Number:</td>
                                                <td style="padding: 8px 0;">${ticketNumber}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                                                <td style="padding: 8px 0; color: #28a745;">NEW</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Priority:</td>
                                                <td style="padding: 8px 0; color: #17a2b8;">LOW</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Created Date:</td>
                                                <td style="padding: 8px 0;">${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</td>
                                            </tr>
                                        </table>
                                    </div>
                                    
                                    <div style="background-color: #fff; padding: 15px; border: 1px solid #e9ecef; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="color: #495057; margin-top: 0;">Contact Details</h3>
                                        <table style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold; width: 30%;">Full Name:</td>
                                                <td style="padding: 8px 0;">${ticket.fullName || fullName || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Contact Number:</td>
                                                <td style="padding: 8px 0;">${ticket.ContactNumber || contactNumber || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Department:</td>
                                                <td style="padding: 8px 0;">${ticket.departmentName || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Company:</td>
                                                <td style="padding: 8px 0;">${ticket.companyName || 'N/A'}</td>
                                            </tr>
                                        </table>
                                    </div>
                                    
                                    <div style="background-color: #fff; padding: 15px; border: 1px solid #e9ecef; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="color: #495057; margin-top: 0;">Issue Details</h3>
                                        <table style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold; width: 30%;">Category:</td>
                                                <td style="padding: 8px 0;">${ticket.categoryName || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Issue Type:</td>
                                                <td style="padding: 8px 0;">${ticket.issueTypeName || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Request Type:</td>
                                                <td style="padding: 8px 0;">${ticket.requestTypeName || 'N/A'}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; font-weight: bold;">Assigned To:</td>
                                                <td style="padding: 8px 0;">${ticket.assignedToName || 'Unassigned'}</td>
                                            </tr>
                                        </table>
                                    </div>
                                    
                                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="color: #495057; margin-top: 0;">Description</h3>
                                        <p style="line-height: 1.6; margin: 0;">${ticket.Description || description || 'No description provided'}</p>
                                    </div>
                                    
                                    ${attachmentIds.length > 0 ? `
                                    <div style="background-color: #fff3cd; padding: 15px; border: 1px solid #ffeaa7; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="color: #856404; margin-top: 0;">📎 Attachments</h3>
                                        <p style="margin: 0; color: #856404;">${attachmentIds.length} file(s) attached to this ticket</p>
                                    </div>
                                    ` : ''}
                                    
                                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                                        <p style="color: #6c757d; margin: 0;">Please check the IT Support system for more details and to take action on this ticket.</p>
                                        <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">This is an automated notification from the IT Support System.</p>
                                    </div>
                                </div>
                            `
                        });
                        console.log(`Email sent successfully to ${user.email}`);
                    } catch (emailError) {
                        console.error(`Failed to send email to ${user.email}:`, emailError.message);
                    }
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
        
        // Send email notification to the newly assigned user
        if (newAssignerId) {
            try {
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
                    
                    const nodemailer = require('nodemailer');
                    
                    // Configure nodemailer with improved compatibility
                    const transporter = nodemailer.createTransport({
                        host: 'smtp.gmail.com',
                        port: 587,
                        secure: false, // Use STARTTLS
                        auth: {
                            user: '3treecrops2@gmail.com',
                            pass: 'txjwjrctbiahfldg'
                        },
                        tls: {
                            rejectUnauthorized: false
                        }
                    });
                    
                    await transporter.sendMail({
                        from: '"IT Support System" <3treecrops2@gmail.com>',
                        to: assignedUser.email,
                        subject: `Ticket Assigned to You: ${updatedTicket.ticketNumber}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                                <h2 style="color: #2c5aa0; text-align: center; margin-bottom: 30px;">🎯 Ticket Assigned to You</h2>
                                
                                <div style="background-color: #e8f4fd; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #2c5aa0;">
                                    <h3 style="color: #2c5aa0; margin-top: 0;">Assignment Notification</h3>
                                    <p style="margin: 10px 0; font-size: 16px;">Hello <strong>${assignedUser.name}</strong>,</p>
                                    <p style="margin: 10px 0;">A ticket has been assigned to you. Please review the details below and take appropriate action.</p>
                                </div>
                                
                                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #495057; margin-top: 0;">Ticket Information</h3>
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold; width: 30%;">Ticket Number:</td>
                                            <td style="padding: 8px 0;">${updatedTicket.ticketNumber}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                                            <td style="padding: 8px 0; color: #28a745;">${ticketDetails.Status || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Priority:</td>
                                            <td style="padding: 8px 0; color: #17a2b8;">${ticketDetails.priority || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Created Date:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.CreatedDate ? new Date(ticketDetails.CreatedDate).toLocaleDateString() + ' ' + new Date(ticketDetails.CreatedDate).toLocaleTimeString() : 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Assigned Date:</td>
                                            <td style="padding: 8px 0;">${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <div style="background-color: #fff; padding: 15px; border: 1px solid #e9ecef; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #495057; margin-top: 0;">Contact Details</h3>
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold; width: 30%;">Full Name:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.fullName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Contact Number:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.ContactNumber || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Department:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.departmentName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Company:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.companyName || 'N/A'}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <div style="background-color: #fff; padding: 15px; border: 1px solid #e9ecef; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #495057; margin-top: 0;">Issue Details</h3>
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold; width: 30%;">Category:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.categoryName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Issue Type:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.issueTypeName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Request Type:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.requestTypeName || 'N/A'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; font-weight: bold;">Created By:</td>
                                            <td style="padding: 8px 0;">${ticketDetails.createdByName || 'N/A'}</td>
                                        </tr>
                                    </table>
                                </div>
                                
                                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #495057; margin-top: 0;">Description</h3>
                                    <p style="line-height: 1.6; margin: 0;">${ticketDetails.Description || 'No description provided'}</p>
                                </div>
                                
                                ${attachmentCount > 0 ? `
                                <div style="background-color: #fff3cd; padding: 15px; border: 1px solid #ffeaa7; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #856404; margin-top: 0;">📎 Attachments</h3>
                                    <p style="margin: 0; color: #856404;">${attachmentCount} file(s) attached to this ticket</p>
                                </div>
                                ` : ''}
                                
                                <div style="background-color: #d4edda; padding: 15px; border: 1px solid #c3e6cb; border-radius: 5px; margin-bottom: 20px;">
                                    <h3 style="color: #155724; margin-top: 0;">🚀 Next Steps</h3>
                                    <p style="margin: 0; color: #155724;">
                                        Please log into the IT Support system to view full ticket details and update the status as you work on resolving this issue.
                                    </p>
                                </div>
                                
                                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                                    <p style="color: #6c757d; margin: 0;">Thank you for your prompt attention to this ticket.</p>
                                    <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">This is an automated notification from the IT Support System.</p>
                                </div>
                            </div>
                        `
                    });
                    
                    console.log(`Assignment notification email sent successfully to ${assignedUser.email}`);
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