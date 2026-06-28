import pino from 'pino';

// Sade stdout logger (ekstra bagimlilik yok; systemd/journalctl ile uyumlu).
export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
