# 🇫🇴 ฝึกออกเสียงภาษาแฟโร — Faroese Pronunciation Trainer (for Thai speakers)

เว็บแอปต้นแบบสำหรับคนไทยที่อยู่หมู่เกาะแฟโร ฝึก **ฟัง → พูดตาม → อัดเสียง → ตรวจว่าเครื่องฟังเข้าใจไหม** ใช้ VoisIT API (ระบบเสียงภาษาแฟโร) ผ่านเซิร์ฟเวอร์ของเราเอง API key จึงไม่หลุดไปที่หน้าเว็บ

A mobile-first prototype web app for Thai people living in the Faroe Islands to practise Faroese pronunciation, using the VoisIT text-to-speech and speech-to-text API through a tiny backend proxy (the API key never reaches the browser).

Feasibility test of free Faroese TTS/ASR models versus VoisIT: [docs/free-models-test/REPORT.md](docs/free-models-test/REPORT.md).

---

## ภาษาไทย

### ทำอะไรได้บ้าง
- บทที่ 9 “เวลาและวันในสัปดาห์” (3 ประโยค, แยกคำ, บทสนทนา, แบบฝึกหัด, คำศัพท์, การบ้าน)
- ทุกประโยค ทุกคำ ทุกบรรทัดบทสนทนา มีปุ่ม 🔊 ฟังปกติ (ความเร็ว 1.0) และ 🐢 ฟังช้า (0.7)
- เลือกเสียงได้ 4 เสียง: Símun, Elin, Drongur, Genta
- 🎙️ ฝึกพูด: อัดเสียงตัวเอง ฟังเสียงตัวเองเทียบกับต้นฉบับ ส่งให้ VoisIT แปลงเป็นข้อความ แล้วเทียบทีละคำ คำที่ถูกเป็นสีเขียว คำที่พลาดเป็นสีแดง พร้อมคำเตือนการออกเสียงสำหรับคนไทย และสรุป “ระบบเข้าใจ X จาก Y คำ”
- **ข้อจำกัดที่บอกตรง ๆ:** ระบบนี้ตรวจว่า *เครื่องฟังเสียงเข้าใจสิ่งที่พูดไหม* ไม่ใช่การให้คะแนนสำเนียงอย่างละเอียด
- **โหมดสาธิต** (ไม่มี key): หน้าเว็บใช้ได้ทั้งหมด ปุ่มฟังจะแจ้งว่าต้องมี VoisIT key ก่อน (ไม่มีเสียงปลอม) ยังอัดเสียงและฟังเสียงตัวเองได้ และลองระบบเปรียบเทียบได้โดยพิมพ์สิ่งที่พูด
- เซิร์ฟเวอร์เก็บเสียงที่สร้างแล้วไว้ในดิสก์ (`cache/tts/`) ข้อความ เสียง และความเร็วเดิมจะไม่ถูกคิดเงินซ้ำ
- เซิร์ฟเวอร์ยอมสร้างเสียงเฉพาะข้อความที่อยู่ในไฟล์บทเรียน คนอื่นจึงเอาไปใช้เปลืองโควตาไม่ได้

### วิธีรัน
ต้องมี Node.js 18 ขึ้นไป (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
```bash
cp .env.example .env        # แล้วใส่ VOISIT_API_KEY=vit_live_...
npm start                   # หรือ: VOISIT_API_KEY=vit_live_... node server.js
# เปิด http://localhost:3000
```
ถ้าไม่ใส่ key แอปจะเปิดเป็นโหมดสาธิต
> ไมโครโฟนในมือถือใช้ได้เฉพาะ **HTTPS** (หรือ localhost) ตอนทดสอบบนมือถือจึงต้องใช้ลิงก์ HTTPS เช่นหลัง deploy หรือใช้ tunnel

### ขอ API key
สมัครที่ https://voisit.fo แล้วสร้าง key ในพอร์ทัล (เมนู API-lyklar) ติ๊ก scope `tts` และ `asr` (และ `usage:read` ถ้าต้องการดูโควตา) key ขึ้นต้นด้วย `vit_live_` และแสดงแค่ครั้งเดียว

### เพิ่มบทเรียน
คัดลอก `lessons/lesson-09.json` เป็นไฟล์ใหม่ แก้เนื้อหา แล้วเพิ่มบรรทัดใน `lessons/index.json` เปิดบทที่ต้องการด้วย `?lesson=lesson-10` (ถ้าไม่ระบุจะเปิดบทล่าสุด) `word_warnings` คือคำเตือนที่จะแสดงเมื่อพูดคำนั้นพลาด

### Deploy (ต้องมี backend, จะใช้ static hosting อย่างเดียวไม่ได้)
- **Render**: ใช้ Blueprint `render.yaml` ที่รากของ repo (Web Service `faroese-pronunciation`, Node, แพลน free, Frankfurt, build `npm install`, start `npm start`, health check `/`). ใส่ `VOISIT_API_KEY` ใน Dashboard ตอนสร้าง Blueprint (`sync: false` จึงไม่มีค่าลับในไฟล์). แพลน free ไม่มีดิสก์ถาวร เซิร์ฟเวอร์สร้าง `cache/` ตอนสตาร์ท และแคชเสียงจะหายเมื่อ deploy หรือเครื่องหยุด
- **Fly.io**: `fly launch` (ใช้ Node), `fly secrets set VOISIT_API_KEY=...`, สร้าง volume แล้วตั้ง `TTS_CACHE_DIR=/data/tts`
- **Railway**: ทำนองเดียวกัน ตั้ง env และ volume
- **Vercel**: ต้องแปลง `/api/tts` และ `/api/asr` เป็น Serverless Functions และย้าย cache ไปเก็บที่ Vercel Blob/KV เพราะดิสก์ไม่ถาวร (ต้องเขียนโค้ดเพิ่ม)

### คำถามที่ยังเปิดอยู่ (ต้องเคลียร์ก่อนเปิดให้คนทั่วไปใช้)
1. **ราคา VoisIT ยังไม่รู้**: ราคาอยู่ในพอร์ทัลหลังสมัคร ควรขอใบเสนอราคา ทั้ง TTS (คิดตามจำนวนตัวอักษร) และ ASR (คิดตามวินาทีเสียง)
2. **เงื่อนไขการใช้งาน**: เอกสารบอกว่าห้ามนำผลลัพธ์ไป “train, fine-tune หรือ evaluate speech models” และห้าม clone เสียง แอปนี้ไม่ได้ประเมินโมเดล แต่ควรยืนยันเป็นลายลักษณ์อักษรว่า **ใช้ในแอปสอนภาษาสาธารณะที่เปิดให้คนอื่นใช้ได้** ติดต่อ iSolveIT ApS ที่ mail@isolveit.net (หน้าเอกสาร API ระบุ andras@isolveit.net สำหรับคำถามเรื่อง API)
3. **ความเป็นส่วนตัว**: VoisIT **เก็บไฟล์เสียงที่ส่งไปถอดความไว้** (ยังไม่มีตัวเลือกปิดสำหรับ ASR) ต้องแจ้งผู้ใช้ในนโยบายความเป็นส่วนตัว (GDPR)
4. รูปแบบคำตอบของ ASR ไม่ได้ระบุชัดในเอกสาร เซิร์ฟเวอร์อ่าน `text`/`transcript`/`segments` ไว้ก่อน ต้องทดสอบกับ key จริง
5. ควรเพิ่ม rate limit ต่อผู้ใช้ก่อนเปิดสาธารณะ เพราะ ASR คิดเงินทุกครั้งที่อัดเสียง

---

## English

### Features
- Lesson 9 (time & days of the week) loaded from `lessons/lesson-09.json`; add lessons by adding JSON files and listing them in `lessons/index.json`.
- 🔊 normal (1.0) and 🐢 slow (0.7) playback for every sentence, word and dialogue line; voice selector (simun, elin, drongur, genta).
- 🎙️ practice sheet: MediaRecorder recording → own playback next to the reference → converted in-browser to 16 kHz mono WAV (VoisIT accepts WAV/FLAC/OGG/MP3, browsers record webm/mp4) → `/api/asr` → word-by-word LCS comparison (case/punctuation-insensitive, Faroese letters kept) → green/red words, Thai tips for missed words, “understood X of Y words”.
- Honest copy: it checks intelligibility to the recogniser, not a detailed accent score.
- Demo mode without a key: no fake audio. Listen buttons explain that the key is needed; recording and own playback work; comparison can be tried by typing what you said.

### Backend (`server.js`, zero dependencies, Node ≥ 18)
- Serves `public/` and `lessons/`.
- `GET /api/config` → `{hasKey, voices}` (never the key itself).
- `POST /api/tts` `{text, voice, speed}` → proxies `POST /api/v1/tts/speech` with `{inputs, parameters:{voice, speed, audio_format:'mp3', store}}`, Bearer key and a fresh `Idempotency-Key` UUID; decodes `audio_base64`, caches to `cache/tts/<sha256>.mp3` (or `.wav` if VoisIT returns its WAV master), and returns audio bytes. It only accepts text that appears as `fo` in the lesson files (`ALLOW_ANY_TEXT=1` lifts this), and speeds from 0.6 to 1.6.
- `POST /api/asr` (raw WAV body, `X-Duration-Ms` header) → proxies multipart `POST /api/v1/asr/transcriptions` with `file`, `language=fo`, `model=voisit-asr-2026`, `duration_ms`; returns `{text, model}`.
- VoisIT error codes are passed through and shown in Thai (quota, invalid key, busy, …).

### Run
```bash
cp .env.example .env   # set VOISIT_API_KEY=vit_live_...
npm start              # http://localhost:3000
```
Env vars: `VOISIT_API_KEY`, `PORT`, `VOISIT_ASR_MODEL`, `VOISIT_STORE` (0 = ask VoisIT not to keep TTS output), `ALLOW_ANY_TEXT`, `TTS_CACHE_DIR`, `VOISIT_BASE_URL`.
Microphone access on phones needs HTTPS.

### Deploy
`render.yaml` defines a free Node web service in Frankfurt (`npm install`, `npm start`, health check `/`). Set `VOISIT_API_KEY` in the Render Dashboard when applying the Blueprint; it is declared with `sync: false` and is not stored in the repo. The free plan has an ephemeral filesystem, so the TTS cache under `cache/` is recreated on startup and does not survive deploys. Fly.io / Railway can run `node server.js` with `VOISIT_API_KEY` as a secret and a volume for the cache. Vercel needs the two API routes rewritten as serverless functions and the cache moved to Blob/KV storage.

### Open questions
- VoisIT pricing is not public (it is shown in the portal after sign-up). Ask for a quote.
- Terms forbid using output to train, fine-tune or evaluate speech models, or to clone voices. Get written confirmation that a public learning app is allowed: mail@isolveit.net (the API docs list andras@isolveit.net for API questions).
- ASR uploads are retained by VoisIT, and there is no opt-out yet. This needs a privacy notice (GDPR).
- The ASR response schema is not documented. The parser tries `text`, `transcript` and `segments`. Verify it with a real key.
- Add per-user rate limiting before a public launch.

Credits: VoisIT by iSolveIT ApS. Lesson content: Lesson 9 of the “ภาษาแฟโรประจำวัน” series. The Thai readings are approximate.
