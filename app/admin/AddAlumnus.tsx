'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { SCHOOLS, STREAMS, COUNTRY_CODES } from '../../lib/options';
import { TempPassword } from './ui';

/**
 * The school adding someone itself.
 *
 * The office usually knows a name, a batch and a phone number long before the
 * person gets round to registering. This turns that into a profile and, in the
 * same breath, a temporary password to hand over — after which the alumnus
 * signs in and writes their own story. Nothing here asks the school to guess
 * at a college, a rank or a piece of advice: those are the alumnus's to give,
 * and the row waits in this queue until they have.
 */

const THIS_YEAR = new Date().getFullYear();

type Result = { name: string; temporaryPassword?: string; signInWith?: string; loginError?: string };

export default function AddAlumnus({ onAdded, setError }: { onAdded: () => Promise<void> | void; setError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Result | null>(null);

  const [fullName, setFullName] = useState('');
  const [classOf, setClassOf] = useState('');
  const [school, setSchool] = useState<string>(SCHOOLS[0]);
  const [stream, setStream] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [college, setCollege] = useState('');
  const [note, setNote] = useState('');
  const [createLogin, setCreateLogin] = useState(true);

  function reset() {
    setFullName(''); setClassOf(''); setSchool(SCHOOLS[0]); setStream(''); setEmail('');
    setCode('+91'); setPhone(''); setCollege(''); setNote(''); setCreateLogin(true);
    setErr('');
  }

  async function submit() {
    setBusy(true); setErr(''); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErr('Your session expired — please sign in again.'); return; }
      const res = await fetch('/api/admin/add-alumnus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          full_name: fullName,
          class_of: classOf,
          school_name: school,
          stream,
          personal_email: email,
          phone_country_code: code,
          phone_number: phone,
          college_name: college,
          school_note: note,
          create_login: createLogin,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) { setErr(body.error ?? 'That did not work. Please try again.'); return; }
      setDone({ name: body.name, temporaryPassword: body.temporaryPassword, signInWith: body.signInWith, loginError: body.loginError });
      reset();
      await onAdded();
    } catch {
      setErr('We could not reach the server. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card add-alum">
        <h3 className="add-alum__head">{done.name} is in the queue below</h3>
        {done.temporaryPassword ? (
          <>
            <p style={{ margin: '0 0 8px' }}>
              They sign in with <strong>{done.signInWith}</strong> and this temporary password:
            </p>
            <TempPassword password={done.temporaryPassword}>
              Send it to them privately. They will be asked to choose their own password, then fill in
              the rest of their profile — approve it once they have. This is shown only now.
            </TempPassword>
          </>
        ) : done.loginError ? (
          <p className="field__error field__error--static">
            The profile was added, but the login was not: {done.loginError} Use “Create login” on their
            card once that is sorted, rather than adding them again.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            No login was created. Use “Create login” on their card in All Alumni when you are ready.
          </p>
        )}
        <button type="button" className="btn btn--ghost" style={{ marginTop: 12 }} onClick={() => { setDone(null); setOpen(false); }}>
          <span className="btn__inner">Done</span>
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost add-alum__open" onClick={() => setOpen(true)}>
        <span className="btn__inner">＋ Add an alumnus yourself</span>
      </button>
    );
  }

  return (
    <div className="card add-alum">
      <h3 className="add-alum__head">Add an alumnus</h3>
      <p className="hint" style={{ display: 'block', margin: '0 0 16px' }}>
        Just enough to reach them. They sign in with the temporary password and fill in the rest —
        their college, how they got in, and what they have to say to juniors — and it comes back here
        for you to approve.
      </p>

      <div className="add-alum__grid">
        <label className="add-alum__field add-alum__field--wide">
          <span>Full name</span>
          <input type="text" value={fullName} maxLength={80} disabled={busy}
            onChange={(e) => setFullName(e.target.value)} placeholder="As it should appear" />
        </label>

        <label className="add-alum__field">
          <span>Class of</span>
          <input type="number" value={classOf} min={1980} max={THIS_YEAR + 1} disabled={busy}
            onChange={(e) => setClassOf(e.target.value)} placeholder={String(THIS_YEAR)} />
        </label>

        <label className="add-alum__field">
          <span>Stream</span>
          <select value={stream} disabled={busy} onChange={(e) => setStream(e.target.value)}>
            <option value="">Choose…</option>
            {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="add-alum__field add-alum__field--wide">
          <span>School</span>
          <select value={school} disabled={busy} onChange={(e) => setSchool(e.target.value)}>
            {SCHOOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="add-alum__field add-alum__field--wide">
          <span>Email</span>
          <input type="email" value={email} maxLength={120} disabled={busy}
            onChange={(e) => setEmail(e.target.value)} placeholder="Optional if you have their number" />
        </label>

        <label className="add-alum__field add-alum__field--wide">
          <span>Phone</span>
          <div className="add-alum__phone">
            <select value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} aria-label="Country code">
              {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="tel" value={phone} maxLength={20} disabled={busy}
              onChange={(e) => setPhone(e.target.value)} placeholder="Optional if you have their email" />
          </div>
        </label>

        <label className="add-alum__field add-alum__field--wide">
          <span>College, if you know it</span>
          <input type="text" value={college} maxLength={120} disabled={busy}
            onChange={(e) => setCollege(e.target.value)} placeholder="They can correct it themselves" />
        </label>

        <label className="add-alum__field add-alum__field--wide">
          <span>A note for the office (they never see this)</span>
          <input type="text" value={note} maxLength={300} disabled={busy}
            onChange={(e) => setNote(e.target.value)} placeholder="Where this came from, who to ask…" />
        </label>
      </div>

      <label className="add-alum__check">
        <input type="checkbox" checked={createLogin} disabled={busy} onChange={(e) => setCreateLogin(e.target.checked)} />
        <span>Create a login and show me a temporary password to pass on</span>
      </label>

      {err && <p className="field__error field__error--static">{err}</p>}

      <div className="add-alum__buttons">
        <button type="button" className="btn btn--primary" disabled={busy || !fullName.trim() || !classOf || !stream} onClick={submit}>
          <span className="btn__inner">{busy ? 'Adding…' : 'Add them'}</span>
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { reset(); setOpen(false); }}>
          <span className="btn__inner">Cancel</span>
        </button>
      </div>
    </div>
  );
}
