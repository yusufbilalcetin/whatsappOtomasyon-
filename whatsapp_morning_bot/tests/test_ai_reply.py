from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ai_reply  # noqa: E402


def test_build_system_prompt_includes_persona_and_samples():
    prompt = ai_reply.build_system_prompt(
        "Ben Yusuf, kısa ve samimi yazarım.",
        ["selam nasılsın", "tamam görüşürüz"],
    )
    assert "kullanıcının kişisel whatsapp asistanısın" in prompt.lower()
    assert "Yusuf" in prompt
    assert "selam nasılsın" in prompt
    assert "tamam görüşürüz" in prompt


def test_build_system_prompt_limits_samples_to_20():
    samples = [f"mesaj {i}" for i in range(40)]
    prompt = ai_reply.build_system_prompt("", samples)
    assert "mesaj 19" in prompt
    assert "mesaj 20" not in prompt


def test_build_user_content_orders_and_labels():
    context = [
        {"from_me": False, "text": "naber"},
        {"from_me": True, "text": "iyiyim sen"},
    ]
    content = ai_reply.build_user_content(context, "bugün müsait misin")
    assert "Karşı taraf: naber" in content
    assert "Ben: iyiyim sen" in content
    assert "bugün müsait misin" in content


def test_build_user_content_truncates_to_last_10():
    context = [{"from_me": False, "text": f"m{i}"} for i in range(15)]
    content = ai_reply.build_user_content(context, "son")
    assert "m14" in content
    assert "m4" not in content  # 15 mesajdan sadece son 10 (m5..m14)


def test_draft_reply_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = ai_reply.draft_reply(
        incoming_text="selam", context_messages=[], api_key=None
    )
    assert result.success is False
    assert "anahtar" in (result.error_message or "").lower()


def test_draft_reply_empty_incoming(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    result = ai_reply.draft_reply(incoming_text="   ", context_messages=[])
    assert result.success is False
