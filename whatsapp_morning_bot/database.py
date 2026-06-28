from __future__ import annotations

import random
import sqlite3
from datetime import date, datetime
from typing import Any

import paths


def _db_path():
    return paths.db_path()

DEFAULT_MESSAGES = [
    "Günaydın güzelim, umarım bugün yüzün hep güler ❤️",
    "Günaydın hayatım, yeni gün sana güzellikler getirsin 🌸",
    "Günaydın sevgilim, bugün de aklımdasın. Seni seviyorum ❤️",
    "Günaydın canım, güzel bir gün geçirmeni istiyorum ☀️",
    "Günaydın aşkım, bugün senin için çok güzel geçsin inşallah ❤️",
]

_UNSET = object()


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(_db_path())
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def init_db() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                send_time TEXT NOT NULL DEFAULT '08:00',
                selected_contact_id INTEGER,
                random_enabled INTEGER NOT NULL DEFAULT 1,
                automation_enabled INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (selected_contact_id)
                    REFERENCES contacts (id)
                    ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS auto_reply_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL DEFAULT 0,
                scope TEXT NOT NULL DEFAULT 'selected',
                send_mode TEXT NOT NULL DEFAULT 'approve',
                model TEXT NOT NULL DEFAULT 'claude-opus-4-8',
                poll_seconds INTEGER NOT NULL DEFAULT 8,
                persona_text TEXT NOT NULL DEFAULT '',
                reply_to_groups INTEGER NOT NULL DEFAULT 0,
                max_per_hour INTEGER NOT NULL DEFAULT 20,
                min_delay_seconds INTEGER NOT NULL DEFAULT 15,
                api_key TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS auto_reply_whitelist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS style_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pending_replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_key TEXT NOT NULL,
                contact_name TEXT NOT NULL DEFAULT '',
                incoming_text TEXT NOT NULL,
                draft_text TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                sent_at TEXT,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS chat_state (
                chat_key TEXT PRIMARY KEY,
                last_incoming_sig TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO settings
                (id, send_time, selected_contact_id, random_enabled, automation_enabled)
            VALUES
                (1, '08:00', NULL, 1, 0)
            """
        )
        connection.execute("INSERT OR IGNORE INTO auto_reply_config (id) VALUES (1)")

        message_count = connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        if message_count == 0:
            connection.executemany(
                "INSERT INTO messages (text, is_active) VALUES (?, 1)",
                [(message,) for message in DEFAULT_MESSAGES],
            )


def list_contacts() -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, name, phone FROM contacts ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return [dict(row) for row in rows]


def get_contact(contact_id: int | None) -> dict[str, Any] | None:
    if not contact_id:
        return None
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, name, phone FROM contacts WHERE id = ?",
            (contact_id,),
        ).fetchone()
    return _row_to_dict(row)


def get_contact_by_phone(phone: str) -> dict[str, Any] | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, name, phone FROM contacts WHERE phone = ?",
            (phone,),
        ).fetchone()
    return _row_to_dict(row)


def add_contact(name: str, phone: str) -> int:
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO contacts (name, phone) VALUES (?, ?)",
            (name.strip(), phone.strip()),
        )
        return int(cursor.lastrowid)


def update_contact(contact_id: int, name: str, phone: str) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE contacts SET name = ?, phone = ? WHERE id = ?",
            (name.strip(), phone.strip(), contact_id),
        )


def delete_contact(contact_id: int) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))


def list_messages(active_only: bool = False) -> list[dict[str, Any]]:
    query = "SELECT id, text, is_active FROM messages"
    params: tuple[Any, ...] = ()
    if active_only:
        query += " WHERE is_active = 1"
    query += " ORDER BY id"
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def get_message(message_id: int) -> dict[str, Any] | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, text, is_active FROM messages WHERE id = ?",
            (message_id,),
        ).fetchone()
    return _row_to_dict(row)


def add_message(text: str, is_active: bool = True) -> int:
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO messages (text, is_active) VALUES (?, ?)",
            (text.strip(), int(is_active)),
        )
        return int(cursor.lastrowid)


def update_message(message_id: int, text: str, is_active: bool) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE messages SET text = ?, is_active = ? WHERE id = ?",
            (text.strip(), int(is_active), message_id),
        )


def delete_message(message_id: int) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM messages WHERE id = ?", (message_id,))


def set_message_active(message_id: int, is_active: bool) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE messages SET is_active = ? WHERE id = ?",
            (int(is_active), message_id),
        )


def set_single_active_message(text: str) -> int:
    """Verilen mesajı tek aktif mesaj yapar; diğerlerini SİLMEDEN pasifleştirir.

    Otomasyon tek mesaj kullanır; bu yüzden eski yaklaşım tüm havuzu DELETE ediyordu.
    Bunun yerine metni (varsa mevcut satırı yeniden kullanarak) ekler/aktif eder ve
    geri kalan mesajları pasife çeker. Böylece mesaj havuzu veri kaybı yaşamaz.
    """
    cleaned = text.strip()
    with get_connection() as connection:
        connection.execute("UPDATE messages SET is_active = 0")
        row = connection.execute(
            "SELECT id FROM messages WHERE text = ? LIMIT 1", (cleaned,)
        ).fetchone()
        if row is not None:
            message_id = int(row["id"])
            connection.execute(
                "UPDATE messages SET is_active = 1 WHERE id = ?", (message_id,)
            )
        else:
            cursor = connection.execute(
                "INSERT INTO messages (text, is_active) VALUES (?, 1)", (cleaned,)
            )
            message_id = int(cursor.lastrowid)
    return message_id


def choose_message_for_send(random_enabled: bool) -> dict[str, Any] | None:
    messages = list_messages(active_only=True)
    if not messages:
        return None
    if random_enabled:
        return random.choice(messages)
    return messages[0]


def get_random_message() -> dict[str, Any] | None:
    return choose_message_for_send(True)


def get_settings() -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, send_time, selected_contact_id, random_enabled, automation_enabled
            FROM settings
            WHERE id = 1
            """
        ).fetchone()
    if row is None:
        init_db()
        return get_settings()
    settings = dict(row)
    settings["random_enabled"] = bool(settings["random_enabled"])
    settings["automation_enabled"] = bool(settings["automation_enabled"])
    return settings


def update_settings(
    *,
    send_time: str | None = None,
    selected_contact_id: int | None | object = _UNSET,
    random_enabled: bool | None = None,
    automation_enabled: bool | None = None,
) -> None:
    current = get_settings()
    values: dict[str, Any] = {
        "send_time": current["send_time"],
        "selected_contact_id": current["selected_contact_id"],
        "random_enabled": int(current["random_enabled"]),
        "automation_enabled": int(current["automation_enabled"]),
    }
    if send_time is not None:
        values["send_time"] = send_time
    if selected_contact_id is not _UNSET:
        values["selected_contact_id"] = selected_contact_id
    if random_enabled is not None:
        values["random_enabled"] = int(random_enabled)
    if automation_enabled is not None:
        values["automation_enabled"] = int(automation_enabled)

    with get_connection() as connection:
        connection.execute(
            """
            UPDATE settings
            SET send_time = ?,
                selected_contact_id = ?,
                random_enabled = ?,
                automation_enabled = ?
            WHERE id = 1
            """,
            (
                values["send_time"],
                values["selected_contact_id"],
                values["random_enabled"],
                values["automation_enabled"],
            ),
        )


def set_selected_contact(contact_id: int | None) -> None:
    with get_connection() as connection:
        connection.execute(
            "UPDATE settings SET selected_contact_id = ? WHERE id = 1",
            (contact_id,),
        )


def get_selected_contact() -> dict[str, Any] | None:
    settings = get_settings()
    return get_contact(settings["selected_contact_id"])


def add_log(
    *,
    contact_name: str,
    phone: str,
    message: str,
    status: str,
    error_message: str | None = None,
    sent_at: datetime | None = None,
) -> int:
    sent_at_value = (sent_at or datetime.now()).strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO logs
                (contact_name, phone, message, status, sent_at, error_message)
            VALUES
                (?, ?, ?, ?, ?, ?)
            """,
            (
                contact_name,
                phone,
                message,
                status,
                sent_at_value,
                error_message,
            ),
        )
        return int(cursor.lastrowid)


def list_logs(limit: int = 100) -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, contact_name, phone, message, status, sent_at, error_message
            FROM logs
            ORDER BY sent_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def automatic_success_exists_today(phone: str, day: date | None = None) -> bool:
    day_value = (day or date.today()).isoformat()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT 1
            FROM logs
            WHERE phone = ?
              AND substr(sent_at, 1, 10) = ?
              AND status = 'Otomatik Başarılı'
            LIMIT 1
            """,
            (phone, day_value),
        ).fetchone()
    return row is not None


# --------------------------------------------------------------------------- #
# Otomatik Yanıt (AI auto-reply)
# --------------------------------------------------------------------------- #
_AUTO_REPLY_FIELDS = (
    "enabled",
    "scope",
    "send_mode",
    "model",
    "poll_seconds",
    "persona_text",
    "reply_to_groups",
    "max_per_hour",
    "min_delay_seconds",
    "api_key",
)


def get_auto_reply_config() -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            f"SELECT {', '.join(_AUTO_REPLY_FIELDS)} FROM auto_reply_config WHERE id = 1"
        ).fetchone()
    if row is None:
        init_db()
        return get_auto_reply_config()
    config = dict(row)
    config["enabled"] = bool(config["enabled"])
    config["reply_to_groups"] = bool(config["reply_to_groups"])
    return config


def update_auto_reply_config(**values: Any) -> None:
    allowed = {key: val for key, val in values.items() if key in _AUTO_REPLY_FIELDS}
    if not allowed:
        return
    for bool_field in ("enabled", "reply_to_groups"):
        if bool_field in allowed:
            allowed[bool_field] = int(bool(allowed[bool_field]))
    assignments = ", ".join(f"{field} = ?" for field in allowed)
    params = list(allowed.values())
    with get_connection() as connection:
        connection.execute(
            f"UPDATE auto_reply_config SET {assignments} WHERE id = 1", params
        )


def list_whitelist() -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, phone, name FROM auto_reply_whitelist ORDER BY name COLLATE NOCASE, phone"
        ).fetchall()
    return [dict(row) for row in rows]


def add_whitelist_entry(phone: str, name: str = "") -> None:
    with get_connection() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO auto_reply_whitelist (phone, name) VALUES (?, ?)",
            (phone.strip(), name.strip()),
        )


def delete_whitelist_entry(entry_id: int) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM auto_reply_whitelist WHERE id = ?", (entry_id,))


def whitelist_phones() -> set[str]:
    return {entry["phone"] for entry in list_whitelist()}


def list_style_samples() -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute("SELECT id, text FROM style_samples ORDER BY id").fetchall()
    return [dict(row) for row in rows]


def add_style_sample(text: str) -> None:
    cleaned = text.strip()
    if not cleaned:
        return
    with get_connection() as connection:
        connection.execute("INSERT INTO style_samples (text) VALUES (?)", (cleaned,))


def delete_style_sample(sample_id: int) -> None:
    with get_connection() as connection:
        connection.execute("DELETE FROM style_samples WHERE id = ?", (sample_id,))


def replace_style_samples(texts: list[str]) -> None:
    cleaned = [text.strip() for text in texts if text.strip()]
    with get_connection() as connection:
        connection.execute("DELETE FROM style_samples")
        connection.executemany(
            "INSERT INTO style_samples (text) VALUES (?)", [(text,) for text in cleaned]
        )


def add_pending_reply(
    *, chat_key: str, contact_name: str, incoming_text: str, draft_text: str, status: str = "pending"
) -> int:
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO pending_replies
                (chat_key, contact_name, incoming_text, draft_text, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (chat_key, contact_name, incoming_text, draft_text, status, created_at),
        )
        return int(cursor.lastrowid)


def list_pending_replies(statuses: tuple[str, ...] = ("pending",), limit: int = 100) -> list[dict[str, Any]]:
    placeholders = ", ".join("?" for _ in statuses)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT id, chat_key, contact_name, incoming_text, draft_text, status,
                   created_at, sent_at, error_message
            FROM pending_replies
            WHERE status IN ({placeholders})
            ORDER BY id DESC
            LIMIT ?
            """,
            (*statuses, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def claim_approved_replies() -> list[dict[str, Any]]:
    """Onaylanmış (gönderilmeyi bekleyen) cevapları döndürür."""
    return list_pending_replies(statuses=("approved",), limit=50)


def set_pending_reply_status(
    reply_id: int, status: str, *, draft_text: str | None = None, error_message: str | None = None
) -> None:
    sets = ["status = ?"]
    params: list[Any] = [status]
    if draft_text is not None:
        sets.append("draft_text = ?")
        params.append(draft_text)
    if status == "sent":
        sets.append("sent_at = ?")
        params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    if error_message is not None:
        sets.append("error_message = ?")
        params.append(error_message)
    params.append(reply_id)
    with get_connection() as connection:
        connection.execute(
            f"UPDATE pending_replies SET {', '.join(sets)} WHERE id = ?", params
        )


def get_chat_signature(chat_key: str) -> str | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT last_incoming_sig FROM chat_state WHERE chat_key = ?", (chat_key,)
        ).fetchone()
    return row["last_incoming_sig"] if row else None


def set_chat_signature(chat_key: str, signature: str) -> None:
    updated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO chat_state (chat_key, last_incoming_sig, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(chat_key) DO UPDATE SET
                last_incoming_sig = excluded.last_incoming_sig,
                updated_at = excluded.updated_at
            """,
            (chat_key, signature, updated_at),
        )


def count_auto_sent_since(since: datetime) -> int:
    """Belirtilen zamandan beri gönderilmiş otomatik cevap sayısı (hız sınırı için)."""
    since_value = since.strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as connection:
        row = connection.execute(
            "SELECT COUNT(*) FROM pending_replies WHERE status = 'sent' AND sent_at >= ?",
            (since_value,),
        ).fetchone()
    return int(row[0]) if row else 0
