import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import { logger } from './logger.js';

let model = null;

function getModel() {
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY tanimli degil (.env).');
  }
  if (!model) {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genAI.getGenerativeModel({ model: config.gemini.model });
  }
  return model;
}

// Bir otomasyonun aiPrompt'una gore tek bir mesaj metni uretir.
export async function generateMessage(prompt) {
  const instruction =
    'Asagidaki istege uygun, kisa, samimi, tek bir WhatsApp mesaji yaz. ' +
    'Sadece mesaj metnini dondur, tirnak veya aciklama ekleme.\n\nIstek: ' +
    prompt;
  const result = await getModel().generateContent(instruction);
  const text = result.response.text().trim();
  logger.info({ prompt }, 'Gemini mesaj uretti.');
  return text;
}
