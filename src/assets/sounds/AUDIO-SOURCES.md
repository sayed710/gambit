# Gambit audio sources

All gameplay samples are Creative Commons 0 (public domain dedication),
verified on each sound's freesound.org page at download time. No attribution
is required by the license; sources are documented here anyway.

| file | event | freesound | author | license |
|------|-------|-----------|--------|---------|
| move.mp3 | normal move (also castle x2, check base) | https://freesound.org/s/351518/ | freesound user "matrix_zee_l" (see sound page) | CC0 1.0 |
| capture.mp3 | capture (also the subtle check cue) | https://freesound.org/s/546121/ | freesound user (see sound page) | CC0 1.0 |
| illegal.mp3 | illegal move feedback | https://freesound.org/s/321083/ | freesound user (see sound page) | CC0 1.0 |
| promote.mp3 | promotion | https://freesound.org/s/220200/ | freesound user (see sound page) | CC0 1.0 |

Processing: silence-trimmed, loudness-normalized (loudnorm I=-18/TP=-3),
44.1 kHz mono, 64 kbps mp3 via ffmpeg. Win/lose/draw are quiet procedural
tones generated in code (no sample needed; heard once per game).

No runtime network requests: files are bundled by Vite.
