-- 010: Farm Activities plan (the owner's calendar of planned work)
-- and the link that lets a supervisor carve a planned activity into
-- task portions for the team.
--
--   farm_activities — one planned item: title, optional notes, a
--     cadence (once | weekly | monthly) and the anchor date the plan
--     was created on. Weekly repeats on the anchor's weekday, monthly
--     on the anchor's day-of-month (skipping months that lack it),
--     both from the anchor date onward; once happens on the anchor
--     date only. Farm-wide — no department column.
--   tasks.activity_id — nullable link: a task carved out of a plan.
--     ON DELETE SET NULL so removing a plan row never removes work
--     already assigned to a worker.

BEGIN;

CREATE TABLE IF NOT EXISTS farm_activities (
    activity_id  BIGSERIAL PRIMARY KEY,
    title        VARCHAR(150) NOT NULL,
    notes        TEXT,
    cadence      VARCHAR(8) NOT NULL DEFAULT 'once'
        CONSTRAINT chk_farm_activities_cadence
            CHECK (cadence IN ('once', 'weekly', 'monthly')),
    anchor_date  DATE NOT NULL,
    created_by   BIGINT NOT NULL REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_farm_activities_anchor
    ON farm_activities (anchor_date);

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS activity_id BIGINT
        CONSTRAINT fk_tasks_activity
            REFERENCES farm_activities(activity_id)
            ON UPDATE CASCADE ON DELETE SET NULL;

-- The per-activity portion counts join on this; partial because
-- ordinary tasks (the vast majority) carry no plan link.
CREATE INDEX IF NOT EXISTS ix_tasks_activity
    ON tasks (activity_id)
    WHERE activity_id IS NOT NULL;

COMMIT;
