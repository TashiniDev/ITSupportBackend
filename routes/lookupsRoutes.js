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

// Get all request types - Protected routes
// Supports both query string (?categoryId=3) and route param (/request-types/3)
router.get('/request-types/:categoryId', authMiddleware, getRequestTypes);

// Get all issue types - Protected routes
// Supports both query string (?categoryId=3) and route param (/issue-types/3)
router.get('/issue-types/:categoryId', authMiddleware, getIssueTypes);

module.exports = router;