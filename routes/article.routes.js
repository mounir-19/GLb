// routes/article.routes.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth.middleware');

// Apply authentication to all article routes
router.use(authenticateToken);

// ===== IMPORTANT: Static routes MUST come BEFORE dynamic /:id routes =====

// @route   GET /api/articles/stats/summary
// @desc    Get article statistics
// @access  Private
router.get('/stats/summary', async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                COUNT(*) as total_articles,
                COUNT(CASE WHEN type = 'Subscription' THEN 1 END) as subscriptions,
                COUNT(CASE WHEN type = 'Hardware' THEN 1 END) as hardware,
                COUNT(CASE WHEN stock IS NOT NULL AND stock <= 5 THEN 1 END) as critical_stock,
                COUNT(CASE WHEN stock IS NOT NULL AND stock > 5 AND stock <= 20 THEN 1 END) as low_stock
            FROM articles
            WHERE is_active = true
        `);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get article stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch statistics'
        });
    }
});

// @route   GET /api/articles/inventory/low-stock
// @desc    Get low stock items
// @access  Private
router.get('/inventory/low-stock', async (req, res) => {
    try {
        const { threshold = 20 } = req.query;

        const result = await query(
            `SELECT * FROM articles 
             WHERE is_active = true 
             AND stock IS NOT NULL 
             AND stock <= $1
             ORDER BY stock ASC`,
            [threshold]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get low stock error:', error);
        res.status(500).json({
            error: 'Failed to fetch low stock items'
        });
    }
});

// @route   GET /api/articles
// @desc    Get all articles with optional filters
// @access  Private
router.get('/', async (req, res) => {
    try {
        const { type, service, clientType, search, sortBy, sortOrder } = req.query;

        let queryText = 'SELECT * FROM articles WHERE is_active = true';
        const params = [];
        let paramCount = 1;

        // Apply filters
        if (type && type !== 'All Types') {
            queryText += ` AND type = $${paramCount}`;
            params.push(type);
            paramCount++;
        }

        if (service && service !== 'All Services') {
            queryText += ` AND service = $${paramCount}`;
            params.push(service);
            paramCount++;
        }

        if (clientType && clientType !== 'All Clients') {
            queryText += ` AND client_type = $${paramCount}`;
            params.push(clientType);
            paramCount++;
        }

        if (search) {
            queryText += ` AND (
                name ILIKE $${paramCount} OR 
                full_name ILIKE $${paramCount} OR 
                article_id ILIKE $${paramCount} OR
                type ILIKE $${paramCount} OR
                service ILIKE $${paramCount}
            )`;
            params.push(`%${search}%`);
            paramCount++;
        }

        // Apply sorting
        const validSortFields = ['name', 'article_id', 'price', 'stock'];
        const field = validSortFields.includes(sortBy) ? sortBy : 'name';
        const order = sortOrder === 'DESC' ? 'DESC' : 'ASC';
        queryText += ` ORDER BY ${field} ${order}`;

        const result = await query(queryText, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get articles error:', error);
        res.status(500).json({
            error: 'Failed to fetch articles'
        });
    }
});

// @route   GET /api/articles/:id
// @desc    Get single article by ID
// @access  Private
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'SELECT * FROM articles WHERE article_id = $1 AND is_active = true',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Article not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get article error:', error);
        res.status(500).json({
            error: 'Failed to fetch article'
        });
    }
});

// @route   POST /api/articles
// @desc    Create new article
// @access  Private (Controller, Director only)
// @route   POST /api/articles
// @desc    Create new article
// @access  Private (Controller, Director only)
router.post('/', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        console.log('========================================');
        console.log('📥 Received request body:', req.body);

        const {
            name,
            fullName,
            type,
            service,
            clientType,
            price,
            stock
        } = req.body;

        console.log('Extracted fields:', {
            name,
            fullName,
            type,
            service,
            clientType,
            price: price + ' (type: ' + typeof price + ')',
            stock: stock + ' (type: ' + typeof stock + ')'
        });

        // Validation
        if (!name || !type || !service || !clientType || price === undefined || price === null) {
            console.log('❌ Missing required fields');
            return res.status(400).json({
                error: 'Missing required fields',
                received: { name, type, service, clientType, price }
            });
        }

        // Validate enums
        const validTypes = ['Subscription', 'Hardware'];
        const validServices = ['Internet', 'Telephone'];
        const validClientTypes = ['Residential', 'Professional'];

        if (!validTypes.includes(type)) {
            console.log('❌ Invalid type:', type);
            return res.status(400).json({
                error: `Invalid article type: ${type}. Must be 'Subscription' or 'Hardware'`
            });
        }

        if (!validServices.includes(service)) {
            console.log('❌ Invalid service:', service);
            return res.status(400).json({
                error: `Invalid service type: ${service}. Must be 'Internet' or 'Telephone'`
            });
        }

        if (!validClientTypes.includes(clientType)) {
            console.log('❌ Invalid clientType:', clientType);
            return res.status(400).json({
                error: `Invalid client type: ${clientType}. Must be 'Residential' or 'Professional'`
            });
        }

        // Generate article ID - Find the highest existing number
        console.log('📊 Finding highest article ID...');
        const maxIdResult = await query(
            `SELECT article_id FROM articles 
             WHERE article_id ~ '^ART[0-9]+$'
             ORDER BY CAST(SUBSTRING(article_id FROM 4) AS INTEGER) DESC 
             LIMIT 1`
        );

        let nextNumber = 1;
        if (maxIdResult.rows.length > 0) {
            const lastId = maxIdResult.rows[0].article_id;
            const lastNumber = parseInt(lastId.substring(3));
            nextNumber = lastNumber + 1;
            console.log('Last ID:', lastId, '→ Next number:', nextNumber);
        } else {
            console.log('No existing articles, starting from 1');
        }

        const articleId = `ART${String(nextNumber).padStart(3, '0')}`;
        console.log('✅ Generated ID:', articleId);

        // Prepare stock value
        const stockValue = type === 'Hardware' ? null : (stock !== undefined && stock !== null ? parseInt(stock) : 0);
        console.log('💾 Stock value:', stockValue);

        // Insert article
        console.log('💾 Inserting article...');
        const result = await query(
            `INSERT INTO articles (
                article_id, name, full_name, type, service, client_type, price, stock, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                articleId,
                name,
                fullName || name,
                type,
                service,
                clientType,
                parseFloat(price),
                stockValue,
                true
            ]
        );

        console.log('✅ Article created successfully:', result.rows[0]);
        console.log('========================================');

        res.status(201).json({
            success: true,
            message: 'Article created successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('========================================');
        console.error('❌ Create article error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('========================================');

        res.status(500).json({
            error: 'Failed to create article',
            details: error.message
        });
    }
});
// routes/article.routes.js (only this route if you want strict <)
router.get('/inventory/low-stock', async (req, res) => {
    try {
        const { threshold = 20 } = req.query;

        const result = await query(
            `SELECT * FROM articles 
       WHERE is_active = true 
         AND stock IS NOT NULL 
         AND stock < $1
       ORDER BY stock ASC`,
            [threshold]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error('Get low stock error:', error);
        res.status(500).json({ error: 'Failed to fetch low stock items' });
    }
});

// @route   PATCH /api/articles/:id/stock
// @desc    Update article stock quantity
// @access  Private (Controller, Director only)
router.patch('/:id/stock', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { stock, operation } = req.body;

        if (!stock || !operation) {
            return res.status(400).json({
                error: 'Stock quantity and operation are required'
            });
        }

        let queryText;
        if (operation === 'set') {
            queryText = `
                UPDATE articles 
                SET stock = $1, updated_at = CURRENT_TIMESTAMP
                WHERE article_id = $2 AND is_active = true
                RETURNING *
            `;
        } else if (operation === 'add') {
            queryText = `
                UPDATE articles 
                SET stock = COALESCE(stock, 0) + $1, updated_at = CURRENT_TIMESTAMP
                WHERE article_id = $2 AND is_active = true
                RETURNING *
            `;
        } else if (operation === 'subtract') {
            queryText = `
                UPDATE articles 
                SET stock = GREATEST(COALESCE(stock, 0) - $1, 0), updated_at = CURRENT_TIMESTAMP
                WHERE article_id = $2 AND is_active = true
                RETURNING *
            `;
        } else {
            return res.status(400).json({
                error: 'Invalid operation. Use: set, add, or subtract'
            });
        }

        const result = await query(queryText, [stock, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Article not found or stock cannot be updated for this type'
            });
        }

        res.json({
            success: true,
            message: 'Stock updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update stock error:', error);
        res.status(500).json({
            error: 'Failed to update stock'
        });
    }
});

// @route   PUT /api/articles/:id
// @desc    Update article
// @access  Private (Controller, Director only)
router.put('/:id', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            fullName,
            type,
            service,
            clientType,
            price,
            stock
        } = req.body;

        // Build dynamic update query
        const updates = [];
        const params = [];
        let paramCount = 1;

        if (name) {
            updates.push(`name = $${paramCount}`);
            params.push(name);
            paramCount++;
        }

        if (fullName) {
            updates.push(`full_name = $${paramCount}`);
            params.push(fullName);
            paramCount++;
        }

        if (type) {
            updates.push(`type = $${paramCount}`);
            params.push(type);
            paramCount++;
        }

        if (service) {
            updates.push(`service = $${paramCount}`);
            params.push(service);
            paramCount++;
        }

        if (clientType) {
            updates.push(`client_type = $${paramCount}`);
            params.push(clientType);
            paramCount++;
        }

        if (price !== undefined) {
            updates.push(`price = $${paramCount}`);
            params.push(price);
            paramCount++;
        }

        if (stock !== undefined) {
            updates.push(`stock = $${paramCount}`);
            params.push(stock === 'N/A' ? null : stock);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'No fields to update'
            });
        }

        params.push(id);
        const queryText = `
            UPDATE articles 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE article_id = $${paramCount} AND is_active = true
            RETURNING *
        `;

        const result = await query(queryText, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Article not found'
            });
        }

        res.json({
            success: true,
            message: 'Article updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update article error:', error);
        res.status(500).json({
            error: 'Failed to update article'
        });
    }
});

// @route   DELETE /api/articles/:id
// @desc    Delete article (permanent delete)
// @access  Private (Director only)
router.delete('/:id', authorizeRole('Director'), async (req, res) => {
    try {
        const { id } = req.params;

        // Permanent delete
        const result = await query(
            `DELETE FROM articles 
             WHERE article_id = $1
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Article not found'
            });
        }

        res.json({
            success: true,
            message: 'Article permanently deleted',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Delete article error:', error);
        res.status(500).json({
            error: 'Failed to delete article'
        });
    }
});

module.exports = router;