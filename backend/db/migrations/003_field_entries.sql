-- 003: Field entries — the worker "Data Entry" screen
-- (crop/livestock activity records that feed the department feed).

BEGIN;

CREATE TABLE IF NOT EXISTS field_entries (
    entry_id      BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    department_id BIGINT,
    entry_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
    activity      VARCHAR(120) NOT NULL,   -- e.g. Weeding, Harvesting, Feeding
    place         VARCHAR(120),            -- field / pen
    subject       VARCHAR(120),            -- crop / animal
    measure       VARCHAR(120),            -- quantity text, e.g. "12 baskets"
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_field_entries_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_field_entries_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_field_entries_dept_date
    ON field_entries (department_id, entry_date);
CREATE INDEX IF NOT EXISTS ix_field_entries_user_date
    ON field_entries (user_id, entry_date);

COMMIT;
