(() => {
  const $ = (s) => document.querySelector(s);
  const box = $('#msgs');
  if (!box || !window.AgahBrain) return;
  const form = $('#composer'), input = $('#msg'), sendBtn = $('#send'), chips = $('#chips');
  const dot = $('#dot'), dotText = $('#dotText');
  const KEY = 'agah_chat_v2', PKEY = 'agah_profile_v1';
  const DEFAULT_CHIPS = [...chips.querySelectorAll('button')].map((b) => b.textContent);

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let history = load(KEY, []);
  let profile = load(PKEY, {});
  let busy = false, last = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  function md(t) {
    const lines = esc(t).split('\n');
    let out = '', list = null;
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const raw of lines) {
      const l = raw.trim();
      let m;
      if ((m = l.match(/^[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^[\d۰-۹]+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
      else if (l === '') close();
      else { close(); out += `<p>${inline(l)}</p>`; }
    }
    close();
    return out;
  }

  const scroll = () => { box.scrollTop = box.scrollHeight; };
  function add(role, text) {
    const el = document.createElement('div');
    el.className = 'm ' + (role === 'user' ? 'u' : 'a');
    if (role === 'user') el.textContent = text; else el.innerHTML = md(text);
    box.appendChild(el);
    scroll();
    return el;
  }
  function setChips(list) {
    chips.innerHTML = '';
    (list || []).forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = c;
      b.addEventListener('click', () => send(c));
      chips.appendChild(b);
    });
    chips.hidden = !(list && list.length);
  }

  function greet() {
    add('assistant', 'سلام! 👋 من «مغز آگاه» هستم؛ دستیار اختصاصی آگاه که کاملاً داخل مرورگر خودت اجرا می‌شه.\nمی‌تونم برنامه‌ی ۷ روزه برای کم کردن اسکرول بسازم، بودجه ببندم، خوابت رو مرتب کنم و به سؤال‌های عادت و روان‌شناسی جواب بدم. اگه بذاری بیشتر آشنا بشیم، پیشنهادهام خیلی شخصی‌تر می‌شن.');
  }
  function render() {
    box.innerHTML = '';
    if (!history.length) greet();
    history.forEach((m) => add(m.role, m.content));
    setChips(DEFAULT_CHIPS);
  }

  function setBusy(v) { busy = v; sendBtn.disabled = v; }
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }

  async function typeOut(el, text) {
    const n = text.length, step = Math.max(2, Math.ceil(n / 90));
    for (let i = step; i < n; i += step) { el.innerHTML = md(text.slice(0, i)); scroll(); await sleep(14); }
    el.innerHTML = md(text); scroll();
  }

  async function respond(getReply, userText) {
    const bot = add('assistant', '');
    bot.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    setBusy(true); setChips([]);
    await sleep(380 + Math.min(700, (userText || '').length * 6));
    let r;
    try { window.AgahBrain.setProfile(profile); r = getReply(); } catch (e) { r = { text: 'یه مشکل کوچیک پیش اومد؛ دوباره بگو.', chips: [] }; }
    await typeOut(bot, r.text);
    history.push({ role: 'assistant', content: r.text });
    save(KEY, history.slice(-60));
    setChips(r.chips && r.chips.length ? r.chips : DEFAULT_CHIPS.slice(0, 3));
    setBusy(false);
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    if (Date.now() - last < 500) return;
    last = Date.now();
    input.value = ''; autosize();
    history.push({ role: 'user', content: text });
    add('user', text);
    await respond(() => window.AgahBrain.answer(text), text);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $('#clear').addEventListener('click', () => {
    window.AgahBrain.reset();
    history = []; save(KEY, []); render();
  });

  // پروفایل کناری
  const map = { 'p-goal': 'goal', 'p-app': 'app', 'p-budget': 'budget', 'p-goalname': 'goalName', 'p-focus': 'focus' };
  Object.entries(map).forEach(([id, k]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (profile[k] != null) el.value = profile[k];
    el.addEventListener('input', () => { profile[k] = el.value; save(PKEY, profile); window.AgahBrain.setProfile(profile); });
  });

  // چک‌این روزانه (فرم کناری)
  let mood = '';
  document.querySelectorAll('#moods button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#moods button').forEach((x) => x.classList.remove('on'));
    mood = mood === b.dataset.m ? '' : b.dataset.m;
    if (mood) b.classList.add('on');
  }));
  $('#checkin').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const s = $('#c-screen').value, sp = $('#c-spend').value;
    if (!s && !sp) return;
    const parts = [];
    if (s) parts.push(`امروز ${s} دقیقه روی اپ‌های وقت‌گیر بودم`);
    if (sp) parts.push(`${sp} تومان خرج کردم`);
    if (mood) parts.push(`حالم ${mood} بود`);
    const text = 'چک‌این امروزم: ' + parts.join('، ');
    history.push({ role: 'user', content: text });
    add('user', text);
    $('#assistant').scrollIntoView({ behavior: 'smooth' });
    await respond(() => window.AgahBrain.checkin({ scr: +s || 0, sp: +sp || 0, mood }), text);
  });

  dot.className = 'dot on';
  dotText.textContent = 'اجرا در مرورگر تو • بدون ارسال داده';
  render();
  if (new URLSearchParams(location.search).get('from') === 'app') setTimeout(() => input.focus({ preventScroll: true }), 1200);
})();
