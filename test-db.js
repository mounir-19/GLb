const { query } = require('./config/database');

(async () => {
    try {
        const res = await query('SELECT * FROM users LIMIT 5');
        console.log(res.rows);
    } catch (err) {
        console.error(err);
    }
})();
