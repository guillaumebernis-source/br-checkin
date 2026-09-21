/**
 * Blood Runners — API de pointage des arrivées par QR code.
 * À coller dans Extensions > Apps Script du Google Sheet "CSV test BR24".
 *
 * Colonnes attendues (dans cet ordre) :
 * A: Numéro | B: Nom | C: Prénom | D: Caractéristiques | E: Url | F: Arrivé
 *
 * Les QR codes imprimés sur les dossards encodent la valeur de la colonne
 * Url (c'est déjà comme ça qu'ils ont été générés) : c'est donc sur cette
 * colonne qu'on recherche le dossard scanné.
 */

const SHEET_NAME = 'Feuille 1';
const COL = { NUMERO: 1, NOM: 2, PRENOM: 3, CARACTERISTIQUES: 4, URL: 5, ARRIVE: 6 };
const ARRIVE_VALUE = 'oui';
const CACHE_KEY = 'url_index_v1';
const CACHE_TTL_SECONDS = 21600; // 6h

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getStaffPin_() {
  return PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
}

/** Construit (ou relit depuis le cache) l'index Url -> numéro de ligne. */
function getUrlIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const index = {};
  if (lastRow >= 2) {
    const urls = sheet.getRange(2, COL.URL, lastRow - 1, 1).getValues();
    urls.forEach((row, i) => {
      const url = String(row[0]).trim();
      if (url) index[url] = i + 2;
    });
  }
  cache.put(CACHE_KEY, JSON.stringify(index), CACHE_TTL_SECONDS);
  return index;
}

function invalidateUrlIndex_() {
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

    let index = getUrlIndex_();
    let row = index[code];

    if (!row) {
      // L'url est peut-être arrivée après la construction du cache : on force un rafraîchissement.
      invalidateUrlIndex_();
      row = getUrlIndex_()[code];
    }
    if (!row) {
      return jsonOut_({ status: 'not_found', message: 'Dossard inconnu.' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
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
