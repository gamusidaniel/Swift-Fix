const express = require('express');
const pool = require('../db/pool');
const { requireLogin, requireITStaff } = require('../middleware/auth');
const { logActivity } = require('../db/audit');
const { updateTicketStatus, priorityDueDays, generateTicketNumber } = require('../services/ticketStatus');
const upload = require('../middleware/upload');
const { safeMultiline } = require('../utils/html');

const router = express.Router();

const CATEGORIES = ['hardware', 'software', 'network', 'account', 'printer', 'email', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed', 'cancelled'];
const PRIORITY_ORDER = "CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END";

function popFlash(req) {
    const flash = { success: req.session.flashSuccess || null, error: req.session.flashError || null };
    delete req.session.flashSuccess;
    delete req.session.flashError;
    return flash;
}

// ── My Tickets ──────────────────────────────────────────────────────────
router.get('/mine', requireLogin, async (req, res) => {
    const userId = req.session.user.id;
    const status = req.query.status || 'all';
    const priority = req.query.priority || 'all';
    const category = req.query.category || 'all';

    const where = ['user_id = $1'];
    const params = [userId];
    if (status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
    if (priority !== 'all') { params.push(priority); where.push(`priority = $${params.length}`); }
    if (category !== 'all') { params.push(category); where.push(`category = $${params.length}`); }

    const tickets = (await pool.query(
        `SELECT t.*, a.username AS assigned_username, a.first_name AS assigned_first_name, a.last_name AS assigned_last_name
         FROM tickets t LEFT JOIN users a ON t.assigned_to = a.id
         WHERE ${where.join(' AND ')}
         ORDER BY ${PRIORITY_ORDER}, t.created_at DESC`,
        params
    )).rows;

    const stats = (await pool.query(
        `SELECT COUNT(*)::int AS total,
                SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open,
                SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END)::int AS in_progress,
                SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END)::int AS resolved
         FROM tickets WHERE user_id = $1`,
        [userId]
    )).rows[0];

    res.render('tickets/mine', { tickets, stats, filters: { status, priority, category }, CATEGORIES, PRIORITIES, ...popFlash(req) });
});

// ── New Ticket ──────────────────────────────────────────────────────────
router.get('/new', requireLogin, (req, res) => {
    res.render('tickets/new', { errors: [], formValues: {}, CATEGORIES, PRIORITIES });
});

router.post('/new', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const { category, priority } = req.body;
    const errors = [];

    const plainTextLen = description.replace(/<[^>]*>/g, '').trim().length;
    if (title.length < 5) errors.push('Title must be at least 5 characters.');
    if (plainTextLen < 10) errors.push('Description must be at least 10 characters.');
    if (!CATEGORIES.includes(category)) errors.push('Invalid category selected.');
    if (!PRIORITIES.includes(priority)) errors.push('Invalid priority selected.');

    if (errors.length) {
        return res.render('tickets/new', { errors, formValues: req.body, CATEGORIES, PRIORITIES });
    }

    const dueDays = priorityDueDays(priority);
    const inserted = await pool.query(
        `INSERT INTO tickets (user_id, title, description, category, priority, due_date)
         VALUES ($1, $2, $3, $4, $5, (NOW() + make_interval(days => $6))::date)
         RETURNING id`,
        [req.session.user.id, title, description, category, priority, dueDays]
    );
    const ticketId = inserted.rows[0].id;
    await generateTicketNumber(ticketId);
    await logActivity('ticket_created', req.session.user.id, ticketId);

    if (req.files && req.files.length) {
        for (const file of req.files) {
            await pool.query(
                `INSERT INTO ticket_attachments (ticket_id, user_id, file_name, file_path, file_size, mime_type)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [ticketId, req.session.user.id, file.originalname, `/uploads/${file.filename}`, file.size, file.mimetype]
            );
        }
    }

    try {
        const staff = (await pool.query("SELECT id FROM users WHERE role IN ('it_staff','admin') AND status = 'active'")).rows;
        const type = ['high', 'urgent'].includes(priority) ? 'danger' : 'ticket';
        const notifTitle = ['high', 'urgent'].includes(priority) ? `New ${priority[0].toUpperCase()}${priority.slice(1)} Priority Ticket` : 'New Ticket Submitted';
        const message = `New ${priority} priority ticket: ${title}`;
        for (const u of staff) {
            await pool.query(
                'INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,$2,$3,$4,$5)',
                [u.id, notifTitle, message, type, ticketId]
            );
        }
    } catch (err) {
        console.error('Notification error:', err.message);
    }

    req.session.flashSuccess = 'Ticket created successfully! You will be notified of updates.';
    res.redirect('/tickets/mine');
});

// ── Assigned Tickets (IT staff) ────────────────────────────────────────
router.get('/assigned', requireITStaff, async (req, res) => {
    const userId = req.session.user.id;
    const status = req.query.status || 'all';
    const priority = req.query.priority || 'all';
    const search = (req.query.search || '').trim();

    const where = ['t.assigned_to = $1'];
    const params = [userId];
    if (status !== 'all' && STATUSES.includes(status)) { params.push(status); where.push(`t.status = $${params.length}`); }
    if (priority !== 'all' && PRIORITIES.includes(priority)) { params.push(priority); where.push(`t.priority = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(t.title ILIKE $${params.length} OR t.ticket_number ILIKE $${params.length})`); }

    const tickets = (await pool.query(
        `SELECT t.*, u.username AS requester_username, u.first_name AS requester_first_name, u.last_name AS requester_last_name
         FROM tickets t JOIN users u ON t.user_id = u.id
         WHERE ${where.join(' AND ')}
         ORDER BY ${PRIORITY_ORDER}, t.created_at ASC`,
        params
    )).rows;

    const stats = (await pool.query(
        `SELECT COUNT(*)::int AS total,
                SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open,
                SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END)::int AS in_progress,
                SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END)::int AS resolved
         FROM tickets WHERE assigned_to = $1`,
        [userId]
    )).rows[0];

    const unassignedCount = (await pool.query("SELECT COUNT(*)::int AS c FROM tickets WHERE assigned_to IS NULL AND status='open'")).rows[0].c;

    res.render('tickets/assigned', { tickets, stats, unassignedCount, filters: { status, priority, search }, STATUSES, PRIORITIES, ...popFlash(req) });
});

router.post('/assigned/self-assign', requireITStaff, async (req, res) => {
    const ticketId = parseInt(req.body.ticket_id, 10);
    const result = await pool.query(
        "UPDATE tickets SET assigned_to=$1, status='in_progress', assigned_at=NOW(), updated_at=NOW() WHERE id=$2 AND assigned_to IS NULL RETURNING id",
        [req.session.user.id, ticketId]
    );
    if (result.rows.length) {
        await pool.query(
            "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Ticket Self-Assigned','You have assigned yourself to a ticket.','info',$2)",
            [req.session.user.id, ticketId]
        );
    }
    req.session.flashSuccess = 'Ticket assigned to you.';
    res.redirect('/tickets/assigned');
});

router.post('/assigned/:id/status', requireITStaff, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const newStatus = req.body.status;
    if (!STATUSES.includes(newStatus)) return res.redirect('/tickets/assigned');

    await pool.query(
        `UPDATE tickets SET status=$1, updated_at=NOW(),
            resolved_at = CASE WHEN $1 IN ('resolved','closed') THEN NOW() ELSE resolved_at END
         WHERE id=$2 AND assigned_to=$3`,
        [newStatus, ticketId, req.session.user.id]
    );
    res.redirect('/tickets/assigned');
});

// ── Unassigned Tickets (IT staff) ──────────────────────────────────────
router.get('/unassigned', requireITStaff, async (req, res) => {
    const priority = req.query.priority || 'all';
    const category = req.query.category || 'all';
    const search = (req.query.search || '').trim();

    const where = ['t.assigned_to IS NULL', "t.status = 'open'"];
    const params = [];
    if (priority !== 'all' && PRIORITIES.includes(priority)) { params.push(priority); where.push(`t.priority = $${params.length}`); }
    if (category !== 'all' && CATEGORIES.includes(category)) { params.push(category); where.push(`t.category = $${params.length}`); }
    if (search) {
        params.push(`%${search}%`);
        where.push(`(t.title ILIKE $${params.length} OR t.ticket_number ILIKE $${params.length} OR u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length})`);
    }

    const tickets = (await pool.query(
        `SELECT t.*, u.username AS requester_username, u.first_name AS requester_first_name, u.last_name AS requester_last_name
         FROM tickets t JOIN users u ON t.user_id = u.id
         WHERE ${where.join(' AND ')}
         ORDER BY ${PRIORITY_ORDER}, t.created_at ASC`,
        params
    )).rows;

    const priorityCountsRows = (await pool.query(
        "SELECT priority, COUNT(*)::int AS c FROM tickets WHERE assigned_to IS NULL AND status='open' GROUP BY priority"
    )).rows;
    const priorityCounts = {};
    let totalUnassigned = 0;
    for (const row of priorityCountsRows) { priorityCounts[row.priority] = row.c; totalUnassigned += row.c; }

    res.render('tickets/unassigned', { tickets, priorityCounts, totalUnassigned, filters: { priority, category, search }, CATEGORIES, PRIORITIES, ...popFlash(req) });
});

router.post('/unassigned/self-assign', requireITStaff, async (req, res) => {
    const ticketId = parseInt(req.body.ticket_id, 10);
    const result = await pool.query(
        "UPDATE tickets SET assigned_to=$1, status='in_progress', assigned_at=NOW(), updated_at=NOW() WHERE id=$2 AND assigned_to IS NULL AND status='open' RETURNING id, user_id, ticket_number",
        [req.session.user.id, ticketId]
    );
    if (result.rows.length) {
        const t = result.rows[0];
        await pool.query(
            "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Ticket Assigned',$2,'info',$3)",
            [t.user_id, `Your ticket ${t.ticket_number} has been assigned to an IT staff member.`, ticketId]
        );
        await logActivity('ticket_self_assigned', req.session.user.id, ticketId);
        req.session.flashSuccess = 'Ticket assigned to you.';
    } else {
        req.session.flashError = 'That ticket is no longer available.';
    }
    res.redirect('/tickets/unassigned');
});

// ── Ticket Details ─────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    if (!ticketId) return res.redirect('/tickets/mine');

    const ticketResult = await pool.query(
        `SELECT t.*, u.username AS created_by_username, u.first_name AS created_first_name, u.last_name AS created_last_name,
                u.email AS created_email, u.department AS created_department,
                a.username AS assigned_username, a.first_name AS assigned_first_name, a.last_name AS assigned_last_name, a.email AS assigned_email
         FROM tickets t JOIN users u ON t.user_id = u.id LEFT JOIN users a ON t.assigned_to = a.id
         WHERE t.id = $1`,
        [ticketId]
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) return res.redirect('/tickets/mine');

    const isITStaffUser = ['it_staff', 'admin'].includes(req.session.user.role);
    if (ticket.user_id !== req.session.user.id && !isITStaffUser) return res.redirect('/tickets/mine');

    const comments = (await pool.query(
        `SELECT c.*, u.username, u.first_name, u.last_name, u.role
         FROM ticket_comments c JOIN users u ON c.user_id = u.id
         WHERE c.ticket_id = $1 ORDER BY c.created_at ASC`,
        [ticketId]
    )).rows;

    const attachments = (await pool.query(
        'SELECT * FROM ticket_attachments WHERE ticket_id = $1 ORDER BY uploaded_at DESC',
        [ticketId]
    )).rows;

    ticket.descriptionHtml = safeMultiline(ticket.description);
    comments.forEach(c => { c.commentHtml = safeMultiline(c.comment); });

    res.render('tickets/details', { ticket, comments, attachments, STATUSES, ...popFlash(req) });
});

router.post('/:id/comment', requireLogin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const comment = (req.body.comment || '').trim();
    if (!comment) { req.session.flashError = 'Comment cannot be empty.'; return res.redirect(`/tickets/${ticketId}`); }

    const isITStaffUser = ['it_staff', 'admin'].includes(req.session.user.role);
    const isInternal = !!req.body.is_internal && isITStaffUser;

    await pool.query(
        'INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal) VALUES ($1,$2,$3,$4)',
        [ticketId, req.session.user.id, comment, isInternal]
    );
    await logActivity('comment_added', req.session.user.id, ticketId);

    if (!isInternal) {
        const ticket = (await pool.query('SELECT user_id, assigned_to, ticket_number FROM tickets WHERE id=$1', [ticketId])).rows[0];
        if (ticket) {
            const recipients = [...new Set([ticket.user_id, ticket.assigned_to].filter(id => id && id !== req.session.user.id))];
            for (const uid of recipients) {
                await pool.query(
                    "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'New Comment',$2,'info',$3)",
                    [uid, `New comment on ticket ${ticket.ticket_number}`, ticketId]
                );
            }
        }
    }

    req.session.flashSuccess = 'Comment added.';
    res.redirect(`/tickets/${ticketId}`);
});

// Status changes require IT staff — the original PHP left this route
// unguarded server-side (only hidden by the UI), so this tightens it.
router.post('/:id/status', requireITStaff, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const newStatus = req.body.status;
    if (!STATUSES.includes(newStatus)) return res.redirect(`/tickets/${ticketId}`);

    const ticket = (await pool.query('SELECT status, user_id, ticket_number FROM tickets WHERE id=$1', [ticketId])).rows[0];
    if (!ticket) return res.redirect('/tickets/mine');
    const oldStatus = ticket.status;

    await updateTicketStatus(ticketId, newStatus);
    await logActivity('status_changed', req.session.user.id, ticketId);

    await pool.query(
        "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Status Updated',$2,'info',$3)",
        [ticket.user_id, `Ticket status changed from ${oldStatus} to ${newStatus}`, ticketId]
    );

    req.session.flashSuccess = 'Ticket status updated.';
    res.redirect(`/tickets/${ticketId}`);
});

// ── Edit Ticket ─────────────────────────────────────────────────────────
router.get('/:id/edit', requireLogin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const ticket = (await pool.query('SELECT * FROM tickets WHERE id=$1', [ticketId])).rows[0];
    if (!ticket) return res.redirect('/tickets/mine');

    const isOwner = ticket.user_id === req.session.user.id;
    const isITStaffUser = ['it_staff', 'admin'].includes(req.session.user.role);
    const editable = ['open', 'on_hold'].includes(ticket.status);

    if (!isOwner && !isITStaffUser) return res.redirect('/tickets/mine');
    if (!editable && !isITStaffUser) {
        req.session.flashError = 'This ticket can no longer be edited.';
        return res.redirect(`/tickets/${ticketId}`);
    }

    res.render('tickets/edit', { ticket, errors: [], CATEGORIES, PRIORITIES, STATUSES });
});

router.post('/:id/edit', requireLogin, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    const ticket = (await pool.query('SELECT * FROM tickets WHERE id=$1', [ticketId])).rows[0];
    if (!ticket) return res.redirect('/tickets/mine');

    const isOwner = ticket.user_id === req.session.user.id;
    const isITStaffUser = ['it_staff', 'admin'].includes(req.session.user.role);
    const editable = ['open', 'on_hold'].includes(ticket.status);
    if (!isOwner && !isITStaffUser) return res.redirect('/tickets/mine');
    if (!editable && !isITStaffUser) return res.redirect(`/tickets/${ticketId}`);

    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const { category, priority } = req.body;
    const errors = [];
    const plainTextLen = description.replace(/<[^>]*>/g, '').trim().length;
    if (title.length < 5) errors.push('Title must be at least 5 characters.');
    if (plainTextLen < 10) errors.push('Description must be at least 10 characters.');
    if (!CATEGORIES.includes(category)) errors.push('Invalid category selected.');
    if (!PRIORITIES.includes(priority)) errors.push('Invalid priority selected.');

    if (errors.length) {
        return res.render('tickets/edit', { ticket: { ...ticket, title, description, category, priority }, errors, CATEGORIES, PRIORITIES, STATUSES });
    }

    const newStatus = (isITStaffUser && STATUSES.includes(req.body.status)) ? req.body.status : ticket.status;

    await pool.query(
        `UPDATE tickets SET title=$1, description=$2, category=$3, priority=$4, status=$5, updated_at=NOW(),
            resolved_at = CASE WHEN $5 IN ('resolved','closed') THEN NOW() ELSE resolved_at END
         WHERE id=$6`,
        [title, description, category, priority, newStatus, ticketId]
    );
    await logActivity('ticket_edited', req.session.user.id, ticketId);

    if (ticket.assigned_to && ticket.assigned_to !== req.session.user.id) {
        await pool.query(
            "INSERT INTO notifications (user_id, title, message, type, related_ticket) VALUES ($1,'Ticket Updated','A ticket assigned to you was edited.','info',$2)",
            [ticket.assigned_to, ticketId]
        );
    }

    req.session.flashSuccess = 'Ticket updated successfully.';
    res.redirect(`/tickets/${ticketId}`);
});

module.exports = router;
