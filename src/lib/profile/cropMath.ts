/**
 * Pure geometry for the 1:1 avatar cropper (no DOM → fully unit-testable).
 *
 * Model: the crop box is a square of side S. The image is always scaled so that its SHORT side covers the box
 * (`cover`), times a `zoom` factor in [MIN_ZOOM, MAX_ZOOM]. `nx`/`ny` are the offset of the IMAGE CENTRE from the
 * box centre as a fraction of S, so the state is independent of the on-screen size (rotation / resize safe).
 *
 * Because everything is expressed relative to the box and the short side, the same maths gives the exact source
 * rectangle (in image pixels) used both for the live preview and for the exported file → preview === export.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const AVATAR_MAX_EDGE = 512;

export interface CropState {
  zoom: number;
  nx: number;
  ny: number;
}

export interface CropRect {
  /** Top-left of the square source region, in image pixels. */
  sx: number;
  sy: number;
  /** Side of the square source region, in image pixels. */
  side: number;
}

export const initialCrop = (): CropState => ({ zoom: MIN_ZOOM, nx: 0, ny: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const clampZoom = (z: number) => clamp(Number.isFinite(z) ? z : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);

/** Keeps the zoom in range and the image covering the whole box (no empty area can ever show). */
export function clampCrop(s: CropState, iw: number, ih: number): CropState {
  const zoom = clampZoom(s.zoom);
  const short = Math.min(iw, ih);
  const maxNx = Math.max(0, ((iw / short) * zoom - 1) / 2);
  const maxNy = Math.max(0, ((ih / short) * zoom - 1) / 2);
  return {
    zoom,
    nx: clamp(Number.isFinite(s.nx) ? s.nx : 0, -maxNx, maxNx),
    ny: clamp(Number.isFinite(s.ny) ? s.ny : 0, -maxNy, maxNy),
  };
}

/** Drag by (dx, dy) expressed as fractions of the box side. */
export function panBy(s: CropState, dx: number, dy: number, iw: number, ih: number): CropState {
  return clampCrop({ ...s, nx: s.nx + dx, ny: s.ny + dy }, iw, ih);
}

/**
 * Changes the zoom while keeping the image point under (fx, fy) fixed — the focus is the pinch centre / cursor,
 * given as a fraction of the box side measured from the box centre (so each is in [-0.5, 0.5] inside the box).
 */
export function zoomAt(s: CropState, newZoom: number, fx: number, fy: number, iw: number, ih: number): CropState {
  const z = clampZoom(newZoom);
  const k = z / s.zoom;
  return clampCrop({ zoom: z, nx: fx - (fx - s.nx) * k, ny: fy - (fy - s.ny) * k }, iw, ih);
}

/** Source square (image pixels) currently inside the crop box. Always within the image bounds. */
export function cropRect(s: CropState, iw: number, ih: number): CropRect {
  const c = clampCrop(s, iw, ih);
  const side = Math.min(iw, ih) / c.zoom;
  const cx = iw / 2 - c.nx * side;
  const cy = ih / 2 - c.ny * side;
  return {
    sx: clamp(cx - side / 2, 0, iw - side),
    sy: clamp(cy - side / 2, 0, ih - side),
    side,
  };
}

/** Exported edge: the crop region's own resolution, capped at 512 (never enlarged). */
export function outputEdge(side: number, max: number = AVATAR_MAX_EDGE): number {
  return Math.max(1, Math.min(max, Math.floor(side)));
}
