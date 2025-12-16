const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

router.use(authenticateToken);

// GET /api/sales - Get all sales
router.get('/', async (req, res) => {
    try {
        const { year, month, limit = 100 } = req.query;
        
        let queryText = 'SELECT * FROM sales WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (year) {
            queryText += ` AND EXTRACT(YEAR FROM sale_date) = $${paramIndex++}`;
            params.push(year);
        }

        if (month) {
            queryText += ` AND EXTRACT(MONTH FROM sale_date) = $${paramIndex++}`;
            params.push(month);
        }

        queryText += ` ORDER BY sale_date DESC LIMIT $${paramIndex}`;
        params.push(limit);

        const result = await query(queryText, params);
        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/year/:year - Get sales by year
router.get('/year/:year', async (req, res) => {
    try {
        const { year } = req.params;
        const result = await query(`
            SELECT 
                EXTRACT(MONTH FROM sale_date) as month,
                COUNT(*) as count,
                SUM(total_amount) as total
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            GROUP BY EXTRACT(MONTH FROM sale_date)
            ORDER BY month
        `, [year]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales by year error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/month/:year/:month - Get sales by month
router.get('/month/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const result = await query(`
            SELECT * FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND EXTRACT(MONTH FROM sale_date) = $2
            ORDER BY sale_date DESC
        `, [year, month]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales by month error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/stats/summary - Get summary statistics
router.get('/stats/summary', async (req, res) => {
    try {
        const { year } = req.query;
        
        let yearFilter = '';
        const params = [];
        
        if (year) {
            yearFilter = 'WHERE EXTRACT(YEAR FROM sale_date) = $1';
            params.push(year);
        }

        const result = await query(`
            SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(AVG(total_amount), 0) as average_sale,
                COUNT(DISTINCT client_id) as unique_clients
            FROM sales
            ${yearFilter}
        `, params);

        res.json({ data: result.rows[0] });
    } catch (error) {
        console.error('Get sales summary error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/stats/comparison - Compare periods
router.get('/stats/comparison', async (req, res) => {
    try {
        const { year, month } = req.query;

        if (!year || !month) {
            return res.status(400).json({ error: 'Year and month are required' });
        }

        const currentResult = await query(`
            SELECT COALESCE(SUM(total_amount), 0) as revenue
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND EXTRACT(MONTH FROM sale_date) = $2
        `, [year, month]);

        const previousMonth = month == 1 ? 12 : month - 1;
        const previousYear = month == 1 ? year - 1 : year;

        const previousResult = await query(`
            SELECT COALESCE(SUM(total_amount), 0) as revenue
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND EXTRACT(MONTH FROM sale_date) = $2
        `, [previousYear, previousMonth]);

        const currentRevenue = parseFloat(currentResult.rows[0].revenue);
        const previousRevenue = parseFloat(previousResult.rows[0].revenue);
        
        const percentChange = previousRevenue > 0 
            ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1)
            : 0;

        res.json({
            data: {
                current: currentRevenue,
                previous: previousRevenue,
                change: percentChange
            }
        });
    } catch (error) {
        console.error('Get sales comparison error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/stats/trend - Get trend data
router.get('/stats/trend', async (req, res) => {
    try {
        const { months = 12 } = req.query;

        const result = await query(`
            SELECT 
                TO_CHAR(sale_date, 'Mon') as month,
                EXTRACT(YEAR FROM sale_date) as year,
                COALESCE(SUM(CASE WHEN client_type = 'Professional' THEN total_amount ELSE 0 END), 0) as subscription_revenue,
                COALESCE(SUM(CASE WHEN client_type = 'Residential' THEN total_amount ELSE 0 END), 0) as hardware_revenue
            FROM sales
            WHERE sale_date >= CURRENT_DATE - INTERVAL '${parseInt(months)} months'
            GROUP BY TO_CHAR(sale_date, 'Mon'), EXTRACT(YEAR FROM sale_date), EXTRACT(MONTH FROM sale_date)
            ORDER BY EXTRACT(YEAR FROM sale_date), EXTRACT(MONTH FROM sale_date)
            LIMIT $1
        `, [parseInt(months)]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales trend error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/by-advisor/:advisorId - Get sales by advisor
router.get('/by-advisor/:advisorId', async (req, res) => {
    try {
        const { advisorId } = req.params;
        const { status, limit = 20 } = req.query;

        let queryText = `
            SELECT * FROM sales 
            WHERE created_by = $1
        `;
        const params = [advisorId];
        let paramIndex = 2;

        if (status && status !== 'all') {
            queryText += ` AND status = $${paramIndex++}`;
            params.push(status);
        }

        queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
        params.push(limit);

        const result = await query(queryText, params);
        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales by advisor error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/by-client/:clientId - Get sales by client
router.get('/by-client/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const result = await query(`
            SELECT * FROM sales
            WHERE client_id = $1
            ORDER BY sale_date DESC
        `, [clientId]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get sales by client error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/revenue/monthly - Get monthly revenue breakdown
router.get('/revenue/monthly', async (req, res) => {
    try {
        const { year } = req.query;
        const currentYear = year || new Date().getFullYear();

        const result = await query(`
            SELECT 
                EXTRACT(MONTH FROM sale_date) as month,
                TO_CHAR(sale_date, 'Mon') as month_name,
                COALESCE(SUM(total_amount), 0) as revenue,
                COUNT(*) as sales_count
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND status = 'Completed'
            GROUP BY EXTRACT(MONTH FROM sale_date), TO_CHAR(sale_date, 'Mon')
            ORDER BY month
        `, [currentYear]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get monthly revenue error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/top-clients - Get top clients by revenue
router.get('/top-clients', async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const result = await query(`
            SELECT 
                client_id,
                client_name,
                client_type,
                COUNT(*) as total_sales,
                SUM(total_amount) as total_revenue
            FROM sales
            WHERE status = 'Completed'
            GROUP BY client_id, client_name, client_type
            ORDER BY total_revenue DESC
            LIMIT $1
        `, [limit]);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get top clients error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/performance/advisors - Get advisor performance
router.get('/performance/advisors', async (req, res) => {
    try {
        const { year, month } = req.query;
        
        let dateFilter = '';
        const params = [];
        let paramIndex = 1;

        if (year && month) {
            dateFilter = `WHERE EXTRACT(YEAR FROM s.sale_date) = $${paramIndex} AND EXTRACT(MONTH FROM s.sale_date) = $${paramIndex + 1}`;
            params.push(year, month);
            paramIndex += 2;
        } else if (year) {
            dateFilter = `WHERE EXTRACT(YEAR FROM s.sale_date) = $${paramIndex}`;
            params.push(year);
            paramIndex++;
        }

        const result = await query(`
            SELECT 
                s.created_by as advisor_id,
                u.first_name || ' ' || u.last_name as advisor_name,
                COUNT(*) as total_sales,
                COUNT(*) FILTER (WHERE s.status = 'Completed') as completed_sales,
                COALESCE(SUM(s.total_amount), 0) as total_revenue,
                COALESCE(AVG(s.total_amount), 0) as average_sale
            FROM sales s
            LEFT JOIN users u ON s.created_by = u.user_id
            ${dateFilter}
            GROUP BY s.created_by, u.first_name, u.last_name
            ORDER BY total_revenue DESC
        `, params);

        res.json({ data: result.rows });
    } catch (error) {
        console.error('Get advisor performance error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// GET /api/sales/dashboard/summary - Complete dashboard summary
router.get('/dashboard/summary', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        // This month stats
        const thisMonthResult = await query(`
            SELECT 
                COUNT(*) as total_sales,
                COALESCE(SUM(total_amount), 0) as revenue,
                COUNT(DISTINCT client_id) as unique_clients
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND EXTRACT(MONTH FROM sale_date) = $2
        `, [currentYear, currentMonth]);

        // Last month stats
        const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;

        const lastMonthResult = await query(`
            SELECT COALESCE(SUM(total_amount), 0) as revenue
            FROM sales
            WHERE EXTRACT(YEAR FROM sale_date) = $1
            AND EXTRACT(MONTH FROM sale_date) = $2
        `, [previousYear, previousMonth]);

        const thisMonthRevenue = parseFloat(thisMonthResult.rows[0].revenue);
        const lastMonthRevenue = parseFloat(lastMonthResult.rows[0].revenue);
        const percentChange = lastMonthRevenue > 0 
            ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
            : 0;

        res.json({
            data: {
                current_month: {
                    sales: thisMonthResult.rows[0].total_sales,
                    revenue: thisMonthRevenue,
                    clients: thisMonthResult.rows[0].unique_clients
                },
                previous_month: {
                    revenue: lastMonthRevenue
                },
                change: percentChange
            }
        });
    } catch (error) {
        console.error('Get dashboard summary error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

module.exports = router;