import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('app/icon.svg');
for (const size of [192, 512]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`public/icon-${size}.png`);
}
// maskable: same full-bleed art (inner frame sits inside the safe zone)
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile('public/icon-maskable-512.png');
// apple touch icon: full-bleed square; iOS applies its own corner mask
await sharp(svg, { density: 300 }).resize(180, 180).png().toFile('app/apple-icon.png');
console.log('icons generated');
