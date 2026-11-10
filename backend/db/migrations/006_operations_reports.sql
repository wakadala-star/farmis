-- 006: Operations reports — the supervisor "Reports" screen
-- (generated report snapshots: type + period + label/value lines).

BEGIN;

CREATE TABLE IF NOT EXISTS operations_reports (
    report_id     BIGSERIAL PRIMARY KEY,
    department_id BIGINT,
    report_type   VARCHAR(60)  NOT NULL,   -- e.g. Task completion, Attendance
    period        VARCHAR(60)  NOT NULL,   -- e.g. This week, November 2026
    lines         JSONB        NOT NULL DEFAULT '[]',
    generated_by  BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    generated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_operations_reports_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_operations_reports_dept
    ON operations_reports (department_id, generated_at);

COMMIT;
