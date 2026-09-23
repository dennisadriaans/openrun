export { ThinkingOrb } from './ThinkingOrb.tsx';

export type { ThinkingOrbProps, OrbState, OrbSize, OrbTheme } from './types.ts';

// Power-user surface: the resolved presets + raw frame painters, for
// consumers driving their own canvas outside React.
export { resolvePreset, STATE_TO_MODE, type ModeKey, type Resolved } from './presets.ts';
export { MODE_DRAWS } from './engine/registry.ts';
