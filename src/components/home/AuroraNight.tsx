/**
 * AuroraNight — the Home page's arctic environment.
 *
 * A layered SVG scene: polar-night sky, star field, three aurora
 * curtains (green, glacial, violet), two mountain ridges framing a
 * lit horizon valley, and a compressed aurora reflection on the ice
 * plain below. Purely decorative; the whole tree is aria-hidden.
 *
 * Coordinates live in a 1600×1000 viewBox with `slice` fitting, so
 * the horizon stays locked to the composition at any aspect ratio.
 */

const HORIZON = 650;

/** Deterministic star field — no Math.random, so SSR/rerenders agree. */
function stars(): { x: number; y: number; r: number; o: number; tw: boolean }[] {
  const out: { x: number; y: number; r: number; o: number; tw: boolean }[] = [];
  for (let i = 0; i < 110; i++) {
    const x = ((i * 263) % 1600) + ((i * 97) % 23) - 11;
    const y = ((i * 149) % 560) + ((i * 61) % 17) - 8;
    const r = 0.6 + ((i * 37) % 10) / 9;
    const o = 0.18 + ((i * 53) % 60) / 130;
    out.push({ x, y, r, o, tw: i % 9 === 0 });
  }
  return out;
}

const STAR_FIELD = stars();

export default function AuroraNight() {
  return (
    <div className="an-scene" aria-hidden="true">
      <svg
        className="an-svg"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
      >
        <defs>
          <linearGradient id="an-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#050A11" />
            <stop offset="0.52" stopColor="#08111C" />
            <stop offset="1" stopColor="#0B1624" />
          </linearGradient>

          <linearGradient id="an-curtain-green" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#61E6C3" stopOpacity="0" />
            <stop offset="0.55" stopColor="#61E6C3" stopOpacity="0.85" />
            <stop offset="1" stopColor="#35CFA7" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="an-curtain-cyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8ED8F0" stopOpacity="0" />
            <stop offset="0.6" stopColor="#54C4E0" stopOpacity="0.7" />
            <stop offset="1" stopColor="#8ED8F0" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="an-curtain-violet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8174E8" stopOpacity="0" />
            <stop offset="0.55" stopColor="#A99CFF" stopOpacity="0.75" />
            <stop offset="1" stopColor="#8174E8" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="an-strand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#DFFDF2" stopOpacity="0" />
            <stop offset="1" stopColor="#9FF5DC" stopOpacity="0.9" />
          </linearGradient>

          <radialGradient id="an-horizon-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#BFEAF6" stopOpacity="0.5" />
            <stop offset="0.45" stopColor="#54C4E0" stopOpacity="0.22" />
            <stop offset="1" stopColor="#54C4E0" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="an-ice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0C1B2C" />
            <stop offset="0.35" stopColor="#08121F" />
            <stop offset="1" stopColor="#050A11" />
          </linearGradient>

          <linearGradient id="an-fade-reflect" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="an-reflect-mask">
            <rect x="0" y={HORIZON} width="1600" height="240" fill="url(#an-fade-reflect)" />
          </mask>

          <filter id="an-blur-sm" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="an-blur-md" x="-40%" y="-60%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="an-blur-lg" x="-60%" y="-80%" width="220%" height="260%">
            <feGaussianBlur stdDeviation="42" />
          </filter>
        </defs>

        {/* sky */}
        <rect width="1600" height="1000" fill="url(#an-sky)" />

        {/* stars — one quiet group twinkles */}
        <g fill="#DCECF2">
          {STAR_FIELD.map((s, i) =>
            s.tw ? (
              <circle key={i} className="an-star" cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
            ) : (
              <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
            ),
          )}
        </g>

        {/* aurora curtains */}
        <g className="an-sway an-sway-a" style={{ mixBlendMode: 'screen' }}>
          <path
            d="M -120 470 C 240 360, 420 420, 640 280 C 850 150, 1010 240, 1240 170 C 1420 118, 1560 170, 1720 120"
            fill="none"
            stroke="url(#an-curtain-green)"
            strokeWidth="120"
            strokeLinecap="round"
            filter="url(#an-blur-lg)"
            opacity="0.74"
          />
          {/* curtain strands — brighter filaments inside the ribbon */}
          <path
            d="M 60 430 C 320 350, 470 390, 660 270 C 860 145, 1020 230, 1230 165"
            fill="none"
            stroke="url(#an-strand)"
            strokeWidth="3"
            filter="url(#an-blur-sm)"
            opacity="0.5"
          />
          <path
            d="M 190 455 C 420 380, 560 405, 740 300 C 920 195, 1060 245, 1260 185"
            fill="none"
            stroke="url(#an-strand)"
            strokeWidth="2"
            filter="url(#an-blur-sm)"
            opacity="0.32"
          />
        </g>

        <g className="an-sway an-sway-b" style={{ mixBlendMode: 'screen' }}>
          <path
            d="M -80 560 C 300 470, 560 500, 820 380 C 1060 270, 1290 330, 1700 240"
            fill="none"
            stroke="url(#an-curtain-cyan)"
            strokeWidth="64"
            strokeLinecap="round"
            filter="url(#an-blur-md)"
            opacity="0.52"
          />
        </g>

        <g className="an-sway an-sway-c" style={{ mixBlendMode: 'screen' }}>
          <path
            d="M 880 320 C 1080 220, 1260 260, 1460 160 C 1580 100, 1680 140, 1760 110"
            fill="none"
            stroke="url(#an-curtain-violet)"
            strokeWidth="88"
            strokeLinecap="round"
            filter="url(#an-blur-lg)"
            opacity="0.68"
          />
        </g>

        {/* far ridge — cold rim light along its crest */}
        <g>
          <path
            d="M 0 588 L 130 512 L 235 566 L 360 474 L 470 552 L 585 500 L 690 560 L 810 508 L 930 566 L 1050 520 L 1180 574 L 1310 528 L 1440 578 L 1600 534 L 1600 660 L 0 660 Z"
            fill="#0D1B2B"
            opacity="0.92"
          />
          <path
            d="M 0 588 L 130 512 L 235 566 L 360 474 L 470 552 L 585 500 L 690 560 L 810 508 L 930 566 L 1050 520 L 1180 574 L 1310 528 L 1440 578 L 1600 534"
            fill="none"
            stroke="#8ED8F0"
            strokeWidth="1.6"
            opacity="0.22"
            filter="url(#an-blur-sm)"
          />
        </g>

        {/* lit valley horizon */}
        <ellipse cx="850" cy={HORIZON + 6} rx="470" ry="64" fill="url(#an-horizon-glow)" filter="url(#an-blur-md)" />

        {/* near ridge — dark, frames the valley */}
        <path
          d="M 0 452 L 90 500 L 180 570 L 300 610 L 420 640 L 560 660 L 720 668 L 900 670 L 1080 664 L 1250 654 L 1390 640 L 1500 630 L 1600 622 L 1600 720 L 0 720 Z"
          fill="#070F1A"
        />
        {/* falling drifts of snow-mist at the ridge base */}
        <ellipse cx="330" cy="662" rx="380" ry="46" fill="#8ED8F0" opacity="0.05" filter="url(#an-blur-md)" />
        <ellipse cx="1240" cy="654" rx="320" ry="40" fill="#A99CFF" opacity="0.045" filter="url(#an-blur-md)" />

        {/* ice plain */}
        <rect x="0" y={HORIZON - 2} width="1600" height={1000 - HORIZON + 2} fill="url(#an-ice)" />

        {/* compressed aurora reflection on the ice */}
        <g mask="url(#an-reflect-mask)" opacity="0.4">
          <g transform={`translate(0 ${HORIZON}) scale(1 -0.42) translate(0 ${-HORIZON})`}>
            <g style={{ mixBlendMode: 'screen' }} opacity="0.55">
              <path
                d="M -120 470 C 240 360, 420 420, 640 280 C 850 150, 1010 240, 1240 170 C 1420 118, 1560 170, 1720 120"
                fill="none"
                stroke="url(#an-curtain-green)"
                strokeWidth="110"
                strokeLinecap="round"
                filter="url(#an-blur-lg)"
              />
              <path
                d="M 880 320 C 1080 220, 1260 260, 1460 160 C 1580 100, 1680 140, 1760 110"
                fill="none"
                stroke="url(#an-curtain-violet)"
                strokeWidth="80"
                strokeLinecap="round"
                filter="url(#an-blur-lg)"
              />
            </g>
          </g>
        </g>

        {/* cold light column + ice sheen streaks */}
        <rect x="826" y={HORIZON} width="48" height="210" fill="#9FDDEE" opacity="0.05" filter="url(#an-blur-md)" />
        <rect x="180" y="742" width="330" height="3" fill="#8ED8F0" opacity="0.09" filter="url(#an-blur-sm)" />
        <rect x="1020" y="806" width="420" height="3" fill="#A99CFF" opacity="0.08" filter="url(#an-blur-sm)" />
        <rect x="420" y="886" width="260" height="2.4" fill="#61E6C3" opacity="0.07" filter="url(#an-blur-sm)" />
      </svg>

      {/* legibility vignette, so copy sits on the darkest sky */}
      <div className="an-vignette" />
    </div>
  );
}
