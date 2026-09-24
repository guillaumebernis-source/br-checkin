/**
 * Blood Runners — API de pointage des arrivées par QR code.
 * À coller dans Extensions > Apps Script du Google Sheet "CSV test BR24".
 *
 * Colonnes attendues (dans cet ordre) :
 * A: Numéro | B: Nom | C: Prénom | D: Caractéristiques | E: Url | F: Arrivé
 *
 * Le pointage accepte deux types de code :
 * - le contenu du QR imprimé sur le dossard (= colonne Url)
 * - le numéro de dossard saisi manuellement (= colonne Numéro), en secours
 *   si le QR est illisible.
 */

const SHEET_NAME = 'Feuille 1';
const COL = { NUMERO: 1, NOM: 2, PRENOM: 3, CARACTERISTIQUES: 4, URL: 5, ARRIVE: 6 };
const ARRIVE_VALUE = 'oui';
const URL_CACHE_KEY = 'url_index_v1';
const NUMERO_CACHE_KEY = 'numero_index_v1';
const CACHE_TTL_SECONDS = 21600; // 6h

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getStaffPin_() {
  return PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
}

function buildIndex_(column, cacheKey) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const index = {};
  if (lastRow >= 2) {
    const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
    values.forEach((row, i) => {
      const key = String(row[0]).trim();
      if (key) index[key] = i + 2;
    });
  }
  cache.put(cacheKey, JSON.stringify(index), CACHE_TTL_SECONDS);
  return index;
}

function getUrlIndex_() {
  return buildIndex_(COL.URL, URL_CACHE_KEY);
}

function getNumeroIndex_() {
  return buildIndex_(COL.NUMERO, NUMERO_CACHE_KEY);
}

function invalidateIndexes_() {
  const cache = CacheService.getScriptCache();
  cache.remove(URL_CACHE_KEY);
  cache.remove(NUMERO_CACHE_KEY);
}

/** Cherche une ligne par contenu de QR (Url) puis, à défaut, par numéro de dossard. */
function findRow_(code) {
  let row = getUrlIndex_()[code] || getNumeroIndex_()[code];
  if (row) return row;

  // Pas trouvé : l'info est peut-être arrivée après la construction du cache.
  invalidateIndexes_();
  return getUrlIndex_()[code] || getNumeroIndex_()[code];
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const pin = String(body.pin || '');
    const code = String(body.code || '').trim();

    const expectedPin = getStaffPin_();
    if (expectedPin && pin !== expectedPin) {
      return jsonOut_({ status: 'unauthorized', message: 'Code bénévole invalide.' });
    }
    if (!code) {
      return jsonOut_({ status: 'error', message: 'QR code vide.' });
    }

    const row = findRow_(code);
    if (!row) {
      return jsonOut_({ status: 'not_found', message: 'Dossard inconnu.' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const sheet = getSheet_();
      const data = sheet.getRange(row, 1, 1, COL.ARRIVE).getValues()[0];
      const runner = {
        numero: data[COL.NUMERO - 1],
        nom: data[COL.NOM - 1],
        prenom: data[COL.PRENOM - 1],
      };
      const arrive = String(data[COL.ARRIVE - 1] || '').trim().toLowerCase();

      if (arrive === ARRIVE_VALUE) {
        return jsonOut_({
          status: 'already',
          message: 'Cette personne est déjà enregistrée comme arrivée.',
          runner,
        });
      }

      sheet.getRange(row, COL.ARRIVE).setValue(ARRIVE_VALUE);
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
 * Utilitaire optionnel : vide toute la colonne Arrivé (par ex. après un test).
 * À exécuter manuellement depuis l'éditeur, jamais depuis le web app.
 */
function reinitialiserArrivees() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, COL.ARRIVE, lastRow - 1, 1);
  const values = range.getValues().map(() => ['']);
  range.setValues(values);
}
