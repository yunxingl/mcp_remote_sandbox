# Micrograd: a Tiny Autograd Engine

Every deep learning framework is, at its core, a machine for computing
$\nabla_\theta \mathcal{L}$ by reverse-mode automatic differentiation. Here you
build that machine: a scalar `Value` class that records the computation graph
as you use it, then backpropagates gradients with the chain rule.

A `Value` wraps a float `data`, accumulates `grad` = $\partial \mathcal{L} / \partial v$,
and remembers its parent nodes plus a local backward rule.

## Part (a) — forward ops and graph recording

Make `Value` support `+`, `*`, `**` (float power), and the provided helpers
`relu()` and `tanh()`, in each case:

- computing the forward `data`,
- storing the operands as `_prev`,
- storing a `_backward` closure that propagates `out.grad` into the operands'
  `grad` fields using the chain rule (**accumulate with `+=`** — a node used
  twice must receive both contributions).

Also make `+` and `*` accept plain numbers on either side
(`2 * x`, `x + 1.0`), and support negation/subtraction/division via the
derived ops already stubbed in.

The local derivatives:

$$\frac{\partial (x+y)}{\partial x} = 1 \qquad
\frac{\partial (xy)}{\partial x} = y \qquad
\frac{\partial x^n}{\partial x} = n x^{n-1}$$

$$\mathrm{relu}'(x) = \mathbb{1}[x > 0] \qquad
\tanh'(x) = 1 - \tanh^2(x)$$

## Part (b) — backward()

Implement `Value.backward()`:

1. Build a **topological order** of the graph reachable from `self`
   (depth-first, post-order).
2. Set `self.grad = 1.0`.
3. Call each node's `_backward` in **reverse topological order**.

## Part (c) — use it: a neuron learns

With your engine, the provided `train_neuron()` in `train.py` fits a single
neuron $\hat y = \tanh(wx + b)$ to three points by gradient descent. Make sure
gradients flow correctly through the whole loop — the tests check the fitted
loss actually decreases below $10^{-2}$, and verify your gradients against
finite differences:

$$\frac{f(\theta + \varepsilon) - f(\theta - \varepsilon)}{2\varepsilon}
\approx \frac{\partial f}{\partial \theta}$$

---

**Hints**

- `__radd__` / `__rmul__` make numeric literals work on the left.
- In `backward()`, guard the DFS with a `visited` set — graphs are DAGs, not trees.
- If the finite-difference check fails but simple cases pass, you're probably
  overwriting `grad` with `=` instead of accumulating with `+=`.
