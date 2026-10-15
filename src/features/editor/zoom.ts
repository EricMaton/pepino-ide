/** Editor font size limits and steps (px). */
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 14;
export const ZOOM_STEP = 2;

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size * 2) / 2));
}

/** Font size while pinching: scales [startSize] by how far the fingers moved apart or together. */
export function pinchFontSize(startSize: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampFontSize(startSize);
  return clampFontSize(startSize * (distance / startDistance));
}
