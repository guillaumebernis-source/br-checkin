const PIN_STORAGE_KEY = 'br_staff_pin';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const REQUEST_TIMEOUT_MS = 8000;
const LIST_TIMEOUT_MS = 15000;
let sessionCount = 0;
let scanner = null;
let stopping = Promise.resolve();
let processing = false;
let lastCode = null;
let lastSource = null;
let torchOn = false;
let torchFeature = null;
let currentView = null;
let listVisible = false;
let remainingRequestId = 0;

const pinScreen = document.getElementById('pin-screen');
const scanScreen = document.getElementById('scan-screen');
const remainingScreen = document.getElementById('remaining-screen');
const pinInput = document.getElementById('pin-input');
const countEl = document.getElementById('count');
const torchBtn = document.getElementById('torch-btn');
const manualInput = document.getElementById('manual-input');
const manualSubmit = document.getElementById('manual-submit');

const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');
const menuItems = Array.from(document.querySelectorAll('.menu-item'));

const remainingCount = document.getElementById('remaining-count');
const remainingLabel = document.getElementById('remaining-label');
const remainingDetail = document.getElementById('remaining-detail');
const remainingError = document.getElementById('remaining-error');
const listBtn = document.getElementById('list-btn');
const refreshBtn = document.getElementById('refresh-btn');
const runnerList = document.getElementById('runner-list');

const modal = document.getElementById('result-modal');
const modalContent = document.getElementById('result-modal-content');
const modalMessage = document.getElementById('modal-message');
const modalBtn = document.getElementById('modal-btn');

function getStoredPin() {
  const raw = localStorage.getItem(PIN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.pin || !session.expiresAt || Date.now() > session.expiresAt) {
      localStorage.removeItem(PIN_STORAGE_KEY);
      return null;
    }
    return session.pin;
  } catch (e) {
    localStorage.removeItem(PIN_STORAGE_KEY);
    return null;
  }
}

function setStoredPin(pin) {
  localStorage.setItem(
    PIN_STORAGE_KEY,
    JSON.stringify({ pin: pin, expiresAt: Date.now() + SESSION_DURATION_MS })
  );
}

async function callApi(body, timeoutMs, allowRetry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ pin: getStoredPin() || '' }, body)),
      signal: controller.signal,
    });
    return await res.json();
  } catch (err) {
    if (allowRetry) return callApi(body, timeoutMs, false);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Navigation ----------

function openMenu() {
  menu.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  menu.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}

function enterApp() {
  pinScreen.hidden = true;
  menuBtn.hidden = false;
  currentView = null;
  showView('scan');
}

function showView(name) {
  closeMenu();
  if (name === currentView) return;
  currentView = name;
  scanScreen.hidden = name !== 'scan';
  remainingScreen.hidden = name !== 'remaining';
  menuItems.forEach(item => item.classList.toggle('active', item.dataset.view === name));

  if (name === 'scan') {
    remainingRequestId++;
    startScanner();
  } else {
    stopScanner();
    resetRemainingView();
    loadStats();
  }
}

// ---------- Scanner ----------

function startScanner() {
  stopping.then(() => {
    if (currentView !== 'scan') return;
    const instance = new Html5Qrcode('reader');
    scanner = instance;
    instance
      .start(
        { facingMode: 'environment' },
        { fps: 20, qrbox: { width: 250, height: 250 } },
        onScanSuccess,
        () => {}
      )
      .then(() => {
        if (scanner !== instance) {
          instance
            .stop()
            .then(() => instance.clear())
            .catch(() => {});
          return;
        }
        setupTorchButton();
      })
      .catch(err => {
        if (scanner !== instance) return;
        showModalError("Impossible d'accéder à la caméra : " + err, { hideRetry: true });
      });
  });
}

function setupTorchButton() {
  torchFeature = null;
  torchOn = false;
  torchBtn.hidden = true;
  torchBtn.classList.remove('on');
  torchBtn.textContent = '🔦 Activer le flash';

  try {
    const capabilities = scanner.getRunningTrackCameraCapabilities();
    const feature = capabilities.torchFeature();
    if (feature && feature.isSupported()) {
      torchFeature = feature;
      torchBtn.hidden = false;
    }
  } catch (e) {
    // Flash non supporté par cet appareil/navigateur : le bouton reste caché.
  }
}

function toggleTorch() {
  if (!torchFeature) return;
  const next = !torchOn;
  torchFeature
    .apply(next)
    .then(() => {
      torchOn = next;
      torchBtn.classList.toggle('on', torchOn);
      torchBtn.textContent = torchOn ? '🔦 Désactiver le flash' : '🔦 Activer le flash';
    })
    .catch(() => {});
}

function stopScanner() {
  const s = scanner;
  scanner = null;
  if (s) {
    try {
      stopping = s
        .stop()
        .then(() => s.clear())
        .catch(() => {});
    } catch (e) {
      stopping = Promise.resolve();
    }
  }
  torchFeature = null;
  torchOn = false;
  torchBtn.hidden = true;
  torchBtn.classList.remove('on');
}

async function onScanSuccess(decodedText) {
  await submitCode(decodedText, 'scan');
}

async function submitManual() {
  const value = manualInput.value.trim();
  if (!value) return;
  manualInput.value = '';
  manualInput.blur();
  await submitCode(value, 'manual');
}

async function submitCode(code, source) {
  if (processing) return;
  processing = true;
  lastCode = code;
  lastSource = source;
  closeMenu();

  if (scanner) {
    try {
      scanner.pause(true);
    } catch (e) {}
  }

  showModalLoading();
  await checkIn(code);
}

async function checkIn(code) {
  try {
    const data = await callApi({ code: code }, REQUEST_TIMEOUT_MS, true);
    handleResult(data);
  } catch (err) {
    showModalError('Erreur réseau. Vérifie la connexion et réessaie.');
  }
}

function runnerLabel(r) {
  const equipe = String(r.equipe || '').trim();
  return String(r.nom || '').trim() + (equipe ? ' (' + equipe + ')' : '');
}

function handleResult(data) {
  switch (data.status) {
    case 'success':
      sessionCount++;
      countEl.textContent = sessionCount;
      showModalDone(
        'success',
        '✅ Dossard #' + data.runner.numero + ' — ' + runnerLabel(data.runner) + ' enregistré(e) arrivé(e).'
      );
      break;
    case 'already':
      showModalDone(
        'warning',
        '⚠️ Déjà enregistrée comme arrivée (Dossard #' +
          data.runner.numero + ' — ' + runnerLabel(data.runner) + ').'
      );
      break;
    case 'not_found':
      showModalError('❌ Dossard inconnu.');
      break;
    case 'unauthorized':
      closeModal();
      logout();
      break;
    default:
      showModalError(data.message || 'Erreur inconnue.');
  }
}

function showModalLoading() {
  modalContent.className = 'modal-content loading';
  modalMessage.textContent = 'Identification en cours…';
  modalBtn.hidden = true;
  modal.classList.remove('hidden');
}

function showModalDone(type, message) {
  modalContent.className = 'modal-content ' + type;
  modalMessage.textContent = message;
  modalBtn.textContent = 'Scanner un autre coureur';
  modalBtn.onclick = closeModalAndResume;
  modalBtn.hidden = false;
  modal.classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate(type === 'success' ? 100 : [80, 60, 80]);
}

function showModalError(message, options) {
  const hideRetry = options && options.hideRetry;
  modalContent.className = 'modal-content error';
  modalMessage.textContent = message;
  if (hideRetry) {
    modalBtn.textContent = 'Fermer';
    modalBtn.onclick = closeModal;
  } else {
    modalBtn.textContent = 'Réessayer';
    modalBtn.onclick = lastSource === 'manual' ? returnToManualEntry : retryLast;
  }
  modalBtn.hidden = false;
  modal.classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
}

function retryLast() {
  showModalLoading();
  checkIn(lastCode);
}

function returnToManualEntry() {
  closeModal();
  processing = false;
  if (scanner) {
    try {
      scanner.resume();
    } catch (e) {}
  }
  manualInput.value = lastCode || '';
  manualInput.focus();
  manualInput.select();
}

function closeModal() {
  modal.classList.add('hidden');
  modalContent.className = 'modal-content';
  modalMessage.textContent = '';
  modalBtn.hidden = true;
  modalBtn.onclick = null;
}

function closeModalAndResume() {
  closeModal();
  processing = false;
  if (scanner) {
    try {
      scanner.resume();
    } catch (e) {}
  }
}

// ---------- Coureurs toujours en course ----------

function resetRemainingView() {
  listVisible = false;
  runnerList.hidden = true;
  runnerList.textContent = '';
  listBtn.textContent = 'Voir la liste des coureurs';
  listBtn.disabled = false;
  refreshBtn.disabled = false;
  remainingCount.textContent = '…';
  remainingLabel.textContent = 'coureurs toujours en course';
  remainingDetail.textContent = 'Chargement…';
  remainingError.hidden = true;
}

function renderStats(data) {
  remainingCount.textContent = data.remaining;
  remainingLabel.textContent = (data.remaining > 1 ? 'coureurs' : 'coureur') + ' toujours en course';
  remainingDetail.textContent =
    data.arrived + (data.arrived > 1 ? ' arrivés' : ' arrivé') +
    ' sur ' + data.total + (data.total > 1 ? ' inscrits' : ' inscrit');
  remainingError.hidden = true;
}

function renderList(runners) {
  runnerList.textContent = '';
  if (!runners.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Tous les coureurs sont arrivés 🎉';
    runnerList.appendChild(li);
    return;
  }
  runners.forEach(r => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = '#' + r.numero;
    const name = document.createElement('span');
    name.textContent = runnerLabel(r);
    li.appendChild(num);
    li.appendChild(name);
    runnerList.appendChild(li);
  });
}

function showRemainingError() {
  remainingCount.textContent = '–';
  remainingDetail.textContent = 'Données indisponibles';
  remainingError.textContent = 'Impossible de charger les données. Vérifie la connexion puis actualise.';
  remainingError.hidden = false;
}

async function fetchRemaining(action) {
  const data = await callApi({ action: action }, LIST_TIMEOUT_MS, true);
  if (data.status === 'unauthorized') {
    logout();
    return null;
  }
  if (data.status !== 'ok') throw new Error(data.message || 'Erreur');
  return data;
}

async function loadStats() {
  const id = ++remainingRequestId;
  refreshBtn.disabled = true;
  try {
    const data = await fetchRemaining('stats');
    if (!data || id !== remainingRequestId) return;
    renderStats(data);
  } catch (err) {
    if (id === remainingRequestId) showRemainingError();
  } finally {
    if (id === remainingRequestId) refreshBtn.disabled = false;
  }
}

async function loadList() {
  const id = ++remainingRequestId;
  listBtn.disabled = true;
  listBtn.textContent = 'Chargement…';
  refreshBtn.disabled = true;
  try {
    const data = await fetchRemaining('remaining');
    if (!data || id !== remainingRequestId) return;
    renderStats(data);
    renderList(data.runners);
    listVisible = true;
    runnerList.hidden = false;
    listBtn.textContent = 'Masquer la liste';
  } catch (err) {
    if (id !== remainingRequestId) return;
    showRemainingError();
    listBtn.textContent = listVisible ? 'Masquer la liste' : 'Voir la liste des coureurs';
  } finally {
    if (id === remainingRequestId) {
      listBtn.disabled = false;
      refreshBtn.disabled = false;
    }
  }
}

function toggleList() {
  if (listVisible) {
    listVisible = false;
    runnerList.hidden = true;
    listBtn.textContent = 'Voir la liste des coureurs';
  } else {
    loadList();
  }
}

function refreshRemaining() {
  if (listVisible) loadList();
  else loadStats();
}

// ---------- Session ----------

function logout() {
  localStorage.removeItem(PIN_STORAGE_KEY);
  stopScanner();
  remainingRequestId++;
  currentView = null;
  closeMenu();
  menuBtn.hidden = true;
  scanScreen.hidden = true;
  remainingScreen.hidden = true;
  pinScreen.hidden = false;
  pinInput.value = '';
}

document.getElementById('pin-submit').addEventListener('click', () => {
  const pin = pinInput.value.trim();
  if (!pin) return;
  setStoredPin(pin);
  enterApp();
});

pinInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pin-submit').click();
});

menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (menu.hidden) openMenu();
  else closeMenu();
});
menuItems.forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
document.addEventListener('click', e => {
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
});

listBtn.addEventListener('click', toggleList);
refreshBtn.addEventListener('click', refreshRemaining);
torchBtn.addEventListener('click', toggleTorch);
manualSubmit.addEventListener('click', submitManual);
manualInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitManual();
});

// Auto-connexion si une session valide (< 24h) est déjà mémorisée sur ce téléphone.
if (getStoredPin()) {
  enterApp();
}
