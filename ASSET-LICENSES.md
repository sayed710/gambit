# Asset licenses — Gambit

This file records the licensing status of every non-code brand asset in the
repository. The rule: nothing ships here without terms that permit
distribution in an open repository.

## Wordmark font — Great Vibes (SIL OFL 1.1) ✅ distributable

- Files: `public/fonts/GreatVibes-Regular.ttf`, license text in
  `public/fonts/OFL-GreatVibes.txt`
- Copyright 2010 The Great Vibes Pro Project Authors
  (https://github.com/googlefonts/great-vibes)
- SIL Open Font License 1.1: free to use, redistribute, embed and bundle,
  including commercially. Reserved Font Name "Great Vibes".
- **Known difference from the owner-approved mockup:** the approved design
  renders the wordmark in *Bilgeon Script* (Hanzel Space), whose license is
  **personal use only** — it cannot legally be committed to a public
  repository, redistributed, or deployed for others. Great Vibes is the
  compliant stand-in with a similar connected-script character. The
  difference is visible in the letterforms and is pending owner approval.

## Queen silhouette — owner-approved artwork ✅

- `public/brand/gambit-lockup.png` (queen portion): extracted from the design
  artwork the project owner supplied and approved as the brand identity.
- The wordmark letters inside the same PNG are rendered in Great Vibes (see
  above), NOT Bilgeon.

## Hero photograph — rawpixel CC0 ✅ distributable

- `public/assets/hero-chess.jpg`
- Source: rawpixel public-domain (CC0) chess photo set —
  https://www.rawpixel.com (image "Free chess image", Openverse id
  `337daeb9-…`). CC0: no attribution required, credited here as good
  practice. Warm-toned and mirrored with sharp for the Heritage hero.

## Superseded: Bilgeon Script (Hanzel Space) — NOT in the repository

- License: PERSONAL USE ONLY (per Hanzel Space's terms; full commercial
  licensing is sold separately by the foundry).
- The Bilgeon TTF was briefly committed on the `feat/ui-redesign` branch
  (PR #8) before this remediation. Because history rewriting is prohibited,
  those commits remain publicly reachable until remediated out-of-band
  (owner decision: close PR #8 and/or ask GitHub Support to purge cached
  blobs). No license was purchased; none may be purchased without explicit
  owner approval.
- Do not re-introduce Bilgeon into any committed path. If the owner buys a
  commercial license, it can then be reconsidered through a normal PR.
