# Round Rock 1878 — GPT-Live proof v0.1

This is deliberately small. It tests one premise:

**visitor speaks → GPT-Live handles the physical conversation → Contentstream backend decides what Jeb can validly say → Jeb speaks back**

There is no Speechify, prerecorded audio, route UI, Director panel, or browser speech synthesis.

## What is in the proof

- `index.html` — one-button mobile WebRTC client.
- `server.js` — trusted server that creates GPT-Live sessions. The OpenAI API key never goes to the browser.
- `package.json` — Node/Express runtime.
- `render.yaml` — optional Render Blueprint.

GPT-Live owns microphone input, turn timing, interruptions, pauses, and spoken output. Responses delegation uses `gpt-5.6-luna` as the first Contentstream backend. The current world state is deliberately bounded to Brushy Creek and the applicant relationship.

## Required environment variable

`OPENAI_API_KEY`

The key must belong to an OpenAI API project with access to `gpt-live-1`. ChatGPT subscription billing and API billing are separate.

Optional overrides:

- `OPENAI_LIVE_MODEL` (default `gpt-live-1`)
- `OPENAI_BACKEND_MODEL` (default `gpt-5.6-luna`)
- `OPENAI_LIVE_VOICE` (default `cinder`)
- `ALLOWED_ORIGIN` (normally unnecessary when the page and server share one Render host)

## Local smoke test

Requires Node 22.6+. There are no npm dependencies.

```bash
OPENAI_API_KEY=YOUR_KEY npm start
```

Open `http://localhost:3000` and press **Enter Round Rock**.

`GET /health` is safe to use as a deployment check; it reports only whether the key is configured, never the key itself.

## Render

The simplest deployment is one Render **Web Service**, not a Static Site.

- Build command: `echo "No build step"`
- Start command: `npm start`
- Environment: `OPENAI_API_KEY=<your OpenAI API key>`
- Health path: `/health`

The included `render.yaml` expresses the same setup.

## What this does NOT prove yet

This does not yet implement Contentstream's durable event ledger, route anchors, relationship persistence across sessions, or field navigation. Those come only after the live conversation transport passes the basic test.

The first pass/fail test is simply: can a visitor talk to Jeb naturally on a phone, pause and interrupt, and receive fast spoken responses that stay inside the current 1878 world?
