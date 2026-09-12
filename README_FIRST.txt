CONTENTSTREAM — SIX QUESTIONS ONLY 1.2

This replaces BOTH parts of the current experiment because the old scaffold exists in both places:
- index.html: guided scene/clip logic
- server.js: hard-coded Brushy Creek phase rules + clip-only responses

FILES
1. index.html — static site for round-rock-1878-2
2. server.js — web service for round-rock-1878
3. package.json — same simple Node start command

DEPLOY
1. In the GitHub repo root, replace index.html with this index.html.
2. Replace server.js with this server.js.
3. Replace package.json with this package.json (or keep yours if it already runs `node server.js`).
4. Commit all changes together.
5. Render should redeploy both the Web Service and Static Site from the same repo.
6. When both say Live, hard-refresh https://round-rock-1878-2.onrender.com

EXPECTED HEALTH RESPONSE
The Web Service /health should report:
  service: contentstream-six-questions-only
  endpoints: /resolve, /field-event, /health

EXPECTED TEST
Say things such as:
- Through the trees.
- Where should we go next?
- Are you there?
- I see water.

There is no authored route progression and no prerecorded response tree. Each utterance is sent to /resolve. The six-question resolution decides whether Jeb speaks or stays silent. Browser speech synthesis provides temporary voice output so the interaction does not depend on a separate TTS service.
