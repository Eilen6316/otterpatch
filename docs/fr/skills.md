# Skills

`packages/skills` est le hub de connaissances : ce que l'agent *sait bien faire*, maintenu en dehors
des prompts de base afin de pouvoir croître sans alourdir chaque requête.

## Deux types de skills intégrés

| Type | Exemple | Contenu | Injecté en tant que |
|---|---|---|---|
| **Cartes de capacité** | `xlsx`, `docx`, `pptx`, `pdf`, `drawio` | une ligne « ce que ce format prend en charge » | L0 : nom + description dans le prompt système |
| **Playbooks** (manuels de tactique) | `docx-gongwen`, `xlsx-financial`, `chart-selection` | checklists + idiomes de changeset + anti-patterns | carte L0, marquée 【有打法手册】 (« playbook disponible ») ; texte complet à la demande via `load_skill` |

Les playbooks intégrés existent sous forme de **véritables fichiers SKILL.md** dans
`packages/skills/skills/<name>/SKILL.md` (convention de répertoire Anthropic Agent Skills — un
dossier par skill, frontmatter YAML pour le L0, corps markdown pour le L1). `playbooks.ts` n'est
qu'un chargeur ; modifiez le markdown, aucun changement de code n'est nécessaire :

- **`docx-gongwen`** — mise en page des documents officiels (公文, documents administratifs
  officiels) selon GB/T 9704 : le système de tailles de police titre/corps (titre en 二号小标宋 —
  corps 2, Xiaobiao Song — corps en 三号仿宋 — corps 3, FangSong), la hiérarchie de numérotation
  des titres 一、/(一)/1./(1), la ponctuation pleine chasse, et les idiomes de changeset pour les
  appliquer (`block` pour les vrais titres avant tout balayage `all=true`).
- **`xlsx-financial`** — contrôles de rapprochement (totaux = formules, jamais codés en dur),
  formats de nombres monétaires/pourcentages, détection d'anomalies, et la règle absolue :
  vérifier avec `read_range`/`aggregate` avant d'écrire toute conclusion numérique ; ne jamais
  écraser les données d'origine (原始数据).
- **`chart-selection`** — un arbre de décision de la question → type de graphique, plus des règles
  de plancher professionnelles (barres à ligne de base zéro, ≤6 couleurs, ordre de tri significatif,
  titres formulés comme des conclusions).

## Divulgation progressive

1. `SkillLibrary.match(intent, format)` note les cartes : correspondance de format +3, chaque
   mot-clé correspondant +1, et un départage de +0,5 pour les playbooks **uniquement lorsqu'un
   mot-clé a réellement correspondu** (les intentions génériques classent toujours la simple carte
   de capacité en premier).
2. `render()` injecte les meilleures cartes (L0) dans le prompt système ; les cartes de playbook
   portent une instruction explicite : *le charger avec `load_skill` avant d'agir si pertinent*.
3. L'outil `load_skill` (branché par `Agent.withSkillTools` via `RespondOptions.extraTools`)
   renvoie le markdown complet du playbook comme résultat d'outil — la connaissance n'arrive que
   lorsqu'elle est nécessaire.

## Skills externes

Tout ce qui est spécifique à un secteur ou à une équipe reste hors des skills intégrés. Les hôtes
peuvent installer un `SKILL.md` standard (compatible Anthropic Agent Skills — frontmatter YAML +
corps markdown) à l'exécution :

```ts
library.install(skillMdText, 'file:./skills/my-company-report.md');
```

La carte analysée rejoint immédiatement le matching/rendu/`load_skill`. Le L2 (scripts exécutables)
n'est délibérément pas activé — les playbooks textuels apportent l'essentiel de la valeur avec un
risque sandbox nul.

## Écrire un bon playbook

- Commencez par une **checklist que le modèle exécute avant d'agir** — le diagnostic vaut mieux que
  les prescriptions.
- Incluez des **idiomes de changeset** : quelles opérations, dans quel ordre (p. ex. « définir
  d'abord les vrais titres via `block`, puis `all=true` pour la base du corps — sinon le balayage
  aplatit vos titres »).
- Incluez des **anti-patterns** (« ne pas simuler des titres avec gras+taille manuels »).
- Restez sous ~50 lignes. Il est chargé dans un contexte vivant ; la densité gagne.
