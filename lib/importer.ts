/**
 * Reading the school's sheet into hidden profiles.
 *
 * Pure functions, no React and no database: the import page calls these, and
 * so can a scratch script run against the real sheets without printing a
 * single name. What the two response sheets taught (Round 10) is written
 * into the rules here:
 *
 *   - phone numbers were saved as spreadsheet numbers - 9.87654321E9 - and
 *     one respondent wrote "Mother-" before a number in the father's box;
 *   - 20% of names are in capitals, and toTitleCase leaves "PRIYA" shouting;
 *   - the exam box was a multi-select with "None of the above", and TNEA - not
 *     an exam - was one of its options;
 *   - the required free-text box is mostly "No", "Nil", "-", "_", "Nope";
 *   - courses arrive as one string - "B.E cse", "Bsc biotechnology", "AI&ML";
 *   - "Neet repeater" and a coaching academy were typed wherever there was room;
 *   - the 2024-25 export repeats every question with a " 2" suffix.
 *
 * Nothing here decides for the office. A row it cannot trust is flagged, a
 * college it cannot place is left for a person to pick, and nothing is
 * created until the office presses the button.
 */

import { examCanonical, isTnea, normText } from './exams';
import { contextualBranchAliases, type Relation } from './forms/model';
import { canonicalBranch, type Vocab } from './forms/vocab';
import { emailKey, phoneKey } from './contactKeys';
import { SCHOOLS, STREAMS, boardForSchool, officialSchoolName } from './options';
import type { AdmissionKind } from './types';

/* ─────────────────────────────────────────────────────────────────────────
   CSV
───────────────────────────────────────────────────────────────────────── */
/** RFC 4180, with the leniency real exports need: CRLF, a BOM, ragged rows. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/* ─────────────────────────────────────────────────────────────────────────
   The school's template
───────────────────────────────────────────────────────────────────────── */
export type TemplateColumn = {
  key: string;
  header: string;
  group: 'Student' | 'Family & home' | 'After Class 12' | 'Exams written' | 'Offers not taken' | 'Now' | 'Office';
  about: string;
  example: string;
  allowed?: readonly string[];
  required?: boolean;
};

export const AFTER_SCHOOL_VALUES = ['Joined a college', 'Gap year - preparing', 'Gap year - break', 'Something else'] as const;
export const HOW_VALUES = ['Board marks', 'Board marks (TNEA)', 'Entrance exam', 'Management seat', 'Other'] as const;
export const SCHOOL_VALUES = ['Boys', 'Girls', 'Prime Academy'] as const;
export const EXAM_SLOTS = 5;
export const OFFER_SLOTS = 3;

const exam = (n: number): TemplateColumn[] => [
  { key: `exam_${n}`, header: `Exam ${n}`, group: 'Exams written', about: 'An entrance exam they wrote, any of them — not only the one that got the seat.', example: n === 1 ? 'JEE Main' : n === 2 ? 'AMRITAEEE' : '' },
  { key: `exam_${n}_year`, header: `Exam ${n} year`, group: 'Exams written', about: 'The year they wrote it, if not the year they finished school.', example: '' },
  { key: `exam_${n}_rank`, header: `Exam ${n} rank`, group: 'Exams written', about: 'Their rank, if they know it. Only ever shown as a range.', example: n === 1 ? '23456' : '' },
  { key: `exam_${n}_offer`, header: `Exam ${n} got an offer`, group: 'Exams written', about: 'Did it lead to an offer anywhere?', example: n === 1 ? 'Yes' : '', allowed: ['Yes', 'No'] },
];
const offer = (n: number): TemplateColumn[] => [
  { key: `offer_${n}_college`, header: `Offer ${n} college`, group: 'Offers not taken', about: 'A college that offered them a seat they did not take.', example: n === 1 ? 'Amrita Vishwa Vidyapeetham, Coimbatore' : '' },
  { key: `offer_${n}_degree`, header: `Offer ${n} degree`, group: 'Offers not taken', about: 'The degree offered.', example: n === 1 ? 'BTech' : '' },
  { key: `offer_${n}_branch`, header: `Offer ${n} branch`, group: 'Offers not taken', about: 'The branch offered.', example: n === 1 ? 'Information Technology' : '' },
  { key: `offer_${n}_exam`, header: `Offer ${n} through exam`, group: 'Offers not taken', about: 'The exam the offer came through, if any.', example: n === 1 ? 'AMRITAEEE' : '' },
];

/** Every column the platform holds for a person, in the order the template lists them. */
export const TEMPLATE: TemplateColumn[] = [
  { key: 'full_name', header: 'Full name', group: 'Student', required: true, about: 'As the school records it. Initials are fine.', example: 'Priya S' },
  { key: 'class_of', header: 'Class of', group: 'Student', required: true, about: 'The year they finished Class 12. Can be set once for the whole file instead.', example: '2025' },
  { key: 'school', header: 'School', group: 'Student', required: true, about: 'Which Veveaham school.', example: 'Boys', allowed: SCHOOL_VALUES },
  { key: 'stream', header: 'Stream', group: 'Student', about: 'Their Class 11-12 stream.', example: 'Computer Science (Maths)', allowed: STREAMS.filter((s) => s !== 'Other') },
  { key: 'email', header: 'Student email', group: 'Student', about: 'Where the claim link is emailed. They sign in with it.', example: 'priya.s@gmail.com' },
  { key: 'phone', header: 'Student phone', group: 'Student', about: 'Ten digits. They can sign in with it too.', example: '9876543210' },
  { key: 'parent1_name', header: 'Parent 1 name', group: 'Family & home', about: 'Never shown publicly.', example: 'Senthil K' },
  { key: 'parent1_relation', header: 'Parent 1 is', group: 'Family & home', about: 'Father, Mother or Guardian.', example: 'Father', allowed: ['Father', 'Mother', 'Guardian'] },
  { key: 'parent1_phone', header: 'Parent 1 phone', group: 'Family & home', about: 'Ten digits.', example: '9876500000' },
  { key: 'parent2_name', header: 'Parent 2 name', group: 'Family & home', about: 'Optional.', example: '' },
  { key: 'parent2_relation', header: 'Parent 2 is', group: 'Family & home', about: 'Father, Mother or Guardian.', example: '', allowed: ['Father', 'Mother', 'Guardian'] },
  { key: 'parent2_phone', header: 'Parent 2 phone', group: 'Family & home', about: 'Optional.', example: '' },
  { key: 'address_line', header: 'House and street', group: 'Family & home', about: 'Never shown publicly.', example: '12, Gandhi Street' },
  { key: 'town', header: 'Town', group: 'Family & home', about: '', example: 'Dharapuram' },
  { key: 'district', header: 'District', group: 'Family & home', about: '', example: 'Tiruppur' },
  { key: 'state', header: 'State', group: 'Family & home', about: 'Tamil Nadu if blank.', example: 'Tamil Nadu' },
  { key: 'pin', header: 'PIN', group: 'Family & home', about: 'Six digits.', example: '638656' },
  { key: 'after_school', header: 'After Class 12', group: 'After Class 12', about: 'What they did straight after school. A gap year keeps the page private until they have joined somewhere.', example: 'Joined a college', allowed: AFTER_SCHOOL_VALUES },
  { key: 'college', header: 'College', group: 'After Class 12', about: 'Any spelling — the import offers the matching college to confirm.', example: 'PSG College of Technology' },
  { key: 'degree', header: 'Degree', group: 'After Class 12', about: 'BE, BTech, BSc, BCom…', example: 'BE' },
  { key: 'branch', header: 'Branch', group: 'After Class 12', about: 'Short forms are understood — CSE, ECE, AI&DS.', example: 'CSE' },
  { key: 'course', header: 'Course', group: 'After Class 12', about: 'Or degree and branch together, as the form collected them — "B.E CSE".', example: '' },
  { key: 'how', header: 'How they got in', group: 'After Class 12', about: 'Never the word "quota". TNEA is board marks.', example: 'Board marks (TNEA)', allowed: HOW_VALUES },
  { key: 'how_exam', header: 'Seat exam', group: 'After Class 12', about: 'For an entrance exam: which one.', example: '' },
  { key: 'how_rank', header: 'Seat exam rank', group: 'After Class 12', about: 'Optional. Only ever shown as a range.', example: '' },
  { key: 'board_marks', header: 'Class 12 marks (%)', group: 'After Class 12', about: 'Optional. Only ever shown as a range.', example: '96' },
  { key: 'tnea_cutoff', header: 'TNEA cutoff', group: 'After Class 12', about: 'Optional, out of 200.', example: '192.5' },
  { key: 'how_other', header: 'Other way in', group: 'After Class 12', about: 'For Other: a few words.', example: '' },
  { key: 'gap_exam', header: 'Gap year exam', group: 'After Class 12', about: 'For a gap year spent preparing: the exam.', example: '' },
  { key: 'gap_coaching', header: 'Gap year coaching', group: 'After Class 12', about: 'The coaching centre, if any.', example: '' },
  ...Array.from({ length: EXAM_SLOTS }, (_, i) => exam(i + 1)).flat(),
  ...Array.from({ length: OFFER_SLOTS }, (_, i) => offer(i + 1)).flat(),
  { key: 'current_status', header: 'Doing now', group: 'Now', about: 'Leave blank for a current student.', example: '' },
  { key: 'currently_at', header: 'Working at', group: 'Now', about: '', example: '' },
  { key: 'linkedin', header: 'LinkedIn', group: 'Now', about: 'A link or just the username.', example: '' },
  { key: 'office_note', header: 'Office note', group: 'Office', about: 'Only the school ever sees this.', example: 'Called in June; brother in Class 10' },
];

/** Columns only a raw form export has: the exam multi-select and its free-text box. */
const FORM_ONLY = ['exams_multi', 'exams_other'] as const;

export const FIELD_KEYS = [...TEMPLATE.map((c) => c.key), ...FORM_ONLY];
export type FieldKey = (typeof FIELD_KEYS)[number] | string;

export function templateCsv(): string {
  return toCsv([TEMPLATE.map((c) => c.header), TEMPLATE.map((c) => c.example)]);
}

/* ─────────────────────────────────────────────────────────────────────────
   Matching columns to fields
───────────────────────────────────────────────────────────────────────── */
const hkey = (h: string) => normText(h).replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The school's Google Form, as exported: header -> field. */
const FORM_HEADERS: Record<string, string> = {
  'name of the student with initial': 'full_name',
  'name of father with initial': 'parent1_name',
  "father's contact no": 'parent1_phone',
  "student's contact no": 'phone',
  "student's email": 'email',
  'email address': 'email',
  'school studied': 'school',
  'name of the college joined': 'college',
  'name of the course joined': 'course',
  'name of the competitive exam s that you have applied for': 'exams_multi',
  'name of the competitive exam s that you have appeared for': 'exams_multi',
  'please specify the name of any other applied competitive exam and course': 'exams_other',
};

export type Mapping = Record<string, number[]>;

/**
 * Which columns feed which field. A header the template knows maps by name;
 * a header from the school's Google Form maps by the form's wording; a
 * repeated question ("… 2") becomes a fallback for the first. Anything else
 * is left for the office to assign.
 */
export function autoMap(headers: string[]): { mapping: Mapping; unmatched: number[]; format: 'template' | 'form' | 'mixed' } {
  const byHeader = new Map(TEMPLATE.map((c) => [hkey(c.header), c.key]));
  const mapping: Mapping = {};
  const unmatched: number[] = [];
  let template = 0; let form = 0;
  headers.forEach((raw, i) => {
    const h = hkey(raw);
    if (!h || h === 'timestamp') return;
    const base = h.replace(/ 2$/, '');
    const key = byHeader.get(h) ?? byHeader.get(base) ?? FORM_HEADERS[h] ?? FORM_HEADERS[base]
      ?? (TEMPLATE.some((c) => c.key === h.replace(/ /g, '_')) ? h.replace(/ /g, '_') : undefined);
    if (!key) { unmatched.push(i); return; }
    if (byHeader.has(h) || byHeader.has(base)) template++; else form++;
    (mapping[key] ??= []).push(i);
  });
  return { mapping, unmatched, format: form === 0 ? 'template' : template === 0 ? 'form' : 'mixed' };
}

/* ─────────────────────────────────────────────────────────────────────────
   Cleaning one value
───────────────────────────────────────────────────────────────────────── */
const JUNK = new Set(['', '-', '_', '.', 'no', 'nil', 'nill', 'nope', 'none', 'no one', 'not applied', 'na', 'n/a', 'nothing',
  'none of the above', 'nil.', 'no.', 'nothing else', 'not attended', 'not applicable', 'not yet joined', 'not joined', 'general']);

/** A cell that says nothing: "No", "Nil", "-", "None of the above". */
export function isJunk(value: string | null | undefined): boolean {
  return JUNK.has(normText(value).replace(/[.!]+$/, ''));
}

/**
 * Names as people write them, not as a spreadsheet shouts them. Only a name
 * entirely in one case is re-cased; a mixed-case name is someone's choice.
 * Initials stay capitals: "R.S. PRIYA" -> "R.S. Priya".
 */
export function toNameCase(name: string | null | undefined): string {
  const s = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const letters = s.replace(/[^A-Za-z]/g, '');
  const oneCase = letters === letters.toUpperCase() || letters === letters.toLowerCase();
  if (!oneCase) return s;
  return s.split(' ').map((w) => {
    if (/^([A-Za-z]\.)+[A-Za-z]?\.?$/.test(w) || /^[A-Za-z]$/.test(w)) return w.toUpperCase();
    return w.split(/([-'])/).map((p) => (p.length > 1 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toUpperCase())).join('');
  }).join(' ');
}

export type PhoneRead = { code: string; number: string; problem: string; relationHint: Relation };

/**
 * A phone number from a spreadsheet cell. Handles the scientific notation a
 * spreadsheet turns a mobile number into, a leading +91 or 0, spaces, and a
 * word such as "Mother-" in front - which it reports rather than drops.
 */
export function readPhone(raw: string | null | undefined): PhoneRead {
  const s = (raw ?? '').trim();
  const relationHint: Relation = /mother|amma/i.test(s) ? 'Mother' : /father|appa/i.test(s) ? 'Father' : /guardian/i.test(s) ? 'Guardian' : '';
  if (!s || isJunk(s)) return { code: '+91', number: '', problem: '', relationHint };
  let digits: string;
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    digits = Number.isFinite(n) ? n.toFixed(0) : '';
  } else {
    digits = s.replace(/\D/g, '');
  }
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[6-9]/.test(digits)) {
    return { code: '+91', number: '', problem: `“${s.length > 18 ? `${s.slice(0, 18)}…` : s}” is not a 10-digit mobile number`, relationHint };
  }
  return { code: '+91', number: digits, problem: '', relationHint };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN_FIXES: Record<string, string> = {
  'gamil.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.om': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.comm': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com',
};

/** An email, with the typos the sheets held corrected - and said so. */
export function readEmail(raw: string | null | undefined): { email: string; fixed: string | null; problem: string } {
  const s = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s || isJunk(s)) return { email: '', fixed: null, problem: '' };
  const at = s.lastIndexOf('@');
  const domain = at > 0 ? s.slice(at + 1) : '';
  const fix = DOMAIN_FIXES[domain];
  const email = fix ? `${s.slice(0, at + 1)}${fix}` : s;
  if (!EMAIL_RE.test(email)) return { email: '', fixed: null, problem: `“${s}” does not look like an email` };
  return { email, fixed: fix ? `${domain} → ${fix}` : null, problem: '' };
}

/** Which of the three schools. The form said "Veveaham Boys School". */
export function readSchool(raw: string | null | undefined): string {
  const s = normText(raw);
  if (!s) return '';
  if (/boys/.test(s)) return SCHOOLS[0];
  if (/girls/.test(s)) return SCHOOLS[1];
  if (/prime/.test(s)) return SCHOOLS[2];
  const official = officialSchoolName(raw);
  return (SCHOOLS as readonly string[]).includes(official) ? official : '';
}

const DEGREE_SPELLINGS: [RegExp, string][] = [
  [/^b\.?\s?e\b\.?/, 'BE'], [/^b\.?\s?tech\b\.?/, 'BTech'], [/^b\.?\s?arch\b/, 'BArch'], [/^b\.?\s?des\b/, 'BDes'],
  [/^mbbs\b/, 'MBBS'], [/^b\.?\s?d\.?\s?s\b/, 'BDS'], [/^bams\b/, 'BAMS'], [/^bhms\b/, 'BHMS'], [/^b\.?\s?s\.?\s?m\.?\s?s\b/, 'BSMS'],
  [/^bs[-\s]?ms\b/, 'BSMS'], [/^b\.?\s?pharm\b\.?/, 'BPharm'], [/^pharm\.?\s?d\b/, 'PharmD'],
  [/^b\.?\s?sc\.?\s?(\(\s*)?nursing\b/, 'BSc Nursing'], [/^b\.?\s?p\.?\s?t\b/, 'BPT'], [/^integrated\s+m\.?\s?sc\b/, 'Integrated MSc'],
  [/^b\.?\s?sc\b\.?/, 'BSc'], [/^b\.?\s?c\.?\s?a\b\.?/, 'BCA'], [/^b\.?\s?com\b\.?/, 'BCom'], [/^b\.?\s?b\.?\s?a\b\.?\s?(ll\.?b)?/, 'BBA'],
  [/^b\.?\s?a\.?\s?ll\.?\s?b\b/, 'BA LLB'], [/^ll\.?\s?b\b/, 'LLB'], [/^b\.?\s?a\b\.?/, 'BA'], [/^b\.?\s?voc\b/, 'BVoc'],
  [/^diploma\b/, 'Diploma'], [/^b\.?\s?ed\b/, 'BEd'],
];

/** Letters and digits only, with the spellings that differ by a letter folded together. */
function compact(v: string): string {
  return normText(v)
    .replace(/&/g, ' and ')
    .replace(/\belectronics\b/g, 'electronic').replace(/\bengg\b/g, 'engineering')
    .replace(/\binstruments?\b/g, 'instrumentation').replace(/\bartifical\b/g, 'artificial')
    .replace(/\banalysit\w*/g, 'analytics').replace(/\bw\/s\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The branch a typed string names, or '' when none on the list does. Tried as
 * written, without a trailing "(...)", as the "(...)" alone, and in parts -
 * "AIDS-Artificial Intelligence and Data Science" is found by its first part,
 * "Computer Science Engineering (cse" by either.
 */
export function resolveBranch(text: string, branches: Vocab, degree: string): string {
  const ctx = contextualBranchAliases(degree);
  const table = new Map<string, string>();
  for (const o of branches.options) table.set(compact(o), o);
  for (const [a, c] of Object.entries(branches.aliases)) table.set(compact(a), c);
  for (const [a, c] of Object.entries(ctx)) table.set(compact(a), c);
  const t = text.trim();
  const expanded = t.replace(/^(cs|ca)\b/i, (m) => ctx[m.toLowerCase()] ?? m);
  const tries = [
    t, expanded, t.replace(/\(.*$/, ''), expanded.replace(/\(.*$/, ''),
    t.match(/\(([^)]*)\)?/)?.[1] ?? '',
    ...t.split(/\s*[-–/]\s*|\s+with\s+/i),
  ];
  for (const x of tries) {
    const hit = x && table.get(compact(x));
    if (hit) return hit;
  }
  return '';
}

/** "B.E cse" -> BE + Computer Science and Engineering. The degree may be implied, and stays blank then. */
export function splitCourse(raw: string | null | undefined, branches: Vocab): { degree: string; branch: string } {
  let s = normText(raw).replace(/^(in|of)\s+/, '');
  if (!s || isJunk(s)) return { degree: '', branch: '' };
  let degree = '';
  for (const [re, d] of DEGREE_SPELLINGS) {
    const m = s.match(re);
    if (m) {
      degree = /llb/.test(m[0]) && d === 'BBA' ? 'BBA LLB' : d;
      s = s.slice(m[0].length);
      break;
    }
  }
  // A degree written after the branch: "Biotechnology (b.tech".
  if (!degree) {
    const tail = s.match(/\(\s*([a-z. ]{2,12})\)?\s*$/);
    if (tail) {
      const found = DEGREE_SPELLINGS.find(([re]) => re.test(tail[1].trim()));
      if (found) { degree = found[1]; s = s.slice(0, tail.index); }
    }
  }
  const rest = s.replace(/^[\s.,:\-–(]+|[\s.,:\-–(]+$/g, '').replace(/^(in|of)\s+/, '');
  if (!rest || isJunk(rest)) return { degree, branch: '' };
  const hit = resolveBranch(rest, branches, degree);
  // Kept as typed when the list has nothing for it, tidied - an unclosed
  // bracket is a typo, not part of the name.
  return { degree, branch: hit || toNameCase(rest.replace(/[([][^)\]]*$/, '').trim() || rest) };
}

/** Did the text say they took a year to try again? "Neet repeater", "long term coaching". */
export function gapSignal(...texts: (string | null | undefined)[]): { gap: boolean; exam: string | null } {
  const all = texts.map((t) => normText(t)).join(' ');
  if (!/repeat|preparation|preparing|long ?term|coaching|academy|drop(ped)?\b|break year|gap year/.test(all)) return { gap: false, exam: null };
  const exam = /neet/.test(all) ? 'NEET' : /jee/.test(all) ? 'JEE Main' : null;
  return { gap: true, exam };
}

/* ─────────────────────────────────────────────────────────────────────────
   A whole row
───────────────────────────────────────────────────────────────────────── */
export type ImportPayload = {
  import_key: string;
  full_name: string;
  class_of: number | null;
  school_name: string | null;
  school_board: string | null;
  stream: string | null;
  personal_email: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  college_id: string | null;
  college_name_raw: string | null;
  degree: string | null;
  branch: string | null;
  admission_kind: AdmissionKind | null;
  admission_exam: string | null;
  admission_detail: string | null;
  admission_rank: string | null;
  board_marks: string | null;
  board_cutoff: string | null;
  current_status: string | null;
  currently_at: string | null;
  linkedin_handle: string | null;
  in_gap_year: boolean;
  office_note: string | null;
  private: Record<string, string | null>;
  exam_attempts: { exam: string; exam_year: number | null; exam_rank: number | null; gave_admit: boolean | null; got_seat: boolean }[];
  admits: { college_id: string | null; college_name_raw: string | null; degree: string | null; branch: string | null; route_kind: AdmissionKind | null; exam: string | null; admit_year: number | null }[];
  gap_years: { gap_year: number; kind: 'preparing' | 'break'; exam: string | null; coaching_name_raw: string | null }[];
};

export type ImportRow = {
  /** The row's line in the sheet, counting the header as 1. */
  line: number;
  payload: ImportPayload;
  /** Stops this row from being created until fixed or excluded. */
  problems: string[];
  /** Worth a look, but not a reason to hold the row. */
  warnings: string[];
  /** The college as typed, for the office to confirm. */
  collegeText: string;
};

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim()) ? true : /^(n|no|false|0)$/i.test(v.trim()) ? false : null;
const intOf = (v: string) => { const d = v.replace(/\D/g, ''); return d && d.length <= 9 ? parseInt(d, 10) : null; };

function linkedinHandleOf(v: string): string | null {
  const m = v.match(/linkedin\.com\/(?:mwlite\/)?in\/([^/?#\s]+)/i);
  const h = (m ? m[1] : v.replace(/^@/, '')).trim().toLowerCase();
  return /^[a-z0-9_-]{3,100}$/.test(h) ? h : null;
}

/**
 * One sheet row, read. `cell(key)` gives the first non-blank mapped value
 * for a field. `classOf` is the file's year, used when a row has none.
 */
export function readRow(
  line: number,
  cell: (key: string) => string,
  opts: { classOf: number | null; exams: Vocab; branches: Vocab },
): ImportRow {
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const aliases = opts.exams.aliases;

  const name = toNameCase(cell('full_name'));
  if (name.length < 2) problems.push('No name');

  const classOf = intOf(cell('class_of')) ?? opts.classOf;
  if (!classOf || classOf < 1980 || classOf > 2100) problems.push('No class year — set one for the file');

  const school = readSchool(cell('school'));
  if (!school) problems.push(cell('school') ? `School “${cell('school')}” is not one of ours` : 'No school');

  const streamRaw = cell('stream');
  const stream = STREAMS.find((s) => normText(s) === normText(streamRaw)) ?? '';
  if (streamRaw && !stream) warnings.push(`Stream “${streamRaw}” left out — not one of the list`);

  const em = readEmail(cell('email'));
  if (em.problem) warnings.push(em.problem);
  if (em.fixed) warnings.push(`Email corrected: ${em.fixed}`);
  const ph = readPhone(cell('phone'));
  if (ph.problem) warnings.push(`Student phone: ${ph.problem}`);

  // Family and home.
  const p1 = readPhone(cell('parent1_phone'));
  const p2 = readPhone(cell('parent2_phone'));
  if (p1.problem) warnings.push(`Parent phone: ${p1.problem}`);
  const rel = (v: string, hint: Relation, fallback: Relation): Relation => {
    const r = normText(v);
    return r.startsWith('f') ? 'Father' : r.startsWith('m') ? 'Mother' : r.startsWith('g') ? 'Guardian' : hint || fallback;
  };
  // The form's only parent question was the father's; a "Mother-" in the box says otherwise.
  const formFather = !cell('parent1_relation') && !!cell('parent1_name');
  const r1 = rel(cell('parent1_relation'), p1.relationHint, formFather ? 'Father' : '');
  if (formFather && p1.relationHint && p1.relationHint !== 'Father') warnings.push(`Parent phone is marked “${p1.relationHint}” — check whose it is`);
  if (ph.number && p1.number && ph.number === p1.number) warnings.push('Student and parent have the same phone number');
  const pin = cell('pin').replace(/\D/g, '');
  if (cell('pin') && !/^[1-9][0-9]{5}$/.test(pin)) warnings.push(`PIN “${cell('pin')}” is not six digits — left out`);
  const priv = {
    guardian1_name: toNameCase(cell('parent1_name')) || null,
    guardian1_relation: toNameCase(cell('parent1_name')) ? (r1 || null) : null,
    guardian1_phone_code: '+91',
    guardian1_phone: p1.number || null,
    guardian2_name: toNameCase(cell('parent2_name')) || null,
    guardian2_relation: toNameCase(cell('parent2_name')) ? (rel(cell('parent2_relation'), p2.relationHint, '') || 'Guardian') : null,
    guardian2_phone_code: p2.number ? '+91' : null,
    guardian2_phone: p2.number || null,
    address_line: cell('address_line') || null,
    town: toNameCase(cell('town')) || null,
    district: toNameCase(cell('district')) || null,
    state: toNameCase(cell('state')) || (cell('address_line') || cell('town') ? 'Tamil Nadu' : null),
    pin: /^[1-9][0-9]{5}$/.test(pin) ? pin : null,
  };

  // After Class 12.
  const collegeCell = isJunk(cell('college')) ? '' : cell('college');
  const courseCell = cell('course');
  const examsOther = cell('exams_other');
  const signal = gapSignal(collegeCell, courseCell, examsOther);
  const afterRaw = normText(cell('after_school'));
  const after: 'joined' | 'gap-prep' | 'gap-break' | 'other' =
    afterRaw.startsWith('gap year - b') ? 'gap-break'
      : afterRaw.startsWith('gap') ? 'gap-prep'
        : afterRaw.startsWith('something') ? 'other'
          : afterRaw.startsWith('joined') ? 'joined'
            : signal.gap ? 'gap-prep'
              : collegeCell ? 'joined' : 'other';
  if (!afterRaw && signal.gap) warnings.push('Read as a gap year from what they wrote — check');
  const joined = after === 'joined';

  let degree = joined ? cell('degree') : '';
  let branch = joined ? cell('branch') : '';
  if (joined && !degree && !branch && courseCell) ({ degree, branch } = splitCourse(courseCell, opts.branches));
  else if (joined && branch) branch = resolveBranch(branch, opts.branches, degree) || canonicalBranch(branch, opts.branches, contextualBranchAliases(degree));
  if (joined && !collegeCell) problems.push('Joined a college, but which?');

  // How the seat was got - only when the sheet says. The form never asked,
  // and a guess would be published as if they had told us.
  const howRaw = normText(cell('how'));
  let kind: AdmissionKind | null = null;
  let detail: string | null = null;
  let seatExam: string | null = null;
  if (joined && howRaw) {
    if (howRaw.startsWith('board marks')) { kind = 'board_marks'; detail = /tnea/.test(howRaw) ? 'TNEA' : null; }
    else if (howRaw.startsWith('entrance')) {
      kind = 'entrance_exam';
      seatExam = examCanonical(cell('how_exam'), aliases) ?? (cell('how_exam').trim() || null);
      if (!seatExam) { kind = null; warnings.push('“Entrance exam” with no exam named — left blank'); }
    } else if (howRaw.startsWith('management')) kind = 'management';
    else if (howRaw.startsWith('other')) { kind = 'other'; detail = cell('how_other').trim() || null; }
    else warnings.push(`“How they got in” value “${cell('how')}” not understood — left blank`);
  }

  // Exams written: the template's slots, the form's multi-select, and exam
  // names in the form's free-text box. TNEA is not an exam; it is noted.
  const attempts = new Map<string, ImportPayload['exam_attempts'][number]>();
  const addAttempt = (examName: string, year: number | null, rank: number | null, offerd: boolean | null) => {
    const canonical = examCanonical(examName, aliases) ?? examName.replace(/\s+/g, ' ').trim();
    if (!canonical || isTnea(canonical) || isJunk(canonical)) return;
    const k = `${normText(canonical)}|${year ?? classOf ?? 0}`;
    const had = attempts.get(k);
    attempts.set(k, {
      exam: canonical, exam_year: year ?? classOf, exam_rank: rank ?? had?.exam_rank ?? null,
      gave_admit: offerd ?? had?.gave_admit ?? null, got_seat: false,
    });
    if (!examCanonical(canonical, aliases) && !opts.exams.options.some((o) => normText(o) === normText(canonical))) {
      warnings.push(`“${canonical}” is not on the exam list yet`);
    }
  };
  let tnea = false;
  for (let n = 1; n <= EXAM_SLOTS; n++) {
    const e = cell(`exam_${n}`);
    if (!e || isJunk(e)) continue;
    if (isTnea(e)) { tnea = true; continue; }
    addAttempt(e, intOf(cell(`exam_${n}_year`)), intOf(cell(`exam_${n}_rank`)), yes(cell(`exam_${n}_offer`)));
  }
  for (const tok of cell('exams_multi').split(/\s*,\s*/)) {
    if (!tok || isJunk(tok)) continue;
    if (isTnea(tok)) { tnea = true; continue; }
    addAttempt(tok, null, null, null);
  }
  if (examsOther && !isJunk(examsOther)) {
    const leftover: string[] = [];
    for (const tok of examsOther.split(/\s*(?:,|\/|&|\band\b|\+)\s*/i)) {
      if (!tok || isJunk(tok)) continue;
      if (isTnea(tok)) { tnea = true; continue; }
      if (examCanonical(tok, aliases)) addAttempt(tok, null, null, null);
      else leftover.push(tok.trim());
    }
    if (leftover.length) notes.push(`Also wrote in the form: ${leftover.join(', ')}`);
  }
  if (tnea && !kind) notes.push('Ticked TNEA in the form (counselling on board marks)');
  if (seatExam) {
    const k = `${normText(seatExam)}|${classOf ?? 0}`;
    const had = attempts.get(k);
    attempts.set(k, { exam: seatExam, exam_year: classOf, exam_rank: intOf(cell('how_rank')) ?? had?.exam_rank ?? null, gave_admit: true, got_seat: true });
  }

  // Offers not taken.
  const admits: ImportPayload['admits'] = [];
  for (let n = 1; n <= OFFER_SLOTS; n++) {
    const c = cell(`offer_${n}_college`);
    if (!c || isJunk(c)) continue;
    const ex = cell(`offer_${n}_exam`);
    const exCanon = ex && !isJunk(ex) ? (examCanonical(ex, aliases) ?? ex.trim()) : null;
    admits.push({
      college_id: null, college_name_raw: c.trim(), degree: cell(`offer_${n}_degree`) || null,
      branch: cell(`offer_${n}_branch`) ? canonicalBranch(cell(`offer_${n}_branch`), opts.branches, contextualBranchAliases(cell(`offer_${n}_degree`))) : null,
      route_kind: exCanon ? 'entrance_exam' : null, exam: exCanon, admit_year: classOf,
    });
  }

  // A year out.
  const gapYears: ImportPayload['gap_years'] = [];
  if ((after === 'gap-prep' || after === 'gap-break') && classOf) {
    const gx = cell('gap_exam') || signal.exam || '';
    gapYears.push({
      gap_year: classOf, kind: after === 'gap-break' ? 'break' : 'preparing',
      exam: after === 'gap-prep' && gx ? (examCanonical(gx, aliases) ?? gx) : null,
      coaching_name_raw: after === 'gap-prep' ? (cell('gap_coaching') || (signal.gap && !joined ? collegeCell : '') || null) : null,
    });
  }

  const officeNote = [cell('office_note').trim(), ...notes].filter(Boolean).join('\n') || null;
  const li = cell('linkedin') ? linkedinHandleOf(cell('linkedin')) : null;
  if (cell('linkedin') && !li) warnings.push('LinkedIn not understood — left out');

  const key = emailKey(em.email) ? `e:${emailKey(em.email)}`
    : phoneKey(ph.code, ph.number) ? `p:${phoneKey(ph.code, ph.number)}`
      : `n:${normText(name)}|${classOf ?? ''}|${normText(school)}`;

  return {
    line,
    collegeText: joined ? collegeCell.trim() : '',
    problems,
    warnings,
    payload: {
      import_key: key,
      full_name: name,
      class_of: classOf ?? null,
      school_name: school || null,
      school_board: school ? boardForSchool(school) : null,
      stream: stream || null,
      personal_email: em.email || null,
      phone_country_code: ph.number ? ph.code : null,
      phone_number: ph.number || null,
      college_id: null,
      college_name_raw: joined ? (collegeCell.trim() || null) : null,
      degree: degree || null,
      branch: branch || null,
      admission_kind: kind,
      admission_exam: seatExam,
      admission_detail: detail,
      admission_rank: kind === 'entrance_exam' ? (cell('how_rank').replace(/\D/g, '') || null) : null,
      board_marks: cell('board_marks').trim() || null,
      board_cutoff: cell('tnea_cutoff').trim() || null,
      current_status: cell('current_status').trim() || null,
      currently_at: cell('currently_at').trim() || null,
      linkedin_handle: li,
      in_gap_year: after === 'gap-prep' || after === 'gap-break',
      office_note: officeNote,
      private: priv,
      exam_attempts: [...attempts.values()].sort((x, y) => Number(y.got_seat) - Number(x.got_seat)),
      admits,
      gap_years: gapYears,
    },
  };
}

/** Every data row of a table, read with a mapping. Blank rows are skipped. */
export function readTable(
  table: string[][], mapping: Mapping, opts: { classOf: number | null; exams: Vocab; branches: Vocab },
): ImportRow[] {
  const out: ImportRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    if (!r.some((c) => (c ?? '').trim())) continue;
    const cell = (key: string) => {
      for (const idx of mapping[key] ?? []) {
        const v = (r[idx] ?? '').trim();
        if (v) return v;
      }
      return '';
    };
    out.push(readRow(i + 1, cell, opts));
  }
  return markDuplicates(out);
}

/**
 * Two rows for one person - the sheets had two students submit twice, once
 * with a different email. The same key, or the same name with the same
 * phone, holds the later row; the same phone alone is only worth a look
 * (siblings share a parent's number).
 */
export function markDuplicates(rows: ImportRow[]): ImportRow[] {
  const seen = new Map<string, number>();
  const phones = new Map<string, { line: number; name: string }>();
  for (const row of rows) {
    const k = row.payload.import_key;
    const name = normText(row.payload.full_name);
    const p = row.payload.phone_number;
    const byPhone = p ? phones.get(p) : undefined;
    if (seen.has(k)) row.problems.push(`Same person as row ${seen.get(k)}`);
    else if (byPhone && byPhone.name === name) row.problems.push(`Same person as row ${byPhone.line} (same name and phone)`);
    else if (byPhone) row.warnings.push(`Same phone as row ${byPhone.line}`);
    if (!seen.has(k)) seen.set(k, row.line);
    if (p && !byPhone) phones.set(p, { line: row.line, name });
  }
  return rows;
}
