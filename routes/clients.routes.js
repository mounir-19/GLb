const express = require('express');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/clients - Get all clients
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { search, client_type, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let queryText = `
            SELECT c.*,
                   (SELECT COUNT(*) FROM sales s WHERE s.client_id = c.client_id) as total_sales,
                   (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.client_id = c.client_id) as total_spent
            FROM clients c
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (search) {
            queryText += ` AND (c.client_name ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (client_type && client_type !== 'all') {
            queryText += ` AND c.client_type = $${paramIndex++}`;
            params.push(client_type);
        }

        // Get count
        const countQuery = queryText.replace(/SELECT c\.\*.*FROM/s, 'SELECT COUNT(*) FROM');
        const countResult = await query(countQuery, params);

        // Add pagination
        queryText += ` ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        res.json({
            data: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(countResult.rows[0].count / limit)
            }
        });

    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/clients/search - Search clients (for autocomplete)
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json({ data: [] });
        }

        const result = await query(`
            SELECT client_id, client_name, phone, email, client_type, location
            FROM clients
            WHERE client_name ILIKE $1 OR phone ILIKE $1
            ORDER BY client_name
            LIMIT 10
        `, [`%${q}%`]);

        res.json({ data: result.rows });

    } catch (error) {
        console.error('Search clients error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/clients/:id - Get single client with history
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const clientResult = await query(`
            SELECT c.*,
                   (SELECT COUNT(*) FROM sales s WHERE s.client_id = c.client_id) as total_sales,
                   (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.client_id = c.client_id) as total_spent
            FROM clients c
            WHERE c.client_id = $1
        `, [id]);

        if (clientResult.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Get sales history
        const salesResult = await query(`
            SELECT sale_id, reference, total_amount, status, sale_date
            FROM sales
            WHERE client_id = $1
            ORDER BY sale_date DESC
            LIMIT 10
        `, [id]);

        // Get invoices
        const invoicesResult = await query(`
            SELECT invoice_id, invoice_number, amount, paid_amount, status, issue_date, due_date
            FROM invoices
            WHERE client_id = $1
            ORDER BY issue_date DESC
            LIMIT 10
        `, [id]);

        res.json({
            data: {
                ...clientResult.rows[0],
                sales: salesResult.rows,
                invoices: invoicesResult.rows
            }
        });

    } catch (error) {
        console.error('Get client error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/clients - Create new client
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { client_name, phone, email, address, location, client_type, is_existing_client } = req.body;

        if (!client_name || !phone || !client_type) {
            return res.status(400).json({ error: 'Client name, phone and type are required' });
        }

        // Check if phone already exists
        const existing = await query('SELECT client_id FROM clients WHERE phone = $1', [phone]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Client with this phone number already exists' });
        }

        const result = await query(`
            INSERT INTO clients (client_name, phone, email, address, location, client_type, is_existing_client, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [client_name, phone, email, address, location, client_type, is_existing_client || false, req.user.userId]);

        res.status(201).json({
            message: 'Client created successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/clients/:id - Update client
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { client_name, phone, email, address, location, client_type } = req.body;

        const result = await query(`
            UPDATE clients 
            SET client_name = COALESCE($1, client_name),
                phone = COALESCE($2, phone),
                email = COALESCE($3, email),
                address = COALESCE($4, address),
                location = COALESCE($5, location),
                client_type = COALESCE($6, client_type),
                updated_at = CURRENT_TIMESTAMP
            WHERE client_id = $7
            RETURNING *
        `, [client_name, phone, email, address, location, client_type, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({
            message: 'Client updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/clients/:id - Delete client
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if client has sales
        const salesCheck = await query('SELECT COUNT(*) FROM sales WHERE client_id = $1', [id]);
        if (parseInt(salesCheck.rows[0].count) > 0) {
            return res.status(400).json({ error: 'Cannot delete client with existing sales' });
        }

        const result = await query('DELETE FROM clients WHERE client_id = $1 RETURNING client_id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ message: 'Client deleted successfully' });

    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
