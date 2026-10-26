# Third-party content and licenses

This inventory covers the Agent Skills importer addition, not a full audit of every pre-existing
application dependency. Installed dependencies retain their own license files.

| Content | Origin | License / decision |
|---|---|---|
| YAML parser `yaml` 2.8.2 | https://github.com/eemeli/yaml | ISC; pinned dependency and npm integrity hash in `package-lock.json` |
| `examples/agent-skills/excel-data-quality/` | Independently authored for OtterPatch | Apache-2.0, repository `LICENSE`; includes its original reference checklist |
| `examples/agent-skills/word-technical-review/` | Independently authored for OtterPatch | Apache-2.0, repository `LICENSE`; includes its original reference checklist |
| Anthropic proprietary Office/PDF Skills | Not imported or newly redistributed | No reuse authorization inferred from format compatibility |
| OpenAI Plugins content | Not imported or redistributed | Unverified licensing is not accepted |
| Future third-party imports | Administrator-selected local Git objects | Per-release repository, full commit, source hash, SPDX/LicenseRef identifier, exact license path/hash/text, and human approval record required |

An allowlist entry is an administrator's licensing and text-only suitability attestation, not an
automated legal determination. A repository's configured origin and commit hash alone do not prove
authorship, ownership, or permission. Verify those independently before approving. If rights are
unclear, reject the import or independently author an alternative; do not paraphrase restricted text.
External content stays in the private operator registry unless separately authorized for distribution.

## ISC notice for yaml

Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
