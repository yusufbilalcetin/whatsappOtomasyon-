// Isimsiz, otomatik gelmis (cogunlukla grup-katilimcisi) kisi kayitlarini temizler.
//
// Kullanim (server/ dizininden):
//   node scripts/cleanup-contacts.mjs            -> TUM kullanicilar, kuru calisma (silmez, sadece sayar)
//   node scripts/cleanup-contacts.mjs <uid>      -> tek kullanici, kuru calisma
//   node scripts/cleanup-contacts.mjs --apply    -> TUM kullanicilar, GERCEKTEN siler
//   node scripts/cleanup-contacts.mjs <uid> --apply
//
// Silme olcutu (hepsi birden): type=user + source!=manual + customName yok + nameSource=phone (numaradan ibaret).
// Gruplar, elle eklenenler ve WhatsApp ismi/ozel adi olanlar KORUNUR.
import { db } from '../src/firestore.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const all = args.includes('--all'); // --all: TUM kisileri/gruplari sil (bastan senkron icin)
const uidArg = args.find((a) => !a.startsWith('--'));

function shouldDelete(c) {
  if (all) return true; // hepsini sil
  return c.type !== 'group'
    && c.source !== 'manual'
    && !c.customName
    && c.nameSource === 'phone';
}

async function cleanupUser(uid) {
  const snap = await db.collection('users').doc(uid).collection('contacts').get();
  const toDelete = snap.docs.filter((d) => shouldDelete(d.data()));
  let deleted = 0;
  if (apply) {
    for (let i = 0; i < toDelete.length; i += 400) {
      const batch = db.batch();
      toDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += Math.min(400, toDelete.length - i);
    }
  }
  console.log(JSON.stringify({
    uid, toplam: snap.size, silinecek: toDelete.length, kalan: snap.size - toDelete.length,
    mod: apply ? `silindi (${deleted})` : 'kuru-calisma',
  }));
}

const uids = uidArg
  ? [uidArg]
  : (await db.collection('users').get()).docs.map((d) => d.id);

for (const uid of uids) await cleanupUser(uid);
console.log(apply ? 'Tamamlandi.' : 'Kuru calisma bitti. Gercekten silmek icin --apply ekleyin.');
process.exit(0);
