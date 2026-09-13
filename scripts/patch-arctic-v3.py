import io, re

p = 'src/index.css'
s = io.open(p, encoding='utf-8').read()
applied = []

def sub(pattern, repl, name):
    global s
    new = re.sub(pattern, repl, s, count=1)
    if new != s:
        s = new
        applied.append(name)
    else:
        print('MISS:', name)

sub(r"  --bg: #070b11;\n  --bg-raised: #0d141d;\n  --surface: #111a26;\n  --surface-2: #16212f;\n  --surface-3: #1c2a3a;",
    "  --bg: #050A11;\n  --bg-raised: #08111C;\n  --surface: #0B1624;\n  --surface-2: #122131;\n  --surface-3: #172A3D;",
    'dark strata')

sub(r"  --ink: #e9f0f7;\n  --ink-soft: #c6d2df;\n  --muted: #8fa0b3;\n  --faint: #61718a;\n  --border: #1d2b3c;\n  --border-strong: #2f4358;",
    "  --ink: #F4FAFC;\n  --ink-soft: #DCECF2;\n  --muted: #9DB4C4;\n  --faint: #64809A;\n  --border: #172A3D;\n  --border-strong: #21384C;",
    'dark text')

sub(r"  --identity-cyan: #5fd4e4;\n  --identity-cyan-soft: rgba\(95, 212, 228, 0\.13\);\n  --identity-violet: #a89af8;\n  --identity-violet-soft: rgba\(168, 154, 248, 0\.14\);\n  --identity-green: #57d9a3;\n  --identity-green-soft: rgba\(87, 217, 163, 0\.13\);",
    "  --identity-cyan: #54C4E0;\n  --identity-cyan-soft: rgba(84, 196, 224, 0.13);\n  --identity-violet: #A99CFF;\n  --identity-violet-soft: rgba(169, 156, 255, 0.14);\n  --identity-green: #35CFA7;\n  --identity-green-soft: rgba(53, 207, 167, 0.13);",
    'dark identities')

sub(r"(  --draw: #8b9aab;\n\n  --shadow-sm: 0 1px 2px rgba\(0, 0, 0, 0\.5\);)",
    """  --glacial: #8ED8F0;
  --glacial-deep: #54C4E0;
  --aurora-teal: #61E6C3;
  --aurora-green: #35CFA7;
  --aurora-violet: #A99CFF;
  --aurora-rose: #E78FB3;
  --amber: #E8B45A;
  --coral: #FF8A6B;
  --red: #F4573C;
  --red-soft: rgba(244, 87, 60, 0.15);
  --aurora-grad: linear-gradient(100deg, #61E6C3 0%, #54C4E0 45%, #A99CFF 100%);

\\1""", 'dark aurora tokens')

sub(r"  --board-light: #43596e;\n  --board-dark: #22334a;\n  --board-border: #182635;\n  --hl-last: rgba\(83, 200, 216, 0\.42\);\n  --hl-select: rgba\(83, 200, 216, 0\.58\);",
    "  --board-light: #C7D9E6;\n  --board-dark: #3E637F;\n  --board-border: #2C4A63;\n  --hl-last: rgba(142, 216, 240, 0.42);\n  --hl-select: rgba(142, 216, 240, 0.6);",
    'dark board')

sub(r"  --bg: #edf1f5;\n  --bg-raised: #f6f9fb;\n  --surface: #fdfeff;\n  --surface-2: #f1f6fa;\n  --surface-3: #e9f0f6;\n  --surface-teal: #ecf4f6;\n  --surface-violet: #f0effa;",
    "  --bg: #EDF3F7;\n  --bg-raised: #F4FAFC;\n  --surface: #FBFDFE;\n  --surface-2: #EFF6FA;\n  --surface-3: #E3EDF3;\n  --surface-teal: #EBF5F3;\n  --surface-violet: #F0EFFB;",
    'light strata')

sub(r"  --identity-cyan: #0f7a8d;\n  --identity-cyan-soft: rgba\(15, 122, 141, 0\.1\);\n  --identity-violet: #6c5ce7;\n  --identity-violet-soft: rgba\(108, 92, 231, 0\.09\);\n  --identity-green: #12805c;\n  --identity-green-soft: rgba\(18, 128, 92, 0\.1\);\n  --identity-rose: #c2598f;",
    "  --identity-cyan: #2B94B6;\n  --identity-cyan-soft: rgba(43, 148, 182, 0.1);\n  --identity-violet: #6656C8;\n  --identity-violet-soft: rgba(102, 86, 200, 0.09);\n  --identity-green: #178F7B;\n  --identity-green-soft: rgba(23, 143, 123, 0.1);\n  --identity-rose: #CB6A98;",
    'light identities')

sub(r"(  --draw: #5d6b7a;\n\n  --shadow-sm: 0 1px 2px rgba\(14, 22, 33, 0\.06\);)",
    """  --glacial: #1B7E9E;
  --glacial-deep: #2B94B6;
  --aurora-teal: #12967A;
  --aurora-green: #178F7B;
  --aurora-violet: #6656C8;
  --aurora-rose: #CB6A98;
  --aurora-grad: linear-gradient(100deg, #12967A 0%, #2B94B6 45%, #6656C8 100%);

\\1""", 'light aurora tokens')

sub(r"\[data-board='glacier'\] \{ --board-light: #e4edf4; --board-dark: #7ba2bd; --board-border: #6389a6; \}",
    "[data-board='glacier'] { --board-light: #C7D9E6; --board-dark: #3E637F; --board-border: #2C4A63; }", 'bp glacier')
sub(r"\[data-board='seaice'\] \{ --board-light: #f2f7fa; --board-dark: #c2d8e4; --board-border: #9db9cb; \}",
    "[data-board='seaice'] { --board-light: #F2F7FA; --board-dark: #C2D8E4; --board-border: #9DB9CB; }", 'bp seaice')
sub(r"\[data-board='polar'\] \{ --board-light: #3a5068; --board-dark: #1a2532; --board-border: #131d29; \}",
    "[data-board='polarnight'] { --board-light: #2E4358; --board-dark: #12212F; --board-border: #0C1822; }", 'bp polar')
sub(r"\[data-board='aurora'\] \{ --board-light: #333953; --board-dark: #1d2236; --board-border: #141828; \}",
    "[data-board='aurora'] { --board-light: #24404A; --board-dark: #101E28; --board-border: #0B161E; }", 'bp aurora')
sub(r"\[data-theme='dark'\]\[data-board='polar'\] \{ --board-light: #2c4058; --board-dark: #141f2c; --board-border: #0e1622; \}",
    "[data-theme='dark'][data-board='polarnight'] { --board-light: #2C4058; --board-dark: #141F2C; --board-border: #0E1622; }", 'bp polar dark')

sub(r"  background: var\(--bg\);\n  color: var\(--ink\);\n  -webkit-font-smoothing: antialiased;",
    """  background:
    radial-gradient(1200px 500px at 88% -10%, var(--atmo-aurora) 0%, transparent 62%),
    radial-gradient(950px 440px at -5% -8%, var(--atmo-ice) 0%, transparent 58%),
    var(--bg);
  background-attachment: fixed;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;""", 'body atmosphere')

sub(r"\.main-nav a\.active \{ color: var\(--ink\); background: var\(--accent-soft\); \}",
    """  .main-nav a::after { content: ''; position: absolute; left: 0.8rem; right: 0.8rem; bottom: 0.15rem; height: 2px; border-radius: 2px; background: var(--aurora-grad); transform: scaleX(0); transform-origin: left; transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1); }
.main-nav a.active { color: var(--ink); }
.main-nav a.active::after { transform: scaleX(1); }""", 'nav underline')

sub(r"\.btn-accent \{ background: var\(--accent\); color: #fdfeff; \}\n\.btn-accent:hover:not\(:disabled\) \{ box-shadow: var\(--shadow-md\); filter: brightness\(1\.06\); \}",
    """.btn-accent {
  background: var(--aurora-grad);
  color: #04121C;
  box-shadow: 0 4px 18px -6px rgba(84, 196, 224, 0.45);
}
.btn-accent:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 6px 24px -6px rgba(84, 196, 224, 0.55); }""", 'btn accent aurora')

sub(r"\.panel \{ background: var\(--surface\); border: 1px solid var\(--border\); border-radius: var\(--radius-lg\); \}",
    """.panel {
  background:
    linear-gradient(180deg, rgba(244, 250, 252, 0.03) 0%, rgba(244, 250, 252, 0) 52px),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}""", 'panel highlight')

sub(r"\.board-frame \{ position: relative; \}",
    """.board-stage { position: relative; }
.board-stage::before {
  content: '';
  position: absolute; inset: -9% -7%;
  background:
    radial-gradient(46% 38% at 78% 16%, rgba(97, 230, 195, 0.1) 0%, transparent 70%),
    radial-gradient(52% 44% at 18% 84%, rgba(169, 156, 255, 0.12) 0%, transparent 72%);
  pointer-events: none; z-index: 0;
}
.board-frame { position: relative; z-index: 1; }""", 'board stage')

sub(r"""\.board-surface \{
  border-radius: var\(--radius-lg\); overflow: hidden;
  box-shadow: var\(--shadow-md\), 0 0 0 1px var\(--board-border\);
  touch-action: manipulation;
\}""",
    """.board-surface {
  border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--board-border) 72%, var(--ink) 28%);
  outline: 5px solid color-mix(in srgb, var(--surface-2) 90%, var(--board-border));
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--border) 60%, transparent),
    0 22px 55px -18px rgba(1, 6, 12, 0.65),
    0 4px 16px rgba(1, 6, 12, 0.4);
  touch-action: manipulation;
}""", 'board ice frame')

sub(r"\.clock\.running \{ color: var\(--ink\); \}",
    """.clock.running {
  border-color: color-mix(in srgb, var(--glacial-deep) 55%, var(--border-strong));
  background: var(--surface-3);
  box-shadow: inset 0 1px 0 rgba(244, 250, 252, 0.05), 0 0 16px -6px rgba(84, 196, 224, 0.35);
}""", 'clock presence')

sub(r"\.eval-bar \.fill \{ position: absolute; inset: 0; background: var\(--bg-raised\); transform-origin: bottom; transition: transform 0\.4s cubic-bezier\(0\.16, 1, 0\.3, 1\); \}",
    ".eval-bar .fill { position: absolute; inset: 0; background: linear-gradient(180deg, var(--glacial) 0%, #DCECF2 100%); transform-origin: bottom; transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); }", 'eval fill')

sub(r"\.opening-tag::before \{ content: ''; width: 14px; height: 1px; background: var\(--border-strong\); \}",
    ".opening-tag::before { content: ''; width: 14px; height: 1.5px; border-radius: 2px; background: var(--aurora-grad); }", 'opening tick')

sub(r"\.hero::before \{\n  content: '';\n  position: absolute; inset: -30% -40% -45% auto; width: 640px; height: 640px; border-radius: 50%;\n  background: radial-gradient\(circle, var\(--aurora-soft\) 0%, transparent 65%\);\n  pointer-events: none;\n\}",
    """.hero::before {
  content: '';
  position: absolute; inset: -30% -40% -45% auto; width: 900px; height: 900px;
  background:
    radial-gradient(38% 30% at 60% 30%, rgba(97, 230, 195, 0.14) 0%, transparent 70%),
    radial-gradient(42% 34% at 30% 62%, rgba(169, 156, 255, 0.16) 0%, transparent 72%),
    radial-gradient(30% 24% at 70% 78%, rgba(84, 196, 224, 0.12) 0%, transparent 70%);
  pointer-events: none;
  animation: aurora-drift 16s ease-in-out infinite alternate;
}
@keyframes aurora-drift {
  from { transform: translate3d(0, 0, 0) rotate(0deg); }
  to { transform: translate3d(-4%, 3%, 0) rotate(2deg); }
}""", 'hero drift')

sub(r"\.hero h1 em \{ font-style: italic; color: var\(--accent-ink\); \}",
    ".hero h1 em { font-style: italic; background: var(--aurora-grad); -webkit-background-clip: text; background-clip: text; color: transparent; padding-bottom: 0.08em; }", 'hero em')

sub(r"\.quote-band \{ border-top: 1px solid var\(--border\); border-bottom: 1px solid var\(--border\); background: var\(--bg-raised\); padding: 2\.75rem 0; margin-top: 2\.5rem; \}",
    """.divider-band {
  position: relative; margin-top: 2.5rem; padding: 3.5rem 0;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  background:
    radial-gradient(60% 120% at 20% 0%, rgba(84, 196, 224, 0.06) 0%, transparent 60%),
    radial-gradient(50% 110% at 85% 100%, rgba(169, 156, 255, 0.07) 0%, transparent 62%),
    var(--bg-raised);
  overflow: hidden;
}
.divider-band .notation-strip {
  font-family: var(--mono); font-size: clamp(0.85rem, 1.6vw, 1.05rem); color: var(--faint);
  letter-spacing: 0.08em; white-space: nowrap; overflow: hidden;
}
.divider-band .notation-strip .lit { color: var(--glacial); }""", 'divider band')
sub(r"\.quote-band blockquote \{ font-family: var\(--serif\); font-size: clamp\(1\.15rem, 2\.4vw, 1\.5rem\); font-style: italic; text-align: center; max-width: 30ch; margin: 0 auto; line-height: 1\.4; \}",
    ".divider-band blockquote { font-family: var(--serif); font-size: clamp(1.3rem, 2.6vw, 1.75rem); font-style: italic; max-width: 28ch; margin: 1.4rem 0 0; line-height: 1.35; text-align: left; }", 'divider quote')
sub(r"\.quote-band cite \{ display: block; text-align: center; margin-top: 0\.9rem; font-family: var\(--sans\); font-style: normal; font-size: 0\.85rem; color: var\(--muted\); letter-spacing: 0\.06em; \}",
    ".divider-band cite { display: block; margin-top: 0.9rem; font-family: var(--sans); font-style: normal; font-size: 0.85rem; color: var(--muted); letter-spacing: 0.06em; text-align: left; }", 'divider cite')

sub(r"\.time-grid \{ display: grid; grid-template-columns: repeat\(3, 1fr\); gap: 0\.55rem; \}",
    """.launch-grid {
  display: grid; grid-template-columns: 300px minmax(0, 1fr) 300px; gap: 1.4rem; align-items: start;
}
@media (max-width: 1060px) { .launch-grid { grid-template-columns: 1fr 1fr; } .launch-side { grid-column: 1 / -1; } }
@media (max-width: 720px) { .launch-grid { grid-template-columns: 1fr; } }
.tempo-group + .tempo-group { margin-top: 1.1rem; }
.tempo-group .tempo-name {
  font-size: 0.78rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--faint); margin-bottom: 0.5rem;
}
.time-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 0.55rem; }""", 'launch grid')
sub(r"\.time-opt:hover \{ border-color: var\(--accent\); \}",
    ".time-opt:hover { border-color: var(--glacial-deep); transform: translateY(-1px); }", 'time hover')
sub(r"\.time-opt\.on \{ border-color: var\(--accent\); background: var\(--accent-soft\); box-shadow: var\(--shadow-sm\); \}",
    """.time-opt.on {
  border-color: var(--glacial-deep);
  background: linear-gradient(180deg, rgba(84, 196, 224, 0.14), rgba(84, 196, 224, 0.05)), var(--surface-2);
  box-shadow: 0 0 0 1px var(--glacial-deep);
}
.launch-foot {
  margin-top: 1.6rem; display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap;
  padding-top: 1.4rem; border-top: 1px solid var(--border);
}
.launch-foot .summary { color: var(--muted); font-size: 0.9rem; }
.launch-foot .summary strong { color: var(--ink); }""", 'time on + launch foot')

sub(r"\.mode-card\.on \{ border-color: var\(--accent\); background: var\(--accent-soft\); box-shadow: var\(--shadow-md\); \}",
    """.mode-card.on {
  border-color: var(--glacial-deep);
  background:
    radial-gradient(120% 100% at 100% 0%, rgba(84, 196, 224, 0.08) 0%, transparent 55%),
    var(--surface-2);
  box-shadow: 0 0 0 1px var(--glacial-deep), var(--shadow-md);
}""", 'mode card')
sub(r"\.mode-card svg \{ width: 1\.1rem; height: 1\.1rem; color: var\(--accent-ink\); \}",
    ".mode-card svg { width: 1.1rem; height: 1.1rem; color: var(--glacial); }", 'mode icon')

sub(r"\.puzzle-side \{ display: flex; flex-direction: column; gap: 1rem; \}",
    """.puzzle-side { display: flex; flex-direction: column; gap: 1rem; }
.arena-head {
  display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap;
  padding: 0.85rem 1.1rem; margin-bottom: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
  border-radius: 12px;
  background: linear-gradient(100deg, var(--accent-soft), transparent 65%), var(--surface);
}
.arena-head .objective { font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }
.arena-head .objective strong { color: var(--accent-ink); }
.arena-head .side { color: var(--muted); font-size: 0.9rem; }""", 'arena head')

sub(r"  display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;\n  background: var\(--bg-raised\);\n\}",
    """  display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;
  background:
    radial-gradient(130% 110% at 0% 0%, rgba(84, 196, 224, 0.08) 0%, transparent 55%),
    var(--bg-raised);
}""", 'score anchor')

sub(r"\.report-dot \{ display: inline-block; width: 9px; height: 9px; border-radius: 99px; \}",
    """.report-dot { display: inline-block; width: 9px; height: 9px; border-radius: 99px; }
.class-chip {
  display: inline-flex; align-items: center; gap: 0.45rem;
  padding: 0.3rem 0.8rem; border-radius: 99px; font-weight: 700; font-size: 0.85rem;
  border: 1px solid color-mix(in srgb, var(--class-color, var(--muted)) 45%, transparent);
  background: color-mix(in srgb, var(--class-color, var(--muted)) 12%, transparent);
  color: var(--class-color, var(--muted));
}
.class-chip .sym { font-family: var(--serif); font-size: 0.95rem; }""", 'class chip')

sub(r"""\.engine-row \{
  display: grid; grid-template-columns: auto 1fr auto; gap: 0\.7rem; align-items: baseline;
  padding: 0\.45rem 0\.6rem; border: 1px solid var\(--border\); border-radius: 10px; background: var\(--bg-raised\);
  cursor: pointer; transition: border-color 0\.15s;
\}
\.engine-row:hover, \.engine-row\.on \{ border-color: var\(--accent\); \}
\.engine-row \.score \{ font-family: var\(--mono\); font-weight: 700; font-size: 0\.9rem; min-width: 4\.5ch; font-variant-numeric: tabular-nums; \}
\.engine-row \.depth \{ color: var\(--muted\); font-size: 0\.75rem; \}""",
    """.engine-rows { display: flex; flex-direction: column; gap: 0.45rem; }
.engine-row {
  display: grid; grid-template-columns: auto auto 1fr auto; gap: 0.75rem; align-items: baseline;
  padding: 0.5rem 0.7rem; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface);
  cursor: pointer; text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.engine-row:hover { border-color: var(--border-strong); background: var(--surface-2); }
.engine-row.on {
  border-color: var(--aurora-violet);
  background: linear-gradient(100deg, rgba(169, 156, 255, 0.12), transparent 60%), var(--surface-2);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aurora-violet) 35%, transparent);
}
.engine-row .line-no { font-family: var(--mono); font-size: 0.72rem; color: var(--faint); min-width: 2.2ch; font-variant-numeric: tabular-nums; }
.engine-row .score { font-family: var(--mono); font-weight: 700; font-size: 0.9rem; min-width: 4.5ch; font-variant-numeric: tabular-nums; color: var(--glacial); }
.engine-row.on .score { color: var(--aurora-violet); }
.engine-row .depth { color: var(--faint); font-size: 0.75rem; }""", 'engine rows')

sub(r"\.analysis-bar-fill \{ height: 100%; background: var\(--accent\); border-radius: 99px; transform-origin: left; transition: transform 0\.3s ease; \}",
    ".analysis-bar-fill { height: 100%; background: var(--aurora-grad); border-radius: 99px; transform-origin: left; transition: transform 0.3s ease; }", 'progress aurora')

sub(r":focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; border-radius: 4px; \}",
    ":focus-visible { outline: 2px solid var(--glacial-deep); outline-offset: 2px; border-radius: 4px; }", 'focus')
sub(r"\.check-row input \{ accent-color: var\(--accent\); width: 1rem; height: 1rem; \}",
    ".check-row input { accent-color: var(--glacial-deep); width: 1rem; height: 1rem; }", 'checkbox')
sub(r"\.input:focus \{ outline: none; border-color: var\(--accent\); box-shadow: 0 0 0 3px var\(--accent-soft\); \}",
    ".input:focus { outline: none; border-color: var(--glacial-deep); box-shadow: 0 0 0 3px rgba(84, 196, 224, 0.18); }", 'input focus')
sub(r"\.nav-steps input\[type='range'\] \{ flex: 1; accent-color: var\(--accent\); \}",
    ".nav-steps input[type='range'] { flex: 1; accent-color: var(--glacial-deep); }", 'range')
sub(r"\.theme-chip:hover \{ border-color: var\(--accent\); color: var\(--ink\); \}",
    ".theme-chip:hover { border-color: var(--aurora-green); color: var(--ink); }", 'chip hover')
sub(r"\.swatch\.on \{ border-color: var\(--accent\); \}",
    ".swatch.on { border-color: var(--glacial-deep); }", 'swatch')

sub(r"\.empty-state \{ text-align: center; padding: 2\.75rem 1rem; color: var\(--muted\); \}",
    """.empty-state {
  text-align: center; padding: 2.75rem 1rem; color: var(--muted);
  border: 1px dashed var(--border-strong); border-radius: var(--radius-lg);
  background: radial-gradient(420px 140px at 50% 0%, var(--accent-soft) 0%, transparent 70%), var(--bg-raised);
}""", 'empty state')

sub(r"\.badge\.win \{ background: var\(--good-soft\); color: var\(--good\); \}",
    ".badge.win { background: var(--good-soft); color: var(--aurora-green); }", 'badge win')
sub(r"\.form-win \{ background: var\(--good-soft\); color: var\(--good\); \}",
    ".form-win { background: var(--good-soft); color: var(--aurora-green); }", 'form win')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('APPLIED:', len(applied))
for a in applied: print('  +', a)
