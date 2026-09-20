#!/usr/bin/env node
/**
 * Contrast guard for the design tokens in app/globals.css.
 *
 * Round 6 started with two invisible controls and about thirty spots of small
 * text at 4.3:1. Both were token-level, which means both can come back the same
 * way: someone nudges --text-faint darker to "calm it down", and a caption
 * somewhere else stops being readable. This turns the rules into a test.
 *
 * WCAG floors: 4.5:1 for text under 18.66px bold / 24px regular, 3:1 for large
 * text and for the outlines of interactive things (borders, focus rings).
 *
 *   npm run check:contrast
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'globals.css'), 'utf8');

/* ── Tokens ────────────────────────────────────────────────────────────── */
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

function parse(colour) {
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = colour.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => parseFloat(p.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  throw new Error(`cannot parse colour: ${colour}`);
}

/** Flatten a translucent colour onto its background, the way the screen does. */
function over(fg, bg) {
  const [r, g, b, a] = parse(fg);
  const [br, bg_, bb] = parse(bg);
  return `#${[r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a)]
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(colour) {
  const [r, g, b] = parse(colour).slice(0, 3).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const t = (name) => {
  if (!tokens[name]) throw new Error(`token --${name} is gone from :root`);
  return tokens[name];
};

/* ── What has to hold ──────────────────────────────────────────────────── */
const checks = [
  ['body text on the page', t('text'), t('bg'), 4.5],
  ['body text on a card', t('text'), t('surface'), 4.5],
  ['secondary text on a card', t('text-muted'), t('surface'), 4.5],
  ['captions and hints on a card', t('text-faint'), t('surface'), 4.5],
  ['captions on a field', t('text-faint'), t('surface-2'), 4.5],
  ['captions on the page', t('text-faint'), t('bg'), 4.5],
  ['placeholder text in a field', t('text-faint'), t('surface-2'), 4.5],
  ['button ink on the gradient', t('primary-ink'), t('primary'), 4.5],
  ['approved text on its panel', t('ok-ink'), t('ok-bg'), 4.5],
  ['error text on its panel', t('danger-ink'), t('danger-bg'), 4.5],
  // Interactive outlines: 3:1 is the floor, and these are how you find a field.
  ['focus ring on the page', t('ring'), t('bg'), 3],
  ['focus ring on a card', t('ring'), t('surface'), 3],
  ['field border', t('border-field'), t('surface-2'), 3],
];

/* Structural guards: the two bugs that were invisible rather than merely dim. */
const rules = [
  [
    'native dropdowns stay dark (color-scheme on :root)',
    /:root\s*\{[^}]*color-scheme:\s*dark/s.test(css),
  ],
  [
    'plain buttons give their label the text colour back (.btn--plain-neutral .btn__inner)',
    /\.btn--plain-neutral\s+\.btn__inner\s*\{[^}]*color:\s*var\(--text\)/s.test(css),
  ],
  ['option lists are painted dark', /(^|\n)option\s*\{[^}]*background:\s*var\(--surface\)/s.test(css)],
];

let failed = 0;
for (const [what, fg, bg, floor] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= floor;
  if (!ok) failed++;
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${r.toFixed(2)}:1 (needs ${floor}:1)  ${what}`);
}
for (const [what, ok] of rules) {
  if (!ok) failed++;
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${what}`);
}

console.log(failed ? `\n\x1b[31m${failed} contrast check(s) failed.\x1b[0m` : '\n\x1b[32mAll contrast checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
