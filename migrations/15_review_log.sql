-- =============================================================================
-- Veveaham Alumni - Migration 15: a record of who decided what
-- =============================================================================
-- Nothing in this database remembers a decision. A registration is approved by
-- overwriting one column; a staged edit is published or discarded by setting
-- `pending_changes` to NULL, which destroys the only copy of what was
-- proposed. `college_photos.reviewed_by` and `field_options.created_by` have
-- existed since migrations 13 and 01 and have never been written by anything.
--
-- So: who approved this person, when, and can it be undone - three questions
-- the school cannot answer today about its own directory.
--
-- review_events answers them. It is append-only by grant: admins may read and
-- insert, and may update only to mark an event undone. Nobody may delete,
-- because a log you can erase is not a log.
--
-- Two smaller things ride along, both of which the dashboard needs and neither
-- of which is worth a migration of its own:
--
--   * `review_note` - what the alumnus is told when an edit is held back or
--     discarded. Today they are told nothing at all, and a rejected
--     registration sees "Please contact the school office" while the reason
--     the school typed sits unread in `rejection_reason`.
--
--   * `edits_staged_at` - when a staged edit actually entered the queue. The
--     review list sorts oldest-first and had to guess with
--     `last_confirmed_at`, which also moves when someone presses "this is
--     still correct", so the queue could not tell waiting from confirming.
--     Derived in the trigger, never accepted from a request.
--
-- REQUIRES 07 (is_school_admin), 08 (the guard trigger this replaces),
-- 10 (assert_school_admin), 13 (college_photos).
-- Additive. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. The log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),

  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalised on purpose: ON DELETE SET NULL above would otherwise erase
  -- who did it the day a staff account is removed, which is the one fact a
  -- log exists to keep.
  actor_email  text NOT NULL,

  subject_kind text NOT NULL CHECK (subject_kind IN
                 ('registration', 'profile_edit', 'profile', 'photo', 'option', 'institute')),
  -- text, not uuid: subjects are uuid (alumni, photos), bigint (field_options)
  -- and, for a typed name nobody has matched yet, a grouping key with no row
  -- behind it at all.
  subject_id   text NOT NULL,
  -- Set whenever the subject is a person, so one profile's whole history is a
  -- single indexed read.
  alumni_id    uuid REFERENCES public.alumni(id) ON DELETE SET NULL,

  action       text NOT NULL CHECK (action IN
                 ('approve', 'reject', 'publish', 'discard', 'hide', 'restore',
                  'feature', 'unfeature', 'delete', 'link', 'merge', 'undo')),
  summary      text NOT NULL,
  reason       text,

  -- Enough of the old world to put it back, and what it became.
  before_state jsonb,
  after_state  jsonb,

  -- Stored rather than derived from `action`, so a writer that could not
  -- capture enough to reverse itself - a merge, a delete - can say so.
  undoable     boolean NOT NULL DEFAULT false,
  undone_at    timestamptz,
  undone_by    uuid,
  undo_of      bigint REFERENCES public.review_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS review_events_recent_idx  ON public.review_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS review_events_alumni_idx  ON public.review_events (alumni_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS review_events_subject_idx ON public.review_events (subject_kind, subject_id);

ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;

-- Supabase grants every new public table to anon and authenticated, so a
-- GRANT here would only ever add. Narrowing takes a REVOKE first.
REVOKE ALL ON TABLE public.review_events FROM anon, authenticated;
-- No DELETE, by design. UPDATE exists only so an undo can stamp the event it
-- reverses; the policy below still requires an admin.
GRANT SELECT, INSERT, UPDATE ON TABLE public.review_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.review_events_id_seq TO authenticated;

DROP POLICY IF EXISTS "Admins read the review log" ON public.review_events;
CREATE POLICY "Admins read the review log" ON public.review_events
  FOR SELECT TO authenticated
  USING (public.is_school_admin());

-- The alumnus is deliberately NOT given a view of this table. `before_state`
-- on a discard carries whatever they staged, and opening a log to its subjects
-- is a standing promise to sanitise every payload anyone ever adds to it. What
-- they need - why a registration was rejected, why an edit was held - is on
-- their own row, which they can already read.
DROP POLICY IF EXISTS "Admins write the review log" ON public.review_events;
CREATE POLICY "Admins write the review log" ON public.review_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_school_admin() AND actor_id = auth.uid());

DROP POLICY IF EXISTS "Admins mark an event undone" ON public.review_events;
CREATE POLICY "Admins mark an event undone" ON public.review_events
  FOR UPDATE TO authenticated
  USING (public.is_school_admin())
  WITH CHECK (public.is_school_admin());


-- -----------------------------------------------------------------------------
-- 2. What the alumnus is told, and when an edit began waiting
-- -----------------------------------------------------------------------------
ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS review_note     text,
  ADD COLUMN IF NOT EXISTS review_note_at  timestamptz,
  ADD COLUMN IF NOT EXISTS edits_staged_at timestamptz;

COMMENT ON COLUMN public.alumni.review_note IS
  'Written by the school when an edit is held back or discarded; shown to the alumnus on their own profile page.';
COMMENT ON COLUMN public.alumni.edits_staged_at IS
  'When modification_status last became pending. Derived by the guard trigger.';


-- -----------------------------------------------------------------------------
-- 3. Extend the guard trigger from migration 08
-- -----------------------------------------------------------------------------
-- Adds two things and changes nothing else: the school's note is the school's
-- to write, and the moment an edit entered the queue is derived here rather
-- than trusted from whoever sent the request.
CREATE OR REPLACE FUNCTION public.alumni_guard_self_service()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requested public.alumni;
BEGIN
  IF public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    -- Trusted writers: admins, service-role API routes, the SQL editor.
    IF TG_OP = 'INSERT' AND NEW.public_slug IS NULL THEN
      NEW.public_slug := public.make_public_slug(NEW.full_name);
    END IF;

  ELSIF TG_OP = 'INSERT' THEN
    NEW.user_id             := auth.uid();
    NEW.approval_status     := 'pending';
    NEW.modification_status := 'none';
    NEW.pending_changes     := NULL;
    NEW.rejection_reason    := NULL;
    NEW.school_note         := NULL;
    NEW.review_note         := NULL;
    NEW.review_note_at      := NULL;
    NEW.public_slug         := public.make_public_slug(NEW.full_name);

  ELSE
    -- Only the school decides these, whatever the row's state.
    NEW.id               := OLD.id;
    NEW.user_id          := OLD.user_id;
    NEW.approval_status  := OLD.approval_status;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.school_note      := OLD.school_note;
    NEW.review_note      := OLD.review_note;
    NEW.review_note_at   := OLD.review_note_at;
    NEW.public_slug      := OLD.public_slug;

    -- A published profile changes only through review. Its owner may stage
    -- edits, confirm the profile, and keep their private contact details
    -- current. Starting from OLD protects any column added later by default.
    -- Copied field by field: jsonb_populate_record(OLD, ...) reads a column
    -- added later with a default as NULL on older rows (see 07).
    IF OLD.approval_status = 'approved' THEN
      requested := NEW;
      NEW := OLD;
      NEW.pending_changes     := requested.pending_changes;
      NEW.modification_status := CASE WHEN requested.modification_status = 'pending'
                                      THEN 'pending' ELSE OLD.modification_status END;
      NEW.last_confirmed_at   := requested.last_confirmed_at;
      NEW.personal_email      := requested.personal_email;
      NEW.phone_country_code  := requested.phone_country_code;
      NEW.phone_number        := requested.phone_number;
    END IF;

    -- The clock starts when an edit enters the queue, and only then: saving
    -- again while already waiting must not make the wait look shorter.
    IF NEW.modification_status = 'pending'
       AND OLD.modification_status IS DISTINCT FROM 'pending' THEN
      NEW.edits_staged_at := now();
    ELSIF NEW.modification_status IS DISTINCT FROM 'pending' THEN
      NEW.edits_staged_at := NULL;
    END IF;
  END IF;

  -- Always derived, never trusted from the request.
  NEW.email_key := public.email_key(NEW.personal_email);
  NEW.phone_key := public.phone_key(NEW.phone_country_code, NEW.phone_number);
  RETURN NEW;
END
$$;

-- Anything already waiting has been waiting since at least its last confirm.
UPDATE public.alumni
   SET edits_staged_at = coalesce(last_confirmed_at, last_updated, created_at)
 WHERE modification_status = 'pending' AND edits_staged_at IS NULL;


-- -----------------------------------------------------------------------------
-- 4. The two queues get an index apiece
-- -----------------------------------------------------------------------------
-- Free at this size, and the difference between a sequential scan and an index
-- scan the day there are four thousand rows. Same shape as the pending-photo
-- index in migration 13.
CREATE INDEX IF NOT EXISTS alumni_pending_idx ON public.alumni (created_at)
  WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS alumni_edit_queue_idx ON public.alumni (edits_staged_at)
  WHERE modification_status = 'pending';


-- -----------------------------------------------------------------------------
-- 5. Writing to the log
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: the policies above are the boundary, and this function
-- resolves the actor from the caller's own token rather than taking it as an
-- argument, so an event cannot be written in somebody else's name.
CREATE OR REPLACE FUNCTION public.admin_log_event(
  p_subject_kind text,
  p_subject_id   text,
  p_alumni_id    uuid,
  p_action       text,
  p_summary      text,
  p_reason       text DEFAULT NULL,
  p_before       jsonb DEFAULT NULL,
  p_after        jsonb DEFAULT NULL,
  p_undoable     boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id bigint;
  who    text := coalesce(nullif(auth.jwt() ->> 'email', ''), current_user);
BEGIN
  PERFORM public.assert_school_admin();

  INSERT INTO public.review_events (
    actor_id, actor_email, subject_kind, subject_id, alumni_id,
    action, summary, reason, before_state, after_state, undoable)
  VALUES (
    auth.uid(), who, p_subject_kind, p_subject_id, p_alumni_id,
    p_action, left(coalesce(p_summary, ''), 300), nullif(btrim(coalesce(p_reason, '')), ''),
    p_before, p_after, coalesce(p_undoable, false))
  RETURNING id INTO new_id;

  RETURN new_id;
END
$$;

REVOKE ALL ON FUNCTION public.admin_log_event(text, text, uuid, text, text, text, jsonb, jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_log_event(text, text, uuid, text, text, text, jsonb, jsonb, boolean) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. field_options.created_by, finally written
-- -----------------------------------------------------------------------------
-- The column has existed since migration 01 and nothing has ever filled it.
-- It answers "who proposed this value", which is NULL for the many proposed
-- from the registration form before anyone signs in - correctly so. Who
-- *decided* is a different question, and the log above answers that one.
CREATE OR REPLACE FUNCTION public.field_options_stamp_creator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS field_options_stamp_creator_trg ON public.field_options;
CREATE TRIGGER field_options_stamp_creator_trg
  BEFORE INSERT ON public.field_options
  FOR EACH ROW EXECUTE FUNCTION public.field_options_stamp_creator();


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK
--   DROP TRIGGER field_options_stamp_creator_trg ON public.field_options;
--   DROP FUNCTION public.field_options_stamp_creator();
--   DROP FUNCTION public.admin_log_event(text, text, uuid, text, text, text, jsonb, jsonb, boolean);
--   DROP INDEX public.alumni_pending_idx, public.alumni_edit_queue_idx;
--   DROP TABLE public.review_events;
--   ALTER TABLE public.alumni
--     DROP COLUMN review_note, DROP COLUMN review_note_at, DROP COLUMN edits_staged_at;
--
-- The guard trigger MUST be restored to migration 08's version in the SAME
-- transaction as those column drops. It names review_note and edits_staged_at,
-- so dropping them while this version is installed leaves every write to
-- public.alumni raising - including the ones a rollback would need.
-- =============================================================================
