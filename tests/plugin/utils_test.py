# fixture and parameter have the same name
# pylint: disable=redefined-outer-name
from rpdk.typescript.utils import safe_reserved


def test_safe_reserved_safe_string():
    assert safe_reserved("foo") == "foo"


def test_safe_reserved_unsafe_javascript_string():
    assert safe_reserved("null") == "null_"


def test_safe_reserved_unsafe_typescript_string():
    assert safe_reserved("interface") == "interface_"
