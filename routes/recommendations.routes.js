const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

router.use(authenticateToken);

// POST /api/recommendations/generate
router.post('/generate', async (req, res) => {
  try {
    const { serviceRequired, budget } = req.body || {};

    if (!serviceRequired || !['Internet Only', 'Telephone Only', 'Both'].includes(serviceRequired)) {
      return res.status(400).json({ error: 'Invalid serviceRequired' });
    }

    const budgetNum = Number(budget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({ error: 'budget must be a positive number' });
    }

    const services =
      serviceRequired === 'Internet Only'
        ? ['Internet']
        : serviceRequired === 'Telephone Only'
        ? ['Telephone']
        : ['Internet', 'Telephone'];

    const result = await query(
      `
      SELECT
        article_id,
        name,
        type,
        service,
        client_type,
        price,
        currency,
        stock
      FROM articles
      WHERE is_active = TRUE
        AND service = ANY($1)
        AND price <= $2
      ORDER BY
        (CASE WHEN stock IS NULL THEN 0 WHEN stock > 0 THEN 1 ELSE 0 END) DESC,
        price ASC
      LIMIT 20
      `,
      [services, budgetNum]
    );

    const data = (result.rows || []).map((r) => {
      const available = r.stock === null ? null : Number(r.stock) || 0;
      const status = r.stock === null ? 'N/A' : available > 0 ? 'In Stock' : 'Out of Stock';

      return {
        article_id: r.article_id,
        name: r.name,
        price: `${Number(r.price).toLocaleString('en-DZ')} ${r.currency || 'DA'}`,
        tags: [r.type, r.service],
        stock_age: 'N/A',
        available,
        status,
        description: 'Recommended based on service and budget.',
        compatibility: `Service: ${r.service}, Client type: ${r.client_type}`,
        warning: null
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Generate recommendations error:', error);
    return res.status(500).json({
      error: process.env.NODE_ENV === 'development'
        ? error.message
        : 'Failed to generate recommendations'
    });
  }
});

module.exports = router;
