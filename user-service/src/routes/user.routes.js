'use strict';

const express  = require('express');
const { body } = require('express-validator');
const userCtrl = require('../controllers/user.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// GET    /api/v1/users/profile
router.get('/profile', userCtrl.getProfile);

// PATCH  /api/v1/users/profile
router.patch('/profile',
  [
    body('firstName').optional().trim().notEmpty(),
    body('lastName').optional().trim().notEmpty(),
  ],
  validate,
  userCtrl.updateProfile,
);

// GET    /api/v1/users/addresses
router.get('/addresses', userCtrl.getAddresses);

// POST   /api/v1/users/addresses
router.post('/addresses',
  [
    body('addressLine1').trim().notEmpty(),
    body('city').trim().notEmpty(),
    body('postalCode').trim().notEmpty(),
    body('country').isLength({ min: 2, max: 2 }),
  ],
  validate,
  userCtrl.addAddress,
);

// DELETE /api/v1/users/addresses/:id
router.delete('/addresses/:id', userCtrl.deleteAddress);

// Admin: list all users
router.get('/', requireRole('admin'), userCtrl.listUsers);

// Admin: get single user
router.get('/:id', requireRole('admin'), userCtrl.getUserById);

module.exports = router;
