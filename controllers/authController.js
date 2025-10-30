const { getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createTransport } = require('nodemailer');
const { randomUUID } = require('crypto');

// ✅ Configure Nodemailer for Gmail with better compatibility
const transporter = createTransport({
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
exports.register = async (req, res) => {
    const { email, password, name, role, category } = req.body;

    try {
        // Check if user exists
    const pool = getPool();
    const [rows] = await pool.query('SELECT id FROM user WHERE email = ?', [email]);
        if (rows.length > 0) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const uid = randomUUID();

        // Accept role and category IDs directly from frontend (coerce to Number or null)
        let roleId = null;
        if (role !== undefined && role !== null && role !== '') {
            const parsed = Number(role);
            roleId = Number.isNaN(parsed) ? null : parsed;
        }

        let categoryId = null;
        if (category !== undefined && category !== null && category !== '') {
            const parsed = Number(category);
            categoryId = Number.isNaN(parsed) ? null : parsed;
        }

    // Determine actor for audit columns (if request carried a token and user was decoded)
    const actor = req.user && req.user.uid ? req.user.uid : null;

    // Insert user with audit columns (CreatedBy, UpdatedBy, IsActive). CreatedDate/UpdatedDate handled by DB defaults.
    await pool.query('INSERT INTO user (name, uid, email, password, roleId, categoryId, CreatedBy, UpdatedBy, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [name, uid, email, hashed, roleId, categoryId, actor, actor, true]);

        // Send registration confirmation email
        try {
            await transporter.sendMail({
            from: '"IT Support System" <3treecrops2@gmail.com>',
            to: email,
            subject: 'Welcome to IT Support System - Registration Successful',
            text: `Welcome ${name || ''}!\n\nYour account has been registered successfully in the IT Support System.\n\nYou can now log in using your email address and password.\n\nBest regards,\nIT Support Team`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <h2 style="color: #2c5aa0; text-align: center;">Welcome to IT Support System</h2>
                    <p>Hello <strong>${name || 'User'}</strong>,</p>
                    <p>Your account has been successfully registered in the IT Support System.</p>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #495057; margin-top: 0;">Account Details:</h3>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Name:</strong> ${name || 'Not provided'}</p>
                    </div>
                    <p>You can now log in to the system using your email address and password.</p>
                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                        <p style="color: #6c757d; margin: 0;">Best regards,<br>IT Support Team</p>
                        <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">This is an automated message from the IT Support System.</p>
                    </div>
                </div>
            `
            });
            console.log(`Registration confirmation email sent successfully to ${email}`);
        } catch (emailError) {
            console.error(`Failed to send registration email to ${email}:`, emailError.message);
            // Don't fail registration if email fails
        }

        res.status(201).json({
            message: 'User registered successfully. Verification email sent.',
            uid,
            user: { username: name, email }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(400).json({
            message: 'Error creating user',
            error: error.message
        });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
    const pool = getPool();
    // Include roleId and name in the select so we can add the user's role and name to the JWT
    const [rows] = await pool.query('SELECT uid, password, roleId, name FROM user WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid email or password' });

        // Add roleId and name to the token payload so frontend / downstream services can use them
        const jwtToken = jwt.sign({ uid: user.uid, email, roleId: user.roleId, name: user.name }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: 'Login successful',
            token: jwtToken,
            user: { uid: user.uid, email, name: user.name, roleId: user.roleId }
        });
    } catch (error) {
        res.status(400).json({
            message: 'Invalid email or password',
            error: error.message || 'Authentication failed'
        });
    }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        const pool = getPool();
        // Check if user exists
        const [rows] = await pool.query('SELECT uid FROM user WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(400).json({ message: 'Email not found' });

        // Generate password reset token (JWT short lived)
        const resetToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const resetLink = `${process.env.APP_URL || 'http://localhost:3001'}/reset-password?token=${resetToken}`;

        try {
            await transporter.sendMail({
            from: '"IT Support System" <3treecrops2@gmail.com>',
            to: email,
            subject: 'IT Support System - Password Reset Request',
            text: `You have requested to reset your password for the IT Support System.\n\nClick the link below to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request this password reset, please ignore this email.\n\nBest regards,\nIT Support Team`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <h2 style="color: #2c5aa0; text-align: center;">Password Reset Request</h2>
                    <p>Hello,</p>
                    <p>You have requested to reset your password for the IT Support System.</p>
                    <div style="background-color: #fff3cd; padding: 15px; border: 1px solid #ffeaa7; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 0; color: #856404;"><strong>Important:</strong> This password reset link will expire in 1 hour.</p>
                    </div>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background-color: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
                    </div>
                    <p>If you cannot click the button above, copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 3px; font-family: monospace;">${resetLink}</p>
                    <div style="background-color: #f8d7da; padding: 15px; border: 1px solid #f5c6cb; border-radius: 5px; margin: 20px 0;">
                        <p style="margin: 0; color: #721c24;"><strong>Security Notice:</strong> If you did not request this password reset, please ignore this email. Your password will remain unchanged.</p>
                    </div>
                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                        <p style="color: #6c757d; margin: 0;">Best regards,<br>IT Support Team</p>
                        <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">This is an automated message from the IT Support System.</p>
                    </div>
                </div>
            `
            });
            console.log(`Password reset email sent successfully to ${email}`);
        } catch (emailError) {
            console.error(`Failed to send password reset email to ${email}:`, emailError.message);
            return res.status(500).json({ message: 'Failed to send password reset email', error: emailError.message });
        }

        res.status(200).json({ message: 'Password reset link sent successfully!' });
    } catch (error) {
        console.error('Error sending password reset link:', error);
        res.status(400).json({ message: 'Failed to send password reset link', error: error.message });
    }
};

/**
 * Reset password endpoint
 * Expects JSON: { token, password }
 */
exports.resetPassword = async (req, res) => {
    const { token, password } = req.body;

    try {
        if (!token || !password) {
            return res.status(400).json({ message: 'Token and new password are required' });
        }

        // Verify token
        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        const email = payload.email;
        if (!email) return res.status(400).json({ message: 'Invalid token payload' });

    const pool = getPool();
    const [rows] = await pool.query('SELECT id FROM user WHERE email = ?', [email]);
        if (rows.length === 0) return res.status(400).json({ message: 'User not found' });

        const hashed = await bcrypt.hash(password, 10);
    // When resetting via token, set UpdatedBy to the user's email (self-service reset)
    await pool.query('UPDATE user SET password = ?, UpdatedBy = ? WHERE email = ?', [hashed, email, email]);

        res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Failed to reset password', error: error.message });
    }
};
