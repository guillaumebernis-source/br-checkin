/**
 * Blood Runners — API de pointage des arrivées par QR code.
 * À coller dans Extensions > Apps Script du Google Sheet "CSV test BR24".
 *
 * Colonnes attendues (dans cet ordre) :
 * A: Numéro | B: Nom | C: Prénom | D: Caractéristiques | E: Url | F: Qrcode | G: Arrivé
 */

const SHEET_NAME = 'Feuille 1';
const COL = { NUMERO: 1, NOM: 2, PRENOM: 3, CARACTERISTIQUES: 4, URL: 5, QRCODE: 6, ARRIVE: 7 };
const CACHE_KEY = 'qrcode_index_v1';
const CACHE_TTL_SECONDS = 21600; // 6h

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getStaffPin_() {
  return PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
}

/** Construit (ou relit depuis le cache) l'index code secret -> numéro de ligne. */
function getCodeIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const index = {};
  if (lastRow >= 2) {
    const codes = sheet.getRange(2, COL.QRCODE, lastRow - 1, 1).getValues();
    codes.forEach((row, i) => {
      const code = String(row[0]).trim();
      if (code) index[code] = i + 2;
    });
  }
  cache.put(CACHE_KEY, JSON.stringify(index), CACHE_TTL_SECONDS);
  return index;
}

function invalidateCodeIndex_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
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

    let index = getCodeIndex_();
    let row = index[code];

    if (!row) {
      // Le code est peut-être arrivé après la construction du cache : on force un rafraîchissement.
      invalidateCodeIndex_();
      row = getCodeIndex_()[code];
    }
    if (!row) {
      return jsonOut_({ status: 'not_found', message: 'Dossard inconnu.' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet_();
      const data = sheet.getRange(row, 1, 1, 7).getValues()[0];
      const runner = {
        numero: data[COL.NUMERO - 1],
        nom: data[COL.NOM - 1],
        prenom: data[COL.PRENOM - 1],
      };
      const arrive = data[COL.ARRIVE - 1];
      const dejaArrive = arrive === true || String(arrive).trim().toUpperCase() === 'OUI';

      if (dejaArrive) {
        return jsonOut_({
          status: 'already',
          message: 'Cette personne est déjà enregistrée comme arrivée.',
          runner,
        });
      }

      sheet.getRange(row, COL.ARRIVE).setValue(true);
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
 * À exécuter UNE FOIS manuellement depuis l'éditeur Apps Script (menu "Exécuter"),
 * après avoir ajouté la colonne F "Qrcode" : génère un code secret unique par
 * dossard pour toutes les lignes où la colonne Qrcode est vide.
 */
function genererCodesManquants() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, COL.QRCODE, lastRow - 1, 1);
  const values = range.getValues();
  const existing = new Set(values.map(r => String(r[0]).trim()).filter(Boolean));

  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) {
      let code;
      do {
        code = Utilities.getUuid().split('-')[0].toUpperCase(); // 8 caractères
      } while (existing.has(code));
      existing.add(code);
      values[i][0] = code;
    }
  }
  range.setValues(values);
  invalidateCodeIndex_();
  Logger.log('Codes générés pour %s lignes.', values.length);
}

/**
 * Utilitaire optionnel : remet toute la colonne Arrivé à FAUX (par ex. après un test).
 * À exécuter manuellement depuis l'éditeur, jamais depuis le web app.
 */
function reinitialiserArrivees() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, COL.ARRIVE, lastRow - 1, 1);
  const values = range.getValues().map(() => [false]);
  range.setValues(values);
}
