/**
 * ?rec turns on recording quality: denser geometry, bigger shadow maps, more
 * anti-aliasing and sharper canvas textures. Used by scripts/record.cjs, where
 * frames are rendered offline and frame time does not matter.
 */
export const REC = typeof location !== 'undefined' && new URLSearchParams(location.search).has('rec');

/** Geometry tessellation multiplier. */
export const DETAIL = REC ? 2 : 1;
