"""Attention from primitives. Allowed: basic tensor ops.
Not allowed: torch.softmax / F.softmax / F.scaled_dot_product_attention.
"""

import torch


def softmax(x: torch.Tensor, dim: int) -> torch.Tensor:
    """Part (a): numerically stable softmax along `dim`."""
    raise NotImplementedError


def scaled_dot_product_attention(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    mask: torch.Tensor | None = None,
) -> torch.Tensor:
    """Part (b): softmax(q @ k^T / sqrt(d_k)) @ v, with optional boolean mask
    (False = masked out)."""
    raise NotImplementedError


def causal_self_attention(
    x: torch.Tensor,
    w_qkv: torch.Tensor,
    w_out: torch.Tensor,
) -> torch.Tensor:
    """Part (c): single-head causal self-attention.

    x: (B, n, d), w_qkv: (d, 3d), w_out: (d, d) -> (B, n, d)
    """
    raise NotImplementedError
