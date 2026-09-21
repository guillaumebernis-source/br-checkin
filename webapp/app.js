const PIN_STORAGE_KEY = 'br_staff_pin';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
let sessionCount = 0;
let scanner = null;
let processing = false;

const pinScreen = document.getElementById('pin-screen');
const scanScreen = document.getElementById('scan-screen');
const pinInput = document.getElementById('pin-input');
const banner = document.getElementById('result-banner');
const countEl = document.getElementById('count');
const logoutBtn = document.getElementById('logout-btn');

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
    .catch(err => {
      showBanner('error', "Impossible d'accéder à la caméra : " + err);
    });
}

function stopScanner() {
  if (scanner) {
    scanner
      .stop()
      .then(() => scanner.clear())
      .catch(() => {});
    scanner = null;
  }
}

async function onScanSuccess(decodedText) {
  if (processing) return;
  processing = true;
  await checkIn(decodedText);
  setTimeout(() => {
    processing = false;
  }, 1500);
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
    showBanner('error', 'Erreur réseau, réessayez le scan.');
  }
}

function handleResult(data) {
  switch (data.status) {
    case 'success':
      sessionCount++;
      countEl.textContent = sessionCount;
      showBanner(
        'success',
        '✅ Dossard #' + data.runner.numero + ' — ' + data.runner.prenom + ' ' + data.runner.nom + ' enregistré(e) arrivé(e).'
      );
      break;
    case 'already':
      showBanner(
        'warning',
        '⚠️ Cette personne est déjà enregistrée comme arrivée (Dossard #' +
          data.runner.numero + ' — ' + data.runner.prenom + ' ' + data.runner.nom + ').'
      );
      break;
    case 'not_found':
      showBanner('error', '❌ Dossard inconnu. Réessayez le scan.');
      break;
    case 'unauthorized':
      showBanner('error', '🔒 Code bénévole invalide.');
      logout();
      break;
    default:
      showBanner('error', data.message || 'Erreur inconnue.');
  }
}

function showBanner(type, message) {
  banner.className = type;
  banner.textContent = message;
  banner.hidden = false;
  if (navigator.vibrate) navigator.vibrate(type === 'success' ? 100 : [80, 60, 80]);
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

// Auto-connexion si une session valide (< 24h) est déjà mémorisée sur ce téléphone.
if (getStoredPin()) {
  startScanner();
}
