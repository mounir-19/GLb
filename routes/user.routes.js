// routes/user.routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

// Apply authentication to all user routes
router.use(authenticateToken);

// @route   GET /api/users/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await query(
            `SELECT 
                user_id, username, first_name, last_name, 
                email, phone, role, department, status, 
                hiring_date, created_at, last_login
             FROM users 
             WHERE user_id = $1`,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});

// @route   PUT /api/users/profile
// @desc    Update current user profile
// @access  Private
router.put('/profile', async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            firstName,
            lastName,
            email,
            phone,
            department
        } = req.body;

        // Build dynamic update query
        const updates = [];
        const params = [];
        let paramCount = 1;

        if (firstName) {
            updates.push(`first_name = $${paramCount}`);
            params.push(firstName);
            paramCount++;
        }

        if (lastName) {
            updates.push(`last_name = $${paramCount}`);
            params.push(lastName);
            paramCount++;
        }

        if (email) {
            updates.push(`email = $${paramCount}`);
            params.push(email);
            paramCount++;
        }

        if (phone) {
            updates.push(`phone = $${paramCount}`);
            params.push(phone);
            paramCount++;
        }

        if (department) {
            updates.push(`department = $${paramCount}`);
            params.push(department);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({
                error: 'No fields to update'
            });
        }

        params.push(userId);
        const queryText = `
            UPDATE users 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $${paramCount}
            RETURNING user_id, username, first_name, last_name, email, phone, role, department
        `;

        const result = await query(queryText, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Update profile error:', error);

        // Handle unique constraint violations
        if (error.code === '23505') {
            return res.status(409).json({
                error: 'Email already in use'
            });
        }

        res.status(500).json({
            error: 'Failed to update profile'
        });
    }
});

// @route   PUT /api/users/password
// @desc    Update user password
// @access  Private
router.put('/password', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        // Validation
        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({
                error: 'All password fields are required'
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                error: 'New passwords do not match'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'New password must be at least 6 characters'
            });
        }

        // Get current user
        const userResult = await query(
            'SELECT password_hash FROM users WHERE user_id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(
            currentPassword,
            userResult.rows[0].password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await query(
            'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
            [hashedPassword, userId]
        );

        res.json({
            success: true,
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({
            error: 'Failed to update password'
        });
    }
});

// @route   GET /api/users/preferences
// @desc    Get user preferences (placeholder for future implementation)
// @access  Private
router.get('/preferences', async (req, res) => {
    try {
        // Placeholder for user preferences
        // In a real app, you might have a separate preferences table
        res.json({
            success: true,
            data: {
                theme: 'light',
                language: 'en',
                notifications: {
                    email: true,
                    push: true
                }
            }
        });

    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({
            error: 'Failed to fetch preferences'
        });
    }
});

// @route   PUT /api/users/preferences
// @desc    Update user preferences (placeholder)
// @access  Private
router.put('/preferences', async (req, res) => {
    try {
        const preferences = req.body;

        // Placeholder - save to database in real implementation
        res.json({
            success: true,
            message: 'Preferences updated successfully',
            data: preferences
        });

    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({
            error: 'Failed to update preferences'
        });
    }
});

// @route   GET /api/users/activity
// @desc    Get user activity log
// @access  Private
router.get('/activity', async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get recent activities from various tables
        const activities = [];

        // Get warehouse orders created by user
        const ordersResult = await query(
            `SELECT 'order_created' as activity_type, order_id as reference_id, 
                    created_at as activity_date
             FROM warehouse_orders 
             WHERE requester_id = (SELECT employee_id FROM employees WHERE user_id = $1)
             ORDER BY created_at DESC 
             LIMIT 10`,
            [userId]
        );
        activities.push(...ordersResult.rows);

        // Get reports created by user
        const reportsResult = await query(
            `SELECT 'report_created' as activity_type, report_id::text as reference_id, 
                    created_at as activity_date
             FROM reports 
             WHERE author_id = (SELECT employee_id FROM employees WHERE user_id = $1)
             ORDER BY created_at DESC 
             LIMIT 10`,
            [userId]
        );
        activities.push(...reportsResult.rows);

        // Sort all activities by date
        activities.sort((a, b) => new Date(b.activity_date) - new Date(a.activity_date));

        res.json({
            success: true,
            count: activities.length,
            data: activities.slice(0, 20) // Return last 20 activities
        });

    } catch (error) {
        console.error('Get activity error:', error);
        res.status(500).json({
            error: 'Failed to fetch activity log'
        });
    }
});

// @route   GET /api/users/dashboard-stats
// @desc    Get personalized dashboard statistics for current user
// @access  Private
router.get('/dashboard-stats', async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;

        const stats = {};

        // Get employee ID
        const employeeResult = await query(
            'SELECT employee_id FROM employees WHERE user_id = $1',
            [userId]
        );

        if (employeeResult.rows.length > 0) {
            const employeeId = employeeResult.rows[0].employee_id;

            // Get user's order statistics
            const ordersResult = await query(
                `SELECT 
                    COUNT(*) as total_orders,
                    COUNT(CASE WHEN status = 'Pending Approval' THEN 1 END) as pending_orders,
                    COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_orders,
                    SUM(total_amount) as total_order_value
                 FROM warehouse_orders 
                 WHERE requester_id = $1`,
                [employeeId]
            );
            stats.orders = ordersResult.rows[0];

            // Get user's report statistics
            const reportsResult = await query(
                `SELECT 
                    COUNT(*) as total_reports,
                    COUNT(CASE WHEN priority = 'Urgent' THEN 1 END) as urgent_reports
                 FROM reports 
                 WHERE author_id = $1`,
                [employeeId]
            );
            stats.reports = reportsResult.rows[0];
        }

        // Role-specific stats
        if (userRole === 'Director' || userRole === 'Controller') {
            // Get unread urgent reports
            const urgentResult = await query(
                `SELECT COUNT(*) as unread_urgent
                 FROM reports 
                 WHERE priority = 'Urgent' AND is_read = false`
            );
            stats.urgent_reports = urgentResult.rows[0];

            // Get pending approvals
            const pendingResult = await query(
                `SELECT COUNT(*) as pending_approvals
                 FROM warehouse_orders 
                 WHERE status = 'Pending Approval'`
            );
            stats.pending_approvals = pendingResult.rows[0];
        }

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard statistics'
        });
    }
});

module.exports = router;