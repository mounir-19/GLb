const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

router.use(authenticateToken);

// Helper function to handle database errors
const handleDatabaseError = (error, res, context) => {
  console.error(`${context} error:`, error);

  let errorMessage = 'Internal server error';
  let statusCode = 500;

  if (error.code === '23505') {
    errorMessage = 'A record with this information already exists';
    statusCode = 409;
  } else if (error.code === '23503') {
    errorMessage = 'Referenced record does not exist';
    statusCode = 400;
  } else if (error.code === '42703') {
    errorMessage = `Database column missing: ${error.message}`;
    statusCode = 500;
  } else if (error.code === '42P01') {
    errorMessage = 'Required database table is missing';
    statusCode = 500;
  } else if (error.message) {
    errorMessage = error.message;
  }

  res.status(statusCode).json({
    error: errorMessage,
    ...(process.env.NODE_ENV === 'development' && {
      detail: error.detail,
      hint: error.hint,
      code: error.code
    })
  });
};

// GET /api/sales-transactions/today-stats
router.get('/today-stats', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as today_revenue,
        COUNT(DISTINCT client_id) as clients_served,
        COUNT(*) as total_sales,
        COUNT(*) FILTER (WHERE status = 'Completed') as completed,
        COUNT(*) FILTER (WHERE status = 'Validated') as validated,
        COUNT(*) FILTER (WHERE status = 'Draft') as drafts
      FROM sales
      WHERE sale_date = CURRENT_DATE
    `);

    const yesterdayResult = await query(`
      SELECT COALESCE(SUM(total_amount), 0) as yesterday_revenue
      FROM sales
      WHERE sale_date = CURRENT_DATE - INTERVAL '1 day'
    `);

    const todayRevenue = parseFloat(result.rows[0].today_revenue);
    const yesterdayRevenue = parseFloat(yesterdayResult.rows[0].yesterday_revenue);
    const percentChange =
      yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100).toFixed(1) : 0;

    res.json({
      data: {
        ...result.rows[0],
        percent_change: percentChange
      }
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Get today stats');
  }
});

// GET /api/sales-transactions/recent
router.get('/recent', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const result = await query(
      `
      SELECT s.*, 
             (SELECT string_agg(product_name, ', ') FROM sale_items si WHERE si.sale_id = s.sale_id) as products
      FROM sales s
      WHERE s.sale_date = CURRENT_DATE
      ORDER BY s.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json({ data: result.rows });
  } catch (error) {
    handleDatabaseError(error, res, 'Get recent sales');
  }
});

// GET /api/sales-transactions/weekly-performance
router.get('/weekly-performance', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        TO_CHAR(sale_date, 'Dy') as day,
        COALESCE(SUM(total_amount), 0) as value
      FROM sales
      WHERE sale_date >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY sale_date, TO_CHAR(sale_date, 'Dy')
      ORDER BY sale_date
    `);
    res.json({ data: result.rows });
  } catch (error) {
    handleDatabaseError(error, res, 'Get weekly performance');
  }
});

// GET /api/sales-transactions/sold-products
router.get('/sold-products', async (req, res) => {
  try {
    const { start_date, end_date, advisor_id, status = 'Validated' } = req.query;

    let dateFilter = '';
    const params = [];
    let paramIndex = 1;

    if (start_date && end_date) {
      dateFilter = `AND s.sale_date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(start_date, end_date);
    } else {
      dateFilter = `AND s.sale_date >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    if (advisor_id) {
      dateFilter += ` AND s.created_by = $${paramIndex++}`;
      params.push(advisor_id);
    }

    if (status) {
      dateFilter += ` AND s.status = $${paramIndex++}`;
      params.push(status);
    }

    const salesResult = await query(
      `
      SELECT 
        s.sale_id,
        s.reference,
        s.sale_date,
        s.created_at,
        s.client_id,
        s.client_name,
        s.client_phone,
        s.client_type,
        s.total_amount,
        s.status,
        u.first_name || ' ' || u.last_name as advisor_name,
        json_agg(
          json_build_object(
            'name', si.product_name,
            'code', si.product_code,
            'qty', si.quantity,
            'price', si.unit_price,
            'total', si.total_price,
            'tag', CASE 
              WHEN a.type = 'Subscription' THEN 'Subscription'
              WHEN a.type = 'Hardware' THEN 'Hardware'
              ELSE 'Service'
            END
          )
        ) as items
      FROM sales s
      LEFT JOIN users u ON s.created_by = u.user_id
      LEFT JOIN sale_items si ON s.sale_id = si.sale_id
      LEFT JOIN articles a ON si.article_id = a.article_id
      WHERE 1=1 ${dateFilter}
      GROUP BY s.sale_id, s.reference, s.sale_date, s.created_at, 
               s.client_id, s.client_name, s.client_phone, s.client_type,
               s.total_amount, s.status, u.first_name, u.last_name
      ORDER BY s.sale_date DESC, s.created_at DESC
      `,
      params
    );

    const salesByDate = {};

    salesResult.rows.forEach((sale) => {
      const saleDate = new Date(sale.sale_date);
      const dateKey = saleDate.toISOString().split('T')[0];
      const dateLabel = saleDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = {
          date: dateLabel,
          dateKey: dateKey,
          totalSales: 0,
          totalAmount: 0,
          sales: []
        };
      }

      const saleTime = new Date(sale.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      salesByDate[dateKey].sales.push({
        id: sale.reference,
        time: saleTime,
        advisor: sale.advisor_name || 'Unknown',
        client: sale.client_name,
        phone: sale.client_phone,
        amount: `${parseFloat(sale.total_amount).toLocaleString('en-DZ')} DA`,
        type: sale.client_type,
        status: sale.status,
        items: sale.items
          .filter((item) => item.name)
          .map((item) => ({
            name: item.name,
            code: item.code || 'N/A',
            qty: item.qty,
            price: `${parseFloat(item.price).toLocaleString('en-DZ')} DA`,
            total: `${parseFloat(item.total).toLocaleString('en-DZ')} DA`,
            tag: item.tag
          }))
      });

      salesByDate[dateKey].totalSales++;
      salesByDate[dateKey].totalAmount += parseFloat(sale.total_amount);
    });

    const salesByDateArray = Object.values(salesByDate).map((group) => ({
      ...group,
      totalAmount: `${group.totalAmount.toLocaleString('en-DZ')} DA`
    }));

    const statsResult = await query(
      `
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COUNT(*) as total_sales,
        COALESCE(AVG(total_amount), 0) as avg_sale_value,
        COUNT(DISTINCT client_id) as unique_clients
      FROM sales s
      WHERE 1=1 ${dateFilter}
      `,
      params
    );

    const stats = statsResult.rows[0];

    const previousPeriodResult = await query(`
      SELECT COALESCE(SUM(total_amount), 0) as previous_revenue
      FROM sales
      WHERE sale_date >= CURRENT_DATE - INTERVAL '60 days'
      AND sale_date < CURRENT_DATE - INTERVAL '30 days'
    `);

    const currentRevenue = parseFloat(stats.total_revenue);
    const previousRevenue = parseFloat(previousPeriodResult.rows[0].previous_revenue);
    const revenueChange =
      previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : 0;

    res.json({
      data: {
        salesByDate: salesByDateArray,
        stats: {
          totalRevenue: `${currentRevenue.toLocaleString('en-DZ')} DA`,
          totalSales: parseInt(stats.total_sales),
          avgSaleValue: `${parseFloat(stats.avg_sale_value).toLocaleString('en-DZ')} DA`,
          uniqueClients: parseInt(stats.unique_clients),
          revenueChange: `${revenueChange}%`,
          revenueChangeDirection: revenueChange >= 0 ? 'up' : 'down'
        }
      }
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Get sold products');
  }
});

// GET /api/sales-transactions/sold-products/stats
router.get('/sold-products/stats', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const result = await query(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(AVG(total_amount), 0) as avg_sale,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(*) FILTER (WHERE client_type = 'Professional') as professional_sales,
        COUNT(*) FILTER (WHERE client_type = 'Residential') as residential_sales
      FROM sales
      WHERE sale_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
      AND status = 'Validated'
    `);

    res.json({ data: result.rows[0] });
  } catch (error) {
    handleDatabaseError(error, res, 'Get sold products stats');
  }
});

// GET /api/sales-transactions
router.get('/', async (req, res) => {
  try {
    const { search, status, client_type, start_date, end_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT s.*,
             (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.sale_id) as item_count
      FROM sales s WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      queryText += ` AND (s.reference ILIKE $${paramIndex} OR s.client_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (status && status !== 'all') {
      queryText += ` AND s.status = $${paramIndex++}`;
      params.push(status);
    }
    if (client_type && client_type !== 'all') {
      queryText += ` AND s.client_type = $${paramIndex++}`;
      params.push(client_type);
    }
    if (start_date) {
      queryText += ` AND s.sale_date >= $${paramIndex++}`;
      params.push(start_date);
    }
    if (end_date) {
      queryText += ` AND s.sale_date <= $${paramIndex++}`;
      params.push(end_date);
    }

    const countQuery = queryText.replace(/SELECT s\.\*.*FROM/s, 'SELECT COUNT(*) FROM');
    const countResult = await query(countQuery, params);

    queryText += ` ORDER BY s.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const statsResult = await query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_sales,
        COUNT(*) FILTER (WHERE status = 'Completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'Validated') as validated_count,
        COUNT(*) FILTER (WHERE status = 'Draft') as draft_count
      FROM sales
    `);

    res.json({
      data: result.rows,
      stats: statsResult.rows[0],
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Get sales');
  }
});

// ✅ NEW: POST /api/sales-transactions/from-recommendations
router.post('/from-recommendations', async (req, res) => {
  try {
    const { clientId, client_name, client_phone, client_type, items, notes } = req.body || {};

    if (!clientId || !client_name || !client_phone || !client_type) {
      return res.status(400).json({
        error: 'clientId, client_name, client_phone, client_type are required'
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items is required' });
    }

    // Generate reference
    let reference;
    try {
      const refResult = await query('SELECT generate_sale_reference() as reference');
      reference = refResult.rows[0].reference;
    } catch (funcError) {
      if (funcError.code === '42883') {
        const count = await query('SELECT COUNT(*) as count FROM sales WHERE sale_date = CURRENT_DATE');
        const counter = parseInt(count.rows[0].count) + 1;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        reference = `SALE-${year}${month}-${String(counter).padStart(3, '0')}`;
      } else {
        throw funcError;
      }
    }

    // Load authoritative prices
    const articleIds = items.map(i => i.article_id);
    const articlesRes = await query(
      `SELECT article_id, name, price, stock FROM articles WHERE article_id = ANY($1)`,
      [articleIds]
    );
    const map = new Map(articlesRes.rows.map(a => [a.article_id, a]));

    let totalAmount = 0;
    const normalized = items.map(it => {
      const row = map.get(it.article_id);
      if (!row) throw new Error(`Unknown article_id: ${it.article_id}`);

      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid quantity');

      const unit = Number(row.price);
      const lineTotal = unit * qty;
      totalAmount += lineTotal;

      return {
        article_id: row.article_id,
        article_name: row.name,
        unit_price: unit,
        quantity: qty,
        total_price: lineTotal,
        stock: row.stock
      };
    });

    // Deduct from articles.stock where stock is numeric (stock NULL means N/A, skip)
    for (const it of normalized) {
      if (it.stock === null) continue;

      const currentStock = Number(it.stock) || 0;
      if (currentStock < it.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${it.article_id}. Available: ${currentStock}, requested: ${it.quantity}.`
        });
      }

      await query(
        `UPDATE articles SET stock = stock - $1, updated_at = CURRENT_TIMESTAMP WHERE article_id = $2`,
        [it.quantity, it.article_id]
      );
    }

    const saleResult = await query(
      `
      INSERT INTO sales (
        reference, client_id, client_name, client_phone,
        client_type, total_amount, status, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'Draft', $7, $8)
      RETURNING *
      `,
      [reference, clientId, client_name, client_phone, client_type, totalAmount, notes || null, req.user.userId]
    );

    const sale = saleResult.rows[0];

    for (const it of normalized) {
      await query(
        `
        INSERT INTO sale_items (sale_id, article_id, product_name, product_code, quantity, unit_price, total_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [sale.sale_id, it.article_id, it.article_name, it.article_id, it.quantity, it.unit_price, it.total_price]
      );
    }

    return res.status(201).json({
      message: 'Sale created from recommendations',
      data: sale
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Create sale from recommendations');
  }
});

// GET /api/sales-transactions/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const saleResult = await query('SELECT * FROM sales WHERE sale_id = $1', [id]);

    if (saleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const itemsResult = await query(
      `
      SELECT si.*, a.type as article_type, a.service
      FROM sale_items si
      LEFT JOIN articles a ON si.article_id = a.article_id
      WHERE si.sale_id = $1
      `,
      [id]
    );

    res.json({
      data: { ...saleResult.rows[0], items: itemsResult.rows }
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Get sale');
  }
});

// POST /api/sales-transactions
router.post('/', async (req, res) => {
  try {
    const {
      client_id,
      client_name,
      client_phone,
      client_email,
      client_address,
      client_type,
      items,
      notes,
      status = 'Draft'
    } = req.body;

    if (!client_name || !client_phone || !client_type) {
      return res.status(400).json({ error: 'Client name, phone and type are required' });
    }

    let reference;
    try {
      const refResult = await query('SELECT generate_sale_reference() as reference');
      reference = refResult.rows[0].reference;
    } catch (funcError) {
      if (funcError.code === '42883') {
        const count = await query('SELECT COUNT(*) as count FROM sales WHERE sale_date = CURRENT_DATE');
        const counter = parseInt(count.rows[0].count) + 1;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        reference = `SALE-${year}${month}-${String(counter).padStart(3, '0')}`;
      } else {
        throw funcError;
      }
    }

    let totalAmount = 0;
    if (items && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    }

    const saleResult = await query(
      `
      INSERT INTO sales (
        reference, client_id, client_name, client_phone, client_email,
        client_address, client_type, total_amount, status, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        reference,
        client_id,
        client_name,
        client_phone,
        client_email,
        client_address,
        client_type,
        totalAmount,
        status,
        notes,
        req.user.userId
      ]
    );

    const sale = saleResult.rows[0];

    if (items && items.length > 0) {
      for (const item of items) {
        await query(
          `
          INSERT INTO sale_items (sale_id, article_id, product_name, product_code, quantity, unit_price, total_price)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            sale.sale_id,
            item.article_id,
            item.article_name,
            item.article_id,
            item.quantity,
            item.unit_price,
            item.quantity * item.unit_price
          ]
        );
      }
    }

    res.status(201).json({
      message: 'Sale created successfully',
      data: sale
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Create sale');
  }
});

// PATCH /api/sales-transactions/:id/validate
router.patch('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await query('SELECT * FROM sales WHERE sale_id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    if (checkResult.rows[0].status !== 'Draft') {
      return res.status(400).json({ error: 'Only draft sales can be validated' });
    }

    const result = await query(
      `
      UPDATE sales SET status = 'Validated', validated_at = CURRENT_TIMESTAMP, validated_by = $1
      WHERE sale_id = $2 RETURNING *
      `,
      [req.user.userId, id]
    );

    res.json({
      message: 'Sale validated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Validate sale');
  }
});

// PATCH /api/sales-transactions/:id/complete
router.patch('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `
      UPDATE sales SET status = 'Completed', completed_at = CURRENT_TIMESTAMP
      WHERE sale_id = $1 AND status = 'Validated' RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Sale not found or not validated' });
    }

    res.json({
      message: 'Sale completed successfully',
      data: result.rows[0]
    });
  } catch (error) {
    handleDatabaseError(error, res, 'Complete sale');
  }
});

module.exports = router;
