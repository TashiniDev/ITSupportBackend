/**
 * Test endpoint for debugging email functionality
 * This endpoint can be used to test if email service is working
 */

const emailServiceApp = require('../services/emailServiceApp');

exports.testEmailService = async (req, res) => {
    try {
        console.log('🧪 Testing email service...');
        
        // Test with a simple email - use sender email from environment
        const testEmailData = {
            to: process.env.SENDER_EMAIL, // Use configured sender email for testing
            toName: 'Test User',
            subject: 'Email Service Test',
            body: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Email Service Test</h2>
                    <p>This is a test email to verify the email service is working.</p>
                    <p>Timestamp: ${new Date().toISOString()}</p>
                </div>
            `,
            contentType: 'HTML'
        };

        await emailServiceApp.sendEmailAsUser(testEmailData);
        
        res.status(200).json({
            success: true,
            message: 'Test email sent successfully'
        });
        
    } catch (error) {
        console.error('❌ Email service test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Email service test failed',
            error: error.message
        });
    }
};

exports.testStatusUpdateEmail = async (req, res) => {
    try {
        console.log('🧪 Testing status update email...');
        
        // Mock ticket data for testing
        const mockTicketData = {
            ticketId: 'TK-2025-001',
            category: 'IT Support',
            assignedTeam: 'IT Support',
            requesterName: 'Test User',
            requesterContact: '+94123456789',
            requesterEmail: 'testuser@example.com',
            issueType: 'Hardware Issue',
            assignedTo: 'John Doe',
            createdDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
            updatedDate: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
            title: 'Test Ticket',
            description: 'This is a test ticket for email functionality',
            severityLevel: 'MEDIUM'
        };

        const mockTeamMembers = [
            { email: process.env.SENDER_EMAIL, name: 'Test Team Member' }
        ];

        await emailServiceApp.sendTicketStatusUpdateEmail(
            mockTicketData,
            mockTeamMembers,
            process.env.SENDER_EMAIL, // IT Head
            process.env.SENDER_EMAIL, // Ticket creator
            'NEW',
            'PROCESSING',
            'Test System'
        );
        
        res.status(200).json({
            success: true,
            message: 'Test status update emails sent successfully'
        });
        
    } catch (error) {
        console.error('❌ Status update email test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Status update email test failed',
            error: error.message
        });
    }
};