-- Swift Fix — core-slice schema (Postgres / Supabase)
-- Isolated in its own schema since this Supabase project also hosts an
-- unrelated HR app's tables in `public` (users, departments, etc.).

CREATE SCHEMA IF NOT EXISTS swift_fix;
SET search_path TO swift_fix;

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    department VARCHAR(100),
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','it_staff','admin')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(20) UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('hardware','software','network','account','printer','email','other')),
    priority VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (priority IN ('low','medium','high','urgent')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','on_hold','resolved','closed','cancelled')),
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);

CREATE TABLE IF NOT EXISTS ticket_comments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_attachments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_logs(ticket_id);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warning','danger','ticket')),
    is_read BOOLEAN DEFAULT FALSE,
    related_ticket INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications(user_id, is_read);

INSERT INTO departments (name) VALUES
    ('IT Department'), ('Human Resources'), ('Finance'), ('Marketing'),
    ('Sales'), ('Operations'), ('Customer Service'), ('Research & Development')
ON CONFLICT (name) DO NOTHING;
