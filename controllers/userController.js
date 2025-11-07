const { getPool } = require('../config/db');

// Get User Profile
exports.getUserProfile = async (req, res) => {
    try {
        res.status(200).json({
            message: 'User profile data',
            user: req.user // Retrieved from authMiddleware
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get profile', error: error.message });
    }
};

/**
 * Get users by category ID
 * Returns users filtered by CategoryId where IsActive = 1
 */
exports.getUsersByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        
        // Validate categoryId parameter
        if (!categoryId || isNaN(categoryId)) {
            return res.status(400).json({
                message: 'Valid category ID is required'
            });
        }

        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT Id, Name FROM user WHERE CategoryId = ? AND IsActive = 1 ORDER BY Name ASC',
            [parseInt(categoryId)]
        );

        res.status(200).json({
            message: 'Users retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching users by category:', error);
        res.status(500).json({
            message: 'Error fetching users by category',
            error: error.message
        });
    }
};

