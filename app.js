const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const session = require('express-session');
const path = require('path'); // Import the path module

// Load and validate environment variables
dotenv.config();
// Validate all required environment variables (if validateEnv.js exists)
require('./config/validateEnv');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const lookupsRoutes = require('./routes/lookupsRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const emailRoutes = require('./routes/emailRoutes');
const emailTestRoutes = require('./routes/emailTestRoutes');
const { init } = require('./config/db'); // Import DB initialization function
const emailConfig = require('./config/emailConfig'); // Import email configuration

const app = express();

// Simple request logger to help debug routing issues
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} -> ${req.method} ${req.originalUrl}`);
    next();
});

// --- Global Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(bodyParser.json()); // Parse JSON request bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded request bodies

// Session middleware for email authentication (use only if necessary and configured)
// Ensure your sessionConfig is properly set up for production.
app.use(session(emailConfig.sessionConfig));

// Optional JWT token decode middleware: Decodes JWT from Authorization header and attaches to req.user
const jwt = require('jsonwebtoken'); // Import jsonwebtoken library
app.use((req, res, next) => {
    const authHeader = req.header('Authorization') || req.header('authorization');
    if (!authHeader) return next(); // If no Authorization header, proceed to the next middleware
    const token = authHeader.replace('Bearer ', ''); // Remove "Bearer " prefix
    try {
        // Ensure JWT_SECRET is defined in your .env file
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach the decoded payload to req.user
    } catch (err) {
        // Ignore invalid token here; protected routes should use dedicated authMiddleware if needed.
    }
    return next(); // Proceed to the next middleware
});

// --- API Routes ---
// These routes must be defined BEFORE any static file serving or catch-all frontend routes.
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/lookups', lookupsRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/email-test', emailTestRoutes);

// Debug endpoint: Returns effective environment values for quick verification
app.get('/api/debug/env', (req, res) => {
    res.json({
        APP_URL: process.env.APP_URL || null,
        PORT: process.env.PORT || null,
        JWT_SECRET_PRESENT: !!process.env.JWT_SECRET, // Check if JWT_SECRET is present
        PID: process.pid // Node.js process ID
    });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); 

// --- Static Files and Frontend (React App) Serving ---

// Serve static files from the React app's 'build' directory
// IMPORTANT: Ensure your React project's 'build' folder is copied into the root
// of this Node.js server project (where server.js resides).
app.use(express.static(path.join(__dirname, 'build')));

// Ensure a favicon is served for requests that open raw files (e.g. /uploads/xxx)
// Browsers will request /favicon.ico when opening a direct file URL — redirect/serve
// the app's help-desk icon so attachment-only pages show the correct favicon.
app.get('/favicon.ico', (req, res) => {
    return res.sendFile(path.join(__dirname, 'build', 'help-desk-icon-8.ico'));
});

// Simple server-side reset-password page (fallback)
// If your frontend doesn't implement a /reset-password page, users can use this
// HTML page (reached from an emailed link) to set a new password.
// This route should come AFTER static files but BEFORE the catch-all frontend route.
app.get('/reset-password', (req, res) => {
    const token = req.query.token || ''; // Get the token from the URL query
    res.send(`<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>Reset Password</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>body{font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:20px} .card{max-width:420px;margin:40px auto;padding:20px;background:#fff;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.08)} input{width:100%;padding:10px;margin:8px 0;border:1px solid #d1d5db;border-radius:6px} button{background:#2563eb;color:#fff;padding:10px 14px;border:none;border-radius:6px;cursor:pointer} .msg{margin-top:12px}</style>
    </head>
    <body>
        <div class="card">
            <h2>Reset your password</h2>
            <p>Enter a new password for your account.</p>
            <input id="password" type="password" placeholder="New password (min 8, uppercase, lowercase, number, special char)" />
            <button id="submit">Set new password</button>
            <div class="msg" id="msg"></div>
        </div>
            <script>
                const token = '${token}';
            document.getElementById('submit').addEventListener('click', async () => {
                const pw = document.getElementById('password').value;
                if (!pw || pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw) || !/[!@#$%^&*]/.test(pw)) {
                    document.getElementById('msg').innerText = 'Password must contain: 8+ characters, uppercase, lowercase, number, and special character.';
                    return;
                }
                try {
                    const res = await fetch('/api/auth/reset-password', { // Send POST request to API endpoint
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, password: pw })
                    });
                    const data = await res.json(); // Parse API response as JSON
                    if (res.ok) { // If status code is 200-299
                        document.getElementById('msg').innerText = data.message || 'Password reset successfully. You can now login.';
                    } else { // For other status codes (e.g., 400, 401, 500)
                        document.getElementById('msg').innerText = data.message || JSON.stringify(data);
                    }
                } catch (err) {
                    document.getElementById('msg').innerText = 'Network error: ' + err.message;
                }
            });
        </script>
    </body>
</html>`);
});

// Catch-all middleware for the React frontend (Single Page Application - SPA)
// This should come AFTER all API routes, static file serving, and specific server-side HTML routes.
// Use middleware instead of app.get('*', ...) to avoid path-to-regexp issues in some environments.
app.use((req, res, next) => {
    // If the request looks like an API request or is for a static file, skip this middleware
    if (req.originalUrl.startsWith('/api') || req.originalUrl.includes('.')) return next();
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// --- Error Handling ---

// 404 Not Found Handler: Catches any requests that haven't been handled by previous routes.
// This must be placed BEFORE the global error handler.
app.use((req, res, next) => {
    // If it's an API request that wasn't matched by any API routes, return a JSON 404.
    if (req.originalUrl.startsWith('/api')) {
        return res.status(404).json({ message: `API endpoint '${req.originalUrl}' not found.` });
    }
    // For any other unmatched requests, return a generic JSON 404.
    // (Note: For frontend routes, app.get('*') should have handled it by serving index.html)
    res.status(404).json({ message: `Resource '${req.originalUrl}' not found.` });
});

// Global Error Handler: Catches all unhandled errors that occur in the application.
// This must always be placed at the very end of your middleware chain.
app.use((err, req, res, next) => {
    console.error(err.stack); // Log the error stack to the server console for debugging
    res.status(500).json({ message: 'An unexpected server error occurred', error: err.message });
});

// --- Server Start with DB Initialization ---
const PORT = process.env.PORT || 3000; // Use PORT from .env file, or default to 3000

// Initialize the database, then start the server upon successful initialization
init().then(() => {
    // Explicitly bind to '0.0.0.0' so the server is reachable via the host machine's actual IP address.
    // (Some environments/networks might only resolve 'localhost' by default if not specified.)
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on 0.0.0.0:${PORT}`));
}).catch(err => {
    console.error('Failed to initialize database:', err); // Log DB initialization failure and exit the process
    process.exit(1);
});