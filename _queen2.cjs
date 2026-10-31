const sharp = require('sharp');
(async () => {
  const SRC = 'C:/Users/hp/.zcode/cli/image-cache/sess_6f281adf-db83-4f82-99bf-2e67ab683234/image-7bdc3b276b2ccd4afecd242a0aa4452a.png';

  // step 1: crop the queen region (left: 84, width: 92 → x 84-176, full height)
  const step1 = await sharp(SRC).extract({ left: 84, top: 0, width: 92, height: 251 }).png().toFile('_q-step1.png');

  // step 2: raw → map luminance to alpha, colorize charcoal, EXCLUDE the bottom
  // black strip rows (y > 240: the reference screenshot's bottom edge)
  const region = await sharp('_q-step1.png').raw().toBuffer({ resolveWithObject: true });
  const { data, info } = region;
  const out = Buffer.alloc(info.width * info.height * 4);
  let minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    if (y > 240) continue; // bottom edge strip of the source screenshot
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // smooth alpha: transparent at lum 230, opaque at lum 140
      const a = Math.max(0, Math.min(255, Math.round((230 - lum) * 255 / 90)));
      const o = (y * info.width + x) * 4;
      out[o] = 0x0F; out[o + 1] = 0x17; out[o + 2] = 0x20; out[o + 3] = a;
      if (a > 40) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  // step 3: trim to the queen's bbox
  const w = info.width;
  let minX = w, maxX = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < w; x++) {
      const a = out[(y * w + x) * 4 + 3];
      if (a > 40) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  const trimmed = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const s = ((y + minY) * w + (x + minX)) * 4;
    const d = (y * tw + x) * 4;
    trimmed[d] = out[s]; trimmed[d + 1] = out[s + 1]; trimmed[d + 2] = out[s + 2]; trimmed[d + 3] = out[s + 3];
  }
  await sharp(trimmed, { raw: { width: tw, height: th, channels: 4 } }).png().toFile('public/brand/queen.png');
  console.log('queen.png:', tw, 'x', th, ' minY:', minY, ' maxY:', maxY);
})();
