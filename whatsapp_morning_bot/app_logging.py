from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import paths

_CONFIGURED = False


def _log_path() -> Path:
    return paths.log_path()


def setup_logging(level: int = logging.INFO) -> None:
    """Configure root logging once: rotating file + console."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        _log_path(), maxBytes=1_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(file_handler)
    root.addHandler(console_handler)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    setup_logging()
    return logging.getLogger(name)
