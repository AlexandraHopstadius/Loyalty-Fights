// Supabase Edge Function (Deno) - admin-proxy
// This function accepts an admin password header and performs safe server-side updates
// using the SERVICE_ROLE key. Deploy via `supabase functions deploy admin-proxy`.

// Expected environment variables (set in Supabase project):
// SUPABASE_URL - your project URL (https://xyz.supabase.co)
// SUPABASE_SERVICE_ROLE - service_role key (secret)
// ADMIN_PASSWORD - a strong password used to authenticate admin requests to this function

export default async (req: Request) => {
  try {
    // Prefer SUPABASE_URL from env, but fall back to deriving from the request host
    // e.g. https://<project-ref>.functions.supabase.co or https://<project-ref>.supabase.co
    const reqUrl = new URL(req.url);
    const host = reqUrl.hostname || '';
    let derivedSupa: string | null = null;
    const m = host.match(/^([a-z0-9]{15,})\.(?:functions\.)?supabase\.co$/);
    if (m && m[1]) {
      derivedSupa = `https://${m[1]}.supabase.co`;
    }
  const SUPA_ENV = Deno.env.get('SUPABASE_URL');
  const SUPA = SUPA_ENV || derivedSupa;
    // Read service role from several possible secret names to be tolerant to
    // how the secret was created in the dashboard/CLI. Prefer the exact
    // uppercase names first.
    const possibleNames = [
      'SERVICE_ROLE',
      'SUPABASE_SERVICE_ROLE',
      'SUPABASE_SERVICE_ROLE_KEY',
      'service_role',
      'serviceRole',
    ];
    let SERVICE = null as string | null;
    let SERVICE_ENV_NAME = null as string | null;
    for (const n of possibleNames) {
      const v = Deno.env.get(n);
      if (v) { SERVICE = v; SERVICE_ENV_NAME = n; break; }
    }
    const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD');
    // Allow the debug action to proceed even if some env vars are missing so we can surface diagnostics.
    const serverMisconfigured = (!SUPA || !SERVICE || !ADMIN_PASSWORD);

    // Debug logging (safe): log presence of important env vars and incoming header (do NOT log secret values)
    try {
      console.log('debug: SUPABASE_URL set:', !!SUPA);
      console.log('debug: SUPABASE_URL source:', SUPA_ENV ? 'env' : (derivedSupa ? 'derived' : 'missing'));
      console.log('debug: SERVICE_ROLE present:', !!SERVICE);
      console.log('debug: SERVICE_ENV_NAME:', SERVICE_ENV_NAME);
      console.log('debug: ADMIN_PASSWORD present:', !!ADMIN_PASSWORD);
    } catch (e) {
      // console may not be available in some runtimes; swallow errors to avoid affecting behavior
    }

    // Support POST (preferred) and GET (for easy dashboard/browser diagnostics)
    // GET will default to action=debug and never require the admin password.

    // Parse body for POST, or build from query params for GET
    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch(e) { body = {}; }
    } else if (req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      body = { action: q.get('action') || 'debug' };
    } else {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }

    // Admin password check (trim to avoid accidental whitespace issues)
    const pwRaw = req.headers.get('x-admin-password');
    const pw = (pwRaw || '').trim();
    const ADMIN_TRIM = (ADMIN_PASSWORD || '').trim();
  const isDebug = body && body.action === 'debug';
    try { console.log('debug: received x-admin-password header present:', !!pwRaw); } catch(e){}
    if (!isDebug) {
      if (serverMisconfigured) {
        return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      if (!pw || pw !== ADMIN_TRIM) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }

    // Quick debug action: allow without correct password, but include auth_ok flag
    if (isDebug) {
      let headerNames: string[] = [];
      try {
        if (SERVICE) {
          const tmp = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } as Record<string, unknown>;
          headerNames = Object.keys(tmp);
        }
      } catch (e) {}
      const missing: string[] = [];
      if (!SUPA) missing.push('SUPABASE_URL');
      if (!SERVICE) missing.push('SERVICE_ROLE');
      if (!ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
      const debugOut: Record<string, unknown> = {
        debug_version: 2,
        supabase_url_set: !!SUPA,
        supabase_url_source: SUPA_ENV ? 'env' : (derivedSupa ? 'derived' : 'missing'),
        service_role_present: !!SERVICE,
        service_env_name: SERVICE_ENV_NAME,
        admin_password_present: !!ADMIN_PASSWORD,
        received_x_admin_password_header: !!req.headers.get('x-admin-password'),
        rest_outgoing_header_names: headerNames,
        auth_ok: (!!pw && pw === ADMIN_TRIM),
        server_misconfigured: serverMisconfigured,
        missing_envs: missing,
        error: serverMisconfigured ? ('Server misconfigured: missing ' + (missing.length ? missing.join(', ') : 'unknown')) : null
      };
      // Always return 200 for debug so Dashboard tester UI doesn't choke on 500
      return new Response(JSON.stringify(debugOut), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Supported actions: setWinner, clearWinner, setCurrent, setState
    // body: { action: 'setWinner', id: number, winner: 'a'|'b'|'draw'|null }
    // body: { action: 'setCurrent', current: number }
    // body: { action: 'setState', state: { current, standby, infoVisible } }

    // helper to call Supabase REST
    const rest = async (path: string, opts: RequestInit) => {
      const url = SUPA.replace(/\/+$/,'') + '/rest/v1' + path;
      // Build headers safely using the Headers API
      const base: Record<string, string> = { 'apikey': SERVICE as string, 'Authorization': 'Bearer ' + SERVICE };
      const hdrs = new Headers(base);
      if (opts.headers) {
        const extra = new Headers(opts.headers as HeadersInit);
        for (const [k,v] of extra.entries()) hdrs.set(k, v);
      }
      try {
        // log outgoing header names (safe - does not print secret values)
        console.log('debug: rest outgoing header names:', Array.from(hdrs.keys()));
      } catch (e) { }
      hdrs.set('Content-Type', 'application/json');
      const res = await fetch(url, Object.assign({}, opts, { headers: hdrs }));
      const text = await res.text();
      let json;
      try { json = text ? JSON.parse(text) : null; } catch(e){ json = text; }
      return { status: res.status, body: json };
    };

  if (body.action === 'setWinner'){
      // Accept either `id` (numeric) or legacy `fight_id` from older scripts
      const idRaw = (body.id !== undefined ? body.id : body.fight_id);
      const id = Number(idRaw);
      if (!Number.isFinite(id) || id <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid fight id' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const winner = (body.winner === null) ? null : String(body.winner);
      // PATCH the fight row
      const patch = await rest(`/fights?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ winner }), headers: { 'Prefer': 'return=representation' } });
      // write audit
      await rest('/audit', { method: 'POST', body: JSON.stringify([{ actor: 'edge-function', action: 'setWinner', details: { id, winner } }]) });
      // return updated state (full)
    } else if (body.action === 'setCurrent'){
      // Support legacy `fight_id` alias for current index if provided
      const currentRaw = (body.current !== undefined ? body.current : body.fight_id);
      const current = Number(currentRaw);
      if (!Number.isFinite(current) || current < 0) {
        return new Response(JSON.stringify({ error: 'Invalid current index' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      // Upsert metadata state
      const state = { current: current, standby: body.standby === true, infoVisible: body.infoVisible !== false };
      await rest('/metadata', { method: 'POST', body: JSON.stringify([{ key: 'state', value: state }]), headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } });
      await rest('/audit', { method: 'POST', body: JSON.stringify([{ actor: 'edge-function', action: 'setCurrent', details: state }]) });
    } else if (body.action === 'setState'){
      const state = body.state || {};
      await rest('/metadata', { method: 'POST', body: JSON.stringify([{ key: 'state', value: state }]), headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' } });
      await rest('/audit', { method: 'POST', body: JSON.stringify([{ actor: 'edge-function', action: 'setState', details: state }]) });
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    // Fetch and return the full current state
  const fightsRes = await rest('/fights?select=*&order=ord', { method: 'GET' });
  const metaRes = await rest('/metadata?select=value&key=eq.state', { method: 'GET' });
    const fights = fightsRes.body || [];
    const metaRow = Array.isArray(metaRes.body) && metaRes.body.length ? metaRes.body[0] : null;
    const state = metaRow ? metaRow.value : { current: 0, standby: false, infoVisible: true };
    const out = { fights, state };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });

  } catch (e) {
    const msg = (e && e instanceof Error) ? e.message : String(e);
    let stack: string | null = null;
    if (e && e instanceof Error && e.stack) stack = e.stack;
    return new Response(JSON.stringify({ error: msg, error_stack: stack }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
