-- 007: Auth attempt log — records every signup/signin attempt and its
-- outcome, so failures (validation, duplicate email, closed owner
-- bootstrap, wrong password…) are visible instead of vanishing.
-- Passwords are NEVER stored.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_attempts (
    attempt_id BIGSERIAL PRIMARY KEY,
    action     VARCHAR(10) NOT NULL
        CONSTRAINT chk_auth_attempts_action
            CHECK (action IN ('signup', 'signin')),
    outcome    VARCHAR(10) NOT NULL
        CONSTRAINT chk_auth_attempts_outcome
            CHECK (outcome IN ('success', 'failure')),
    email      VARCHAR(120),
    user_id    BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    reason     VARCHAR(60),          -- e.g. validation, duplicate_email, owner_closed, bad_password
    ip_address VARCHAR(60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_auth_attempts_created ON auth_attempts (created_at);
CREATE INDEX IF NOT EXISTS ix_auth_attempts_email ON auth_attempts (email, created_at);

COMMIT;
