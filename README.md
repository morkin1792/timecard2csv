# Timecard2CSV

Timecard2CSV is a fully client-side web application that extracts timesheet data from PDF documents and converts it into a structured CSV file. Nothing is uploaded to any server of ours — the PDF is processed in your browser.

## How it works

There are two ways to use it:

- **API mode (automatic):** you provide a free Google Gemini API key. The app splits the PDF into batches, sends them to Gemini, and assembles the CSV for you in one click.
- **Manual mode (no key required):** the app splits the PDF into parts you download one at a time. For each part you copy a provided prompt, send it with the part to the free [gemini.google.com](https://gemini.google.com) web chat, and paste the JSON answer back. The app builds the CSV from your pasted results. Useful for anyone who only has free web-based AI access.

Both modes **autosave progress** in your browser, so an interrupted run can be resumed instead of restarted.

## Features

- **Privacy-first:** all PDF processing happens locally in your browser. In API mode the page images are sent to Google's Gemini API; in manual mode you send them yourself via the Gemini web chat.
- **AI-powered extraction:** vision-capable models read varied timecard layouts.
- **Works on the free tier:** request batching is tuned for Gemini's free quota, with automatic backoff on transient errors and a one-level model downgrade if the free limit is reached.
- **Local key storage:** your Gemini API key is encrypted with a non-extractable Web Crypto key (kept in IndexedDB) and stored as ciphertext in localStorage. See [Security](#security-notes).
- **Autosave / resume:** partial results are saved automatically and reloaded on your next visit.
- **Easy export:** generates a standardized `;`-separated CSV ready for spreadsheet import.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (latest LTS) and npm.
- For **API mode** only: a free Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey). Manual mode needs no key.

### Setup

```bash
git clone https://github.com/morkin1792/timecard2csv.git
cd timecard2csv
npm install
```

No `.env` file or environment variables are required.

### Running locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### Building

```bash
npm run build
```

The optimized output is written to `dist/`. **Do not commit `dist/`** — it is a build artifact (already gitignored) and is produced fresh by CI on deploy.

## Deployment (GitHub Pages)

This repo deploys to GitHub Pages via GitHub Actions — no build artifacts are committed.

1. **Base path:** `vite.config.ts` sets `base: '/timecard2csv/'` for production builds, because the project page is served from `https://morkin1792.github.io/timecard2csv/`. If you fork/rename the repo, update this to `/<your-repo-name>/`. With a custom domain, set it back to `'/'`.
2. **Workflow:** `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
3. **One-time GitHub setting:** in the repository, go to **Settings → Pages → Build and deployment → Source** and choose **"GitHub Actions"**.

After that, every push to `main` publishes to `https://morkin1792.github.io/timecard2csv/`. Track runs in the **Actions** tab.

## Security notes

Timecard2CSV is fully client-side, so it can never truly hide your API key from code running in the page's own origin — this is a fundamental limitation of any browser-only app. The key encryption here only aims to make casual leaks less damaging, not to provide real secrecy:

- No secret is baked into the published JavaScript bundle.
- The encryption key is a **non-extractable** Web Crypto key, so a dump of the key store yields an unusable handle rather than raw key bytes.
- The key (in IndexedDB) and the ciphertext (in localStorage) live in separate stores, so leaking only one is not enough to decrypt.

Treat your API key as you would any credential: restrict it (Google now requires Gemini keys to be restricted to the *Generative Language API*), and revoke it from AI Studio if you suspect exposure.
