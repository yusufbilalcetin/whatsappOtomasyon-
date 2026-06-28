from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wa_monitor import EligibilityInput, is_eligible, message_signature  # noqa: E402


def _base(**overrides):
    data = dict(
        scope="all",
        whitelist=set(),
        reply_to_groups=False,
        is_group=False,
        from_me=False,
        chat_key="Ali",
        sent_last_hour=0,
        max_per_hour=20,
        seconds_since_last_send=1000.0,
        min_delay_seconds=15,
    )
    data.update(overrides)
    return EligibilityInput(**data)


def test_eligible_basic():
    ok, _ = is_eligible(_base())
    assert ok is True


def test_reject_own_message():
    ok, reason = is_eligible(_base(from_me=True))
    assert ok is False
    assert "Kendi" in reason


def test_reject_group_when_disabled():
    ok, reason = is_eligible(_base(is_group=True, reply_to_groups=False))
    assert ok is False


def test_allow_group_when_enabled():
    ok, _ = is_eligible(_base(is_group=True, reply_to_groups=True))
    assert ok is True


def test_selected_scope_requires_whitelist():
    ok, _ = is_eligible(_base(scope="selected", whitelist=set(), chat_key="Ali"))
    assert ok is False
    ok2, _ = is_eligible(_base(scope="selected", whitelist={"Ali"}, chat_key="Ali"))
    assert ok2 is True


def test_rate_limit_per_hour():
    ok, reason = is_eligible(_base(sent_last_hour=20, max_per_hour=20))
    assert ok is False
    assert "Saatlik" in reason


def test_min_delay_between_sends():
    ok, reason = is_eligible(_base(seconds_since_last_send=5.0, min_delay_seconds=15))
    assert ok is False


def test_signature_stable_and_distinct():
    a = message_signature("Ali", "selam")
    assert a == message_signature("Ali", "selam")
    assert a != message_signature("Ali", "naber")
    assert a != message_signature("Veli", "selam")
