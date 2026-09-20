'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Slow, readable rotation for the home page.
 *
 * The hero has four card slots and one quote, but more alumni than that, so the
 * set has to change or most people are never seen. Two rules shape this:
 *
 *  - One slot at a time. Swapping all four together reads as a slideshow and
 *    pulls the eye away from the headline; one card turning over is calm.
 *  - Long enough to read. A card is swapped every few seconds and the quote far
 *    less often, and everything pauses while someone is hovering or tabbing
 *    through the collage, or while the tab is in the background.
 *
 * Under `prefers-reduced-motion` nothing rotates at all: the first, deterministic
 * set simply stays put.
 */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

/** True while the tab is visible, so background tabs stop animating. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const apply = () => setVisible(document.visibilityState === 'visible');
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, []);
  return visible;
}

export type Rotation = {
  /** Which pool item each slot is showing. */
  order: number[];
  /** The slot currently mid-fade, so it can be dimmed while it changes. */
  fading: number;
};

/**
 * Round-robin `slots` windows over a pool of `length` items.
 *
 * Slots start as 0, 1, 2, … so the first paint matches whatever order the
 * caller worked out (the 3-hour featured window), with no client-side shuffle
 * to flash through.
 */
export function useRotation({
  length,
  slots,
  intervalMs,
  fadeMs = 450,
  paused = false,
}: {
  length: number;
  slots: number;
  intervalMs: number;
  fadeMs?: number;
  paused?: boolean;
}): Rotation {
  const [order, setOrder] = useState<number[]>(() =>
    Array.from({ length: slots }, (_, i) => i % Math.max(length, 1)));
  const [fading, setFading] = useState(-1);
  // Which slot changes next, and which pool item it takes.
  const cursor = useRef({ slot: 0, next: slots });
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();

  // Keep the slot count honest when the pool arrives or changes size.
  useEffect(() => {
    setOrder(Array.from({ length: slots }, (_, i) => i % Math.max(length, 1)));
    cursor.current = { slot: 0, next: slots };
  }, [length, slots]);

  const still = reduced || paused || !visible || length <= slots;

  useEffect(() => {
    if (still) return undefined;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      const { slot, next } = cursor.current;
      setFading(slot);
      swap = setTimeout(() => {
        setOrder((prev) => {
          // Never show the same person twice: skip anything already on screen.
          let candidate = next % length;
          for (let i = 0; i < length && prev.some((v, s) => v === candidate && s !== slot); i++) {
            candidate = (candidate + 1) % length;
          }
          cursor.current = { slot: (slot + 1) % slots, next: candidate + 1 };
          const out = [...prev];
          out[slot] = candidate;
          return out;
        });
        setFading(-1);
      }, fadeMs);
    }, intervalMs);
    return () => { clearInterval(tick); if (swap) clearTimeout(swap); setFading(-1); };
  }, [still, intervalMs, fadeMs, length, slots]);

  return { order, fading };
}

/**
 * Cycle one label through several values — used for an alumnus who studied at
 * more than one place, so a card shows both rather than pretending there is one.
 */
export function useCycle(values: string[], intervalMs: number, paused = false): string {
  const [i, setI] = useState(0);
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();

  useEffect(() => { setI(0); }, [values.join('|')]);

  useEffect(() => {
    if (reduced || paused || !visible || values.length < 2) return undefined;
    const tick = setInterval(() => setI((v) => (v + 1) % values.length), intervalMs);
    return () => clearInterval(tick);
  }, [reduced, paused, visible, values.length, intervalMs]);

  return values[Math.min(i, Math.max(values.length - 1, 0))] ?? '';
}
