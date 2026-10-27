(() => {
  const $ = (s) => document.querySelector(s);
  const fa = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
  const date = (t) => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));
  const mb = (n) => fa.format(n / 1048576) + ' مگابایت';
  const show = (id, v) => { $(id).hidden = !v; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const r = await fetch('/api/admin/' + path, { credentials: 'same-origin', ...opts });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || String(r.status)); e.code = j.error; e.status = r.status; throw e; }
    return j;
  }
  const errText = (e) => ({
    wrong_password: 'رمز اشتباهه.', rate_limited: 'تلاش زیاد؛ چند دقیقه بعد دوباره امتحان کن.', unauthorized: 'نشست تموم شده؛ دوباره وارد شو.',
    bad_version: 'شماره‌ی نسخه فقط حروف انگلیسی، عدد و . - + داشته باشه.', bad_size: 'حجم فایل نامعتبره (حداکثر ۱۰۰ مگابایت).',
    missing_chunk: 'بعضی تکه‌ها ذخیره نشد؛ دوباره آپلود کن.',
  }[e.code] || ('خطا: ' + (e.code || e.message)));

  async function boot() {
    try {
      await api('me');
      show('#login', false); show('#setup', false); show('#panel', true); show('#logout', true);
      refresh();
    } catch (e) {
      show('#panel', false); show('#logout', false);
      if (e.code === 'admin_not_configured') {
        show('#login', false); show('#setup', true);
        $('#setupText').textContent = 'متغیر محرمانه‌ی ADMIN_PASSWORD روی Worker تنظیم نشده. در داشبورد کلودفلر: Workers ← agah ← Settings ← Variables and Secrets ← Add ← نوع Secret، نام ADMIN_PASSWORD.';
      } else if (e.code === 'storage_not_configured') {
        show('#login', false); show('#setup', true);
        $('#setupText').textContent = 'فضای ذخیره‌سازی (KV با نام REL) هنوز به Worker وصل نشده. یک‌بار دیگر دیپلوی کن؛ wrangler خودش می‌سازدش.';
      } else { show('#setup', false); show('#login', true); }
    }
  }

  async function refresh() {
    try {
      const j = await api('releases');
      const cur = j.releases.find((r) => r.id === j.latest);
      $('#curBody').innerHTML = cur
        ? `<div class="cur"><b>نسخه‌ی ${esc(cur.version)}</b><span>${mb(cur.size)} • ${date(cur.at)}</span><span>${esc(cur.notes || '')}</span><span class="h">SHA-256: ${esc(cur.sha256)}</span><a class="btn sm" style="width:max-content" href="/download/latest">دانلود (تست)</a></div>`
        : 'هنوز نسخه‌ای منتشر نشده.';
      const l = $('#list');
      l.innerHTML = '';
      if (!j.releases.length) { l.innerHTML = '<p class="muted">هنوز چیزی آپلود نشده.</p>'; return; }
      j.releases.forEach((r) => {
        const d = document.createElement('div');
        d.className = 'rel' + (r.id === j.latest ? ' on' : '');
        d.innerHTML = `<div class="i"><b>${esc(r.version)}</b>${r.id === j.latest ? '<span class="badge">منتشرشده</span>' : ''}<small>${mb(r.size)} • ${date(r.at)}</small></div><div class="a"></div>`;
        const a = d.querySelector('.a');
        if (r.id !== j.latest) {
          const b = document.createElement('button'); b.textContent = 'انتشار'; b.onclick = async () => { await api('publish', { method: 'POST', body: JSON.stringify({ id: r.id }) }); refresh(); }; a.appendChild(b);
        }
        const dl = document.createElement('a'); dl.href = '/download/' + r.id; dl.textContent = 'دانلود'; a.appendChild(dl);
        const x = document.createElement('button'); x.className = 'del'; x.textContent = 'حذف';
        x.onclick = async () => { if (confirm('نسخه‌ی ' + r.version + ' حذف بشه؟')) { await api('delete?id=' + r.id, { method: 'DELETE' }); refresh(); } };
        a.appendChild(x);
        l.appendChild(d);
      });
    } catch (e) { if (e.status === 401) boot(); }
  }

  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('#loginMsg'); m.className = 'msg'; m.textContent = '';
    try { await api('login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) }); $('#pw').value = ''; boot(); }
    catch (e) { m.className = 'msg err'; m.textContent = errText(e); }
  });
  $('#logout').addEventListener('click', async () => { await api('logout', { method: 'POST' }); boot(); });

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  function putChunk(url, blob, onProg) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.withCredentials = true;
      x.upload.onprogress = (e) => e.lengthComputable && onProg(e.loaded);
      x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error('http_' + x.status)));
      x.onerror = () => rej(new Error('network'));
      x.send(blob);
    });
  }

  $('#upForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('#upMsg'), btn = $('#upBtn'), prog = $('#prog');
    const f = $('#file').files[0];
    if (!f) return;
    msg.className = 'msg'; msg.textContent = '';
    btn.disabled = true; prog.hidden = false;
    const setP = (v, t) => { $('#pfill').style.width = v + '%'; $('#ptext').textContent = t; };
    try {
      setP(0, 'محاسبه‌ی اثر انگشت فایل…');
      const sha256 = hex(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()));
      const st = await api('upload/start', { method: 'POST', body: JSON.stringify({ version: $('#ver').value.trim(), notes: $('#notes').value.trim(), size: f.size, sha256 }) });
      let done = 0;
      for (let n = 0; n < st.chunks; n++) {
        const part = f.slice(n * st.chunk, Math.min(f.size, (n + 1) * st.chunk));
        let ok = false, last;
        for (let t = 0; t < 3 && !ok; t++) {
          try {
            await putChunk(`/api/admin/upload/chunk?id=${st.id}&n=${n}`, part, (loaded) => setP(Math.round(((done + loaded) / f.size) * 100), `در حال آپلود… ${mb(done + loaded)} از ${mb(f.size)}`));
            ok = true;
          } catch (e) { last = e; }
        }
        if (!ok) throw last;
        done += part.size;
      }
      setP(100, 'نهایی‌سازی…');
      await api('upload/finish', { method: 'POST', body: JSON.stringify({ id: st.id, publish: $('#pub').value === '1' }) });
      msg.className = 'msg ok';
      msg.textContent = 'آپلود شد ✅ ' + ($('#pub').value === '1' ? 'تا حدود یک دقیقه ممکنه هنوز در همه‌ی نقاط دنیا دیده نشه.' : '');
      $('#upForm').reset(); prog.hidden = true;
      refresh();
    } catch (e) { msg.className = 'msg err'; msg.textContent = errText(e); }
    btn.disabled = false;
  });

  boot();
})();
