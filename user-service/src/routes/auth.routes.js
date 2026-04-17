'use strict';

const express   = require('express');
const { body }  = require('express-validator');
const authCtrl  = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate.middleware');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
  ],
  validate,
  authCtrl.register,
);

// POST /api/v1/auth/login
router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validate,
  authCtrl.login,
);

// POST /api/v1/auth/refresh
router.post('/refresh', authCtrl.refresh);

// POST /api/v1/auth/logout
router.post('/logout', authMiddleware, authCtrl.logout);

// GET /api/v1/auth/me
router.get('/me', authMiddleware, authCtrl.me);

module.exports = router;
