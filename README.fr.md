# OPAL

[English](./README.md) · [中文](./README.zh.md) · [日本語](./README.ja.md) · **Français** · [한국어](./README.ko.md)

> **O**ffice **P**atch & **A**gent **L**ayer — une **couche de commit sécurisé**, pilotée par agent et révisable, pour vos documents.
> Sélectionnez une zone → dites ce que vous voulez → relisez le diff → réécriture haute fidélité.
> (Imaginez : ouvrir une PR sur votre `.xlsx` / `.docx` / `.drawio`.)

> ⚠️ Ébauche initiale — en cours de développement actif.

## Pourquoi

Un agent ne devrait pas modifier vos fichiers directement. Dans OPAL, un agent se contente de
**proposer** un `ChangeSet` structuré ; le système le valide, l'applique à une copie fantôme,
affiche un **diff révisable** (accepter/rejeter par bloc), puis effectue une réécriture
**chirurgicale** — seules les parties touchées changent, le reste reste identique au bit près.

Validé sur un véritable `.docx` de 531 Ko : la réécriture chirurgicale a gardé **30 parties sur 31
identiques au bit près**, alors qu'un aller-retour par le modèle en a réécrit 11 sur 31.
Voir `packages/writeback-surgical`.

## Structure

```text
packages/core/                couche d'abstraction agnostique au format
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               intention → ChangeSet contraint ; BYOK, 8 fournisseurs
                              (Claude natif + compatibles OpenAI : DeepSeek/GLM/Kimi/Doubao/MiniMax/Gemini/ChatGPT)
packages/adapter-univer/      adaptateur Excel (Univer) — compilateur ChangeSet → XML de feuille
packages/adapter-drawio/      adaptateur drawio — moteur d'opérations mxCell + réécriture chirurgicale au niveau du diagramme
packages/writeback-surgical/  réécriture chirurgicale OOXML — validée + testée
apps/desktop/                 UI cockpit à divulgation progressive + configuration de modèle BYOK (Vite + React ; Electron plus tard)
```

## Développer

```bash
npm install
npm run typecheck                  # tsc -b sur l'ensemble de packages/*
npm run dev                        # UI cockpit → http://localhost:5173
npm test -w @opal/core             # registre d'adaptateurs
npm test -w @opal/agent            # intention → ChangeSet (modèle simulé + fabrique 8 fournisseurs)
npm test -w @opal/adapter-univer   # intention → ChangeSet → réécriture chirurgicale .xlsx
npm test -w @opal/adapter-drawio   # opérations mxCell + réécriture chirurgicale inter-diagrammes
npm test -w @opal/writeback-surgical
```

## Statut

- [x] Ébauche monorepo ; couche d'abstraction core + registre d'adaptateurs
- [x] Réécriture chirurgicale OOXML (validée + testée)
- [x] Tour de l'agent : intention en langage naturel → `ChangeSet` contraint (BYOK, 8 fournisseurs)
- [x] Adaptateur drawio : mxCell ajout/suppression/setProps/déplacement + réécriture chirurgicale au niveau du diagramme
- [ ] Boucle live de l'adaptateur Univer : sélection → ChangeSet → fantôme → diff → réécriture
- [ ] Connecter l'UI cockpit à l'agent réel + au backend de réécriture

## Licence

[Apache-2.0](./LICENSE).
