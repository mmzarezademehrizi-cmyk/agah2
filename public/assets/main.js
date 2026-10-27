(() => {
  const $ = (s) => document.querySelector(s);
  const cfg = window.AGAH_CONFIG || {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fa = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

  // download links
  const dls = document.querySelectorAll('.dl');
  const apk = cfg.apkUrl || '/download/latest';
  const fa1 = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
  const noRelease = () => dls.forEach((a) => { a.setAttribute('href', '#faq'); a.dataset.none = '1'; });
  if (apk.startsWith('/')) {
    dls.forEach((a) => a.setAttribute('href', apk));
    fetch('/api/latest').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => {
      const v = $('#ver');
      if (v && j.release) { v.hidden = false; v.lastChild.textContent = ' نسخه‌ی ' + j.release.version + ' • ' + fa1.format(j.release.size / 1048576) + ' مگابایت'; }
    }).catch(noRelease);
  } else if (apk.includes('YOUR-USERNAME')) noRelease();
  else dls.forEach((a) => { a.setAttribute('href', apk); a.setAttribute('rel', 'noopener'); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.dl');
    if (a && a.dataset.none === '1') {
      const t = $('#toast');
      t.textContent = 'هنوز نسخه‌ای برای دانلود منتشر نشده؛ به‌زودی.';
      t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 3200);
    }
  });
  const gh = $('#gh');
  if (gh && cfg.githubUrl) { gh.href = cfg.githubUrl; gh.hidden = false; gh.rel = 'noopener'; }
  $('#yr').textContent = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' }).format(new Date());

  // nav + progress
  const nav = $('#nav'), bar = $('#bar');
  const onScroll = () => {
    nav.classList.toggle('s', scrollY > 10);
    const h = document.documentElement;
    bar.style.width = (scrollY / Math.max(1, h.scrollHeight - innerHeight)) * 100 + '%';
  };
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  // mobile menu
  const burger = $('#burger'), menu = $('#menu');
  burger.addEventListener('click', () => {
    const o = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', o);
  });
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }));

  // reveal
  const els = document.querySelectorAll('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.1 });
    els.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 80 + 'ms'; io.observe(el); });
  } else els.forEach((el) => el.classList.add('in'));

  // cursor glow on cards + hero
  document.querySelectorAll('.t').forEach((c) => c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', e.clientX - r.left + 'px');
    c.style.setProperty('--my', e.clientY - r.top + 'px');
  }));
  const hero = $('#hero'), stage = $('#stage');
  if (!reduce && matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      hero.style.setProperty('--hx', x * 100 + '%');
      hero.style.setProperty('--hy', y * 100 + '%');
      stage.style.setProperty('--ry', (x - 0.5) * 14 + 'deg');
      stage.style.setProperty('--rx', (0.5 - y) * 10 + 'deg');
    });
    hero.addEventListener('pointerleave', () => { stage.style.setProperty('--ry', '0deg'); stage.style.setProperty('--rx', '0deg'); });
  }

  // calculator
  const hrs = $('#hrs'), tgt = $('#tgt');
  const paint = (el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%');
  const calc = () => {
    const h = parseFloat(hrs.value), t = parseFloat(tgt.value);
    paint(hrs); paint(tgt);
    $('#hv').textContent = fa.format(h) + ' ساعت';
    $('#tv').textContent = fa.format(t) + ' دقیقه';
    const now = (h * 365) / 24;
    const capMin = Math.min(h * 60, t);
    const after = (capMin * 365) / 1440;
    const set = (id, v, unit) => { $(id).innerHTML = fa.format(Math.round(v * 10) / 10) + '<small>' + unit + '</small>'; };
    set('#r1', now, 'روز'); set('#r2', after, 'روز'); set('#r3', Math.max(0, now - after), 'روز در سال');
  };
  hrs.addEventListener('input', calc); tgt.addEventListener('input', calc); calc();

  // arriving from the app
  const q = new URLSearchParams(location.search);
  if (q.get('from') === 'app') {
    const t = $('#toast');
    setTimeout(() => {
      t.textContent = 'خوش اومدی! دستیار آنلاین آماده‌ست ✨';
      t.classList.add('on');
      setTimeout(() => t.classList.remove('on'), 3500);
      if (!location.hash) $('#assistant').scrollIntoView({ behavior: 'smooth' });
    }, 600);
  }
})();
