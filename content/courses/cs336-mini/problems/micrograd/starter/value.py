"""A tiny scalar autograd engine (in the spirit of karpathy/micrograd)."""

import math


class Value:
    """A scalar with autograd support."""

    def __init__(self, data: float, _prev: tuple = ()):
        self.data = float(data)
        self.grad = 0.0
        self._prev = _prev
        self._backward = lambda: None

    # ---- Part (a): forward ops -----------------------------------------

    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        raise NotImplementedError("Part (a): implement __add__")

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        raise NotImplementedError("Part (a): implement __mul__")

    def __pow__(self, n):
        assert isinstance(n, (int, float)), "only float powers supported"
        raise NotImplementedError("Part (a): implement __pow__")

    def relu(self):
        raise NotImplementedError("Part (a): implement relu")

    def tanh(self):
        raise NotImplementedError("Part (a): implement tanh")

    # ---- derived ops (these work once the ones above do) ---------------

    def __neg__(self):
        return self * -1.0

    def __sub__(self, other):
        return self + (-other if isinstance(other, Value) else -float(other))

    def __rsub__(self, other):
        return Value(other) + (-self)

    def __truediv__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return self * other**-1.0

    def __radd__(self, other):
        return self + other

    def __rmul__(self, other):
        return self * other

    # ---- Part (b): backprop --------------------------------------------

    def backward(self):
        """Backpropagate d(self)/d(node) into every node's .grad."""
        raise NotImplementedError("Part (b): implement backward")

    def __repr__(self):
        return f"Value(data={self.data:.6g}, grad={self.grad:.6g})"
