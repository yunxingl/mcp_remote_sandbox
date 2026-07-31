import torch
import torch.nn.functional as F

from labbench import case, run

import attention

torch.manual_seed(0)


@case("(a) softmax matches torch on random 3-D input, every dim")
def test_softmax_matches():
    x = torch.randn(2, 5, 7)
    for dim in (-1, 0, 1, 2):
        got = attention.softmax(x, dim)
        want = F.softmax(x, dim=dim)
        assert torch.allclose(got, want, atol=1e-6), f"softmax mismatch along dim={dim}"


@case("(a) softmax is numerically stable for large inputs")
def test_softmax_stable():
    x = torch.tensor([[0.0, 10_000.0], [-10_000.0, 0.0]])
    got = attention.softmax(x, -1)
    assert torch.isfinite(got).all(), f"softmax produced inf/nan: {got}"
    assert torch.allclose(got.sum(-1), torch.ones(2), atol=1e-6), "rows must sum to 1"


@case("(b) attention matches torch reference (unbatched)")
def test_attn_unbatched():
    q, k, v = torch.randn(4, 8), torch.randn(6, 8), torch.randn(6, 3)
    got = attention.scaled_dot_product_attention(q, k, v)
    want = F.scaled_dot_product_attention(q, k, v)
    assert got.shape == want.shape, f"shape {tuple(got.shape)}, want {tuple(want.shape)}"
    assert torch.allclose(got, want, atol=1e-5), "unbatched attention mismatch"


@case("(b) attention matches torch reference (batched, with mask)")
def test_attn_batched_mask():
    q = torch.randn(2, 4, 5, 8)
    k = torch.randn(2, 4, 7, 8)
    v = torch.randn(2, 4, 7, 16)
    mask = torch.rand(2, 4, 5, 7) > 0.3
    mask[..., 0] = True  # keep at least one attendable key per query row
    got = attention.scaled_dot_product_attention(q, k, v, mask)
    want = F.scaled_dot_product_attention(q, k, v, attn_mask=mask)
    assert torch.allclose(got, want, atol=1e-5), "batched masked attention mismatch"


@case("(b) fully-masked scores get zero weight")
def test_attn_mask_zero_weight():
    q, k = torch.randn(3, 4), torch.randn(5, 4)
    v = torch.eye(5)
    mask = torch.ones(3, 5, dtype=torch.bool)
    mask[:, 4] = False  # key 4 never attended
    got = attention.scaled_dot_product_attention(q, k, v, mask)
    assert torch.allclose(got[:, 4], torch.zeros(3), atol=1e-6), \
        "masked-out key received nonzero attention weight"


@case("(c) causal: future positions cannot influence the past")
def test_causal_no_future_leak():
    d = 8
    x = torch.randn(1, 6, d)
    w_qkv, w_out = torch.randn(d, 3 * d) / d**0.5, torch.randn(d, d) / d**0.5
    base = attention.causal_self_attention(x, w_qkv, w_out)
    x2 = x.clone()
    x2[0, 5] += 10.0  # perturb the last position
    out2 = attention.causal_self_attention(x2, w_qkv, w_out)
    assert torch.allclose(base[0, :5], out2[0, :5], atol=1e-5), \
        "changing position 5 changed outputs at positions < 5 — mask is wrong"


@case("(c) causal matches a reference implementation")
def test_causal_reference():
    d = 8
    x = torch.randn(2, 5, d)
    w_qkv, w_out = torch.randn(d, 3 * d) / d**0.5, torch.randn(d, d) / d**0.5
    got = attention.causal_self_attention(x, w_qkv, w_out)

    qkv = x @ w_qkv
    q, k, v = qkv.split(d, dim=-1)
    mask = torch.tril(torch.ones(5, 5, dtype=torch.bool))
    want = F.scaled_dot_product_attention(q, k, v, attn_mask=mask) @ w_out
    assert got.shape == want.shape, f"shape {tuple(got.shape)}, want {tuple(want.shape)}"
    assert torch.allclose(got, want, atol=1e-5), "causal self-attention mismatch"


run()
