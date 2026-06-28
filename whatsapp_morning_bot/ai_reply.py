"""Claude API ile kullanıcı üslubunda yanıt taslağı üretimi.

Mesaj kurma (prompt) saf fonksiyonlarda tutulur; böylece API'ye gitmeden test edilebilir.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from app_logging import get_logger

logger = get_logger(__name__)

DEFAULT_MODEL = "claude-opus-4-8"
MAX_CONTEXT_MESSAGES = 10

_BASE_PERSONA = (
    "Sen, kullanıcının kişisel WhatsApp asistanısın. Kullanıcı ADINA, onun yerine yanıt "
    "yazıyorsun. Aşağıdaki kurallara uy:\n"
    "- Kullanıcının üslubunu, kelime tercihlerini ve tonunu taklit et.\n"
    "- Türkçe ve doğal yaz; kısa ve sohbet diline uygun ol.\n"
    "- Yapay zeka olduğunu ASLA belli etme, açıklama veya ön/son ek ekleme.\n"
    "- Sadece gönderilecek mesaj metnini yaz; tırnak işareti veya etiket koyma.\n"
    "- Emin olmadığın kişisel bilgileri uydurma; gerekiyorsa kısa ve nötr cevap ver."
)


@dataclass(slots=True)
class DraftResult:
    success: bool
    text: str
    error_message: str | None = None


def build_system_prompt(persona: str, style_samples: list[str]) -> str:
    """Persona + kullanıcının stil örneklerinden sistem promptu kurar."""
    parts = [_BASE_PERSONA]
    persona = (persona or "").strip()
    if persona:
        parts.append("Kullanıcının kendini tanımı / özel talimatları:\n" + persona)
    cleaned = [s.strip() for s in style_samples if s and s.strip()]
    if cleaned:
        examples = "\n".join(f"- {sample}" for sample in cleaned[:20])
        parts.append(
            "Kullanıcının daha önce yazdığı örnek mesajlar (üslubunu buradan öğren):\n" + examples
        )
    return "\n\n".join(parts)


def build_user_content(context_messages: list[dict[str, Any]], incoming_text: str) -> str:
    """Son sohbet bağlamı + gelen mesajdan kullanıcı içeriğini kurar.

    context_messages: [{"from_me": bool, "text": str}, ...] (eskiden yeniye).
    """
    lines: list[str] = []
    recent = context_messages[-MAX_CONTEXT_MESSAGES:] if context_messages else []
    for message in recent:
        who = "Ben" if message.get("from_me") else "Karşı taraf"
        text = (message.get("text") or "").strip()
        if text:
            lines.append(f"{who}: {text}")
    conversation = "\n".join(lines) if lines else "(önceki mesaj yok)"
    return (
        "Aşağıdaki WhatsApp sohbetinde, karşı tarafın SON mesajına benim ağzımdan bir yanıt yaz.\n\n"
        f"Sohbet:\n{conversation}\n\n"
        f"Karşı tarafın yanıtlanacak son mesajı:\n{incoming_text.strip()}\n\n"
        "Sadece göndereceğim yanıt metnini yaz:"
    )


def _resolve_api_key(api_key: str | None) -> str | None:
    if api_key and api_key.strip():
        return api_key.strip()
    env_key = os.getenv("ANTHROPIC_API_KEY")
    return env_key.strip() if env_key and env_key.strip() else None


def draft_reply(
    *,
    incoming_text: str,
    context_messages: list[dict[str, Any]],
    persona: str = "",
    style_samples: list[str] | None = None,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
    max_tokens: int = 400,
) -> DraftResult:
    key = _resolve_api_key(api_key)
    if not key:
        return DraftResult(False, "", "Claude API anahtarı tanımlı değil.")

    if not incoming_text or not incoming_text.strip():
        return DraftResult(False, "", "Gelen mesaj boş.")

    try:
        import anthropic
    except ImportError:
        return DraftResult(
            False, "", "anthropic paketi yüklü değil. 'pip install -r requirements.txt' çalıştırın."
        )

    system_prompt = build_system_prompt(persona, style_samples or [])
    user_content = build_user_content(context_messages, incoming_text)

    try:
        client = anthropic.Anthropic(api_key=key)
        response = client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        if response.stop_reason == "refusal":
            return DraftResult(False, "", "Model bu mesaja yanıt üretmeyi reddetti.")
        text = "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        ).strip()
        if not text:
            return DraftResult(False, "", "Model boş yanıt döndürdü.")
        logger.info("Taslak yanıt üretildi (%s).", model)
        return DraftResult(True, text)
    except Exception as exc:  # anthropic hata türleri ortama göre değişir
        logger.warning("Taslak yanıt üretilemedi: %s", exc)
        return DraftResult(False, "", f"Claude API hatası: {exc}")
