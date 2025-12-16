// routes/auth.routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth.middleware');

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validation
        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Username and password are required' 
            });
        }

        // Find user by username
        const result = await query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ 
                error: 'Invalid credentials' 
            });
        }

        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ 
                error: 'Invalid credentials' 
            });
        }

        // Check if user is active
        if (user.status !== 'Active') {
            return res.status(403).json({ 
                error: 'Account is not active' 
            });
        }

        // Update last login
        await query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1',
            [user.user_id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.user_id,
                username: user.username,
                role: user.role,
                email: user.email
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Send response
        res.json({
            message: 'Login successful',
            token,
            user: {
                userId: user.user_id,
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email,
                role: user.role,
                department: user.department
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            error: 'Login failed. Please try again.' 
        });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', authenticateToken, (req, res) => {
    // In a stateless JWT setup, logout is handled client-side by removing the token
    // If using refresh tokens or token blacklist, implement here
    res.json({ 
        message: 'Logout successful' 
    });
});

// @route   GET /api/auth/verify
// @desc    Verify token validity
// @access  Private
router.get('/verify', authenticateToken, (req, res) => {
    res.json({ 
        valid: true,
        user: req.user
    });
});
// Reset password for a specific user
router.post('/reset-password', async (req, res) => {
    try {
        const { username, newPassword } = req.body;

        console.log(`🔧 Resetting password for: ${username}`);
        console.log(`🔧 New password: ${newPassword}`);

        // Check if user exists
        const checkUser = await query(
            'SELECT user_id, username, role FROM users WHERE username = $1',
            [username]
        );

        if (checkUser.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                username
            });
        }

        // Generate new hash
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);

        console.log(`🔐 Generated hash: ${hash.substring(0, 30)}...`);

        // Update password
        const result = await query(
            'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username, role',
            [hash, username]
        );

        console.log(`✅ Password updated for ${result.rows[0].username}`);

        // Test the new password immediately
        const testMatch = await bcrypt.compare(newPassword, hash);
        console.log(`🧪 Password test: ${testMatch ? 'PASS ✅' : 'FAIL ❌'}`);

        res.json({
            success: true,
            message: 'Password reset successfully',
            user: result.rows[0],
            testPassed: testMatch
        });

    } catch (error) {
        console.error('❌ Error resetting password:', error);
        res.status(500).json({
            error: 'Failed to reset password',
            details: error.message
        });
    }
});
// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                error: 'Current and new password are required' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                error: 'Password must be at least 6 characters' 
            });
        }

        // Get current user
        const result = await query(
            'SELECT password_hash FROM users WHERE user_id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'User not found' 
            });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(
            currentPassword, 
            result.rows[0].password_hash
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
            message: 'Password changed successfully' 
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ 
            error: 'Failed to change password' 
        });
    }
});

module.exports = router;