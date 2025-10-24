const express = require('express');
const { getDepartments } = require('../controllers/lookupsController');
const authMiddleware = require('../middlewares/authMiddleware');
const { getCompanies, getCategories, getRequestTypes, getIssueTypes } = require('../controllers/lookupsController');

const router = express.Router();

// Get all departments - Protected route
router.get('/departments', authMiddleware, getDepartments);

// Get all companies - Protected route
router.get('/companies', authMiddleware, getCompanies);

// Get all categories - Protected route
router.get('/categories', authMiddleware, getCategories);

// Get all request types - Protected route
router.get('/request-types', authMiddleware, getRequestTypes);

// Get all issue types - Protected route
router.get('/issue-types', authMiddleware, getIssueTypes);

module.exports = router;