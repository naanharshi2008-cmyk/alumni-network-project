'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import EntitySearchField, { type EntityHit } from '../../lib/EntitySearchField';
import { instKey } from '../../lib/instituteKey';
import { toTitleCase, formatMonthYear } from '../../lib/text';
import { officialSchoolName, BUILT_IN_OPTIONS, OPTION_CATEGORY_LABELS, OptionCategory } from '../../lib/options';
import { CATEGORIES } from '../../lib/types';
import Crest from '../../lib/Crest';

const ADMIN_LOGIN_DOMAIN = 'veveaham-admin.local';
const LAST_VISIT_KEY = 'veveaham.admin.lastVisit';

type AlumniRow = {
  id: string;
  full_name: string;
  username: string | null;
  user_id: string | null;
  public_slug?: string | null;
  admission_number: string | null;
  school_name: string | null;
  class_of: number;
  stream: string;
  school_board: string | null;
  college_name_raw: string | null;
  college_id: string | null;
  organization_id: string | null;
  degree: string | null;
  branch: string | null;
  field: string | null;
  admission_route: string | null;
  admission_rank: string | null;
  board_marks: string | null;
  board_cutoff: string | null;
  current_status: string | null;
  expected_finish_year: number | null;
  currently_at: string | null;
  designation: string | null;
  linkedin_url: string | null;
  message_1: string | null;
  message_2: string | null;
  personal_email: string | null;
  phone_number: string | null;
  phone_country_code: string | null;
  photo_url: string | null;
  approval_status: string;
  modification_status: string | null;
  pending_changes: Record<string, any> | null;
  created_at: string;
  last_updated: string | null;
  last_confirmed_at: string | null;
  school_note: string | null;
  college_thoughts: string | null;
  featured?: boolean | null;
};

type HigherStudyRow = {
  id: string; alumni_id: string; degree_name: string;
  institution: string | null; start_year: number | null; finish_year: number | null;
};

type WorkExperienceRow = {
  id: string; alumni_id: string; company: string; role: string | null;
  start_year: number | null; end_year: number | null; is_current: boolean;
};

type PendingOption = { id: number; category: string; value: string; created_at: string };

type CollegeInfoRow = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
  banner_url: string | null;
  description: string | null;
  students: { id: string; full_name: string; class_of: number | null; school_note: string | null }[];
};

type Tab = 'registrations' | 'edits' | 'directory' | 'options' | 'colleges' | 'companies' | 'colleges_info';

// Fields the profile editor may change, and how to label them in the diff.
const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name', school_name: 'School',
  class_of: 'Class Of', stream: 'Stream', degree: 'Degree', branch: 'Branch',
  field: 'Field', college_name_raw: 'College', currently_at: 'Currently At',
  professional_course: 'Professional course', professional_stage: 'Stage',
  professional_org: 'Articling / studying at',
  designation: 'Designation', current_status: 'Status',
  expected_finish_year: 'Expected Finish', admission_route: 'Admission Route',
  admission_rank: 'Rank', board_marks: 'Board Marks', board_cutoff: 'Cutoff',
  message_1: 'Advice', message_2: 'Advice (second)', college_thoughts: 'College experience', linkedin_url: 'LinkedIn', photo_url: 'Photo',
};

/* ═══════════════════════════════════════════════════════════════════════════
   Admin dashboard
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('registrations');
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'ok'>('checking');
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionNote, setActionNote] = useState('');
  // D4 - bulk approve selection, registrations tab only.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [pending, setPending] = useState<AlumniRow[]>([]);
  const [pendingEdits, setPendingEdits] = useState<AlumniRow[]>([]);
  // Everyone already decided on. Without this the dashboard could only ever act
  // on the review queue, so an approved profile - a duplicate, a test row, a
  // person who asked to be taken down - could not be reached at all.
  const [decided, setDecided] = useState<AlumniRow[]>([]);
  const [decidedQuery, setDecidedQuery] = useState('');
  const [higherStudiesMap, setHigherStudiesMap] = useState<Record<string, HigherStudyRow[]>>({});
  const [workExperienceMap, setWorkExperienceMap] = useState<Record<string, WorkExperienceRow[]>>({});
  const [pendingOptions, setPendingOptions] = useState<PendingOption[]>([]);
  const [approvedOptions, setApprovedOptions] = useState<Record<string, string[]>>({});
  const [unmatchedColleges, setUnmatchedColleges] = useState<{ key: string; display: string; alumniIds: string[] }[]>([]);
  const [unmatchedCompanies, setUnmatchedCompanies] = useState<{ key: string; display: string; alumniIds: string[] }[]>([]);
  // The "Colleges" tab: every matched college that has alumni, with its banner
  // and description, plus the students there (for the school's per-alumnus note).
  const [collegesInfo, setCollegesInfo] = useState<CollegeInfoRow[]>([]);

  const [mailHealth, setMailHealth] = useState<{ domainStatus: string; apiKeySet: boolean; hint: string } | null>(null);

  // "New since you last looked" marker. Stored per-browser; the dashboard is
  // the only notification channel that works before email keys are configured.
  const [lastVisit, setLastVisit] = useState<number | null>(null);

  /* ── Auth: must be a signed-in ADMIN, not merely signed in ─────────────── */
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session) { router.replace('/login'); return; }
      // A logged-in alumnus previously reached this page and saw every pending
      // applicant's email and phone number. The address decides access now.
      if (!session.user.email?.toLowerCase().endsWith(`@${ADMIN_LOGIN_DOMAIN}`)) {
        setAuthState('denied');
        return;
      }
      setAuthState('ok');

      // Read it, but do NOT stamp a new one here: this effect runs on every
      // mount, so writing now meant a single refresh wiped the "new since you
      // last looked" marker for good. The stamp happens on the way out instead
      // (see the pagehide handler below), which is what "last visit" means.
      const stored = window.localStorage.getItem(LAST_VISIT_KEY);
      setLastVisit(stored ? Number(stored) : null);

      void loadAll();
      void fetch('/api/admin/mail-health', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((h) => { if (active && h) setMailHealth(h); })
        .catch(() => undefined);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });

    // Stamp the visit as the admin leaves, so everything that arrived during
    // this session still counts as "new" until they actually come back.
    const stamp = () => window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    window.addEventListener('pagehide', stamp);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('pagehide', stamp);
      stamp();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Data loading ──────────────────────────────────────────────────────── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [regRes, editRes, decidedRes, optRes, collegeRes, companyRes] = await Promise.all([
      supabase.from('alumni').select('*').eq('approval_status', 'pending').order('created_at', { ascending: true }),
      supabase.from('alumni').select('*').eq('approval_status', 'approved').eq('modification_status', 'pending').order('created_at', { ascending: true }),
      supabase.from('alumni').select('*').neq('approval_status', 'pending').order('full_name'),
      supabase.from('field_options').select('id, category, value, status, created_at').order('created_at', { ascending: true }),
      supabase.from('alumni').select('id, college_name_raw').is('college_id', null).not('college_name_raw', 'is', null),
      supabase.from('alumni').select('id, currently_at').is('organization_id', null).not('currently_at', 'is', null),
    ]);

    if (regRes.error) setActionError('Could not load registrations: ' + regRes.error.message);
    else setPending((regRes.data as AlumniRow[]) ?? []);
    setPendingEdits((editRes.data as AlumniRow[]) ?? []);

    if (decidedRes.error) setActionError('Could not load the alumni list: ' + decidedRes.error.message);
    else setDecided((decidedRes.data as AlumniRow[]) ?? []);

    // Split the options table into the review queue and the live lists.
    const opts = (optRes.data as (PendingOption & { status: string })[]) ?? [];
    setPendingOptions(opts.filter((o) => o.status === 'pending'));
    const approved: Record<string, string[]> = {};
    for (const o of opts.filter((o) => o.status === 'approved')) {
      (approved[o.category] ??= []).push(o.value);
    }
    setApprovedOptions(approved);

    setUnmatchedColleges(groupByTypedName((collegeRes.data as any[]) ?? [], 'college_name_raw'));
    setUnmatchedCompanies(groupByTypedName((companyRes.data as any[]) ?? [], 'currently_at'));

    // Colleges tab: matched colleges + their students. Two small queries at
    // this scale; authenticated can read colleges (the type-ahead relies on it).
    const { data: linkRows } = await supabase
      .from('alumni')
      .select('id, full_name, class_of, school_note, college_id, approval_status')
      .not('college_id', 'is', null);
    const byCollege = new Map<string, CollegeInfoRow['students']>();
    for (const r of (linkRows ?? []) as any[]) {
      if (r.approval_status !== 'approved') continue;
      const list = byCollege.get(r.college_id) ?? [];
      list.push({ id: r.id, full_name: r.full_name, class_of: r.class_of, school_note: r.school_note });
      byCollege.set(r.college_id, list);
    }
    if (byCollege.size > 0) {
      const { data: collegeRows } = await supabase
        .from('colleges')
        .select('id, name, state, district, banner_url, description')
        .in('id', [...byCollege.keys()])
        .order('name');
      setCollegesInfo(
        ((collegeRows ?? []) as any[]).map((c) => ({
          ...c,
          students: (byCollege.get(c.id) ?? []).sort((a, b) => (b.class_of ?? 0) - (a.class_of ?? 0)),
        })),
      );
    } else {
      setCollegesInfo([]);
    }

    // Timelines for everyone currently on screen.
    const allIds = [...((regRes.data as AlumniRow[]) ?? []), ...((editRes.data as AlumniRow[]) ?? [])].map((p) => p.id);
    if (allIds.length) {
      const [studiesRes, workRes] = await Promise.all([
        supabase.from('higher_studies').select('*').in('alumni_id', allIds),
        supabase.from('work_experience').select('*').in('alumni_id', allIds),
      ]);
      const studies: Record<string, HigherStudyRow[]> = {};
      for (const row of (studiesRes.data as HigherStudyRow[]) ?? []) (studies[row.alumni_id] ??= []).push(row);
      setHigherStudiesMap(studies);
      const work: Record<string, WorkExperienceRow[]> = {};
      for (const row of (workRes.data as WorkExperienceRow[]) ?? []) (work[row.alumni_id] ??= []).push(row);
      setWorkExperienceMap(work);
    }
    setLoading(false);
  }, []);

  // Name, username and college all searchable: the junk rows are easiest to
  // find by the nonsense college someone typed, not by their name.
  const decidedFiltered = useMemo(() => {
    const q = decidedQuery.trim().toLowerCase();
    if (!q) return decided;
    return decided.filter((p) => [
      p.full_name, p.personal_email, p.phone_number, p.college_name_raw, p.currently_at,
      String(p.class_of ?? ''), p.approval_status,
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [decided, decidedQuery]);

  const newSinceLastVisit = useMemo(() => {
    if (!lastVisit) return 0;
    return pending.filter((p) => new Date(p.created_at).getTime() > lastVisit).length;
  }, [pending, lastVisit]);

  /* ── Registration actions ──────────────────────────────────────────────── */
  // "You're live" emails. Never blocks the approval, and the route itself
  // checks each row really is approved before emailing anyone.
  async function notifyApproved(ids: string[]) {
    if (!ids.length) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch('/api/admin/notify-approved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ids }),
      });
    } catch { /* email is a courtesy; the approval already stands */ }
  }

  async function handleApprove(id: string) {
    setActionError('');
    // Note: we deliberately no longer copy the whole row into original_data.
    // That snapshot included personal_email and phone_number, and original_data
    // was readable through the same public path as the rest of the profile.
    // .select() is what turns "the statement ran" into "a row actually
    // changed". Without it PostgREST answers success with zero rows affected
    // whenever a row is filtered out, and the card below disappears from the
    // queue either way - so the dashboard would report an approval that never
    // happened, and only a page reload would give it away.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'approved', modification_status: 'none' })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not approve: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was approved — that profile may have been changed or removed. Reload and try again.'); return; }
    const person = pending.find((p) => p.id === id);
    void notifyApproved([id]);
    setActionNote(`Approved ${person?.full_name ?? 'that registration'} — they're live on the directory now.`);
    setPending((prev) => prev.filter((p) => p.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function handleApproveSelected() {
    setActionError('');
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    // One statement rather than a loop: a partial batch is worse than an
    // obvious failure, and the admin needs to know exactly what happened.
    const { data: hits, error } = await supabase.from('alumni')
      .update({ approval_status: 'approved', modification_status: 'none' })
      .in('id', ids)
      .select('id');
    setBulkBusy(false);
    if (error) { setActionError('Could not approve the selected people: ' + error.message); return; }
    // A partial batch is worth saying out loud rather than rounding up.
    const done = hits?.length ?? 0;
    if (done === 0) { setActionError('Nothing was approved — reload and try again.'); return; }
    if (done < ids.length) {
      setActionError(`Only ${done} of ${ids.length} were approved. Reload to see which are still waiting.`);
    }
    void notifyApproved((hits ?? []).map((h: { id: string }) => h.id));
    setActionNote(`Approved ${done} ${done === 1 ? 'person' : 'people'} — they're live on the directory now.`);
    setPending((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
  }

  async function handleReject(id: string, reason: string) {
    setActionError('');
    const person = pending.find((p) => p.id === id);
    const { data: hit, error } = await supabase.from('alumni')
      .update({ approval_status: 'rejected', rejection_reason: reason.trim() || null })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not reject: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was rejected — reload and try again.'); return; }
    setActionNote(`Rejected ${person?.full_name ?? 'that registration'}.`);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleDelete(person: AlumniRow) {
    setActionError('');
    setActionNote('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setActionError('Your session expired, please sign in again.'); return; }

    const res = await fetch('/api/admin/delete-alumni', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id: person.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(body.error ?? 'Could not delete this profile.');
      return;
    }
    setPending((prev) => prev.filter((p) => p.id !== person.id));
    setPendingEdits((prev) => prev.filter((p) => p.id !== person.id));
    setDecided((prev) => prev.filter((p) => p.id !== person.id));
    setActionNote(
      `Deleted ${body.name ?? person.full_name}.` +
      (body.warnings?.length ? ` Note: ${body.warnings.join('; ')}.` : ''),
    );
  }

  /* ── Directory actions (already-decided profiles) ──────────────────────── */
  // Hiding is the reversible half of deleting: the profile leaves the public
  // view immediately but the row, the photo and the login all survive, so a
  // mistake costs a click rather than the person's whole record.
  async function handleSetStatus(person: AlumniRow, status: 'approved' | 'rejected') {
    setActionError('');
    setActionNote('');
    const { error } = await supabase.from('alumni')
      .update({ approval_status: status })
      .eq('id', person.id)
      .select('id');
    if (error) { setActionError('Could not update that profile: ' + error.message); return; }
    setDecided((prev) => prev.map((p) => (p.id === person.id ? { ...p, approval_status: status } : p)));
    setActionNote(
      status === 'approved'
        ? `${person.full_name} is back in the public directory.`
        : `${person.full_name} is hidden from the public directory.`,
    );
  }

  // Starred profiles lead the home page's Featured row; the rest of the row is
  // filled automatically and the order rotates (lib/showcase.ts).
  async function handleToggleFeatured(person: AlumniRow) {
    setActionError('');
    setActionNote('');
    const next = !person.featured;
    const { data, error } = await supabase.from('alumni')
      .update({ featured: next })
      .eq('id', person.id)
      .select('id, featured');
    if (error || !data?.length) {
      setActionError('Could not change featuring: ' + (error?.message ?? 'no row was updated.'));
      return;
    }
    setDecided((prev) => prev.map((p) => (p.id === person.id ? { ...p, featured: next } : p)));
    setActionNote(next
      ? `${person.full_name} is featured on the home page.`
      : `${person.full_name} is no longer featured; the home page fills the place automatically.`);
  }

  /* ── Edit-review actions ───────────────────────────────────────────────── */
  async function handleApproveEdit(person: AlumniRow) {
    setActionError('');
    const staged = person.pending_changes;
    if (!staged) { setActionError('Nothing staged for this person.'); return; }

    // Publish the staged values into the live columns the directory reads.
    const { higher_studies, work_experience, ...columns } = staged;
    const { data: published, error } = await supabase.from('alumni')
      // last_updated sits AFTER the spread on purpose: publishing is the
      // moment the public content changes, so publish time always wins - even
      // over anything a stale staged blob might carry.
      .update({ ...columns, modification_status: 'none', pending_changes: null, last_updated: new Date().toISOString() })
      .eq('id', person.id)
      .select('id');
    if (error) { setActionError('Could not approve edits: ' + error.message); return; }
    if (!published?.length) { setActionError('Nothing was published — reload and try again.'); return; }

    // Timelines are stored whole, so replace rather than merge.
    //
    // Both errors are checked. Previously neither was, and because the delete
    // runs first, a failed insert destroyed the person's entire education and
    // work history while the card still disappeared as though it had worked.
    // A replace is not atomic from the client, so on failure we say so loudly
    // and keep the card in the queue rather than reporting success.
    for (const [table, rowsRaw] of [
      ['higher_studies', higher_studies],
      ['work_experience', work_experience],
    ] as const) {
      if (!Array.isArray(rowsRaw)) continue;
      const { error: delErr } = await supabase.from(table).delete().eq('alumni_id', person.id);
      if (delErr) {
        setActionError(`Published the profile details, but could not update ${table.replace('_', ' ')}: ${delErr.message}`);
        return;
      }
      if (rowsRaw.length) {
        const { error: insErr } = await supabase.from(table).insert(
          rowsRaw.map((r: any) => ({ ...r, alumni_id: person.id })),
        );
        if (insErr) {
          setActionError(
            `Published the profile details, but their ${table.replace('_', ' ')} entries did not save (${insErr.message}). ` +
            'Ask them to re-enter that section from their profile page.',
          );
          return;
        }
      }
    }
    setActionNote(`Published ${person.full_name}'s changes — the directory shows them now.`);
    setPendingEdits((prev) => prev.filter((p) => p.id !== person.id));
  }

  async function handleRejectEdit(id: string) {
    setActionError('');
    // The live columns were never touched, so discarding is just clearing the
    // staging area - no restore step and nothing for the public to notice.
    const { data: hit, error } = await supabase.from('alumni')
      .update({ modification_status: 'rejected', pending_changes: null })
      .eq('id', id)
      .select('id');
    if (error) { setActionError('Could not discard the edits: ' + error.message); return; }
    if (!hit?.length) { setActionError('Nothing was discarded — reload and try again.'); return; }
    setPendingEdits((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  if (authState === 'checking') {
    return <div className="container"><p className="subtitle">Checking your access…</p></div>;
  }

  if (authState === 'denied') {
    return (
      <div className="container container--narrow">
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span className="empty__emoji">🔒</span>
          <h2>Staff only</h2>
          <p className="subtitle">
            This dashboard is limited to administrator accounts. If you are an alumnus,
            your own details live on your profile page.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <button type="button" onClick={() => router.replace('/profile')} className="btn btn--primary">
              <span className="btn__inner">Go to my profile</span>
            </button>
            <button type="button" onClick={handleLogout} className="btn btn--ghost">
              <span className="btn__inner">Log out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="container"><p className="subtitle">Loading submissions…</p></div>;

  const totalPendingOptions = pendingOptions.length;

  return (
    <div className="container">
      <div className="admin-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Crest />
          <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
        </div>
        <button type="button" onClick={handleLogout} className="btn btn--neutral">
          <span className="btn__inner">Log Out</span>
        </button>
      </div>

      {newSinceLastVisit > 0 && (
        <div className="alert alert--success" style={{ marginBottom: 16 }}>
          <strong>{newSinceLastVisit}</strong> new registration{newSinceLastVisit === 1 ? '' : 's'} since you last opened this dashboard.
        </div>
      )}

      <div className="chips" style={{ marginBottom: 28 }}>
        <TabButton active={tab === 'registrations'} onClick={() => setTab('registrations')}
          label="📋 New Registrations" count={pending.length} />
        <TabButton active={tab === 'edits'} onClick={() => setTab('edits')}
          label="✏️ Pending Edits" count={pendingEdits.length} />
        <TabButton active={tab === 'directory'} onClick={() => setTab('directory')}
          label="👥 All Alumni" count={decided.length} />
        <TabButton active={tab === 'options'} onClick={() => setTab('options')}
          label="🏷 Pending Options" count={totalPendingOptions} />
        <TabButton active={tab === 'colleges'} onClick={() => setTab('colleges')}
          label="🏫 Unmatched Colleges" count={unmatchedColleges.length} />
        <TabButton active={tab === 'companies'} onClick={() => setTab('companies')}
          label="🏢 Unmatched Companies" count={unmatchedCompanies.length} />
        <TabButton active={tab === 'colleges_info'} onClick={() => setTab('colleges_info')}
          label="🏛 Institutes" count={collegesInfo.length} />
      </div>

      {mailHealth && mailHealth.domainStatus !== 'verified' && (
        <div className="alert alert--warn" role="status">
          <strong>Email is not working yet.</strong> {mailHealth.hint} Until it is, password-reset links,
          welcome emails and new-registration alerts are not delivered — use <em>Reset password</em> in
          All Alumni to help someone who is locked out.
        </div>
      )}

      {actionError && <div className="alert alert--error">{actionError}</div>}
      {actionNote && <div className="alert alert--success">{actionNote}</div>}

      {/* ===== New registrations ===== */}
      {tab === 'registrations' && (
        <div className="stagger">
          {pending.length === 0 ? (
            <EmptyCard emoji="🎉" text="No pending registrations right now." />
          ) : (
            <>
            {pending.length > 1 && (
              <div className="bulk-bar">
                <label className="bulk-bar__all">
                  <input
                    type="checkbox"
                    checked={selected.size === pending.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(pending.map((p) => p.id)) : new Set())
                    }
                  />
                  <span>Select all {pending.length}</span>
                </label>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={selected.size === 0 || bulkBusy}
                  onClick={handleApproveSelected}
                >
                  <span className="btn__inner">
                    {bulkBusy ? 'Approving…' : `✓ Approve ${selected.size || ''} selected`.trim()}
                  </span>
                </button>
              </div>
            )}
            {pending.map((person) => (
              <div key={person.id} className="card" style={{ marginBottom: 18 }}>
                {pending.length > 1 && (
                  <label className="card-select">
                    <input
                      type="checkbox"
                      checked={selected.has(person.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(person.id); else n.delete(person.id);
                          return n;
                        })
                      }
                    />
                    <span>Select</span>
                  </label>
                )}
                <PersonHeader person={person} isNew={!!lastVisit && new Date(person.created_at).getTime() > lastVisit} />
                <PersonDetails
                  person={person}
                  higherStudies={higherStudiesMap[person.id]}
                  workExperience={workExperienceMap[person.id]}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => handleApprove(person.id)} className="btn btn--primary">
                    <span className="btn__inner">✓ Approve</span>
                  </button>
                  <RejectButton person={person} onReject={handleReject} />
                  <DeleteButton person={person} onDelete={handleDelete} />
                </div>
              </div>
            ))}
            </>
          )}
        </div>
      )}

      {/* ===== All alumni (everyone already decided on) ===== */}
      {tab === 'directory' && (
        <div>
          <p className="subtitle" style={{ marginTop: 0 }}>
            Everyone who has been approved or hidden. This is where to remove test
            rows, duplicates and anyone who asks to be taken down.
          </p>
          <div className="search" style={{ marginBottom: 18 }}>
            <input
              type="text"
              placeholder="Search name, email, phone, college…"
              value={decidedQuery}
              onChange={(e) => setDecidedQuery(e.target.value)}
              aria-label="Search alumni"
            />
          </div>

          {decided.length === 0 ? (
            <EmptyCard emoji="👥" text="No approved or hidden profiles yet." />
          ) : decidedFiltered.length === 0 ? (
            <EmptyCard emoji="🔍" text={`Nothing matches “${decidedQuery}”.`} />
          ) : (
            <>
              <p className="result-count" style={{ marginBottom: 14 }}>
                {decidedFiltered.length === decided.length
                  ? `${decided.length} profiles`
                  : `${decidedFiltered.length} of ${decided.length} profiles`}
              </p>
              {decidedFiltered.map((person) => (
                <div key={person.id} className="card" style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <strong>{person.full_name}</strong>{' '}
                      <span className={`badge badge--sm${person.approval_status === 'approved' ? ' badge--ok' : ''}`}>
                        {person.approval_status === 'approved' ? 'In the directory' : 'Hidden'}
                      </span>
                      {person.featured && <span className="badge badge--sm badge--star">★ Featured</span>}
                      <div className="subtitle" style={{ margin: '4px 0 0', fontSize: '0.84rem' }}>
                        {person.personal_email || 'no email'}{person.user_id ? '' : ' · no login yet'}
                        {person.class_of ? ` · Class of ${person.class_of}` : ''}
                        {person.college_name_raw ? ` · ${person.college_name_raw}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {person.approval_status === 'approved' && (
                        <button type="button" className={`btn btn--ghost star-btn${person.featured ? ' star-btn--on' : ''}`}
                          aria-pressed={!!person.featured}
                          title={person.featured ? 'Remove from the home page' : 'Feature on the home page'}
                          onClick={() => handleToggleFeatured(person)}>
                          <span className="btn__inner">{person.featured ? '★ Featured' : '☆ Feature'}</span>
                        </button>
                      )}
                      {person.approval_status === 'approved' ? (
                        <button type="button" className="btn btn--ghost"
                          onClick={() => handleSetStatus(person, 'rejected')}>
                          <span className="btn__inner">Hide</span>
                        </button>
                      ) : (
                        <button type="button" className="btn btn--ghost"
                          onClick={() => handleSetStatus(person, 'approved')}>
                          <span className="btn__inner">Restore</span>
                        </button>
                      )}
                      <AccountButton person={person} />
                      <DeleteButton person={person} onDelete={handleDelete} />
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ===== Pending edits ===== */}
      {tab === 'edits' && (
        <div className="stagger">
          {pendingEdits.length === 0 ? (
            <EmptyCard emoji="✨" text="No profile edits waiting for review." />
          ) : (
            pendingEdits.map((person) => (
              <div key={person.id} className="card" style={{ marginBottom: 24 }}>
                <PersonHeader person={person} />
                <p className="subtitle" style={{ fontSize: '0.84rem', margin: '12px 0 10px' }}>
                  The directory still shows the approved version on the left. Nothing here is public yet.
                </p>
                <EditDiff person={person} />
                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => handleApproveEdit(person)} className="btn btn--primary">
                    <span className="btn__inner">✓ Publish changes</span>
                  </button>
                  <ConfirmButton
                    label="↩ Discard changes"
                    confirmLabel="Yes, discard them"
                    busyLabel="Discarding…"
                    question={`Discard the changes ${person.full_name} submitted? They will have to type them again, and nothing tells them it happened.`}
                    onConfirm={() => handleRejectEdit(person.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== Pending options ===== */}
      {tab === 'options' && (
        <PendingOptionsTab
          pendingOptions={pendingOptions}
          approvedOptions={approvedOptions}
          onResolved={(id) => setPendingOptions((prev) => prev.filter((o) => o.id !== id))}
          onApprovedValue={(category, value) =>
            setApprovedOptions((prev) => ({ ...prev, [category]: [...(prev[category] ?? []), value] }))
          }
          setError={setActionError}
        />
      )}

      {/* ===== Unmatched colleges ===== */}
      {tab === 'colleges' && (
        <div className="stagger">
          <TabIntro title="Colleges we didn't recognise">
            These students typed a college name that didn&apos;t match our list — usually
            just a spelling difference. Fix the spelling once here and everyone who typed
            it gets linked to the same college. If the name is already right, save it as-is
            to add it to the list.
          </TabIntro>
          {unmatchedColleges.length === 0 ? (
            <EmptyCard emoji="🏫" text="No unmatched colleges right now — nice and tidy." />
          ) : (
            unmatchedColleges.map((group) => (
              <UnmatchedEntityRow
                key={group.key}
                kind="colleges"
                groupKey={group.key}
                display={group.display}
                alumniIds={group.alumniIds}
                onResolved={(k) => setUnmatchedColleges((prev) => prev.filter((g) => g.key !== k))}
              />
            ))
          )}
        </div>
      )}

      {/* ===== Unmatched companies ===== */}
      {tab === 'companies' && (
        <div className="stagger">
          <TabIntro title="Employers we didn't recognise">
            Same idea as colleges: someone typed an employer that isn&apos;t on our list yet.
            Correct it once and every student who typed it is linked to the same record.
          </TabIntro>
          {unmatchedCompanies.length === 0 ? (
            <EmptyCard emoji="🏢" text="Every organisation an alumnus typed is already on the list." />
          ) : (
            unmatchedCompanies.map((group) => (
              <UnmatchedEntityRow
                key={group.key}
                kind="organizations"
                groupKey={group.key}
                display={group.display}
                alumniIds={group.alumniIds}
                onResolved={(k) => setUnmatchedCompanies((prev) => prev.filter((g) => g.key !== k))}
              />
            ))
          )}
        </div>
      )}

      {/* ===== Colleges: banners, descriptions, school notes ===== */}
      {tab === 'colleges_info' && (
        <div className="stagger">
          <TabIntro title="Institutes">
            Fix how a college or company is named, add the other names people type
            for it (&ldquo;IITM&rdquo;, &ldquo;NIT Trichy&rdquo;), and merge duplicates. Colleges our
            alumni attend also get a banner, a line about them, and a &ldquo;Note from
            Veveaham&rdquo; for each student.
          </TabIntro>
          <FindInstitute onError={setActionError} onNote={setActionNote} onMerged={() => void loadAll()} />
          {collegesInfo.length === 0 ? (
            <EmptyCard emoji="🖼" text="No matched colleges yet — link some in the Unmatched Colleges tab first." />
          ) : (
            collegesInfo.map((c) => (
              <CollegeInfoCard
                key={c.id}
                college={c}
                onChanged={(patch) =>
                  setCollegesInfo((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
                }
                onNoteSaved={(studentId, note) =>
                  setCollegesInfo((prev) => prev.map((x) =>
                    x.id === c.id
                      ? { ...x, students: x.students.map((st) => (st.id === studentId ? { ...st, school_note: note } : st)) }
                      : x,
                  ))
                }
                onError={setActionError}
                onNote={setActionNote}
                onMerged={() => void loadAll()}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One college in the "Colleges" tab: banner upload/replace/remove, the
 * admin-written description, and per-student "Note from Veveaham" fields.
 *
 * Banner and description go through the service-role API route - the only
 * writer for those columns. The per-student note writes directly: the admin
 * RLS policy on alumni covers it, and a plain single-column update cannot
 * disturb the staged-edits flow.
 */
function CollegeInfoCard({
  college, onChanged, onNoteSaved, onError, onNote, onMerged,
}: {
  college: CollegeInfoRow;
  onChanged: (patch: Partial<CollegeInfoRow>) => void;
  onNoteSaved: (studentId: string, note: string | null) => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
  onMerged: () => void;
}) {
  const [description, setDescription] = useState(college.description ?? '');
  const [busy, setBusy] = useState(false);
  const [showStudents, setShowStudents] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function authed(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { onError('Your session expired, please sign in again.'); return null; }
    return session.access_token;
  }

  // Downscale before upload: banners never need more than ~1600px, and the
  // route (and Vercel itself) cap the body at 4MB.
  async function shrink(file: File): Promise<Blob> {
    if (file.size < 1.5 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / bmp.width);
      if (scale === 1) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      return blob ?? file;
    } catch {
      return file; // downscaling is an optimisation, never a gate
    }
  }

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) { onError('Banners must be JPG, PNG or WEBP images.'); return; }
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const body = await shrink(file);
      if (body.size > 4 * 1024 * 1024) {
        onError('That image is over 4MB even after shrinking — please use a smaller one.');
        return;
      }
      const form = new FormData();
      form.set('college_id', college.id);
      form.set('file', body, file.name.replace(/\.[^.]+$/, '') + (body.type === 'image/jpeg' ? '.jpg' : ''));
      const res = await fetch('/api/admin/college-banner', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? 'Upload failed.'); return; }
      onChanged({ banner_url: out.banner_url });
      onNote(`Banner saved for ${college.name}.${out.warnings?.length ? ` Note: ${out.warnings.join('; ')}` : ''}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeBanner() {
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/college-banner', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ college_id: college.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? 'Could not remove the banner.'); return; }
      onChanged({ banner_url: null });
      onNote(`Banner removed for ${college.name}.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    const token = await authed();
    if (!token) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('college_id', college.id);
      form.set('description', description);
      const res = await fetch('/api/admin/college-banner', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { onError(out.error ?? 'Could not save the description.'); return; }
      onChanged({ description: description.trim() || null });
      onNote(`Description saved for ${college.name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18, padding: '18px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.02rem' }}>{college.name.split(',')[0]}</h3>
          <p className="subtitle" style={{ margin: 0, fontSize: '0.8rem' }}>
            {[college.district, college.state].filter(Boolean).join(', ') || '—'}
            {' · '}{college.students.length} {college.students.length === 1 ? 'student' : 'students'}
          </p>
        </div>
      </div>

      <InstituteNamesEditor
        kind="college"
        id={college.id}
        name={college.name}
        onRenamed={(name) => onChanged({ name })}
        onMerged={onMerged}
        onError={onError}
        onNote={onNote}
      />

      {college.banner_url
        ? <img src={college.banner_url} alt="" style={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: 'var(--r-sm)', margin: '12px 0 10px' }} loading="lazy" />
        : <p className="subtitle" style={{ fontSize: '0.82rem', margin: '12px 0 10px' }}>No banner yet.</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          style={{ fontSize: '0.82rem' }}
        />
        {college.banner_url && (
          <ConfirmButton
            label="🗑 Remove banner"
            confirmLabel="Yes, remove it"
            busyLabel="Removing…"
            question={`Remove the banner for ${college.name.split(',')[0]}? The image disappears from every page that shows it.`}
            onConfirm={removeBanner}
            className="btn btn--ghost"
          />
        )}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>About this college <span className="opt">shown publicly</span></label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A line or two about the college — what it's known for, campus, placements…"
        />
        <button type="button" className="btn btn--neutral" disabled={busy} onClick={saveDescription} style={{ marginTop: 8 }}>
          <span className="btn__inner">{busy ? 'Saving…' : 'Save description'}</span>
        </button>
      </div>

      <button
        type="button"
        className="btn btn--plain btn--plain-neutral"
        style={{ width: '100%', marginTop: 12 }}
        onClick={() => setShowStudents((v) => !v)}
      >
        {showStudents ? '▲ Hide students' : `▼ Notes for ${college.students.length} student(s) here`}
      </button>

      {showStudents && college.students.map((st) => (
        <StudentNoteRow key={st.id} student={st} onSaved={onNoteSaved} onError={onError} onNote={onNote} />
      ))}
    </div>
  );
}

/** One student's "Note from Veveaham" — a direct admin write to alumni.school_note. */
function StudentNoteRow({
  student, onSaved, onError, onNote,
}: {
  student: { id: string; full_name: string; class_of: number | null; school_note: string | null };
  onSaved: (id: string, note: string | null) => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
}) {
  const [note, setNote] = useState(student.school_note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const clean = note.trim() || null;
      const { data, error } = await supabase
        .from('alumni')
        .update({ school_note: clean })
        .eq('id', student.id)
        .select('id');
      if (error) { onError(`Could not save the note: ${error.message}`); return; }
      if (!data || data.length === 0) { onError('The note did not save — please try again.'); return; }
      onSaved(student.id, clean);
      onNote(`Note saved for ${student.full_name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginTop: 10 }}>
      <p style={{ margin: '0 0 6px', fontSize: '0.88rem', fontWeight: 650 }}>
        {student.full_name} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· Class of {student.class_of ?? '—'}</span>
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="A proud line about them, in the school's voice — shown on their public profile."
        style={{ minHeight: 56 }}
      />
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={save} style={{ marginTop: 6 }}>
        <span className="btn__inner">{busy ? 'Saving…' : 'Save note'}</span>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────── */
function groupByTypedName(rows: any[], column: string) {
  const groups: Record<string, { display: string; alumniIds: string[] }> = {};
  for (const row of rows) {
    const raw = (row[column] ?? '').trim();
    if (!raw) continue;
    // Spacing, case and punctuation never make a different institute.
    const key = instKey(raw) || raw.toLowerCase();
    if (!groups[key]) groups[key] = { display: raw, alumniIds: [] };
    groups[key].alumniIds.push(row.id);
  }
  return Object.entries(groups)
    .map(([key, v]) => ({ key, display: v.display, alumniIds: v.alumniIds }))
    .sort((a, b) => b.alumniIds.length - a.alumniIds.length);
}

function TabButton({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number;
}) {
  return (
    <button type="button" className={`chip${active ? ' chip--active' : ''}`} onClick={onClick}>
      {label}
      <span style={{ opacity: 0.7, marginLeft: 6 }}>{count}</span>
    </button>
  );
}

function EmptyCard({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="card empty">
      <span className="empty__emoji">{emoji}</span>
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

function PersonHeader({ person, isNew }: { person: AlumniRow; isNew?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>
          {person.full_name}
          {isNew && <span className="badge badge--xs badge--ok" style={{ marginLeft: 8 }}>NEW</span>}
        </h3>
        <p className="subtitle" style={{ margin: 0, fontSize: '0.86rem' }}>
          Class of {person.class_of} · {person.stream}
          {/* The one field the office can actually verify someone against. */}
          {person.admission_number && <> · Adm. no. <strong>{person.admission_number}</strong></>}
          {person.last_updated && <> · Updated {formatMonthYear(person.last_updated)}</>}
          {person.last_confirmed_at && <> · Confirmed {formatMonthYear(person.last_confirmed_at)}</>}
          {person.school_name && <> · {officialSchoolName(person.school_name)}</>}
        </p>
      </div>
      <div className="avatar">
        {person.photo_url ? <img src={person.photo_url} alt="" /> : person.full_name?.charAt(0)}
      </div>
    </div>
  );
}

function PersonDetails({ person, higherStudies, workExperience }: {
  person: AlumniRow;
  higherStudies?: HigherStudyRow[];
  workExperience?: WorkExperienceRow[];
}) {
  return (
    <div className="a-card__rows" style={{ marginTop: 14 }}>
      <div className="a-row" style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 22px' }}>
        <span><strong>College:</strong>&nbsp;{person.college_name_raw || '—'}{!person.college_id && person.college_name_raw && <span className="badge badge--xs" style={{ marginLeft: 6 }}>unmatched</span>}</span>
        <span><strong>Degree:</strong>&nbsp;{person.degree || '—'}</span>
        <span><strong>Branch:</strong>&nbsp;{person.branch || '—'}</span>
        <span><strong>Field:</strong>&nbsp;{person.field || '—'}</span>
      </div>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Admission through:</strong>&nbsp;{person.admission_route || '—'}
        {person.admission_rank ? ` (Rank: ${person.admission_rank})` : ''}
        {person.board_marks ? ` (${person.board_marks}%)` : ''}
      </p>
      <p className="a-row" style={{ margin: '4px 0' }}>
        <strong>Status:</strong>&nbsp;{person.current_status || '—'}
        {person.currently_at ? ` — ${person.designation || ''} at ${person.currently_at}` : ''}
      </p>

      {!!higherStudies?.length && (
        <div className="a-row" style={{ margin: '8px 0' }}>
          <strong>Higher studies:</strong>
          {higherStudies.map((s) => (
            <div key={s.id} style={{ marginLeft: 14, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              🎓 {s.degree_name}{s.institution ? ` — ${s.institution}` : ''}
              {(s.start_year || s.finish_year) ? ` (${s.start_year || '?'}–${s.finish_year || '?'})` : ''}
            </div>
          ))}
        </div>
      )}
      {!!workExperience?.length && (
        <div className="a-row" style={{ margin: '8px 0' }}>
          <strong>Work experience:</strong>
          {workExperience.map((w) => (
            <div key={w.id} style={{ marginLeft: 14, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              💼 {w.role ? `${w.role} at ` : ''}{w.company}
              {w.start_year ? ` (${w.start_year}–${w.is_current ? 'Present' : (w.end_year || '?')})` : ''}
            </div>
          ))}
        </div>
      )}

      {person.linkedin_url && (
        <p className="a-row" style={{ margin: '4px 0' }}>
          <strong>LinkedIn:</strong>&nbsp;
          <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            {person.linkedin_url}
          </a>
        </p>
      )}
      {person.message_1 && (
        <p className="a-row" style={{ margin: '4px 0', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          &ldquo;{person.message_1}&rdquo;
        </p>
      )}
      <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 8 }}>
        Private — Email: {person.personal_email || '—'} | Phone: {person.phone_country_code ?? ''}{person.phone_number || '—'}
      </p>
    </div>
  );
}

/** Side-by-side "what's published" vs "what they want to change it to". */
function EditDiff({ person }: { person: AlumniRow }) {
  const staged = person.pending_changes ?? {};
  const changed = Object.keys(FIELD_LABELS).filter((key) => {
    if (!(key in staged)) return false;
    const oldVal = (person as any)[key];
    const newVal = staged[key];
    if (oldVal === newVal) return false;
    return !(!oldVal && !newVal);
  });

  if (changed.length === 0) {
    return <p className="subtitle" style={{ fontSize: '0.86rem' }}>No field changes — only timeline entries were edited.</p>;
  }

  return (
    <div className="diff-grid">
      <div className="diff-col diff-col--old">
        <p className="diff-col__title">Live on the directory now</p>
        {changed.map((key) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <span className="diff-label">{FIELD_LABELS[key]}</span>
            <span className="diff-old">{String((person as any)[key] ?? '—')}</span>
          </div>
        ))}
      </div>
      <div className="diff-col diff-col--new">
        <p className="diff-col__title">Proposed — not public yet</p>
        {changed.map((key) => (
          <div key={key} style={{ marginBottom: 6 }}>
            <span className="diff-label">{FIELD_LABELS[key]}</span>
            <span className="diff-new">{String(staged[key] ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline confirm for an action that cannot be undone.
 *
 * Modelled on DeleteButton, which already got this right. Added because the
 * two most destructive controls in the dashboard - discarding an alumnus's
 * submitted edits, and rejecting a proposed option - were single clicks on
 * buttons that looked exactly like the harmless ones beside them.
 */
/**
 * Reject, with the reason captured inline.
 *
 * Replaces window.prompt: after a few dialogs browsers offer "prevent this
 * page from creating additional dialogs", and if staff tick that mid-batch
 * prompt() returns null forever - so every later Reject silently did nothing,
 * during exactly the batch that provoked it.
 */
function TabIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tab-intro">
      <h3>{title}</h3>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}

function RejectButton({
  person, onReject,
}: {
  person: AlumniRow;
  onReject: (id: string, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn--neutral">
        <span className="btn__inner">✕ Reject</span>
      </button>
    );
  }

  return (
    <div className="delete-confirm" style={{ width: '100%' }}>
      <p style={{ margin: '0 0 8px 0' }}>
        Reject <strong>{person.full_name}</strong>? They stay out of the directory.
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, for your records)"
        style={{ marginBottom: 10 }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await onReject(person.id, reason); setBusy(false); }}
          className="btn btn--neutral"
        >
          <span className="btn__inner">{busy ? 'Rejecting…' : 'Yes, reject'}</span>
        </button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setReason(''); }} className="btn btn--ghost">
          <span className="btn__inner">Cancel</span>
        </button>
      </div>
    </div>
  );
}

function ConfirmButton({
  label, confirmLabel, busyLabel, question, onConfirm, className = 'btn btn--neutral',
}: {
  label: string;
  confirmLabel: string;
  busyLabel: string;
  question: string;
  onConfirm: () => Promise<void> | void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={className}>
        <span className="btn__inner">{label}</span>
      </button>
    );
  }

  return (
    <div className="delete-confirm">
      <p style={{ margin: '0 0 10px 0' }}>{question}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
          className="btn btn--neutral"
        >
          <span className="btn__inner">{busy ? busyLabel : confirmLabel}</span>
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="btn btn--ghost">
          <span className="btn__inner">Cancel</span>
        </button>
      </div>
    </div>
  );
}

function DeleteButton({ person, onDelete }: { person: AlumniRow; onDelete: (p: AlumniRow) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn btn--ghost" style={{ marginLeft: 'auto' }}>
        <span className="btn__inner">🗑 Delete</span>
      </button>
    );
  }

  return (
    <div className="delete-confirm">
      <p style={{ margin: '0 0 10px 0' }}>
        Permanently delete <strong>{person.full_name}</strong>? This removes their profile,
        photo, timeline entries and login account. It cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await onDelete(person); setBusy(false); }}
          className="btn btn--neutral"
        >
          <span className="btn__inner">{busy ? 'Deleting…' : 'Yes, delete permanently'}</span>
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="btn btn--ghost">
          <span className="btn__inner">Cancel</span>
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Pending options: dedupe -> canonical spelling -> approve
───────────────────────────────────────────────────────────────────────── */
function PendingOptionsTab({
  pendingOptions, approvedOptions, onResolved, onApprovedValue, setError,
}: {
  pendingOptions: PendingOption[];
  approvedOptions: Record<string, string[]>;
  onResolved: (id: number) => void;
  onApprovedValue: (category: string, value: string) => void;
  setError: (msg: string) => void;
}) {
  if (pendingOptions.length === 0) {
    return <EmptyCard emoji="🏷" text="No new options waiting for review." />;
  }

  const byCategory = pendingOptions.reduce<Record<string, PendingOption[]>>((acc, o) => {
    (acc[o.category] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="stagger">
      <div className="card" style={{ marginBottom: 18, padding: '14px 18px' }}>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          These are values students typed under &ldquo;Other&rdquo;. They already show on the
          person&apos;s own profile — approving here is what adds the value to the dropdown
          lists for everyone else. Merge duplicates instead of approving them twice.
        </p>
      </div>

      {Object.entries(byCategory).map(([category, options]) => (
        <div key={category} className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>
            {OPTION_CATEGORY_LABELS[category as OptionCategory] ?? category}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {options.map((option) => (
              <PendingOptionRow
                key={option.id}
                option={option}
                existing={existingValuesFor(category, approvedOptions)}
                onResolved={onResolved}
                onApprovedValue={onApprovedValue}
                setError={setError}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Built-in options plus anything already approved, for the merge dropdown. */
function existingValuesFor(category: string, approvedOptions: Record<string, string[]>): string[] {
  const builtIn = category === 'field'
    ? CATEGORIES.map((c) => c.label)
    : BUILT_IN_OPTIONS[category as OptionCategory] ?? [];
  const merged = [...builtIn.filter((v) => v !== 'Other'), ...(approvedOptions[category] ?? [])];
  return Array.from(new Set(merged)).sort();
}

function PendingOptionRow({
  option, existing, onResolved, onApprovedValue, setError,
}: {
  option: PendingOption;
  existing: string[];
  onResolved: (id: number) => void;
  onApprovedValue: (category: string, value: string) => void;
  setError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'merging' | 'approving' | 'rejecting'>('idle');
  const [busy, setBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [canonical, setCanonical] = useState(() => toTitleCase(option.value));

  // Values that look like the submission, surfaced first so near-duplicates
  // ("bsms" vs "BSMS") are obvious rather than something staff must spot.
  const likely = useMemo(() => {
    const v = option.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return existing.filter((e) => {
      const n = e.toLowerCase().replace(/[^a-z0-9]/g, '');
      return n === v || n.includes(v) || v.includes(n);
    });
  }, [existing, option.value]);

  /** Rewrite every profile using `from` for this category to `to`. */
  async function rewriteProfiles(from: string, to: string) {
    // ilike treats % and _ as wildcards, so an unescaped value could match -
    // and silently rewrite - profiles it has nothing to do with. Escape them
    // so this stays an exact, case-insensitive comparison.
    const literal = from.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { error } = await supabase
      .from('alumni')
      .update({ [option.category]: to })
      .ilike(option.category, literal);
    if (error) throw error;
  }

  async function handleMerge() {
    if (!mergeTarget) return;
    setBusy(true);
    try {
      await rewriteProfiles(option.value, mergeTarget);
      const { error } = await supabase.from('field_options').delete().eq('id', option.id);
      if (error) throw error;
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not merge "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    const finalValue = canonical.trim();
    if (!finalValue) return;
    setBusy(true);
    try {
      // Fix the spelling on the profiles that already carry the raw value.
      if (finalValue !== option.value) await rewriteProfiles(option.value, finalValue);
      const { data: approved, error } = await supabase
        .from('field_options')
        .update({ value: finalValue, status: 'approved', canonical_value: finalValue })
        .eq('id', option.id)
        .select('id');
      if (error) throw error;
      if (!approved?.length) throw new Error('the option row was not updated — reload and try again');
      onApprovedValue(option.category, finalValue);
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not approve "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      const { error } = await supabase.from('field_options').delete().eq('id', option.id);
      if (error) throw error;
      onResolved(option.id);
    } catch (e: any) {
      setError(`Could not remove "${option.value}": ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="option-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '1rem' }}>&ldquo;{option.value}&rdquo;</strong>
        {likely.length > 0 && mode === 'idle' && (
          <span className="badge badge--xs" style={{ color: 'var(--gold)' }}>
            looks like {likely.slice(0, 2).join(', ')}
          </span>
        )}
        {mode === 'rejecting' && (
          <div className="delete-confirm" style={{ width: '100%' }}>
            <p style={{ margin: '0 0 10px 0' }}>
              Keep &ldquo;{option.value}&rdquo; out of the dropdown list?
              {' '}
              <strong>It stays on the student&apos;s profile</strong> and won&apos;t come back
              here — use Merge instead if you want their spelling corrected.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--neutral" disabled={busy} onClick={handleReject}>
                <span className="btn__inner">{busy ? 'Removing…' : 'Yes, keep it off the list'}</span>
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setMode('idle')}>
                <span className="btn__inner">Cancel</span>
              </button>
            </div>
          </div>
        )}
        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button type="button" className="tag-add-btn" onClick={() => { setMode('merging'); setMergeTarget(likely[0] ?? ''); }}>
              ⇢ Merge into existing
            </button>
            <button type="button" className="tag-add-btn" onClick={() => setMode('approving')}>
              ✓ Approve as new
            </button>
            <button
              type="button"
              className="tag-add-btn tag-add-btn--danger"
              onClick={() => setMode('rejecting')}
              disabled={busy}
            >
              ✕ Don&apos;t add to the list
            </button>
          </div>
        )}
      </div>

      {mode === 'merging' && (
        <div className="option-row__panel">
          <label className="option-row__label">Replace it everywhere with:</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ minWidth: 220 }}>
              <option value="" disabled>Choose the correct value…</option>
              {existing.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <button type="button" className="btn btn--primary" onClick={handleMerge} disabled={busy || !mergeTarget}>
              <span className="btn__inner">{busy ? 'Merging…' : 'Merge'}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode('idle')} disabled={busy}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          <p className="option-row__hint">
            Every profile currently showing &ldquo;{option.value}&rdquo; will be updated to the value you pick.
          </p>
        </div>
      )}

      {mode === 'approving' && (
        <div className="option-row__panel">
          <label className="option-row__label">Add to the list with this spelling:</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <button type="button" className="btn btn--primary" onClick={handleApprove} disabled={busy || !canonical.trim()}>
              <span className="btn__inner">{busy ? 'Saving…' : 'Approve'}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode('idle')} disabled={busy}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          <p className="option-row__hint">
            Profiles using the original spelling are corrected to match.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Unmatched college / company correction
───────────────────────────────────────────────────────────────────────── */
function UnmatchedEntityRow({
  kind, groupKey, display, alumniIds, onResolved,
}: {
  kind: 'colleges' | 'organizations';
  groupKey: string;
  display: string;
  alumniIds: string[];
  onResolved: (key: string) => void;
}) {
  const rpcKind = kind === 'colleges' ? 'college' : 'organization';
  const [mode, setMode] = useState<'idle' | 'editing' | 'saving'>('idle');
  const [draft, setDraft] = useState(display);
  const [pick, setPick] = useState<EntityHit | null>(null);
  // Remembering a 2-3 letter spelling as an alias is how "CIT" ends up meaning
  // two colleges, so short ones start unticked.
  const [remember, setRemember] = useState(instKey(display).length > 3);
  const [message, setMessage] = useState('');

  async function open() {
    setMode('editing');
    setMessage('');
    // Start from the best existing match, so most links are one click.
    const { data } = await supabase.rpc('search_institutes', { p_query: display, p_kind: rpcKind, p_limit: 1 });
    const top = (data as EntityHit[] | null)?.[0];
    if (top) { setPick(top); setDraft(top.name); }
  }

  async function link(entityId: string) {
    const { error } = await supabase.rpc('admin_link_alumni', {
      p_kind: rpcKind, p_alumni_ids: alumniIds, p_entity_id: entityId, p_typed: display, p_remember: remember,
    });
    if (error) throw error;
    onResolved(groupKey);
  }

  async function linkToPick() {
    if (!pick) return;
    setMode('saving'); setMessage('');
    try { await link(pick.id); } catch (e: any) { setMessage(e?.message ?? 'Something went wrong.'); setMode('editing'); }
  }

  async function createAndLink() {
    const name = toTitleCase(draft.trim());
    if (!name) return;
    setMode('saving'); setMessage('');
    try {
      const { data: newId, error } = await supabase.rpc('admin_create_institute', { p_kind: rpcKind, p_name: name });
      if (error) throw error;
      await link(newId as string);
    } catch (e: any) {
      setMessage(e?.message ?? 'Something went wrong.');
      setMode('editing');
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>{display}</p>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text-faint)' }}>
            Typed by {alumniIds.length} {alumniIds.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        {mode === 'idle' && (
          <button type="button" onClick={open} className="btn btn--ghost">
            <span className="btn__inner">Link to an institute</span>
          </button>
        )}
      </div>

      {mode !== 'idle' && (
        <div style={{ marginTop: 12 }}>
          <EntitySearchField
            kind={rpcKind}
            label={kind === 'colleges' ? 'Which college is this?' : 'Which organisation is this?'}
            hint="pick the existing record — short names and typos are fine"
            value={draft}
            onChange={setDraft}
            onSelect={setPick}
          />
          <label className="cbox-row" style={{ marginTop: 10 }}>
            <span className="cbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="cbox__mark" />
            </span>
            <span>Remember “{display}” as another name for it, so the next person who types it is matched automatically</span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {pick ? (
              <button type="button" onClick={linkToPick} disabled={mode === 'saving'} className="btn btn--primary">
                <span className="btn__inner">{mode === 'saving' ? 'Linking…' : `✓ Link ${alumniIds.length === 1 ? 'them' : `all ${alumniIds.length}`} to ${pick.name}`}</span>
              </button>
            ) : (
              <button type="button" onClick={createAndLink} disabled={mode === 'saving' || !draft.trim()} className="btn btn--neutral">
                <span className="btn__inner">{mode === 'saving' ? 'Creating…' : `+ Create “${toTitleCase(draft.trim()) || '…'}” as a new ${kind === 'colleges' ? 'college' : 'organisation'}`}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMode('idle'); setDraft(display); setPick(null); setMessage(''); }}
              disabled={mode === 'saving'}
              className="btn btn--ghost"
            >
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
          {message && <p className="alert alert--error" style={{ marginTop: 10 }}>{message}</p>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Account help: reset a password, or give an account-less profile a login.
   Works before school email is set up - the admin passes the temporary
   password on privately, and it must be replaced at next sign-in.
───────────────────────────────────────────────────────────────────────── */
function AccountButton({ person }: { person: AlumniRow }) {
  const hasLogin = !!person.user_id;
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const [temp, setTemp] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function run() {
    setState('busy'); setErr('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setErr('Your session expired, please sign in again.'); setState('confirm'); return; }
    const res = await fetch(hasLogin ? '/api/admin/reset-password' : '/api/admin/create-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ alumniId: person.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(body.error ?? 'That did not work. Please try again.'); setState('confirm'); return; }
    setTemp(body.temporaryPassword);
    setState('done');
  }

  if (state === 'idle') {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setState('confirm')}>
        <span className="btn__inner">{hasLogin ? 'Reset password' : 'Create login'}</span>
      </button>
    );
  }

  return (
    <div className="account-help">
      {state === 'done' ? (
        <>
          <p style={{ margin: '0 0 8px' }}>
            Temporary password for <strong>{person.full_name}</strong>:
          </p>
          <div className="account-help__temp">
            <code>{temp}</code>
            <button type="button" className="btn btn--ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(temp); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select it by hand */ }
            }}>
              <span className="btn__inner">{copied ? '✓ Copied' : 'Copy'}</span>
            </button>
          </div>
          <p className="hint" style={{ display: 'block', margin: '8px 0 0' }}>
            Send it to them privately. They sign in with their email or phone and this password, then choose their own.
            It will not be shown again.
          </p>
          <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={() => { setTemp(''); setState('idle'); }}>
            <span className="btn__inner">Done</span>
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 10px' }}>
            {hasLogin
              ? <>Give <strong>{person.full_name}</strong> a temporary password? Their current password stops working.</>
              : <>Create a login for <strong>{person.full_name}</strong>? They will sign in with the email or phone on this profile.</>}
          </p>
          {err && <p className="field__error field__error--static">{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--neutral" disabled={state === 'busy'} onClick={run}>
              <span className="btn__inner">{state === 'busy' ? 'Working…' : hasLogin ? 'Yes, reset it' : 'Yes, create it'}</span>
            </button>
            <button type="button" className="btn btn--ghost" disabled={state === 'busy'} onClick={() => { setErr(''); setState('idle'); }}>
              <span className="btn__inner">Cancel</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Institute names: the display name, the other names people type, and merging
   duplicates. All writes go through migration 10's admin functions or the
   aliases table (admin-only by row-level security).
───────────────────────────────────────────────────────────────────────── */
type AliasRow = { id: string; alias: string; source: string };

function InstituteNamesEditor({
  kind, id, name, onRenamed, onMerged, onError, onNote,
}: {
  kind: 'college' | 'organization';
  id: string;
  name: string;
  onRenamed: (name: string) => void;
  onMerged: () => void;
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
}) {
  const [aliases, setAliases] = useState<AliasRow[] | null>(null);
  const [nameDraft, setNameDraft] = useState(name);
  const [aliasDraft, setAliasDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<EntityHit | null>(null);
  const [dupText, setDupText] = useState('');
  const [confirmMerge, setConfirmMerge] = useState(false);
  const fk = kind === 'college' ? 'college_id' : 'organization_id';

  const loadAliases = useCallback(async () => {
    const { data, error } = await supabase.from('institute_aliases').select('id, alias, source').eq(fk, id).order('alias');
    if (error) { onError('Could not load the other names: ' + error.message); return; }
    setAliases((data as AliasRow[]) ?? []);
  }, [fk, id, onError]);

  useEffect(() => { void loadAliases(); }, [loadAliases]);
  useEffect(() => { setNameDraft(name); }, [name]);

  async function rename() {
    const next = nameDraft.trim();
    if (!next || next === name) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_rename_institute', { p_kind: kind, p_id: id, p_name: next });
    setBusy(false);
    if (error) { onError(error.message); return; }
    onRenamed(next);
    onNote(`Renamed to “${next}”. The old name still finds it.`);
    void loadAliases();
  }

  async function addAlias() {
    const alias = aliasDraft.trim();
    if (!alias) return;
    if (instKey(alias) === instKey(name)) { onError('That is already its name.'); return; }
    if (instKey(alias).length < 2) { onError('That is too short to be a useful name.'); return; }
    setBusy(true);
    const { error } = await supabase.from('institute_aliases').insert({ [fk]: id, alias, source: 'admin' });
    setBusy(false);
    if (error) {
      onError(error.code === '23505' ? `“${alias}” is already listed for it.` : 'Could not add that name: ' + error.message);
      return;
    }
    setAliasDraft('');
    void loadAliases();
  }

  async function removeAlias(row: AliasRow) {
    setBusy(true);
    const { data, error } = await supabase.from('institute_aliases').delete().eq('id', row.id).select('id');
    setBusy(false);
    if (error || !data?.length) { onError('Could not remove that name.'); return; }
    setAliases((prev) => (prev ?? []).filter((a) => a.id !== row.id));
  }

  async function merge() {
    if (!dup) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('merge_institute', { p_kind: kind, p_from: dup.id, p_into: id });
    setBusy(false);
    setConfirmMerge(false);
    if (error) { onError(error.message); return; }
    const moved = (data as { moved_alumni?: number } | null)?.moved_alumni ?? 0;
    onNote(`Merged “${dup.name}” into “${name}”. ${moved} profile${moved === 1 ? '' : 's'} moved; its old name still finds this one.`);
    setDup(null); setDupText('');
    void loadAliases();
    onMerged();
  }

  return (
    <div className="inst-names">
      <div className="inst-names__row">
        <input
          type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
          aria-label="Display name" disabled={busy}
        />
        <button type="button" className="btn btn--ghost" disabled={busy || !nameDraft.trim() || nameDraft.trim() === name} onClick={rename}>
          <span className="btn__inner">Rename</span>
        </button>
      </div>

      <p className="inst-names__label">Also known as</p>
      <div className="inst-names__chips">
        {aliases === null && <span className="hint">loading…</span>}
        {aliases?.length === 0 && <span className="hint">no other names yet</span>}
        {aliases?.map((a) => (
          <span key={a.id} className="alias-chip" title={`added: ${a.source}`}>
            {a.alias}
            <button type="button" aria-label={`Remove ${a.alias}`} disabled={busy} onClick={() => removeAlias(a)}>×</button>
          </span>
        ))}
      </div>
      <div className="inst-names__row">
        <input
          type="text" value={aliasDraft} placeholder="Add a name people type, e.g. NIT Trichy"
          onChange={(e) => setAliasDraft(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addAlias(); } }}
          aria-label="Add another name"
        />
        <button type="button" className="btn btn--ghost" disabled={busy || !aliasDraft.trim()} onClick={addAlias}>
          <span className="btn__inner">Add</span>
        </button>
      </div>

      <details className="inst-names__merge">
        <summary>Merge a duplicate into this one</summary>
        <EntitySearchField
          kind={kind} label="Find the duplicate" hint="its alumni, aliases and old name move here"
          value={dupText} onChange={setDupText}
          onSelect={(hit) => { setDup(hit && hit.id !== id ? hit : null); setConfirmMerge(false); }}
        />
        {dup && !confirmMerge && (
          <button type="button" className="btn btn--neutral" style={{ marginTop: 8 }} onClick={() => setConfirmMerge(true)}>
            <span className="btn__inner">Merge “{dup.name}” into this…</span>
          </button>
        )}
        {dup && confirmMerge && (
          <div className="delete-confirm" style={{ marginTop: 8 }}>
            <p style={{ margin: '0 0 10px' }}>
              Merge <strong>{dup.name}</strong> into <strong>{name}</strong>? Its profiles and other names
              move here and it disappears from search. This cannot be undone from the dashboard.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--neutral" disabled={busy} onClick={merge}>
                <span className="btn__inner">{busy ? 'Merging…' : 'Yes, merge'}</span>
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirmMerge(false)}>
                <span className="btn__inner">Cancel</span>
              </button>
            </div>
          </div>
        )}
      </details>
    </div>
  );
}

/** Open any college or company for name editing, including ones no alumnus has yet. */
function FindInstitute({ onError, onNote, onMerged }: {
  onError: (msg: string) => void;
  onNote: (msg: string) => void;
  onMerged: () => void;
}) {
  const [kind, setKind] = useState<'college' | 'organization'>('college');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<EntityHit | null>(null);

  return (
    <div className="card" style={{ marginBottom: 18, padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {(['college', 'organization'] as const).map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? ' chip--active' : ''}`}
            onClick={() => { setKind(k); setPicked(null); setText(''); }}>
            {k === 'college' ? 'Colleges' : 'Companies & organisations'}
          </button>
        ))}
      </div>
      <EntitySearchField
        kind={kind} label={kind === 'college' ? 'Find any college' : 'Find any organisation'}
        hint="to rename it, add other names, or merge a duplicate"
        value={text} onChange={setText} onSelect={setPicked}
      />
      {picked && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 700 }}>{picked.name}</p>
          <InstituteNamesEditor
            kind={kind}
            id={picked.id}
            name={picked.name}
            onRenamed={(name) => { setPicked({ ...picked, name }); setText(name); }}
            onMerged={onMerged}
            onError={onError}
            onNote={onNote}
          />
        </div>
      )}
    </div>
  );
}
