// authMiddleware.js
const jwt = require('jsonwebtoken');

// Verify the token
module.exports = (req, res, next) => {
    const token = req.header('Authorization') && req.header('Authorization').replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        // Verify the token and get user data
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Attach decoded payload to req.user. Also provide a convenience `role` field if roleId exists.
        req.user = decoded; // Add the decoded user data to object
        if (decoded && typeof decoded.roleId !== 'undefined') {
            // keep both names available for convenience
            req.user.role = decoded.roleId;
        }
        next();
    } catch (error) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};
