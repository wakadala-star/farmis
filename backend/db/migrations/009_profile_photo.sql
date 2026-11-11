-- 009: Profile photos (Phase 2E) + audit room for profile updates.
--   users.avatar / avatar_mime — the photo is stored in the database
--     (BYTEA) so it survives Render redeploys and never rides along in
--     session payloads; served through an authenticated endpoint.
--   auth_attempts.action — was VARCHAR(10) CHECK ('signup','signin');
--     widened so profile changes can be audited the same way signins
--     are. Passwords are still NEVER stored, and no password-change
--     flow exists (signup/signin remain the single source of truth).

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar      BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(20);

ALTER TABLE auth_attempts DROP CONSTRAINT IF EXISTS chk_auth_attempts_action;
ALTER TABLE auth_attempts ALTER COLUMN action TYPE VARCHAR(20);
ALTER TABLE auth_attempts ADD CONSTRAINT chk_auth_attempts_action
    CHECK (action IN ('signup', 'signin', 'profile_update'));

COMMIT;
