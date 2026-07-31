from labbench import case, run

import bpe

# ---- reference implementation (kept here, invisible to the student) ----

def _ref_count_pairs(symbols):
    counts = {}
    for a, b in zip(symbols, symbols[1:]):
        counts[(a, b)] = counts.get((a, b), 0) + 1
    return counts


def _ref_apply_merge(symbols, pair):
    out, i = [], 0
    while i < len(symbols):
        if i + 1 < len(symbols) and (symbols[i], symbols[i + 1]) == pair:
            out.append(symbols[i] + symbols[i + 1])
            i += 2
        else:
            out.append(symbols[i])
            i += 1
    return out


def _ref_train(text, num_merges):
    symbols, merges = list(text), []
    for _ in range(num_merges):
        counts = _ref_count_pairs(symbols)
        if not counts:
            break
        best = min(counts, key=lambda p: (-counts[p], p))
        merges.append(best)
        symbols = _ref_apply_merge(symbols, best)
    return merges


def _ref_encode(text, merges):
    symbols = list(text)
    for m in merges:
        symbols = _ref_apply_merge(symbols, m)
    return symbols


CORPUS = "the theory of the thermal theatre " * 4


@case("(a) count_pairs on a small example")
def test_count_small():
    got = bpe.count_pairs(["a", "b", "a", "b"])
    want = {("a", "b"): 2, ("b", "a"): 1}
    assert got == want, f"count_pairs(['a','b','a','b']) = {got}, want {want}"


@case("(a) count_pairs counts overlapping pairs")
def test_count_overlap():
    got = bpe.count_pairs(["a", "a", "a"])
    assert got == {("a", "a"): 2}, f"got {got}, want {{('a','a'): 2}}"


@case("(a) count_pairs matches reference on corpus")
def test_count_corpus():
    got = bpe.count_pairs(list(CORPUS))
    want = _ref_count_pairs(list(CORPUS))
    assert got == want, "pair counts differ from reference on the corpus"


@case("(b) apply_merge fuses left-to-right without overlap")
def test_merge_no_overlap():
    got = bpe.apply_merge(["a", "a", "a"], ("a", "a"))
    assert got == ["aa", "a"], f"got {got}, want ['aa', 'a']"


@case("(b) apply_merge leaves non-matching symbols alone")
def test_merge_basic():
    got = bpe.apply_merge(["t", "h", "e", "t", "h"], ("t", "h"))
    assert got == ["th", "e", "th"], f"got {got}, want ['th', 'e', 'th']"


@case("(c) train_bpe learns the expected first merges")
def test_train_first_merges():
    merges = bpe.train_bpe(CORPUS, 3)
    want = _ref_train(CORPUS, 3)
    assert merges == want, f"first 3 merges = {merges}, want {want}"


@case("(c) train_bpe matches reference for 12 merges")
def test_train_matches_reference():
    merges = bpe.train_bpe(CORPUS, 12)
    want = _ref_train(CORPUS, 12)
    assert merges == want, f"merges diverge from reference:\n got  {merges}\n want {want}"


@case("(c) train_bpe stops early when nothing is left to merge")
def test_train_stops_early():
    merges = bpe.train_bpe("ab", 100)
    assert merges == [("a", "b")], f"got {merges}, want [('a','b')]"


@case("(d) encode applies merges in training order")
def test_encode():
    merges = _ref_train(CORPUS, 8)
    got = bpe.encode(CORPUS, merges)
    want = _ref_encode(CORPUS, merges)
    assert got == want, f"encode output differs from reference (first 10 tokens: {got[:10]})"


@case("(d) decode(encode(x)) == x roundtrip")
def test_roundtrip():
    merges = bpe.train_bpe(CORPUS, 10)
    assert bpe.decode(bpe.encode(CORPUS, merges)) == CORPUS, "roundtrip failed"


run()
