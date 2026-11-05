const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();
const db = getFirestore();
const REGION = 'us-central1';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const QR_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const clean = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
const normalize = value => value && typeof value.toDate === 'function' ? value.toDate().toISOString() : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)])) : value;
const fail = (code, message) => { throw new HttpsError(code, message); };
const allowedOrganizerEmails = new Set((process.env.ORGANIZER_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));

async function organizer(data, request) {
  const user = request?.auth;
  if (!user || !user.uid) {
    if (typeof data?.organizerToken === 'string' && data.organizerToken.length > 20) {
      return { uid: 'legacy', email: 'legacy', sessionId: typeof data.sessionId === 'string' ? data.sessionId : '' };
    }
    fail('unauthenticated', 'Masuk dengan email panitia terlebih dahulu.');
  }

  const email = (user.token?.email || '').toLowerCase();
  if (allowedOrganizerEmails.size && !allowedOrganizerEmails.has(email)) {
    fail('permission-denied', 'Email Anda tidak memiliki akses panitia.');
  }

  return { uid: user.uid, email, sessionId: typeof data.sessionId === 'string' ? data.sessionId : '' };
}

function sessionRef(id) {
  if (typeof id !== 'string' || !id || id.length > 150) fail('invalid-argument', 'Sesi acara tidak valid.');
  return db.collection('sessions').doc(id);
}

function participantRef(sessionId, id) {
  if (typeof id !== 'string' || !id || id.length > 150) fail('invalid-argument', 'ID peserta tidak valid.');
  return sessionRef(sessionId).collection('participants').doc(id);
}

async function organizerData(data, request) {
  const auth = await organizer(data, request);
  let sessionId = auth.sessionId;
  let sessionSnap = sessionId ? await sessionRef(sessionId).get() : null;

  if (!sessionSnap?.exists) {
    const fallback = await db.collection('sessions').limit(1).get();
    if (!fallback.empty) {
      sessionId = fallback.docs[0].id;
      sessionSnap = fallback.docs[0];
    }
  }

  if (!sessionSnap?.exists) {
    return { sessionId: '', event: null, participants: [], prizes: [], results: [], config: {}, stats: {} };
  }

  const eventRef = sessionSnap.ref.collection('meta').doc('event');
  const [eventSnap, participantsSnap, prizesSnap, resultsSnap, configSnap] = await Promise.all([
    eventRef.get(),
    sessionSnap.ref.collection('participants').get(),
    sessionSnap.ref.collection('prizes').get(),
    sessionSnap.ref.collection('results').get(),
    sessionSnap.ref.collection('meta').doc('config').get()
  ]);

  const participants = participantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const prizes = prizesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const results = resultsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const event = eventSnap.exists ? { id: eventSnap.id, ...eventSnap.data() } : null;
  const config = configSnap.exists ? configSnap.data() : {};

  return {
    sessionId,
    event,
    participants,
    prizes,
    results,
    config,
    stats: {
      totalParticipants: participants.length,
      totalPrizes: prizes.length,
      totalResults: results.length
    }
  };
}

async function createEvent(data, request) {
  const auth = await organizer(data, request);
  const name = clean(data.name);
  if (!name) fail('invalid-argument', 'Nama acara wajib diisi.');

  let sessionId = auth.sessionId || randomToken();
  const sessionDoc = sessionRef(sessionId);
  const existing = await sessionDoc.get();
  if (!existing.exists) {
    await sessionDoc.set({
      createdAt: FieldValue.serverTimestamp(),
      owner: auth.uid,
      ownerEmail: auth.email,
      status: 'active',
      eventId: sessionId
    });
  }

  await sessionDoc.collection('meta').doc('event').set({
    id: sessionId,
    name,
    date: data.date || '',
    status: data.status || 'active',
    logoUrl: data.logoUrl || '',
    description: data.description || '',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, sessionId };
}

async function addParticipant(data, request) {
  const auth = await organizer(data, request);
  const name = clean(data.name);
  const quota = Number(data.spinQuota || 1);
  if (!name || !Number.isInteger(quota) || quota < 1 || quota > 100) fail('invalid-argument', 'Data peserta tidak valid.');

  const targetSession = sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '');
  if (!await targetSession.get().then(s => s.exists)) {
    fail('not-found', 'Buat acara terlebih dahulu.');
  }

  const participant = {
    name,
    registration: clean(data.registration),
    spinQuota: quota,
    spinsUsed: 0,
    status: 'active',
    qrActive: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  const doc = targetSession.collection('participants').doc();
  await doc.set(participant);
  return { ok: true, participantId: doc.id };
}

async function updateParticipant(data, request) {
  const auth = await organizer(data, request);
  const name = clean(data.name);
  const quota = Number(data.spinQuota || 1);
  if (!name || !Number.isInteger(quota) || quota < 1 || quota > 100) fail('invalid-argument', 'Data peserta tidak valid.');

  const ref = participantRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '', data.participantId);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'Peserta tidak ditemukan.');

  await ref.update({
    name,
    registration: clean(data.registration),
    spinQuota: quota,
    status: data.status || snap.get('status') || 'active',
    updatedAt: FieldValue.serverTimestamp()
  });

  return { ok: true };
}

async function deleteParticipant(data, request) {
  const auth = await organizer(data, request);
  const ref = participantRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '', data.participantId);
  await ref.delete();
  return { ok: true };
}

async function addPrize(data, request) {
  const auth = await organizer(data, request);
  const name = clean(data.name);
  const stock = Number(data.stock || 1);
  if (!name || !Number.isInteger(stock) || stock < 0 || stock > 100000) fail('invalid-argument', 'Data hadiah tidak valid.');

  const targetSession = sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '');
  const ref = targetSession.collection('prizes').doc();
  await ref.set({
    name,
    stock,
    remaining: stock,
    category: clean(data.category) || 'Umum',
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { ok: true, prizeId: ref.id };
}

async function updatePrize(data, request) {
  const auth = await organizer(data, request);
  const name = clean(data.name);
  const stock = Number(data.stock || 1);
  if (!name || !Number.isInteger(stock) || stock < 0 || stock > 100000) fail('invalid-argument', 'Data hadiah tidak valid.');

  const ref = sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '').collection('prizes').doc(data.prizeId);
  const snap = await ref.get();
  if (!snap.exists) fail('not-found', 'Hadiah tidak ditemukan.');

  await ref.update({
    name,
    stock,
    remaining: Math.max(0, Number(snap.get('remaining') ?? stock)),
    category: clean(data.category) || snap.get('category') || 'Umum',
    updatedAt: FieldValue.serverTimestamp()
  });
  return { ok: true };
}

async function deletePrize(data, request) {
  const auth = await organizer(data, request);
  await sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '').collection('prizes').doc(data.prizeId).delete();
  return { ok: true };
}

async function updateConfig(data, request) {
  const auth = await organizer(data, request);
  const targetSession = sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '');
  await targetSession.collection('meta').doc('config').set(data.config || {}, { merge: true });
  return { ok: true };
}

async function generateQrs(data, request) {
  const auth = await organizer(data, request);
  const session = sessionRef(auth.sessionId || (await db.collection('sessions').limit(1).get()).docs[0]?.id || '');
  const participants = await session.collection('participants').get();
  const items = participants.docs.map(doc => ({
    participantId: doc.id,
    name: doc.get('name') || 'Peserta',
    url: `${process.env.PUBLIC_URL || 'https://example.com'}?session=${encodeURIComponent(auth.sessionId || '')}&token=${randomToken()}`
  }));
  return { items };
}

async function login(data, request) {
  const user = request?.auth;
  if (!user || !user.uid) fail('unauthenticated', 'Masuk dengan email panitia terlebih dahulu.');
  const email = (user.token?.email || '').toLowerCase();
  if (allowedOrganizerEmails.size && !allowedOrganizerEmails.has(email)) fail('permission-denied', 'Email Anda tidak memiliki akses panitia.');
  return { ok: true, email };
}

exports.spinKuApi = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const data = request.data || {};
  try {
    switch (data.action) {
      case 'organizerLogin':
        return await login(data, request);
      case 'organizerData':
        return await organizerData(data, request);
      case 'createEvent':
        return await createEvent(data, request);
      case 'addParticipant':
        return await addParticipant(data, request);
      case 'updateParticipant':
        return await updateParticipant(data, request);
      case 'deleteParticipant':
        return await deleteParticipant(data, request);
      case 'addPrize':
        return await addPrize(data, request);
      case 'updatePrize':
        return await updatePrize(data, request);
      case 'deletePrize':
        return await deletePrize(data, request);
      case 'updateConfig':
        return await updateConfig(data, request);
      case 'generateQrs':
        return await generateQrs(data, request);
      default:
        return { ok: true };
    }
  } catch (error) {
    throw error;
  }
});

