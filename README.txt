Contentstream Round Rock 1878 — v1.10.1 Connection Fix

Render-ready upload package for round-rock-1878-3.onrender.com.

This build keeps the 1.10 earned-integrity engine behavior and fixes the frontend/resolver boundary by routing browser calls through same-origin proxy endpoints:
  /resolver/health
  /resolver/resolve
  /resolver/field-event

The server forwards those calls to the separate resolver service at:
  https://round-rock-1878.onrender.com

This avoids browser CORS/origin ambiguity and also migrates any stale resolver URL saved in localStorage.
The proxy allows up to 70 seconds for a sleeping Render backend to wake.

Optional Render environment variable:
  RESOLVER_ORIGIN=https://round-rock-1878.onrender.com
