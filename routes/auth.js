const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
    const username = (req.body.username || '').trim();
    const { password } = req.body;

    const result = await pool.query(
        "SELECT * FROM users WHERE username = $1 AND status = 'active'",
        [username]
    );
    const user = result.rows[0];

    if (user && await bcrypt.compare(password, user.password)) {
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role,
            department: user.department
        };
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
        const redirect = req.session.redirectUrl || '/dashboard';
        delete req.session.redirectUrl;
        return res.redirect(redirect);
    }

    res.render('login', { error: 'Invalid username or password.' });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
