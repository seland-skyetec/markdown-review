# Markdown Review

A small dark-mode Markdown review app. Upload a document, read one chapter at a time, annotate sentences in the rendered text, and hand an agent a read-only JSON link.

## Review interface

The sidebar is a nested, collapsible table of headings, not a list of paragraphs. Each selected chapter contains all of its paragraphs, lists, tables, code, and subordinate headings. Clicking a nested heading navigates to it within that chapter. A solitary document-level H1 is treated as the document title: its introductory text and immediate child chapters are separate views, so selecting the title does not dump the entire document onto the screen. Markdown without headings remains one document.

Hover a sentence to highlight it; click or focus it and press Enter to comment. Bold, emphasis, inline code and links remain formatted. Normal clicks annotate; modifier-clicking a link retains native browser navigation. Code fences are not split into sentences. The header checkbox on the right marks the section and its descendants as reviewed; partial completion is indeterminate. Checking a box never advances the reader automatically.

Comments and exports are hidden until requested. In-progress comment drafts survive section navigation in the current tab. Autosaves are serialized, and copying an agent link waits for a successful save. Read-only links have no editing controls. Browser tests use synthetic documents and intercepted APIs, never real Blob contents.

## Compatibility and anchors

Original source text is never rewritten. The `reviewedBlockIds` field is retained for API compatibility; new writes contain heading-based `s-<source offset>` identifiers. Legacy `b-N` completion is conservatively mapped only when all old blocks overlapping a section were reviewed. Legacy annotations are retained; unique exact quotes are reattached within their old block. Ambiguous old quotes stay available in Errata rather than being silently assigned to an occurrence.

New annotations include `sectionId` and `anchor`: `blockStart`/`blockEnd` address the containing block in the unchanged source using JavaScript UTF-16 offsets. `textStart`/`textEnd` address the rendered block text, not raw Markdown bytes. `sentenceIndex`, `exact`, `prefix` and `suffix` distinguish repeated sentences and provide context for an agent. Do not use rendered-text offsets directly against raw Markdown.

Sentence segmentation uses the browser's `Intl.Segmenter` with a fallback. Abbreviations and unusual punctuation can still create imperfect language boundaries.

## Storage

Private Vercel Blob stores `sources/<id>.md` and `reviews/<id>.json` separately. Source retention is 1 day, 1 week (default), 30 days, or indefinitely. Review data, including quoted source excerpts, persists after source expiry. Expiry of the original is therefore not erasure of all quoted content.

Review IDs are random read capabilities. Editing requires the additional edit token stored in the creator's browser. Treat review/agent URLs as secrets. The existing daily `/api/cleanup` cron deletes expired sources; reads enforce expiry before returning a source.

## Deployment and development

Import `seland-skyetec/markdown-review` in Vercel and connect a **Private Blob** store. Set `CRON_SECRET` to protect scheduled cleanup. The existing backend's cleanup and upload controls are unchanged by this UI release; this is a personal capability-link application, not a multi-user access-control system.

```sh
npm install
vercel env pull .env.local
npm run dev
```

```sh
npm test
npm run build
npx playwright install chromium firefox
npm run test:e2e
```

CI runs unit tests, the production build and Chromium, Firefox and mobile browser checks. Screenshots and failure traces are retained as the `review-browser-tests` artifact.
