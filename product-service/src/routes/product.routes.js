'use strict';

const express  = require('express');
const { body, query } = require('express-validator');
const ctrl     = require('../controllers/product.controller');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/v1/products?page=1&limit=20&category=&search=&minPrice=&maxPrice=&sort=
router.get('/', ctrl.listProducts);

// GET /api/v1/products/featured
router.get('/featured', ctrl.getFeatured);

// GET /api/v1/products/:id
router.get('/:id', ctrl.getProduct);

// GET /api/v1/products/:id/inventory
router.get('/:id/inventory', ctrl.getInventory);

// ── Protected routes (admin/vendor) ──────────────────────────────────────────

router.use(authMiddleware);

// POST /api/v1/products
router.post('/',
  requireRole('admin', 'vendor'),
  [
    body('name').trim().notEmpty(),
    body('sku').trim().notEmpty(),
    body('price').isFloat({ min: 0 }),
    body('categoryId').optional().isUUID(),
  ],
  validate,
  ctrl.createProduct,
);

// PATCH /api/v1/products/:id
router.patch('/:id',
  requireRole('admin', 'vendor'),
  ctrl.updateProduct,
);

// DELETE /api/v1/products/:id
router.delete('/:id',
  requireRole('admin'),
  ctrl.deleteProduct,
);

// PATCH /api/v1/products/:id/inventory
router.patch('/:id/inventory',
  requireRole('admin', 'vendor'),
  [body('quantity').isInt({ min: 0 })],
  validate,
  ctrl.updateInventory,
);

// POST /api/v1/products/:id/images
router.post('/:id/images',
  requireRole('admin', 'vendor'),
  [body('url').isURL(), body('isPrimary').optional().isBoolean()],
  validate,
  ctrl.addImage,
);

module.exports = router;
