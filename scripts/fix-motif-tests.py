# Fix motif test fixtures (legal-move constructions)
def read(p): return open(p, encoding="utf-8").read()
def write(p, s): open(p, "w", encoding="utf-8", newline="\n").write(s)

p = "src/lib/motifDetection.test.ts"
t = read(p)

old_hanging = t[t.index("  it('hanging piece"):t.index("  it('discovered attack")]
new_hanging = """  it('hanging piece: attacked and undefended (mechanical)', () => {
    // white plays Bf3 from e2 — the move itself creates the attack on the undefended queen d5
    const ds = detect('4k3/8/8/3q4/8/8/4B3/4K3 w - - 0 1', 'Bf3');
    expect(types(ds)).toContain('hanging');
    const h = ds.find((d) => d.type === 'hanging')!;
    expect(h.targetSquares).toContain('d5');
    expect(h.involvedPieces).toContain('q');
    expect(h.confidence).toBe('confirmed');
  });

"""
t = t.replace(old_hanging, new_hanging)

old_defended = t[t.index("  it('attacked but adequately defended"):t.index("  it('rook on the back rank")]
new_defended = """  it('attacked but adequately defended piece is NOT hanging', () => {
    // white plays Bf3 attacking Qd5 — but the black king on e6 defends it
    const ds = detect('4k3/8/4k3/3q4/8/8/4B3/4K3 w - - 0 1', 'Bf3');
    expect(ds.find((d) => d.type === 'hanging')).toBeUndefined();
  });

"""
t = t.replace(old_defended, new_defended)

write(p, t)
print("fixtures fixed")
