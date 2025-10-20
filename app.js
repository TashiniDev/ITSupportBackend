const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const { init } = require('./config/db');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Optional token decode middleware: if Authorization header present, decode JWT and attach req.user
const jwt = require('jsonwebtoken');
app.use((req, res, next) => {
    const authHeader = req.header('Authorization') || req.header('authorization');
    if (!authHeader) return next();
    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
    } catch (err) {
        // ignore invalid token here; protected routes still use authMiddleware if needed
    }
    return next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// Error handling (always at the bottom)
app.use((err, req, res, next) => {
    res.status(500).json({ message: 'An unexpected error occurred', error: err.message });
});

//server start with DB init
const PORT = process.env.PORT || 3000;
init().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
