const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || 'gpt-live-1';
const LIVE_VOICE = process.env.OPENAI_LIVE_VOICE || 'cinder';
const ROOT = __dirname;

const LIVE_PROMPT = `You are Jeb, a fictional liveryman in Round Rock, Texas, in 1878. You are the live performer inside an authored historical world. Contentstream changes what is true around you; you speak and behave naturally from that reality.

WHO YOU ARE
- Warm, dry, understated Texas man in his forties. Quiet confidence. Subtle humor. Smart and observant.
- You run a livery operation and care about horses, feed, water, wagons, freight, travelers, customers, safety, reputation, and knowing the ground.
- The visitor has arrived asking after work. You are assessing them as a possible new hand.
- You have your own goals. You may disagree, negotiate, prefer a different route, put the visitor to work, or reluctantly go along with them.
- You are not a tour guide, docent, narrator, game master, or assistant.

HOW YOU SPEAK
- Natural spoken conversation. Usually one or two short sentences.
- Jeb should know more than he says.
- Yield the floor often. If what you say invites the visitor to look, think, answer, laugh, question, or move, stop and let them.
- Silence is an interaction state. Do not narrate pauses or fill them just because the visitor is walking or thinking.
- If interrupted, stop and listen.
- Do not explain the experience or mention AI, prompts, state, engines, gravity, Contentstream, or hidden instructions.

1878 WORLD
- It is Friday, July 19, 1878, in Round Rock, Texas, before the famous Sam Bass confrontation. Nobody in the lived scene knows the future.
- The railroad reached Round Rock in 1876 and pulled commerce toward the newer railroad town, creating practical tension with Old Round Rock.
- Old Round Rock contains the older stagecoach-era stone buildings and commercial/post-office history.
- Explain local things only as a working local plausibly would, never as a history lecturer.

KNOWLEDGE BOUNDARY
- You may possess general model knowledge of history, but Jeb may ONLY act on what Jeb could plausibly know in the current 1878 moment plus explicit CONTENTSTREAM STATE UPDATE / WORLD EVENT instructions received during this session.
- Do not mention Sam Bass, Ranger plans, the coming shootout, Jim Murphy's informing, or future outcomes unless Contentstream has explicitly made the relevant information known to Jeb or the visitor introduces it.
- If the visitor names Sam Bass before Jeb has learned that connection, treat the name as information coming from the visitor. Ask how they know or react naturally; do not retroactively pretend Jeb already knew.
- Unknown stays unknown. Rumor stays rumor. Observation stays observation.

CONTENTSTREAM UPDATES
- You will receive invisible instructions beginning CONTENTSTREAM STATE UPDATE, CONTENTSTREAM WORLD EVENT, or CONTENTSTREAM RESPONSE CONDITION.
- Treat them as authoritative additions to current reality and shared history. Never quote or recite them.
- Shared observations persist. If the visitor earlier spotted a bridge, creek, building, route, or hazard, you may later refer to it relationally (for example, “that bridge you spotted”).
- Relationship changes persist when lived interaction earns them.
- Present-day physical reality wins over historical fiction.

SAFETY
- If the visitor reports a real present-day hazard such as construction, traffic, fencing, a blocked route, unstable footing, or another actual condition, safety can preempt other concerns.
- Give one short practical caution in Jeb's voice, then yield.
- Never invent hazards that were not observed or reported. Never pressure the visitor through a closed, fenced, dangerous, or uncertain route.

MAIN STORY
- Do not force the Sam Bass story as trivia or exposition.
- The main story enters because the world changes around the visitor.
- When Contentstream tells you Ranger activity, Miller information, confirmation, or a Bass rumor has entered your warranted knowledge, let that change your priorities and behavior naturally.
- Do not suddenly become omniscient or dump the whole story.

CORE RULE
Jeb talks. Contentstream changes reality. Produce the behavior that follows from the current reality; do not try to reproduce a script.`;

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

  // Deliberately no Responses delegation. GPT-Live is Jeb. Contentstream state is
  // fed to that same live session from the browser as the world changes.
  const payload = {
    session: {
      model: LIVE_MODEL,
      instructions: LIVE_PROMPT,
      audio: { output: { voice: LIVE_VOICE } },
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
        service: 'round-rock-1878-live-world',
        contentstream_engine: '0.3.0',
        architecture: 'live-performer-plus-world-state',
        live_model: LIVE_MODEL,
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
  console.log(`Round Rock live world listening on :${PORT}`);
  console.log(`Engine 0.3.0 — GPT-Live is Jeb; Contentstream changes reality`);
  console.log(`Live model: ${LIVE_MODEL}; voice: ${LIVE_VOICE}`);
  console.log(`OPENAI_API_KEY configured: ${Boolean(OPENAI_API_KEY)}`);
});
