/**
 * Eski Python (SQLite) verisini Firestore'a tasir.
 *
 * Kullanim:
 *   npm i better-sqlite3        # tek seferlik, sadece migration icin
 *   node scripts/migrate-sqlite.js "C:/Users/<kullanici>/AppData/Roaming/MesajBotu/app.db"
 *
 * contacts ve messages tasinir. Eski tek-otomasyon ayari, ilk kisi icin
 * bir "automations" kaydina donusturulur.
 */
import Database from 'better-sqlite3';
import { addContact, addAutomation, listContacts } from '../src/firestore.js';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Kullanim: node scripts/migrate-sqlite.js <app.db yolu>');
  process.exit(1);
}

const sqlite = new Database(dbPath, { readonly: true });

const contactIdMap = new Map();
for (const row of sqlite.prepare('SELECT id, name, phone FROM contacts').all()) {
  const newId = await addContact(row.name, row.phone);
  contactIdMap.set(row.id, newId);
  console.log('Kisi tasindi:', row.name);
}

// Eski tek otomasyonu yeni modele cevir (ilk aktif mesaji metin olarak al).
const settings = sqlite.prepare('SELECT send_time, selected_contact_id, automation_enabled FROM settings WHERE id = 1').get();
if (settings?.selected_contact_id && contactIdMap.has(settings.selected_contact_id)) {
  const firstMsg = sqlite.prepare('SELECT text FROM messages WHERE is_active = 1 LIMIT 1').get();
  await addAutomation({
    name: 'Tasinan otomasyon',
    contactId: contactIdMap.get(settings.selected_contact_id),
    time: settings.send_time || '08:00',
    messageMode: 'fixed',
    messageText: firstMsg?.text || 'Gunaydin',
    enabled: !!settings.automation_enabled,
  });
  console.log('Eski otomasyon tasindi.');
}

console.log('Tamamlandi. Toplam kisi:', (await listContacts()).length);
process.exit(0);
