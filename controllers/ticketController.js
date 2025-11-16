const { getPool } = require('../config/db');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const { normalizeSeverityInput, formatSeverityForFrontend } = require('../lib/severity');

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
            severityLevel,
            description
        } = req.body;  
        
        // Get user info from auth middleware. Prefer storing uid in CreatedBy when available
        const createdBy = req.user?.uid || req.user?.email || req.user?.name || 'System';
        
        // Generate an approval token (used in email links) and expiry (24 hours)
        const approvalToken = crypto.randomBytes(24).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // Normalize severity for DB and insert ticket into database (store approval token & expiry so IT Head can approve/reject via email link)
    const dbSeverity = normalizeSeverityInput(severityLevel);

        const [ticketResult] = await connection.query(
            `INSERT INTO ticket (
                Name, ContactNumber, AssignerId, IssueId, RequestTypeId, 
                CompanyId, DepartmentId, Description, CategoryId, Status, ApprovalStatus, ApprovalToken, TokenExpiry,
                    SeverityLevel, CreatedBy, CreatedDate, IsActive
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', 'Pending', ?, ?, ?, ?, NOW(), 1)`,
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
                approvalToken,
                    tokenExpiry,
                    // SeverityLevel: prefer `severityLevel` (frontend may send this).
                    // Normalize to DB enum value using helper
                    dbSeverity,
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

            // Get ticket creator email (robust: try uid -> email raw value -> name)
            let creatorEmail = null;
            const [categoryTeamUsers] = await connection.query(categoryTeamQuery, [category ? parseInt(category) : null]);
            const [itHeadUsers] = await connection.query(itHeadQuery);
            
            try {
                // If createdBy looks like a uid, try to resolve user by uid
                if (createdBy && createdBy.toString().length > 0) {
                    // attempt by uid
                    const [creatorByUid] = await connection.query(`SELECT email, name FROM user WHERE uid = ? AND IsActive = 1 LIMIT 1`, [createdBy]);
                    if (creatorByUid && creatorByUid.length > 0 && creatorByUid[0].email) {
                        creatorEmail = creatorByUid[0].email;
                    }
                }
                // If not found and createdBy contains an @, assume it's an email string stored in CreatedBy
                if (!creatorEmail && createdBy && typeof createdBy === 'string' && createdBy.includes('@')) {
                    creatorEmail = createdBy;
                }
            } catch (e) {
                console.error('Error resolving creator email during ticket creation', e.message);
            }

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
                    requestType: ticket.requestTypeName || 'N/A',
                    assignedTo: ticket.assignedToName || 'Unassigned',
                    assignedDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    createdDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    lastUpdated: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
                    title: ticket.fullName || fullName || '',
                    description: ticket.Description || description || 'No description provided',
                    severityLevel: formatSeverityForFrontend(dbSeverity)
                };

                // Attach approval token so email templates can build tokenized links
                ticketData.approvalToken = approvalToken;
                ticketData.tokenExpiry = tokenExpiry;
                
                // Get IT Head email
                const itHeadEmail = itHeadUsers.length > 0 ? itHeadUsers[0].email : null;

                // Send ticket creation email using Microsoft Graph API
                // Notify category team members, the ticket creator, and the IT Head. The IT Head template contains approve/reject buttons.
                try {
                    await emailServiceApp.sendTicketCreationEmail(ticketData, categoryTeamUsers, itHeadEmail, creatorEmail);
                    console.log(`📧 Ticket creation emails sent for ticket ${ticketNumber} (IT Head, category team, creator)`);
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
        
        // Get ticket details with joined related data, including approval/action info
        const [ticketRows] = await pool.query(
            `SELECT 
                t.Id as id,
                CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                t.Name as title,
                t.Name as fullName,
                t.ContactNumber as contactNumber,
                t.Description as description,
                t.Status as status,
                t.SeverityLevel as severityLevel,
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
                t.UpdatedDate as assignedAt,
                t.ApprovalStatus,
                t.ActionedBy,
                t.ActionedDate,
                t.ActionComments,
                actionUser.Name as actionedByName
             FROM ticket t
             LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
             LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
             LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
             LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
             LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
             LEFT JOIN user u ON t.AssignerId = u.Id AND u.IsActive = 1
             LEFT JOIN user actionUser ON t.ActionedBy = actionUser.Id AND actionUser.IsActive = 1
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

        // Defensive: filter out empty/null paths and dedupe by Path
        const seen = new Set();
        const filteredAttachments = (attachmentRows || []).filter(a => {
            if (!a || !a.Path) return false;
            const p = ('' + a.Path).trim();
            if (!p) return false;
            if (seen.has(p)) return false;
            seen.add(p);
            return true;
        });

        // Format attachments with safe parsing
        const attachments = filteredAttachments.map(attachment => {
            const path = (attachment.Path || '').toString();
            const parts = path.split('/').filter(Boolean);
            const fileName = parts.length ? parts[parts.length - 1] : '';
            const originalName = fileName && fileName.includes('_') ? fileName.split('_').slice(1).join('_') : fileName;

            return {
                id: attachment.Id,
                originalName: originalName || fileName,
                fileName: fileName,
                size: null, // Size not stored in DB, would need file system check
                mimeType: null, // MIME type not stored in DB
                url: path
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
                severityLevel: formatSeverityForFrontend(ticket.severityLevel),
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
                approval: {
                    status: ticket.ApprovalStatus || 'Pending',
                    actionedBy: ticket.ActionedBy ? {
                        id: ticket.ActionedBy,
                        name: ticket.actionedByName || null
                    } : null,
                    actionedDate: ticket.ActionedDate || null,
                    comments: ticket.ActionComments || null
                },
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
    const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'severityLevel', 'fullName'];
        const sortField = allowedSortFields.includes(sort) ? sort : 'createdAt';
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        
        // Map sort fields to actual column names
        const sortFieldMap = {
            'createdAt': 't.CreatedDate',
            'updatedAt': 't.UpdatedDate',
            'status': 't.Status',
            'severityLevel': 't.SeverityLevel',
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
                t.SeverityLevel as severityLevel,
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
            severityLevel: formatSeverityForFrontend(row.severityLevel),
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
    const allowedSortFields = ['createdAt', 'updatedAt', 'status', 'severityLevel', 'fullName'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'createdAt';
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        
        // Map sort fields to actual column names
        const sortFieldMap = {
            'createdAt': 't.CreatedDate',
            'updatedAt': 't.UpdatedDate',
            'status': 't.Status',
            'severityLevel': 't.SeverityLevel',
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
                t.SeverityLevel as severityLevel,
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
            severityLevel: row.severityLevel,
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
                        t.SeverityLevel as severityLevel,
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
                    
                    // Filter out the current user for PROCESSING notifications to avoid self-notification.
                    // For COMPLETED notifications we want to notify all ticket relaters, so do not exclude the current user.
                    const filteredTeamUsers = categoryTeamUsers.filter(user => {
                        if (newStatus === 'COMPLETED') return true;
                        return user.email !== (req.user?.email || '');
                    });
                    
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
                    
                    // Get ticket creator email (robust: try user.email OR user.id match, fallback to CreatedBy raw value if it's an email)
                    let ticketCreatorEmail = null;
                    // determine possible numeric id
                    const possibleCreatorId = Number.isInteger(Number(ticketDetails.CreatedBy)) ? Number(ticketDetails.CreatedBy) : null;
                    // Try several ways to resolve the creator to an active user record: by email, numeric Id, uid, or name
                    const [creatorUsers] = await pool.query(`
                        SELECT email FROM user 
                        WHERE IsActive = 1 AND (
                            email = ? OR 
                            Id = ? OR 
                            uid = ? OR
                            Name = ?
                        )
                        LIMIT 1
                    `, [ticketDetails.CreatedBy, possibleCreatorId, ticketDetails.CreatedBy, ticketDetails.CreatedBy]);

                    if (creatorUsers.length > 0 && creatorUsers[0].email) {
                        ticketCreatorEmail = creatorUsers[0].email;
                    } else if (ticketDetails.CreatedBy && String(ticketDetails.CreatedBy).includes('@')) {
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
                        severityLevel: ticketDetails.severityLevel || 'LOW'
                    };
                    // include request type for notification templates
                    ticketData.requestType = ticketDetails.requestTypeName || 'N/A';
                    
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
                            t.SeverityLevel as severityLevel,
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
                                <p><strong>Severity Level:</strong> ${ticketDetails.severityLevel || 'N/A'}</p>
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
        
        // First, verify that the ticket exists and is active, and get current status
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
        
        const currentTicket = ticketRows[0];
        const shouldUpdateStatus = currentTicket.Status === 'NEW';
        
    // Get user info from auth middleware. Prefer storing uid when available
    const createdBy = req.user?.uid || req.user?.email || req.user?.name || 'System';
        
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
        
        // Auto-update ticket status from NEW to PROCESSING when comment is added
        let statusUpdated = false;
        if (shouldUpdateStatus) {
            try {
                const updatedBy = req.user?.name || req.user?.email || 'System';
                const [updateResult] = await pool.query(
                    `UPDATE ticket 
                     SET Status = 'PROCESSING', UpdatedBy = ?, UpdatedDate = NOW() 
                     WHERE Id = ? AND IsActive = 1 AND Status = 'NEW'`,
                    [updatedBy, parseInt(ticketId)]
                );
                
                if (updateResult.affectedRows > 0) {
                    statusUpdated = true;
                    console.log(`✅ Auto-updated ticket ${ticketId} status from NEW to PROCESSING after comment added`);
                }
            } catch (statusUpdateError) {
                // Log the error but don't fail the comment addition
                console.error('Error auto-updating ticket status:', statusUpdateError);
            }
        }
        
        res.status(201).json({
            success: true,
            message: statusUpdated 
                ? 'Comment added successfully and ticket status updated to PROCESSING' 
                : 'Comment added successfully',
            data: {
                id: newComment.Id,
                comment: newComment.Comment,
                userId: newComment.UserId,
                name: newComment.Name,
                createdBy: newComment.CreatedBy,
                createdAt: newComment.CreatedDate,
                ticketId: parseInt(ticketId),
                statusUpdated: statusUpdated,
                newStatus: statusUpdated ? 'PROCESSING' : currentTicket.Status
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

/**
 * Bulk update tickets with comments from NEW to PROCESSING status
 * PUT /api/tickets/bulk-update-status
 * This function updates all tickets that have comments but still have status 'NEW' to 'PROCESSING'
 */
exports.bulkUpdateTicketsWithCommentsToProcessing = async (req, res) => {
    try {
        const pool = getPool();
        
        // Get user info for the update
        const updatedBy = req.user?.name || req.user?.email || 'System';
        
        // Find all tickets that have comments but still have status 'NEW'
        const [ticketsToUpdate] = await pool.query(`
            SELECT DISTINCT t.Id, 
                   CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                   t.Status
            FROM ticket t 
            INNER JOIN comment c ON t.Id = c.TicketId 
            WHERE t.Status = 'NEW' 
              AND t.IsActive = 1 
              AND c.IsActive = 1
            ORDER BY t.Id
        `);
        
        if (ticketsToUpdate.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No tickets found that need status update',
                data: {
                    updatedCount: 0,
                    tickets: []
                }
            });
        }
        
        // Update all these tickets to PROCESSING status
        const ticketIds = ticketsToUpdate.map(ticket => ticket.Id);
        const placeholders = ticketIds.map(() => '?').join(',');
        
        const [updateResult] = await pool.query(`
            UPDATE ticket 
            SET Status = 'PROCESSING', UpdatedBy = ?, UpdatedDate = NOW() 
            WHERE Id IN (${placeholders}) 
              AND Status = 'NEW' 
              AND IsActive = 1
        `, [updatedBy, ...ticketIds]);
        
        console.log(`✅ Bulk updated ${updateResult.affectedRows} tickets from NEW to PROCESSING`);
        
        res.status(200).json({
            success: true,
            message: `Successfully updated ${updateResult.affectedRows} tickets to PROCESSING status`,
            data: {
                updatedCount: updateResult.affectedRows,
                tickets: ticketsToUpdate.map(ticket => ({
                    id: ticket.Id,
                    ticketNumber: ticket.ticketNumber,
                    previousStatus: 'NEW',
                    newStatus: 'PROCESSING'
                }))
            }
        });
        
    } catch (error) {
        console.error('Error in bulk status update:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ticket statuses',
            error: error.message
        });
    }
};

/**
 * Approve a ticket (IT Head only)
 */
exports.approveTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { comments } = req.body;
        const approvedBy = req.user?.uid;
        const approverName = req.user?.name || 'IT Head';

        const wantsHtml = (req.headers && req.headers.accept && req.headers.accept.includes('text/html')) || (req.is && req.is('application/x-www-form-urlencoded'));

        if (!id) {
            const msg = 'Ticket ID is required';
            if (wantsHtml) return res.status(400).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(400).json({ message: msg });
        }

        const pool = getPool();

        // Get ticket details
        const [ticketRows] = await pool.query(`
            SELECT t.*, u.email as creatorEmail, u.name as creatorName,
                   c.Name as categoryName
            FROM ticket t
            LEFT JOIN user u ON t.CreatedBy = u.uid
            LEFT JOIN category c ON t.CategoryId = c.Id
            WHERE t.Id = ? AND t.IsActive = 1
        `, [id]);

        if (ticketRows.length === 0) {
            const msg = 'Ticket not found';
            if (wantsHtml) return res.status(404).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(404).json({ message: msg });
        }

        const ticket = ticketRows[0];

        // Allow approval if user is IT Head OR a valid token is provided via query string
        let tokenValidated = false;
        if (req.user?.roleId === 3) {
            // authenticated IT Head
        } else if (req.query && req.query.token) {
            const providedToken = req.query.token;
            // Validate token and expiry
            if (!ticket.ApprovalToken || ticket.ApprovalToken !== providedToken) {
                const msg = 'Invalid or expired approval token';
                if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
                return res.status(403).json({ message: msg });
            }
            const expiry = ticket.TokenExpiry ? new Date(ticket.TokenExpiry) : null;
            if (!expiry || expiry < new Date()) {
                const msg = 'Approval token expired';
                if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
                return res.status(403).json({ message: msg });
            }
            tokenValidated = true;
        } else {
            const msg = 'Only IT Head can approve tickets';
            if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(403).json({ message: msg });
        }

        // Determine final approver id and name
        let finalApprovedById = null;
        let finalApproverName = 'IT Head';

        if (req.user?.roleId === 3) {
            // authenticated IT Head
            finalApprovedById = req.user?.id || null;
            finalApproverName = req.user?.name || req.user?.email || 'IT Head';
        } else if (tokenValidated) {
            // Token-approved via email link — set ActionedBy to the primary IT Head user if available
            const [itHeadRows] = await pool.query(`SELECT Id, Name FROM user WHERE roleId = 3 AND IsActive = 1 LIMIT 1`);
            if (itHeadRows && itHeadRows.length > 0) {
                finalApprovedById = itHeadRows[0].Id;
                finalApproverName = itHeadRows[0].Name || 'IT Head';
            } else {
                finalApprovedById = null;
                finalApproverName = 'IT Head (email link)';
            }
        }

        // Update ticket approval fields to reflect approval
        await pool.query(`
            UPDATE ticket
            SET ApprovalStatus = 'Approved', ActionedBy = ?, ActionedDate = NOW(), ActionComments = ?, ApprovalToken = NULL, TokenExpiry = NULL, UpdatedBy = ?, UpdatedDate = NOW()
            WHERE Id = ?
        `, [finalApprovedById, comments || null, finalApproverName, id]);

        // Notify all relevant parties (creator, assigned user, category team, IT Head)
        try {
            const emailServiceApp = require('../services/emailServiceApp');
            const pool = getPool();

            // Get latest ticket details with related info
            const [detailsRows] = await pool.query(`
                SELECT 
                    t.Id,
                    CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                    t.Name as fullName,
                    t.ContactNumber,
                    t.Description,
                    t.CreatedDate,
                    t.CategoryId,
                    c.Name as categoryName,
                    t.AssignerId,
                    au.email as assignerEmail,
                    au.Name as assignerName,
                    cu.email as creatorEmail,
                    cu.Name as creatorName,
                    t.CreatedBy as createdByRaw,
                    d.Name as departmentName,
                    comp.Name as companyName,
                    it.Name as issueTypeName,
                    rt.Name as requestTypeName
                FROM ticket t
                LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
                LEFT JOIN user au ON t.AssignerId = au.Id AND au.IsActive = 1
                LEFT JOIN user cu ON t.CreatedBy = cu.uid AND cu.IsActive = 1
                LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
                LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
                LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
                LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
                WHERE t.Id = ?
            `, [id]);

            const info = detailsRows[0] || {};
            const ticketNumber = info.ticketNumber || `TK-${new Date().getFullYear()}-${String(id).padStart(3, '0')}`;

            const ticketData = {
                ticketId: ticketNumber,
                category: info.categoryName || 'General',
                assignedTeam: info.categoryName || 'General',
                requesterName: info.fullName || ticket.creatorName || 'User',
                requesterContact: info.ContactNumber || info.ContactNumber || 'N/A',
                requesterDepartment: info.departmentName || 'N/A',
                requesterCompany: info.companyName || 'N/A',
                    issueType: info.issueTypeName || 'N/A',
                    requestType: info.requestTypeName || 'N/A',
                assignedTo: info.assignerName || 'Unassigned',
                createdDate: info.CreatedDate,
                description: info.Description || '',
                approverName: finalApproverName,
                approvalComments: comments || ''
            };

            // Resolve creator email robustly (try joined user, then raw CreatedBy if it contains an email, else try lookup by uid/email/name)
            let resolvedCreatorEmail = info.creatorEmail || null;
            let resolvedCreatorName = info.creatorName || null;
            try {
                if (!resolvedCreatorEmail && info.createdByRaw) {
                    if (typeof info.createdByRaw === 'string' && info.createdByRaw.includes('@')) {
                        resolvedCreatorEmail = info.createdByRaw;
                        resolvedCreatorName = info.fullName || resolvedCreatorName || 'Creator';
                    } else {
                        // Try to find the user by uid or email or name
                        const [found] = await pool.query(`SELECT email, name FROM user WHERE (uid = ? OR email = ? OR name = ?) AND IsActive = 1 LIMIT 1`, [info.createdByRaw, info.createdByRaw, info.createdByRaw]);
                        if (found && found.length > 0 && found[0].email) {
                            resolvedCreatorEmail = found[0].email;
                            resolvedCreatorName = found[0].name || resolvedCreatorName;
                        }
                    }
                }
            } catch (e) {
                console.error('Error resolving creator email for approval notifications', e.message);
            }

            // Collect recipients (deduplicated)
            // Notify assignee, category team members, IT Head(s), and the ticket creator (resolvedCreatorEmail)
            const recipientsMap = new Map();
            if (resolvedCreatorEmail) recipientsMap.set((resolvedCreatorEmail || '').toLowerCase(), { email: resolvedCreatorEmail, name: resolvedCreatorName || info.fullName || 'Creator' });
            if (info.assignerEmail) recipientsMap.set((info.assignerEmail || '').toLowerCase(), { email: info.assignerEmail, name: info.assignerName || 'Assignee' });

            // Category team members
            if (info.CategoryId) {
                try {
                    const [team] = await pool.query(`SELECT DISTINCT u.email, u.name FROM user u WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' AND u.categoryId = ?`, [info.CategoryId]);
                    for (const m of team) {
                        if (m && m.email) recipientsMap.set(m.email.toLowerCase(), { email: m.email, name: m.name });
                    }
                } catch (e) {
                    console.error('Error fetching category team members for approval notifications', e.message);
                }
            }

            // IT Head(s)
            try {
                const [heads] = await pool.query(`SELECT DISTINCT u.email, u.name FROM user u WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' AND u.roleId = 3`);
                for (const h of heads) {
                    if (h && h.email) recipientsMap.set(h.email.toLowerCase(), { email: h.email, name: h.name || 'IT Head' });
                }
            } catch (e) {
                console.error('Error fetching IT Head recipients for approval notifications', e.message);
            }

            // Send approval email to each recipient (avoid duplicates)
            for (const [, r] of recipientsMap) {
                try {
                    await emailServiceApp.sendTicketApprovalEmail(ticketData, r.email, r.name || r.email, finalApproverName, comments || '');
                    console.log(`📧 Approval notification sent to ${r.email}`);
                } catch (e) {
                    console.error(`Error sending approval notification to ${r.email}:`, e.message);
                }
            }

        } catch (emailError) {
            console.error('Error sending approval notifications:', emailError.message);
        }

        // If request is from the HTML confirmation form, return a friendly HTML page
        if (wantsHtml) {
            const ticketNumber = `TK-${new Date().getFullYear()}-${String(id).padStart(3, '0')}`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket Approved</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;background:#f8fafc;"><div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e6edf3;"><h2 style="color:#065f46;">This ticket has been approved</h2><p>Ticket <strong>${ticketNumber}</strong> was approved by <strong>${finalApproverName}</strong>.</p>${comments ? `<p><strong>Comments:</strong> ${comments}</p>` : ''}<p style="color:#64748b;margin-top:12px;">You can close this window.</p></div></body></html>`;
            return res.status(200).send(html);
        }

        res.status(200).json({
            message: 'Ticket approved successfully',
            data: {
                ticketId: id,
                status: 'APPROVED',
                approvedBy: finalApproverName,
                approvalDate: new Date().toISOString(),
                comments: comments || null
            }
        });

    } catch (error) {
        console.error('Error approving ticket:', error);
        res.status(500).json({ message: 'Error approving ticket', error: error.message });
    }
};

/**
 * Reject a ticket (IT Head only)
 */
exports.rejectTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const rejectedBy = req.user?.uid;
        const rejectorName = req.user?.name || 'IT Head';

        const wantsHtml = (req.headers && req.headers.accept && req.headers.accept.includes('text/html')) || (req.is && req.is('application/x-www-form-urlencoded'));

        if (!id) {
            const msg = 'Ticket ID is required';
            if (wantsHtml) return res.status(400).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(400).json({ message: msg });
        }

        if (!reason) {
            const msg = 'Rejection reason is required';
            if (wantsHtml) return res.status(400).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(400).json({ message: msg });
        }

        const pool = getPool();

        // Get ticket details
        const [ticketRows] = await pool.query(`
            SELECT t.*, u.email as creatorEmail, u.name as creatorName,
                   c.Name as categoryName
            FROM ticket t
            LEFT JOIN user u ON t.CreatedBy = u.uid
            LEFT JOIN category c ON t.CategoryId = c.Id
            WHERE t.Id = ? AND t.IsActive = 1
        `, [id]);

        if (ticketRows.length === 0) {
            const msg = 'Ticket not found';
            if (wantsHtml) return res.status(404).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(404).json({ message: msg });
        }

        const ticket = ticketRows[0];

        // Allow rejection if user is IT Head OR a valid token is provided via query string
        let tokenValidated = false;
        if (req.user?.roleId === 3) {
            // authenticated IT Head
        } else if (req.query && req.query.token) {
            const providedToken = req.query.token;
            // Validate token and expiry
            if (!ticket.ApprovalToken || ticket.ApprovalToken !== providedToken) {
                const msg = 'Invalid or expired approval token';
                if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
                return res.status(403).json({ message: msg });
            }
            const expiry = ticket.TokenExpiry ? new Date(ticket.TokenExpiry) : null;
            if (!expiry || expiry < new Date()) {
                const msg = 'Approval token expired';
                if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
                return res.status(403).json({ message: msg });
            }
            tokenValidated = true;
        } else {
            const msg = 'Only IT Head can reject tickets';
            if (wantsHtml) return res.status(403).send(`<html><body><h3>${msg}</h3></body></html>`);
            return res.status(403).json({ message: msg });
        }

        // Determine final rejector id and name
        let finalRejectedById = null;
        let finalRejectorName = 'IT Head';

        if (req.user?.roleId === 3) {
            finalRejectedById = req.user?.id || null;
            finalRejectorName = req.user?.name || req.user?.email || 'IT Head';
        } else if (tokenValidated) {
            const [itHeadRows] = await pool.query(`SELECT Id, Name FROM user WHERE roleId = 3 AND IsActive = 1 LIMIT 1`);
            if (itHeadRows && itHeadRows.length > 0) {
                finalRejectedById = itHeadRows[0].Id;
                finalRejectorName = itHeadRows[0].Name || 'IT Head';
            } else {
                finalRejectedById = null;
                finalRejectorName = 'IT Head (email link)';
            }
        }

        // Update ticket approval fields to reflect rejection
        await pool.query(`
            UPDATE ticket
            SET ApprovalStatus = 'Rejected', ActionedBy = ?, ActionedDate = NOW(), ActionComments = ?, ApprovalToken = NULL, TokenExpiry = NULL, UpdatedBy = ?, UpdatedDate = NOW()
            WHERE Id = ?
        `, [finalRejectedById, reason || null, finalRejectorName, id]);

        // Notify all relevant parties (creator, assigned user, category team, IT Head) about rejection
        try {
            const emailServiceApp = require('../services/emailServiceApp');
            const pool = getPool();

            // Get latest ticket details with related info
            const [detailsRows] = await pool.query(`
                SELECT 
                    t.Id,
                    CONCAT('TK-', YEAR(t.CreatedDate), '-', LPAD(t.Id, 3, '0')) as ticketNumber,
                    t.Name as fullName,
                    t.ContactNumber,
                    t.Description,
                    t.CreatedDate,
                    t.CategoryId,
                    c.Name as categoryName,
                    t.AssignerId,
                    au.email as assignerEmail,
                    au.Name as assignerName,
                    cu.email as creatorEmail,
                    cu.Name as creatorName,
                    d.Name as departmentName,
                    comp.Name as companyName,
                    it.Name as issueTypeName,
                    rt.Name as requestTypeName
                FROM ticket t
                LEFT JOIN category c ON t.CategoryId = c.Id AND c.IsActive = 1
                LEFT JOIN user au ON t.AssignerId = au.Id AND au.IsActive = 1
                LEFT JOIN user cu ON t.CreatedBy = cu.uid AND cu.IsActive = 1
                , t.CreatedBy as createdByRaw
                LEFT JOIN department d ON t.DepartmentId = d.Id AND d.IsActive = 1
                LEFT JOIN company comp ON t.CompanyId = comp.Id AND comp.IsActive = 1
                LEFT JOIN issuetype it ON t.IssueId = it.Id AND it.IsActive = 1
                LEFT JOIN requesttype rt ON t.RequestTypeId = rt.Id AND rt.IsActive = 1
                WHERE t.Id = ?
            `, [id]);

            const info = detailsRows[0] || {};
            const ticketNumber = info.ticketNumber || `TK-${new Date().getFullYear()}-${String(id).padStart(3, '0')}`;

            const ticketData = {
                ticketId: ticketNumber,
                category: info.categoryName || 'General',
                assignedTeam: info.categoryName || 'General',
                requesterName: info.fullName || ticket.creatorName || 'User',
                requesterContact: info.ContactNumber || 'N/A',
                requesterDepartment: info.departmentName || 'N/A',
                requesterCompany: info.companyName || 'N/A',
                    issueType: info.issueTypeName || 'N/A',
                    requestType: info.requestTypeName || 'N/A',
                assignedTo: info.assignerName || 'Unassigned',
                createdDate: info.CreatedDate,
                description: info.Description || '',
                rejectorName: finalRejectorName,
                rejectionReason: reason || ''
            };

            // Resolve creator email robustly (try joined user, then raw CreatedBy if it contains an email, else try lookup by uid/email/name)
            let resolvedCreatorEmail = info.creatorEmail || null;
            let resolvedCreatorName = info.creatorName || null;
            try {
                if (!resolvedCreatorEmail && info.createdByRaw) {
                    if (typeof info.createdByRaw === 'string' && info.createdByRaw.includes('@')) {
                        resolvedCreatorEmail = info.createdByRaw;
                        resolvedCreatorName = info.fullName || resolvedCreatorName || 'Creator';
                    } else {
                        // Try to find the user by uid or email or name
                        const [found] = await pool.query(`SELECT email, name FROM user WHERE (uid = ? OR email = ? OR name = ?) AND IsActive = 1 LIMIT 1`, [info.createdByRaw, info.createdByRaw, info.createdByRaw]);
                        if (found && found.length > 0 && found[0].email) {
                            resolvedCreatorEmail = found[0].email;
                            resolvedCreatorName = found[0].name || resolvedCreatorName;
                        }
                    }
                }
            } catch (e) {
                console.error('Error resolving creator email for rejection notifications', e.message);
            }

            // Collect recipients (deduplicated)
            // Notify assignee, category team members, IT Head(s), and the ticket creator (resolvedCreatorEmail)
            const recipientsMap = new Map();
            if (resolvedCreatorEmail) recipientsMap.set((resolvedCreatorEmail || '').toLowerCase(), { email: resolvedCreatorEmail, name: resolvedCreatorName || info.fullName || 'Creator' });
            if (info.assignerEmail) recipientsMap.set((info.assignerEmail || '').toLowerCase(), { email: info.assignerEmail, name: info.assignerName || 'Assignee' });

            // Category team members
            if (info.CategoryId) {
                try {
                    const [team] = await pool.query(`SELECT DISTINCT u.email, u.name FROM user u WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' AND u.categoryId = ?`, [info.CategoryId]);
                    for (const m of team) {
                        if (m && m.email) recipientsMap.set(m.email.toLowerCase(), { email: m.email, name: m.name });
                    }
                } catch (e) {
                    console.error('Error fetching category team members for rejection notifications', e.message);
                }
            }

            // IT Head(s)
            try {
                const [heads] = await pool.query(`SELECT DISTINCT u.email, u.name FROM user u WHERE u.IsActive = 1 AND u.email IS NOT NULL AND u.email != '' AND u.roleId = 3`);
                for (const h of heads) {
                    if (h && h.email) recipientsMap.set(h.email.toLowerCase(), { email: h.email, name: h.name || 'IT Head' });
                }
            } catch (e) {
                console.error('Error fetching IT Head recipients for rejection notifications', e.message);
            }

            // Send rejection email to each recipient (avoid duplicates)
            for (const [, r] of recipientsMap) {
                try {
                    await emailServiceApp.sendTicketRejectionEmail(ticketData, r.email, r.name || r.email, finalRejectorName, reason || '');
                    console.log(`📧 Rejection notification sent to ${r.email}`);
                } catch (e) {
                    console.error(`Error sending rejection notification to ${r.email}:`, e.message);
                }
            }

        } catch (emailError) {
            console.error('Error sending rejection notifications:', emailError.message);
        }

        if (wantsHtml) {
            const ticketNumber = `TK-${new Date().getFullYear()}-${String(id).padStart(3, '0')}`;
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket Rejected</title></head><body style="font-family:Arial,Helvetica,sans-serif;max-width:700px;margin:40px auto;background:#fff5f5;"><div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #f5e6e6;"><h2 style="color:#b91c1c;">This ticket has been rejected</h2><p>Ticket <strong>${ticketNumber}</strong> was rejected by <strong>${finalRejectorName}</strong>.</p>${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}<p style="color:#64748b;margin-top:12px;">You can close this window.</p></div></body></html>`;
            return res.status(200).send(html);
        }

        res.status(200).json({
            message: 'Ticket rejected successfully',
            data: {
                ticketId: id,
                status: 'REJECTED',
                rejectedBy: finalRejectorName,
                rejectionDate: new Date().toISOString(),
                reason: reason
            }
        });

    } catch (error) {
        console.error('Error rejecting ticket:', error);
        res.status(500).json({ message: 'Error rejecting ticket', error: error.message });
    }
};

/**
 * Update ticket status to PROCESSING
 * PUT /api/tickets/:id/processing
 */
exports.updateTicketToProcessing = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate ticket ID
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id, Status, ApprovalStatus FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(id)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        const currentStatus = ticketRows[0].Status;
        const approvalStatus = ticketRows[0].ApprovalStatus;
        
        // // Check if ticket is approved (if approval workflow is enabled)
        // if (approvalStatus && approvalStatus.toLowerCase() === 'pending') {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Cannot change status to PROCESSING. Ticket is pending approval.'
        //     });
        // }
        
        // if (approvalStatus && approvalStatus.toLowerCase() === 'rejected') {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Cannot change status to PROCESSING. Ticket has been rejected.'
        //     });
        // }
        
        // Check if status is already PROCESSING
        if (currentStatus === 'PROCESSING') {
            return res.status(200).json({
                success: true,
                message: 'Ticket status is already set to PROCESSING',
                data: {
                    ticketId: parseInt(id),
                    status: 'PROCESSING',
                    previousStatus: currentStatus
                }
            });
        }
        
        // Get user info from auth middleware
        const updatedBy = req.user?.name || req.user?.email || 'System';
        
        // Update the ticket status to PROCESSING
        const [updateResult] = await pool.query(
            `UPDATE ticket 
             SET Status = 'PROCESSING', UpdatedBy = ?, UpdatedDate = NOW() 
             WHERE Id = ? AND IsActive = 1`,
            [updatedBy, parseInt(id)]
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
            [parseInt(id)]
        );
        
        const updatedTicket = updatedTicketRows[0];
        
        console.log(`✅ Ticket ${updatedTicket.ticketNumber} status changed from ${currentStatus} to PROCESSING by ${updatedBy}`);
        
        res.status(200).json({
            success: true,
            message: 'Ticket status updated to PROCESSING successfully',
            data: {
                ticketId: updatedTicket.Id,
                ticketNumber: updatedTicket.ticketNumber,
                status: updatedTicket.Status,
                previousStatus: currentStatus,
                updatedBy: updatedTicket.UpdatedBy,
                updatedDate: updatedTicket.UpdatedDate
            }
        });
        
    } catch (error) {
        console.error('Error updating ticket to PROCESSING:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ticket status',
            error: error.message
        });
    }
};

/**
 * Update ticket status to COMPLETED
 * PUT /api/tickets/:id/complete
 */
exports.updateTicketToCompleted = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validate ticket ID
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'Valid ticket ID is required'
            });
        }
        
        const pool = getPool();
        
        // First, verify that the ticket exists and is active
        const [ticketRows] = await pool.query(
            'SELECT Id, Status, ApprovalStatus FROM ticket WHERE Id = ? AND IsActive = 1',
            [parseInt(id)]
        );
        
        if (ticketRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found'
            });
        }
        
        const currentStatus = ticketRows[0].Status;
        const approvalStatus = ticketRows[0].ApprovalStatus;
        
        // // Check if ticket is approved (if approval workflow is enabled)
        // if (approvalStatus && approvalStatus.toLowerCase() === 'pending') {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Cannot change status to COMPLETED. Ticket is pending approval.'
        //     });
        // }
        
        // if (approvalStatus && approvalStatus.toLowerCase() === 'rejected') {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Cannot change status to COMPLETED. Ticket has been rejected.'
        //     });
        // }
        
        // Check if status is already COMPLETED
        if (currentStatus === 'COMPLETED') {
            return res.status(200).json({
                success: true,
                message: 'Ticket status is already set to COMPLETED',
                data: {
                    ticketId: parseInt(id),
                    status: 'COMPLETED',
                    previousStatus: currentStatus
                }
            });
        }
        
        // Get user info from auth middleware
        const updatedBy = req.user?.name || req.user?.email || 'System';
        
        // Update the ticket status to COMPLETED
        const [updateResult] = await pool.query(
            `UPDATE ticket 
             SET Status = 'COMPLETED', UpdatedBy = ?, UpdatedDate = NOW() 
             WHERE Id = ? AND IsActive = 1`,
            [updatedBy, parseInt(id)]
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
            [parseInt(id)]
        );
        
        const updatedTicket = updatedTicketRows[0];
        
        console.log(`✅ Ticket ${updatedTicket.ticketNumber} status changed from ${currentStatus} to COMPLETED by ${updatedBy}`);
        
        res.status(200).json({
            success: true,
            message: 'Ticket status updated to COMPLETED successfully',
            data: {
                ticketId: updatedTicket.Id,
                ticketNumber: updatedTicket.ticketNumber,
                status: updatedTicket.Status,
                previousStatus: currentStatus,
                updatedBy: updatedTicket.UpdatedBy,
                updatedDate: updatedTicket.UpdatedDate
            }
        });
        
    } catch (error) {
        console.error('Error updating ticket to COMPLETED:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating ticket status',
            error: error.message
        });
    }
};