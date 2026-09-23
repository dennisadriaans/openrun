// Mode key → geometry builder. Kept separate from the presets so tree
// shaking can in principle drop unused modes in custom builds.

import type { ModeKey } from '../presets.ts';
import type { ModeDraw, ModeFrame } from './types.ts';
import { paintFrame } from './core.ts';
import { frameBraid } from './braid.ts';
import { frameGlobe, frameRubik, frameWave } from './lattice.ts';
import { frameMorph } from './morph.ts';
import { frameOrbits } from './orbits.ts';
import { frameRibbon } from './ribbon.ts';
import { frameWeb } from './web.ts';

/**
 * The portable surface: pure geometry, no canvas. The React Native port
 * imports exactly these functions, so its output is identical to the web's
 * by construction rather than by re-implementation.
 */
export const MODE_FRAMES: Record<ModeKey, ModeFrame> = {
  orbits: frameOrbits,
  globe: frameGlobe,
  rubik: frameRubik,
  wave: frameWave,
  web: frameWeb,
  braid: frameBraid,
  ribbon: frameRibbon,
  // ring shares ribbon's geometry — the `faceOn` profile flag switches it
  ring: frameRibbon,
  morph: frameMorph
};

/** Canvas painters, derived from the geometry. The 2D-canvas binding. */
export const MODE_DRAWS: Record<ModeKey, ModeDraw> = Object.fromEntries(
  Object.entries(MODE_FRAMES).map(([key, frame]) => [
    key,
    ((ctx, size, t, dark, opts) => paintFrame(ctx, frame(size, t, opts), dark)) as ModeDraw
  ])
) as Record<ModeKey, ModeDraw>;
