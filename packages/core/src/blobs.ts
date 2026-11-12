// Images and files of a workspace, stored once under the hash of their bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreError, type ImageRef, LIMITS } from '@lonca/protocol';

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MIMES: Record<string, ImageRef['mime']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const MAX_BYTES = 10 * 1024 * 1024;
const NAME = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;

export interface Blob {
  name: string;
  mime: string;
}

/** What the bytes are by their first bytes, whatever the sender called them. */
function sniff(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  return undefined;
}

/** Whether a picture moves: a GIF with more than one frame, a WebP with its animation flag set. */
export function isAnimated(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/gif') {
    // Every frame is introduced by a graphic control extension (21 F9 04).
    let frames = 0;
    for (let i = bytes.indexOf(0x21); i >= 0 && i < bytes.length - 2; i = bytes.indexOf(0x21, i + 1)) {
      if (bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
    }
    return false;
  }
  if (mime === 'image/webp') {
    return bytes.length > 21 && bytes.subarray(12, 16).toString('latin1') === 'VP8X' && ((bytes[20] ?? 0) & 0x02) !== 0;
  }
  return false;
}

export class Blobs {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Saves a data URL; returns the blob's file name. Refuses other types and anything over 10 MB. */
  saveDataUrl(dataUrl: string): Blob {
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    const mime = m?.[1] ?? '';
    const ext = TYPES[mime];
    if (!m || !ext) throw new CoreError('bad_request', 'image');
    const bytes = Buffer.from(m[2] ?? '', 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new CoreError('bad_request', 'size');
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    const file = join(this.dir, name);
    if (!existsSync(file)) writeFileSync(file, bytes);
    return { name, mime };
  }

  /**
   * A person's or a workspace's picture from a data URL: one of the four image types by its own bytes (not by
   * what the data URL claims), at most `LIMITS.picture` bytes.
   */
  savePicture(dataUrl: unknown): ImageRef {
    const m = typeof dataUrl === 'string' ? /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl) : null;
    if (!m) throw new CoreError('picture_type');
    const bytes = Buffer.from(m[1] ?? '', 'base64');
    const mime = sniff(bytes);
    const ext = mime ? TYPES[mime] : undefined;
    if (!mime || !ext) throw new CoreError('picture_type');
    if (bytes.length > LIMITS.picture) throw new CoreError('picture_too_large');
    const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    const file = join(this.dir, name);
    if (!existsSync(file)) writeFileSync(file, bytes);
    return { blob: name, mime: mime as ImageRef['mime'], ...(isAnimated(bytes, mime) ? { animated: true } : {}) };
  }

  /**
   * Bytes that came from another computer under a name: kept only when the name is the hash of the bytes, they
   * are the image type the name says, and they are no larger than a picture may be.
   */
  put(name: string, bytes: Buffer): boolean {
    if (!NAME.test(name) || bytes.length === 0 || bytes.length > LIMITS.picture) return false;
    const [hash, ext] = name.split('.') as [string, string];
    if (createHash('sha256').update(bytes).digest('hex') !== hash) return false;
    if (sniff(bytes) !== MIMES[ext]) return false;
    const file = join(this.dir, name);
    if (!existsSync(file)) writeFileSync(file, bytes);
    return true;
  }

  has(name: string): boolean {
    return NAME.test(name) && existsSync(join(this.dir, name));
  }

  size(name: string): number {
    try {
      return statSync(this.path(name)).size;
    } catch {
      return 0;
    }
  }

  path(name: string): string {
    if (!NAME.test(name)) throw new CoreError('bad_request', 'blob');
    return join(this.dir, name);
  }

  base64(name: string): string {
    return readFileSync(this.path(name)).toString('base64');
  }

  dataUrl(name: string, mime: string): string {
    return `data:${mime};base64,${this.base64(name)}`;
  }

  /** A stored picture as a data URL, its type taken from its name. */
  picture(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1);
    return this.dataUrl(name, MIMES[ext] ?? 'image/png');
  }
}
