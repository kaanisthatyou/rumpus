// Images and files of a workspace, stored once under the hash of their bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreError } from '@lonca/protocol';

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_BYTES = 10 * 1024 * 1024;

export interface Blob {
  name: string;
  mime: string;
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

  path(name: string): string {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(name)) throw new CoreError('bad_request', 'blob');
    return join(this.dir, name);
  }

  base64(name: string): string {
    return readFileSync(this.path(name)).toString('base64');
  }

  dataUrl(name: string, mime: string): string {
    return `data:${mime};base64,${this.base64(name)}`;
  }
}
