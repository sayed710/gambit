---
name: Gambit
description: A quiet place to play chess — client-only chess platform
colors:
  paper: "#f5f1e8"
  paper-raised: "#fbf9f3"
  surface: "#fffdf8"
  espresso: "#201d18"
  ink-soft: "#4d473d"
  muted: "#6f6759"
  border: "#e3dccd"
  border-strong: "#cfc5b0"
  brass: "#8a6224"
  brass-deep: "#6d4d1a"
  good-green: "#2e7d4f"
  alarm-red: "#b0392f"
  draw-gray: "#6f6a5e"
  board-walnut-light: "#efe3cb"
  board-walnut-dark: "#9a6b45"
  board-walnut-border: "#857455"
  board-forest-light: "#ecead4"
  board-forest-dark: "#6f8f57"
  board-forest-border: "#5c7048"
  board-slate-light: "#d9dcdf"
  board-slate-dark: "#5c6773"
  board-slate-border: "#4a525c"
  board-ink-light: "#c9c4b4"
  board-ink-dark: "#4f4a40"
  board-ink-border: "#3d3931"
  board-walnut-border-dark: "#52412e"
  board-forest-border-dark: "#4a5f39"
  board-slate-border-dark: "#3a4149"
  board-ink-border-dark: "#312e27"
  check-red-tint: "rgba(255, 62, 48, 0.55)"
  check-red-tint-dark: "rgba(255, 72, 58, 0.6)"
  espresso-deep: "#151310"
  brass-contrast-ink: "#241d10"
  tick-shadow: "rgba(0, 0, 0, 0.35)"
  class-brilliant: "#26c2a3"
  class-best: "#81b64c"
  class-excellent: "#95bb4a"
  class-good: "#96af8b"
  class-inaccuracy: "#f7c631"
  class-mistake: "#ffa459"
  class-blunder: "#fa412d"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2.5rem, 5.2vw, 4.1rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.026em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(1.9rem, 3.8vw, 2.6rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.3rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.022em"
  stat:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "3.4rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  verdict:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  lead:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.4
  stat-secondary:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.45rem"
    fontWeight: 600
    lineHeight: 1.15
  avatar:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
  strong:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.15rem"
    fontWeight: 600
    lineHeight: 1.2
  subhead:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.2rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.006em"
  body-lg:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.12rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.925rem"
    fontWeight: 500
    lineHeight: 1.4
  ui-strong:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
  meta:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.5
  meta-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 500
    lineHeight: 1.4
  note:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.83rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.13em"
  clock:
    fontFamily: "ui-monospace, Cascadia Code, Consolas, monospace"
    fontSize: "1.45rem"
    fontWeight: 600
    lineHeight: 1.2
  clock-small:
    fontFamily: "ui-monospace, Cascadia Code, Consolas, monospace"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.2
  move:
    fontFamily: "ui-monospace, Cascadia Code, Consolas, monospace"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.4
  board-notation:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.58rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  focus: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  pill: "99px"
spacing:
  xs: "0.35rem"
  sm: "0.55rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.espresso}"
    textColor: "{colors.paper-raised}"
    rounded: "{rounded.md}"
    padding: "0.62rem 1.15rem"
  button-primary-hover:
    backgroundColor: "{colors.espresso}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    padding: "0.62rem 1.15rem"
  button-accent:
    backgroundColor: "{colors.brass}"
    textColor: "#fffdf8"
    rounded: "{rounded.md}"
    padding: "0.85rem 1.6rem"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.espresso}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.7rem"
---

# Design System: Gambit

## Overview

**Creative North Star: "The Chess Club Journal"**

Gambit looks like a well-kept club score sheet that learned to run a chess engine. The light theme is aged writing paper; the dark theme is an espresso lounge after hours. Typography — Fraunces, a warm old-style serif — carries the identity, with a single muted brass accent doing the work a startup gradient would do elsewhere. The interface is deliberately quiet: flat surfaces, hairline borders, tabular numerals for anything that counts, and zero decoration that doesn't come from the game itself.

Density is generous: content breathes with whitespace, boards are as large as the viewport allows, and the move list reads like printed notation. There is no third accent color; status colors (win green, alarm red, draw gray) appear only on results and clocks.

**Key Characteristics:**
- Serif-first hierarchy; sans only for UI labels and body
- One brass accent, used sparingly (highlights, active states, links to action)
- Chessboards are warm walnut by default with four selectable palettes
- Flat surfaces + 1px hairlines; shadows only for things that physically float
- Mono type reserved strictly for data: clocks, ratings, moves

## Colors

A warm neutral paper family with a single brass accent and three semantic status colors.

### Primary
- **Brass** (#8a6224 light / #d3a55c dark): selection rings, active move in notation, the sparkline, focus outlines, the accent button. Used at ≤10% of any screen.
- **Brass Deep** (#6d4d1a / #e0b877): accent text on paper — italic hero emphasis, ledger titles on hover.

### Semantic
- **Win Green** (#2e7d4f / #6cbf8a): win badges, positive rating deltas.
- **Alarm Red** (#b0392f / #e0796d): loss badges, clock-low state, check highlighting, destructive buttons.
- **Draw Gray** (#6f6a5e / #a39b8b): draw badges only.

### Neutral
- **Paper** (#f5f1e8): page background, light theme.
- **Paper Raised** (#fbf9f3): inputs, clocks, resting controls.
- **Surface** (#fffdf8): cards and panels.
- **Espresso** (#201d18): primary text and primary-button fill (inverted).
- **Ink Soft** (#4d473d / #c9c0ac): secondary text.
- **Muted** (#6f6759 / #a49c8a): captions, labels, meta — the floor for readable content.
- **Hairline** (#e3dccd / #302c25) and **Hairline Strong** (#cfc5b0 / #443e33): borders only.

### Named Rules
**The One Brass Rule.** Brass marks interaction and live state — never large surfaces, never text that isn't actionable.
**The Printed-Paper Rule.** Body backgrounds are warm paper in both themes; pure white and pure black never appear.

## Typography

**Display Font:** Fraunces (with Georgia fallback), weight 600, optical size 9–144
**Body Font:** Inter (with system-ui fallback)
**Data Font:** system monospace stack (clocks, ratings, SAN moves only)

**Character:** An old-style serif that loves large sizes meets a workhorse UI sans. The serif speaks (headings, verdicts, quotes, captions in italic); the sans works (labels, body, controls); the mono counts (clocks and moves in tabular numerals).

### Hierarchy
- **Display** (600, clamp 2.5–4.1rem, 1.02, −0.026em): landing hero only.
- **Headline** (600, clamp 1.9–2.6rem, 1.1, −0.022em): page titles.
- **Title** (600, 1.3rem): ledger rows, modal headings, verdicts.
- **Body** (400, 16px, 1.55): prose, capped near 56–62ch.
- **Label** (600, 0.72rem, +0.13em, uppercase): panel headers ("Game", "Time control") — the only uppercase voice.
- **Data** (600, mono, tabular): clocks 1.45rem; move notation 0.86rem.

### Named Rules
**The Counting Rule.** Anything that counts (clock, rating, move number, eval) is monospace with tabular numerals. Anything that doesn't count is not monospace.

## Layout

One centered container, `min(1180px, 100% − 2.5rem)`. Page vertical rhythm: 2.75rem top padding, 4.5rem bottom. Game surfaces use a two-column grid `minmax(0,1fr) / 340px` that collapses below 980px; boards fill their column and stay square. Setup content maxes at 820px. Spacing steps are 0.35 / 0.55 / 1 / 1.5 / 2.75rem. Related controls sit 0.45–0.6rem apart; distinct groups get 1.25–1.5rem.

## Elevation & Depth

Flat by default. Cards and panels are surface color with a 1px hairline and no shadow. Shadows exist for things that physically float above the page: the board (md), modals/dialogs (lg), toasts (lg), and hover-lift on primary buttons (md). A 1px border never accompanies a shadow on the same resting element.

### Shadow Vocabulary
- **md** (`0 2px 6px rgba(32,29,24,0.07), 0 8px 24px -12px rgba(32,29,24,0.18)`): the board frame; primary-button hover.
- **lg** (`0 24px 64px -24px rgba(32,29,24,0.35)`): modals, toasts, promotion picker.

### Named Rules
**The Floating-Things Rule.** If it doesn't overlap the page, it doesn't get a shadow.

## Shapes

Two radii: 14px for large containers (panels, board frame, modals), 10px for controls (buttons, inputs, clocks), 8px for small inline elements (icons buttons, notation chips). Pills (99px) only for badges and toasts. Corners are consistent; nothing is square except hairline rules and the eval bar.

## Components

### Buttons
- **Shape:** 10px radius, inline-flex, 0.62rem×1.15rem padding (lg: 0.85rem×1.6rem).
- **Primary:** espresso fill, paper-raised text; hover lifts with shadow-md; active nudges down 1px.
- **Accent:** brass fill, near-white text — one per screen maximum (the start-game CTA).
- **Ghost:** surface fill, hairline-strong border, ink-soft text; hover darkens border and text.
- **Danger:** transparent fill, alarm-red border and text; hover fills red-soft.
- **Disabled:** 0.45 opacity, no transform.

### Cards / Containers
- **Corner:** 14px. **Background:** surface. **Border:** 1px hairline, no resting shadow.
- **Internal padding:** 1.2rem×1.3rem. Panel headers are uppercase labels over a full-width hairline.

### Clock
Mono, tabular, 1.45rem, hairline border on raised paper. States: running (ink), low (<20s: alarm red + red-soft fill), flagged (strikethrough, muted).

### Board
Walnut palette default (#efe3cb / #9a6b45) with forest/slate/ink alternatives per theme. Last-move squares get brass at 45% alpha; selection gets brass at 60% + inset ring; check is a red radial under the king. Legal-move hints are radial dots, tinted from the square's own ink, toggleable.

### Navigation
Header: 3.75rem tall, blurred paper backdrop, hairline bottom. Brand = knight mark + serif wordmark. Links: 0.925rem medium, 8px radius, active state brass-soft fill. Below 720px the nav collapses to a disclosure menu.

### Inputs
Raised-paper fill, hairline-strong border, 10px radius; focus: brass border + 3px brass-soft ring.

### Signature: Score Sheet (Profile)
One anchored composition — huge serif rating on raised paper, hairline divider, secondary stats inline, sparkline beneath — instead of a stat-card grid. The signature shows hierarchy through typography, not boxes.

## Do's and Don'ts

### Do:
- **Do** use Fraunces italic + brass for a single emphatic word per heading at most.
- **Do** keep move/rating/clock data in mono with tabular numerals.
- **Do** keep one accent-colored primary action per view.
- **Do** give game-end moments ceremony (serif verdict, brass rule, entrance ease).
- **Do** respect `prefers-reduced-motion` (all transitions collapse to 0.01ms).

### Don't:
- **Don't** put eyebrow/kicker labels above headings — headings carry alone.
- **Don't** number sections (01/02/03) or fill layouts with uniform icon+title+text cards.
- **Don't** pair a resting shadow with a 1px border (ghost card), and never use zero-blur offset shadows.
- **Don't** use pure black/white, gradient text, or gray-on-colored text.
- **Don't** let any non-data element wear the monospace font.
