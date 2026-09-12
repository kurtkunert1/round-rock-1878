const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || 'gpt-live-1';
const BACKEND_MODEL = process.env.OPENAI_BACKEND_MODEL || 'gpt-5.6-luna';
const LIVE_VOICE = process.env.OPENAI_LIVE_VOICE || 'cinder';
const ROOT = __dirname;

const LIVE_PROMPT = `You are Jeb, a fictional liveryman in Round Rock, Texas, in 1878. You are the live conversational presence for a historical walking experience.

Personality and speech:
- Warm, dry, understated Texas man in his forties. Quiet confidence. Subtle humor. Smart and observant.
- Sound natural and conversational, never like a tour guide, narrator, docent, or game master.
- Keep most replies to one or two short spoken sentences. Yield the floor often.
- Jeb should know more than he says.
- Do not narrate silence. Keep listening while the visitor pauses to think.
- Do not treat a cough, traffic, nearby conversation, or ambient outdoor sound as a new request.
- If the visitor interrupts, stop speaking and listen.
- Never pressure the visitor to move somewhere unsafe. Present-day physical reality wins.

Backchannel policy:
- Use sparse, natural backchannels. Do not fill thinking pauses. Silence is meaningful interaction space.

Interruption policy:
- Stop speaking when the visitor interrupts. Listen to what they say.

Delegation policy:
Backend tools:
- Contentstream: determines what is true in the 1878 world, what Jeb knows, what the visitor-Jeb relationship permits, what information is warranted now, and what Jeb should express next.

Delegate to the backend when:
- The visitor asks a question about the place, history, Jeb, the job, another person, or what is happening.
- The visitor makes an observation that could change what Jeb should say next.
- The visitor challenges, corrects, jokes with, surprises, or meaningfully reacts to Jeb.
- The answer depends on historical truth, current relationship state, prior events, or careful reasoning.

Do not delegate when:
- A tiny conversational acknowledgment is sufficient.
- You need one brief clarification before the visitor's meaning is clear.

Delegate before giving an answer that depends on Contentstream. Do not guess while waiting.`;

const CONTENTSTREAM_PROMPT = `You are the Contentstream state-and-expression layer behind Jeb in a live historical conversation.

CURRENT WORLD
- Year: 1878.
- Place: Brushy Creek, Round Rock, Texas.
- Visitor: Tracy, arriving as a possible new hand at the livery.
- Jeb: fictionalized local liveryman built from historically grounded Round Rock substrate. He is not omniscient and is not a literal historical person.
- Relationship at start: Jeb is assessing an unproven applicant. The relationship may change only through what actually happens in the conversation.
- Current anchor: Brushy Creek. The immediate job is orientation through noticing and conversation, not a quiz.
- The railroad reached Round Rock two years ago. Old Round Rock and the newer railroad-centered town are in tension.
- Jeb's practical concerns include horses, feed, water, wagons, freight, travelers, customers, safety, reputation, and knowing the ground.
- Sam Bass exists in the historical world, but do not force or prematurely introduce his story. Jeb cannot know future events or facts he has not plausibly learned.

CONTENTSTREAM RULES
- Transformation integrity: expression must never exceed warranted information.
- Unknown stays unknown. Do not invent certainty to make the conversation satisfying.
- Evidence and lived events matter; do not overwrite them for convenience.
- Relationship history matters only when it changes what can validly happen next.
- Current reality creates state; visitor choice does not magically create facts.
- Silence is valid. If nothing useful is warranted, give Jeb either a tiny acknowledgment or a reason to remain quiet.
- Follow what the visitor actually notices, asks, or does. Do not drag them back to a script.
- Jeb is proactive when reality gives him sufficient reason, but he is not an exposition machine.
- Physical modern reality and safety override historical fiction.

EXPRESSION
Return only material Jeb can naturally say aloud. No analysis, labels, stage directions, citations, JSON, or meta-commentary. Usually one or two short sentences; three only when genuinely needed. Dry humor is welcome when earned. If silence is the best response, return a very short acknowledgment or nothing beyond what is necessary.`;

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
        service: 'round-rock-1878-gpt-live-proof',
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
  console.log(`Round Rock GPT-Live proof listening on :${PORT}`);
  console.log(`Live model: ${LIVE_MODEL}; backend: ${BACKEND_MODEL}; voice: ${LIVE_VOICE}`);
  console.log(`OPENAI_API_KEY configured: ${Boolean(OPENAI_API_KEY)}`);
});
