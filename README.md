# Markdown Review

A small, focused web app for paragraph-by-paragraph Markdown review.

[Deploy to Vercel with Private Blob](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fseland-skyetec%2Fmarkdown-review&project-name=markdown-review&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D)

## What it does

- Upload or paste a Markdown document.
- Review one top-level Markdown block at a time.
- Click prose sentences and attach comments.
- Mark each block as reviewed; completed items turn green.
- Persist the original document for 1 day, 1 week (default), 1 month, or indefinitely.
- Keep structured errata after the original expires.
- Hand an agent one JSON URL containing the source (while retained), annotations, and review status.
- Export the original Markdown and errata JSON locally.

## Storage model

Vercel Private Blob is used as a deliberately simple v1 datastore:

- `sources/<review-id>.md` — original Markdown, subject to retention.
- `reviews/<review-id>.json` — durable review metadata and errata.

The review id is a random 128-bit capability identifier. Editing additionally requires a separate random edit token stored only in the creator's browser. Shared/agent links are read-only.

A daily Vercel Cron calls `/api/cleanup` and deletes source blobs whose retention has expired. Reads also enforce expiry and attempt lazy deletion, so expired source content is never returned even if cleanup has not yet run.

## Vercel setup

The deploy link above imports the repository and requests a **Private Vercel Blob** store in the same flow.

Optional but recommended after import: add `CRON_SECRET` as a project environment variable. Vercel Cron will send it as `Authorization: Bearer <CRON_SECRET>`.

The app intentionally has no user accounts or database in v1. Treat review URLs as capability links and do not publish them.

## Local development

```bash
npm install
vercel env pull .env.local
npm run dev
```

A linked Vercel Blob store is required for persistent review creation.
