/**
 * Alternative Email Service using Application Permissions
 * This uses client credentials flow instead of user authentication
 */

const { Client } = require('@microsoft/microsoft-graph-client');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const emailConfigApp = require('../config/emailConfigApp');

class EmailServiceApp {
    constructor() {
        // Initialize MSAL client for application-only authentication
        this.confidentialClientApp = new ConfidentialClientApplication(emailConfigApp.confidentialClientConfig());
        this.accessToken = null;
    }

    /**
     * Acquire application access token (no user interaction required)
     */
    async acquireAppToken() {
        try {
            console.log('🔑 Attempting to acquire app token...');
            const tokenRequest = {
                scopes: emailConfigApp.scopes,
                clientSecret: emailConfigApp.clientSecret,
            };

            console.log('📋 Token request config:', { 
                scopes: tokenRequest.scopes, 
                hasClientSecret: !!tokenRequest.clientSecret,
                clientId: emailConfigApp.clientId,
                tenantId: emailConfigApp.tenantId
            });

            const response = await this.confidentialClientApp.acquireTokenByClientCredential(tokenRequest);
            this.accessToken = response.accessToken;
            console.log('✅ App token acquired successfully');
            return this.accessToken;
        } catch (error) {
            console.error('❌ Error acquiring app token:', error);
            console.error('Full error details:', JSON.stringify(error, null, 2));
            throw new Error(`Failed to acquire application access token: ${error.message}`);
        }
    }

    /**
     * Create Microsoft Graph client with access token
     */
    createGraphClient(accessToken) {
        return Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            },
        });
    }

    /**
     * Send email using application permissions (send on behalf of user)
     */
    async sendEmailAsUser(emailData) {
        try {
            console.log('📧 Attempting to send email to:', emailData.to);
            
            // Get application token
            const token = await this.acquireAppToken();
            const client = this.createGraphClient(token);

            // Prepare email message
            const message = {
                subject: emailData.subject,
                body: {
                    contentType: emailData.contentType || 'HTML',
                    content: emailData.body,
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: emailData.to,
                            name: emailData.toName || emailData.to
                        },
                    },
                ],
                from: {
                    emailAddress: {
                        address: emailConfigApp.senderEmail,
                        name: emailConfigApp.senderName
                    }
                }
            };

            const sendMailData = {
                message: message,
                saveToSentItems: emailData.saveToSentItems !== false
            };

            console.log('📤 Sending email via Graph API...');
            
            // Send email using the specific user's mailbox
            // This requires Mail.Send application permission
            const response = await client
                .api(`/users/${emailConfigApp.senderEmail}/sendMail`)
                .post(sendMailData);

            console.log('✅ Email sent successfully via Microsoft Graph');
            return {
                success: true,
                message: 'Email sent successfully via application permissions',
                response: response
            };

        } catch (error) {
            console.error('❌ Error sending email via app permissions:', error);
            console.error('Full error details:', JSON.stringify(error, null, 2));
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    /**
     * Send welcome email template
     * @param {string} to
     * @param {string} userName
     * @param {Object} [opts] - { role, categories, loginUrl }
     */
    async sendWelcomeEmail(to, userName, options = {}) {
        const role = options.role || 'Ticket Creator';
        const categories = Array.isArray(options.categories) ? options.categories : (options.categories ? [options.categories] : []);
        const categoriesHtml = categories.length ? `<p style="color:#4a5568; margin-bottom:15px;"><strong>Assigned Categories:</strong> <span style="background-color:#e0f2f7; color:#00796b; padding:4px 8px; border-radius:4px; font-size:0.9em;">${categories.join('</span> <span style="background-color:#e0f2f7; color:#00796b; padding:4px 8px; border-radius:4px; font-size:0.9em;">')}</span></p>` : '';
        const loginUrl = options.loginUrl || '';

        const ctaHtml = loginUrl ? `<p style="text-align:center; margin: 30px 0;"><a href="${loginUrl}" style="background-color:#3490dc;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">Go to IT Support</a></p>` : `<p style="color:#4a5568; text-align:center;">You can login using your email and password.</p>`;

        // Role-specific dashboard highlights (English-only)
        const roleKey = (role || '').toString().toLowerCase();
        let roleSection = '';
        if (roleKey.includes('ticket')) {
            roleSection = `
                <h3 style="color:#2d3748; margin-top:0;">What you can do right away</h3>
                <ul style="color:#4a5568; list-style-type:disc; padding-left:20px;">
                    <li style="margin-bottom:8px;">Quickly create and manage support tickets.</li>
                    <li style="margin-bottom:8px;">Filter tickets by Category, Assigned To, and Date.</li>
                    <li>Add comments and track the status of your tickets.</li>
                </ul>
            `;
        } else if (roleKey.includes('it team') || roleKey.includes('team member')) {
            roleSection = `
                <h3 style="color:#2d3748; margin-top:0;">What you can do right away</h3>
                <ul style="color:#4a5568; list-style-type:disc; padding-left:20px;">
                    <li style="margin-bottom:8px;">View and take ownership of tickets assigned to you.</li>
                    <li style="margin-bottom:8px;">Efficiently update ticket statuses and collaborate with users.</li>
                    <li>Add detailed comments and resolution notes to tickets.</li>
                </ul>
                <p style="color:#4a5568; margin-top:15px; font-style:italic;"><strong>Note:</strong> Remember to select and assign the appropriate category when working on a ticket.</p>
            `;
        } else if (roleKey.includes('it head') || roleKey.includes('head')) {
            roleSection = `
                <h3 style="color:#2d3748; margin-top:0;">What you can do right away</h3>
                <ul style="color:#4a5568; list-style-type:disc; padding-left:20px;">
                    <li style="margin-bottom:8px;">Gain a comprehensive overview of all tickets and team performance.</li>
                    <li style="margin-bottom:8px;">Oversee ticket progress, manage categories, and assign roles.</li>
                    <li>Add detailed comments and ticket progress tracked for auditing.</li>
                </ul>
            `;
        } else {
            roleSection = `
                <h3 style="color:#2d3748; margin-top:0;">User Dashboard</h3>
                <p style="color:#4a5568;">Utilize the system to efficiently create and track your support tickets. Please contact the IT team if you require further access or assistance.</p>
            `;
        }

        const welcomeTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid #1c3d82;">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">${(emailConfigApp.senderName||'IT').split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">IT Support System - Welcome</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">Hello, ${userName}!</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">We're excited to welcome you to our IT Support System! Your account has been successfully created with the role of <strong>${role}</strong>.</p>
                        ${categoriesHtml}
                        ${ctaHtml}

                        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:20px 25px; border-radius:10px; margin:30px 0;">
                            ${roleSection}
                        </div>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            Should you have any questions or require assistance, please do not hesitate to reply to this email or contact the IT Support Team directly.
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:#3490dc;text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated message from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const emailData = {
            to: to,
            toName: userName,
            subject: `Welcome to IT Support System - ${userName}`,
            body: welcomeTemplate,
            contentType: 'HTML'
        };

        return await this.sendEmailAsUser(emailData);
    }

    /**
     * Send password reset email
     * @param {string} to - Recipient email address
     * @param {string} userName - User's name
     * @param {string} resetLink - Password reset link with token
     * @param {Object} [options={}] - Additional options
     */
    async sendPasswordResetEmail(to, userName, resetLink, options = {}) {
        const resetTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, #dc2626 0%, #ef4444 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid #dc2626;">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 1l3 6 6 1-4.5 4 1 6L12 17l-5.5 3 1-6L3 9l6-1 3-6z" fill="currentColor"/>
                            </svg>
                        </div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">IT Support System - Password Reset</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">Password Reset Request</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">Hello <strong>${userName}</strong>,</p>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">We received a request to reset your password for the IT Support System. If you made this request, please click the button below to create a new password.</p>

                        <div style="background:#fef2f2; border:1px solid #fecaca; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <h4 style="color:#dc2626; margin:0; font-size:16px; font-weight:600;">Security Notice</h4>
                            </div>
                            <p style="color:#dc2626; margin:0; font-size:14px;">This password reset link will expire in <strong>1 hour</strong> for security reasons.</p>
                        </div>

                        <p style="text-align:center; margin:30px 0;">
                            <a href="${resetLink}" style="background-color:#dc2626;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">Reset My Password</a>
                        </p>

                        <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:20px 25px; border-radius:10px; margin:30px 0;">
                            <h3 style="color:#2d3748; margin:0 0 10px 0; font-size:16px;">Can't click the button above?</h3>
                            <p style="color:#4a5568; margin:0 0 10px 0; font-size:14px;">Copy and paste this link into your browser:</p>
                            <p style="word-break:break-all; background-color:#f1f5f9; padding:12px; border-radius:6px; font-family:monospace; font-size:13px; color:#1e293b; margin:0;">${resetLink}</p>
                        </div>

                        <div style="background:#fef9c3; border:1px solid #fde047; padding:20px 25px; border-radius:10px; margin:30px 0;">
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" stroke="#d97706" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                                <h4 style="color:#d97706; margin:0; font-size:16px; font-weight:600;">Didn't request this?</h4>
                            </div>
                            <p style="color:#d97706; margin:0; font-size:14px;">If you did not request a password reset, please ignore this email. Your password will remain unchanged and your account is secure.</p>
                        </div>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            If you have any concerns about your account security or need assistance, please contact the IT Support Team immediately.
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:#dc2626;text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated security message from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const emailData = {
            to: to,
            toName: userName,
            subject: `IT Support System - Password Reset Request`,
            body: resetTemplate,
            contentType: 'HTML'
        };

        return await this.sendEmailAsUser(emailData);
    }

    /**
     * Send ticket creation notification email to team members in the specific category and IT head
     * @param {Object} ticketData - Ticket information
     * @param {Array} categoryTeamMembers - Array of team member objects who work on this specific category
     * @param {string} itHeadEmail - Email of the IT head
     */
    async sendTicketCreationEmail(ticketData, categoryTeamMembers, itHeadEmail) {
        const {
            ticketId,
            category,
            assignedTeam,
            requesterName,
            requesterContact,
            requesterDepartment,
            requesterCompany,
            issueType,
            assignedTo,
            assignedDate,
            createdDate,
            lastUpdated,
            title,
            description,
            priority = 'Medium'
        } = ticketData;

        // Email template for assigned team member
        const assigneeTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, #059669 0%, #10b981 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid #047857;">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">New Ticket Assignment</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">New Ticket in Your Category</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">A new support ticket has been created in your category (${category}). Please review the details below. The ticket is assigned to <strong>${assignedTo}</strong>.</p>

                        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h3 style="color:#065f46; margin:0 0 15px 0; font-size:18px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#065f46" stroke-width="1.5"/>
                                </svg>
                                Ticket Information
                            </h3>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; color:#065f46;">
                                <div><strong>Ticket ID:</strong> ${ticketId}</div>
                                <div><strong>Category:</strong> ${category}</div>
                                <div><strong>Priority:</strong> <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:4px; font-size:12px;">${priority}</span></div>
                                <div><strong>Issue Type:</strong> ${issueType}</div>
                                <div><strong>Assigned Team:</strong> ${assignedTeam}</div>
                                <div><strong>Assigned To:</strong> ${assignedTo}</div>
                            </div>
                        </div>

                        <div style="background:#fef9c3; border:1px solid #fde047; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#92400e; margin:0 0 10px 0; font-size:16px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke="#92400e" stroke-width="1.5"/>
                                </svg>
                                Requester Information
                            </h4>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; color:#92400e; font-size:14px;">
                                <div><strong>Name:</strong> ${requesterName}</div>
                                <div><strong>Contact:</strong> ${requesterContact}</div>
                                <div><strong>Department:</strong> ${requesterDepartment}</div>
                                <div><strong>Company:</strong> ${requesterCompany}</div>
                            </div>
                        </div>

                        ${title ? `<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#2d3748; margin:0 0 10px 0; font-size:16px;">Issue Title:</h4>
                            <p style="color:#4a5568; margin:0; font-size:15px;">${title}</p>
                        </div>` : ''}

                        ${description ? `<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#2d3748; margin:0 0 10px 0; font-size:16px;">Description:</h4>
                            <p style="color:#4a5568; margin:0; font-size:14px; white-space:pre-wrap;">${description}</p>
                        </div>` : ''}

                        <div style="background:#e0f2fe; border:1px solid #81d4fa; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#0277bd; margin:0 0 10px 0; font-size:16px;">Timeline</h4>
                            <div style="color:#0277bd; font-size:14px;">
                                <div style="margin-bottom:5px;"><strong>📅 Created:</strong> ${createdDate}</div>
                                <div style="margin-bottom:5px;"><strong>📋 Assigned on:</strong> ${assignedDate}</div>
                                <div><strong>🕐 Last Updated:</strong> ${lastUpdated}</div>
                            </div>
                        </div>

                        <p style="text-align:center; margin:30px 0;">
                            <a href="${process.env.APP_URL || 'http://localhost:3000'}/tickets/${ticketId}" style="background-color:#059669;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">View Ticket Details</a>
                        </p>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            Please review this ticket and update its status accordingly. If you need any clarification, contact the requester directly or reach out to the IT Support Team.
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:#059669;text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated message from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Email template for IT Head
        const itHeadTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid #1e3a8a;">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2l3 6 6 1-4.5 4 1 6L12 17l-5.5 3 1-6L3 9l6-1 3-6z" fill="currentColor"/>
                            </svg>
                        </div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">New Ticket Created - IT Head Notification</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">New Ticket Created</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">A new support ticket has been created and assigned. This is for your oversight and tracking purposes.</p>

                        <div style="background:#eff6ff; border:1px solid #bfdbfe; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h3 style="color:#1e40af; margin:0 0 15px 0; font-size:18px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#1e40af" stroke-width="1.5"/>
                                </svg>
                                Ticket Summary
                            </h3>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; color:#1e40af;">
                                <div><strong>Ticket ID:</strong> ${ticketId}</div>
                                <div><strong>Category:</strong> ${category}</div>
                                <div><strong>Priority:</strong> <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:4px; font-size:12px;">${priority}</span></div>
                                <div><strong>Issue Type:</strong> ${issueType}</div>
                                <div><strong>Assigned Team:</strong> ${assignedTeam}</div>
                                <div><strong>Assigned To:</strong> ${assignedTo}</div>
                            </div>
                        </div>

                        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#065f46; margin:0 0 10px 0; font-size:16px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke="#065f46" stroke-width="1.5"/>
                                </svg>
                                Requester Details
                            </h4>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; color:#065f46; font-size:14px;">
                                <div><strong>Name:</strong> ${requesterName}</div>
                                <div><strong>Contact:</strong> ${requesterContact}</div>
                                <div><strong>Department:</strong> ${requesterDepartment}</div>
                                <div><strong>Company:</strong> ${requesterCompany}</div>
                            </div>
                        </div>

                        <div style="background:#fef2f2; border:1px solid #fecaca; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#dc2626; margin:0 0 10px 0; font-size:16px;">Assignment Status</h4>
                            <p style="color:#dc2626; margin:0; font-size:14px;">
                                This ticket has been automatically assigned to <strong>${assignedTo}</strong> from the <strong>${assignedTeam}</strong> team based on the selected category.
                            </p>
                        </div>

                        <div style="background:#e0f2fe; border:1px solid #81d4fa; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#0277bd; margin:0 0 10px 0; font-size:16px;">Timeline</h4>
                            <div style="color:#0277bd; font-size:14px;">
                                <div style="margin-bottom:5px;"><strong>📅 Created:</strong> ${createdDate}</div>
                                <div style="margin-bottom:5px;"><strong>📋 Assigned on:</strong> ${assignedDate}</div>
                                <div><strong>🕐 Last Updated:</strong> ${lastUpdated}</div>
                            </div>
                        </div>

                        <p style="text-align:center; margin:30px 0;">
                            <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin/tickets" style="background-color:#1e40af;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">View All Tickets</a>
                        </p>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            This notification is sent for oversight and tracking purposes. The assigned team member has been notified separately.
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:#1e40af;text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated notification from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        try {
            // Send email to all team members in this category
            if (categoryTeamMembers && categoryTeamMembers.length > 0) {
                for (const teamMember of categoryTeamMembers) {
                    const memberEmailData = {
                        to: teamMember.email,
                        toName: teamMember.name,
                        subject: `New Ticket in ${category} - ${ticketId}`,
                        body: assigneeTemplate,
                        contentType: 'HTML'
                    };
                    await this.sendEmailAsUser(memberEmailData);
                    console.log(`📧 Ticket notification email sent to ${teamMember.name} (${teamMember.email})`);
                }
            }

            // Send email to IT Head
            if (itHeadEmail) {
                const itHeadEmailData = {
                    to: itHeadEmail,
                    toName: 'IT Head',
                    subject: `New Ticket Created - ${ticketId} (${category}) - Assigned to ${assignedTo}`,
                    body: itHeadTemplate,
                    contentType: 'HTML'
                };
                await this.sendEmailAsUser(itHeadEmailData);
                console.log(`📧 Ticket notification email sent to IT Head at ${itHeadEmail}`);
            }

            return {
                success: true,
                message: 'Ticket creation emails sent successfully'
            };

        } catch (error) {
            console.error('❌ Error sending ticket creation emails:', error);
            throw new Error(`Failed to send ticket creation emails: ${error.message}`);
        }
    }

    /**
     * Send ticket status update notification email
     * @param {Object} ticketData - Ticket information
     * @param {Array} categoryTeamMembers - Array of team member objects in the same category
     * @param {string} itHeadEmail - Email of the IT head
     * @param {string} ticketCreatorEmail - Email of the ticket creator
     * @param {string} previousStatus - The previous status of the ticket
     * @param {string} newStatus - The new status of the ticket
     * @param {string} updatedBy - Who updated the status
     */
    async sendTicketStatusUpdateEmail(ticketData, categoryTeamMembers, itHeadEmail, ticketCreatorEmail, previousStatus, newStatus, updatedBy) {
        const {
            ticketId,
            category,
            assignedTeam,
            requesterName,
            requesterContact,
            requesterDepartment,
            requesterCompany,
            issueType,
            assignedTo,
            createdDate,
            updatedDate,
            title,
            description,
            priority = 'Medium'
        } = ticketData;

        // Determine status color and icon based on new status
        let statusColor = '#6b7280';
        let statusIcon = '📋';
        let statusMessage = 'Status Updated';
        
        if (newStatus === 'PROCESSING') {
            statusColor = '#f59e0b';
            statusIcon = '⚡';
            statusMessage = 'Ticket In Progress';
        } else if (newStatus === 'COMPLETED') {
            statusColor = '#10b981';
            statusIcon = '✅';
            statusMessage = 'Ticket Completed';
        }

        // Email template for team members and IT head
        const statusUpdateTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, ${statusColor} 0%, ${statusColor}CC 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid ${statusColor};">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">
                            ${statusIcon}
                        </div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">${statusMessage}</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">Ticket Status Updated</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">The status of ticket <strong>${ticketId}</strong> has been updated from <strong style="color:#6b7280;">${previousStatus}</strong> to <strong style="color:${statusColor};">${newStatus}</strong>.</p>

                        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h3 style="color:#065f46; margin:0 0 15px 0; font-size:18px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="#065f46" stroke-width="1.5"/>
                                </svg>
                                Ticket Information
                            </h3>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; color:#065f46;">
                                <div><strong>Ticket ID:</strong> ${ticketId}</div>
                                <div><strong>Category:</strong> ${category}</div>
                                <div><strong>Status:</strong> <span style="background:${statusColor}22; color:${statusColor}; padding:2px 8px; border-radius:4px; font-size:12px;">${newStatus}</span></div>
                                <div><strong>Priority:</strong> <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:4px; font-size:12px;">${priority}</span></div>
                                <div><strong>Issue Type:</strong> ${issueType}</div>
                                <div><strong>Assigned To:</strong> ${assignedTo}</div>
                            </div>
                        </div>

                        <div style="background:#fef9c3; border:1px solid #fde047; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#92400e; margin:0 0 10px 0; font-size:16px; display:flex; align-items:center; gap:8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" stroke="#92400e" stroke-width="1.5"/>
                                </svg>
                                Requester Information
                            </h4>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; color:#92400e; font-size:14px;">
                                <div><strong>Name:</strong> ${requesterName}</div>
                                <div><strong>Contact:</strong> ${requesterContact}</div>
                                <div><strong>Department:</strong> ${requesterDepartment}</div>
                                <div><strong>Company:</strong> ${requesterCompany}</div>
                            </div>
                        </div>

                        <div style="background:#e0f2fe; border:1px solid #81d4fa; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#0277bd; margin:0 0 10px 0; font-size:16px;">Update Details</h4>
                            <div style="color:#0277bd; font-size:14px;">
                                <div style="margin-bottom:5px;"><strong>📅 Created:</strong> ${createdDate}</div>
                                <div style="margin-bottom:5px;"><strong>🔄 Updated:</strong> ${updatedDate}</div>
                                <div style="margin-bottom:5px;"><strong>👤 Updated by:</strong> ${updatedBy}</div>
                                <div><strong>📊 Status Change:</strong> ${previousStatus} → ${newStatus}</div>
                            </div>
                        </div>

                        ${description ? `<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#2d3748; margin:0 0 10px 0; font-size:16px;">Description:</h4>
                            <p style="color:#4a5568; margin:0; font-size:14px; white-space:pre-wrap;">${description}</p>
                        </div>` : ''}

                        <p style="text-align:center; margin:30px 0;">
                            <a href="${process.env.APP_URL || 'http://localhost:3000'}/tickets/${ticketId}" style="background-color:${statusColor};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">View Ticket Details</a>
                        </p>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            ${newStatus === 'COMPLETED' ? 'This ticket has been marked as completed. Please review if further action is needed.' : 'Please review the updated ticket status and take any necessary action.'}
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:${statusColor};text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated notification from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Email template for ticket creator (more user-friendly)
        const creatorTemplate = `
            <div style="font-family: 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f0f2f5; padding:30px; line-height:1.6; color:#333;">
                <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,0.08); overflow:hidden; border:1px solid #e2e8f0;">
                    <div style="padding:25px 30px; background:linear-gradient(135deg, ${statusColor} 0%, ${statusColor}CC 100%); color:#ffffff; display:flex; align-items:center; gap:15px; border-bottom:1px solid ${statusColor};">
                        <div style="width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px; flex-shrink:0;">
                            ${statusIcon}
                        </div>
                        <div>
                            <div style="font-size:18px;font-weight:700; line-height:1.2;">${emailConfigApp.senderName}</div>
                            <div style="font-size:13px;opacity:0.95; margin-top:2px;">Your Ticket Update</div>
                        </div>
                    </div>
                    <div style="padding:30px;">
                        <h2 style="color:#1a202c; margin:0 0 10px 0; font-size:26px; font-weight:700;">Your Ticket Has Been Updated</h2>
                        <p style="color:#4a5568; margin:0 0 20px 0; font-size:16px;">Hello <strong>${requesterName}</strong>, your support ticket <strong>${ticketId}</strong> status has been updated to <strong style="color:${statusColor};">${newStatus}</strong>.</p>

                        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h3 style="color:#065f46; margin:0 0 15px 0; font-size:18px;">Ticket Status</h3>
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; color:#065f46;">
                                <div><strong>Ticket ID:</strong> ${ticketId}</div>
                                <div><strong>Category:</strong> ${category}</div>
                                <div><strong>Current Status:</strong> <span style="background:${statusColor}22; color:${statusColor}; padding:2px 8px; border-radius:4px; font-size:12px;">${newStatus}</span></div>
                                <div><strong>Assigned To:</strong> ${assignedTo}</div>
                            </div>
                        </div>

                        ${newStatus === 'PROCESSING' ? `
                        <div style="background:#fef3c7; border:1px solid #fde047; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#92400e; margin:0 0 10px 0; font-size:16px;">⚡ Work In Progress</h4>
                            <p style="color:#92400e; margin:0; font-size:14px;">Our team is actively working on resolving your issue. We'll keep you updated on the progress.</p>
                        </div>
                        ` : ''}

                        ${newStatus === 'COMPLETED' ? `
                        <div style="background:#d1fae5; border:1px solid #a7f3d0; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#059669; margin:0 0 10px 0; font-size:16px;">✅ Issue Resolved</h4>
                            <p style="color:#059669; margin:0; font-size:14px;">Great news! Your ticket has been completed. If you have any concerns or the issue persists, please don't hesitate to contact us or create a new ticket.</p>
                        </div>
                        ` : ''}

                        <div style="background:#e0f2fe; border:1px solid #81d4fa; padding:20px 25px; border-radius:10px; margin:25px 0;">
                            <h4 style="color:#0277bd; margin:0 0 10px 0; font-size:16px;">Timeline</h4>
                            <div style="color:#0277bd; font-size:14px;">
                                <div style="margin-bottom:5px;"><strong>📅 Created:</strong> ${createdDate}</div>
                                <div style="margin-bottom:5px;"><strong>🔄 Last Updated:</strong> ${updatedDate}</div>
                                <div><strong>👤 Updated by:</strong> ${updatedBy}</div>
                            </div>
                        </div>

                        <p style="text-align:center; margin:30px 0;">
                            <a href="${process.env.APP_URL || 'http://localhost:3000'}/tickets/${ticketId}" style="background-color:${statusColor};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:16px;">View Your Ticket</a>
                        </p>

                        <p style="color:#64748b; margin-top:25px; font-size:14px; border-top:1px solid #edf2f7; padding-top:20px;">
                            Thank you for using our IT Support system. If you have any questions about this update, please reply to this email or contact our support team.
                        </p>
                        <div style="margin-top:25px; padding-top:20px; border-top:1px solid #eef2f7; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div style="font-size:13px;color:#718096;">
                                ${emailConfigApp.senderName} • <a href="mailto:${emailConfigApp.senderEmail}" style="color:${statusColor};text-decoration:none;">${emailConfigApp.senderEmail}</a>
                            </div>
                            <div style="font-size:12px;color:#9da9bb;">This is an automated notification from the IT Support System.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        try {
            const emailPromises = [];
            console.log(`📧 Starting email sending process for ticket status update...`);

            // Send email to other team members in the same category
            if (categoryTeamMembers && categoryTeamMembers.length > 0) {
                console.log(`👥 Sending emails to ${categoryTeamMembers.length} category team members:`);
                for (const teamMember of categoryTeamMembers) {
                    console.log(`   📤 Preparing email for ${teamMember.name} (${teamMember.email})`);
                    const memberEmailData = {
                        to: teamMember.email,
                        toName: teamMember.name,
                        subject: `Ticket Status Update - ${ticketId} (${newStatus})`,
                        body: statusUpdateTemplate,
                        contentType: 'HTML'
                    };
                    emailPromises.push(
                        this.sendEmailAsUser(memberEmailData).then(() => {
                            console.log(`✅ Status update email sent to team member ${teamMember.name} (${teamMember.email})`);
                        }).catch((err) => {
                            console.error(`❌ Failed to send email to team member ${teamMember.name} (${teamMember.email}):`, err.message);
                        })
                    );
                }
            } else {
                console.log(`ℹ️ No category team members to notify`);
            }

            // Send email to IT Head
            if (itHeadEmail) {
                console.log(`👑 Sending email to IT Head: ${itHeadEmail}`);
                const itHeadEmailData = {
                    to: itHeadEmail,
                    toName: 'IT Head',
                    subject: `Ticket Status Update - ${ticketId} (${category}) - ${newStatus}`,
                    body: statusUpdateTemplate,
                    contentType: 'HTML'
                };
                emailPromises.push(
                    this.sendEmailAsUser(itHeadEmailData).then(() => {
                        console.log(`✅ Status update email sent to IT Head at ${itHeadEmail}`);
                    }).catch((err) => {
                        console.error(`❌ Failed to send email to IT Head at ${itHeadEmail}:`, err.message);
                    })
                );
            } else {
                console.log(`ℹ️ No IT Head to notify`);
            }

            // Send email to ticket creator
            if (ticketCreatorEmail) {
                console.log(`📝 Sending email to ticket creator: ${ticketCreatorEmail}`);
                const creatorEmailData = {
                    to: ticketCreatorEmail,
                    toName: requesterName,
                    subject: `Your Ticket Update - ${ticketId} (${newStatus})`,
                    body: creatorTemplate,
                    contentType: 'HTML'
                };
                emailPromises.push(
                    this.sendEmailAsUser(creatorEmailData).then(() => {
                        console.log(`✅ Status update email sent to ticket creator at ${ticketCreatorEmail}`);
                    }).catch((err) => {
                        console.error(`❌ Failed to send email to ticket creator at ${ticketCreatorEmail}:`, err.message);
                    })
                );
            } else {
                console.log(`ℹ️ No ticket creator email to notify`);
            }

            // Wait for all emails to be sent
            console.log(`⏳ Waiting for ${emailPromises.length} emails to be sent...`);
            await Promise.all(emailPromises);
            console.log(`🎉 All status update emails completed!`);

            return {
                success: true,
                message: 'Ticket status update emails sent successfully'
            };

        } catch (error) {
            console.error('❌ Error sending ticket status update emails:', error);
            throw new Error(`Failed to send ticket status update emails: ${error.message}`);
        }
    }
}

module.exports = new EmailServiceApp();