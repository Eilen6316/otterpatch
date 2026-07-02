# Notes sur la sémantique des révisions OOXML (à destination des contributeurs d'adapter-word)

La couche de réécriture doit produire de **véritables révisions Word (track changes)** ; ces détails sémantiques déterminent si « le document est propre après acceptation des révisions ». L'adapter-word actuel
en couvre déjà une partie ; les éléments non couverts sont marqués comme backlog. Sources : la spécification OOXML et l'observation des implémentations majoritaires ; le texte est original à ce projet.

## Couvert (avec tests)
- Insertion = `<w:ins>` enveloppant le run ; suppression = `<w:del>` enveloppant le run, et les nœuds de texte qu'il contient doivent être renommés `<w:delText>`
- Minimisation des révisions : ne découper en paires del/ins que les mots modifiés ; le texte inchangé avant et après conserve ses runs d'origine octet pour octet
- Révision de format de caractère `<w:rPr>+<w:rPrChange>`, révision de format de paragraphe `<w:pPr>+<w:pPrChange>`
- Le run de révision doit copier le `<w:rPr>` d'origine, sinon le gras/la taille de police sont perdus après acceptation des révisions
- Patch de sectPr au niveau page (cols/pgMar/pgSz), inséré en respectant l'ordre des éléments OOXML

## Backlog (non couvert, PR bienvenues)
- **Marque de la marque de paragraphe lors d'une suppression de paragraphe entier** : en plus des runs de contenu supprimé, il faut placer un `<w:del/>` vide dans le `<w:pPr><w:rPr>` de ce paragraphe
  pour marquer que la marque de paragraphe elle-même est supprimée — sans lui, un paragraphe vide/un élément de liste vide subsiste après acceptation des révisions. Actuellement, replaceText ne gère pas le cas où un paragraphe entier est vidé.
- **Sémantique de veto imbriqué** : rejeter l'insertion d'autrui = imbriquer son propre `<w:del>` à l'intérieur du `<w:ins>` de l'autre ; restaurer la suppression d'autrui =
  conserver le `<w:del>` de l'autre et ajouter à sa suite son propre `<w:ins>` réécrivant le même texte. Nécessaire pour les scénarios de collaboration multi-auteurs.
- **`xml:space="preserve"`** : obligatoire lors de la génération d'un `<w:t>` avec espaces en tête/en fin, sinon les espaces sont perdus silencieusement.
  Le chemin de génération actuel ne le vérifie pas systématiquement.
- **Schéma d'ordre des éléments enfants de `<w:pPr>`** : pStyle → numPr → spacing → ind → jc → rPr (en dernier) ;
  lors de l'injection de pPrChange, si le paragraphe d'origine n'a pas de pPr, celui nouvellement créé doit respecter cet ordre.
- **Commentaires (comments)** : les ancres `commentRangeStart/End` sont des nœuds frères des runs (enfants directs de w:p),
  et ne peuvent pas être placées à l'intérieur d'un run ; la marque de référence est un run indépendant. Fondation du futur mode « l'Agent laisse des commentaires sans modifier le texte ».
- **Système d'unités** : DXA (1440 = 1 pouce) pour la page/l'indentation/les tableaux ; EMU (914400 = 1 pouce) pour les images.
  Le patch de sectPr utilise déjà le DXA ; l'insertion future d'images nécessitera l'EMU + un enregistrement en quatre étapes (media/ + rels + Content_Types + w:drawing).

## Approche de validation
- Le docx après réécriture doit passer : dépaquetage → acceptation de toutes les révisions (automatisable avec LibreOffice headless) → comparaison identique avec le « texte
  modifié directement » + absence de paragraphes vides résiduels ; c'est un critère de correction plus fort que « le fichier s'ouvre », et il vaut la peine de l'intégrer à la CI.
