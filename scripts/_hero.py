import io
src = 'cand-951f0316.jpg'
out = 'src/assets/hero-chess.jpg'
js = """
const sharp = require('sharp');
(async () => {
  // crop to a wide hero: keep the queen right-of-center, cut mostly left/top
  await sharp(process.argv[2])
    .resize(2100, 1150, { fit: 'cover', position: 'attention' })
    .modulate({ saturation: 0.85, brightness: 1.02 })
    .tint({ r: 232, g: 210, b: 178 })   // warm cream-gold cast
    .linear(1.06, -8)
    .jpeg({ quality: 74, mozjpeg: true })
    .toFile(process.argv[3]);
  console.log('hero written');
})();
"""
io.open('_hero.js', 'w').write(js)
