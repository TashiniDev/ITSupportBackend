/**
 * Alternative Email Configuration using Application Permissions
 * This approach uses client credentials flow which might work better
 */

require('dotenv').config();

const emailConfigApp = {
    // Azure App Registration Details
    clientId: process.env.MICROSOFT_CLIENT_ID || '92b72dd5-08b9-4716-83ab-0fa62a48667a',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '1_B8Q~5vR9aMfHHyD7D8lrEVvOEWXT9tRpuaXagQ',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'f2a64dac-8104-4934-852c-7511fd38f730',
    
    // For application permissions, we don't need a redirect URI
    // Microsoft Graph API Scopes for Application Permissions
    scopes: ['https://graph.microsoft.com/.default'],
    
    // Email sender details
    senderEmail: process.env.SENDER_EMAIL || 'tashini.m@printcare.lk',
    senderName: process.env.SENDER_NAME || 'IT Support Team',
    
    // Microsoft Graph API endpoints
    authority: function() {
        return `https://login.microsoftonline.com/${this.tenantId}`;
    },
    
    // MSAL Configuration for Confidential Client (Application-only Authentication)
    confidentialClientConfig: function() {
        return {
            auth: {
                clientId: this.clientId,
                authority: this.authority(),
                clientSecret: this.clientSecret,
            },
        };
    }
};

module.exports = emailConfigApp;