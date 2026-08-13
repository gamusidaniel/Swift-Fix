const pool = require('./pool');

async function logActivity(action, userId, ticketId = null) {
    try {
        await pool.query(
            'INSERT INTO audit_logs (ticket_id, action, user_id) VALUES ($1, $2, $3)',
            [ticketId, action, userId]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

module.exports = { logActivity };
