/** Heatmap colour as RGB on white (PDF has no alpha blending in table cells). */
export function heatColorRgb(v: number, maxAbs: number): [number, number, number] {
  const a = maxAbs === 0 ? 0 : 0.12 + 0.68 * Math.min(1, Math.abs(v) / maxAbs);
  const base: [number, number, number] = v >= 0 ? [26, 140, 80] : [200, 45, 35];
  return base.map((c) => Math.round(255 + (c - 255) * a)) as [number, number, number];
}
