import math

from labbench import case, run

from value import Value


@case("(a) addition forward + backward")
def test_add():
    a, b = Value(2.0), Value(3.0)
    c = a + b
    assert c.data == 5.0, f"2+3 -> {c.data}"
    c.backward()
    assert a.grad == 1.0 and b.grad == 1.0, f"grads {a.grad}, {b.grad}, want 1, 1"


@case("(a) multiplication forward + backward")
def test_mul():
    a, b = Value(2.0), Value(3.0)
    c = a * b
    assert c.data == 6.0, f"2*3 -> {c.data}"
    c.backward()
    assert a.grad == 3.0 and b.grad == 2.0, f"grads {a.grad}, {b.grad}, want 3, 2"


@case("(a) power rule")
def test_pow():
    x = Value(3.0)
    y = x ** 2
    y.backward()
    assert y.data == 9.0 and abs(x.grad - 6.0) < 1e-9, f"x^2 at 3: data={y.data}, grad={x.grad}"


@case("(a) relu and tanh")
def test_activations():
    x = Value(-1.5)
    assert x.relu().data == 0.0, "relu(-1.5) should be 0"
    y = Value(0.5).tanh()
    assert abs(y.data - math.tanh(0.5)) < 1e-9, f"tanh(0.5) -> {y.data}"
    z = Value(0.5)
    t = z.tanh()
    t.backward()
    want = 1 - math.tanh(0.5) ** 2
    assert abs(z.grad - want) < 1e-9, f"tanh'(0.5) -> {z.grad}, want {want}"


@case("(a) numeric literals on either side")
def test_scalars():
    x = Value(4.0)
    y = 2 * x + 1.0 - x / 2.0
    assert abs(y.data - 7.0) < 1e-9, f"2*4 + 1 - 4/2 -> {y.data}, want 7"


@case("(b) gradients accumulate when a node is reused")
def test_reuse():
    x = Value(3.0)
    y = x * x + x  # dy/dx = 2x + 1 = 7
    y.backward()
    assert abs(x.grad - 7.0) < 1e-9, f"d(x^2+x)/dx at 3 -> {x.grad}, want 7 (are you using += ?)"


@case("(b) chain through a small MLP expression")
def test_chain():
    # f(a, b) = tanh(a*b + b^2); check against finite differences.
    def f(av, bv):
        a, b = Value(av), Value(bv)
        out = (a * b + b ** 2).tanh()
        return a, b, out

    a, b, out = f(0.7, -0.3)
    out.backward()
    eps = 1e-6
    da = (f(0.7 + eps, -0.3)[2].data - f(0.7 - eps, -0.3)[2].data) / (2 * eps)
    db = (f(0.7, -0.3 + eps)[2].data - f(0.7, -0.3 - eps)[2].data) / (2 * eps)
    assert abs(a.grad - da) < 1e-4, f"da: got {a.grad}, finite-diff {da}"
    assert abs(b.grad - db) < 1e-4, f"db: got {b.grad}, finite-diff {db}"


@case("(c) a neuron actually learns (loss < 1e-2)")
def test_neuron_learns():
    from train import train_neuron

    _, _, final_loss = train_neuron()
    assert final_loss < 1e-2, f"final loss {final_loss:.5f} >= 1e-2 — gradients are off somewhere"


run()
