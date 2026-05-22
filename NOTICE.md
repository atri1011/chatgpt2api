# NOTICE

This project (`chatgpt2api`) incorporates code and data derived from a separate
work licensed under **GNU Affero General Public License v3.0 (AGPL-3.0)**.

## Derived Components

The Prompt Library feature added under `web/src/` (paths listed below) is
derived from upstream concepts and component patterns in
[`basketikun/infinite-canvas`](https://github.com/basketikun/infinite-canvas)
(AGPL-3.0, © basketikun).

Affected files:

```
web/src/types/prompt.ts
web/src/data/prompts/seed.json
web/src/store/prompts.ts
web/src/lib/prompt-search.ts
web/src/components/prompts/prompt-card.tsx
web/src/components/prompts/prompt-cover.tsx
web/src/components/prompts/prompt-detail-dialog.tsx
web/src/components/prompts/prompt-select-dialog.tsx
web/src/components/prompts/prompt-filter-bar.tsx
web/src/app/prompts/page.tsx
```

The seed prompt dataset (`web/src/data/prompts/seed.json`) is a freshly authored
curation; the schema (`{id, title, coverUrl, prompt, tags, category, ...}`)
matches the upstream `model/prompt.go` definition.

## Licensing of the Combined Work

- Original `chatgpt2api` code remains licensed under the MIT License
  (see `LICENSE`).
- The components listed above (and any work derived from them) carry
  obligations from AGPL-3.0, including but not limited to:
  - making the corresponding source code available to users who interact
    with the software over a network (AGPL §13),
  - preserving copyright notices,
  - distributing modifications under the same AGPL-3.0 terms.

When redistributing or operating a network service that depends on the
AGPL-licensed components, the combined work must comply with AGPL-3.0. The
full AGPL-3.0 text is available at:
<https://www.gnu.org/licenses/agpl-3.0.txt>

## Acknowledgements

Thanks to **basketikun** for publishing `infinite-canvas` under an open-source
license and inspiring the canvas + prompt library workflow ported here.
