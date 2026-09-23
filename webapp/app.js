const PIN_STORAGE_KEY = 'br_staff_pin';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
let sessionCount = 0;
let scanner = null;
let processing = false;
let lastCode = null;
let lastSource = null;
let torchOn = false;
let torchFeature = null;

const pinScreen = document.getElementById('pin-screen');
const scanScreen = document.getElementById('scan-screen');
const pinInput = document.getElementById('pin-input');
const countEl = document.getElementById('count');
const logoutBtn = document.getElementById('logout-btn');
const torchBtn = document.getElementById('torch-btn');
const manualInput = document.getElementById('manual-input');
const manualSubmit = document.getElementById('manual-submit');

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

function startScanner() {
  pinScreen.hidden = true;
  scanScreen.hidden = false;
  logoutBtn.hidden = false;

  scanner = new Html5Qrcode('reader');
  scanner
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {}
    )
    .then(setupTorchButton)
    .catch(err => {
      showModalError("Impossible d'accéder à la caméra : " + err, { hideRetry: true });
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
  if (scanner) {
    scanner
      .stop()
      .then(() => scanner.clear())
      .catch(() => {});
    scanner = null;
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

  if (scanner) {
    try {
      scanner.pause(true);
    } catch (e) {}
  }

  showModalLoading();
  await checkIn(code);
}

async function checkIn(code, allowRetry) {
  if (allowRetry === undefined) allowRetry = true;
  const pin = getStoredPin() || '';
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ code: code, pin: pin }),
    });
    const data = await res.json();
    handleResult(data);
  } catch (err) {
    if (allowRetry) return checkIn(code, false);
    showModalError('Erreur réseau. Vérifie la connexion et réessaie.');
  }
}

function handleResult(data) {
  switch (data.status) {
    case 'success':
      sessionCount++;
      countEl.textContent = sessionCount;
      showModalDone(
        'success',
        '✅ Dossard #' + data.runner.numero + ' — ' + data.runner.prenom + ' ' + data.runner.nom + ' enregistré(e) arrivé(e).'
      );
      break;
    case 'already':
      showModalDone(
        'warning',
        '⚠️ Déjà enregistrée comme arrivée (Dossard #' +
          data.runner.numero + ' — ' + data.runner.prenom + ' ' + data.runner.nom + ').'
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
    modalBtn.hidden = true;
  } else {
    modalBtn.textContent = 'Réessayer';
    modalBtn.onclick = lastSource === 'manual' ? returnToManualEntry : retryLast;
    modalBtn.hidden = false;
  }
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

function logout() {
  localStorage.removeItem(PIN_STORAGE_KEY);
  stopScanner();
  scanScreen.hidden = true;
  pinScreen.hidden = false;
  logoutBtn.hidden = true;
  pinInput.value = '';
}

document.getElementById('pin-submit').addEventListener('click', () => {
  const pin = pinInput.value.trim();
  if (!pin) return;
  setStoredPin(pin);
  startScanner();
});

pinInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('pin-submit').click();
});

logoutBtn.addEventListener('click', logout);
torchBtn.addEventListener('click', toggleTorch);
manualSubmit.addEventListener('click', submitManual);
manualInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') submitManual();
});

// Auto-connexion si une session valide (< 24h) est déjà mémorisée sur ce téléphone.
if (getStoredPin()) {
  startScanner();
}
