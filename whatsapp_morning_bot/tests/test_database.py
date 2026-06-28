from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import database  # noqa: E402
import paths  # noqa: E402


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(paths, "db_path", lambda: data_dir / "app.db")
    database.init_db()
    return database


def test_init_seeds_default_messages(temp_db):
    messages = temp_db.list_messages()
    assert len(messages) == len(temp_db.DEFAULT_MESSAGES)
    assert all(m["is_active"] == 1 for m in messages)


def test_set_single_active_message_is_non_destructive(temp_db):
    before = len(temp_db.list_messages())
    temp_db.set_single_active_message("Yeni otomasyon mesajı")

    all_messages = temp_db.list_messages()
    active = temp_db.list_messages(active_only=True)

    # Havuz silinmedi, sadece yeni mesaj eklendi.
    assert len(all_messages) == before + 1
    # Tek bir aktif mesaj kaldı ve o da yeni mesaj.
    assert len(active) == 1
    assert active[0]["text"] == "Yeni otomasyon mesajı"


def test_set_single_active_message_reuses_existing_row(temp_db):
    existing = temp_db.list_messages()[0]["text"]
    before = len(temp_db.list_messages())
    temp_db.set_single_active_message(existing)

    all_messages = temp_db.list_messages()
    active = temp_db.list_messages(active_only=True)
    assert len(all_messages) == before  # yeni satır eklenmedi
    assert len(active) == 1
    assert active[0]["text"] == existing


def test_choose_message_deterministic_when_not_random(temp_db):
    temp_db.set_single_active_message("Sabit mesaj")
    chosen = temp_db.choose_message_for_send(random_enabled=False)
    assert chosen is not None
    assert chosen["text"] == "Sabit mesaj"


def test_automatic_success_dedup(temp_db):
    phone = "+905551234567"
    assert temp_db.automatic_success_exists_today(phone) is False
    temp_db.add_log(
        contact_name="Test",
        phone=phone,
        message="Günaydın",
        status="Otomatik Başarılı",
    )
    assert temp_db.automatic_success_exists_today(phone) is True
