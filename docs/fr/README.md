# Documentation OtterPatch

Documentation destinée aux contributeurs et aux intégrateurs. Commencez par l'architecture, puis plongez dans la couche que vous modifiez.

| Doc | Ce qu'il couvre |
|---|---|
| [architecture.md](./architecture.md) | Le pipeline propose → diff → review → commit, la carte des packages, les invariants fondamentaux |
| [agent.md](./agent.md) | La boucle de l'agent : routage, outils de lecture, vérification et réparation sur copie fantôme (shadow), auto-contrôle, mise en cache des prompts, traitement par lots |
| [skills.md](./skills.md) | Le système de skills : cartes de capacités vs playbooks, divulgation progressive (`load_skill`), installation de SKILL.md externes |
| [review-ux.md](./review-ux.md) | L'expérience de revue : modifications suivies en ligne dans Word (aplatissement à l'acceptation), puces au niveau du document, rejeu de l'état antérieur dans Excel |
| [testing.md](./testing.md) | Pyramide de tests : tests unitaires par package, harnais e2e headless, banc de capacités, télémétrie d'acceptation |

## Le pitch en un paragraphe

Les agents ne devraient pas modifier vos fichiers directement. Dans OtterPatch, un agent ne fait que **proposer** un
`ChangeSet` structuré ; le système le vérifie contre une copie fantôme (et fait réparer au modèle ses propres
erreurs), affiche un **diff révisable** — modifications suivies en ligne dans l'espace de travail, diff façon git
dans le panneau latéral — et n'écrit en retour, **chirurgicalement**, qu'après approbation humaine élément par élément :
seules les parties touchées du fichier changent, tout le reste reste identique à l'octet près.

## Invariants fondamentaux (à ne jamais casser)

1. **Point de sortie de mutation unique** — chaque modification de document passe par `propose_changeset`. Aucun autre outil ne mute les documents.
2. **Revue avant commit** — rien n'atterrit dans le fichier sans acceptation/rejet humain élément par élément.
3. **Écriture en retour chirurgicale** — les parties non touchées restent identiques à l'octet près ; la fidélité est mesurée et rapportée.
4. **Écritures en série** — les propositions sont ancrées sur l'état courant du document ; les lots se poursuivent en série (jamais d'écrivains parallèles), de sorte que les ancres ne peuvent pas devenir obsolètes en cours de route.
