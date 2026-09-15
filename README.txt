CONTENTSTREAM ROUND ROCK 1878 — RENDER READY 1.10

Upload this package to the Render web service that owns round-rock-1878-3.onrender.com.
Render should run: npm start
Expected log: Contentstream Round Rock frontend 1.10 listening on :10000 (or Render-assigned PORT)
Expected page header: FIELD PLAY · 1.10 · EARNED INTEGRITY

The resolver remains the separate backend:
https://round-rock-1878.onrender.com/resolve

Important fix in this package:
The resolver health check now allows up to 65 seconds for a sleeping free Render backend to wake, instead of incorrectly declaring it unreachable after 6 seconds.

Voice note:
This package preserves the existing Jeb browser speech behavior. It does not claim to restore the earlier preferred Jeb voice; that voice identity still needs to be identified before changing it deliberately.
