# La boucle Agent

Tout ce que le modèle peut faire, et comment nous le gardons honnête.

## Routage (trois sorties, une boucle)

Le prompt système (`ROUTING_PREAMBLE`, `packages/agent/src/prompts/agent-loop.ts`) fixe le
contrat : le modèle doit terminer chaque tour par exactement un appel d'outil —

- `answer_user` — questions/conseil ; ne touche jamais au document
- `propose_changeset` — la **seule** sortie de mutation ; planifier d'abord, les modifications sont relues avant d'atterrir
- `ask_user` — un tableau de clarification guidé (2 à 4 options par question) lorsque l'intention est réellement
  ambiguë et que deviner coûterait cher

Entre ces sorties, le modèle peut appeler des **outils de lecture** pendant au plus `STEP_LIMIT = 8` étapes de boucle. Les deux
canaux de modèle (`anthropic.ts`, `openai-compat.ts`) implémentent la même boucle sur les définitions
d'outils partagées et agnostiques du fournisseur dans `sheet-tools.ts` / `doc-tools.ts`.

## Outils de lecture (percevoir avant d'agir)

| Format | Outil | Rôle |
|---|---|---|
| Excel | `read_range` | valeurs de cellules exactes pour toute plage A1 (ne jamais deviner à partir d'échantillons) |
| Excel | `aggregate` | agrégation de colonnes avec `groupBy` / `where` — tableaux croisés, sommes, statistiques d'anomalies |
| Word | `read_blocks` | texte intégral de plages de paragraphes (le contexte du prompt tronque les paragraphes longs — les citations doivent provenir du texte réel) |
| Word | `find_text` | toutes les occurrences avec numéros de bloc — vérifications d'unicité des citations |
| Word | `get_outline` | arbre des titres + diagnostic des sauts de niveau |
| Word | `get_style_usage` | distribution des styles/polices/tailles/alignements — la matière première d'un audit typographique |
| tous | `load_skill` | charger les instructions complètes d'un playbook métier (voir [skills.md](./skills.md)) |

Les instantanés (snapshots) accompagnent la requête (`ProposeRequest.sheet` / `.doc`) et ne sont visibles que par les
outils — ils ne sont pas collés dans le prompt.

## Vérification fantôme : proposer → observer → réparer

Chaque `propose_changeset` est vérifié avant de devenir un diff (registre de vérificateurs dans
`packages/runtime/src/runtime.ts`, `registerVerifier(format, make)`) :

- **Excel** (`buildGridVerifier`) — recalcul + bornes + détection de correspondances en double
- **Word** (`buildDocVerifier`) — chaque citation doit exister **et être unique** dans le texte source ; les modifications
  vides et les correspondances en double sont signalées
- **drawio** (`buildDrawioVerifier`) — intégrité de la topologie : les cibles de `update/delete/move` doivent exister ;
  les nouvelles arêtes doivent se connecter à des nœuds existants ou de la même proposition (pas d'arêtes pendantes) ; pas d'ids en double

Les échecs sont renvoyés au modèle sous forme de rapport structuré dans le même tour ; il peut réparer jusqu'à
`maxRepairs = 2` fois.

**Auto-vérification finale** (`withFinalSelfCheck`) : dès qu'un *grand* changeset (≥5 modifications) passe la vérification
structurelle, le modèle obtient exactement un tour de « relis ton propre travail dans son ensemble » — complétude,
conflits, meilleures approches — puis resoumet (inchangé s'il est satisfait). Les petits changesets sautent cette étape.

## Cache de prompt

Le canal Anthropic scinde le prompt système en un **préfixe stable** (routage + dialecte +
skills — identique d'un tour à l'autre) et une **queue volatile** (l'instantané du document de ce tour), chacun avec
un point d'arrêt `cache_control`. Résultat : chaque étape d'une boucle de 8 étapes touche le cache pour l'intégralité du
prompt système ; d'un tour à l'autre, le préfixe stable reste en cache.

## Traitement par lots (en série, jamais en parallèle)

Les sorties longues sont découpées en lots : le plan déclare « les N premiers éléments », et après acceptation
l'utilisateur peut cliquer sur **继续下一批** (continuer avec le lot suivant) — ou activer **⚡自动续批** (enchaînement automatique des lots, opt-in, persisté), qui
envoie automatiquement « 下一批 » (lot suivant) après chaque acceptation, plafonné à 5 lots automatiques consécutifs. Chaque lot est un
cycle complet proposer → vérifier → relire, ancré sur le document *courant*.

Pourquoi pas des sous-agents parallèles pour les lots ? Toutes les ancres (citations / références A1) sont résolues contre une
seule révision du document ; dès que le lot A atterrit, les ancres du lot B deviennent obsolètes — no-ops silencieux ou
modifications mal placées. Le parallélisme est sûr pour les **lectures** (diagnostic en éventail), mais les écritures doivent converger vers
un unique changeset ancré en série. Si des sous-agents sont un jour introduits, la conception sera :
lecteurs parallèles → un rédacteur → un changeset → une relecture.

## Historique et état visibles par le modèle

`buildHistory` projette chaque tour passé en une seule ligne, y compris le **résultat net** — « l'utilisateur
a accepté N éléments » / « l'utilisateur a annulé ceux-ci » — afin que le modèle ne repropose jamais des changements déjà appliqués ni ne construise
sur des changements annulés. L'état d'approbation survit à l'élagage du contexte (les tours supprimés laissent un résumé de statut).
