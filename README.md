# Blood Runners — Pointage des arrivées par QR code

Application de pointage pour la course caritative d'Halloween. Un bénévole scanne le QR code du dossard d'un coureur avec son téléphone ; le statut "Arrivé" est mis à jour en direct dans le Google Sheet.

## Architecture

- **Base de données** : le Google Sheet existant. Aucune migration nécessaire.
- **Backend** : un Google Apps Script *lié au Sheet* ([apps-script/Code.gs](apps-script/Code.gs)), déployé comme "Web App". Il tourne avec ton compte Google, a un accès natif au Sheet (pas de clé API à gérer) et gère les écritures concurrentes avec un verrou.
- **Frontend** : une page web mobile statique ([webapp/](webapp)) qui scanne les QR codes via la caméra et appelle le Web App. Hébergée gratuitement sur GitHub Pages (ou Netlify/Vercel).
- **Sécurité** :
  - Chaque dossard a un **code secret aléatoire** (colonne `Qrcode`, différente de la colonne `Url` qui reste la page publique/don du coureur, devinable). C'est ce code secret qui est imprimé en QR sur le dossard — impossible à deviner ou reconstituer à partir du nom.
  - Un **code bénévole** (PIN) protège l'accès à l'API de pointage : sans lui, personne ne peut marquer un dossard "arrivé" même en connaissant l'URL de l'app.
  - Tout transite en HTTPS (Apps Script + GitHub Pages sont HTTPS par défaut).
  - Le double-scan est géré côté serveur : si le dossard est déjà marqué "arrivé", l'app affiche un message dédié sans écraser de donnée.

## Étape 1 — Préparer le Google Sheet

1. Ouvre le Sheet, insère une colonne entre `Url` et `Arrivé`, nomme-la **`Qrcode`**.
   L'ordre final doit être : `Numéro | Nom | Prénom | Caractéristiques | Url | Qrcode | Arrivé`.
2. Vérifie que la colonne `Arrivé` est bien au format case à cocher (Format > Validation des données > Case à cocher), pour avoir des vraies valeurs booléennes.

## Étape 2 — Installer le script (backend)

1. Dans le Sheet : **Extensions > Apps Script**.
2. Supprime le contenu par défaut de `Code.gs` et colle le contenu de [apps-script/Code.gs](apps-script/Code.gs).
3. Choisis un **code bénévole** (ex. `HALLOWEEN26`, au moins 6 caractères pour limiter le brute-force). Dans l'éditeur Apps Script : icône ⚙️ **Paramètres du projet > Propriétés du script > Ajouter une propriété** :
   - Propriété : `STAFF_PIN`
   - Valeur : ton code choisi
4. Dans le menu déroulant des fonctions (en haut, à côté de "Déboguer"), sélectionne `genererCodesManquants` puis clique sur **Exécuter**. Autorise les permissions demandées. Ça génère un code secret unique (8 caractères) pour chaque ligne du Sheet dans la colonne `Qrcode`.
5. **Déployer > Nouveau déploiement** :
   - Type : **Application Web**
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   - Clique sur **Déployer**, autorise l'accès.
   - Copie l'**URL du Web App** (`https://script.google.com/macros/s/AKfycb.../exec`).

> Pour re-tester le jour J sans polluer les vraies données : la fonction `reinitialiserArrivees` (à exécuter manuellement dans l'éditeur) remet toute la colonne `Arrivé` à faux.

## Étape 3 — Configurer le frontend

Ouvre [webapp/config.js](webapp/config.js) et remplace `APPS_SCRIPT_URL` par l'URL copiée à l'étape 2.5.

## Étape 4 — Générer les QR codes à imprimer

Chaque dossard doit porter un QR code encodant la valeur de sa colonne `Qrcode` (pas l'`Url`). Solution la plus rapide, directement dans le Sheet : dans une colonne temporaire, mets la formule (en supposant le code en `F2`) :

```
=IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" & F2)
```

Étire vers le bas, puis imprime/exporte cette colonne pour la fabrication des dossards. Tu peux ensuite supprimer la colonne temporaire (elle n'est pas utilisée par l'app).

## Étape 5 — Héberger et publier le frontend (GitHub Pages)

Depuis le dossier `webapp/` :

```bash
cd "webapp"
git init
git add index.html app.js config.js style.css
git commit -m "Blood Runners check-in app"
git branch -M main
git remote add origin https://github.com/<ton-compte>/blood-runners-checkin.git
git push -u origin main
```

Puis sur GitHub : **Settings > Pages > Deploy from branch > main / (root)**. L'app sera disponible sur `https://<ton-compte>.github.io/blood-runners-checkin/`.

> Alternative sans terminal : dépose les 4 fichiers de `webapp/` par glisser-déposer sur [Netlify Drop](https://app.netlify.com/drop) — tu obtiens une URL HTTPS instantanément, sans compte GitHub.

## Étape 6 — Le jour J

1. Chaque bénévole ouvre l'URL de l'app sur son téléphone, saisit le **code bénévole** une seule fois (mémorisé ensuite sur son téléphone).
2. Il scanne les QR codes des dossards au fur et à mesure des arrivées.
3. Résultat affiché immédiatement :
   - 🟢 **Vert** : arrivée enregistrée, avec numéro/nom/prénom.
   - 🟠 **Orange** : "Cette personne est déjà enregistrée comme arrivée" (double scan).
   - 🔴 **Rouge** : dossard inconnu ou erreur réseau (le scan est automatiquement réessayé une fois).
4. Le Google Sheet se met à jour en direct — tu peux le garder ouvert en parallèle pour un suivi global (nombre d'arrivées, etc.).

## Limites à connaître

- **Quota Apps Script** : un compte Google grand public autorise autour de 30 exécutions simultanées du même script. Avec 50 bénévoles qui scannent de façon non parfaitement synchronisée, ça passe largement ; en cas de pic extrême, l'app réessaie automatiquement une fois avant d'afficher une erreur — demander au bénévole de rescanner suffit alors.
- **Brute-force du code bénévole** : pas de limitation de tentatives côté script. Le risque est faible pour un évènement caritatif ponctuel, mais choisis un code d'au moins 6-8 caractères plutôt qu'un simple 4 chiffres.
- Si tu veux changer le code bénévole après distribution, il suffit de modifier la propriété `STAFF_PIN` dans Apps Script — les téléphones déjà connectés recevront un `unauthorized` au prochain scan et redemanderont le nouveau code.
