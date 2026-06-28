from __future__ import annotations

import argparse

import database
from app_logging import setup_logging
from scheduler import perform_scheduled_send
from wa_engine import open_whatsapp_web


def _send_now_cli() -> int:
    database.init_db()
    result = perform_scheduled_send()
    print(result.user_message)
    if result.error_message:
        print(result.error_message)
    return 0 if result.success or result.status == "Pasif" else 1


def _open_whatsapp_cli() -> int:
    open_whatsapp_web()
    print("WhatsApp Web açıldı. İlk kullanımda QR kod ile giriş yapın.")
    return 0


def run_gui() -> None:
    import customtkinter as ctk

    database.init_db()
    ctk.set_appearance_mode("System")
    ctk.set_default_color_theme("blue")
    from ui.main_window import MainWindow

    app = MainWindow()
    app.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Günaydın Mesaj Otomasyonu")
    parser.add_argument(
        "--send-now",
        action="store_true",
        help="Seçili ayarlarla otomatik gönderimi tek sefer çalıştırır.",
    )
    parser.add_argument(
        "--open-whatsapp",
        action="store_true",
        help="WhatsApp Web giriş sayfasını açar.",
    )
    args = parser.parse_args()

    setup_logging()

    if args.open_whatsapp:
        return _open_whatsapp_cli()
    if args.send_now:
        return _send_now_cli()

    run_gui()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
