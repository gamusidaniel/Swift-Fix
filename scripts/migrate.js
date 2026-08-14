require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function migrate() {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migration applied successfully.');
    await pool.end();
}

migrate().catch(err => {
    console.error('Migration failed:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    if (err.where) console.error('Where:', err.where);
    process.exit(1);
});
