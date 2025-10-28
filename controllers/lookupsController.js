const { getPool } = require('../config/db');

/**
 * Get all active departments
 * Returns department ID and Name
 */
exports.getDepartments = async (req, res) => {
    try {
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT Id, Name FROM department WHERE IsActive = 1 ORDER BY Name ASC'
        );

        res.status(200).json({
            message: 'Departments retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({
            message: 'Error fetching departments',
            error: error.message
        });
    }
};

/**
 * Get all active companies
 * Returns company ID and Name
 */
exports.getCompanies = async (req, res) => {
    try {
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT Id, Name FROM company WHERE IsActive = 1 ORDER BY Name ASC'
        );

        res.status(200).json({
            message: 'Companies retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({
            message: 'Error fetching companies',
            error: error.message
        });
    }
};

/**
 * Get all active categories
 * Returns category ID and Name
 */
exports.getCategories = async (req, res) => {
    try {
        const pool = getPool();
        const [rows] = await pool.query(
            'SELECT Id, Name FROM category WHERE IsActive = 1 ORDER BY Name ASC'
        );

        res.status(200).json({
            message: 'Categories retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            message: 'Error fetching categories',
            error: error.message
        });
    }
};

/**
 * Get all active request types
 * Returns request_type ID and Name
 */
exports.getRequestTypes = async (req, res) => {
    try {
        const pool = getPool();

        // Accept categoryId from route params or query string
        const categoryId = req.params.categoryId || req.query.categoryId || null;

        let rows;
        if (categoryId && !isNaN(categoryId)) {
            // Filter by CategoryId when provided
            const [result] = await pool.query(
                'SELECT Id, Name FROM requesttype WHERE IsActive = 1 AND CategoryId = ? ORDER BY Name ASC',
                [Number(categoryId)]
            );
            rows = result;
        } else {
            // No category filter: return all active request types
            const [result] = await pool.query(
                'SELECT Id, Name FROM requesttype WHERE IsActive = 1 ORDER BY Name ASC'
            );
            rows = result;
        }

        res.status(200).json({
            message: 'Request types retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching request types:', error);
        res.status(500).json({
            message: 'Error fetching request types',
            error: error.message
        });
    }
};

/**
 * Get all active issue types
 * Returns issuetype ID and Name
 */
exports.getIssueTypes = async (req, res) => {
    try {
        const pool = getPool();

        // Accept categoryId from route params or query string
        const categoryId = req.params.categoryId || req.query.categoryId || null;

        let rows;
        if (categoryId && !isNaN(categoryId)) {
            // Filter by CategoryId when provided
            const [result] = await pool.query(
                'SELECT Id, Name FROM issuetype WHERE IsActive = 1 AND CategoryId = ? ORDER BY Name ASC',
                [Number(categoryId)]
            );
            rows = result;
        } else {
            // No category filter: return all active issue types
            const [result] = await pool.query(
                'SELECT Id, Name FROM issuetype WHERE IsActive = 1 ORDER BY Name ASC'
            );
            rows = result;
        }

        res.status(200).json({
            message: 'Issue types retrieved successfully',
            data: rows
        });
    } catch (error) {
        console.error('Error fetching issue types:', error);
        res.status(500).json({
            message: 'Error fetching issue types',
            error: error.message
        });
    }
};