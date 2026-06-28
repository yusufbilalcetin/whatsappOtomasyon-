import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Istanbul',
  waAuthDir: process.env.WA_AUTH_DIR || './auth_info',
  panelPassword: process.env.PANEL_PASSWORD || '',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
};
