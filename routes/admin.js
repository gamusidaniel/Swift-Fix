const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../db/audit');

const router = express.Router();
const PRIORITY_ORDER = "CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END";

function popFlash(req) {
    const flash = { success: req.session.flashSuccess || null, error: req.session.flashError || null };
    delete req.session.flashSuccess;
    delete req.session.flashError;
    return flash;
}

router.get('/', requireAdmin, async (req, res) => {
    const tickets = (await pool.query(
        `SELECT t.*, u.username AS requester_username, u.first_name AS requester_first_name, u.last_name AS requester_last_name,
                a.first_name AS assigned_first_name, a.last_name AS assigned_last_name
         FROM tickets t JOIN users u ON t.user_id = u.id LEFT JOIN users a ON t.assigned_to = a.id
         ORDER BY ${PRIORITY_ORDER}, t.created_at DESC`
    )).rows;

    const users = (await pool.query(
        `SELECT id, username, email, first_name, last_name, role, status, department, phone, created_at
         FROM users ORDER BY role, created_at DESC`
    )).rows;

    const departments = (await pool.query('SELECT id, name FROM departments ORDER BY name ASC')).rows;

    const statsResult = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM users) AS total_users,
            (SELECT COUNT(*)::int FROM tickets) AS total_tickets,
            (SELECT COUNT(*)::int FROM tickets WHERE status='open') AS open_tickets,
            (SELECT COUNT(*)::int FROM tickets WHERE status='resolved') AS resolved_tickets
    `);

    res.render('admin/index', { tickets, users, departments, stats: statsResult.rows[0], currentUserId: req.session.user.id, ...popFlash(req) });
});

router.post('/tickets/:id/resolve', requireAdmin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const ticket = (await pool.query('SELECT user_id, ticket_number FROM tickets WHERE id=$1', [ticketId])).rows[0];
    if (!ticket) { req.session.flashError = 'Ticket not found.'; return res.redirect('/admin'); }

    await pool.query(
        "UPDATE tickets SET status='resolved', assigned_to=$1, resolved_at=NOW(), updated_at=NOW() WHERE id=$2",
        [req.session.user.id, ticketId]
    );
    await logActivity('ticket_resolved', req.session.user.id, ticketId);
    await pool.query(
        "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Ticket Resolved',$2,'success',$3)",
        [ticket.user_id, `Your ticket ${ticket.ticket_number} has been resolved.`, ticketId]
    );

    req.session.flashSuccess = 'Ticket marked as resolved.';
    res.redirect('/admin#tickets');
});

router.post('/tickets/:id/assign', requireAdmin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const assignedUser = req.body.assigned_user ? parseInt(req.body.assigned_user, 10) : req.session.user.id;

    await pool.query(
        "UPDATE tickets SET assigned_to=$1, status='in_progress', assigned_at=NOW(), updated_at=NOW() WHERE id=$2",
        [assignedUser, ticketId]
    );
    await logActivity('ticket_assigned', req.session.user.id, ticketId);
    await pool.query(
        "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Ticket Assigned','A ticket has been assigned to you.','info',$2)",
        [assignedUser, ticketId]
    );

    req.session.flashSuccess = 'Ticket assigned.';
    res.redirect('/admin#tickets');
});

router.post('/users/:id', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { first_name, last_name, email, phone, role, department } = req.body;
    const status = userId === req.session.user.id ? req.body.status_fallback : req.body.status;

    if (!first_name || !last_name || !email || !role || !status) {
        req.session.flashError = 'All required fields must be filled.';
        return res.redirect('/admin#users');
    }

    await pool.query(
        `UPDATE users SET first_name=$1, last_name=$2, email=$3, phone=$4, role=$5, status=$6, department=$7, updated_at=NOW()
         WHERE id=$8`,
        [first_name, last_name, email, phone || null, role, status, department || null, userId]
    );

    req.session.flashSuccess = 'User updated.';
    res.redirect('/admin#users');
});

router.post('/users/:id/delete', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.session.user.id) {
        req.session.flashError = "You can't delete your own account.";
        return res.redirect('/admin#users');
    }

    await pool.query('UPDATE tickets SET assigned_to = NULL WHERE assigned_to = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    req.session.flashSuccess = 'User deleted.';
    res.redirect('/admin#users');
});

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { new_password, confirm_password } = req.body;

    if (!new_password || new_password.length < 8 || new_password !== confirm_password) {
        req.session.flashError = 'Password must be at least 8 characters and match confirmation.';
        return res.redirect('/admin#users');
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hashed, userId]);

    req.session.flashSuccess = 'Password reset.';
    res.redirect('/admin#users');
});

module.exports = router;
