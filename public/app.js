'use strict';
/* Faroese pronunciation trainer – front end. No API keys here: all VoisIT calls go through /api/* on our own server. */
const $ = (s, el = document) => el.querySelector(s);
const state = { hasKey: false, voice: localStorage.getItem('voice') || 'simun', lesson: null, warnMap: {}, audioCache: new Map(), current: null };
const SPEED = { normal: 1.0, slow: 0.7 };
const DEMO_AUDIO_MSG = 'โหมดสาธิต: เสียงภาษาแฟโรจริงต้องใช้ VoisIT API key ที่ตั้งไว้บนเซิร์ฟเวอร์ ตอนนี้ยังไม่มี จึงยังไม่มีเสียงให้ฟัง (เราไม่ใช้เสียงปลอม)';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer;
function toast(msg, ms = 4200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

// ---------- text normalisation & comparison (keeps Faroese letters á í ó ú ý ø æ ð) ----------
function normTokens(s) {
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/['-]/g, ' ').split(/\s+/).filter(Boolean);
}
function compareWords(target, heard) {
  const t = normTokens(target), h = normTokens(heard);
  const n = t.length, m = h.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = t[i] === h[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ok = new Array(n).fill(false); let i = 0, j = 0;
  while (i < n && j < m) { if (t[i] === h[j]) { ok[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const display = String(target).normalize('NFC').split(/\s+/).filter(Boolean); // original casing/punctuation for display
  return t.map((tok, k) => ({ tok, shown: display[k] ?? tok, ok: ok[k] }));
}

// ---------- audio playback via backend TTS proxy ----------
let player = null;
async function playRef(text, speedName, btn) {
  if (!state.hasKey) { toast(DEMO_AUDIO_MSG); return; }
  const speed = SPEED[speedName];
  const key = `${state.voice}|${speed}|${text}`;
  try {
    btn && btn.classList.add('loading-audio');
    let url = state.audioCache.get(key);
    if (!url) {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: state.voice, speed }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(apiErrorThai(e?.error?.code, r.status)); }
      url = URL.createObjectURL(await r.blob());
      state.audioCache.set(key, url);
    }
    if (player) player.pause();
    player = new Audio(url); await player.play();
  } catch (e) { toast(e.message || 'เล่นเสียงไม่ได้'); }
  finally { btn && btn.classList.remove('loading-audio'); }
}
function apiErrorThai(code, status) {
  const map = {
    NO_API_KEY: DEMO_AUDIO_MSG,
    QUOTA_EXCEEDED: 'โควตา VoisIT หมดแล้ว (เจ้าของแอปต้องเติมแพ็กเกจ)',
    INVALID_API_KEY: 'API key ของ VoisIT ไม่ถูกต้องหรือถูกยกเลิก',
    ENTITLEMENT_REQUIRED: 'แพ็กเกจหรือสิทธิ์ของ API key ไม่ครอบคลุมบริการนี้',
    INFERENCE_BUSY: 'เซิร์ฟเวอร์เสียงกำลังยุ่ง ลองใหม่อีกครู่',
    INFERENCE_UNAVAILABLE: 'เซิร์ฟเวอร์เสียงกำลังรีสตาร์ต ลองใหม่อีกครู่',
    EMPTY_AUDIO: 'ไม่ได้ยินเสียงในไฟล์ที่อัด ลองอัดใหม่ใกล้ไมค์ขึ้น',
    TEXT_NOT_IN_LESSONS: 'ข้อความนี้ไม่ได้อยู่ในบทเรียน จึงสร้างเสียงไม่ได้',
    UPSTREAM_UNREACHABLE: 'ติดต่อ VoisIT ไม่ได้ ตรวจอินเทอร์เน็ตของเซิร์ฟเวอร์',
  };
  return map[code] || `เกิดข้อผิดพลาด (${code || status})`;
}

// ---------- recording ----------
const rec = { mediaRecorder: null, chunks: [], stream: null, blob: null, url: null, startedAt: 0, timer: null };
function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return (window.MediaRecorder && c.find((t) => MediaRecorder.isTypeSupported?.(t))) || '';
}
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('เบราว์เซอร์นี้อัดเสียงไม่ได้ ลองใช้ Chrome หรือ Safari รุ่นใหม่'); return; }
  try { rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast('ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'); return; }
  const mime = pickMime();
  rec.chunks = [];
  rec.mediaRecorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.mediaRecorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
  rec.mediaRecorder.onstop = onRecordingStop;
  rec.mediaRecorder.start();
  rec.startedAt = Date.now();
  const b = $('#sheet-record'); b.classList.add('recording'); b.textContent = '⏹️ กดเพื่อหยุดอัด';
  $('#sheet-rec-status').textContent = 'กำลังอัด… พูดประโยคให้ชัด ๆ';
  rec.timer = setTimeout(() => stopRecording(), 15000); // safety cap
}
function stopRecording() {
  clearTimeout(rec.timer);
  if (rec.mediaRecorder && rec.mediaRecorder.state !== 'inactive') rec.mediaRecorder.stop();
  rec.stream?.getTracks().forEach((t) => t.stop());
  const b = $('#sheet-record'); b.classList.remove('recording'); b.textContent = '🎙️ อัดใหม่';
}
async function onRecordingStop() {
  const durationMs = Date.now() - rec.startedAt;
  rec.blob = new Blob(rec.chunks, { type: rec.mediaRecorder.mimeType || 'audio/webm' });
  if (rec.url) URL.revokeObjectURL(rec.url);
  rec.url = URL.createObjectURL(rec.blob);
  $('#sheet-own-play').disabled = false;
  if (!state.hasKey) {
    $('#sheet-rec-status').textContent = `อัดแล้ว ${(durationMs / 1000).toFixed(1)} วินาที กด “ฟังเสียงตัวเอง” เพื่อเทียบ`;
    $('#sheet-typed').hidden = false; $('#typed-input').focus({ preventScroll: true });
    return;
  }
  $('#sheet-rec-status').textContent = 'กำลังส่งเสียงให้ระบบฟัง…';
  try {
    const wav = await blobToWav16k(rec.blob);
    const r = await fetch('/api/asr', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Duration-Ms': String(durationMs) }, body: wav });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiErrorThai(data?.error?.code, r.status));
    $('#sheet-rec-status').textContent = '';
    showResult(state.current.fo, data.text || '', 'asr');
  } catch (e) {
    $('#sheet-rec-status').textContent = e.message || 'ส่งเสียงไม่สำเร็จ';
    $('#sheet-typed').hidden = false;
  }
}
// Browsers record webm/ogg/mp4; VoisIT reads WAV/FLAC/OGG/MP3 → convert to 16 kHz mono 16-bit WAV in the browser.
async function blobToWav16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close?.();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

function showResult(target, heard, source) {
  const res = compareWords(target, heard);
  const okCount = res.filter((r) => r.ok).length;
  const all = okCount === res.length;
  const missed = res.filter((r) => !r.ok);
  const tips = [...new Set(missed.map((r) => state.warnMap[r.tok]).filter(Boolean))];
  const el = $('#sheet-result'); el.hidden = false;
  el.innerHTML = `
    <div class="score">${all ? '🎉' : okCount ? '👍' : '🔁'} ระบบเข้าใจ ${okCount} จาก ${res.length} คำ</div>
    <div>${res.map((r) => `<span class="tok ${r.ok ? 'ok' : 'miss'}">${esc(r.shown)}</span>`).join('')}</div>
    <div class="heard">${source === 'asr' ? 'ระบบได้ยินว่า' : 'คุณพิมพ์ว่า (สาธิต)'}: “${esc(heard) || '—'}”</div>
    ${missed.length ? `<div class="miss-tips">${tips.map((t) => `<div class="warn"><b>⚠️ ข้อควรระวัง</b>${esc(t)}</div>`).join('')}
      <p class="muted">คำสีแดง: กด 🐢 ฟังเสียงช้า แล้วลองพูดคำนั้นใหม่อีกครั้ง</p></div>` : '<p class="muted">เยี่ยมมาก! ลองฟังเสียงของคุณเทียบกับต้นฉบับอีกครั้งเพื่อจับสำเนียง</p>'}`;
}

// ---------- practice sheet ----------
function openSheet(item) {
  state.current = item;
  $('#sheet-target').textContent = item.fo;
  $('#sheet-reading').textContent = item.th_reading || ''; $('#sheet-reading').hidden = !item.th_reading;
  $('#sheet-meaning').textContent = item.th_meaning || ''; $('#sheet-meaning').hidden = !item.th_meaning;
  $('#sheet-own-play').disabled = true; $('#sheet-result').hidden = true; $('#sheet-typed').hidden = true;
  $('#typed-input').value = ''; $('#sheet-rec-status').textContent = state.hasKey ? '' : 'โหมดสาธิต: อัดเสียงและฟังเสียงตัวเองได้ แต่ยังไม่มีระบบฟังอัตโนมัติ';
  $('#sheet-record').textContent = '🎙️ กดเพื่อเริ่มอัดเสียง';
  rec.blob = null;
  $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
}
function closeSheet() { stopRecording(); $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; if (player) player.pause(); }

// ---------- rendering ----------
let registry = []; // items referenced by data-i
function reg(item) { registry.push(item); return registry.length - 1; }
function audioBtns(item, { mic = true, small = false } = {}) {
  const i = reg(item), s = small ? ' small' : '';
  return `<div class="btn-row"><button class="btn${s}" data-act="normal" data-i="${i}" aria-label="ฟังเสียงปกติ">🔊${small ? '' : ' ฟัง'}</button>`
    + `<button class="btn${s}" data-act="slow" data-i="${i}" aria-label="ฟังเสียงช้า">🐢${small ? '' : ' ช้า'}</button>`
    + (mic ? `<button class="btn mic${s}" data-act="practice" data-i="${i}" aria-label="ฝึกพูด">🎙️${small ? '' : ' ฝึกพูด'}</button>` : '') + '</div>';
}
function wordRow(w) {
  return `<div class="word"><div class="w-txt"><span class="fo">${esc(w.fo)}</span>${w.th_reading ? ` — ${esc(w.th_reading)}` : ''}<small>${esc(w.th_meaning)}</small></div>${audioBtns(w, { small: true })}</div>`;
}
function render() {
  const L = state.lesson; registry = [];
  const sentences = L.sentences.map((s, n) => `
    <article class="card" id="${esc(s.id)}">
      <div><span class="num">${n + 1}</span><span class="muted">ประโยคที่ ${n + 1}</span></div>
      <h3 class="fo big">${esc(s.fo)}</h3>
      <p class="en">${esc(s.en)}</p>
      <p class="reading">${esc(s.th_reading)}</p>
      <p class="meaning">${esc(s.th_meaning)}</p>
      ${audioBtns(s)}
      <div class="warn"><b>⚠️ ข้อควรระวังสำหรับคนไทย</b>${esc(s.warning)}</div>
      <details open><summary>แยกคำ — กดฟังทีละคำ</summary><div class="words">${s.words.map(wordRow).join('')}</div></details>
      <details><summary>ฝึกผสมเสียง</summary><ul class="blend">${s.blend.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></details>
      <details><summary>ไวยากรณ์</summary><ul class="grammar">${s.grammar.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></details>
    </article>`).join('');
  const dlg = `<div class="card">${L.dialogue.lines.map((d) => `
      <div class="dlg-line"><div class="spk ${esc(d.speaker)}">${esc(d.speaker)}</div><div class="dlg-body">
        <div class="fo">${esc(d.fo)}</div><div>${esc(d.th_reading)}</div><div class="muted">${esc(d.th_meaning)}${d.note ? ` <span class="note">(${esc(d.note)})</span>` : ''}</div>
        ${audioBtns(d, { small: true })}</div></div>`).join('')}</div>`;
  const quiz = `<div class="card">${L.quiz.map((q, qi) => `
      <div class="quiz-q"><p>${qi + 1}. ${esc(q.question)}</p>${audioBtns({ fo: q.fo }, { mic: false, small: true })}
      ${q.choices.map((c, ci) => `<button class="choice" data-q="${qi}" data-c="${ci}">${'กขค'[ci]}. ${esc(c)}</button>`).join('')}</div>`).join('')}</div>`;
  const vocab = `<div class="card vocab">${L.vocab.map(wordRow).join('')}</div>`;
  const hw = `<div class="card hw">${L.homework.map((h, hi) => `
      <p><b>${hi + 1}.</b> ${esc(h.text)}</p>
      ${h.type === 'translate' ? `<textarea id="hw-${hi}" placeholder="พิมพ์คำตอบภาษาแฟโรที่นี่ (บันทึกไว้ในเครื่องนี้)"></textarea>
        <div class="btn-row"><button class="btn small" data-hint="${hi}">💡 ดูคำใบ้</button></div><p class="muted" id="hint-${hi}" hidden>คำใบ้: ${esc(h.hint)}</p>
        <p class="muted">ให้ครูหรือเพื่อนชาวแฟโรช่วยตรวจคำตอบนะครับ</p>` : ''}`).join('')}</div>`;
  $('#app').innerHTML = `
    <section class="lesson-head"><div class="meta">🇫🇴 ภาษาแฟโรประจำวัน — บทที่ ${L.number}</div>
      <h1>${esc(L.emoji || '')} ${esc(L.title)}</h1><div class="meta">${esc(L.level)} • ${L.sentences.length} ประโยค • ${esc(L.duration)}</div></section>
    <nav class="tabs"><a href="#sec-sentences">🗣️ ประโยค</a><a href="#sec-dialogue">💬 บทสนทนา</a><a href="#sec-quiz">✏️ แบบฝึกหัด</a><a href="#sec-vocab">📌 คำศัพท์</a><a href="#sec-hw">📝 การบ้าน</a></nav>
    <h2 class="section-title" id="sec-sentences">🗣️ ฟังแล้วพูดตาม</h2>${sentences}
    <h2 class="section-title" id="sec-dialogue">💬 ${esc(L.dialogue.title)}</h2>${dlg}
    <h2 class="section-title" id="sec-quiz">✏️ แบบฝึกหัด</h2>${quiz}
    <h2 class="section-title" id="sec-vocab">📌 คำศัพท์ที่อยากให้จำ</h2>${vocab}
    <h2 class="section-title" id="sec-hw">📝 การบ้าน</h2>${hw}
    <p class="footer-note">📚 ${L.sources.map(esc).join(' • ')}<br>${esc(L.disclaimer)}<br>🔜 บทถัดไป: ${esc(L.next)}<br>เสียงสังเคราะห์และระบบฟังเสียงโดย VoisIT (iSolveIT ApS)</p>`;
  L.homework.forEach((h, hi) => { const t = $(`#hw-${hi}`); if (t) { t.value = localStorage.getItem(`hw-${L.id}-${hi}`) || ''; t.oninput = () => localStorage.setItem(`hw-${L.id}-${hi}`, t.value); } });
}

function setBanner() {
  const b = $('#mode-banner'); b.hidden = false;
  if (state.hasKey) { b.className = 'banner live'; b.textContent = '✅ เชื่อมต่อ VoisIT แล้ว: กด 🔊 ฟังเสียงแฟโร และ 🎙️ ฝึกพูดให้ระบบช่วยตรวจได้'; }
  else { b.className = 'banner'; b.innerHTML = '🧪 <b>โหมดสาธิต</b> — ยังไม่ได้ตั้ง VoisIT API key บนเซิร์ฟเวอร์ จึง<b>ยังไม่มีเสียงแฟโรจริง</b> ส่วนการอัดเสียง ฟังเสียงตัวเอง และการเปรียบเทียบ (พิมพ์แทน) ลองใช้ได้'; }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) { const item = registry[+b.dataset.i]; if (b.dataset.act === 'practice') openSheet(item); else playRef(item.fo, b.dataset.act, b); return; }
  const c = e.target.closest('.choice');
  if (c) {
    const q = state.lesson.quiz[+c.dataset.q], ci = +c.dataset.c;
    c.parentElement.querySelectorAll('.choice').forEach((x) => x.classList.remove('correct', 'wrong'));
    c.classList.add(ci === q.answer ? 'correct' : 'wrong');
    if (ci !== q.answer) c.parentElement.querySelectorAll('.choice')[q.answer].classList.add('correct');
    toast(ci === q.answer ? '✅ ถูกต้อง!' : '❌ ยังไม่ถูก คำตอบที่ถูกเป็นสีเขียว', 2200); return;
  }
  const h = e.target.closest('[data-hint]'); if (h) { $(`#hint-${h.dataset.hint}`).hidden = false; }
});
$('#sheet-close').onclick = closeSheet; $('#sheet-backdrop').onclick = closeSheet;
$('#sheet-ref-normal').onclick = (e) => playRef(state.current.fo, 'normal', e.currentTarget);
$('#sheet-ref-slow').onclick = (e) => playRef(state.current.fo, 'slow', e.currentTarget);
$('#sheet-own-play').onclick = () => { if (!rec.url) return; if (player) player.pause(); player = new Audio(rec.url); player.play(); };
$('#sheet-record').onclick = () => (rec.mediaRecorder && rec.mediaRecorder.state === 'recording' ? stopRecording() : startRecording());
$('#typed-check').onclick = () => showResult(state.current.fo, $('#typed-input').value, 'typed');
$('#typed-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#typed-check').click(); });
$('#voice').value = state.voice;
$('#voice').onchange = (e) => { state.voice = e.target.value; localStorage.setItem('voice', state.voice); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// ---------- boot ----------
(async function boot() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({ hasKey: false }));
    state.hasKey = !!cfg.hasKey; setBanner();
    const idx = await fetch('/lessons/index.json').then((r) => r.json());
    const want = new URLSearchParams(location.search).get('lesson');
    const meta = idx.lessons.find((l) => l.id === want) || idx.lessons[idx.lessons.length - 1];
    state.lesson = await fetch(`/lessons/${meta.file}`).then((r) => r.json());
    for (const s of state.lesson.sentences) for (const [w, tip] of Object.entries(s.word_warnings || {})) state.warnMap[normTokens(w)[0]] = tip;
    render();
  } catch (e) { $('#app').innerHTML = '<p class="loading">โหลดบทเรียนไม่สำเร็จ กรุณารีเฟรช</p>'; console.error(e); }
})();
window.__test = { compareWords, normTokens };
