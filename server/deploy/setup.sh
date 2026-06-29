#!/usr/bin/env bash
# WhatsApp Otomasyon motoru icin tek komutluk kurulum (Ubuntu/Debian VM).
#
# Kullanim (sunucuda, server/ dizininden):
#   bash deploy/setup.sh
#
# Yaptiklari:
#   1. Node.js 20 kurar (yoksa)
#   2. npm bagimliliklarini kurar
#   3. systemd servisini bu dizine + bu kullaniciya gore olusturur
#   4. Servisi etkinlestirir ve baslatir
#   5. QR icin loglari nasil izleyecegini soyler
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(whoami)"
NODE_BIN="$(command -v node || true)"

echo "==> Sunucu dizini: $SERVER_DIR"
echo "==> Kullanici:     $RUN_USER"

# 0) Temel araclar (curl/git) — bazi minimal imajlarda olmayabilir
if command -v apt-get >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
    echo "==> curl/git kuruluyor..."
    sudo apt-get update && sudo apt-get install -y curl git
  fi
fi

# 1) Node.js 20
if ! command -v node >/dev/null 2>&1; then
  echo "==> Node.js kuruluyor (v20)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  NODE_BIN="$(command -v node)"
fi
echo "==> Node: $($NODE_BIN -v)"

# 2) Onkosul dosyalari kontrol
if [ ! -f "$SERVER_DIR/service-account.json" ]; then
  echo "!! UYARI: $SERVER_DIR/service-account.json YOK. Firebase servis hesabi anahtarini buraya koy."
fi
if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "!! UYARI: $SERVER_DIR/.env YOK. .env.example'i kopyalayip doldur."
fi

# 3) Bagimliliklar
echo "==> npm install..."
cd "$SERVER_DIR"
npm install --omit=dev || npm install

# 4) systemd servisi (yollar bu makineye gore yazilir)
SERVICE_FILE="/etc/systemd/system/whatsapp-otomasyon.service"
echo "==> systemd servisi yaziliyor: $SERVICE_FILE"
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=WhatsApp Otomasyon Servisi
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$SERVER_DIR
ExecStart=$NODE_BIN src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# 5) Etkinlestir + baslat
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-otomasyon

echo ""
echo "==> Kuruldu ve calisiyor. Durum:"
sudo systemctl --no-pager status whatsapp-otomasyon | head -n 6 || true
echo ""
echo "QR ve loglari izlemek icin:"
echo "  journalctl -u whatsapp-otomasyon -f"
echo "QR ayrica panelde de gorunur. Telefon: WhatsApp > Bagli cihazlar > Cihaz bagla ile oku."
