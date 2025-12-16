const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

router.use(authenticateToken);

// GET /api/sales-transactions/sold-products - Get detailed sales grouped by date
router.get('/sold-products', async (req, res) => {
    try {
        const { start_date, end_date, advisor_id, status = 'Validated' } = req.query;

        // Build date filter
        let dateFilter = '';
        const params = [];
        let paramIndex = 1;

        if (start_date && end_date) {
            dateFilter = `AND s.sale_date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
            params.push(start_date, end_date);
        } else {
            // Default: last 30 days
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

        // Get all sales with items
        const salesResult = await query(`
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
                        'name', si.article_name,
                        'code', si.article_id,
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
        `, params);

        // Group sales by date
        const salesByDate = {};
        
        salesResult.rows.forEach(sale => {
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
                items: sale.items.map(item => ({
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

        // Convert to array and format amounts
        const salesByDateArray = Object.values(salesByDate).map(group => ({
            ...group,
            totalAmount: `${group.totalAmount.toLocaleString('en-DZ')} DA`
        }));

        // Calculate overall stats
        const statsResult = await query(`
            SELECT 
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COUNT(*) as total_sales,
                COALESCE(AVG(total_amount), 0) as avg_sale_value,
                COUNT(DISTINCT client_id) as unique_clients
            FROM sales s
            WHERE 1=1 ${dateFilter}
        `, params);

        const stats = statsResult.rows[0];

        // Calculate percentage change (comparing to previous period)
        const previousPeriodResult = await query(`
            SELECT COALESCE(SUM(total_amount), 0) as previous_revenue
            FROM sales
            WHERE sale_date >= CURRENT_DATE - INTERVAL '60 days'
            AND sale_date < CURRENT_DATE - INTERVAL '30 days'
        `);

        const currentRevenue = parseFloat(stats.total_revenue);
        const previousRevenue = parseFloat(previousPeriodResult.rows[0].previous_revenue);
        const revenueChange = previousRevenue > 0 
            ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1)
            : 0;

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
        console.error('Get sold products error:', error);
        res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
});

// GET /api/sales-transactions/sold-products/stats - Get quick stats for dashboard
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
        console.error('Get sold products stats error:', error);
        res.status(500).json({ 
            error: error.message || 'Internal server error' 
        });
    }
});

module.exports = router;