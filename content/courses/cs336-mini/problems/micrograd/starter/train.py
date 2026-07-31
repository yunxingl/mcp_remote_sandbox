"""Part (c): fit a single tanh neuron with your Value engine.

This file already works — if your Part (a)/(b) are correct.
Run it directly to watch the loss fall: python3 train.py
"""

from value import Value

DATA = [(-1.0, -0.8), (0.0, 0.2), (1.0, 0.9)]


def train_neuron(steps: int = 200, lr: float = 0.1):
    """Returns (w, b, final_loss) after gradient descent on 3 points."""
    w, b = Value(0.5), Value(0.0)
    loss = Value(0.0)
    for _ in range(steps):
        loss = Value(0.0)
        for x, y in DATA:
            pred = (w * x + b).tanh()
            loss = loss + (pred - y) ** 2
        w.grad, b.grad = 0.0, 0.0
        loss.backward()
        w.data -= lr * w.grad
        b.data -= lr * b.grad
    return w, b, loss.data


if __name__ == "__main__":
    w, b, final_loss = train_neuron()
    print(f"w={w.data:.4f} b={b.data:.4f} loss={final_loss:.6f}")
