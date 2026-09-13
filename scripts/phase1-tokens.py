# Phase 1 — Arctic Editorial token migration for src/index.css
# Every replacement is asserted; the script fails loudly if any pattern misses.
import re, sys

PATH = "src/index.css"
s = open(PATH, encoding="utf-8").read()
applied = []

def rep(old, new, label, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"FAIL [{label}]: expected {count} occurrence(s), found {n}")
    s = s.replace(old, new)
    applied.append(label)

# ---- 1. :root (light) -> Arctic Editorial (single dark theme) ----
m = re.search(r"/\* ---------- tokens · glacial day \(light\) ---------- \*/\n:root \{.*?\n\}\n", s, re.S)
if not m:
    raise SystemExit("FAIL: :root light block not found")
new_root = """/* ---------- tokens · Arctic Editorial (single calm dark theme) ---------- */
:root {
  --bg: #090D10;
  --bg-raised: #0D1216;
  --surface: #11171B;
  --surface-2: #151C21;
  --surface-3: #1A2227;
  --surface-teal: #11171B;      /* legacy tinted panels -> neutral */
  --surface-violet: #11171B;

  --ink: #F1F4F3;
  --ink-soft: #CED5D3;
  --muted: #8D9995;
  --faint: #5F6B68;
  --border: #263036;
  --border-strong: #313C41;

  /* restrained arctic accents: sea glass acts, ice informs, violet is reserved
     for engine variation identity and rare analysis emphasis */
  --ice: #AFC6CF;
  --ice-dim: #829FAA;
  --sea: #719F94;
  --sea-deep: #547D74;
  --sea-soft: rgba(113, 159, 148, 0.14);
  --pv-violet: #9AA0C0;

  --identity-cyan: #8FB6B0;
  --identity-cyan-soft: rgba(113, 159, 148, 0.12);
  --identity-violet: #9AA0C0;
  --identity-violet-soft: rgba(154, 160, 192, 0.12);
  --identity-green: #719F94;
  --identity-green-soft: rgba(113, 159, 148, 0.12);
  --identity-rose: #CED5D3;

  --accent: var(--sea);
  --accent-ink: #A8C8BF;
  --accent-soft: var(--sea-soft);
  --aurora: #9AA0C0;
  --aurora-soft: rgba(154, 160, 192, 0.1);
  --good: #7FA89D;
  --good-soft: rgba(113, 159, 148, 0.14);
  --bad: #C97B6E;               /* muted coral — loss/flag only */
  --bad-soft: rgba(201, 123, 110, 0.13);
  --glacial: #AFC6CF;
  --glacial-deep: #829FAA;
  --aurora-teal: #719F94;
  --aurora-green: #547D74;
  --aurora-violet: #9AA0C0;
  --aurora-rose: #C9A9A0;
  --draw: #8D9995;
  --amber: #C9A86A;
  --coral: #C97B6E;
  --red: #C05B4C;
  --red-soft: rgba(192, 91, 76, 0.15);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 2px 10px rgba(0, 0, 0, 0.35), 0 12px 32px -14px rgba(0, 0, 0, 0.55);
  --shadow-lg: 0 30px 80px -30px rgba(0, 0, 0, 0.8);

  --board-light: #B9C8CE;
  --board-dark: #43596E;
  --board-border: #2E3E4C;
  --hl-last: rgba(175, 198, 207, 0.4);
  --hl-select: rgba(175, 198, 207, 0.58);
  --hl-check: radial-gradient(ellipse at center, rgba(201, 123, 110, 0.5) 0%, rgba(192, 91, 76, 0.32) 45%, transparent 78%);

  --radius: 10px;
  --radius-lg: 14px;
  color-scheme: dark;
}
"""
s = s[: m.start()] + new_root + s[m.end():]
applied.append(":root arctic editorial")

# ---- 2. delete the [data-theme='dark'] override block ----
m = re.search(r"/\* ---------- tokens · polar night \(dark\) ---------- \*/\n\[data-theme='dark'\] \{.*?\n\}\n", s, re.S)
if not m:
    raise SystemExit("FAIL: dark theme block not found")
s = s[: m.start()] + s[m.end():]
applied.append("dark block removed")

# ---- 3. body background: flat editorial page ----
m = re.search(r"body \{\n  font: 400 16px/1\.55 var\(--sans\);\n  letter-spacing: 0\.006em;\n  background:.*?background-attachment: fixed;\n", s, re.S)
if not m:
    raise SystemExit("FAIL: body background block not found")
s = s[: m.start()] + "body {\n  font: 400 16px/1.55 var(--sans);\n  letter-spacing: 0.006em;\n  background: var(--bg);\n" + s[m.end():]
applied.append("body flat background")

# ---- 4. nav underline: ice, not aurora gradient ----
rep(
    "  border-radius: 2px; background: var(--aurora-grad);",
    "  border-radius: 1px; background: var(--ice);",
    "page-tabs underline",
)
rep(
    ".main-nav a::after { content: ''; position: absolute; left: 0.8rem; right: 0.8rem; bottom: 0.15rem; height: 2px; border-radius: 2px; background: var(--aurora-grad);",
    ".main-nav a::after { content: ''; position: absolute; left: 0.8rem; right: 0.8rem; bottom: 0.15rem; height: 1.5px; border-radius: 1px; background: var(--ice);",
    "nav underline",
)

# ---- 5. btn-accent: flat sea glass, no gradient, no glow ----
rep(
    """.btn-accent {
  background: var(--aurora-grad);
  color: #04121C;
  box-shadow: 0 4px 18px -6px rgba(84, 196, 224, 0.45);
}
.btn-accent:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 6px 24px -6px rgba(84, 196, 224, 0.55); }""",
    """.btn-accent {
  background: var(--sea);
  color: #0B100E;
}

.btn-accent:hover:not(:disabled) { background: var(--sea-deep); }""",
    "btn-accent flat sea",
)

# ---- 6. input focus ring: sea tint ----
rep(
    ".input:focus { outline: none; border-color: var(--glacial-deep); box-shadow: 0 0 0 3px rgba(84, 196, 224, 0.18); }",
    ".input:focus { outline: none; border-color: var(--sea); box-shadow: 0 0 0 3px rgba(113, 159, 148, 0.18); }",
    "input focus ring",
)

# ---- 7. panels: flat surfaces, no blur, no sheen ----
rep(
    """.panel {
  background:
    linear-gradient(180deg, rgba(244, 250, 252, 0.045) 0%, rgba(244, 250, 252, 0) 52px),
    color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--glacial) 14%, var(--border));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}""",
    """.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: none;
}""",
    "panel flat",
)
rep(
    ".panel.teal { background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 46px), var(--surface-teal); border-color: color-mix(in srgb, var(--accent) 26%, var(--border)); }",
    ".panel.teal { border-color: var(--border); }",
    "panel teal neutral",
)
rep(
    ".panel.violet { background: linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0) 46px), var(--surface-violet); border-color: color-mix(in srgb, var(--identity-violet) 28%, var(--border)); }",
    ".panel.violet { border-color: var(--border); }",
    "panel violet neutral",
)

# ---- 8. board stage: no aurora glow behind the board ----
m = re.search(r"\.board-stage::before \{\n  content: '';\n  position: absolute; inset: -9% -7%;\n  background:.*?\n\}\n", s, re.S)
if not m:
    raise SystemExit("FAIL: board-stage::before not found")
s = s[: m.start()] + s[m.end():]
applied.append("board glow removed")

# ---- 9. board surface frame: quiet editorial frame ----
rep(
    """.board-surface {
  border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--board-border) 70%, var(--ink) 30%);
  outline: 6px solid color-mix(in srgb, var(--bg-raised) 88%, var(--board-border));
  outline-offset: 0;
  box-shadow:
    0 0 0 7px color-mix(in srgb, var(--border) 55%, transparent),
    0 18px 48px -16px rgba(0, 0, 0, 0.5),
    0 4px 14px rgba(0, 0, 0, 0.3);
  touch-action: manipulation;
}""",
    """.board-surface {
  border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid var(--border-strong);
  outline: 1px solid var(--border);
  outline-offset: 4px;
  box-shadow: 0 18px 44px -22px rgba(0, 0, 0, 0.55);
  touch-action: manipulation;
}""",
    "board frame quiet",
)

# ---- 10. clock running: flat active state ----
rep(
    """.clock.running {
  color: var(--ink);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong));
  background: linear-gradient(180deg, var(--surface-3, var(--bg-raised)) 0%, var(--bg-raised) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 2px 10px -4px color-mix(in srgb, var(--accent) 45%, transparent);
}""",
    """.clock.running {
  color: var(--ink);
  border-color: var(--sea);
  background: var(--surface-2);
}""",
    "clock running flat",
)

# ---- 11. status banner: drop inset sheen ----
rep(
    "  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);\n}\n.status-banner.check",
    "}\n.status-banner.check",
    "status banner sheen",
)

# ---- 12. opening tag rule: ice ----
rep(
    ".opening-tag::before { content: ''; width: 14px; height: 1.5px; border-radius: 2px; background: var(--aurora-grad); }",
    ".opening-tag::before { content: ''; width: 14px; height: 1px; border-radius: 0; background: var(--ice); }",
    "opening tag rule",
)

# ---- 13. promo overlay: scrim without blur ----
rep(
    "backdrop-filter: blur(3px); border-radius: var(--radius-lg);",
    "border-radius: var(--radius-lg);",
    "promo scrim",
)

# ---- 14. arena head: flat, deduplicated ----
dup = """.arena-head {
  display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  padding: 0.85rem 1.1rem; margin-bottom: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  border-radius: 12px;
  background: linear-gradient(100deg, var(--accent-soft), transparent 65%), var(--surface);
}
.arena-head .objective { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }
.arena-head .objective strong { color: var(--accent-ink); }
.arena-head .side { color: var(--muted); font-size: 0.9rem; }
"""
flat_arena = """.arena-head {
  display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  padding: 0.85rem 1.1rem; margin-bottom: 0.9rem;
  border: 1px solid var(--border);
  border-bottom: 1px solid var(--border-strong);
  border-radius: 0 0 12px 12px;
  border-top: none;
  background: var(--surface);
}
.arena-head .objective { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }
.arena-head .objective strong { color: var(--accent-ink); }
.arena-head .side { color: var(--muted); font-size: 0.9rem; }
"""
rep(dup + dup, flat_arena, "arena head flat + dedupe")

# ---- 15. score anchor: flat ----
rep(
    """  background:
    radial-gradient(130% 110% at 0% 0%, rgba(84, 196, 224, 0.08) 0%, transparent 55%),
    var(--bg-raised);""",
    "  background: var(--bg-raised);",
    "score anchor flat",
)

# ---- 16. empty state: flat ----
rep(
    """  background:
    radial-gradient(420px 140px at 50% 0%, var(--accent-soft) 0%, transparent 70%),
    var(--bg-raised);""",
    "  background: var(--bg-raised);",
    "empty state flat",
)

# ---- 17. class chip: dedupe duplicate rule ----
cc = """.class-chip {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.3rem 0.8rem; border-radius: 99px; font-weight: 700; font-size: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--class-color, var(--muted)) 45%, transparent);
  background: color-mix(in srgb, var(--class-color, var(--muted)) 12%, transparent);
  color: var(--class-color, var(--muted));
}
.class-chip .sym { font-family: var(--serif); font-size: 0.95rem; }
"""
rep(cc + cc, cc, "class chip dedupe")

# ---- 18. analysis progress: ice fill ----
rep(
    ".analysis-bar-fill { height: 100%; background: var(--aurora-grad); border-radius: 99px;",
    ".analysis-bar-fill { height: 100%; background: var(--ice); border-radius: 99px;",
    "analysis bar fill",
)

# ---- 19. engine row selected: violet identity, flat ----
rep(
    """.engine-row.on {
  border-color: var(--aurora-violet);
  background: linear-gradient(100deg, rgba(169, 156, 255, 0.12), transparent 60%), var(--surface-2);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aurora-violet) 35%, transparent);
}""",
    """.engine-row.on {
  border-color: var(--pv-violet);
  background: var(--surface-2);
}""",
    "engine row flat violet",
)
rep(
    """.engine-row .score {
  font-family: var(--mono); font-weight: 700; font-size: 0.9rem; min-width: 4.5ch; color: var(--glacial); font-variant-numeric: tabular-nums;
  color: var(--accent-ink);
}""",
    """.engine-row .score {
  font-family: var(--mono); font-weight: 700; font-size: 0.9rem; min-width: 4.5ch; color: var(--ice); font-variant-numeric: tabular-nums;
}""",
    "engine score ice",
)

# ---- 20. home block: muted aurora UI ----
rep(
    """  --h-green: #61E6C3;
  --h-green-deep: #35CFA7;
  --h-cyan: #8ED8F0;
  --h-cyan-deep: #54C4E0;
  --h-violet: #A99CFF;
  --h-violet-deep: #8174E8;""",
    """  --h-green: #719F94;
  --h-green-deep: #547D74;
  --h-cyan: #AFC6CF;
  --h-cyan-deep: #829FAA;
  --h-violet: #9AA0C0;
  --h-violet-deep: #7D84A8;""",
    "home palette muted",
)
rep(
    "  background: linear-gradient(90deg, var(--h-green) 0%, var(--h-cyan-deep) 52%, var(--h-violet) 100%);",
    "  background: var(--h-cyan-deep);",
    "rail progress flat",
)
rep(
    """    radial-gradient(46% 42% at 76% 10%, rgba(169, 156, 255, 0.22) 0%, transparent 70%),
    radial-gradient(54% 46% at 20% 86%, rgba(97, 230, 195, 0.18) 0%, transparent 72%);""",
    """    radial-gradient(46% 42% at 76% 10%, rgba(154, 160, 192, 0.1) 0%, transparent 70%),
    radial-gradient(54% 46% at 20% 86%, rgba(113, 159, 148, 0.09) 0%, transparent 72%);""",
    "showcase glow reduced",
)
rep(
    "  box-shadow: 0 12px 34px -14px rgba(191, 234, 246, 0.4);",
    "  box-shadow: 0 12px 30px -16px rgba(0, 0, 0, 0.65);",
    "hero primary shadow neutral",
)
rep(
    ".hero-btn-primary:hover { box-shadow: 0 16px 40px -14px rgba(191, 234, 246, 0.55); }",
    ".hero-btn-primary:hover { box-shadow: 0 16px 34px -16px rgba(0, 0, 0, 0.7); }",
    "hero primary hover shadow neutral",
)
rep(
    """  box-shadow:
    0 44px 90px -42px rgba(0, 0, 0, 0.85),
    inset 0 1px 0 rgba(244, 250, 252, 0.14);""",
    """  box-shadow:
    0 44px 90px -42px rgba(0, 0, 0, 0.85),
    inset 0 1px 0 rgba(241, 244, 243, 0.08);""",
    "showcase glass sheen reduced",
)
# voice replacements for violet / green-deep / ice (different --voice-ink values)
rep(".mp[data-voice='violet'] { --voice-glow: rgba(169, 156, 255, 0.19); --voice-ink: var(--h-violet); }",
    ".mp[data-voice='violet'] { --voice-glow: rgba(154, 160, 192, 0.1); --voice-ink: var(--h-violet); }", "mp voice violet")
rep(".mp[data-voice='green-deep'] { --voice-glow: rgba(53, 207, 167, 0.15); --voice-ink: var(--h-green-deep); }",
    ".mp[data-voice='green-deep'] { --voice-glow: rgba(84, 125, 116, 0.09); --voice-ink: var(--h-green-deep); }", "mp voice green-deep")
rep(".mp[data-voice='ice'] { --voice-glow: rgba(142, 216, 240, 0.17); --voice-ink: var(--h-cyan); }",
    ".mp[data-voice='ice'] { --voice-glow: rgba(175, 198, 207, 0.1); --voice-ink: var(--h-cyan); }", "mp voice ice")
rep(".mp[data-voice='green'] { --voice-glow: rgba(97, 230, 195, 0.17); --voice-ink: var(--h-green); }",
    ".mp[data-voice='green'] { --voice-glow: rgba(113, 159, 148, 0.09); --voice-ink: var(--h-green); }", "mp voice green")
rep(
    "box-shadow: inset 0 0 0 2px var(--h-green), 0 0 20px rgba(97, 230, 195, 0.4);",
    "box-shadow: inset 0 0 0 2px var(--h-green), 0 0 12px rgba(113, 159, 148, 0.28);",
    "tactic target glow reduced",
)
rep(
    "  box-shadow: 0 0 10px rgba(97, 230, 195, 0.9);",
    "  box-shadow: 0 0 8px rgba(113, 159, 148, 0.55);",
    "live dot glow reduced",
)

# ---- 21. remove now-unused --aurora-grad token references & definitions ----
left = s.count("--aurora-grad")
if left:
    raise SystemExit(f"FAIL: {left} --aurora-grad references remain")
# (all four definitions lived inside the blocks already replaced)

open(PATH, "w", encoding="utf-8", newline="\n").write(s)
print("APPLIED:", len(applied))
for a in applied:
    print(" -", a)
