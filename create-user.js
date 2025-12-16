const bcrypt = require("bcrypt");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const users = [
    {
        username: "director01",
        password: "password123",
        first_name: "Mohamed",
        last_name: "Larbi",
        email: "mohamed.larbi@company.com",
        phone: "+213 555 123 456",
        role: "Director",
        department: "Operations",
    },
    {
        username: "advisor01",
        password: "password123",
        first_name: "Adel",
        last_name: "Bensalem",
        email: "adel.bensalem@company.com",
        phone: "+213 555 222 333",
        role: "Advisor",
        department: "Advisory",
    },
    {
        username: "controller01",
        password: "password123",
        first_name: "Karim",
        last_name: "Mansouri",
        email: "karim.mansouri@company.com",
        phone: "+213 555 444 555",
        role: "Controller",
        department: "Quality Assurance",
    }
];

async function createOrUpdateUser(user) {
    try {
        const hashedPassword = await bcrypt.hash(user.password, 10);

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, first_name, last_name, email, phone, role, department, hiring_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING user_id, username, email, role`,
            [
                user.username,
                hashedPassword,
                user.first_name,
                user.last_name,
                user.email,
                user.phone,
                user.role,
                user.department,
                new Date()
            ]
        );

        console.log(`\n✅ User created: ${user.username}`);
        console.log(result.rows[0]);
        console.log("Password:", user.password);

    } catch (error) {
        if (error.code === "23505") {
            console.log(`\n⚠️ User '${user.username}' already exists → updating password...`);

            const hashedPassword = await bcrypt.hash(user.password, 10);

            await pool.query(
                `UPDATE users SET password_hash = $1 WHERE username = $2`,
                [hashedPassword, user.username]
            );

            console.log(`✅ Password updated for ${user.username}`);
            console.log("Password:", user.password);
        } else {
            console.error(`❌ Error for user ${user.username}:`, error.message);
        }
    }
}

async function main() {
    for (const user of users) {
        await createOrUpdateUser(user);
    }

    console.log("\n🎉 All users processed.");
    process.exit(0);
}

main();
