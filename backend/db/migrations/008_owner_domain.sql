-- 008: Owner domain tables — crops, livestock and expenses registries
-- (the four dashboard quick actions: Add Crop, Add Animal, Record Sale,
--  Add Expense — sales already exist from 001).
-- Also tags inventory categories with the department whose page should
-- surface their low-stock alerts (NULL = farm-wide, shown everywhere).

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Crops registry (owner "Add Crop")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crops (
    crop_id      BIGSERIAL PRIMARY KEY,
    name         VARCHAR(120) NOT NULL,
    variety      VARCHAR(120),
    area_ha      NUMERIC(12,2) CHECK (area_ha IS NULL OR area_ha >= 0),
    planted_date DATE,
    notes        TEXT,
    created_by   BIGINT      NOT NULL REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_crops_created_at ON crops (created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Livestock registry (owner "Add Animal")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS livestock (
    animal_id    BIGSERIAL PRIMARY KEY,
    species      VARCHAR(80)  NOT NULL,
    breed        VARCHAR(80),
    quantity     INTEGER      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    location     VARCHAR(120),
    acquired_date DATE,
    notes        TEXT,
    created_by   BIGINT       NOT NULL REFERENCES users(user_id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_livestock_created_at ON livestock (created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Expenses ledger (owner "Add Expense")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
    expense_id    BIGSERIAL PRIMARY KEY,
    category      VARCHAR(40) NOT NULL
        CONSTRAINT chk_expenses_category
            CHECK (category IN ('feed','medicine','fuel','salaries','maintenance','equipment','other')),
    description   VARCHAR(255) NOT NULL,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    expense_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(15) NOT NULL DEFAULT 'cash'
        CONSTRAINT chk_expenses_payment_method
            CHECK (payment_method IN ('cash','mobile_money','bank_transfer','other')),
    created_by    BIGINT      NOT NULL REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_expenses_expense_date ON expenses (expense_date DESC);

-- ---------------------------------------------------------------------
-- 4. Inventory categories → department scope for low-stock alerts.
--    Seeds belong to Crop Production, feed to Animal Rearing;
--    anything left NULL stays farm-wide (shown on both pages).
-- ---------------------------------------------------------------------
ALTER TABLE inventory_categories
    ADD COLUMN IF NOT EXISTS department_id BIGINT
        REFERENCES departments(department_id) ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE inventory_categories
   SET department_id = (SELECT department_id FROM departments WHERE department_name = 'Crop Production')
 WHERE category_name = 'Seeds' AND department_id IS NULL;

UPDATE inventory_categories
   SET department_id = (SELECT department_id FROM departments WHERE department_name = 'Animal Rearing')
 WHERE category_name = 'Animal Feed' AND department_id IS NULL;

COMMIT;
