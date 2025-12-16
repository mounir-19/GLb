-- =====================================================
-- Database Schema for Algerie Telecom Management System
-- Generated from React Application Analysis
-- =====================================================

-- Drop existing tables if they exist (in correct order due to foreign keys)
DROP TABLE IF EXISTS sales_data CASCADE;

DROP TABLE IF EXISTS reports CASCADE;

DROP TABLE IF EXISTS warehouse_orders CASCADE;

DROP TABLE IF EXISTS articles CASCADE;

DROP TABLE IF EXISTS employees CASCADE;

DROP TABLE IF EXISTS users CASCADE;

-- =====================================================
-- USERS TABLE (Authentication)
-- =====================================================
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL CHECK (
        role IN (
            'Director',
            'Controller',
            'Advisor',
            'Agent'
        )
    ),
    department VARCHAR(100),
    status VARCHAR(20) DEFAULT 'Active' CHECK (
        status IN (
            'Active',
            'On leave',
            'Inactive'
        )
    ),
    hiring_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- =====================================================
-- EMPLOYEES TABLE (Personnel Management)
-- =====================================================
CREATE TABLE employees (
    employee_id VARCHAR(20) PRIMARY KEY, -- Format: EMP001, EMP002, etc.
    user_id INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (
        role IN (
            'Agent',
            'Advisor',
            'Controller',
            'Director'
        )
    ),
    status VARCHAR(20) DEFAULT 'Active' CHECK (
        status IN (
            'Active',
            'On leave',
            'Inactive'
        )
    ),
    hiring_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ARTICLES TABLE (Inventory Management)
-- =====================================================
CREATE TABLE articles (
    article_id VARCHAR(20) PRIMARY KEY, -- Format: ART001, ART002, etc.
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (
        type IN ('Subscription', 'Hardware')
    ),
    service VARCHAR(50) NOT NULL CHECK (
        service IN ('Internet', 'Telephone')
    ),
    client_type VARCHAR(50) NOT NULL CHECK (
        client_type IN ('Residential', 'Professional')
    ),
    price DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'DA',
    stock INTEGER, -- NULL for Hardware items (N/A in the UI)
    stock_status VARCHAR(20) GENERATED ALWAYS AS (
        CASE
            WHEN stock IS NULL THEN 'N/A'
            WHEN stock <= 5 THEN 'Critical'
            WHEN stock <= 20 THEN 'Low'
            ELSE 'Good'
        END
    ) STORED,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- WAREHOUSE_ORDERS TABLE (Purchase Orders & Deliveries)
-- =====================================================
CREATE TABLE warehouse_orders (
    order_id VARCHAR(20) PRIMARY KEY, -- Format: PO-2024-001
    requester_id VARCHAR(20) REFERENCES employees (employee_id) ON DELETE SET NULL,
    requester_name VARCHAR(255) NOT NULL,
    supplier VARCHAR(255) NOT NULL,
    warehouse_location VARCHAR(100) NOT NULL,
    warehouse_type VARCHAR(100) NOT NULL CHECK (
        warehouse_type IN (
            'Central Warehouse',
            'Distribution Center',
            'Regional Warehouse'
        )
    ),
    total_amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'DA',
    item_count INTEGER NOT NULL DEFAULT 1,
    expected_delivery_date DATE NOT NULL,
    arrived_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending Approval' CHECK (
        status IN (
            'Pending Approval',
            'In Transit',
            'Arrived',
            'Completed',
            'Rejected'
        )
    ),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signed_at TIMESTAMP,
    signed_by VARCHAR(20) REFERENCES employees (employee_id) ON DELETE SET NULL
);
-- 1) Enable UUID generation (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) Suspicious flags table
CREATE TABLE IF NOT EXISTS sale_flags (
    flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    sale_id INTEGER NULL REFERENCES sales (sale_id) ON DELETE SET NULL,
    advisor_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    severity TEXT NOT NULL CHECK (
        severity IN ('LOW', 'MEDIUM', 'HIGH')
    ),
    title TEXT NOT NULL,
    description TEXT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
        status IN (
            'OPEN',
            'REVIEWED',
            'RESOLVED'
        )
    ),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMP NULL,
    reviewed_by INTEGER NULL REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_flags_advisor ON sale_flags (advisor_id);

CREATE INDEX IF NOT EXISTS idx_sale_flags_status ON sale_flags (status);

CREATE INDEX IF NOT EXISTS idx_sale_flags_sale ON sale_flags (sale_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_flags_dedupe ON sale_flags (advisor_id, sale_id, title);

ALTER TABLE sale_flags
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS reviewed_by INT;

CREATE TABLE IF NOT EXISTS warehouse_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(20) NOT NULL REFERENCES warehouse_orders (order_id) ON DELETE CASCADE,
    article_id VARCHAR(20) NOT NULL REFERENCES articles (article_id),
    quantity_received INTEGER NOT NULL CHECK (quantity_received >= 0),
    quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
    unit_price DECIMAL(12, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_woi_article_id ON warehouse_order_items (article_id);

CREATE INDEX IF NOT EXISTS idx_woi_order_id ON warehouse_order_items (order_id);

-- =====================================================
-- REPORTS TABLE (System Reports)
-- =====================================================
CREATE TABLE reports (
    report_id SERIAL PRIMARY KEY,
    author_id VARCHAR(20) REFERENCES employees (employee_id) ON DELETE SET NULL,
    author_name VARCHAR(255) NOT NULL,
    author_role VARCHAR(50) NOT NULL,
    department VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    summary TEXT NOT NULL,
    full_content TEXT,
    priority VARCHAR(20) DEFAULT 'Normal' CHECK (
        priority IN (
            'Normal',
            'Urgent',
            'High',
            'Low'
        )
    ),
    category VARCHAR(100) NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    report_time TIME NOT NULL DEFAULT CURRENT_TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SALES_DATA TABLE (Dashboard Analytics)
-- =====================================================
CREATE TABLE sales_data (
    sales_id SERIAL PRIMARY KEY,
    month VARCHAR(20) NOT NULL,
    year INTEGER NOT NULL,
    subscription_revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
    hardware_revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_revenue DECIMAL(12, 2) GENERATED ALWAYS AS (
        subscription_revenue + hardware_revenue
    ) STORED,
    currency VARCHAR(10) DEFAULT 'DA',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (month, year)
);

-- =====================================================
-- INDEXES for Performance Optimization
-- =====================================================

-- Users indexes
CREATE INDEX idx_users_email ON users (email);

CREATE INDEX idx_users_username ON users (username);

CREATE INDEX idx_users_role ON users (role);

CREATE INDEX idx_users_status ON users (status);

-- Employees indexes
CREATE INDEX idx_employees_email ON employees (email);

CREATE INDEX idx_employees_role ON employees (role);

CREATE INDEX idx_employees_status ON employees (status);

CREATE INDEX idx_employees_user_id ON employees (user_id);

-- Articles indexes
CREATE INDEX idx_articles_type ON articles(type);

CREATE INDEX idx_articles_service ON articles (service);

CREATE INDEX idx_articles_client_type ON articles (client_type);

CREATE INDEX idx_articles_name ON articles (name);

CREATE INDEX idx_articles_is_active ON articles (is_active);

-- Warehouse Orders indexes
CREATE INDEX idx_warehouse_orders_status ON warehouse_orders (status);

CREATE INDEX idx_warehouse_orders_requester ON warehouse_orders (requester_id);

CREATE INDEX idx_warehouse_orders_expected_date ON warehouse_orders (expected_delivery_date);

CREATE INDEX idx_warehouse_orders_supplier ON warehouse_orders (supplier);

CREATE INDEX idx_warehouse_orders_location ON warehouse_orders (warehouse_location);

-- Reports indexes
CREATE INDEX idx_reports_author ON reports (author_id);

CREATE INDEX idx_reports_department ON reports (department);

CREATE INDEX idx_reports_priority ON reports (priority);

CREATE INDEX idx_reports_is_read ON reports (is_read);

CREATE INDEX idx_reports_date ON reports (report_date);

CREATE INDEX idx_reports_category ON reports (category);

-- Sales Data indexes
CREATE INDEX idx_sales_data_month_year ON sales_data (month, year);

CREATE INDEX idx_sales_data_year ON sales_data (year);

-- =====================================================
-- TRIGGERS for Automatic Timestamp Updates
-- =====================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_orders_updated_at BEFORE UPDATE ON warehouse_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_data_updated_at BEFORE UPDATE ON sales_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SAMPLE DATA (Based on React Code Initial Data)
-- =====================================================
-- Clients table
CREATE TABLE clients (
    client_id SERIAL PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    location VARCHAR(255),
    client_type VARCHAR(50) NOT NULL CHECK (
        client_type IN ('Residential', 'Professional')
    ),
    is_existing_client BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users (user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sales transactions table
CREATE TABLE sales (
    sale_id SERIAL PRIMARY KEY,
    reference VARCHAR(50) UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients (client_id),
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(20),
    client_type VARCHAR(50) CHECK (
        client_type IN ('Residential', 'Professional')
    ),
    total_amount DECIMAL(12, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'Draft' CHECK (
        status IN (
            'Draft',
            'Validated',
            'Completed',
            'Cancelled'
        )
    ),
    notes TEXT,
    sale_date DATE DEFAULT CURRENT_DATE,
    validated_at TIMESTAMP,
    validated_by INTEGER REFERENCES users (user_id),
    completed_at TIMESTAMP,
    created_by INTEGER REFERENCES users (user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sale items table
CREATE TABLE sale_items (
    item_id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales (sale_id) ON DELETE CASCADE,
    article_id VARCHAR(20) REFERENCES articles (article_id),
    article_name VARCHAR(255) NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(12, 2) NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices table
CREATE TABLE invoices (
    invoice_id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    sale_id INTEGER REFERENCES sales (sale_id),
    sale_reference VARCHAR(50),
    client_id INTEGER REFERENCES clients (client_id),
    client_name VARCHAR(255) NOT NULL,
    client_phone VARCHAR(20),
    client_type VARCHAR(50),
    amount DECIMAL(12, 2) NOT NULL,
    paid_amount DECIMAL(12, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (
        status IN ('Pending', 'Paid', 'Overdue')
    ),
    issue_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    paid_date DATE,
    created_by INTEGER REFERENCES users (user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_clients_phone ON clients (phone);

CREATE INDEX idx_clients_type ON clients (client_type);

CREATE INDEX idx_sales_reference ON sales (reference);

CREATE INDEX idx_sales_status ON sales (status);

CREATE INDEX idx_sales_date ON sales (sale_date);

CREATE INDEX idx_sales_client ON sales (client_id);

CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);

CREATE INDEX idx_invoices_sale ON invoices (sale_id);

CREATE INDEX idx_invoices_client ON invoices (client_id);

CREATE INDEX idx_invoices_status ON invoices (status);

-- Function to generate sale reference
CREATE OR REPLACE FUNCTION generate_sale_reference()
RETURNS VARCHAR AS $$
DECLARE
    current_year INTEGER;
    next_num INTEGER;
BEGIN
    current_year := EXTRACT(YEAR FROM CURRENT_DATE);
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 11) AS INTEGER)), 0) + 1
    INTO next_num
    FROM sales
    WHERE reference LIKE 'SALE-' || current_year || '-%';
    RETURN 'SALE-' || current_year || '-' || LPAD(next_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS VARCHAR AS $$
DECLARE
    current_year INTEGER;
    next_num INTEGER;
BEGIN
    current_year := EXTRACT(YEAR FROM CURRENT_DATE);
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER)), 0) + 1
    INTO next_num
    FROM invoices
    WHERE invoice_number LIKE 'INV-' || current_year || '-%';
    RETURN 'INV-' || current_year || '-' || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Triggers
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data
INSERT INTO
    clients (
        client_name,
        phone,
        client_type,
        location
    )
VALUES (
        'Ahmed Benali',
        '+213 555 123 456',
        'Residential',
        'Algiers'
    ),
    (
        'Sarah Meziane',
        '+213 555 234 567',
        'Residential',
        'Oran'
    ),
    (
        'Entreprise Global Tech SARL',
        '+213 555 345 678',
        'Professional',
        'Algiers'
    ),
    (
        'Leila Boudiaf',
        '+213 555 456 789',
        'Residential',
        'Constantine'
    );

INSERT INTO
    sales (
        reference,
        client_id,
        client_name,
        client_phone,
        client_type,
        total_amount,
        status,
        sale_date
    )
VALUES (
        'SALE-2024-001',
        1,
        'Ahmed Benali',
        '+213 555 123 456',
        'Residential',
        6000,
        'Completed',
        CURRENT_DATE
    ),
    (
        'SALE-2024-002',
        2,
        'Sarah Meziane',
        '+213 555 234 567',
        'Residential',
        8900,
        'Completed',
        CURRENT_DATE
    ),
    (
        'SALE-2024-003',
        4,
        'Leila Boudiaf',
        '+213 555 456 789',
        'Residential',
        4200,
        'Validated',
        CURRENT_DATE
    );
-- Insert sample employees
INSERT INTO
    employees (
        employee_id,
        first_name,
        last_name,
        full_name,
        email,
        phone,
        role,
        status,
        hiring_date
    )
VALUES (
        'EMP001',
        'Karim',
        'Bendaoud',
        'Karim Bendaoud',
        'k.bendaoud@algerietelecom.dz',
        '+213 551 234 567',
        'Controller',
        'Active',
        '2020-01-15'
    ),
    (
        'EMP002',
        'Fatima',
        'Zerouali',
        'Fatima Zerouali',
        'f.zerouali@algerietelecom.dz',
        '+213 661 345 678',
        'Controller',
        'Active',
        '2019-06-20'
    ),
    (
        'EMP003',
        'Ahmed',
        'Benali',
        'Ahmed Benali',
        'a.benali@algerietelecom.dz',
        '+213 771 456 789',
        'Agent',
        'On leave',
        '2021-03-10'
    ),
    (
        'EMP004',
        'Samira',
        'Khelifi',
        'Samira Khelifi',
        's.khelifi@algerietelecom.dz',
        '+213 551 567 890',
        'Advisor',
        'Active',
        '2020-09-05'
    ),
    (
        'EMP005',
        'Youcef',
        'Mammeri',
        'Youcef Mammeri',
        'y.mammeri@algerietelecom.dz',
        '+213 661 678 901',
        'Agent',
        'On leave',
        '2022-01-20'
    ),
    (
        'EMP006',
        'Nassima',
        'Boudiaf',
        'Nassima Boudiaf',
        'n.boudiaf@algerietelecom.dz',
        '+213 771 789 012',
        'Advisor',
        'Active',
        '2019-11-15'
    ),
    (
        'EMP007',
        'Rachid',
        'Hamidi',
        'Rachid Hamidi',
        'r.hamidi@algerietelecom.dz',
        '+213 551 890 123',
        'Advisor',
        'Active',
        '2021-07-01'
    ),
    (
        'EMP008',
        'Leila',
        'Benaissa',
        'Leila Benaissa',
        'l.benaissa@algerietelecom.dz',
        '+213 661 901 234',
        'Controller',
        'Active',
        '2020-04-12'
    );

-- Insert sample articles
INSERT INTO
    articles (
        article_id,
        name,
        full_name,
        type,
        service,
        client_type,
        price,
        stock
    )
VALUES (
        'ART001',
        'ADSL 4 Mbps',
        'ADSL 4 Mbps',
        'Subscription',
        'Internet',
        'Residential',
        1590.00,
        129
    ),
    (
        'ART002',
        'Fibre Optique 100 Mbps',
        'Fibre Optique 100 Mbps',
        'Subscription',
        'Internet',
        'Professional',
        8900.00,
        30
    ),
    (
        'ART003',
        'Ligne Téléphonique Fixe',
        'Ligne Téléphonique Fixe',
        'Subscription',
        'Telephone',
        'Residential',
        500.00,
        2
    ),
    (
        'ART004',
        'Modem ADSL TP-Link',
        'Modem ADSL TP-Link',
        'Hardware',
        'Internet',
        'Residential',
        4500.00,
        NULL
    ),
    (
        'ART005',
        'Téléphone IP Cisco',
        'Téléphone IP Cisco',
        'Hardware',
        'Telephone',
        'Professional',
        12000.00,
        NULL
    ),
    (
        'ART006',
        'ONT Fibre Huawei',
        'ONT Fibre Huawei',
        'Hardware',
        'Internet',
        'Professional',
        8500.00,
        68
    ),
    (
        'ART007',
        'ADSL 20 Mbps',
        'ADSL 20 Mbps',
        'Subscription',
        'Internet',
        'Professional',
        4200.00,
        45
    );

-- Insert sample warehouse orders
INSERT INTO
    warehouse_orders (
        order_id,
        requester_id,
        requester_name,
        supplier,
        warehouse_location,
        warehouse_type,
        total_amount,
        item_count,
        expected_delivery_date,
        arrived_date,
        status
    )
VALUES (
        'PO-2024-001',
        'EMP001',
        'Karim Mansouri',
        'TP-Link Algeria',
        'Algiers',
        'Central Warehouse',
        480000.00,
        2,
        '2024-11-28',
        NULL,
        'Pending Approval'
    ),
    (
        'PO-2024-002',
        'EMP004',
        'Amina Belkacem',
        'TP-Link Algeria',
        'Oran',
        'Distribution Center',
        850000.00,
        1,
        '2024-11-30',
        '2024-11-27',
        'Arrived'
    ),
    (
        'PO-2024-003',
        'EMP001',
        'Karim Mansouri',
        'TP-Link Algeria',
        'Algiers',
        'Central Warehouse',
        480000.00,
        2,
        '2024-11-28',
        '2024-11-27',
        'Completed'
    ),
    (
        'PO-2024-004',
        'EMP001',
        'Karim Mansouri',
        'TP-Link Algeria',
        'Algiers',
        'Central Warehouse',
        480000.00,
        2,
        '2024-11-28',
        NULL,
        'In Transit'
    ),
    (
        'PO-2024-005',
        'EMP001',
        'Karim Mansouri',
        'TP-Link Algeria',
        'Algiers',
        'Central Warehouse',
        480000.00,
        2,
        '2024-11-28',
        NULL,
        'Rejected'
    );

-- Insert sample reports
INSERT INTO
    reports (
        author_id,
        author_name,
        author_role,
        department,
        title,
        summary,
        priority,
        category,
        is_read,
        report_date,
        report_time
    )
VALUES (
        'EMP001',
        'Karim Mansouri',
        'Controller',
        'Quality Assurance',
        'Monthly Quality Assurance Report - November 2024',
        'Quality audit completed for all warehouses. Overall compliance rate: 94.5%. Issues identified in Oran warehouse requiring immediate attention...',
        'Urgent',
        'Quality Assurance',
        FALSE,
        '2024-11-28',
        '09:30:00'
    ),
    (
        'EMP002',
        'Riad Djelloul',
        'Controller',
        'Operations',
        'Weekly Warehouse Operations Summary',
        'Operations running smoothly across all facilities. Delivery completion rate: 97.2%. Minor delays in Constantine due to vehicle maintenance...',
        'Normal',
        'Operations',
        TRUE,
        '2024-11-27',
        '14:15:00'
    ),
    (
        'EMP004',
        'Amina Belkacem',
        'Controller',
        'Customer Service',
        'Customer Satisfaction Analysis - Q4 2024',
        'Customer satisfaction scores show improvement. NPS score: +42. Main concerns: delivery times and technical support response. Detailed breakdown included...',
        'Normal',
        'Customer Service',
        TRUE,
        '2024-11-26',
        '11:20:00'
    ),
    (
        'EMP001',
        'Karim Mansouri',
        'Controller',
        'Quality Assurance',
        'Urgent: Equipment Quality Issue - Batch HW-MDM-245',
        'URGENT: Quality control identified defective modem batch. 23 units affected. Immediate recall recommended. Full details and action plan attached...',
        'Urgent',
        'Quality Alert',
        FALSE,
        '2024-11-25',
        '16:45:00'
    ),
    (
        'EMP002',
        'Riad Djelloul',
        'Controller',
        'Operations',
        'Monthly Inventory Status Report',
        'Inventory levels healthy across all categories. Stock turnover rate: 4.2x. Low stock alert for 3 items. Recommended reorder quantities included...',
        'Normal',
        'Inventory',
        TRUE,
        '2024-11-24',
        '10:00:00'
    );

-- Insert sample sales data
INSERT INTO
    sales_data (
        month,
        year,
        subscription_revenue,
        hardware_revenue
    )
VALUES ('Jan', 2025, 4800.00, 4000.00),
    ('Feb', 2025, 3200.00, 5000.00),
    ('Mar', 2025, 5800.00, 4200.00),
    ('Apr', 2025, 4500.00, 5200.00),
    ('May', 2025, 4800.00, 4600.00),
    ('Jun', 2025, 4400.00, 5000.00),
    ('Jul', 2025, 6200.00, 7200.00);

-- Insert sample user (for authentication)
INSERT INTO
    users (
        username,
        password_hash,
        first_name,
        last_name,
        email,
        phone,
        role,
        department,
        hiring_date
    )
VALUES (
        'director01',
        '$2a$10$example_hash_here',
        'Mohamed',
        'Larbi',
        'mohamed.larbi@company.com',
        '+213 555 123 456',
        'Director',
        'Operations',
        '2018-01-01'
    );

-- =====================================================
-- VIEWS for Common Queries
-- =====================================================

-- View for active employees with full details
CREATE OR REPLACE VIEW v_active_employees AS
SELECT
    e.employee_id,
    e.full_name,
    e.email,
    e.phone,
    e.role,
    e.status,
    e.hiring_date,
    EXTRACT(
        YEAR
        FROM AGE (CURRENT_DATE, e.hiring_date)
    ) as years_of_service
FROM employees e
WHERE
    e.status = 'Active'
ORDER BY e.full_name;

-- View for inventory status summary
CREATE OR REPLACE VIEW v_inventory_summary AS
SELECT
    type,
    service,
    client_type,
    COUNT(*) as article_count,
    SUM(
        CASE
            WHEN stock IS NOT NULL THEN stock
            ELSE 0
        END
    ) as total_stock,
    AVG(price) as avg_price
FROM articles
WHERE
    is_active = TRUE
GROUP BY
    type,
    service,
    client_type;

-- View for warehouse orders dashboard
CREATE OR REPLACE VIEW v_warehouse_orders_summary AS
SELECT
    status,
    COUNT(*) as order_count,
    SUM(total_amount) as total_amount,
    AVG(total_amount) as avg_order_value
FROM warehouse_orders
GROUP BY
    status;

-- View for unread urgent reports
CREATE OR REPLACE VIEW v_urgent_reports AS
SELECT r.report_id, r.author_name, r.department, r.title, r.summary, r.report_date, r.report_time
FROM reports r
WHERE
    r.is_read = FALSE
    AND r.priority = 'Urgent'
ORDER BY r.report_date DESC, r.report_time DESC;

-- =====================================================
-- STORED PROCEDURES / FUNCTIONS
-- =====================================================

-- Function to get low stock items
CREATE OR REPLACE FUNCTION get_low_stock_items(threshold INTEGER DEFAULT 20)
RETURNS TABLE (
    article_id VARCHAR,
    name VARCHAR,
    stock INTEGER,
    stock_status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.article_id,
        a.name,
        a.stock,
        a.stock_status::VARCHAR
    FROM articles a
    WHERE a.stock IS NOT NULL 
      AND a.stock <= threshold
      AND a.is_active = TRUE
    ORDER BY a.stock ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate monthly revenue
CREATE OR REPLACE FUNCTION get_monthly_revenue(p_month VARCHAR, p_year INTEGER)
RETURNS DECIMAL AS $$
DECLARE
    total_rev DECIMAL;
BEGIN
    SELECT total_revenue INTO total_rev
    FROM sales_data
    WHERE month = p_month AND year = p_year;
    
    RETURN COALESCE(total_rev, 0);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- GRANTS (Adjust based on your user roles)
-- =====================================================

-- Example grants for different roles
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO agent_role;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO controller_role;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO director_role;

-- =====================================================
-- COMMENTS for Documentation
-- =====================================================

COMMENT ON
TABLE users IS 'User authentication and profile information';

COMMENT ON
TABLE employees IS 'Employee personnel records and management';

COMMENT ON
TABLE articles IS 'Inventory articles including subscriptions and hardware';

COMMENT ON
TABLE warehouse_orders IS 'Purchase orders and warehouse delivery tracking';

COMMENT ON
TABLE reports IS 'System reports from controllers and managers';

COMMENT ON
TABLE sales_data IS 'Monthly sales revenue tracking for dashboard analytics';

-- =====================================================
-- END OF SCHEMA
-- =====================================================
-- Add missing columns if they don't exist
ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_by INTEGER;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS validated_by INTEGER;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_email VARCHAR(255);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_address TEXT;

-- Verify the columns were added
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE
    table_name = 'sales'
ORDER BY ordinal_position
    -- =====================================================
    -- COMPLETE SALE_ITEMS TABLE STRUCTURE
    -- =====================================================

-- Drop and recreate sale_items with all necessary columns
DROP TABLE IF EXISTS sale_items CASCADE;

CREATE TABLE sale_items (
    item_id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(sale_id) ON DELETE CASCADE,
    article_id VARCHAR(20) REFERENCES articles(article_id),

-- Product information (can be different from article for custom pricing)
product_name VARCHAR(255) NOT NULL,
product_code VARCHAR(50), -- Can be article_id or custom code

-- Pricing
quantity INTEGER DEFAULT 1 NOT NULL CHECK (quantity > 0),
unit_price DECIMAL(12, 2) NOT NULL CHECK (unit_price >= 0),
total_price DECIMAL(12, 2) NOT NULL CHECK (total_price >= 0),

-- Metadata
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

-- Ensure total_price matches calculation
CONSTRAINT check_total_price CHECK (total_price = quantity * unit_price)
);

-- Indexes
CREATE INDEX idx_sale_items_sale_id ON sale_items (sale_id);

CREATE INDEX idx_sale_items_article_id ON sale_items (article_id);

CREATE INDEX idx_sale_items_product_name ON sale_items (product_name);

CREATE INDEX idx_sale_items_product_code ON sale_items (product_code);

-- Comments
COMMENT ON
TABLE sale_items IS 'Individual items/products in a sale transaction';

COMMENT ON COLUMN sale_items.product_name IS 'Name of product at time of sale (may differ from current article name)';

COMMENT ON COLUMN sale_items.product_code IS 'Product code/SKU at time of sale';

COMMENT ON COLUMN sale_items.total_price IS 'Automatically calculated from quantity * unit_price';

-- =====================================================
-- Helper function to add item to sale
-- =====================================================

CREATE OR REPLACE FUNCTION add_sale_item(
    p_sale_id INTEGER,
    p_article_id VARCHAR(20),
    p_quantity INTEGER DEFAULT 1
) RETURNS INTEGER AS $$
DECLARE
    v_item_id INTEGER;
    v_article RECORD;
BEGIN
    -- Get article details
    SELECT article_id, name, price 
    INTO v_article
    FROM articles 
    WHERE article_id = p_article_id AND is_active = TRUE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Article % not found or not active', p_article_id;
    END IF;
    
    -- Insert sale item
    INSERT INTO sale_items (
        sale_id, 
        article_id, 
        product_name, 
        product_code, 
        quantity, 
        unit_price, 
        total_price
    ) VALUES (
        p_sale_id,
        v_article.article_id,
        v_article.name,
        v_article.article_id,
        p_quantity,
        v_article.price,
        p_quantity * v_article.price
    ) RETURNING item_id INTO v_item_id;
    
    -- Update sale total
    UPDATE sales 
    SET total_amount = (
        SELECT COALESCE(SUM(total_price), 0) 
        FROM sale_items 
        WHERE sale_id = p_sale_id
    )
    WHERE sale_id = p_sale_id;
    
    RETURN v_item_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Trigger to update sale total when items change
-- =====================================================

CREATE OR REPLACE FUNCTION update_sale_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE sales 
    SET total_amount = (
        SELECT COALESCE(SUM(total_price), 0) 
        FROM sale_items 
        WHERE sale_id = COALESCE(NEW.sale_id, OLD.sale_id)
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE sale_id = COALESCE(NEW.sale_id, OLD.sale_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_sale_total_on_item_change ON sale_items;

CREATE TRIGGER trg_update_sale_total_on_item_change
    AFTER INSERT OR UPDATE OR DELETE ON sale_items
    FOR EACH ROW
    EXECUTE FUNCTION update_sale_total();

-- =====================================================
-- Sample usage
-- =====================================================

-- Example: Create a sale with items
DO $$
DECLARE
    v_sale_id INTEGER;
BEGIN
    -- Create sale
    INSERT INTO sales (
        reference,
        client_name,
        client_phone,
        client_type,
        total_amount,
        status
    ) VALUES (
        'SALE-2024-TEST',
        'Test Client',
        '+213 555 000 000',
        'Residential',
        0,  -- Will be calculated by trigger
        'Draft'
    ) RETURNING sale_id INTO v_sale_id;
    
    -- Add items using the helper function
    PERFORM add_sale_item(v_sale_id, 'ART001', 2);  -- 2x ADSL 4 Mbps
    PERFORM add_sale_item(v_sale_id, 'ART004', 1);  -- 1x Modem
    
    RAISE NOTICE 'Created sale % with items', v_sale_id;
END $$;