/**
 * Email Controller
 * Handles email-related API endpoints including authentication and sending emails
 */

const emailService = require('../services/emailService');
const emailConfig = require('../config/emailConfig');

class EmailController {
    /**
     * Initiate email authentication process
     * GET /api/email/auth
     */
    async initiateAuth(req, res) {
        try {
            const authUrl = await emailService.getAuthUrl();
            res.json({
                success: true,
                message: 'Authentication URL generated successfully',
                authUrl: authUrl,
                instructions: 'Navigate to the provided URL to authenticate with Microsoft'
            });
        } catch (error) {
            console.error('Error initiating auth:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to initiate authentication',
                error: error.message
            });
        }
    }

    /**
     * Handle authentication callback
     * GET /api/email/callback
     */
    async handleCallback(req, res) {
        try {
            const { code } = req.query;
            
            if (!code) {
                return res.status(400).json({
                    success: false,
                    message: 'Authorization code not provided'
                });
            }

            // Acquire user access token
            const userAccessToken = await emailService.acquireUserToken(code);
            
            // Acquire client access token
            const clientAccessToken = await emailService.acquireClientToken();

            // Store tokens in session
            req.session.userAccessToken = userAccessToken;
            req.session.clientAccessToken = clientAccessToken;
            req.session.isAuthenticated = true;

            res.json({
                success: true,
                message: 'Authentication successful! Email service is now ready.',
                data: {
                    authenticated: true,
                    senderEmail: emailConfig.senderEmail
                }
            });

        } catch (error) {
            console.error('Error handling callback:', error);
            res.status(500).json({
                success: false,
                message: 'Authentication failed',
                error: error.message
            });
        }
    }

    /**
     * Check authentication status
     * GET /api/email/status
     */
    async checkAuthStatus(req, res) {
        try {
            const isAuthenticated = req.session.isAuthenticated || false;
            const hasUserToken = !!req.session.userAccessToken;
            const hasClientToken = !!req.session.clientAccessToken;

            res.json({
                success: true,
                data: {
                    isAuthenticated,
                    hasUserToken,
                    hasClientToken,
                    senderEmail: emailConfig.senderEmail,
                    message: isAuthenticated ? 'Email service is ready' : 'Authentication required'
                }
            });
        } catch (error) {
            console.error('Error checking auth status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check authentication status',
                error: error.message
            });
        }
    }

    /**
     * Send a single email
     * POST /api/email/send
     */
    async sendEmail(req, res) {
        try {
            // Check if authenticated
            if (!req.session.isAuthenticated || !req.session.userAccessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Email service not authenticated. Please authenticate first.',
                    authUrl: '/api/email/auth'
                });
            }

            const { to, subject, body, contentType, cc, bcc, toName, saveToSentItems } = req.body;

            // Validate required fields
            if (!to || !subject || !body) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: to, subject, and body are required'
                });
            }

            const emailData = {
                to,
                subject,
                body,
                contentType: contentType || 'Text',
                cc: cc || [],
                bcc: bcc || [],
                toName,
                saveToSentItems: saveToSentItems !== false
            };

            const result = await emailService.sendEmail(req.session.userAccessToken, emailData);

            res.json({
                success: true,
                message: 'Email sent successfully',
                data: {
                    to: emailData.to,
                    subject: emailData.subject,
                    sentAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Error sending email:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send email',
                error: error.message
            });
        }
    }

    /**
     * Send email using templates
     * POST /api/email/send-template
     */
    async sendTemplateEmail(req, res) {
        try {
            // Check if authenticated
            if (!req.session.isAuthenticated || !req.session.userAccessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Email service not authenticated. Please authenticate first.',
                    authUrl: '/api/email/auth'
                });
            }

            const { template, to, data } = req.body;

            // Validate required fields
            if (!template || !to) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: template and to are required'
                });
            }

            const templateData = {
                to,
                ...data
            };

            const result = await emailService.sendTemplateEmail(
                req.session.userAccessToken, 
                template, 
                templateData
            );

            res.json({
                success: true,
                message: `Template email '${template}' sent successfully`,
                data: {
                    template,
                    to: templateData.to,
                    sentAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Error sending template email:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send template email',
                error: error.message
            });
        }
    }

    /**
     * Get email messages
     * GET /api/email/messages/:count?
     */
    async getEmails(req, res) {
        try {
            // Check if authenticated
            if (!req.session.isAuthenticated || !req.session.userAccessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Email service not authenticated. Please authenticate first.',
                    authUrl: '/api/email/auth'
                });
            }

            const count = parseInt(req.params.count) || 10;
            
            if (count > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Count cannot exceed 100 messages'
                });
            }

            const messages = await emailService.getEmails(req.session.userAccessToken, count);

            res.json({
                success: true,
                message: `Retrieved ${messages.length} email messages`,
                data: {
                    count: messages.length,
                    messages: messages.map(msg => ({
                        id: msg.id,
                        subject: msg.subject,
                        from: msg.from?.emailAddress?.address,
                        receivedDateTime: msg.receivedDateTime,
                        isRead: msg.isRead,
                        hasAttachments: msg.hasAttachments,
                        bodyPreview: msg.bodyPreview
                    }))
                }
            });

        } catch (error) {
            console.error('Error fetching emails:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch emails',
                error: error.message
            });
        }
    }

    /**
     * Send ticket notification email
     * POST /api/email/ticket-notification
     */
    async sendTicketNotification(req, res) {
        try {
            // Check if authenticated
            if (!req.session.isAuthenticated || !req.session.userAccessToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Email service not authenticated. Please authenticate first.',
                    authUrl: '/api/email/auth'
                });
            }

            const { 
                ticketId, 
                userEmail, 
                userName, 
                title, 
                severityLevel, 
                status, 
                type = 'ticket-created',
                comments,
                updatedBy
            } = req.body;

            // Validate required fields
            if (!ticketId || !userEmail || !userName) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: ticketId, userEmail, and userName are required'
                });
            }

            const { formatSeverityForFrontend } = require('../lib/severity');
            const formattedSeverity = formatSeverityForFrontend(severityLevel);

            const templateData = {
                to: userEmail,
                ticketId,
                userName,
                title,
                severityLevel: formattedSeverity,
                status,
                comments,
                updatedBy,
                createdAt: new Date().toLocaleString(),
                updatedAt: new Date().toLocaleString()
            };

            const result = await emailService.sendTemplateEmail(
                req.session.userAccessToken, 
                type, 
                templateData
            );

            res.json({
                success: true,
                message: `Ticket ${type.replace('-', ' ')} notification sent to ${userEmail}`,
                data: {
                    ticketId,
                    notificationType: type,
                    recipient: userEmail,
                    sentAt: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Error sending ticket notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send ticket notification',
                error: error.message
            });
        }
    }

    /**
     * Logout - Clear session
     * POST /api/email/logout
     */
    async logout(req, res) {
        try {
            req.session.destroy((err) => {
                if (err) {
                    console.error('Session destroy error:', err);
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to logout',
                        error: err.message
                    });
                }

                res.json({
                    success: true,
                    message: 'Successfully logged out from email service'
                });
            });
        } catch (error) {
            console.error('Error during logout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to logout',
                error: error.message
            });
        }
    }

    /**
     * Get available email templates
     * GET /api/email/templates
     */
    async getTemplates(req, res) {
        try {
            const templates = [
                {
                    name: 'ticket-created',
                    description: 'Email sent when a new support ticket is created',
                    requiredFields: ['ticketId', 'userName', 'title', 'severityLevel', 'status']
                },
                {
                    name: 'ticket-updated',
                    description: 'Email sent when a support ticket is updated',
                    requiredFields: ['ticketId', 'userName', 'status', 'updatedBy']
                },
                {
                    name: 'welcome',
                    description: 'Welcome email for new users',
                    requiredFields: ['userName']
                }
            ];

            res.json({
                success: true,
                message: 'Available email templates',
                data: {
                    templates,
                    count: templates.length
                }
            });
        } catch (error) {
            console.error('Error getting templates:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get templates',
                error: error.message
            });
        }
    }
}

module.exports = new EmailController();