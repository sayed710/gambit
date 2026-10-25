// dev-mode error: run vite dev server briefly? Faster: check useSearchParams outside Router context — the page IS inside Layout (Router). More likely: TrainTabs current="/blindfold" mismatch? no crash there.
// Try: the 'announce' function defined but unused → no crash. React #130 = element type invalid: something rendered is undefined.
// Suspect: <TrainTabs current="/blindfold" /> fine. Suspect: GameBoard props fine.
// Real suspect: LEVEL_INFO[level].title.split — fine.
// Check: does the page import playSound that exists? yes.
// Let's run the DEV server for an unminified error.
