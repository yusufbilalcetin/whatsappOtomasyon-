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

// Gelen bir WhatsApp mesajina, verilen persona ile kisa bir cevap uretir.
export async function generateReply(persona, incomingText) {
  const instruction =
    (persona?.trim()
      ? `Sen bir WhatsApp kullanicisi adina cevap yaziyorsun. Karakterin/uslubun: ${persona.trim()}\n\n`
      : 'Sen yardimsever, samimi bir WhatsApp asistanisin.\n\n') +
    'Asagidaki gelen mesaja kisa, dogal, tek bir WhatsApp cevabi yaz. ' +
    'Sadece cevap metnini dondur, tirnak veya aciklama ekleme.\n\nGelen mesaj: ' +
    incomingText;
  const result = await getModel().generateContent(instruction);
  return result.response.text().trim();
}
