# Blood Runners — Pointage des arrivées par QR code

Application de pointage pour la course caritative d'Halloween. Un bénévole scanne le QR code du dossard d'un coureur avec son téléphone ; le statut "Arrivé" est mis à jour en direct dans le Google Sheet.

## Architecture

- **Base de données** : le Google Sheet existant. Aucune migration nécessaire.
- **Backend** : un Google Apps Script *lié au Sheet* ([apps-script/Code.gs](apps-script/Code.gs)), déployé comme "Web App". Il tourne avec ton compte Google, a un accès natif au Sheet (pas de clé API à gérer) et gère les écritures concurrentes avec un verrou.
- **Frontend** : une page web mobile statique ([webapp/](webapp)) qui scanne les QR codes via la caméra et appelle le Web App. Hébergée gratuitement sur GitHub Pages (ou Netlify/Vercel).
- **Sécurité** :
  - Les QR codes déjà imprimés sur les dossards encodent la colonne `Url` — le pointage se fait donc directement sur cette colonne, sans étape de préparation supplémentaire.
  - Un **code bénévole** (PIN) protège l'accès à l'API de pointage : sans lui, personne ne peut marquer un dossard "arrivé" même en connaissant l'URL de l'app. C'est la protection principale, puisque l'`Url` elle-même suit un motif prévisible (nom+prénom) et n'est donc pas un secret.
  - Tout transite en HTTPS (Apps Script + GitHub Pages sont HTTPS par défaut).
  - Le double-scan est géré côté serveur : si le dossard est déjà marqué "arrivé" (`Arrivé` = `oui`), l'app affiche un message dédié sans écraser de donnée.
  - Le repo GitHub est public (nécessaire pour héberger gratuitement sur Pages), mais **ne contient aucune donnée personnelle ni secret** (ni ID du Sheet, ni PIN, ni liste de coureurs). Pour limiter la découverte de l'app elle-même : nom de repo non descriptif (`br-checkin`), `robots.txt` + balise `noindex` pour bloquer l'indexation par les moteurs de recherche. C'est de l'obscurité, pas une vraie protection — la vraie barrière reste le **code bénévole**.

## Étape 1 — Installer le script (backend)

1. Dans le Sheet : **Extensions > Apps Script**.
2. Supprime le contenu par défaut de `Code.gs` et colle le contenu de [apps-script/Code.gs](apps-script/Code.gs).
3. Choisis un **code bénévole** (ex. `HALLOWEEN26`, au moins 6 caractères pour limiter le brute-force). Dans l'éditeur Apps Script : icône ⚙️ **Paramètres du projet > Propriétés du script > Ajouter une propriété** :
   - Propriété : `STAFF_PIN`
   - Valeur : ton code choisi
4. **Déployer > Nouveau déploiement** :
   - Type : **Application Web**
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   - Clique sur **Déployer**, autorise l'accès.
   - Copie l'**URL du Web App** (`https://script.google.com/macros/s/AKfycb.../exec`).

> Pour re-tester le jour J sans polluer les vraies données : la fonction `reinitialiserArrivees` (à exécuter manuellement dans l'éditeur, jamais depuis l'app) vide toute la colonne `Arrivé`.

## Étape 2 — Configurer le frontend

Ouvre [webapp/config.js](webapp/config.js) et remplace `APPS_SCRIPT_URL` par l'URL copiée à l'étape 1.4.

## Étape 3 — Héberger et publier le frontend (GitHub Pages)

✅ Déjà fait : le projet est poussé sur [github.com/guillaumebernis-source/br-checkin](https://github.com/guillaumebernis-source/br-checkin) et GitHub Pages est activé (branche `main`, racine).

L'app est disponible sur :

```
https://guillaumebernis-source.github.io/br-checkin/webapp/
```

> Le repo doit rester **public** pour que Pages fonctionne gratuitement (un repo privé désactive Pages sur un compte GitHub gratuit).

Pour publier une mise à jour (ex. après avoir renseigné `config.js` à l'étape 2) :

```bash
git add -A
git commit -m "Mise à jour config"
git push
```

Pages redéploie automatiquement en 1-2 minutes après chaque `push`.

> Alternative sans terminal : dépose les 4 fichiers de `webapp/` par glisser-déposer sur [Netlify Drop](https://app.netlify.com/drop) — tu obtiens une URL HTTPS instantanément.

## Étape 4 — Le jour J

1. Chaque bénévole ouvre l'URL de l'app sur son téléphone, saisit le **code bénévole** une seule fois (mémorisé ensuite sur son téléphone).
2. Il scanne les QR codes des dossards au fur et à mesure des arrivées.
3. Résultat affiché immédiatement :
   - 🟢 **Vert** : arrivée enregistrée, avec numéro/nom/prénom.
   - 🟠 **Orange** : "Cette personne est déjà enregistrée comme arrivée" (double scan).
   - 🔴 **Rouge** : dossard inconnu ou erreur réseau (le scan est automatiquement réessayé une fois).
4. Le Google Sheet se met à jour en direct — tu peux le garder ouvert en parallèle pour un suivi global (nombre d'arrivées, etc.).
5. Un bouton **"🔦 Activer le flash"** apparaît sous la caméra si l'appareil le supporte. **Sur iPhone (Safari), il ne s'affichera jamais** — Apple ne permet pas aux navigateurs de contrôler la torche. Sur ces téléphones, utiliser le flash natif (Centre de contrôle) en parallèle de l'app. Fonctionne en général sur Android/Chrome.
6. Si un QR est illisible (dossard abîmé, mauvaise lumière), le champ **"Ou saisir le numéro de dossard"** sous le scanner permet de pointer sans scanner.

## Limites à connaître

- **Quota Apps Script** : un compte Google grand public autorise autour de 30 exécutions simultanées du même script. Avec 50 bénévoles qui scannent de façon non parfaitement synchronisée, ça passe largement ; en cas de pic extrême, l'app réessaie automatiquement une fois avant d'afficher une erreur — demander au bénévole de rescanner suffit alors.
- **Brute-force du code bénévole** : pas de limitation de tentatives côté script. Le risque est faible pour un évènement caritatif ponctuel, mais choisis un code d'au moins 6-8 caractères plutôt qu'un simple 4 chiffres.
- Si tu veux changer le code bénévole après distribution, il suffit de modifier la propriété `STAFF_PIN` dans Apps Script — les téléphones déjà connectés recevront un `unauthorized` au prochain scan et redemanderont le nouveau code.
