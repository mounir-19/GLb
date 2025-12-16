const express = require('express');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
    try {
        const {
            status,
            client_type,
            client_id,
            search,
            start_date,
            end_date,
            isRead,
            page = 1,
            limit = 20
        } = req.query;

        const offset = (page - 1) * limit;
        let queryText = `
            SELECT i.*, 
                   u.first_name || ' ' || u.last_name as created_by_name
            FROM invoices i
            LEFT JOIN users u ON i.created_by = u.user_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (status && status !== 'all') {
            queryText += ` AND i.status = $${paramIndex++}`;
            params.push(status);
        }

        if (client_type && client_type !== 'all') {
            queryText += ` AND i.client_type = $${paramIndex++}`;
            params.push(client_type);
        }

        if (client_id) {
            queryText += ` AND i.client_id = $${paramIndex++}`;
            params.push(client_id);
        }

        if (search) {
            queryText += ` AND (i.invoice_number ILIKE $${paramIndex} OR i.client_name ILIKE $${paramIndex} OR i.client_phone ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (start_date) {
            queryText += ` AND i.issue_date >= $${paramIndex++}`;
            params.push(start_date);
        }

        if (end_date) {
            queryText += ` AND i.issue_date <= $${paramIndex++}`;
            params.push(end_date);
        }

        // Total count
        const countQuery = queryText.replace(
            /SELECT i\.\*.*FROM/s,
            'SELECT COUNT(*) FROM'
        );
        const countResult = await query(countQuery, params);

        // Pagination
        queryText += ` ORDER BY i.issue_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(limit, offset);

        const result = await query(queryText, params);

        // Stats
        const statsResult = await query(`
            SELECT 
                COUNT(*) as total_invoices,
                COALESCE(SUM(amount), 0) as total_amount,
                COALESCE(SUM(paid_amount), 0) as amount_paid,
                COALESCE(SUM(amount - paid_amount), 0) as amount_due,
                COUNT(*) FILTER (WHERE status = 'Paid') as paid_count,
                COUNT(*) FILTER (WHERE status = 'Pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'Overdue') as overdue_count
            FROM invoices
        `);

        res.json({
            data: result.rows,
            stats: statsResult.rows[0],
            count: parseInt(countResult.rows[0].count),
            pagination: {
                total: parseInt(countResult.rows[0].count),
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(countResult.rows[0].count / limit)
            }
        });

    } catch (error) {
        console.error('Get invoices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --------------------------------------
// GET /api/invoices/by-client
// --------------------------------------
router.get('/by-client', authenticateToken, async (req, res) => {
    try {
        const { search, client_type, status } = req.query;

        let queryText = `
            SELECT 
                c.client_id,
                c.client_name,
                c.phone,
                c.client_type,
                COUNT(i.invoice_id) as total_invoices,
                COALESCE(SUM(i.amount), 0) as total_amount,
                COALESCE(SUM(i.paid_amount), 0) as total_paid,
                COALESCE(SUM(i.amount - i.paid_amount), 0) as total_due,
                json_agg(
                    json_build_object(
                        'invoice_id', i.invoice_id,
                        'invoice_number', i.invoice_number,
                        'sale_reference', i.sale_reference,
                        'amount', i.amount,
                        'paid_amount', i.paid_amount,
                        'status', i.status,
                        'issue_date', i.issue_date,
                        'due_date', i.due_date
                    ) ORDER BY i.issue_date DESC
                ) FILTER (WHERE i.invoice_id IS NOT NULL) as invoices
            FROM clients c
            LEFT JOIN invoices i ON c.client_id = i.client_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (search) {
            queryText += ` AND (c.client_name ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (client_type && client_type !== 'all') {
            queryText += ` AND c.client_type = $${paramIndex++}`;
            params.push(client_type);
        }

        queryText += ` GROUP BY c.client_id, c.client_name, c.phone, c.client_type`;

        if (status && status !== 'all') {
            queryText += ` HAVING COUNT(*) FILTER (WHERE i.status = $${paramIndex++}) > 0`;
            params.push(status);
        }

        queryText += ` ORDER BY total_due DESC, c.client_name`;

        const result = await query(queryText, params);

        // Overall stats
        const statsResult = await query(`
            SELECT 
                COUNT(DISTINCT invoice_id) as total_invoices,
                COALESCE(SUM(amount), 0) as total_amount,
                COALESCE(SUM(paid_amount), 0) as amount_paid,
                COALESCE(SUM(amount - paid_amount), 0) as amount_due
            FROM invoices
        `);

        res.json({
            data: result.rows,
            stats: statsResult.rows[0]
        });

    } catch (error) {
        console.error('Get invoices by client error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --------------------------------------
// GET /api/invoices/stats
// --------------------------------------
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                COUNT(*) as total_invoices,
                COALESCE(SUM(amount), 0) as total_amount,
                COALESCE(SUM(paid_amount), 0) as amount_paid,
                COALESCE(SUM(amount - paid_amount), 0) as amount_due,
                COUNT(*) FILTER (WHERE status = 'Paid') as paid_count,
                COUNT(*) FILTER (WHERE status = 'Pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'Overdue') as overdue_count
            FROM invoices
        `);

        res.json({ data: result.rows[0] });

    } catch (error) {
        console.error('Get invoice stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --------------------------------------
// GET /api/invoices/:id
// --------------------------------------
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(`
            SELECT i.*, 
                   u.first_name || ' ' || u.last_name as created_by_name,
                   s.reference as sale_reference,
                   (SELECT json_agg(si.*) FROM sale_items si WHERE si.sale_id = i.sale_id) as items
            FROM invoices i
            LEFT JOIN users u ON i.created_by = u.user_id
            LEFT JOIN sales s ON i.sale_id = s.sale_id
            WHERE i.invoice_id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        res.json({ data: result.rows[0] });

    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --------------------------------------
// PUT /api/invoices/:id
// --------------------------------------
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { paid_amount, status, due_date } = req.body;

        let updatePaidAmount = paid_amount;
        let updateStatus = status;
        let paidDate = null;

        if (status === 'Paid') {
            const invoiceResult = await query('SELECT amount FROM invoices WHERE invoice_id = $1', [id]);
            if (invoiceResult.rows.length > 0) {
                updatePaidAmount = invoiceResult.rows[0].amount;
                paidDate = new Date();
            }
        }

        const result = await query(`
            UPDATE invoices 
            SET paid_amount = COALESCE($1, paid_amount),
                status = COALESCE($2, status),
                due_date = COALESCE($3, due_date),
                paid_date = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id = $5
            RETURNING *
        `, [updatePaidAmount, updateStatus, due_date, paidDate, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        res.json({
            message: 'Invoice updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --------------------------------------
// POST /api/invoices/:id/pay
// --------------------------------------
router.post('/:id/pay', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;

        const invoiceResult = await query('SELECT * FROM invoices WHERE invoice_id = $1', [id]);

        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        const invoice = invoiceResult.rows[0];
        const payAmount = amount || invoice.amount;
        const newPaidAmount = invoice.paid_amount + payAmount;
        const newStatus = newPaidAmount >= invoice.amount ? 'Paid' : 'Pending';

        const result = await query(`
            UPDATE invoices 
            SET paid_amount = $1,
                status = $2,
                paid_date = CASE WHEN $2 = 'Paid' THEN CURRENT_DATE ELSE paid_date END,
                updated_at = CURRENT_TIMESTAMP
            WHERE invoice_id = $3
            RETURNING *
        `, [newPaidAmount, newStatus, id]);

        res.json({
            message: 'Payment recorded successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Pay invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
