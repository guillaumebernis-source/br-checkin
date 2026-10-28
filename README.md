# Blood Runners — Pointage des arrivées par QR code

Application de pointage pour la course caritative d'Halloween. Un bénévole scanne le QR code du dossard d'un coureur avec son téléphone ; le statut « Arrivé.e ? » est mis à jour en direct dans le Google Sheet.

## Architecture

- **Base de données** : le Google Sheet existant. Aucune migration nécessaire.
- **Backend** : un Google Apps Script *lié au Sheet* ([apps-script/Code.gs](apps-script/Code.gs)), déployé comme "Web App". Il tourne avec ton compte Google, a un accès natif au Sheet (pas de clé API à gérer) et gère les écritures concurrentes avec un verrou.
- **Frontend** : une page web mobile statique ([webapp/](webapp)) qui scanne les QR codes via la caméra et appelle le Web App. Hébergée gratuitement sur GitHub Pages (ou Netlify/Vercel).
- **Sécurité** :
  - Les QR codes déjà imprimés sur les dossards encodent l'`Url` (colonnes `D` et `G`) — le pointage se fait donc directement sur cette colonne, sans étape de préparation supplémentaire.
  - Un **code bénévole** (PIN) protège l'accès à l'API de pointage : sans lui, personne ne peut marquer un dossard "arrivé" même en connaissant l'URL de l'app. C'est la protection principale, puisque l'`Url` elle-même suit un motif prévisible (nom+prénom) et n'est donc pas un secret.
  - Tout transite en HTTPS (Apps Script + GitHub Pages sont HTTPS par défaut).
  - Le double-scan est géré côté serveur : si le dossard est déjà marqué "arrivé" (`Arrivé.e ?` = `oui`), l'app affiche un message dédié sans écraser de donnée.
  - Le repo GitHub est public (nécessaire pour héberger gratuitement sur Pages), mais **ne contient aucune donnée personnelle ni secret** (ni ID du Sheet, ni PIN, ni liste de coureurs). Pour limiter la découverte de l'app elle-même : nom de repo non descriptif (`br-checkin`), `robots.txt` + balise `noindex` pour bloquer l'indexation par les moteurs de recherche. C'est de l'obscurité, pas une vraie protection — la vraie barrière reste le **code bénévole**.

## Étape 1 — Installer le script (backend)

0. Le script lit la feuille `Feuille 1` **par position de colonne** (le nom des en-têtes n'a aucune importance) : `A` Numéro, `B` Nom, `C` Tel, `D` Url, `E` Arrivé.e ?, `F` Heure émargement, `G` Qrcode. Si tu insères ou déplaces une colonne, mets à jour `COL` en haut de [apps-script/Code.gs](apps-script/Code.gs). Le script écrit `oui` en `E` et la date et l'heure exactes du scan en `F` (vraie valeur date-heure, triable). Pense à vérifier le fuseau horaire du Sheet (**Fichier > Paramètres**, onglet Général) : l'heure affichée suit ce réglage.
   - **Qrcode (`G`)** contient le lien de l'image du QR (`quickchart.io/qr?text=…`). La valeur lue par le scanner est son paramètre `text`, identique à l'`Url` (`D`) : le script retrouve le coureur avec l'une ou l'autre.
   - Un coureur compte dans « toujours en course » **uniquement si son `Nom` est renseigné** : les numéros pas encore attribués sont ignorés.
   - **Garde-fous** : le script refuse d'écrire (message « Colonnes du Sheet incohérentes ») si `E` ou `F` contiennent déjà autre chose que `oui`/`non`/`DNS`/une date, par exemple après un déplacement de colonnes. Il vérifie aussi que la ligne trouvée correspond bien au code scanné, même après un tri des lignes ; la fonction `viderCache` (à lancer à la main) force une relecture complète.
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

> Pour re-tester le jour J sans polluer les vraies données : la fonction `reinitialiserArrivees` (à exécuter manuellement dans l'éditeur, jamais depuis l'app) vide les colonnes `Arrivé.e ?` et `Heure émargement` (arrivées et non-partants ; elle refuse de s'exécuter si ces colonnes contiennent autre chose que oui/non/DNS/une date).

**Mettre à jour le script sans changer l'URL du Web App** : colle le nouveau `Code.gs`, puis **Déployer > Gérer les déploiements > icône crayon sur le déploiement existant > Version : Nouvelle version > Déployer**. L'URL reste la même, rien à changer dans `config.js`. (« Nouveau déploiement » génère au contraire une nouvelle URL à reporter dans `config.js`.)

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
4. Le Google Sheet se met à jour en direct — tu peux le garder ouvert en parallèle pour un suivi global (nombre d'arrivées, etc.). Chaque arrivée est horodatée dans la colonne `Heure émargement` ; un doublon ne modifie jamais l'heure déjà enregistrée.
5. Le **menu burger** (en haut à droite) donne accès à trois écrans :
   - **Émargement** : le scanner d'arrivées.
   - **Coureurs toujours en course** : le nombre de coureurs qui ne sont ni arrivés ni non partants, avec un bouton pour afficher leur liste (par numéro de dossard, avec leur nom et leur téléphone) et un bouton « Actualiser ». Une disquette 💾 à côté du téléphone le copie dans le presse-papiers (✅ si c'est copié). Le téléphone vient de la colonne `C` ; si une cellule au format nombre a perdu son 0 initial, il est rétabli pour les numéros à 9 chiffres. Les chiffres sont lus dans le Sheet à l'ouverture ou à l'actualisation, pas en temps réel.
   - **Non partant** : le même scanner (et la même saisie manuelle), mais le flash écrit **`DNS`** dans `Arrivé.e ?` et l'heure dans `Heure émargement`. Un bandeau rouge « Attention : flash pour les non-partants » rappelle le mode. Un coureur DNS n'est plus compté « en course ». Le script n'écrase jamais un `oui` par un `DNS` ni l'inverse : il prévient le bénévole (message orange) au lieu de modifier la ligne.
   La caméra est coupée quand on quitte les écrans de scan et relancée au retour ; elle reste active en passant d'Émargement à Non partant.
6. Un bouton **"🔦 Activer le flash"** apparaît sous la caméra si l'appareil le supporte. **Sur iPhone (Safari), il ne s'affichera jamais** — Apple ne permet pas aux navigateurs de contrôler la torche. Sur ces téléphones, utiliser le flash natif (Centre de contrôle) en parallèle de l'app. Fonctionne en général sur Android/Chrome.
7. L'app peut être ajoutée à l'écran d'accueil (icône « BR Pointage » : BR ensanglanté coiffé d'un chapeau de sorcière devant la pleine lune) : iPhone via Safari > Partager > Sur l'écran d'accueil, Android via le menu de Chrome > Ajouter à l'écran d'accueil. Elle s'ouvre alors en plein écran, et le code bénévole est à ressaisir une fois (Safari et l'app installée ne partagent pas leur mémoire). Les icônes sont dans `webapp/` (`icon.svg` est la source vectorielle).
8. Si un QR est illisible (dossard abîmé, mauvaise lumière), le champ **"Ou saisir le numéro de dossard"** sous le scanner permet de pointer sans scanner.

## Limites à connaître

- **Quota Apps Script** : un compte Google grand public autorise autour de 30 exécutions simultanées du même script. Avec 50 bénévoles qui scannent de façon non parfaitement synchronisée, ça passe largement ; en cas de pic extrême, l'app réessaie automatiquement une fois avant d'afficher une erreur — demander au bénévole de rescanner suffit alors.
- **Brute-force du code bénévole** : pas de limitation de tentatives côté script. Le risque est faible pour un évènement caritatif ponctuel, mais choisis un code d'au moins 6-8 caractères plutôt qu'un simple 4 chiffres.
- Si tu veux changer le code bénévole après distribution, il suffit de modifier la propriété `STAFF_PIN` dans Apps Script — les téléphones déjà connectés recevront un `unauthorized` au prochain scan et redemanderont le nouveau code.
