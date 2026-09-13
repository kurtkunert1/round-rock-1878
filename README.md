# Round Rock 1878 — v0.4.0 Baseline Restore

This build is intentionally the last known-good GPT-Live proof restored as the new baseline.

## What is in this build
- The exact working GPT-Live/WebRTC conversation loop from v0.1.
- Jeb live voice and the original Contentstream Responses delegation prompt.
- No v0.2/v0.3 world-engine event plumbing.
- No commentary return patches.
- No secondary handoff logic.

## Why
We are re-establishing the known-good live conversation before adding Contentstream features back one at a time.

## Deploy
Replace the current repo files with these files and redeploy the same Render Web Service. Keep the existing OPENAI_API_KEY.

## Expected health response
The health endpoint intentionally identifies itself as `round-rock-1878-gpt-live-proof`, because the runtime code is the known-good proof without protocol changes.

After confirming Jeb speaks reliably again, add only one Contentstream feature per build and test after each addition.
