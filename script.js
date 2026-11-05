import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBFPwP-pGKlcFwy5y-UMymTv27TbyVM9VY',
  authDomain: 'spinnerr-5f5f8.firebaseapp.com',
  projectId: 'spinnerr-5f5f8',
  appId: '1:577006432352:web:3b3b6e0e532757fe8ed305'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const labels = {
  dashboard: 'Dashboard', event: 'Pengaturan acara', participants: 'Manajemen peserta',
  prizes: 'Manajemen hadiah', spinner: 'Pengaturan spinner', qrs: 'QR Code peserta',
  results: 'Hasil undian', history: 'Riwayat pemenang'
};
const state = {
  user: null,
  email: localStorage.getItem('spinkuOrganizerEmail') || '',
  token: '',
  sessionId: new URLSearchParams(location.search).get('session') || '',
  page: labels[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard',
  event: null,
  participants: [],
  prizes: [],
  results: [],
  config: {},
  qrItems: [],
  busy: false
};
let auth;
let spinKuApi;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function notice(message, type = 'info', persistent = false) {
  const node = $('#notice');
  if (!node) return;
  node.textContent = message;
  node.className = `notice ${type}`;
  clearTimeout(notice.timer);
  if (!persistent) notice.timer = setTimeout(() => node.classList.add('hidden'), 12000);
}

function describeError(error) {
  const code = error?.code ? ` (${error.code})` : '';
  return `${error?.message || 'Terjadi kesalahan yang tidak diketahui.'}${code}`;
}

function call(action, payload = {}) {
  if (!spinKuApi) return Promise.reject(new Error('Firebase Functions belum siap. Muat ulang halaman dan coba lagi.'));
  return spinKuApi({ action, sessionId: state.sessionId, ...payload }).then(result => result.data);
}

function openLoginModal() {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><form class="modal" id="loginForm">
    <h2>Masuk sebagai panitia</h2>
    <p>Masukkan email panitia. Link login akan dikirim ke email tersebut.</p>
    <div class="field full"><label for="organizerEmailInput">Email panitia</label>
      <input id="organizerEmailInput" name="email" type="email" value="${escapeHtml(state.email)}" placeholder="panitia@domain.com" autocomplete="email" required /></div>
    <div class="modal-actions"><button type="button" class="button outline" data-close>Batalkan</button>
      <button type="submit" class="button primary">Kirim link login</button></div>
  </form></div>`;
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    const email = new FormData(event.currentTarget).get('email').trim();
    submit.disabled = true;
    try {
      if (!auth) throw new Error('Firebase Authentication belum terinisialisasi.');
      await sendSignInLinkToEmail(auth, email, {
        url: `${location.origin}${location.pathname}`,
        handleCodeInApp: true
      });
      state.email = email;
      localStorage.setItem('spinkuOrganizerEmail', email);
      root.innerHTML = '';
      notice(`Link login dikirim ke ${email}. Buka link tersebut untuk menyelesaikan login.`, 'success', true);
    } catch (error) {
      notice(`Gagal mengirim link login: ${describeError(error)}`, 'error', true);
      submit.disabled = false;
    }
  });
  root.querySelector('[data-close]').addEventListener('click', () => { root.innerHTML = ''; });
}

async function finishEmailLink() {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  let email = localStorage.getItem('spinkuOrganizerEmail') || '';
  if (!email) {
    email = window.prompt('Masukkan kembali email yang menerima link login:') || '';
  }
  email = email.trim();
  if (!email) {
    notice('Login belum selesai: email yang menerima link diperlukan. Buka link lagi dan masukkan email tersebut.', 'error', true);
    return;
  }
  try {
    const result = await signInWithEmailLink(auth, email, location.href);
    state.email = result.user.email || email;
    localStorage.setItem('spinkuOrganizerEmail', state.email);
    const cleanUrl = new URL(location.href);
    for (const key of ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl']) cleanUrl.searchParams.delete(key);
    history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    notice('Login berhasil. Memuat data panitia…', 'success', true);
  } catch (error) {
    notice(`Login gagal: ${describeError(error)}. Minta link baru jika link sudah pernah digunakan atau kedaluwarsa.`, 'error', true);
  }
}

function setPage(page) {
  if (!labels[page]) return;
  state.page = page;
  history.replaceState(null, '', `#${page}`);
  render();
}

function formatDate(value) {
  if (!value) return 'Belum ditentukan';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Belum ditentukan' : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date);
}

function renderWelcome() {
  $('#pageContent').innerHTML = `<div class="page-heading"><div><h1>Selamat datang di SpinKu</h1>
    <p>Kelola acara lucky draw dan doorprize dari satu tempat.</p></div>
    <button class="button primary" data-action="login">Masuk sebagai panitia</button></div>
    <div class="card event-summary"><span class="eyebrow">LUCKY DRAW & DOORPRIZE</span>
      <h2>Undian yang aman, cepat, dan terlindungi.</h2>
      <p>Masuk dengan link email panitia untuk mengelola acara.</p>
      <button class="button secondary" data-action="login">Mulai login email</button></div>`;
}

function renderDashboard() {
  return `<div class="page-heading"><div><h1>Dashboard</h1><p>Ringkasan acara dan aktivitas undian.</p></div>
    <button class="button primary" data-page="event">Buat / ubah acara</button></div>
    <div class="stats-grid"><div class="stat-card"><div class="stat-top">Peserta terdaftar</div><div class="stat-value">${state.participants.length}</div></div>
    <div class="stat-card"><div class="stat-top">Total hadiah</div><div class="stat-value">${state.prizes.length}</div></div>
    <div class="stat-card"><div class="stat-top">Total hasil</div><div class="stat-value">${state.results.length}</div></div></div>
    <div class="card event-summary"><span class="eyebrow">ACARA AKTIF</span><h2>${escapeHtml(state.event?.name || 'Belum ada acara')}</h2>
    <p>${escapeHtml(state.event?.description || 'Buat atau ubah acara untuk memulai.')}</p><p>${formatDate(state.event?.date)}</p></div>`;
}

function renderEvent() {
  const event = state.event || {};
  return `<div class="page-heading"><div><h1>Pengaturan acara</h1><p>Atur informasi acara.</p></div>
    <button class="button primary" data-action="save-event">Simpan acara</button></div><div class="card"><form id="eventForm" class="form-grid">
    <div class="field full"><label>Nama acara</label><input name="name" value="${escapeHtml(event.name || '')}" required /></div>
    <div class="field"><label>Tanggal</label><input name="date" type="date" value="${escapeHtml(event.date || '')}" /></div>
    <div class="field"><label>Status</label><select name="status"><option value="active" ${event.status !== 'closed' ? 'selected' : ''}>Aktif</option><option value="closed" ${event.status === 'closed' ? 'selected' : ''}>Ditutup</option></select></div>
    <div class="field full"><label>URL logo (opsional)</label><input name="logoUrl" type="url" value="${escapeHtml(event.logoUrl || '')}" /></div>
    <div class="field full"><label>Deskripsi</label><textarea name="description">${escapeHtml(event.description || '')}</textarea></div></form></div>`;
}

function renderParticipants() {
  const rows = state.participants.map(person => `<tr><td>${escapeHtml(person.name || '')}</td><td>${escapeHtml(person.registration || '')}</td>
    <td>${Number(person.spinsUsed || 0)} / ${Number(person.spinQuota || 1)}</td><td><button class="small-action" data-action="edit-participant" data-id="${escapeHtml(person.id)}">Edit</button>
    <button class="small-action" data-action="delete-participant" data-id="${escapeHtml(person.id)}">Hapus</button></td></tr>`).join('');
  return `<div class="page-heading"><div><h1>Manajemen peserta</h1><p>Tambah, ubah, atau hapus peserta.</p></div></div>
    <div class="card"><form id="participantForm" class="form-grid"><div class="field"><label>Nama</label><input name="name" required /></div>
    <div class="field"><label>No. registrasi</label><input name="registration" /></div><div class="field"><label>Kuota spin</label><input name="spinQuota" type="number" min="1" value="1" /></div>
    <button class="button primary" type="submit">Tambah peserta</button></form></div><div class="card table-card"><div class="table-wrap"><table><thead><tr><th>Nama</th><th>No. registrasi</th><th>Spin</th><th>Aksi</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-state">Belum ada peserta.</td></tr>'}</tbody></table></div></div>`;
}

function renderPrizes() {
  const rows = state.prizes.map(prize => `<tr><td>${escapeHtml(prize.name || '')}</td><td>${escapeHtml(prize.category || 'Umum')}</td><td>${Number(prize.remaining ?? prize.stock ?? 0)}</td>
    <td><button class="small-action" data-action="edit-prize" data-id="${escapeHtml(prize.id)}">Edit</button><button class="small-action" data-action="delete-prize" data-id="${escapeHtml(prize.id)}">Hapus</button></td></tr>`).join('');
  return `<div class="page-heading"><div><h1>Manajemen hadiah</h1><p>Atur nama, kategori, dan stok hadiah.</p></div></div>
    <div class="card"><form id="prizeForm" class="form-grid"><div class="field"><label>Nama hadiah</label><input name="name" required /></div>
    <div class="field"><label>Kategori</label><input name="category" value="Umum" /></div><div class="field"><label>Stok</label><input name="stock" type="number" min="0" value="1" /></div>
    <button class="button primary" type="submit">Tambah hadiah</button></form></div><div class="card table-card"><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kategori</th><th>Stok tersedia</th><th>Aksi</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-state">Belum ada hadiah.</td></tr>'}</tbody></table></div></div>`;
}

function renderSpinner() {
  const config = state.config || {};
  return `<div class="page-heading"><div><h1>Pengaturan spinner</h1><p>Pengaturan tampilan dan kuota default.</p></div><button class="button primary" data-action="save-config">Simpan pengaturan</button></div>
    <div class="card form-grid"><div class="field"><label>Mode</label><select id="spinMode"><option value="wheel" ${config.mode !== 'slot' ? 'selected' : ''}>Wheel spin</option><option value="slot" ${config.mode === 'slot' ? 'selected' : ''}>Slot / reel</option></select></div>
    <div class="field"><label>Durasi (detik)</label><input id="spinDuration" type="number" min="3" max="30" value="${Number(config.duration || 5)}" /></div>
    <div class="field"><label>Kuota spin default</label><input id="defaultQuota" type="number" min="1" value="${Number(config.defaultQuota || 1)}" /></div>
    <label><input id="soundToggle" type="checkbox" ${config.sound ? 'checked' : ''}/> Suara</label><label><input id="confettiToggle" type="checkbox" ${config.confetti !== false ? 'checked' : ''}/> Konfetti</label></div>`;
}

function renderQrs() {
  const items = state.qrItems.map(item => `<div class="qr-card"><strong>${escapeHtml(item.name || 'Peserta')}</strong><p><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Buka link peserta</a></p><code>${escapeHtml(item.url)}</code></div>`).join('');
  return `<div class="page-heading"><div><h1>QR Code peserta</h1><p>Buat link peserta berdasarkan daftar peserta.</p></div><button class="button primary" data-action="generate-qrs">Buat link peserta</button></div>
    <div class="card"><div class="qr-grid">${items || '<p class="empty-state">Belum ada link. Pastikan peserta sudah ditambahkan.</p>'}</div></div>`;
}

function renderResults() {
  const rows = state.results.map(result => `<tr><td>${formatDate(result.createdAt)}</td><td>${escapeHtml(result.participantName || 'Peserta')}</td><td>${escapeHtml(result.prizeName || 'Tidak ada')}</td></tr>`).join('');
  return `<div class="page-heading"><div><h1>${state.page === 'history' ? 'Riwayat pemenang' : 'Hasil undian'}</h1><p>Data hasil yang tercatat.</p></div></div>
    <div class="card table-card"><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Peserta</th><th>Hadiah</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="empty-state">Belum ada hasil.</td></tr>'}</tbody></table></div></div>`;
}

function render() {
  const button = $('#organizerButton');
  if (button) button.textContent = state.user ? `Keluar (${state.user.email || 'panitia'})` : 'Masuk panitia';
  const content = $('#pageContent');
  if (!state.user) {
    renderWelcome();
    return;
  }
  const views = { dashboard: renderDashboard, event: renderEvent, participants: renderParticipants,
    prizes: renderPrizes, spinner: renderSpinner, qrs: renderQrs, results: renderResults, history: renderResults };
  content.innerHTML = (views[state.page] || renderDashboard)();
  const crumb = $('#pageCrumb');
  if (crumb) crumb.textContent = labels[state.page] || 'Dashboard';
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === state.page));
}

async function refreshAll() {
  if (!state.user) return;
  try {
    const data = await call('organizerData');
    state.sessionId = data.sessionId || state.sessionId;
    state.event = data.event || null;
    state.participants = data.participants || [];
    state.prizes = data.prizes || [];
    state.results = data.results || [];
    state.config = data.config || {};
    render();
    notice('Login aktif dan data berhasil dimuat.', 'success');
  } catch (error) {
    // Keep the Firebase session; a backend/deployment error must not look like a logout.
    render();
    notice(`Login berhasil, tetapi data/fitur belum dapat dimuat: ${describeError(error)}. Periksa deployment Cloud Functions dan konfigurasi Firebase.`, 'error', true);
  }
}

async function submitForm(form, action, successMessage) {
  const submit = form.querySelector('[type=submit]');
  if (submit) submit.disabled = true;
  try {
    await call(action, Object.fromEntries(new FormData(form).entries()));
    await refreshAll();
    notice(successMessage, 'success');
  } catch (error) {
    notice(describeError(error), 'error', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleClick(event) {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    if (!state.user) return openLoginModal();
    return setPage(pageButton.dataset.page);
  }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;
  if (action === 'login') return openLoginModal();
  if (action === 'save-event') {
    const form = $('#eventForm');
    if (form?.reportValidity()) await submitForm(form, 'createEvent', 'Acara berhasil disimpan.');
  } else if (action === 'save-config') {
    try {
      await call('updateConfig', { config: { mode: $('#spinMode').value, duration: Number($('#spinDuration').value), defaultQuota: Number($('#defaultQuota').value), sound: $('#soundToggle').checked, confetti: $('#confettiToggle').checked } });
      await refreshAll();
      notice('Pengaturan berhasil disimpan.', 'success');
    } catch (error) { notice(describeError(error), 'error', true); }
  } else if (action === 'generate-qrs') {
    try {
      const result = await call('generateQrs');
      state.qrItems = result.items || [];
      render();
      notice(state.qrItems.length ? 'Link peserta berhasil dibuat.' : 'Tidak ada peserta untuk dibuatkan link.', state.qrItems.length ? 'success' : 'info');
    } catch (error) { notice(describeError(error), 'error', true); }
  } else if (action === 'edit-participant') {
    const person = state.participants.find(item => item.id === id);
    if (!person) return;
    const name = prompt('Nama peserta:', person.name || '');
    if (name === null) return;
    const registration = prompt('Nomor registrasi:', person.registration || '');
    if (registration === null) return;
    const spinQuota = prompt('Kuota spin:', String(person.spinQuota || 1));
    if (spinQuota === null) return;
    try { await call('updateParticipant', { participantId: id, name, registration, spinQuota }); await refreshAll(); }
    catch (error) { notice(describeError(error), 'error', true); }
  } else if (action === 'delete-participant' || action === 'delete-prize') {
    if (!confirm('Yakin ingin menghapus data ini?')) return;
    try { await call(action, { [action === 'delete-participant' ? 'participantId' : 'prizeId']: id }); await refreshAll(); }
    catch (error) { notice(describeError(error), 'error', true); }
  } else if (action === 'edit-prize') {
    const prize = state.prizes.find(item => item.id === id);
    if (!prize) return;
    const name = prompt('Nama hadiah:', prize.name || '');
    if (name === null) return;
    const category = prompt('Kategori:', prize.category || 'Umum');
    if (category === null) return;
    const stock = prompt('Stok:', String(prize.stock ?? 1));
    if (stock === null) return;
    try { await call('updatePrize', { prizeId: id, name, category, stock }); await refreshAll(); }
    catch (error) { notice(describeError(error), 'error', true); }
  }
}

async function start() {
  try {
    const app = getApps().find(item => item.name === '[DEFAULT]') || initializeApp(firebaseConfig);
    auth = getAuth(app);
    spinKuApi = httpsCallable(getFunctions(app, 'us-central1'), 'spinKuApi');
    await setPersistence(auth, browserLocalPersistence);
    onAuthStateChanged(auth, async user => {
      state.user = user;
      state.email = user?.email || state.email;
      if (user) {
        try { state.token = await user.getIdToken(); } catch { state.token = ''; }
        if (state.email) localStorage.setItem('spinkuOrganizerEmail', state.email);
        await refreshAll();
      } else {
        state.token = '';
        render();
      }
    }, error => notice(`Status login Firebase gagal dibaca: ${describeError(error)}`, 'error', true));
    await finishEmailLink();
  } catch (error) {
    notice(`Firebase gagal diinisialisasi: ${describeError(error)}`, 'error', true);
  }
}

$('#pageContent').addEventListener('click', handleClick);
$('#modalRoot').addEventListener('click', event => {
  if (event.target.matches('[data-close]')) $('#modalRoot').innerHTML = '';
});
$('#pageContent').addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'participantForm') await submitForm(event.target, 'addParticipant', 'Peserta berhasil ditambahkan.');
  if (event.target.id === 'prizeForm') await submitForm(event.target, 'addPrize', 'Hadiah berhasil ditambahkan.');
});
$('#organizerButton')?.addEventListener('click', async () => {
  if (!state.user) return openLoginModal();
  try { await signOut(auth); notice('Sesi panitia ditutup.', 'success'); }
  catch (error) { notice(`Gagal keluar: ${describeError(error)}`, 'error', true); }
});
$('#topAccess')?.addEventListener('click', () => state.user ? refreshAll() : openLoginModal());
$('#menuToggle')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (labels[page]) { state.page = page; render(); }
});

render();
start();
