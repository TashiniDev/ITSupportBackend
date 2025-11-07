/**
 * Email Configuration for Microsoft Graph API
 * This module contains configuration for connecting to Microsoft Outlook
 * using Microsoft Graph API with OAuth 2.0 authentication
 */

require('dotenv').config();

const emailConfig = {
    // Azure App Registration Details
    clientId: process.env.MICROSOFT_CLIENT_ID || '92b72dd5-08b9-4716-83ab-0fa62a48667a',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '1_B8Q~5vR9aMfHHyD7D8lrEVvOEWXT9tRpuaXagQ',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'f2a64dac-8104-4934-852c-7511fd38f730',
    
    // Redirect URI (should match Azure App Registration)
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/email/callback',
    
    // Microsoft Graph API Scopes - using specific delegated permissions
    scopes: [
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/User.Read',
        'offline_access'
    ],
    
    // Email sender details
    senderEmail: process.env.SENDER_EMAIL || 'tashini.m@printcare.lk',
    senderName: process.env.SENDER_NAME || 'IT Support Team',
    
    // Microsoft Graph API endpoints
    authority: function() {
        return `https://login.microsoftonline.com/${this.tenantId}`;
    },
    
    // MSAL Configuration for Public Client (User Authentication)
    publicClientConfig: function() {
        return {
            auth: {
                clientId: this.clientId,
                authority: this.authority(),
                redirectUri: this.redirectUri,
            },
        };
    },
    
    // MSAL Configuration for Confidential Client (App Authentication)
    confidentialClientConfig: function() {
        return {
            auth: {
                clientId: this.clientId,
                authority: this.authority(),
                clientSecret: this.clientSecret,
            },
        };
    },
    
    // Session configuration
    sessionConfig: {
        secret: process.env.SESSION_SECRET || 'your_session_secret_here',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }
};

module.exports = emailConfig;