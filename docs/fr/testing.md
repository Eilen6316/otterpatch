# Tests

Trois couches : tests unitaires des packages (rapides, toujours exécutés), e2e headless contre le
cockpit compilé (modèle mocké), et un banc de capacités conditionné par une clé (modèle réel, noté).

## Tests unitaires des packages (`npm test -w @otterpatch/<pkg>`)

| Package | Couvre |
|---|---|
| `agent` | construction du dialecte, factory de providers, normalisation des messages, boucle de réparation, récupération de JSON, **outils doc** (read_blocks/find_text/outline/style-usage), **vérificateur word** (atterrissabilité des citations), **vérificateur drawio** (arêtes pendantes / ids fantômes) |
| `skills` | parsing de SKILL.md, appariement et classement (y compris départage par playbook), rendu/L0, `instructionsFor`, contenu des playbooks |
| `runtime` | flux d'événements, câblage du registre des vérificateurs, protocole d'**auto-vérification finale** (tour de relecture des gros changesets) |
| `adapter-*`, `writeback-surgical` | compilation + fidélité de la réécriture chirurgicale |

Runner : `node --import tsx --test` (voir chaque package.json). Remarque : les fichiers package.json
doivent rester **sans BOM** — le lecteur JSON de tsx rejette un BOM UTF-8.

## E2E headless (`node test/<name>.mjs`)

`test/harness.mjs` sert statiquement `apps/desktop/dist` et pilote un Chromium headless
(Playwright) ; `/propose-stream` est intercepté avec un SSE fixe — pas de modèle, pas de clé.
**Compiler d'abord** (`npm run build -w @otterpatch/desktop`).

| Suite | Vérifie |
|---|---|
| `word-agent-mock` (23) | le contexte inclut le formatage par paragraphe + la sélection ; atterrissage par correspondance approximative ; marques en ligne ; bascule à 4 états ; « tout accepter » efface physiquement toutes les marques |
| `word-review-e2e` (10) | l'acceptation via la carte au survol aplatit un changement ; aucune disparition de texte dans aucun état d'affichage ; le contexte du second tour exclut le texte supprimé ; un rechargement en pleine relecture conserve les approbations fonctionnelles |
| `word-docfmt-e2e` (10) | puces au niveau du document pour `all=true` + changements au niveau de la page (deux colonnes) ; véritable bascule avant/après ; accepter/rejeter par puce ; bouton de poursuite par lots |
| `word-autobatch-e2e` (5) | ⚡ la poursuite automatique envoie « 下一批 » (lot suivant) après acceptation sans clic ; s'arrête quand le plan cesse de déclarer des lots |
| `excel-agent-mock` (14) | diff façon git ; vraies valeurs de grille via le hook `__univerGet` : le rejet restaure 120, la bascule d'affichage ne ressuscite pas les éditions rejetées, « tout accepter » les fait réatterrir |
| `richdoc-toolbar` (21) | les commandes du ruban modifient réellement le document ; déduplication des icônes ; infobulles instantanées |
| `ui-smoke` (7) | l'application démarre, la grille s'affiche, puce de sélection, dépôt drawio, zéro erreur console |

Conventions : vérifier **les effets, pas la présence** (une carte qui s'ouvre doit aussi
*fonctionner* au clic — des assertions de simple présence ont un jour masqué un bouton d'acceptation
mort) ; lire l'état réel (styles calculés, valeurs de grille via des hooks de test) plutôt que les
noms de classes quand c'est possible.

## Banc de capacités (`test/expert-bench.mjs`, conditionné par une clé)

Exécute le modèle réel sur 8 tâches (Word : polissage/structure/gongwen (公文, document administratif
officiel)/ambigu ; Excel : formule/anomalie/graphique/ambigu) et note deux couches :

1. **Invariants objectifs** — type de réponse (changeset vs clarification), appels d'outils requis
   (`read_blocks`, `aggregate`, `load_skill`…), formes d'opérations requises (`=SUM`, `chart`).
2. **Juge LLM** — score de 1 à 5 selon une grille par tâche.

Les résultats sont ajoutés à `test/bench-results.jsonl` pour le suivi des tendances. Sans
`OTTERPATCH_BENCH_KEY`, il affiche SKIP et sort avec le code 0 (sûr pour la CI).

```bash
OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs   # single task
```

## Télémétrie d'acceptation (le signal de production)

Le desktop compte chaque acceptation/rejet unitaire par format × type de changement
(`localStorage['oa.telemetry']`, console : `__otterTelemetry()`). Une acceptation en baisse dans une
catégorie est un signal de régression qu'aucun test hors ligne ne peut fournir — réinjectez-le dans
les playbooks et les prompts.
