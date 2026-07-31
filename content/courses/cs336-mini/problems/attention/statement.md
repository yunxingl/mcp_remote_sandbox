# Softmax & Scaled Dot-Product Attention

The heart of the transformer, implemented from primitives. You may use basic
tensor ops (`matmul`, `exp`, `sum`, `max`, `where`, broadcasting, indexing) but
**not** `torch.softmax`, `F.softmax`, or `F.scaled_dot_product_attention` —
that would rather defeat the point.

> ⚙️ This problem's sandbox installs `torch` (see the machine badge in the
> header). Runs execute on Modal when configured; the local dev runner needs
> torch importable on the host.

## Part (a) — a numerically stable softmax

Implement `softmax(x, dim)` in `attention.py`.

The textbook definition
$$\mathrm{softmax}(x)_i = \frac{e^{x_i}}{\sum_j e^{x_j}}$$
overflows for large $x_i$ (try $e^{1000}$). Use the standard fix — subtract the
max before exponentiating:
$$\mathrm{softmax}(x)_i = \frac{e^{x_i - m}}{\sum_j e^{x_j - m}},
\qquad m = \max_j x_j$$

Your implementation must work for any `dim` of an arbitrary-rank tensor, and
must not produce `inf`/`nan` for inputs as large as $10^4$.

## Part (b) — scaled dot-product attention

Implement `scaled_dot_product_attention(q, k, v, mask=None)` for shapes

- `q`: $(\ldots, n, d_k)$ — queries
- `k`: $(\ldots, m, d_k)$ — keys
- `v`: $(\ldots, m, d_v)$ — values
- `mask`: optional boolean $(\ldots, n, m)$; `False` = position is **not**
  attended to.

Compute
$$\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right) V$$

Masked positions get score $-\infty$ before the softmax (use
`torch.where` or `masked_fill`). The `...` batch dimensions must broadcast —
your code should handle both unbatched $(n, d_k)$ and batched
$(B, h, n, d_k)$ inputs without special-casing.

## Part (c) — causal self-attention

Implement `causal_self_attention(x, w_qkv, w_out)`:

1. Project `x` $(B, n, d)$ with `w_qkv` $(d, 3d)$ and split into $Q, K, V$.
2. Apply your Part (b) with a **causal mask** (position $i$ attends only to
   $j \le i$ — build it with `torch.tril`).
3. Project the result with `w_out` $(d, d)$.

This is single-head attention; multi-head is a reshape away, which you can
explore in the follow-on project.

---

**Checks to reason about before running**

- Softmax rows sum to 1; attention output is a convex combination of value rows.
- With a causal mask, changing $x_{j}$ for $j > i$ must not change output row $i$.
