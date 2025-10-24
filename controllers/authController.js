const { getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createTransport } = require('nodemailer');
const { randomUUID } = require('crypto');

// ✅ Configure Nodemailer for Gmail
const transporter = createTransport({
    service: 'gmail',
    auth: {
        user: '3treecrops2@gmail.com',
        pass: 'txjwjrctbiahfldg'
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

        // Send a simple registration confirmation email
        await transporter.sendMail({
            from: '"Printcare IT Supporter" <3treecrops2@gmail.com>',
            to: email,
            subject: 'Registration Successful',
            text: `Welcome ${name || ''}! Your account has been registered successfully.`,
            html: `<p>Welcome ${name || ''}!</p><p>Your account has been registered successfully.</p>`
        });

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
    const [rows] = await pool.query('SELECT uid, password FROM user WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid email or password' });

        const jwtToken = jwt.sign({ uid: user.uid, email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: 'Login successful',
            token: jwtToken,
            user: { uid: user.uid, email }
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

        await transporter.sendMail({
            from: '"Printcare IT Supporter" <3treecrops2@gmail.com>',
            to: email,
            subject: 'Password Reset Request',
            text: `Click the link below to reset your password:\n${resetLink}`,
            html: `<p>Click the link to reset your password: <a href="${resetLink}">${resetLink}</a></p>`
        });

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
