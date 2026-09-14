# Daf Yomi — kit de préchargement

Deux fichiers, à déposer dans un dépôt GitHub (public ou gist secret) :

- `daf-template.jsx` — le composant React, avec le marqueur `__PRELOAD__` à la place des données
- `build_daf.py` — précharge une daf depuis Sefaria et remplit le marqueur

## Pourquoi

Le CSP des artifacts Claude bloque les appels vers `sefaria.org` depuis le
navigateur. Les données (texte, liens, Rachi, Tossefot, fin de la daf
précédente) sont donc récupérées en amont et embarquées dans le fichier.
Les appels IA, eux, partent bien du navigateur et restent en direct.

Conséquence : **un fichier = une daf**. Il faut le régénérer chaque jour.

## Le matin

Ouvrir un chat Claude et écrire, en remplaçant `<USER>` et `<REPO>` :

> Récupère `https://raw.githubusercontent.com/<USER>/<REPO>/main/build_daf.py`
> et `https://raw.githubusercontent.com/<USER>/<REPO>/main/daf-template.jsx`
> dans ton sandbox, lance `python3 build_daf.py`, et présente-moi le `.jsx`
> produit.

(Pour un gist secret : l'URL raw du gist, qui ne demande pas d'authentification.)

Pour une autre daf que celle du jour :

    python3 build_daf.py --date 2026-09-20
    python3 build_daf.py --ref "Bava Metzia 42a"

## Ce que le script vérifie tout seul

- daf sur deux amudim (`Chullin 137`) : le texte est aplati et **les ancres des
  commentaires sont renumérotées en continu** (137b:1 → §23), sinon les numéros
  de segments donnés au modèle ne pointent pas sur le texte affiché
- version française Sefaria si elle existe (sinon l'app la fait générer)
- absence de daf précédente (début de traité), commentateur manquant, lien
  indisponible : dégradation silencieuse, le build passe quand même

## Limites connues

- nouvel artifact chaque jour, donc nouveau lien
- notes et historique (`window.storage`) probablement non repris d'un build à l'autre
- navigation par date et pager ‹ › désactivés : une seule daf est embarquée
- seuls Rachi et Tossefot sont consultables en texte intégral (`COMMENTATORS`
  en tête du script pour en ajouter)
