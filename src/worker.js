// Agah — Cloudflare Worker
// - فایل‌های استاتیک سایت (./public)
// - /api/latest و /download/latest: دانلود APK
// - /api/admin/*: پنل ادمین برای بارگذاری APK (ذخیره در KV)
import * as rel from './releases.js';
import { json } from './util.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === '/api/health') return json({ ok: true, store: !!env.REL, admin: !!env.ADMIN_PASSWORD });
      if (p === '/api/latest') return await rel.latest(env);
      if (p.startsWith('/download/')) return await rel.download(request, env, ctx, p);
      if (p.startsWith('/api/admin/')) return await rel.admin(request, env, url);
    } catch (e) {
      return json({ error: 'server_error' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
