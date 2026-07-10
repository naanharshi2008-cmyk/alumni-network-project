'use client';

import { useState , useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { commonColleges } from '../../lib/commonColleges';
import { commonOrganizations } from '../../lib/commonOrganizations';

const initialForm = {
  full_name: '',
  admission_number: '',
  show_photo: 'no',photo_file: null,
  class_of: '',
  stream: 'Bio-Maths',
  personal_email: '',
  phone_number: '',
  linkedin_url: '',
  college_name: '',
  degree: '',
  branch: '',
  field: '',
  admission_route: 'JEE Main',
  admission_rank: '',
  current_status: 'Studying UG',
  currently_at: '',
  designation: '',
  message_1: '',
  message_2: '',
  consent_given: false,
};

export default function RegisterPage() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const [collegeOptions, setCollegeOptions] = useState(commonColleges);

  useEffect(() => {
    async function loadColleges() {
      const { data } = await supabase.from('colleges').select('name').order('name');
      if (data) {
        const dbNames = data.map((c) => c.name);
        const combined = Array.from(new Set([...commonColleges, ...dbNames])).sort();
        setCollegeOptions(combined);
      }
    }
    loadColleges();
  }, []);
  const [orgOptions, setOrgOptions] = useState(commonOrganizations);

  useEffect(() => {
    async function loadOrgs() {
      const { data } = await supabase.from('alumni').select('currently_at');
      if (data) {
        const dbOrgs = data.map((a) => a.currently_at).filter(Boolean);
        const combined = Array.from(new Set([...commonOrganizations, ...dbOrgs])).sort();
        setOrgOptions(combined);
      }
    }
    loadOrgs();
  }, []);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.consent_given) {
      setError('Please check the consent box before submitting.');
      return;
    }
    if (!form.full_name || !form.admission_number || !form.class_of) {
      setError('Full name, admission number, and class of year are required.');
      return;
    }
    let photoUrl = null;
    if (form.photo_file) {
      const fileExt = form.photo_file.name.split('.').pop();
      const fileName = `${form.admission_number.trim()}-${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await supabase.storage
        .from('photos')
        .upload(fileName, form.photo_file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from('photos')
        .getPublicUrl(fileName);
      photoUrl = urlData.publicUrl;
    }

    setSubmitting(true);
    try {
      // Step 1: find or create the college
      let collegeId = null;
      if (form.college_name.trim()) {
        const { data: existing } = await supabase
          .from('colleges')
          .select('id')
          .ilike('name', form.college_name.trim())
          .maybeSingle();

        if (existing) {
          collegeId = existing.id;
        } else {
          const { data: created, error: collegeErr } = await supabase
            .from('colleges')
            .insert({ name: form.college_name.trim(), status: 'pending' })
            .select('id')
            .single();
          if (collegeErr) throw collegeErr;
          collegeId = created.id;
        }
      }

      // Step 2: insert the alumni row
      const { error: insertErr } = await supabase.from('alumni').insert({
        full_name: form.full_name.trim(),
        admission_number: form.admission_number.trim(),
        show_photo: form.show_photo === 'yes',
        photo_url: photoUrl,
        class_of: parseInt(form.class_of, 10),
        stream: form.stream,
        personal_email: form.personal_email.trim() || null,
        phone_number: form.phone_number.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        college_id: collegeId,
        degree: form.degree.trim() || null,
        branch: form.branch.trim() || null,
        field: form.field.trim() || null,
        admission_route: form.admission_route,
        admission_rank: form.admission_rank.trim() || null,
        current_status: form.current_status,
        currently_at: form.currently_at.trim() || null,
        designation: form.designation.trim() || null,
        message_1: form.message_1.trim() || null,
        message_2: form.message_2.trim() || null,
        consent_given: true,
        approval_status: 'pending',
      });
      if (insertErr) throw insertErr;

      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setError(
        'Something went wrong submitting your details: ' +
          (err.message || 'unknown error')
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const shareText = 'Register yourself on the Veveaham Alumni site!';
    const whatsappLink = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
    const emailLink = `mailto:?subject=${encodeURIComponent('Veveaham Alumni Registration')}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;

    return (
      <div className="container">
        <div className="card success-box">
          <h1>Thank you!</h1>
          <p>
            Your details have been submitted and are waiting for admin
            approval. Once approved, your profile will appear on the site.
          </p>
          <p>
            Please share this registration link with at least one friend or
            senior:
          </p>
          <p><strong>{shareUrl}</strong></p>

          
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
              <button
                type="button"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#25D366' }}
              >
                <span style={{ fontSize: '18px' }}>💬</span> WhatsApp
              </button>
            </a>
            <a href={emailLink}>
              <button
                type="button"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#D44638' }}
              >
                <span style={{ fontSize: '18px' }}>📧</span> Email
              </button>
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                alert('Link copied! You can paste it in an Instagram DM or story.');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#C13584' }}
            >
              <span style={{ fontSize: '18px' }}>📷</span> Instagram
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Register Yourself</h1>
        <p className="subtitle">
          Fill this in so juniors can know where you are and what you're
          doing now. Your email and phone number are never shown publicly.
        </p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Full Name</label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              required
            />
          </div>

          <div className="two-col">
            <div className="field">
              <label>Admission Number</label>
              <input
                type="text"
                value={form.admission_number}
                onChange={(e) => update('admission_number', e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Class Of (Graduating Year)</label>
              <input
                type="number"
                value={form.class_of}
                onChange={(e) => update('class_of', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="two-col">
            <div className="field">
              <label>Stream at School</label>
              <select
                value={form.stream}
                onChange={(e) => update('stream', e.target.value)}
              >
                <option>Bio-Maths</option>
                <option>CS-Maths</option>
                <option>Commerce</option>
                <option>Other</option>
              </select>
            </div>
            <div className="field">
              <label>
                Show Photo Publicly?
                <span className="hint">Photo upload coming soon</span>
              </label>
              <select
                value={form.show_photo}
                onChange={(e) => update('show_photo', e.target.value)}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Upload Photo</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => update('photo_file', e.target.files[0])}
            />
          </div>

          <div className="two-col">
            <div className="field">
              <label>
                Personal Email <span className="hint">Never shown publicly</span>
              </label>
              <input
                type="email"
                value={form.personal_email}
                onChange={(e) => update('personal_email', e.target.value)}
              />
            </div>
            <div className="field">
              <label>
                Phone Number <span className="hint">Never shown publicly</span>
              </label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={(e) => update('phone_number', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>LinkedIn URL</label>
            <input
              type="url"
              value={form.linkedin_url}
              onChange={(e) => update('linkedin_url', e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </div>

          <div className="field">
  <label>Undergraduate College</label>
  <input
    type="text"
    list="college-list"
    value={form.college_name}
    onChange={(e) => update('college_name', e.target.value)}
  />
  <datalist id="college-list">
    {collegeOptions.map((name) => (
      <option key={name} value={name} />
    ))}
  </datalist>
</div>
          <div className="two-col">
            <div className="field">
              <label>Degree</label>
              <input
                type="text"
                value={form.degree}
                onChange={(e) => update('degree', e.target.value)}
                placeholder="BTech, BSc, MBBS..."
              />
            </div>
            <div className="field">
              <label>Branch/Department</label>
              <input
                type="text"
                value={form.branch}
                onChange={(e) => update('branch', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
  <label>Field</label>
  <select
    value={form.field}
    onChange={(e) => update('field', e.target.value)}
  >
    <option value="">-- Select --</option>
    <option>Medicine</option>
    <option>Engineering</option>
    <option>Arts</option>
    <option>Science</option>
    <option>Architecture</option>
    <option>Law</option>
    <option>Allied Health Science</option>
    <option>Agriculture</option>
    <option>Other</option>
  </select>
</div>

          <div className="two-col">
            <div className="field">
              <label>Admission Route</label>
              <select
                value={form.admission_route}
                onChange={(e) => update('admission_route', e.target.value)}
              >
                <option>JEE Main</option>
                <option>JEE Advanced</option>
                <option>NEET</option>
                <option>CUET</option>
                <option>Board Marks</option>
                <option>Sports Quota</option>
                <option>Other</option>
              </select>
            </div>
            <div className="field">
              <label>Admission Rank (optional)</label>
              <input
                type="text"
                value={form.admission_rank}
                onChange={(e) => update('admission_rank', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Current Status</label>
            <select
              value={form.current_status}
              onChange={(e) => update('current_status', e.target.value)}
            >
              <option>Studying UG</option>
              <option>Studying PG</option>
              <option>Working</option>
              <option>Entrepreneur</option>
              <option>Preparing</option>
              <option>Other</option>
            </select>
          </div>

          <div className="two-col">
            <div className="field">
              <label>Currently At (Org/Institute)</label>
              <input
                type="text"
                value={form.currently_at}
                onChange={(e) => update('currently_at', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Designation/Role</label>
              <input
                type="text"
                value={form.designation}
                onChange={(e) => update('designation', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>One thing I wish I knew in Class 11/12</label>
            <textarea
              value={form.message_1}
              onChange={(e) => update('message_1', e.target.value)}
            />
          </div>

          <div className="field">
            <label>One tip for someone in my stream</label>
            <textarea
              value={form.message_2}
              onChange={(e) => update('message_2', e.target.value)}
            />
          </div>

          <div className="checkbox-row">
            <input
              type="checkbox"
              checked={form.consent_given}
              onChange={(e) => update('consent_given', e.target.checked)}
              id="consent"
            />
            <label htmlFor="consent" style={{ fontWeight: 'normal' }}>
              I agree that my name, and the details I choose to share above,
              can be displayed publicly on the Veveaham alumni site. My email
              and phone number will never be displayed publicly.
            </label>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
