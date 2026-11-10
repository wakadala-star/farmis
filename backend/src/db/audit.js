const { query } = require('./pool');

/**
 * Record one signup/signin attempt. Fire-and-forget: logging must never
 * break or delay an auth response, so failures are swallowed (and noted
 * on stderr). Passwords are never passed in.
 *
 * @param {'signup'|'signin'} action
 * @param {'success'|'failure'} outcome
 * @param {{ email?: string|null, userId?: string|number|null,
 *           reason?: string|null, ip?: string|null }} [details]
 */
function logAuthAttempt(action, outcome, details = {}) {
  query(
    `INSERT INTO auth_attempts (action, outcome, email, user_id, reason, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      action,
      outcome,
      details.email ?? null,
      details.userId ?? null,
      details.reason ?? null,
      details.ip ?? null,
    ],
  ).catch((err) => {
    console.error('[audit] failed to log auth attempt:', err.message);
  });
}

module.exports = { logAuthAttempt };
