// Renders apps/desktop/build/icon.svg to icon.png (1024 px, Linux) and icon.ico (16-256 px, Windows).
// Lonca builds its own .ico because electron-builder's converter can fail to get memory. Run: pnpm icon
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'build');
const svg = readFileSync(join(build, 'icon.svg'), 'utf8');
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

const png = render(1024);
writeFileSync(join(build, 'icon.png'), png);

// ICO with PNG-compressed entries (supported since Windows Vista).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, at);
  header.writeUInt8(size >= 256 ? 0 : size, at + 1);
  header.writeUInt8(0, at + 2);
  header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
const ico = Buffer.concat([header, ...images]);
writeFileSync(join(build, 'icon.ico'), ico);
console.log(`icon.png ${png.length} bytes, icon.ico ${ico.length} bytes (${sizes.join(', ')} px)`);
