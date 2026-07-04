# OOXML redline semantics notes (for adapter-word contributors)

The write-back layer must emit **real Word tracked changes**; these semantic details decide
whether the document is clean after "accept all revisions". adapter-word covers part of this
today; uncovered items are marked backlog. Sources: the OOXML spec plus observation of major
implementations; the text is original to this project.

## Covered (with tests)
- Insertion = runs wrapped in `<w:ins>`; deletion = runs wrapped in `<w:del>`, with text nodes
  renamed to `<w:delText>`
- Redline minimization: only the changed words become del/ins pairs; unchanged text before/after
  keeps its original run bytes
- Character format revisions `<w:rPr>+<w:rPrChange>`, paragraph format revisions
  `<w:pPr>+<w:pPrChange>`
- Revision runs must copy the original `<w:rPr>`, or bold/size is lost after accepting
- Page-level sectPr patches (cols/pgMar/pgSz), inserted in OOXML element order
- **Whole-paragraph deletion** (deleteRange → block-deletion redline): every run wrapped in
  `<w:del>`, `w:t` renamed to `w:delText`, plus an empty `<w:del/>` in the paragraph's
  `<w:pPr><w:rPr>` marking the **paragraph mark itself** as deleted — no residual empty
  paragraph/list item after accepting
- **Image ops** (setObjectProps/imgAction): removal = the drawing run wrapped in `<w:del>`;
  resize = `wp:extent`/`a:ext` rewritten in EMU, aspect ratio preserved
- **Para anchoring**: block order mirrors the importer — a top-level `w:tbl` counts as one block,
  `w:p` inside tables don't — so the workspace's "第N段" lands at the same spot in document.xml;
  paragraph format revisions (pPrChange) also accept a paragraph-number anchor (formatting an
  empty paragraph works)

## Backlog (uncovered, PRs welcome)
- **Nested veto semantics**: rejecting someone else's insertion = nesting your `<w:del>` inside
  their `<w:ins>`; restoring their deletion = keep their `<w:del>` and append your `<w:ins>`
  rewriting the same text. Needed for multi-author collaboration.
- **`xml:space="preserve"`**: required when emitting `<w:t>` with leading/trailing spaces, or the
  spaces are silently dropped. The generation path doesn't systematically enforce it yet.
- **`<w:pPr>` child-order schema**: pStyle → numPr → spacing → ind → jc → rPr (last); when
  pPrChange injection creates a fresh pPr, it must respect this order.
- **Comments**: the `commentRangeStart/End` anchors are siblings of runs (direct children of
  `w:p`), never inside a run; the reference mark is its own run. The basis for a future
  "agent comments without editing" mode.
- **Unit systems**: DXA (1440 = 1 inch) for page/indent/table; EMU (914400 = 1 inch) for images.
  sectPr patches already use DXA and image resizing already uses EMU; **inserting** new images
  still needs the four-step registration (media/ + rels + Content_Types + w:drawing).

## Verification idea
- A written-back docx should pass: unzip → accept all revisions (LibreOffice headless automates
  this) → compare equal to the "directly edited" text + no residual empty paragraphs. A stronger
  correctness criterion than "it opens", worth putting in CI.
