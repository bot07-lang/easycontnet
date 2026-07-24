/**
 * Small canvas helpers for inline image editing. Images are loaded cross-origin
 * (the content-files bucket serves permissive CORS) so they can be drawn to a
 * canvas and exported without tainting it.
 */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image'));
    // Cache-bust so we don't get a version the browser cached WITHOUT CORS headers
    // (which would taint the canvas and block export).
    img.src = `${src}${src.includes('?') ? '&' : '?'}cors=1`;
  });
}

/** Rotate an image by a 90° step and return a PNG blob (dimensions swap). */
export async function rotateImageToBlob(src: string, degrees: 90 | -90): Promise<Blob> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return canvasToBlob(canvas);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export the image'))), type),
  );
}

/** A data/blob URL (e.g. from the image editor) → Blob. */
export function urlToBlob(url: string): Promise<Blob> {
  return fetch(url).then((r) => r.blob());
}
