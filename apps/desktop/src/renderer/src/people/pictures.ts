// A picture a person picked, made ready to send: a still one is cut to the shape it is shown in and made small;
// one that moves (a GIF, an animated WebP) goes as it is, and the core refuses it when it is too large.

export type PictureShape = 'avatar' | 'icon' | 'banner';

/** Width and height a still picture is cut to; a smaller one is not enlarged. */
const SHAPES: Record<PictureShape, [number, number]> = {
  avatar: [256, 256],
  icon: [256, 256],
  banner: [960, 320],
};

export const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsDataURL(file);
  });
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** A GIF with more than one frame, or a WebP with its animation flag set (the core checks the same way). */
function moves(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/gif') {
    let frames = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
    }
    return false;
  }
  if (type === 'image/webp') {
    const tag = String.fromCharCode(...bytes.slice(12, 16));
    return bytes.length > 21 && tag === 'VP8X' && ((bytes[20] ?? 0) & 0x02) !== 0;
  }
  return false;
}

/** The picked file as a data URL for the core; rejects when the file is not a picture the page can read. */
export async function readPicture(file: File, shape: PictureShape): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const original = await dataUrl(file);
  if (moves(bytes, file.type)) return original;
  const img = await load(original);
  const [w, h] = SHAPES[shape];
  const ratio = w / h;
  // The largest part of the picture with the wanted proportions, from its middle.
  const sw = Math.min(img.naturalWidth, img.naturalHeight * ratio);
  const sh = sw / ratio;
  const width = Math.max(1, Math.round(Math.min(w, sw)));
  const height = Math.max(1, Math.round(width / ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return original;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, width, height);
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/** The first frame of a picture that moves, as a still PNG. */
export async function firstFrame(src: string): Promise<string | undefined> {
  try {
    const img = await load(src);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    if (!g) return undefined;
    g.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
