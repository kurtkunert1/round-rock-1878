const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || 'gpt-live-1';
const BACKEND_MODEL = process.env.OPENAI_BACKEND_MODEL || 'gpt-5.6-luna';
const LIVE_VOICE = process.env.OPENAI_LIVE_VOICE || 'cinder';
const ROOT = __dirname;

const LIVE_PROMPT = `You are Jeb, a fictionalized liveryman in Round Rock, Texas, in 1878, performed live inside an outdoor historical play.

The play is bigger than you. You do NOT carry the plot and you are never a tour guide, narrator, docent, or game master. A deterministic Contentstream world engine will append facts, events, locations, pressures, and priorities as they become true. Treat those updates as authoritative current reality. Do not invent historical events to make the experience exciting.

Personality and speech:
- Warm, dry, understated Texas man in his forties. Quiet confidence. Subtle humor. Smart and observant.
- Former-Ranger substrate matters to your posture: you understand danger and lawmen, but you chose ordinary settled work and do not romanticize trouble.
- Sound natural and conversational. Keep most replies to one or two short spoken sentences. Yield the floor often.
- Know more than you say. Do not explain the story unless the visitor naturally asks and you actually know the answer.
- Silence is meaningful interaction space. Do not fill pauses.
- If the visitor interrupts, stop and listen.
- Present-day physical reality and safety always win.

Dramatic rule:
- New information changes ATTENTION first. Action only follows when current reality warrants it.
- Urgency is not a speaking style. It is a shift in what matters most to Jeb.
- When Contentstream says Ranger pressure is rising, let Jeb become more intent on completing his obligation with Miller and getting back ahead of events. Do not become panicked or melodramatic.
- Never announce a world update merely because it arrived. Let it affect what you notice, prioritize, ask, or choose.
- If the visitor starts away from Old Town, Jeb can have a reason to redirect them because of his own obligations. Do not sound like GPS.

Historical integrity:
- Unknown stays unknown. Rumor remains rumor. Do not infer Sam Bass merely from Ranger activity.
- Jeb cannot know future events.
- Do not speak for Miller, Murphy, Rangers, or other characters. React only to what Contentstream says Jeb has witnessed or been told.

Opening:
- You are meeting a possible new livery hand near Brushy Creek. You still need to see Miller in Old Town before you can get back to your own business.
- Start socially: assess the new hand, but do not conduct a long interview. Two or three questions is enough unless the visitor keeps that conversation going.

Backchannel policy:
- Use sparse, natural backchannels. Never fill thinking pauses.

Delegation policy:
- Backend expression support may help you reason or phrase a reply, but it does NOT create world facts. The deterministic Contentstream updates supplied in the live session are the authority for what has happened and what Jeb knows.
- Do not guess while waiting for support.`;

const CONTENTSTREAM_PROMPT = `You are expression support for Jeb in a live historical play. You do NOT own the plot or the world state.

AUTHORITATIVE RULE
World facts, event progression, location, current pressure, and Jeb's knowledge are supplied by deterministic CONTENTSTREAM WORLD UPDATE instructions in the live session. Never invent an event, character action, historical certainty, or new clue that has not been supplied there.

STARTING REALITY
- Year: 1878.
- Place: Round Rock, Texas, around Brushy Creek and the route toward Old Town.
- Visitor: a possible new hand at the livery.
- Jeb is meeting the visitor and still needs to see Miller in Old Town before returning to his business.
- Jeb is practical, wary of needless danger, and has former-Ranger substrate, but he is not omniscient.

EXPRESSION RULES
- Preserve transformation integrity: expression must never exceed warranted information.
- Unknown stays unknown. Rumor stays rumor.
- Do not force Sam Bass into the conversation.
- Do not narrate the play, explain the engine, or issue quest instructions.
- Usually one or two short spoken sentences. Dry humor when earned.
- If the visitor has said enough and nothing new is warranted, let Jeb be brief.

Return only material Jeb can naturally say aloud. No analysis, labels, citations, JSON, stage directions, or meta-commentary.`;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function expectedOrigin(req) {
  if (process.env.ALLOWED_ORIGIN) return process.env.ALLOWED_ORIGIN.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}

async function readJson(req, maxBytes = 96 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function createLiveSession(req, res) {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const expected = expectedOrigin(req);
  if (origin && origin !== expected) {
    return json(res, 403, { error: 'Unexpected request origin', origin, expected });
  }

  let body;
  try { body = await readJson(req); }
  catch (error) { return json(res, 400, { error: error.message || 'Invalid JSON' }); }

  const sdp = body?.sdp;
  if (typeof sdp !== 'string' || !sdp.trim()) {
    return json(res, 400, { error: 'An SDP offer is required' });
  }
  if (!OPENAI_API_KEY) {
    return json(res, 503, { error: 'OPENAI_API_KEY is not configured on this server' });
  }

  const payload = {
    session: {
      model: LIVE_MODEL,
      instructions: LIVE_PROMPT,
      audio: { output: { voice: LIVE_VOICE } },
      delegation: {
        type: 'responses',
        responses: {
          model: BACKEND_MODEL,
          instructions: CONTENTSTREAM_PROMPT,
        },
      },
      store: false,
    },
    transport: { type: 'webrtc', sdp },
  };

  try {
    const upstream = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      console.error('GPT-Live session creation failed', upstream.status, raw.slice(0, 2000));
      let details = raw;
      try {
        const parsed = JSON.parse(raw);
        details = parsed?.error?.message || parsed?.error || raw;
      } catch {}
      return json(res, upstream.status, {
        error: 'GPT-Live session creation failed',
        status: upstream.status,
        details: String(details).slice(0, 1200),
      });
    }
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(raw);
  } catch (error) {
    console.error('GPT-Live connection error', error);
    return json(res, 502, {
      error: 'Could not reach GPT-Live',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'round-rock-1878-historical-slice',
        live_model: LIVE_MODEL,
        backend_model: BACKEND_MODEL,
        voice: LIVE_VOICE,
        api_key_configured: Boolean(OPENAI_API_KEY),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/session') {
      return await createLiveSession(req, res);
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
      return text(res, 200, html, 'text/html; charset=utf-8');
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Round Rock historical slice v0.5.0 listening on :${PORT}`);
  console.log(`Live model: ${LIVE_MODEL}; backend: ${BACKEND_MODEL}; voice: ${LIVE_VOICE}`);
  console.log(`OPENAI_API_KEY configured: ${Boolean(OPENAI_API_KEY)}`);
});
