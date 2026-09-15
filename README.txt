Contentstream Round Rock 1.10.4 LOCAL RESOLVER

This build removes the broken dependency on the separate round-rock-1878 resolver service. /resolver/resolve now runs the recovered Six Questions resolver inside this same Render service. Jeb TTS remains on /speak.

Required Render environment variable: OPENAI_API_KEY
Optional: OPENAI_MODEL, JEB_VOICE, TTS_MODEL, RESOLVE_TIMEOUT_MS
