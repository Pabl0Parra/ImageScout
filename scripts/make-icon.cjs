const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 256;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, crc]);
}
const pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = y * (size * 4 + 1) + 1 + x * 4;
  const edge = Math.hypot(Math.max(0, Math.abs(x - 127.5) - 74), Math.max(0, Math.abs(y - 127.5) - 74));
  const ring = Math.hypot(x - 111, y - 108);
  const handle = x > 143 && x < 201 && y > 140 && y < 198 && Math.abs((x - 143) - (y - 140)) < 11;
  const mark = (ring > 42 && ring < 61) || handle;
  pixels[i] = mark ? 196 : 24; pixels[i + 1] = mark ? 181 : 25; pixels[i + 2] = mark ? 253 : 30;
  pixels[i + 3] = edge <= 50 ? 255 : 0;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
const output = path.join(__dirname, '..', 'resources'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'icon.png'), png); fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, png]));
