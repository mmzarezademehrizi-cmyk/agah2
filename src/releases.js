// انتشار و دانلود APK — ذخیره‌ی فایل در Workers KV به‌صورت تکه‌های ۴ مگابایتی (بدون نیاز به R2)
import { json, clean } from './util.js';

const CHUNK = 4 * 1024 * 1024;
const MAX_SIZE = 100 * 1024 * 1024;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function sha(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : '';
}

const TTL = 12 * 3600 * 1000;
async function makeToken(env) {
  const exp = String(Date.now() + TTL);
  return `${exp}.${await hmac(env.ADMIN_PASSWORD + '|agah-admin', exp)}`;
}
async function authed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const [exp, sig] = getCookie(request, 'agah_admin').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, await hmac(env.ADMIN_PASSWORD + '|agah-admin', exp));
}

const tries = new Map();
function throttled(ip) {
  const now = Date.now();
  const arr = (tries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  tries.set(ip, arr);
  if (tries.size > 2000) tries.clear();
  return arr.length > 8;
}

const safeName = (v) => String(v).replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 20) || 'x';

async function getLatest(env) {
  const id = await env.REL.get('latest');
  if (!id) return null;
  const { metadata } = await env.REL.getWithMetadata(`relmeta:${id}`);
  return metadata || null;
}

// ───────────── عمومی ─────────────
export async function latest(env) {
  if (!env.REL) return json({ ok: false, error: 'storage_not_configured' }, 503);
  const m = await getLatest(env);
  if (!m) return json({ ok: false, error: 'no_release' }, 404);
  return json({ ok: true, release: { id: m.id, version: m.version, notes: m.notes, size: m.size, sha256: m.sha256, at: m.at }, url: '/download/latest' }, 200, { 'cache-control': 'public, max-age=60' });
}

export async function download(request, env, ctx, path) {
  if (!env.REL) return json({ error: 'storage_not_configured' }, 503);
  let id = path.replace('/download/', '').replace(/\.apk$/, '');
  let m;
  if (id === 'latest') m = await getLatest(env);
  else m = (await env.REL.getWithMetadata(`relmeta:${safeName(id)}`)).metadata;
  if (!m) return json({ error: 'not_found' }, 404);

  const { readable, writable } = new FixedLengthStream(m.size);
  ctx.waitUntil(
    (async () => {
      const w = writable.getWriter();
      try {
        for (let n = 0; n < m.chunks; n++) {
          const buf = await env.REL.get(`rel:${m.id}:c${n}`, 'arrayBuffer');
          if (!buf) throw new Error('missing chunk');
          await w.write(new Uint8Array(buf));
        }
        await w.close();
      } catch (e) {
        await w.abort(e);
      }
    })()
  );
  return new Response(readable, {
    headers: {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': `attachment; filename="agah-${safeName(m.version)}.apk"`,
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  });
}

// ───────────── ادمین ─────────────
export async function admin(request, env, url) {
  const p = url.pathname.replace('/api/admin/', '');
  if (request.method !== 'GET') {
    const o = request.headers.get('Origin');
    if (o && o !== url.origin) return json({ error: 'forbidden' }, 403);
  }
  if (!env.ADMIN_PASSWORD) return json({ error: 'admin_not_configured' }, 503);
  if (!env.REL) return json({ error: 'storage_not_configured' }, 503);

  if (p === 'login' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (throttled(ip)) return json({ error: 'rate_limited' }, 429);
    let b = {};
    try { b = await request.json(); } catch {}
    const ok = safeEq(await sha(String(b.password || '')), await sha(env.ADMIN_PASSWORD));
    if (!ok) return json({ error: 'wrong_password' }, 401);
    const token = await makeToken(env);
    return json({ ok: true }, 200, { 'set-cookie': `agah_admin=${token}; Path=/; Max-Age=${TTL / 1000}; HttpOnly; Secure; SameSite=Strict` });
  }
  if (p === 'logout') {
    return json({ ok: true }, 200, { 'set-cookie': 'agah_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
  }
  if (!(await authed(request, env))) return json({ error: 'unauthorized' }, 401);

  if (p === 'me') return json({ ok: true });

  if (p === 'releases') {
    const l = await env.REL.list({ prefix: 'relmeta:' });
    const items = l.keys.map((k) => k.metadata).filter(Boolean).sort((a, b) => b.at - a.at);
    return json({ ok: true, latest: (await env.REL.get('latest')) || '', releases: items });
  }

  if (p === 'upload/start' && request.method === 'POST') {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const size = Number(b.size);
    const version = clean(b.version, 20);
    if (!/^[0-9A-Za-z._+-]{1,20}$/.test(version)) return json({ error: 'bad_version' }, 400);
    if (!Number.isInteger(size) || size < 1 || size > MAX_SIZE) return json({ error: 'bad_size' }, 400);
    if (!/^[0-9a-f]{64}$/.test(String(b.sha256))) return json({ error: 'bad_hash' }, 400);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const rec = { id, version, notes: clean(b.notes, 250), size, sha256: String(b.sha256), chunks: Math.ceil(size / CHUNK) };
    await env.REL.put(`pending:${id}`, JSON.stringify(rec), { expirationTtl: 86400 });
    return json({ ok: true, id, chunk: CHUNK, chunks: rec.chunks });
  }

  if (p === 'upload/chunk' && request.method === 'PUT') {
    const id = safeName(url.searchParams.get('id') || '');
    const n = Number(url.searchParams.get('n'));
    const rec = JSON.parse((await env.REL.get(`pending:${id}`)) || 'null');
    if (!rec || !Number.isInteger(n) || n < 0 || n >= rec.chunks) return json({ error: 'bad_chunk' }, 400);
    const buf = await request.arrayBuffer();
    const expect = n < rec.chunks - 1 ? CHUNK : rec.size - CHUNK * (rec.chunks - 1);
    if (buf.byteLength !== expect) return json({ error: 'bad_chunk_size' }, 400);
    await env.REL.put(`rel:${id}:c${n}`, buf);
    return json({ ok: true });
  }

  if (p === 'upload/finish' && request.method === 'POST') {
    let b = {};
    try { b = await request.json(); } catch {}
    const id = safeName(b.id || '');
    const rec = JSON.parse((await env.REL.get(`pending:${id}`)) || 'null');
    if (!rec) return json({ error: 'no_pending' }, 400);
    for (let n = 0; n < rec.chunks; n++) {
      const s = await env.REL.get(`rel:${id}:c${n}`, 'stream');
      if (!s) return json({ error: 'missing_chunk', n }, 400);
      s.cancel();
    }
    const meta = { id, version: rec.version, notes: rec.notes, size: rec.size, sha256: rec.sha256, chunks: rec.chunks, at: Date.now() };
    await env.REL.put(`relmeta:${id}`, '1', { metadata: meta });
    await env.REL.delete(`pending:${id}`);
    if (b.publish !== false) await env.REL.put('latest', id);
    return json({ ok: true, release: meta });
  }

  if (p === 'publish' && request.method === 'POST') {
    let b = {};
    try { b = await request.json(); } catch {}
    const id = safeName(b.id || '');
    const { metadata } = await env.REL.getWithMetadata(`relmeta:${id}`);
    if (!metadata) return json({ error: 'not_found' }, 404);
    await env.REL.put('latest', id);
    return json({ ok: true });
  }

  if (p === 'delete' && request.method === 'DELETE') {
    const id = safeName(url.searchParams.get('id') || '');
    const { metadata } = await env.REL.getWithMetadata(`relmeta:${id}`);
    if (!metadata) return json({ error: 'not_found' }, 404);
    for (let n = 0; n < metadata.chunks; n++) await env.REL.delete(`rel:${id}:c${n}`);
    await env.REL.delete(`relmeta:${id}`);
    if ((await env.REL.get('latest')) === id) {
      const l = await env.REL.list({ prefix: 'relmeta:' });
      const next = l.keys.map((k) => k.metadata).filter(Boolean).sort((a, b) => b.at - a.at)[0];
      if (next) await env.REL.put('latest', next.id); else await env.REL.delete('latest');
    }
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}
