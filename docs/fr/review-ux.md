# L'expérience de revue

Chaque proposition de l'agent est examinée **sur place, dans l'espace de travail** — pas seulement dans un panneau latéral.

## Word : modifications suivies en ligne

Les propositions arrivent sous forme de trois canaux de marques en ligne (comme le suivi des modifications de Word / le mode suggestion de Google Docs) :

- **Insertions** — vertes, soulignées (`ins.rd-ins`)
- **Suppressions** — rouges, barrées, visuellement en retrait (`del.rd-del`)
- **Changements de format** — soulignement pointillé + une petite pastille de glyphe (`B`/`I`/`U`/`A±`/`¶`…)

Autour d'elles :

- **Bascule d'affichage à 4 états** (flottante au-dessus de la page) : 原文 / 修订 / 清样 / 改后 — c'est-à-dire original, balisage complet, épreuve propre avec barres de changement, version finale. Contrôle segmenté à curseur coulissant avec un compteur de changements et une navigation pas à pas ‹ ›.
- **Carte au survol par changement** — type, ancien → nouveau, ✓ accepter / ✕ rejeter, exactement là où vous lisez. Clavier : Tab pour aller à un changement, Entrée/Espace ouvre la carte.
- **Barres de changement dans la gouttière** sur tout bloc contenant un changement ; liaison au survol dans les deux sens entre le rail et l'inline.
- **Pastilles au niveau du document** — `all=true` (format appliqué à tout le document) et les changements au niveau de la page (colonnes / marges / orientation) n'ont pas d'ancrage en ligne ; ils apparaissent donc comme des pastilles à côté de la bascule, avec leurs propres ✓/✕ ; la vue 原文 (original) les annule réellement (polices, nombre de colonnes, état de la page) pour une vraie comparaison avant/après.

### Aplatissement à l'acceptation (le cœur architectural)

**Accepter est physique, pas cosmétique.** À l'acceptation, la suppression est retirée du DOM, l'insertion est déballée en contenu simple (stylé), et tous les attributs de révision sont supprimés. L'enveloppe se dégrade en un span invisible `data-undo` qui maintient l'annulation fonctionnelle pour *ce tour-ci* ; il est balayé à l'arrivée de la proposition suivante.

Pourquoi c'est important — tout ce qui se trouve en aval reste propre **par construction** :

- Le contexte de l'agent (`getText`/`getContext`) lit une *projection propre* (suppressions exclues), de sorte que les citations du tour suivant ne peuvent pas chevaucher ancien/nouveau texte — pas de boucle de corruption cumulative.
- Le compteur de mots, rechercher et remplacer, l'impression, la copie ne voient que le document réel.
- Recharger en pleine revue est sûr : la comptabilité des acceptations (`changeSetId::editId`) est persistée ; `applyEdit` est idempotent ; le rejet retombe sur une restauration au niveau du DOM quand la carte d'annulation en mémoire a disparu.

### UX du traitement par lots

Si le plan déclare des lots (« 先做第一批… », c'est-à-dire « faire d'abord le premier lot… »), le tour accepté affiche **继续下一批 ›** (continuer avec le lot suivant) ainsi qu'une bascule opt-in **⚡自动续批** (enchaînement automatique des lots, persistée). L'enchaînement automatique envoie « 下一批 » (lot suivant) après chaque acceptation — en série, chaque lot étant ré-ancré et re-revu — avec un plafond de 5 lots consécutifs.

## Excel : rejeu de l'état antérieur

Au moment de la proposition, le desktop capture **l'état antérieur complet** de chaque cellule touchée — valeur *et formule*, remplissage, couleur de police, gras. Le rejet (ou la vue 原文) rejoue exactement les dimensions touchées par l'opération : rejeter une modification de valeur n'écrase pas une modification de style sur la même cellule, les formules reviennent en tant que formules, les remplissages de l'utilisateur survivent. La bascule rapide 原文/改后 respecte les décisions par élément (une modification rejetée ne ressuscite pas quand vous changez de vue).

## Le rail (les deux formats)

Un **diff unifié de style git** toujours visible : des hunks `@@ ref label` avec des lignes rouges − / vertes + et des lignes `~` de format, acceptation/rejet par élément, barre de progression, « 已采纳 · N 处 » (N changements acceptés) avec annulation. Survoler un hunk met en évidence le changement en ligne correspondant, et inversement.

## Télémétrie

Chaque décision par élément incrémente les compteurs de `localStorage['oa.telemetry']`, indexés par format × type de changement (`text` / `style` / `value` / `structure` / `object`). Lisez-les dans la console via `__otterTelemetry()`. Le taux d'acceptation par catégorie est la métrique de vérité terrain « l'agent est-il réellement expert ? » — la catégorie la moins bien notée est la prochaine cible de playbook/prompt.
