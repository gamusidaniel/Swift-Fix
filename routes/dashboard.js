const express = require('express');
const pool = require('../db/pool');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
    const userId = req.session.user.id;

    const statsResult = await pool.query(
        `SELECT COUNT(*)::int AS total,
                SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open,
                SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END)::int AS resolved,
                SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END)::int AS in_progress
         FROM tickets WHERE user_id = $1`,
        [userId]
    );
    const stats = statsResult.rows[0];

    const recentResult = await pool.query(
        `SELECT t.*, a.username AS assigned_username, a.first_name AS assigned_first_name, a.last_name AS assigned_last_name
         FROM tickets t
         LEFT JOIN users a ON t.assigned_to = a.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC LIMIT 8`,
        [userId]
    );

    res.render('dashboard', {
        stats,
        tickets: recentResult.rows,
        success: req.session.flashSuccess || null
    });
    delete req.session.flashSuccess;
});

module.exports = router;
