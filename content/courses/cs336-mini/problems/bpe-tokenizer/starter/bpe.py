"""Simplified Byte-Pair Encoding.

Symbols are strings; a partially-tokenized text is a list of symbols;
a merge is a pair of symbols (x, y) that fuse into x + y.
"""


def count_pairs(symbols: list[str]) -> dict[tuple[str, str], int]:
    """Part (a): count adjacent pairs (overlapping occurrences count)."""
    raise NotImplementedError


def apply_merge(symbols: list[str], pair: tuple[str, str]) -> list[str]:
    """Part (b): fuse occurrences of `pair` left-to-right without overlap."""
    raise NotImplementedError


def train_bpe(text: str, num_merges: int) -> list[tuple[str, str]]:
    """Part (c): learn `num_merges` merges from `text`.

    Most frequent pair wins each round; ties break to the lexicographically
    smallest pair. Stop early if nothing is left to merge.
    """
    raise NotImplementedError


def encode(text: str, merges: list[tuple[str, str]]) -> list[str]:
    """Part (d): tokenize `text` by applying `merges` in training order."""
    raise NotImplementedError


def decode(tokens: list[str]) -> str:
    """Part (d): invert `encode`."""
    raise NotImplementedError
