-- 002: Attendance approval workflow.
-- The UI flow: worker clocks in (check_out IS NULL = "running") →
-- clocks out (approval_status 'pending') → supervisor approves/rejects.

BEGIN;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS approval_status VARCHAR(10) NOT NULL DEFAULT 'pending';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_approval;
ALTER TABLE attendance ADD CONSTRAINT chk_attendance_approval
    CHECK (approval_status IN ('pending','approved','rejected'));

COMMIT;
