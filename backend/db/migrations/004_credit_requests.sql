-- 004: Credit requests — the supervisor "Transactions" screen
-- (worker requests money → supervisor approves/rejects).
-- NOT the same as stock_transactions (that tracks inventory movement).

BEGIN;

CREATE TABLE IF NOT EXISTS credit_requests (
    request_id    BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    department_id BIGINT,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    reason        TEXT        NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'pending'
        CONSTRAINT chk_credit_requests_status
            CHECK (status IN ('pending','approved','rejected')),
    decided_by    BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_credit_requests_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_credit_requests_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_credit_requests_status
    ON credit_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ix_credit_requests_dept
    ON credit_requests (department_id, created_at);

COMMIT;
