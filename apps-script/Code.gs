/**
 * Blood Runners — API de pointage des arrivées par QR code.
 * À coller dans Extensions > Apps Script du Google Sheet "Blood Runners 2026 - Emargement app".
 *
 * Colonnes de la feuille "Feuille 1" (le script travaille par POSITION, pas par nom d'en-tête :
 * renommer un en-tête est sans effet, mais insérer/déplacer une colonne impose de mettre COL à jour) :
 * A: Numéro | B: Nom | C: Tel | D: Url | E: Arrivé.e ? | F: Heure émargement | G: Qrcode
 *
 * Le pointage accepte :
 * - le contenu du QR imprimé sur le dossard : colonne D (Url) ou valeur encodée dans la colonne G
 *   (Qrcode contient le lien de l'image quickchart.io ; la valeur lue par le scanner est son
 *   paramètre "text", identique à l'Url) ;
 * - le numéro de dossard saisi manuellement (colonne A), en secours si le QR est illisible.
 *
 * Actions acceptées par doPost (champ "action", "checkin" par défaut) :
 * - checkin   : enregistre l'arrivée (Arrivé.e ? = oui + horodatage)
 * - stats     : nombre de coureurs inscrits / arrivés / encore en course
 * - remaining : idem + liste des coureurs encore en course
 *
 * Un coureur = une ligne dont la colonne Nom est renseignée (les numéros pas encore attribués
 * ne comptent pas).
 */

const SHEET_NAME = 'Feuille 1';
const COL = { NUMERO: 1, NOM: 2, TEL: 3, URL: 4, ARRIVE: 5, HEURE: 6, QRCODE: 7 };
const LAST_COL = Math.max(COL.NUMERO, COL.NOM, COL.URL, COL.ARRIVE, COL.HEURE, COL.QRCODE);
const ARRIVE_VALUE = 'oui';
const INDEX_CACHE_KEY = 'indexes_v2';
const CACHE_TTL_SECONDS = 21600; // 6h

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getStaffPin_() {
  return PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

/**
 * Valeur réellement encodée dans un QR : si la cellule contient un lien quickchart.io/qr?text=...,
 * c'est le paramètre "text" décodé ; sinon la cellule telle quelle.
 */
function qrValue_(cell) {
  const text = String(cell == null ? '' : cell).trim();
  const m = text.match(/[?&]text=([^&]+)/);
  if (!m) return text;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
  } catch (e) {
    return text;
  }
}

/** Index { url: valeur de QR -> n° de ligne, numero: n° de dossard -> n° de ligne }, mis en cache. */
function getIndexes_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(INDEX_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const indexes = { url: {}, numero: {} };
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet
      .getRange(2, 1, lastRow - 1, LAST_COL)
      .getValues()
      .forEach((r, i) => {
        const row = i + 2;
        const numero = String(r[COL.NUMERO - 1]).trim();
        const url = String(r[COL.URL - 1]).trim();
        const qr = qrValue_(r[COL.QRCODE - 1]);
        if (numero) indexes.numero[numero] = row;
        if (url) indexes.url[url] = row;
        if (qr) indexes.url[qr] = row;
      });
  }
  try {
    cache.put(INDEX_CACHE_KEY, JSON.stringify(indexes), CACHE_TTL_SECONDS);
  } catch (e) {
    // Cache indisponible ou trop gros : on continue sans, l'index sera simplement reconstruit.
  }
  return indexes;
}

function invalidateIndexes_() {
  CacheService.getScriptCache().remove(INDEX_CACHE_KEY);
}

/** À lancer manuellement après avoir trié ou réorganisé les lignes du Sheet. */
function viderCache() {
  invalidateIndexes_();
}

function lookupRow_(code, indexes) {
  return indexes.url[code] || indexes.numero[code];
}

/** Cherche une ligne par valeur de QR (Url / Qrcode) puis, à défaut, par numéro de dossard. */
function findRow_(code) {
  let row = lookupRow_(code, getIndexes_());
  if (row) return row;

  // Pas trouvé : l'info est peut-être arrivée après la construction du cache.
  invalidateIndexes_();
  return lookupRow_(code, getIndexes_());
}

/** Vérifie que la ligne lue correspond bien au code scanné (protège d'un cache périmé après un tri). */
function rowMatches_(data, code) {
  return (
    String(data[COL.NUMERO - 1]).trim() === code ||
    String(data[COL.URL - 1]).trim() === code ||
    qrValue_(data[COL.QRCODE - 1]) === code
  );
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Lit tous les coureurs (lignes avec un nom) en un seul appel. */
function readRunners_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, LAST_COL)
    .getValues()
    .filter(r => String(r[COL.NOM - 1]).trim() !== '')
    .map(r => ({
      numero: r[COL.NUMERO - 1],
      nom: r[COL.NOM - 1],
      arrive: String(r[COL.ARRIVE - 1] || '').trim().toLowerCase() === ARRIVE_VALUE,
    }));
}

function statsResponse_(withList) {
  const runners = readRunners_();
  const remaining = runners.filter(r => !r.arrive);
  const response = {
    status: 'ok',
    total: runners.length,
    arrived: runners.length - remaining.length,
    remaining: remaining.length,
  };
  if (withList) {
    response.runners = remaining
      .map(r => ({ numero: r.numero, nom: r.nom }))
      .sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'fr', { numeric: true }));
  }
  return response;
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const pin = String(body.pin || '');
    const action = String(body.action || 'checkin');

    const expectedPin = getStaffPin_();
    if (expectedPin && pin !== expectedPin) {
      return jsonOut_({ status: 'unauthorized', message: 'Code bénévole invalide.' });
    }

    if (action === 'stats') return jsonOut_(statsResponse_(false));
    if (action === 'remaining') return jsonOut_(statsResponse_(true));

    const code = String(body.code || '').trim();
    if (!code) {
      return jsonOut_({ status: 'error', message: 'QR code vide.' });
    }

    let row = findRow_(code);
    if (!row) {
      return jsonOut_({ status: 'not_found', message: 'Dossard inconnu.' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const sheet = getSheet_();
      let data = sheet.getRange(row, 1, 1, LAST_COL).getValues()[0];

      if (!rowMatches_(data, code)) {
        // Le Sheet a changé depuis la construction du cache (tri, insertion) : on reconstruit.
        invalidateIndexes_();
        row = lookupRow_(code, getIndexes_());
        data = row ? sheet.getRange(row, 1, 1, LAST_COL).getValues()[0] : null;
        if (!data || !rowMatches_(data, code)) {
          return jsonOut_({ status: 'not_found', message: 'Dossard inconnu.' });
        }
      }

      const runner = {
        numero: data[COL.NUMERO - 1],
        nom: data[COL.NOM - 1],
      };
      const arriveCell = String(data[COL.ARRIVE - 1] == null ? '' : data[COL.ARRIVE - 1]).trim().toLowerCase();

      if (arriveCell === ARRIVE_VALUE) {
        return jsonOut_({
          status: 'already',
          message: 'Cette personne est déjà enregistrée comme arrivée.',
          runner,
        });
      }

      // Garde-fous : on n'écrase jamais une cellule qui contient autre chose que ce qu'on attend
      // (typiquement si les colonnes ont été déplacées sans mettre COL à jour).
      const heureCell = data[COL.HEURE - 1];
      if ((arriveCell !== '' && arriveCell !== 'non') || (heureCell !== '' && !isDate_(heureCell))) {
        return jsonOut_({
          status: 'error',
          message: 'Colonnes du Sheet incohérentes (Arrivé.e ? / Heure émargement). Préviens l\'organisateur.',
        });
      }

      const now = new Date();
      if (COL.HEURE === COL.ARRIVE + 1) {
        sheet.getRange(row, COL.ARRIVE, 1, 2).setValues([[ARRIVE_VALUE, now]]);
      } else {
        sheet.getRange(row, COL.ARRIVE).setValue(ARRIVE_VALUE);
        sheet.getRange(row, COL.HEURE).setValue(now);
      }
      return jsonOut_({ status: 'success', message: 'Arrivée enregistrée.', runner });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOut_({ status: 'error', message: 'Erreur serveur : ' + err.message });
  }
}

function doGet() {
  return jsonOut_({ status: 'ok', message: 'Blood Runners check-in API' });
}

/**
 * Utilitaire optionnel : vide les colonnes Arrivé.e ? et Heure émargement (par ex. après un test).
 * À exécuter manuellement depuis l'éditeur, jamais depuis le web app.
 * Refuse de rien effacer si l'une de ces colonnes contient autre chose que oui/non/une date.
 */
function reinitialiserArrivees() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const arrive = sheet.getRange(2, COL.ARRIVE, lastRow - 1, 1);
  const heure = sheet.getRange(2, COL.HEURE, lastRow - 1, 1);
  const arriveValues = arrive.getValues();
  const heureValues = heure.getValues();

  const arriveOk = arriveValues.every(r => ['', 'oui', 'non'].includes(String(r[0]).trim().toLowerCase()));
  const heureOk = heureValues.every(r => r[0] === '' || isDate_(r[0]));
  if (!arriveOk || !heureOk) {
    throw new Error('Abandon : les colonnes Arrivé.e ? / Heure émargement contiennent autre chose que oui/non/une date. Vérifie COL.');
  }

  arrive.setValues(arriveValues.map(() => ['']));
  heure.setValues(heureValues.map(() => ['']));
}
