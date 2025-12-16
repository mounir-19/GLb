// routes/employee.routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, transaction } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth.middleware');

// Apply authentication to all employee routes
router.use(authenticateToken);

// @route   GET /api/employees/stats/summary
// @desc    Get employee statistics
// @access  Private
router.get('/stats/summary', async (req, res) => {
    try {
        const result = await query(`
            SELECT 
                COUNT(*) as total_employees,
                COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_employees,
                COUNT(CASE WHEN status = 'On leave' THEN 1 END) as on_leave,
                COUNT(CASE WHEN role = 'Agent' THEN 1 END) as agents,
                COUNT(CASE WHEN role = 'Advisor' THEN 1 END) as advisors,
                COUNT(CASE WHEN role = 'Controller' THEN 1 END) as controllers,
                COUNT(CASE WHEN role = 'Director' THEN 1 END) as directors
            FROM employees
        `);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get employee stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch statistics'
        });
    }
});

// @route   GET /api/employees
// @desc    Get all employees with optional filters
// @access  Private
router.get('/', async (req, res) => {
    try {
        const { role, status, search } = req.query;

        let queryText = 'SELECT * FROM employees WHERE 1=1';
        const params = [];
        let paramCount = 1;

        // Apply filters
        if (role && role !== 'All Roles') {
            queryText += ` AND role = $${paramCount}`;
            params.push(role);
            paramCount++;
        }

        if (status && status !== 'All') {
            queryText += ` AND status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (search) {
            queryText += ` AND (
                full_name ILIKE $${paramCount} OR 
                email ILIKE $${paramCount} OR 
                phone ILIKE $${paramCount} OR
                employee_id ILIKE $${paramCount}
            )`;
            params.push(`%${search}%`);
            paramCount++;
        }

        queryText += ' ORDER BY full_name ASC';

        const result = await query(queryText, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error('Get employees error:', error);
        res.status(500).json({
            error: 'Failed to fetch employees'
        });
    }
});

// @route   GET /api/employees/:id
// @desc    Get single employee by ID
// @access  Private
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'SELECT * FROM employees WHERE employee_id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Employee not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get employee error:', error);
        res.status(500).json({
            error: 'Failed to fetch employee'
        });
    }
});

// @route   POST /api/employees
// @desc    Create new employee
// @access  Private (Controller, Director only)
router.post('/', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const {
            firstName,
            familyName,
            username,
            password,
            hiringDate,
            role,
            phone,
            email
        } = req.body;

        console.log('Creating employee with data:', {
            firstName,
            familyName,
            username,
            role,
            email
        });

        // Validation
        if (!firstName || !familyName || !username || !password || !role) {
            return res.status(400).json({
                error: 'Missing required fields: firstName, familyName, username, password, role'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must be at least 6 characters'
            });
        }

        // Check if username already exists
        const usernameCheck = await query(
            'SELECT user_id FROM users WHERE username = $1',
            [username]
        );

        if (usernameCheck.rows.length > 0) {
            return res.status(409).json({
                error: 'Username already exists. Please choose a different username.'
            });
        }

        // Check if email already exists (only if email is provided)
        if (email) {
            const emailCheck = await query(
                'SELECT user_id FROM users WHERE email = $1',
                [email]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Email already exists. Please use a different email.'
                });
            }
        }

        // Use transaction to create both user and employee
        const result = await transaction(async (client) => {
            // Generate employee ID
            const countResult = await client.query(
                'SELECT COUNT(*) as count FROM employees'
            );
            const count = parseInt(countResult.rows[0].count) + 1;
            const employeeId = `EMP${String(count).padStart(4, '0')}`;

            // Generate unique email if not provided
            let employeeEmail = email;
            if (!employeeEmail) {
                // Create unique email using employee ID and timestamp
                const timestamp = Date.now();
                employeeEmail = `${username}.${timestamp}@algerietelecom.dz`;
            }

            const fullName = `${firstName.trim()} ${familyName.trim()}`;
            const employeePhone = phone || '+213 000 000 000';

            console.log('Generated employee ID:', employeeId);
            console.log('Generated email:', employeeEmail);

            // Hash password
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Create user account
            const userResult = await client.query(
                `INSERT INTO users (
                    username, 
                    password_hash, 
                    first_name, 
                    last_name, 
                    email, 
                    role, 
                    hiring_date,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING user_id`,
                [
                    username, 
                    hashedPassword, 
                    firstName, 
                    familyName, 
                    employeeEmail, 
                    role, 
                    hiringDate || new Date(),
                    'Active'
                ]
            );

            const userId = userResult.rows[0].user_id;
            console.log('Created user with ID:', userId);

            // Create employee record
            const employeeResult = await client.query(
                `INSERT INTO employees (
                    employee_id, 
                    user_id, 
                    first_name, 
                    last_name, 
                    full_name, 
                    email, 
                    phone, 
                    role, 
                    status, 
                    hiring_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [
                    employeeId, 
                    userId, 
                    firstName, 
                    familyName, 
                    fullName,
                    employeeEmail, 
                    employeePhone, 
                    role, 
                    'Active', 
                    hiringDate || new Date()
                ]
            );

            console.log('Created employee:', employeeResult.rows[0]);
            return employeeResult.rows[0];
        });

        res.status(201).json({
            success: true,
            message: 'Employee created successfully',
            data: result
        });

    } catch (error) {
        console.error('Create employee error:', error);
        console.error('Error details:', error.message);
        console.error('Error code:', error.code);

        // Handle unique constraint violations
        if (error.code === '23505') {
            if (error.constraint === 'users_username_key') {
                return res.status(409).json({
                    error: 'Username already exists. Please choose a different username.'
                });
            }
            if (error.constraint === 'users_email_key') {
                return res.status(409).json({
                    error: 'Email already exists. Please use a different email.'
                });
            }
            return res.status(409).json({
                error: 'A record with this information already exists.'
            });
        }

        res.status(500).json({
            error: 'Failed to create employee: ' + error.message
        });
    }
});

// @route   PUT /api/employees/:id
// @desc    Update employee
// @access  Private (Controller, Director only)
router.put('/:id', authorizeRole('Controller', 'Director'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstName,
            lastName,
            email,
            phone,
            role,
            status,
            password
        } = req.body;

        console.log('Updating employee:', id, 'with data:', req.body);

        // Use transaction to update both employee and user
        const result = await transaction(async (client) => {
            // Get employee's user_id
            const employeeResult = await client.query(
                'SELECT user_id FROM employees WHERE employee_id = $1',
                [id]
            );

            if (employeeResult.rows.length === 0) {
                throw new Error('Employee not found');
            }

            const userId = employeeResult.rows[0].user_id;

            // Build dynamic update query for employees table
            const employeeUpdates = [];
            const employeeParams = [];
            let paramCount = 1;

            if (firstName) {
                employeeUpdates.push(`first_name = $${paramCount}`);
                employeeParams.push(firstName);
                paramCount++;
            }

            if (lastName) {
                employeeUpdates.push(`last_name = $${paramCount}`);
                employeeParams.push(lastName);
                paramCount++;
            }

            if (firstName || lastName) {
                const fullName = `${firstName || ''} ${lastName || ''}`.trim();
                employeeUpdates.push(`full_name = $${paramCount}`);
                employeeParams.push(fullName);
                paramCount++;
            }

            if (email) {
                employeeUpdates.push(`email = $${paramCount}`);
                employeeParams.push(email);
                paramCount++;
            }

            if (phone) {
                employeeUpdates.push(`phone = $${paramCount}`);
                employeeParams.push(phone);
                paramCount++;
            }

            if (role) {
                employeeUpdates.push(`role = $${paramCount}`);
                employeeParams.push(role);
                paramCount++;
            }

            if (status) {
                employeeUpdates.push(`status = $${paramCount}`);
                employeeParams.push(status);
                paramCount++;
            }

            // Update employee record
            if (employeeUpdates.length > 0) {
                employeeParams.push(id);
                const employeeQueryText = `
                    UPDATE employees 
                    SET ${employeeUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                    WHERE employee_id = $${paramCount}
                    RETURNING *
                `;

                await client.query(employeeQueryText, employeeParams);
            }

            // Update user record
            const userUpdates = [];
            const userParams = [];
            let userParamCount = 1;

            if (firstName) {
                userUpdates.push(`first_name = $${userParamCount}`);
                userParams.push(firstName);
                userParamCount++;
            }

            if (lastName) {
                userUpdates.push(`last_name = $${userParamCount}`);
                userParams.push(lastName);
                userParamCount++;
            }

            if (email) {
                userUpdates.push(`email = $${userParamCount}`);
                userParams.push(email);
                userParamCount++;
            }

            if (role) {
                userUpdates.push(`role = $${userParamCount}`);
                userParams.push(role);
                userParamCount++;
            }

            if (status) {
                userUpdates.push(`status = $${userParamCount}`);
                userParams.push(status);
                userParamCount++;
            }

            // Handle password update
            if (password && password.length >= 6) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                userUpdates.push(`password_hash = $${userParamCount}`);
                userParams.push(hashedPassword);
                userParamCount++;
            }

            if (userUpdates.length > 0) {
                userParams.push(userId);
                const userQueryText = `
                    UPDATE users 
                    SET ${userUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = $${userParamCount}
                `;

                await client.query(userQueryText, userParams);
            }

            // Get updated employee data
            const updatedEmployee = await client.query(
                'SELECT * FROM employees WHERE employee_id = $1',
                [id]
            );

            return updatedEmployee.rows[0];
        });

        res.json({
            success: true,
            message: 'Employee updated successfully',
            data: result
        });

    } catch (error) {
        console.error('Update employee error:', error);

        if (error.message === 'Employee not found') {
            return res.status(404).json({
                error: 'Employee not found'
            });
        }

        // Handle unique constraint violations
        if (error.code === '23505') {
            if (error.constraint === 'users_email_key') {
                return res.status(409).json({
                    error: 'Email already exists. Please use a different email.'
                });
            }
            return res.status(409).json({
                error: 'A record with this information already exists.'
            });
        }

        res.status(500).json({
            error: 'Failed to update employee: ' + error.message
        });
    }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee (and associated user)
// @access  Private (Director only)
router.delete('/:id', authorizeRole('Director'), async (req, res) => {
    try {
        const { id } = req.params;

        console.log('Deleting employee:', id);

        // Use transaction to delete both employee and user records
        const result = await transaction(async (client) => {
            // First, get the user_id before deleting employee
            const employeeResult = await client.query(
                'SELECT user_id FROM employees WHERE employee_id = $1',
                [id]
            );

            if (employeeResult.rows.length === 0) {
                throw new Error('Employee not found');
            }

            const userId = employeeResult.rows[0].user_id;

            // Delete employee record
            const deletedEmployee = await client.query(
                `DELETE FROM employees 
                 WHERE employee_id = $1
                 RETURNING *`,
                [id]
            );

            // Delete associated user record
            if (userId) {
                await client.query(
                    'DELETE FROM users WHERE user_id = $1',
                    [userId]
                );
                console.log('Deleted user with ID:', userId);
            }

            return deletedEmployee.rows[0];
        });

        res.json({
            success: true,
            message: 'Employee permanently deleted',
            data: result
        });

    } catch (error) {
        console.error('Delete employee error:', error);

        if (error.message === 'Employee not found') {
            return res.status(404).json({
                error: 'Employee not found'
            });
        }

        res.status(500).json({
            error: 'Failed to delete employee: ' + error.message
        });
    }
});

module.exports = router;