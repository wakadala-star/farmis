-- ===========================================================================
-- ⚠ SUPERSEDED — do NOT run this against a database with real data.
--   This script DROPS every table and re-seeds. The live schema is now
--   managed by db/migrations/*.sql (applied by `npm run setup-db` or
--   `npm run migrate`, recorded in schema_migrations — never destructive).
--   Kept only as a reference for the original 12-table layout, or for a
--   full wipe of a LOCAL development database.
-- ===========================================================================
--
-- FARMIS: Mkwasi Agri Business Management System
-- Database: mukwasi_agri_business
-- PostgreSQL port of db/mkwasi_agri_business.sql (originally MySQL).
-- The schema contains 12 core tables.
--
-- MySQL → PostgreSQL changes:
--   INT UNSIGNED AUTO_INCREMENT  → BIGSERIAL / INTEGER
--   ENGINE=InnoDB                → removed (PostgreSQL is always transactional)
--   ENUM(...)                    → VARCHAR + CHECK constraint
--   ON UPDATE CURRENT_TIMESTAMP  → trigger (trg_set_updated_at)
--   SET FOREIGN_KEY_CHECKS       → not needed; drops run in dependency order
--   TIMESTAMP                    → TIMESTAMPTZ
--
-- Seed differences (aligned with the Angular frontend):
--   Roles:     owner / supervisor / worker  (instead of Administrator / Farm Manager / Staff)
--   Departments: all 5 kept; the frontend's 'crops'  → 'Crop Production'
--                                               'livestock' → 'Animal Rearing'

BEGIN;

-- ---------------------------------------------------------------------
-- Drops (children first — same order as the original script)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS sale_items     CASCADE;
DROP TABLE IF EXISTS sales          CASCADE;
DROP TABLE IF EXISTS customers      CASCADE;
DROP TABLE IF EXISTS task_reports   CASCADE;
DROP TABLE IF EXISTS tasks          CASCADE;
DROP TABLE IF EXISTS stock_transactions CASCADE;
DROP TABLE IF EXISTS inventory_items    CASCADE;
DROP TABLE IF EXISTS inventory_categories CASCADE;
DROP TABLE IF EXISTS attendance      CASCADE;
DROP TABLE IF EXISTS users           CASCADE;
DROP TABLE IF EXISTS departments     CASCADE;
DROP TABLE IF EXISTS roles           CASCADE;

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
CREATE TABLE roles (
    role_id       BIGSERIAL PRIMARY KEY,
    role_name     VARCHAR(60)  NOT NULL UNIQUE,
    description   VARCHAR(255),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. Departments
-- ---------------------------------------------------------------------
CREATE TABLE departments (
    department_id   BIGSERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE,
    description     VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. Users (employees and system users)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id          BIGSERIAL PRIMARY KEY,
    role_id          BIGINT      NOT NULL,
    department_id    BIGINT,
    first_name       VARCHAR(80) NOT NULL,
    last_name        VARCHAR(80) NOT NULL,
    username         VARCHAR(60) NOT NULL UNIQUE,
    email            VARCHAR(120) UNIQUE,          -- required by auth at the app layer
    phone            VARCHAR(25),
    password_hash    VARCHAR(255) NOT NULL,
    employment_status VARCHAR(10) NOT NULL DEFAULT 'active'
        CONSTRAINT chk_users_employment_status
            CHECK (employment_status IN ('active','inactive')),
    hire_date        DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id) REFERENCES roles(role_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_users_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
-- Email lookups (sign-in) are case-insensitive.
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

-- ---------------------------------------------------------------------
-- 4. Attendance
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id    BIGSERIAL PRIMARY KEY,
    user_id          BIGINT      NOT NULL,
    attendance_date  DATE        NOT NULL,
    check_in         TIME,
    check_out        TIME,
    attendance_status VARCHAR(10) NOT NULL DEFAULT 'present'
        CONSTRAINT chk_attendance_status
            CHECK (attendance_status IN ('present','absent','late','permission')),
    remarks          VARCHAR(255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_attendance_user_day UNIQUE (user_id, attendance_date),
    CONSTRAINT fk_attendance_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 5. Inventory_Categories
-- ---------------------------------------------------------------------
CREATE TABLE inventory_categories (
    category_id   BIGSERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL UNIQUE,
    description   VARCHAR(255),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. Inventory_Items
-- ---------------------------------------------------------------------
CREATE TABLE inventory_items (
    item_id         BIGSERIAL PRIMARY KEY,
    category_id     BIGINT       NOT NULL,
    item_name       VARCHAR(120) NOT NULL,
    item_code       VARCHAR(50)  UNIQUE,
    unit            VARCHAR(30)  NOT NULL,
    quantity_on_hand NUMERIC(12,2) NOT NULL DEFAULT 0,
    reorder_level   NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
    description     TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_items_category
        FOREIGN KEY (category_id) REFERENCES inventory_categories(category_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 7. Stock_Transactions
-- ---------------------------------------------------------------------
CREATE TABLE stock_transactions (
    transaction_id   BIGSERIAL PRIMARY KEY,
    item_id          BIGINT      NOT NULL,
    user_id          BIGINT      NOT NULL,
    transaction_type VARCHAR(12) NOT NULL
        CONSTRAINT chk_stock_transaction_type
            CHECK (transaction_type IN ('stock_in','stock_out','adjustment')),
    quantity         NUMERIC(12,2) NOT NULL,
    unit_cost        NUMERIC(12,2),
    reference_number VARCHAR(80),
    notes            TEXT,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_stock_item
        FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_stock_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 8. Tasks
-- ---------------------------------------------------------------------
CREATE TABLE tasks (
    task_id      BIGSERIAL PRIMARY KEY,
    title        VARCHAR(150) NOT NULL,
    description  TEXT,
    assigned_to  BIGINT,
    assigned_by  BIGINT,
    department_id BIGINT,
    start_date   DATE,
    due_date     DATE,
    task_status  VARCHAR(12) NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_tasks_status
            CHECK (task_status IN ('pending','in_progress','completed','cancelled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_tasks_assigned_to
        FOREIGN KEY (assigned_to) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_tasks_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_tasks_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- 9. Task_Reports
-- ---------------------------------------------------------------------
CREATE TABLE task_reports (
    report_id        BIGSERIAL PRIMARY KEY,
    task_id          BIGINT      NOT NULL,
    user_id          BIGINT      NOT NULL,
    report_description TEXT      NOT NULL,
    progress_status  VARCHAR(12) NOT NULL DEFAULT 'in_progress'
        CONSTRAINT chk_task_reports_status
            CHECK (progress_status IN ('pending','in_progress','completed','blocked')),
    report_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_task_reports_task
        FOREIGN KEY (task_id) REFERENCES tasks(task_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_task_reports_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 10. Customers
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    customer_id   BIGSERIAL PRIMARY KEY,
    customer_name VARCHAR(150) NOT NULL,
    phone         VARCHAR(25),
    email         VARCHAR(120),
    address       VARCHAR(255),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 11. Sales
-- ---------------------------------------------------------------------
CREATE TABLE sales (
    sale_id        BIGSERIAL PRIMARY KEY,
    customer_id    BIGINT,
    user_id        BIGINT       NOT NULL,
    receipt_number VARCHAR(60)  NOT NULL UNIQUE,
    sale_date      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(15)  NOT NULL DEFAULT 'cash'
        CONSTRAINT chk_sales_payment_method
            CHECK (payment_method IN ('cash','mobile_money','bank_transfer','other')),
    payment_status VARCHAR(10)  NOT NULL DEFAULT 'paid'
        CONSTRAINT chk_sales_payment_status
            CHECK (payment_status IN ('paid','pending','partial')),
    notes          TEXT,
    CONSTRAINT fk_sales_customer
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_sales_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 12. Sale_Items
-- ---------------------------------------------------------------------
CREATE TABLE sale_items (
    sale_item_id      BIGSERIAL PRIMARY KEY,
    sale_id           BIGINT       NOT NULL,
    item_id           BIGINT,
    item_description  VARCHAR(180) NOT NULL,
    quantity          NUMERIC(12,2) NOT NULL,
    unit_price        NUMERIC(14,2) NOT NULL,
    subtotal          NUMERIC(14,2) NOT NULL,
    CONSTRAINT fk_sale_items_sale
        FOREIGN KEY (sale_id) REFERENCES sales(sale_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_sale_items_inventory
        FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- updated_at maintenance (replaces MySQL's ON UPDATE CURRENT_TIMESTAMP)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_items_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Seed: roles aligned with the frontend (owner / supervisor / worker)
-- ---------------------------------------------------------------------
INSERT INTO roles (role_name, description) VALUES
    ('owner',      'Manages the FARMIS system and its users'),
    ('supervisor', 'Runs a department (crops or livestock)'),
    ('worker',     'Carries out assigned farm duties');

-- ---------------------------------------------------------------------
-- Seed: departments (frontend codes in brackets)
-- ---------------------------------------------------------------------
INSERT INTO departments (department_name, description) VALUES
    ('Crop Production',        'Crop growing and field activities'),        -- [crops]
    ('Animal Rearing',        'Poultry, cattle and goat management'),      -- [livestock]
    ('Stores and Inventory',  'Farm supplies and stock management'),
    ('Sales',                 'Customer and sales transactions'),
    ('Administration',        'General farm administration');

COMMIT;
