// Generates public/icon-192.png and public/icon-512.png (no dependencies).
// A dark rounded square with the crew lime circle and the impostor red dot.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', 'public');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const radius = size * 0.18;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  const crewC = { x: size * 0.42, y: size * 0.52, r: size * 0.30 };
  const impC = { x: size * 0.72, y: size * 0.72, r: size * 0.17 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) { set(x, y, 0, 0, 0, 0); continue; }
      const dCrew = Math.hypot(x - crewC.x, y - crewC.y);
      const dImp = Math.hypot(x - impC.x, y - impC.y);
      if (dImp <= impC.r) set(x, y, 255, 77, 94);
      else if (dImp <= impC.r + size * 0.012) set(x, y, 11, 15, 20);
      else if (dCrew <= crewC.r) set(x, y, 198, 242, 78);
      else if (dCrew <= crewC.r + size * 0.014) set(x, y, 11, 15, 20);
      else set(x, y, 16, 22, 30);
    }
  }
  return px;
}

for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, png(size, draw(size)));
  console.log(`wrote ${file}`);
}
