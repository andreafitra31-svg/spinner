import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import {
  getAuth,
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
const query = new URLSearchParams(location.search);
const state = {
  user: null,
  organizerToken: '',
  organizerEmail: localStorage.getItem('spinkuOrganizerEmail') || '',
  sessionId: query.get('session') || '',
  event: null,
  page: 'dashboard',
  participants: [],
  prizes: [],
  results: [],
  config: {},
  participant: null,
  participantToken: query.get('token') || '',
  busy: false,
  qrItems: [],
  stats: {},
  pendingSpinKey: ''
};

const labels = {
  dashboard: 'Dashboard',
  event: 'Pengaturan acara',
  participants: 'Manajemen peserta',
  prizes: 'Manajemen hadiah',
  spinner: 'Pengaturan spinner',
  qrs: 'QR Code peserta',
  results: 'Hasil undian',
  history: 'Riwayat pemenang'
};

let apiCall;
let auth;

function showNotice(message, type = 'info') {
  const node = $('#notice');
  node.textContent = message;
  node.className = `notice ${type}`;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => node.classList.add('hidden'), 2500);
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dateText(value) {
  if (!value) return 'Belum ditentukan';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Belum ditentukan' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function timeText(value) {
  if (!value) return 'Baru saja';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Baru saja' : new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function call(action, data = {}) {
  if (!apiCall) return Promise.reject(new Error('Konfigurasi Firebase belum diisi.'));
  return apiCall({
    action,
    organizerToken: state.organizerToken,
    authToken: state.organizerToken,
    sessionId: state.sessionId,
    ...data
  }).then(result => result?.data ?? result);
}

function requireAccess() {
  if (!state.user) {
    openAccessModal();
    return false;
  }
  return true;
}

function openModal(title, description, body, onSubmit, submitLabel = 'Simpan') {
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="modalForm">
        <h2>${title}</h2>
        <p>${description}</p>
        ${body}
        <div class="modal-actions">
          <button type="button" class="button outline" data-close>Batalkan</button>
          <button type="submit" class="button primary">${submitLabel}</button>
        </div>
      </form>
    </div>
  `;
  $('#modalForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await onSubmit(form, e.currentTarget);
      root.innerHTML = '';
    } catch (error) {
      showNotice(error.message, 'error');
    }
  };
  root.querySelector('[data-close]').onclick = () => (root.innerHTML = '');
}

async function sendOrganizerLoginLink(email) {
  if (!email) throw new Error('Email panitia wajib diisi.');
  const actionCodeSettings = {
    url: `${location.origin}${location.pathname}`,
    handleCodeInApp: true
  };
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  localStorage.setItem('spinkuOrganizerEmail', email);
  showNotice(`Tautan login telah dikirim ke ${email}. Silakan cek inbox Anda.`, 'success');
}

async function completeEmailLogin() {
  if (!auth || !isSignInWithEmailLink(auth, window.location.href)) return false;
  const email = localStorage.getItem('spinkuOrganizerEmail');
  if (!email) {
    showNotice('Email panitia tidak ditemukan. Silakan masuk ulang.', 'error');
    return false;
  }
  try {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    state.user = result.user;
    localStorage.setItem('spinkuOrganizerEmail', email);
    showNotice(`Login panitia berhasil untuk ${email}.`, 'success');
    history.replaceState(null, '', location.pathname + location.search.replace(/[?&]mode=signIn[^&]*/g, ''));
    return true;
  } catch (error) {
    showNotice(error.message, 'error');
    return false;
  }
}

function openAccessModal() {
  openModal(
    'Akses panitia',
    'Masukkan email panitia untuk menerima link login tanpa password.',
    `<div class="field"><label>Email panitia</label><input name="email" type="email" value="${esc(state.organizerEmail)}" placeholder="panitia@domain.com" required /></div>`,
    async (form) => {
      const email = (form.get('email') || '').trim();
      await sendOrganizerLoginLink(email);
    },
    'Kirim link login'
  );
}

function setPage(page) {
  state.page = page;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('#pageCrumb').textContent = labels[page] || page;
  history.replaceState(null, '', `#${page}`);
  render();
}

function renderWelcome() {
  $('#pageContent').innerHTML = `
    <div class="page-heading">
      <div>
        <h1>Selamat datang di SpinKu</h1>
        <p>Kelola acara lucky draw dan doorprize dari satu tempat.</p>
      </div>
      <button class="button primary" data-action="organizer-login">Masuk sebagai panitia</button>
    </div>
    <div class="card event-summary">
      <span class="eyebrow">LUCKY DRAW & DOORPRIZE</span>
      <h2>Undian yang aman, cepat, dan terlindungi.</h2>
      <p>Semua hasil undian ditentukan secara server-side dengan otentikasi email panitia.</p>
      <button class="button secondary" data-action="organizer-login">Mulai login email</button>
    </div>
  `;
  bindPageActions();
}

function renderDashboard() {
  const count = state.participants.length;
  const stock = state.prizes.reduce((n, p) => n + Number(p.remaining ?? p.stock ?? 0), 0);
  const winners = state.results.filter(r => r.prizeName && r.prizeName !== 'Terima kasih').length;
  const recent = state.results.slice(0, 5);
  return `
    <div class="page-heading">
      <div><h1>Dashboard</h1><p>Ringkasan aktivitas acara dan undian.</p></div>
      <button class="button primary" data-action="new-event">Buat acara</button>
    </div>
    <div class="stats-grid">
      ${stat('Peserta terdaftar', count, '♙', 'Semua peserta')}
      ${stat('Total hadiah', state.prizes.length, '◇', `${stock} unit tersedia`)}
      ${stat('Total spin', state.results.length, '◉', 'Spin tercatat')}
      ${stat('Pemenang', winners, '✦', 'Hadiah telah dibagikan')}
    </div>
    <div class="dashboard-grid">
      <div class="card event-summary">
        <span class="eyebrow">ACARA AKTIF</span>
        <h2>${esc(state.event?.name || 'Belum ada acara')}</h2>
        <p>${esc(state.event?.description || 'Buat acara, tambahkan peserta, dan mulai undian.')}</p>
        <p>📅 ${dateText(state.event?.date)} · ${state.event?.status === 'closed' ? 'Ditutup' : 'Aktif'}</p>
        <button class="button secondary" data-page="event">Pengaturan acara</button>
      </div>
      <div class="card">
        <div class="card-header">
          <h2>Aktivitas terbaru</h2>
        </div>
        <div class="activity-list">
          ${recent.length ? recent.map(r => `
            <div class="activity-item">
              <span class="activity-avatar">${esc((r.participantName || 'P').slice(0, 1).toUpperCase())}</span>
              <div class="activity-text">
                <strong>${esc(r.participantName || 'Peserta')}</strong>
                <small>${esc(r.prizeName || 'Hadiah')} · ${timeText(r.createdAt)}</small>
              </div>
              <span class="prize-tag">${esc(r.prizeName || 'Hadiah')}</span>
            </div>
          `).join('') : '<div class="empty-state">Belum ada aktivitas spin.</div>'}
        </div>
      </div>
    </div>
  `;
}

function stat(title, value, icon, note) {
  return `<div class="stat-card"><div class="stat-top">${title}<span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
}

function renderEvent() {
  const e = state.event || {};
  return `
    <div class="page-heading"><div><h1>Pengaturan acara</h1><p>Atur identitas acara dan status sesi undian.</p></div><button class="button primary" data-action="save-event">${e.id ? 'Simpan perubahan' : 'Buat acara'}</button></div>
    <div class="settings-layout">
      <div class="card">
        <div class="card-header"><h2>Informasi acara</h2></div>
        <form id="eventForm" class="form-grid">
          <div class="field full"><label>Nama acara</label><input name="name" value="${esc(e.name || '')}" placeholder="Contoh: Gathering Tahunan 2025" required /></div>
          <div class="field"><label>Tanggal acara</label><input name="date" type="date" value="${esc(e.date || '')}" /></div>
          <div class="field"><label>Status acara</label><select name="status"><option value="active" ${e.status === 'active' ? 'selected' : ''}>Aktif</option><option value="closed" ${e.status === 'closed' ? 'selected' : ''}>Ditutup</option></select></div>
          <div class="field full"><label>URL logo acara (opsional)</label><input name="logoUrl" type="url" value="${esc(e.logoUrl || '')}" placeholder="https://..." /></div>
          <div class="field full"><label>Deskripsi</label><textarea name="description" placeholder="Ceritakan acara Anda">${esc(e.description || '')}</textarea></div>
        </form>
      </div>
      <div class="card">
        <div class="card-header"><h2>Sesi undian</h2></div>
        <p class="subtle">Status sesi undian akan ditentukan oleh server. Semua hasil diproses aman di backend.</p>
        <div class="code-note">Backend mengikuti otentikasi email panitia aktif. Data undian disimpan di Firestore dan tidak dibuka dari browser.</div>
      </div>
    </div>
  `;
}

function renderParticipants() {
  const rows = state.participants || [];
  return `
    <div class="page-heading"><div><h1>Manajemen peserta</h1><p>Kelola peserta dan kuota spin mereka.</p></div><button class="button primary" data-action="add-participant">Tambah peserta</button></div>
    <div class="card table-card">
      <div class="table-tools"><input class="search" id="participantSearch" placeholder="Cari nama atau nomor registrasi" /><div><button class="button outline" data-action="import-csv">Impor CSV</button> <button class="button outline" data-action="export-participants">Ekspor CSV</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>NAMA PESERTA</th><th>NO. REGISTRASI</th><th>STATUS</th><th>SPIN</th><th>QR</th><th>AKSI</th></tr></thead><tbody id="participantRows">${participantRows(rows)}</tbody></table></div>
    </div>
  `;
}

function participantRows(rows) {
  if (!rows.length) return `<tr><td colspan="6" class="empty-state">Belum ada peserta. Tambahkan satu data baru.</td></tr>`;
  return rows.map(p => `
    <tr data-search="${esc(`${p.name} ${p.registration || ''}`.toLowerCase())}">
      <td><strong>${esc(p.name || '')}</strong></td>
      <td>${esc(p.registration || '')}</td>
      <td><span class="status-label ${p.status === 'inactive' ? 'off' : ''}">${p.status === 'inactive' ? 'Nonaktif' : 'Aktif'}</span></td>
      <td>${Number(p.spinsUsed || 0)} / ${Number(p.spinQuota || 0)}</td>
      <td><span class="status-label ${p.qrActive ? '' : 'off'}">${p.qrActive ? 'Siap' : 'Nonaktif'}</span></td>
      <td><div class="row-actions"><button class="small-action" data-action="edit-participant" data-id="${esc(p.id || '')}">Edit</button><button class="small-action" data-action="delete-participant" data-id="${esc(p.id || '')}">Hapus</button></div></td>
    </tr>
  `).join('');
}

function renderPrizes() {
  return `
    <div class="page-heading"><div><h1>Manajemen hadiah</h1><p>Atur hadiah dan pantau stok yang tersedia.</p></div><button class="button primary" data-action="add-prize">Tambah hadiah</button></div>
    <div class="card table-card">
      <div class="table-wrap"><table><thead><tr><th>NAMA HADIAH</th><th>KATEGORI</th><th>STOK</th><th>TERSEDIA</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${state.prizes.length ? state.prizes.map(p => `
        <tr><td><strong>${esc(p.name || '')}</strong></td><td>${esc(p.category || 'Umum')}</td><td>${Number(p.stock || 0)}</td><td><strong>${Number(p.remaining ?? p.stock ?? 0)}</strong></td><td><span class="status-label ${p.active === false ? 'off' : ''}">${p.active === false ? 'Nonaktif' : 'Tersedia'}</span></td><td><div class="row-actions"><button class="small-action" data-action="edit-prize" data-id="${esc(p.id || '')}">Edit</button><button class="small-action" data-action="delete-prize" data-id="${esc(p.id || '')}">Hapus</button></div></td></tr>
      `).join('') : '<tr><td colspan="6" class="empty-state">Belum ada hadiah.</td></tr>'}</tbody></table></div>
    </div>
  `;
}

function renderSpinner() {
  const c = state.config || {};
  return `
    <div class="page-heading"><div><h1>Pengaturan spinner</h1><p>Atur pengalaman spin peserta. Hadiah tetap dipilih oleh server.</p></div><button class="button primary" data-action="save-spinner">Simpan pengaturan</button></div>
    <div class="settings-layout">
      <div class="card">
        <div class="card-header"><h2>Template undian</h2></div>
        <div class="form-grid">
          <div class="field"><label>Mode spinner</label><select id="spinMode"><option value="wheel" ${c.mode === 'wheel' ? 'selected' : ''}>Wheel spin</option><option value="slot" ${c.mode === 'slot' ? 'selected' : ''}>Slot / reel spin</option></select></div>
          <div class="field"><label>Durasi animasi (detik)</label><select id="spinDuration">${[3,4,5,6,8,10].map(n => `<option value="${n}" ${Number(c.duration || 5) === n ? 'selected' : ''}>${n} detik</option>`).join('')}</select></div>
          <div class="field full"><label>Kuota spin default</label><select id="defaultQuota">${[1,2,3,5].map(n => `<option value="${n}" ${Number(c.defaultQuota || 1) === n ? 'selected' : ''}>${n} kali</option>`).join('')}</select></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h2>Fitur tambahan</h2></div>
        <div class="toggle-row"><div><strong>Suara</strong><small>Suara saat animasi berputar</small></div><input id="soundToggle" type="checkbox" ${c.sound ? 'checked' : ''} /></div>
        <div class="toggle-row"><div><strong>Konfetti</strong><small>Rayakan hasil kemenangan</small></div><input id="confettiToggle" type="checkbox" ${c.confetti !== false ? 'checked' : ''} /></div>
      </div>
    </div>
  `;
}

function renderQrs() {
  return `
    <div class="page-heading"><div><h1>QR Code peserta</h1><p>Buat QR token khusus agar peserta langsung menuju halaman spin.</p></div><button class="button primary" data-action="generate-qrs">Buat / perbarui QR</button></div>
    <div class="card">
      <div class="card-header"><h2>QR peserta</h2></div>
      <p class="subtle">Token QR disimpan di Firestore dan dapat dibatalkan kapan saja.</p>
      <div id="qrList" class="qr-grid">${state.qrItems.length ? state.qrItems.map(item => `<div class="qr-card"><strong>${esc(item.name || 'Peserta')}</strong><div class="qr-code" data-qrcode="${esc(item.url || '')}"></div><button class="button outline" data-action="download-qrs" data-id="${esc(item.participantId || '')}">Unduh QR</button></div>`).join('') : '<div class="empty-state">Tekan tombol di atas untuk membuat token QR.</div>'}</div>
    </div>
  `;
}

function renderResults() {
  const rows = state.results || [];
  return `
    <div class="page-heading"><div><h1>${state.page === 'history' ? 'Riwayat pemenang' : 'Hasil undian'}</h1><p>Hasil spin tersimpan permanen dan tidak dapat diedit peserta.</p></div><button class="button outline" data-action="export-results">Unduh CSV</button></div>
    <div class="card table-card"><div class="table-wrap"><table><thead><tr><th>WAKTU</th><th>PESERTA</th><th>HADIAH</th><th>HASIL</th></tr></thead><tbody>${rows.length ? rows.map(r => `
      <tr><td>${timeText(r.createdAt)}</td><td><strong>${esc(r.participantName || 'Peserta')}</strong></td><td>${esc(r.prizeName || 'Tidak ada')}</td><td><span class="status-label">Tercatat</span></td></tr>
    `).join('') : '<tr><td colspan="4" class="empty-state">Belum ada hasil spin.</td></tr>'}</tbody></table></div></div>
  `;
}

function bindPageActions() {
  $$('[data-action]').forEach(el => {
    const action = el.dataset.action;
    el.onclick = () => handleAction(action, el.dataset.id);
  });
  $$('[data-page]').forEach(el => {
    el.onclick = () => {
      if (!requireAccess()) return;
      setPage(el.dataset.page);
    };
  });
  $('#organizerButton')?.addEventListener('click', () => {
    if (state.user) {
      lockOrganizer();
    } else {
      openAccessModal();
    }
  });
  $('#topAccess')?.addEventListener('click', openAccessModal);
  $('#menuToggle')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
}

async function refreshAll() {
  if (!state.user) return;
  try {
    const data = await call('organizerData');
    applyOrganizerData(data);
    render();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function applyOrganizerData(data) {
  state.sessionId = data.sessionId || '';
  state.event = data.event || null;
  state.participants = data.participants || [];
  state.prizes = data.prizes || [];
  state.results = data.results || [];
  state.config = data.config || {};
  state.stats = data.stats || {};
  if (state.event) {
    $('#sideEventName').textContent = state.event.name || 'Belum ada acara';
    $('#sideEventStatus').textContent = state.event.status === 'closed' ? 'Ditutup' : 'Aktif';
  }
}

async function lockOrganizer() {
  if (state.user) {
    await signOut(auth).catch(() => {});
  }
  state.user = null;
  state.organizerToken = '';
  state.organizerEmail = '';
  localStorage.removeItem('spinkuOrganizerEmail');
  renderWelcome();
  showNotice('Sesi panitia ditutup.', 'success');
}

async function handleAction(action, id) {
  if (action === 'organizer-login') {
    openAccessModal();
    return;
  }
  if (!requireAccess()) return;

  try {
    switch (action) {
      case 'new-event':
        setPage('event');
        break;
      case 'save-event':
        const form = $('#eventForm');
        const eventData = Object.fromEntries(new FormData(form).entries());
        await call('createEvent', eventData);
        await refreshAll();
        showNotice('Perubahan acara berhasil disimpan.', 'success');
        break;
      case 'add-participant':
        openModal('Tambah peserta', 'Nama dan kuota dapat diubah sesuai kebutuhan.', `<div class="field full"><label>Nama peserta</label><input name="name" required /></div><div class="field"><label>No. registrasi</label><input name="registration" /></div><div class="field"><label>Kuota spin</label><input name="spinQuota" type="number" min="1" value="1" /></div>`, async (form) => {
          const payload = Object.fromEntries(form.entries());
          await call('addParticipant', payload);
          await refreshAll();
        }, 'Simpan');
        break;
      case 'edit-participant':
        const participant = state.participants.find(x => x.id === id);
        openModal('Edit peserta', 'Ubah data peserta dan kuota spin.', `<div class="field full"><label>Nama peserta</label><input name="name" value="${esc(participant?.name || '')}" required /></div><div class="field"><label>No. registrasi</label><input name="registration" value="${esc(participant?.registration || '')}" /></div><div class="field"><label>Kuota spin</label><input name="spinQuota" type="number" min="1" value="${Number(participant?.spinQuota || 1)}" /></div>`, async (form) => {
          const payload = Object.fromEntries(form.entries());
          payload.participantId = id;
          await call('updateParticipant', payload);
          await refreshAll();
        }, 'Simpan');
        break;
      case 'delete-participant':
        if (confirm('Hapus peserta ini?')) {
          await call('deleteParticipant', { participantId: id });
          await refreshAll();
        }
        break;
      case 'add-prize':
        openModal('Tambah hadiah', 'Masukkan nama hadiah dan stoknya.', `<div class="field full"><label>Nama hadiah</label><input name="name" required /></div><div class="field"><label>Kategori</label><input name="category" value="Umum" /></div><div class="field"><label>Stok</label><input name="stock" type="number" min="0" value="1" /></div>`, async (form) => {
          const payload = Object.fromEntries(form.entries());
          await call('addPrize', payload);
          await refreshAll();
        }, 'Simpan');
        break;
      case 'edit-prize':
        const prize = state.prizes.find(x => x.id === id);
        openModal('Edit hadiah', 'Ubah nama hadiah, kategori, dan stok.', `<div class="field full"><label>Nama hadiah</label><input name="name" value="${esc(prize?.name || '')}" required /></div><div class="field"><label>Kategori</label><input name="category" value="${esc(prize?.category || 'Umum')}" /></div><div class="field"><label>Stok</label><input name="stock" type="number" min="0" value="${Number(prize?.stock || 0)}" /></div>`, async (form) => {
          const payload = Object.fromEntries(form.entries());
          payload.prizeId = id;
          await call('updatePrize', payload);
          await refreshAll();
        }, 'Simpan');
        break;
      case 'delete-prize':
        if (confirm('Hapus hadiah ini?')) {
          await call('deletePrize', { prizeId: id });
          await refreshAll();
        }
        break;
      case 'generate-qrs':
        await call('generateQrs');
        await refreshAll();
        showNotice('Token QR berhasil dibuat.', 'success');
        break;
      case 'save-spinner':
        await call('updateConfig', {
          config: {
            mode: $('#spinMode').value,
            duration: Number($('#spinDuration').value),
            sound: $('#soundToggle').checked,
            confetti: $('#confettiToggle').checked,
            defaultQuota: Number($('#defaultQuota').value)
          }
        });
        await refreshAll();
        showNotice('Pengaturan spinner disimpan.', 'success');
        break;
      case 'export-results':
        downloadCsv('hasil-undian.csv', [['Waktu', 'Peserta', 'Hadiah'], ...state.results.map(r => [timeText(r.createdAt), r.participantName || '', r.prizeName || ''])]);
        break;
      default:
        showNotice('Aksi tidak tersedia.', 'info');
    }
  } catch (error) {
    showNotice(error.message || 'Terjadi kesalahan.', 'error');
  }
}

function downloadCsv(name, rows) {
  const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
  const link = document.createElement('a');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function render() {
  if (state.participantToken) {
    renderParticipant();
    return;
  }
  if (!state.user) {
    renderWelcome();
    return;
  }
  const page = state.page;
  const views = {
    dashboard: renderDashboard,
    event: renderEvent,
    participants: renderParticipants,
    prizes: renderPrizes,
    spinner: renderSpinner,
    qrs: renderQrs,
    results: renderResults,
    history: renderResults
  };
  $('#pageContent').innerHTML = views[page] ? views[page]() : renderDashboard();
  bindPageActions();
}

async function initializeAuth() {
  if (!firebaseConfig.projectId || firebaseConfig.projectId === 'ISI_PROJECT_ID') return;
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.organizerEmail = user?.email || state.organizerEmail;
    if (user) {
      state.organizerToken = await user.getIdToken();
      localStorage.setItem('spinkuOrganizerEmail', user.email || state.organizerEmail);
      await refreshAll();
    } else {
      state.organizerToken = '';
      render();
    }
  });
  if (await completeEmailLogin()) {
    await refreshAll();
  }
}

if (firebaseConfig.projectId !== 'ISI_PROJECT_ID' && firebaseConfig.apiKey !== 'ISI_API_KEY') {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    apiCall = httpsCallable(getFunctions(app), 'spinKuApi');
    initializeAuth();
  } catch (error) {
    showNotice(`Firebase tidak dapat diinisialisasi: ${error.message}`, 'error');
  }
}

$$('.nav-item').forEach(item => {
  item.onclick = () => {
    if (!requireAccess()) return;
    setPage(item.dataset.page);
  };
});
$('#organizerButton')?.addEventListener('click', () => {
  if (state.user) {
    lockOrganizer();
  } else {
    openAccessModal();
  }
});
$('#topAccess')?.addEventListener('click', openAccessModal);
$('#menuToggle')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
window.setInterval(() => {
  if (state.user) refreshAll();
}, 20000);

const initialPage = location.hash.slice(1);
if (labels[initialPage]) state.page = initialPage;
render();

function renderParticipant() {
  $('#pageContent').innerHTML = '<div class="card spin-panel"><h2>SpinKu telah siap</h2><p>Halaman peserta tidak digunakan di mode organizer.</p></div>';
}

const existingWelcome = () => renderWelcome();
window.existingWelcome = existingWelcome;

if (state.organizerEmail) {
  $('#organizerButton')?.setAttribute('title', state.organizerEmail);
}

window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (labels[next]) setPage(next);
});

window.__spinKuReady = true;

