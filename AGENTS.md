# ColumnsManager Agent Notes

## Architecture Rules

- `columns-loader.js` is the only loader source of truth.
- `columns-manager.js` is the payload only. Do not embed a second copy of the loader inside it.
- Loader and payload must remain separate scripts.
- The landing page bookmarklet must be generated from `columns-loader.js`, not from inline loader code duplicated elsewhere.

## Release Rules

- Bump `Config.VERSION` in `columns-manager.js` and `package.json` for every behavior change.
- After each production deploy, run Facebook Sharing Debugger scrape for:
  - `https://columns.pages.dev/columns/latest/manifest.html`
  - every `https://columns.pages.dev/columns/latest/og/chunk-*.html`
- Perform release scrape through the currently logged-in Google Chrome profile.

## Hygiene

- If loader behavior changes, verify there is only one implementation in the repo.
- If payload behavior changes, do not touch bookmarklet generation unless loader behavior truly changed.
