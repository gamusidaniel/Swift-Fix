const { Pool } = require('pg');

// This Supabase project also hosts an unrelated HR app's tables in the
// `public` schema, so Swift Fix's tables live in their own `swift_fix`
// schema — set at connection time so every query resolves there by default.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    options: '-c search_path=swift_fix,public'
});

module.exports = pool;
