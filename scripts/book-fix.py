# Book classification fix + openings.isBookLine
def read(p): return open(p, encoding="utf-8").read()
def write(p, s): open(p, "w", encoding="utf-8", newline="\n").write(s)

# 1. openings.ts: isBookLine — the line is still INSIDE a known opening
#    (a table entry continues with it), not merely containing one.
s = read("src/lib/openings.ts")
anchor = """/** Identify the opening from a SAN move list; longest prefix wins. */"""
add = """/**
 * True while the played line is still covered by theory: some table entry
 * begins with exactly these moves (or equals them). This TERMINATES once the
 * game steps off the known line — unlike identifyOpening, which keeps
 * matching forever after the entry has been extended.
 */
export function isBookLine(sanMoves: string[]): boolean {
  const line = sanMoves.join(' ');
  if (!line) return false;
  return TABLE.some((entry) => entry.moves === line || entry.moves.startsWith(line + ' '));
}

/** Identify the opening from a SAN move list; longest prefix wins. */"""
if "isBookLine" not in s:
    assert anchor in s
    s = s.replace(anchor, add, 1)
    write("src/lib/openings.ts", s)
print("openings.isBookLine: ok")

# 2. review.ts: book = the position after the move is still in theory
s = read("src/lib/review.ts")
old = """    // Book: the position after this move still matches a known opening line.
    if (identifyOpening(sanList.slice(0, i + 1)) !== null) {"""
new = """    // Book: the move is still covered by known opening theory — i.e. the line
    // played so far is a prefix of (or exactly) a table line. This terminates
    // when the game steps off theory; it used to use identifyOpening, which
    // kept matching forever once an entry had been extended, silently marking
    // the rest of the game as book with zero accuracy signal.
    if (isBookLine(sanList.slice(0, i + 1))) {"""
assert old in s
s = s.replace(old, new, 1)
s = s.replace("import { identifyOpening", "import { identifyOpening, isBookLine") if "isBookLine" not in s.split("buildReport")[0] else s
write("src/lib/review.ts", s)
print("review.ts book gate: ok")
