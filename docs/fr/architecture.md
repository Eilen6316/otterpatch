# Architecture

OtterPatch est une **couche de commit sécurisée** entre un agent LLM et vos documents Office. Voyez-la
comme l'ouverture d'une pull request sur un fichier `.xlsx` / `.docx` / `.drawio`.

## Pipeline

```
 user intent + selection
        │
        ▼
┌─────────────────┐   dialect (per-format tool schema)
│  Agent (LLM)    │◄─ skills (capability cards + playbooks)
│  multi-step loop│◄─ read tools (sheet: read_range/aggregate · doc: read_blocks/find_text/…)
└───────┬─────────┘
        │ propose_changeset (the ONLY mutation exit)
        ▼
┌─────────────────┐
│ ChangeSet       │  format-agnostic: anchors (quote / A1 / cell-id) + edit ops
└───────┬─────────┘
        │ shadow verification (per-format verifier registry)
        │   fail → structured report fed back → model repairs (propose→observe→repair, ≤2 rounds)
        │   pass + large changeset → one final semantic self-check round
        ▼
┌─────────────────┐
│ Reviewable diff │  workspace: inline tracked changes / grid replay / board highlight
│                 │  rail: git-style unified diff, per-item accept/reject
└───────┬─────────┘
        │ accepted subset
        ▼
┌─────────────────┐
│ Surgical commit │  OOXML / XML patch — untouched parts byte-identical
│                 │  + fidelity report (touched parts, score)
└─────────────────┘
```

## Carte des packages

| Package | Rôle |
|---|---|
| `packages/core` | Types agnostiques au format : `Anchor`, `ChangeSet`, `EditOp`, `AbstractStyle`, registre d'adaptateurs, contrats de réécriture (writeback) |
| `packages/agent` | Intention → `ChangeSet` contraint. `ModelClient` agnostique au fournisseur (Claude natif + compatibles OpenAI ×8). La boucle multi-étapes, les outils de lecture et les vérificateurs vivent ici |
| `packages/skills` | Hub de compétences : analyse de SKILL.md, appariement, divulgation progressive, cartes de capacités intégrées + playbooks de domaine |
| `packages/runtime` | Orchestrateur headless : `propose → diff → commit` + flux d'événements JSON. Registre de vérificateurs + enveloppe d'auto-vérification finale. Partagé par le serveur MCP, la CLI et le desktop |
| `packages/adapter-*` | Compilation/réécriture par format : `univer` (Excel), `word` (marques de révision `w:ins`/`w:del` + `rPrChange`/`pPrChange`), `drawio`, `pdf` (AcroForm), `pptx` |
| `packages/writeback-surgical` | Le moteur de réécriture chirurgicale OOXML (validé : 30/31 parties identiques à l'octet près sur un vrai docx de 531 Ko) |
| `apps/desktop` | L'interface cockpit (Vite + React + Electron) : espaces de travail (feuille Univer, Word en texte riche, tableau drawio), rail de revue, panneau de modèles BYOK |
| `apps/mcp-server` | Serveur MCP (stdio) + CLI headless + pont HTTP local `otterpatch-serve` pour le cockpit |

## Détails du flux de données

- **Le contexte est une projection, pas le fichier.** Chaque espace de travail assemble un contexte en
  lecture seule pour le modèle : Excel envoie un aperçu de la feuille + un instantané de la grille complète
  (pour les outils de lecture, pas pour le prompt) ; Word envoie un résumé de style par paragraphe + un
  condensé du système de styles, plus un instantané des blocs du document entier
  (`ProposeRequest.doc`) pour les outils de lecture. Les modifications suivies en attente sont exclues via la
  *projection propre* (le modèle voit toujours le texte « tel qu'accepté » — pas d'empoisonnement du contexte).
- **Les ancres sont logiques, pas positionnelles.** Les modifications Word s'ancrent sur `quote` (vérifié
  réel et unique), Excel sur des références A1, drawio sur des identifiants de cellules. Le vérificateur de
  document / vérificateur de grille / vérificateur de topologie rejettent les ancres qui ne peuvent pas
  atterrir, et le modèle les répare dans le même tour.
- **Le desktop applique les propositions de manière optimiste** sous forme de marques révisables
  (modifications suivies / valeurs de grille avec état antérieur capturé), de sorte que la revue se fait
  sur place. Le rejet rejoue l'état antérieur capturé ; l'acceptation finalise physiquement.
- **Le commit côté serveur est indépendant** : le sous-ensemble accepté du ChangeSet est appliqué au
  fichier original téléversé par la réécriture chirurgicale — l'aperçu dans l'application ne touche jamais
  votre fichier.
