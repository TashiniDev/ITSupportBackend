/**
 * Email Service using Microsoft Graph API
 * This service handles authentication and email sending through Microsoft Outlook
 */

const { Client } = require('@microsoft/microsoft-graph-client');
const { PublicClientApplication, ConfidentialClientApplication } = require('@azure/msal-node');
const emailConfig = require('../config/emailConfig');

class EmailService {
    constructor() {
        // Initialize MSAL clients
        this.publicClientApp = new PublicClientApplication(emailConfig.publicClientConfig());
        this.confidentialClientApp = new ConfidentialClientApplication(emailConfig.confidentialClientConfig());
    }

    /**
     * Generate authentication URL for user login
     * @returns {Promise<string>} Authentication URL
     */
    async getAuthUrl() {
        try {
            const authCodeUrlParameters = {
                scopes: emailConfig.scopes,
                redirectUri: emailConfig.redirectUri,
            };

            const authUrl = await this.publicClientApp.getAuthCodeUrl(authCodeUrlParameters);
            return authUrl;
        } catch (error) {
            console.error('Error generating auth URL:', error);
            throw new Error('Failed to generate authentication URL');
        }
    }

    /**
     * Acquire user access token using authorization code
     * @param {string} authCode - Authorization code from redirect
     * @returns {Promise<string>} Access token
     */
    async acquireUserToken(authCode) {
        try {
            const tokenRequest = {
                code: authCode,
                scopes: emailConfig.scopes,
                redirectUri: emailConfig.redirectUri,
                clientSecret: emailConfig.clientSecret,
            };

            const response = await this.publicClientApp.acquireTokenByCode(tokenRequest);
            return response.accessToken;
        } catch (error) {
            console.error('Error acquiring user token:', error);
            throw new Error('Failed to acquire user access token');
        }
    }

    /**
     * Acquire client access token (application-only)
     * @returns {Promise<string>} Client access token
     */
    async acquireClientToken() {
        try {
            const tokenRequest = {
                scopes: emailConfig.scopes,
                clientSecret: emailConfig.clientSecret,
            };

            const response = await this.confidentialClientApp.acquireTokenByClientCredential(tokenRequest);
            return response.accessToken;
        } catch (error) {
            console.error('Error acquiring client token:', error);
            throw new Error('Failed to acquire client access token');
        }
    }

    /**
     * Create Microsoft Graph client with access token
     * @param {string} accessToken - Access token for authentication
     * @returns {Client} Microsoft Graph client
     */
    createGraphClient(accessToken) {
        return Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            },
        });
    }

    /**
     * Send email using Microsoft Graph API
     * @param {string} accessToken - User access token
     * @param {Object} emailData - Email data object
     * @param {string} emailData.to - Recipient email address
     * @param {string} emailData.subject - Email subject
     * @param {string} emailData.body - Email body content
     * @param {string} [emailData.contentType='Text'] - Content type (Text or HTML)
     * @param {Array} [emailData.attachments] - Email attachments
     * @returns {Promise<Object>} Send result
     */
    async sendEmail(accessToken, emailData) {
        try {
            const client = this.createGraphClient(accessToken);

            // Prepare email message
            const message = {
                subject: emailData.subject,
                body: {
                    contentType: emailData.contentType || 'Text',
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
                        address: emailConfig.senderEmail,
                        name: emailConfig.senderName
                    }
                }
            };

            // Add CC recipients if provided
            if (emailData.cc && emailData.cc.length > 0) {
                message.ccRecipients = emailData.cc.map(email => ({
                    emailAddress: {
                        address: email,
                        name: email
                    }
                }));
            }

            // Add BCC recipients if provided
            if (emailData.bcc && emailData.bcc.length > 0) {
                message.bccRecipients = emailData.bcc.map(email => ({
                    emailAddress: {
                        address: email,
                        name: email
                    }
                }));
            }

            // Add attachments if provided
            if (emailData.attachments && emailData.attachments.length > 0) {
                message.attachments = emailData.attachments.map(attachment => ({
                    '@odata.type': '#microsoft.graph.fileAttachment',
                    name: attachment.name,
                    contentType: attachment.contentType || 'application/octet-stream',
                    contentBytes: attachment.contentBytes // Base64 encoded content
                }));
            }

            const sendMailData = {
                message: message,
                saveToSentItems: emailData.saveToSentItems !== false // Default to true
            };

            // Send the email
            const response = await client.api('/me/sendMail').post(sendMailData);
            
            return {
                success: true,
                message: 'Email sent successfully',
                response: response
            };

        } catch (error) {
            console.error('Error sending email:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    /**
     * Get user's email messages
     * @param {string} accessToken - User access token
     * @param {number} [count=10] - Number of messages to retrieve
     * @returns {Promise<Array>} Array of email messages
     */
    async getEmails(accessToken, count = 10) {
        try {
            const client = this.createGraphClient(accessToken);
            const messages = await client.api('/me/messages').top(count).get();
            return messages.value || [];
        } catch (error) {
            console.error('Error fetching emails:', error);
            throw new Error(`Failed to fetch emails: ${error.message}`);
        }
    }

    /**
     * Send email with template support
     * @param {string} accessToken - User access token
     * @param {string} template - Email template name
     * @param {Object} data - Template data and email configuration
     * @returns {Promise<Object>} Send result
     */
    async sendTemplateEmail(accessToken, template, data) {
        try {
            let emailContent = this.getEmailTemplate(template, data);
            
            const emailData = {
                to: data.to,
                toName: data.toName,
                subject: emailContent.subject,
                body: emailContent.body,
                contentType: 'HTML',
                cc: data.cc,
                bcc: data.bcc,
                attachments: data.attachments
            };

            return await this.sendEmail(accessToken, emailData);
        } catch (error) {
            console.error('Error sending template email:', error);
            throw new Error(`Failed to send template email: ${error.message}`);
        }
    }

    /**
     * Get email templates (can be expanded to load from files or database)
     * @param {string} template - Template name
     * @param {Object} data - Template data
     * @returns {Object} Email content with subject and body
     */
    getEmailTemplate(template, data) {
        const templates = {
            'ticket-created': {
                subject: `IT Support Ticket #${data.ticketId || 'N/A'} - ${data.title || 'New Ticket'}`,
                body: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50;">IT Support Ticket Created</h2>
                        <p>Dear ${data.userName || 'User'},</p>
                        <p>Your IT support ticket has been created successfully.</p>
                        
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #495057;">Ticket Details:</h3>
                            <p><strong>Ticket ID:</strong> #${data.ticketId || 'N/A'}</p>
                            <p><strong>Title:</strong> ${data.title || 'N/A'}</p>
                            <p><strong>Priority:</strong> ${data.priority || 'N/A'}</p>
                            <p><strong>Status:</strong> ${data.status || 'Open'}</p>
                            <p><strong>Created:</strong> ${data.createdAt || new Date().toLocaleString()}</p>
                        </div>
                        
                        <p>We will review your ticket and respond within our standard response time.</p>
                        
                        <p>Best regards,<br>
                        <strong>${emailConfig.senderName}</strong></p>
                    </div>
                `
            },
            'ticket-updated': {
                subject: `IT Support Ticket #${data.ticketId || 'N/A'} - Status Updated`,
                body: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50;">Ticket Status Updated</h2>
                        <p>Dear ${data.userName || 'User'},</p>
                        <p>Your IT support ticket has been updated.</p>
                        
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #495057;">Updated Details:</h3>
                            <p><strong>Ticket ID:</strong> #${data.ticketId || 'N/A'}</p>
                            <p><strong>New Status:</strong> ${data.status || 'N/A'}</p>
                            <p><strong>Updated By:</strong> ${data.updatedBy || 'System'}</p>
                            <p><strong>Update Time:</strong> ${data.updatedAt || new Date().toLocaleString()}</p>
                        </div>
                        
                        ${data.comments ? `<div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <h4 style="margin-top: 0; color: #1976d2;">Comments:</h4>
                            <p>${data.comments}</p>
                        </div>` : ''}
                        
                        <p>Best regards,<br>
                        <strong>${emailConfig.senderName}</strong></p>
                    </div>
                `
            },
            'welcome': {
                subject: `Welcome to IT Support System - ${data.userName || 'User'}`,
                body: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50;">Welcome to IT Support System</h2>
                        <p>Dear ${data.userName || 'User'},</p>
                        <p>Welcome to our IT Support System! Your account has been created successfully.</p>
                        
                        <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
                            <h3 style="margin-top: 0; color: #155724;">Getting Started:</h3>
                            <ul style="color: #155724;">
                                <li>You can now create and track support tickets</li>
                                <li>Access your account using your email address</li>
                                <li>Check ticket status and history anytime</li>
                            </ul>
                        </div>
                        
                        <p>If you have any questions, please don't hesitate to contact us.</p>
                        
                        <p>Best regards,<br>
                        <strong>${emailConfig.senderName}</strong></p>
                    </div>
                `
            }
        };

        return templates[template] || {
            subject: data.subject || 'IT Support Notification',
            body: data.body || 'This is a notification from IT Support System.'
        };
    }
}

module.exports = new EmailService();