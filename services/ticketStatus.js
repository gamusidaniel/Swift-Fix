const pool = require('../db/pool');

const RESOLVED_STATUSES = ['resolved', 'closed'];

// Single source of truth for status transitions, used by every route that
// changes a ticket's status so resolved_at/assigned_at/updated_at stay
// consistent (the original PHP scattered this logic across several routes
// and one of them — edit_ticket.php — relied entirely on a MySQL trigger
// that has no Postgres equivalent).
async function updateTicketStatus(ticketId, newStatus, { assignedTo } = {}) {
    const setResolvedAt = RESOLVED_STATUSES.includes(newStatus);
    const result = await pool.query(
        `UPDATE tickets
         SET status = $1,
             updated_at = NOW(),
             resolved_at = CASE WHEN $1 = ANY($2::text[]) THEN NOW() ELSE resolved_at END,
             assigned_to = COALESCE($3, assigned_to),
             assigned_at = CASE WHEN $3 IS NOT NULL AND assigned_at IS NULL THEN NOW() ELSE assigned_at END
         WHERE id = $4
         RETURNING *`,
        [newStatus, RESOLVED_STATUSES, assignedTo ?? null, ticketId]
    );
    return result.rows[0];
}

function priorityDueDays(priority) {
    return { low: 14, medium: 7, high: 3, urgent: 1 }[priority] ?? 7;
}

async function generateTicketNumber(ticketId) {
    const number = 'TKT-' + new Date().toISOString().slice(0, 7).replace('-', '') + '-' + String(ticketId).padStart(5, '0');
    await pool.query('UPDATE tickets SET ticket_number = $1 WHERE id = $2', [number, ticketId]);
    return number;
}

module.exports = { updateTicketStatus, priorityDueDays, generateTicketNumber, RESOLVED_STATUSES };
