import 'dotenv/config';

export const config = {
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Istanbul',
  waAuthDir: process.env.WA_AUTH_DIR || './auth_info',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
};
