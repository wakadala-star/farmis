-- 005: Daily reports — the worker "Daily Reports" screen.
-- Free-text work log (task + hours + summary) that is NOT tied to a
-- specific tasks row, so it lives apart from task_reports.

BEGIN;

CREATE TABLE IF NOT EXISTS daily_reports (
    report_id     BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    department_id BIGINT,
    report_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
    task_title    VARCHAR(150) NOT NULL,
    hours         NUMERIC(4,1) NOT NULL DEFAULT 0 CHECK (hours >= 0),
    summary       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_daily_reports_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_daily_reports_department
        FOREIGN KEY (department_id) REFERENCES departments(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_daily_reports_dept_date
    ON daily_reports (department_id, report_date);
CREATE INDEX IF NOT EXISTS ix_daily_reports_user_date
    ON daily_reports (user_id, report_date);

COMMIT;
