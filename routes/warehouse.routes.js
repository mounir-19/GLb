// routes/warehouse.routes.js
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth.middleware');

// Apply authentication to all warehouse routes
router.use(authenticateToken);

// @route   GET /api/warehouse/orders
// @desc    Get all warehouse orders with optional filters
// @access  Private
router.get('/orders', async (req, res) => {
    try {
        const { status, supplier, warehouse, search } = req.query;

        let queryText = 'SELECT * FROM warehouse_orders WHERE 1=1';
        const params = [];
        let paramCount = 1;

        // Apply filters
        if (status && status !== 'all type') {
            queryText += ` AND status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (supplier && supplier !== 'all service') {
            queryText += ` AND supplier = $${paramCount}`;
            params.push(supplier);
            paramCount++;
        }

        if (warehouse && warehouse !== 'all client type') {
            queryText += ` AND warehouse_location = $${paramCount}`;
            params.push(warehouse);
            paramCount++;
        }

        if (search) {
            queryText += ` AND (
                order_id ILIKE $${paramCount} OR 
                requester_name ILIKE $${paramCount} OR 
                supplier ILIKE $${paramCount} OR
                warehouse_location ILIKE $${paramCount}
            )`;
            params.push(`%${search}%`);
            paramCount++;
        }

        queryText += ' ORDER BY expected_delivery_date DESC, created_at DESC';

        const result = await query(queryText, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get warehouse orders error:', error);
        res.status(500).json({
            error: 'Failed to fetch warehouse orders'
        });
    }
});

// @route   GET /api/warehouse/orders/:id
// @desc    Get single warehouse order by ID
// @access  Private
router.get('/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'SELECT * FROM warehouse_orders WHERE order_id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get warehouse order error:', error);
        res.status(500).json({
            error: 'Failed to fetch warehouse order'
        });
    }
});

// @route   POST /api/warehouse/orders
// @desc    Create new warehouse order
// @access  Private (Controller, Director only)
router.post('/orders', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const {
            requesterId,
            requesterName,
            supplier,
            warehouseLocation,
            warehouseType,
            totalAmount,
            itemCount,
            expectedDeliveryDate,
            notes
        } = req.body;

        // Validation
        if (!requesterName || !supplier || !warehouseLocation || !warehouseType || !totalAmount || !expectedDeliveryDate) {
            return res.status(400).json({
                error: 'Missing required fields'
            });
        }

        // Validate warehouse type
        const validWarehouseTypes = ['Central Warehouse', 'Distribution Center', 'Regional Warehouse'];
        if (!validWarehouseTypes.includes(warehouseType)) {
            return res.status(400).json({
                error: 'Invalid warehouse type'
            });
        }

        // Generate order ID
        const year = new Date().getFullYear();
        const countResult = await query(
            'SELECT COUNT(*) as count FROM warehouse_orders WHERE order_id LIKE $1',
            [`PO-${year}-%`]
        );
        const count = parseInt(countResult.rows[0].count) + 1;
        const orderId = `PO-${year}-${String(count).padStart(3, '0')}`;

        // Insert order
        const result = await query(
            `INSERT INTO warehouse_orders (
                order_id, requester_id, requester_name, supplier, 
                warehouse_location, warehouse_type, total_amount, 
                item_count, expected_delivery_date, status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                orderId,
                requesterId,
                requesterName,
                supplier,
                warehouseLocation,
                warehouseType,
                totalAmount,
                itemCount || 1,
                expectedDeliveryDate,
                'Pending Approval',
                notes
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Create warehouse order error:', error);
        res.status(500).json({
            error: 'Failed to create warehouse order'
        });
    }
});

// @route   PUT /api/warehouse/orders/:id
// @desc    Update warehouse order
// @access  Private (Controller, Director only)
router.put('/orders/:id', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            supplier,
            warehouseLocation,
            warehouseType,
            totalAmount,
            itemCount,
            expectedDeliveryDate,
            notes
        } = req.body;

        // Build dynamic update query
        const updates = [];
        const params = [];
        let paramCount = 1;

        if (supplier) {
            updates.push(`supplier = $${paramCount}`);
            params.push(supplier);
            paramCount++;
        }

        if (warehouseLocation) {
            updates.push(`warehouse_location = $${paramCount}`);
            params.push(warehouseLocation);
            paramCount++;
        }

        if (warehouseType) {
            updates.push(`warehouse_type = $${paramCount}`);
            params.push(warehouseType);
            paramCount++;
        }

        if (totalAmount !== undefined) {
            updates.push(`total_amount = $${paramCount}`);
            params.push(totalAmount);
            paramCount++;
        }

        if (itemCount !== undefined) {
            updates.push(`item_count = $${paramCount}`);
            params.push(itemCount);
            paramCount++;
        }

        if (expectedDeliveryDate) {
            updates.push(`expected_delivery_date = $${paramCount}`);
            params.push(expectedDeliveryDate);
            paramCount++;
        }

        if (notes !== undefined) {
            updates.push(`notes = $${paramCount}`);
            params.push(notes);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'No fields to update'
            });
        }

        params.push(id);
        const queryText = `
            UPDATE warehouse_orders 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE order_id = $${paramCount}
            RETURNING *
        `;

        const result = await query(queryText, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            success: true,
            message: 'Order updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update warehouse order error:', error);
        res.status(500).json({
            error: 'Failed to update warehouse order'
        });
    }
});

// @route   PATCH /api/warehouse/orders/:id/status
// @desc    Update order status
// @access  Private (Controller, Director only)
router.patch('/orders/:id/status', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, arrivedDate } = req.body;

        if (!status) {
            return res.status(400).json({
                error: 'Status is required'
            });
        }

        // Validate status
        const validStatuses = ['Pending Approval', 'In Transit', 'Arrived', 'Completed', 'Rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status'
            });
        }

        let queryText;
        let params;

        if (status === 'Arrived' || status === 'Completed') {
            queryText = `
                UPDATE warehouse_orders 
                SET status = $1, arrived_date = $2, updated_at = CURRENT_TIMESTAMP
                WHERE order_id = $3
                RETURNING *
            `;
            params = [status, arrivedDate || new Date(), id];
        } else {
            queryText = `
                UPDATE warehouse_orders 
                SET status = $1, updated_at = CURRENT_TIMESTAMP
                WHERE order_id = $2
                RETURNING *
            `;
            params = [status, id];
        }

        const result = await query(queryText, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            success: true,
            message: 'Order status updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({
            error: 'Failed to update order status'
        });
    }
});

// @route   PATCH /api/warehouse/orders/:id/sign
// @desc    Sign and accept arrived order
// @access  Private (Controller, Director only)
router.patch('/orders/:id/sign', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        // Get employee ID from user
        const employeeResult = await query(
            'SELECT employee_id FROM employees WHERE user_id = $1',
            [userId]
        );

        if (employeeResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Employee record not found'
            });
        }

        const employeeId = employeeResult.rows[0].employee_id;

        // Update order
        const result = await query(
            `UPDATE warehouse_orders 
             SET status = 'Completed', 
                 signed_by = $1, 
                 signed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE order_id = $2 AND status = 'Arrived'
             RETURNING *`,
            [employeeId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Order not found or not in Arrived status'
            });
        }

        res.json({
            success: true,
            message: 'Order signed and completed successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Sign order error:', error);
        res.status(500).json({
            error: 'Failed to sign order'
        });
    }
});

// @route   DELETE /api/warehouse/orders/:id
// @desc    Delete/cancel warehouse order
// @access  Private (Director only)
router.delete('/orders/:id', authorizeRole('Director'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if order can be deleted (only Pending or Rejected orders)
        const checkResult = await query(
            'SELECT status FROM warehouse_orders WHERE order_id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        const status = checkResult.rows[0].status;
        if (!['Pending Approval', 'Rejected'].includes(status)) {
            return res.status(400).json({
                error: 'Cannot delete orders that are in transit, arrived, or completed'
            });
        }

        const result = await query(
            'DELETE FROM warehouse_orders WHERE order_id = $1 RETURNING *',
            [id]
        );

        res.json({
            success: true,
            message: 'Order deleted successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Delete warehouse order error:', error);
        res.status(500).json({
            error: 'Failed to delete warehouse order'
        });
    }
});

// @route   GET /api/warehouse/stats/summary
// @desc    Get warehouse statistics
// @access  Private
router.get('/stats/summary', async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(CASE WHEN status = 'Pending Approval' THEN 1 END) as pending_approval,
                COUNT(CASE WHEN status = 'In Transit' THEN 1 END) as in_transit,
                COUNT(CASE WHEN status = 'Arrived' THEN 1 END) as arrived,
                COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'Rejected' THEN 1 END) as rejected,
                SUM(total_amount) as total_value,
                AVG(total_amount) as avg_order_value
            FROM warehouse_orders
        `);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get warehouse stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch statistics'
        });
    }
});

// @route   GET /api/warehouse/orders/pending
// @desc    Get orders pending approval
// @access  Private (Director only)
router.get('/orders/pending', authorizeRole('Director'), async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM warehouse_orders 
             WHERE status = 'Pending Approval'
             ORDER BY created_at ASC`
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get pending orders error:', error);
        res.status(500).json({
            error: 'Failed to fetch pending orders'
        });
    }
});

// @route   GET /api/warehouse/suppliers
// @desc    Get list of unique suppliers
// @access  Private
router.get('/suppliers', async (req, res) => {
    try {
        const result = await query(
            'SELECT DISTINCT supplier FROM warehouse_orders ORDER BY supplier'
        );

        res.json({
            success: true,
            data: result.rows.map(row => row.supplier)
        });

    } catch (error) {
        console.error('Get suppliers error:', error);
        res.status(500).json({
            error: 'Failed to fetch suppliers'
        });
    }
});

// @route   GET /api/warehouse/locations
// @desc    Get list of warehouse locations
// @access  Private
router.get('/locations', async (req, res) => {
    try {
        const result = await query(
            'SELECT DISTINCT warehouse_location, warehouse_type FROM warehouse_orders ORDER BY warehouse_location'
        );

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('Get warehouse locations error:', error);
        res.status(500).json({
            error: 'Failed to fetch warehouse locations'
        });
    }
});

module.exports = router;