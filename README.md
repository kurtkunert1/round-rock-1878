# Round Rock 1878 — Live World v0.3.1

## Architecture reset

**Jeb = GPT-Live performer.**
**Contentstream = world/state engine.**

There is no second conversational backend model and no Responses delegation.
The browser observes the lived conversation, preserves shared evidence and relationship state, advances independent historical-world events, and appends those changes to the same GPT-Live session as invisible state.

When a historical event has sufficient reason to become audible, Contentstream appends the response condition and requests a normal GPT-Live response. Jeb still chooses the actual wording.

## Deploy

Use the same Render Web Service and the same `OPENAI_API_KEY`.
Replace the repo files with this folder and deploy.

Check:

`/health`

Expected engine:

`"contentstream_engine":"0.3.1"`

No new API keys or services are required.


## 0.3.1 fix
Restores the proven GPT-Live speech trigger from v0.1: Contentstream appends state/instructions, then `session.commentary.append` nudges the same live Jeb performer to speak. Removed the ineffective `response.create` trigger from 0.3.0.
