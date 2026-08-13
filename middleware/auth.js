function isLoggedIn(req) {
    return !!req.session.user;
}

function isAdmin(req) {
    return req.session.user && req.session.user.role === 'admin';
}

function isITStaff(req) {
    return req.session.user && ['it_staff', 'admin'].includes(req.session.user.role);
}

function requireLogin(req, res, next) {
    if (!isLoggedIn(req)) {
        req.session.redirectUrl = req.originalUrl;
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!isLoggedIn(req)) {
        req.session.redirectUrl = req.originalUrl;
        return res.redirect('/login');
    }
    if (!isAdmin(req)) return res.redirect('/dashboard');
    next();
}

function requireITStaff(req, res, next) {
    if (!isLoggedIn(req)) {
        req.session.redirectUrl = req.originalUrl;
        return res.redirect('/login');
    }
    if (!isITStaff(req)) return res.redirect('/dashboard');
    next();
}

// Makes role helpers (and the navbar's unread-notification badge) available
// in every EJS view without each route having to pass them explicitly.
async function exposeToViews(req, res, next) {
    res.locals.currentUser = req.session.user || null;
    res.locals.isLoggedIn = isLoggedIn(req);
    res.locals.isAdmin = isAdmin(req);
    res.locals.isITStaff = isITStaff(req);
    res.locals.unreadNotifications = 0;
    res.locals.activePath = req.path;

    if (isITStaff(req)) {
        try {
            const pool = require('../db/pool');
            const result = await pool.query(
                'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false',
                [req.session.user.id]
            );
            res.locals.unreadNotifications = result.rows[0].c;
        } catch (err) {
            console.error('Notification count error:', err.message);
        }
    }
    next();
}

module.exports = { isLoggedIn, isAdmin, isITStaff, requireLogin, requireAdmin, requireITStaff, exposeToViews };
