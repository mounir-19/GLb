// test-connection.js
require('dotenv').config();
const { Pool } = require('pg');

console.log('=== Testing Database Connection ===');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '***' : 'NOT SET');
console.log('===================================\n');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

pool.query('SELECT NOW() as current_time, current_database() as db_name', (err, res) => {
    if (err) {
        console.error('❌ Connection FAILED!');
        console.error('Error Code:', err.code);
        console.error('Error Message:', err.message);
        console.error('\nFull Error:', err);
    } else {
        console.log('✅ Connection SUCCESSFUL!');
        console.log('Database:', res.rows[0].db_name);
        console.log('Server Time:', res.rows[0].current_time);
    }
    pool.end();
});