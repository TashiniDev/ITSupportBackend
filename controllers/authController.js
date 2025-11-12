const { getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const emailServiceApp = require('../services/emailServiceApp');

// Note: Microsoft Graph API email service using Application Permissions
// No user authentication required - uses client credentials flow 
exports.register = async (req, res) => {
    const { email: rawEmail, password, name, role, category } = req.body;
    const email = rawEmail && typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;

    try {
        // Check if user exists
    const pool = getPool();
    const [rows] = await pool.query('SELECT id FROM user WHERE LOWER(email) = LOWER(?)', [email]);
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
    // store emails normalized to lower-case to avoid case-sensitivity issues
    await pool.query('INSERT INTO user (name, uid, email, password, roleId, categoryId, CreatedBy, UpdatedBy, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [name, uid, email, hashed, roleId, categoryId, actor, actor, true]);

        // Send registration confirmation email using Microsoft Graph API (Application Permissions)
        try {
            console.log(`✅ User registration successful for ${email}`);

            // Resolve friendly role/category names when available so the welcome email
            // can include a human-readable role and assigned categories.
            let roleName = 'User';
            let categoryNames = [];
            if (roleId) {
                try {
                    const [r] = await pool.query('SELECT Name FROM role WHERE Id = ?', [roleId]);
                    if (r && r.length) roleName = r[0].Name;
                } catch (e) {
                    console.warn('Could not resolve role name for roleId', roleId, e.message || e);
                }
            }
            if (categoryId) {
                try {
                    const [c] = await pool.query('SELECT Name FROM category WHERE Id = ?', [categoryId]);
                    if (c && c.length) categoryNames.push(c[0].Name);
                } catch (e) {
                    console.warn('Could not resolve category name for categoryId', categoryId, e.message || e);
                }
            }

            // Send welcome email using application permissions (no interactive auth required)
            // Ensure fallback uses the requested IP:port 10.1.1.57:3001
            const loginUrl = `${process.env.APP_URL || 'http://10.1.1.57:3001'}/login`;
            await emailServiceApp.sendWelcomeEmail(email, name || 'User', { role: roleName, categories: categoryNames, loginUrl });
            console.log(`📧 Welcome email sent successfully to ${email} from tashini.m@printcare.lk`);

        } catch (emailError) {
            console.error(`📧 Failed to send registration email to ${email}:`, emailError.message);
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
    const { email: rawEmail, password } = req.body;
    const email = rawEmail && typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;

    try {
    const pool = getPool();
    // Include roleId and name in the select so we can add the user's role and name to the JWT
    // Use case-insensitive match for email
    const [rows] = await pool.query('SELECT uid, password, roleId, name FROM user WHERE LOWER(email) = LOWER(?)', [email]);
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
    const { email: rawEmail } = req.body;
    const email = rawEmail && typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;

    try {
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const pool = getPool();
        // Check if user exists and get user details
        const [rows] = await pool.query('SELECT uid, name FROM user WHERE LOWER(email) = LOWER(?)', [email]);
        if (rows.length === 0) {
            console.log(`� ForgotPassword: email not found: ${email}`);
            return res.status(400).json({ message: 'Email not found' });
        }

        const user = rows[0];
        const userName = user.name || 'User';

        // Generate password reset token (JWT short lived)
        const resetToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        // Ensure reset link uses the requested IP:port 10.1.1.57:3001 by default
        const resetLink = `${process.env.APP_URL || 'http://10.1.1.57:3001'}/reset-password?token=${resetToken}`;
        console.log(`✉️  ForgotPassword: generated reset token for ${email} (len=${resetToken.length})`);

        try {
            // Send password reset email using Microsoft Graph API (Application Permissions)
            await emailServiceApp.sendPasswordResetEmail(email, userName, resetLink);
            console.log(`📧 Password reset email sent successfully to ${email}`);
        } catch (emailError) {
            console.error(`📧 Failed to send password reset email to ${email}:`, emailError.message);
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
    const [rows] = await pool.query('SELECT id FROM user WHERE LOWER(email) = LOWER(?)', [email]);
        if (rows.length === 0) return res.status(400).json({ message: 'User not found' });

        const hashed = await bcrypt.hash(password, 10);
    // When resetting via token, set UpdatedBy to the user's email (self-service reset)
    // Update using case-insensitive match and set UpdatedBy to user's email
    await pool.query('UPDATE user SET password = ?, UpdatedBy = ? WHERE LOWER(email) = LOWER(?)', [hashed, email, email]);

        res.status(200).json({ message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Failed to reset password', error: error.message });
    }
};
