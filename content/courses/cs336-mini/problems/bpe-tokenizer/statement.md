# Byte-Pair Encoding Tokenizer

Byte-Pair Encoding (BPE) is the tokenization algorithm behind GPT-2 and most
modern LLM tokenizers. Starting from individual characters, it repeatedly
merges the most frequent adjacent pair of symbols into a new symbol, building
a vocabulary that adapts to the training corpus.

In this problem you'll implement a simplified BPE over a single text sequence
(real tokenizers pre-split on words/bytes; we skip that here so the algorithm
itself stays center stage).

We represent a partially-tokenized text as a list of string symbols, e.g.
`["a", "a", "b"]`, and a *merge* as a pair of symbols `("a", "b")` that get
fused into `"ab"`.

## Part (a) — counting pairs

Implement `count_pairs(symbols)`.

Given a list of symbols $s_1, s_2, \ldots, s_n$, return a `dict` mapping each
adjacent pair $(s_i, s_{i+1})$ to the number of positions $i$ where it occurs.
Overlaps count: `["a","a","a"]` contains the pair `("a","a")` **twice**.

## Part (b) — applying a merge

Implement `apply_merge(symbols, pair)`.

Replace occurrences of `pair` = $(x, y)$ by the fused symbol $xy$, scanning
**left to right without overlap**: after fusing positions $(i, i+1)$, continue
scanning at $i+2$. For example, merging `("a","a")` into `["a","a","a"]` gives
`["aa","a"]` — not `["a","aa"]`.

## Part (c) — training

Implement `train_bpe(text, num_merges)`.

Start from `symbols = list(text)`. For each of `num_merges` rounds:

1. Count all adjacent pairs.
2. Pick the most frequent pair; break ties by choosing the
   **lexicographically smallest** pair (tuple comparison).
3. If no pairs remain (fewer than 2 symbols), stop early.
4. Record the chosen pair and apply the merge.

Return the ordered list of merges $[(x_1,y_1), (x_2,y_2), \ldots]$.

## Part (d) — encode / decode

- `encode(text, merges)`: start from characters and apply each merge **in
  training order** with `apply_merge`. Return the final symbol list.
- `decode(tokens)`: invert tokenization. (Think about why this is trivial for
  BPE — and why it wouldn't be for a lossy tokenizer.)

For any `text` and `merges`, `decode(encode(text, merges)) == text` must hold.

---

**Hints**

- Part (c) tie-breaking: `min(pairs, key=lambda p: (-count[p], p))` is one clean way.
- Keep `apply_merge` $O(n)$ — the tests include a moderately long input.
