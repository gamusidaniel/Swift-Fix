require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

async function seed() {
    const username = process.env.SEED_ADMIN_USERNAME || 'admin';
    const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@company.com';

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length) {
        console.log(`User '${username}' already exists — skipping.`);
        await pool.end();
        return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
        `INSERT INTO users (username, email, password, first_name, last_name, department, role, status)
         VALUES ($1, $2, $3, 'System', 'Administrator', 'IT Department', 'admin', 'active')`,
        [username, email, hashed]
    );

    console.log(`Admin user created: username="${username}" password="${password}"`);
    console.log('Log in and consider changing this password.');
    await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
