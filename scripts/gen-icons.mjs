import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('app/icon.svg');
// standard icons
for (const size of [192, 512]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`public/icon-${size}.png`);
}
// maskable: mark on full-bleed ink background with safe-zone padding
const inner = await sharp(svg, { density: 300 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#16130F' } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png().toFile('public/icon-maskable-512.png');
// apple touch icon (opaque, slight padding)
const appleInner = await sharp(svg, { density: 300 }).resize(180, 180).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#16130F' } })
  .composite([{ input: appleInner, top: 0, left: 0 }])
  .png().toFile('app/apple-icon.png');
console.log('icons generated');
