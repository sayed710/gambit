/* Generates Gambit PWA icons from the KnightMark geometry.
   Arctic Editorial: polar-night ink background, board-light/board-dark
   knight. Run once — the PNGs are committed. */
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const OUT = 'public/pwa';
mkdirSync(OUT, { recursive: true });

const BG = '#1C1A17'; // var(--ink)
const LIGHT = '#EFE3CB'; // var(--board-light)
const DARK = '#B08A54'; // var(--board-dark)

const KNIGHT = `
  <path d="M30 78c0-6 1.5-10.5 4-15 1.8-3.2 4.4-6.6 4.4-6.6S35 55 35 49.5c0-3.6 1.6-6.9 4.4-9.3C41 33.8 44 27 50 22c-1 5 1 8.5 4 11 4 3.5 10 5.6 14 11 3.7 5 5.6 11.2 4.6 18-.7 4.8-3 8.6-5.6 11.6 0 0 3.4 2.4 5 6.4 1.3 3.2 1 6 1 6H30z" fill="${LIGHT}"/>
  <path d="M50 22c-1.2 3.4-.6 6.4 1 9l11 7.4c1.8 2.6 3 5.6 3.4 9L70 74l2 12h8c0 0 .3-2.8-1-6-1.6-4-5-6.4-5-6.4 2.6-3 4.9-6.8 5.6-11.6 1-6.8-.9-13-4.6-18-4-5.4-10-7.5-14-11-3-2.5-5-6-4-11z" fill="${DARK}"/>
`;

/** standard icon: rounded square on transparent, glyph at 76% */
function iconSvg(size, radius = 0.18) {
  const inset = size * 0.12;
  const inner = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="${BG}"/>
    <svg x="${inset}" y="${inset}" width="${inner}" height="${inner}" viewBox="0 0 100 100">${KNIGHT}</svg>
  </svg>`;
}

/** maskable: solid full-bleed background, glyph inside the 66% safe zone */
function maskableSvg(size) {
  const safe = size * 0.66;
  const inset = (size - safe) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <svg x="${inset}" y="${inset}" width="${safe}" height="${safe}" viewBox="0 0 100 100">${KNIGHT}</svg>
  </svg>`;
}

for (const spec of [
  { name: 'icon-192.png', size: 192, svg: (s) => iconSvg(s) },
  { name: 'icon-512.png', size: 512, svg: (s) => iconSvg(s) },
  { name: 'icon-maskable-512.png', size: 512, svg: (s) => maskableSvg(s) },
]) {
  const png = await sharp(Buffer.from(spec.svg(spec.size))).png().toBuffer();
  writeFileSync(`${OUT}/${spec.name}`, png);
  console.log(spec.name, png.length, 'bytes');
}
