# Capability Bench — Journal de calibration

`test/expert-bench.mjs` exécute le jeu de tâches expertes avec de vrais modèles (8 scénarios mono-tour + 4 scénarios de dialogue multi-tours), avec deux niveaux de notation :
invariants objectifs (type de réponse / outils obligatoires / forme du changeset, ancres comprises) + LLM-judge (1-5).
Les résultats de chaque tour sont ajoutés dans `test/bench-results.jsonl`. Le mode d'exécution est décrit dans le commentaire d'en-tête du fichier (SKIP automatique sans clé, sûr en CI).

## 2026-07-02 · deepseek / deepseek-v4-pro · Calibration en six tours

| Tour | Tâches | Échecs d'invariants | Score moyen du judge | Actions et découvertes du tour |
|---|---|---|---|---|
| R1 | 8 | 2 | 2.75 | Ligne de base. Découvertes : sur des requêtes ambiguës, gros changements sans clarification ×2 ; le judge n'est pas adapté aux modèles à raisonnement |
| R2 | 8 | 1 | 3.38 | Correctif : ajout à la route ③ du critère dur « si même la catégorie d'action n'est pas précisée, ask_user obligatoire » → les deux tâches ambiguous passent à 5/5 ; le judge reçoit un repli reasoning_content. Nouvelle découverte : w-gongwen (公文, document administratif officiel) heurte la limite de 8 étapes |
| R3 | 8 | **0** | 4.00 | Correctif : STEP_LIMIT 8→12 (le flux expert load_skill + audit de styles + auto-vérification exige plus d'étapes) → tout passe |
| R4 | 12 | 1* | 4.42 | Ajout de 4 scénarios multi-tours (concrétisation après clarification / lot suivant sans doublon / retouche ancrée sur le nouveau texte / retour au texte d'origine après annulation), 3 obtiennent 5/5 dès la première exécution. Les correctifs de points faibles portent leurs fruits : w-polish 1→5 (exemple étalon de polissage + exigence dure de diagnostic), w-gongwen 3→5 (cinq champs de la première passe du 公文). *Le seul échec est un bug d'assertion du bench lui-même (quote présent dans anchors mais pas dans edits) |
| R5 | 12 | 3 | 4.67 | Correctifs : déclaration de lot suivant (mt-next-batch 3→5), règle par défaut du type de graphique (x-chart 2→5), assertion d'ancres du bench. Nouvelle découverte : **motif de clôture en texte nu** ×3 (plan/clarification rédigés en prose sans appel d'outil ; le judge se laisse berner par de la belle prose et met 5 — d'où la valeur des invariants objectifs) |
| R6 | 12 | **0** | **4.58** | Correctifs : NUDGE_TOOLIFY (couche canal : une relance de mise en outil quand la clôture est un texte non vide) → motif de texte nu éradiqué ; visibilité des types dans readRange (les nombres au format texte sont rendus comme `"71"(文本数字⚠SUM会漏加)`) → le défaut chronique de x-sum, noté 3 sur deux tours, passe à **5/5** (« détecte que C7 est un nombre au format texte et le corrige spontanément ») |

### Liste complète des correctifs (bilan des six tours)
1. Critère dur de clarification (prompt · route ③) : toute requête sans objectif explicite exige ask_user
2. STEP_LIMIT 8→12 (loop) : budget d'étapes pour les flux experts
3. Déclaration de lot suivant (prompt · route ⑥) : chaque tour de lot suivant doit annoncer le lot et ne pas répéter les éléments déjà écrits
4. Type de graphique par défaut (prompt · excel ④) : comparaison catégorielle → bar par défaut ; sans mention de « proportion », pas de pie
5. **Visibilité des types dans readRange (couche outil)** : marquage explicite des nombres au format texte — une information critique pour la justesse ne doit pas dépendre du matching de skill, elle doit être visible directement dans la sortie de l'outil
6. **NUDGE_TOOLIFY (couche canal)** : une relance de mise en outil sur les clôtures en texte nu — le contrat de routage « un appel d'outil par tour » est garanti par le code
7. Assertion d'ancres du bench (le test lui-même) : opsMust couvre anchors

### Enseignements méthodologiques
- Les correctifs se déclinent en trois couches : **prompt** (préférences de comportement) → **sortie d'outil** (visibilité de l'information) → **code du canal** (garantie contractuelle) ; plus on descend, plus c'est déterministe
- Le judge se laisse berner par une belle prose, les invariants objectifs non — il faut les deux niveaux
- Les scores mono-tour ont de la variance (x-anomaly oscille entre 5/2/5/4) ; un point faible n'est avéré que s'il se reproduit sur deux tours consécutifs

### Points restant sous observation
- mt-next-batch 3/5 : le lot suivant chevauche encore parfois des éléments sensibles du lot précédent — le plan le déclare mais les edits ne l'évitent pas complètement
- w-gongwen 4/5 : frontière de rendu des polices approchantes telles que 小标宋 (Xiaobiao Song, police officielle des titres de documents administratifs)
- La véritable étoile polaire reste la télémétrie du taux d'acceptation élément par élément côté desktop (`__otterTelemetry()`)

### Reproduction

```bash
OTTERPATCH_BENCH_KEY=<key> OTTERPATCH_BENCH_PROVIDER=deepseek BENCH_MODEL=deepseek-v4-pro node test/expert-bench.mjs
```
