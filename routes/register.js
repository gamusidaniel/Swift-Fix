const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
    const departments = (await pool.query('SELECT id, name FROM departments ORDER BY name ASC')).rows;
    res.render('register', { departments, success: null, error: null, formValues: {} });
});

router.post('/', requireAdmin, async (req, res) => {
    const departments = (await pool.query('SELECT id, name FROM departments ORDER BY name ASC')).rows;
    const { username, email, password, first_name, last_name } = req.body;
    const role = req.body.role || 'user';
    const department = req.body.department || '';

    if (!username || !email || !password || !first_name || !last_name) {
        return res.render('register', { departments, success: null, error: 'All fields are required.', formValues: req.body });
    }

    try {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username,email,password,first_name,last_name,role,department) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [username, email, hashed, first_name, last_name, role, department]
        );
        res.render('register', { departments, success: `User '${username}' created successfully.`, error: null, formValues: {} });
    } catch (err) {
        const message = err.code === '23505' ? 'Username or email already exists.' : 'Failed to create user.';
        res.render('register', { departments, success: null, error: message, formValues: req.body });
    }
});

module.exports = router;
