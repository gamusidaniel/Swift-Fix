require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const { exposeToViews } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

app.use(exposeToViews);

app.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));

app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/tickets', require('./routes/tickets'));
app.use('/admin', require('./routes/admin'));
app.use('/register', require('./routes/register'));

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Swift Fix running at http://localhost:${PORT}`));
