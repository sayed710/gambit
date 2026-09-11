---
target: Play game surface
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-11T20-11-40Z
slug: src-pages-play-tsx
---
## Critique: Gambit — src/pages/Play.tsx (Method: dual-agent)

### Design Health Score: 29/40 (Good)
1. Visibility of System Status: 3 — draw-decline toast-only; clock aria-label omits time
2. Match System/Real World: 3 — "New game" X icon; Flag icon on Resign
3. User Control & Freedom: 3 — reload mid-game destroys rated games
4. Consistency & Standards: 3 — 9px radii vs declared 10px; radiogroup semantics
5. Error Prevention: 3 — no beforeunload guard; no-op side selector in pass&play
6. Recognition over Recall: 3
7. Flexibility & Efficiency: 2 — no keyboard shortcuts in live play; board not keyboard-playable
8. Aesthetic & Minimalist: 4
9. Error Recovery: 2 — illegal moves give no reason
10. Help & Documentation: 3

### Design Specificity: Authored, not category-interchangeable. One honesty bug: pass&play auto-flip promised in copy, not implemented.

### Priority Issues
- [P0] Board unplayable by keyboard/screen reader — squares unlabelled divs; fix: arrow-key cursor + Enter select/move + aria-live announcements
- [P1] Pass & play auto-flip promised, not implemented — flip on turn in pass mode; hide side selector
- [P1] Unfinished games lost on reload — persist active game + resume; beforeunload guard
- [P2] Peak-end verdict underserved — add status color, rating delta, scroll into view
- [P2] Live move list false affordance — cursor/hover only when selectable

### Persona Red Flags
- Alex: no keyboard shortcuts, no PGN export, unscrubbable move list
- Jordan: "½ Draw" jargon; dense 10-tile time grid; duplicate New game/New setup labels
- Sam: dialogs lack Escape/focus handling; promotion overlay traps; clock time invisible to SR
- Casey: actions below fold on mobile; ~28px touch targets; pass&play manual flip

### Detector (B)
70 advisory findings: 44 font-size off-ramp, 14 color off-palette, 12 radius off-scale. Play.tsx clean (0). Board palettes + check tint undocumented in DESIGN.md; near-token radius drift real (9/11/7/6px vs 8/10/14).
