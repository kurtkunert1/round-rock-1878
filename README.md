# Round Rock 1878 — Live World v0.2.3

Fixes the silent-backend regression in v0.2.1.

## What changed
- Contentstream backend output is accumulated from nested `response.event` text deltas.
- When the delegated response completes, the result is explicitly returned to GPT-Live with `session.commentary.append` using the same delegation ID. GPT-Live can then paraphrase and speak it aloud.
- The UI no longer claims “Jeb is speaking” merely because an output transcript exists; it uses the more accurate “Jeb is responding…” state.
- Existing live voice, Contentstream state, world clock, evidence, safety, and relationship logic are unchanged.

## Deploy
Replace the current repo contents with these files and redeploy the same Render Web Service. Keep the existing `OPENAI_API_KEY`.

After deploy, `/health` should show `"contentstream_engine":"0.2.3"`.


## v0.2.3 repair
Adds the missing backendTextByDelegation map used by the browser event handler. In v0.2.2 that map was referenced but never declared, which could break cleanup and delegated-response handling in the browser.
