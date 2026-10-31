"use strict";
/*
 * Myanmar Voice Application — Railway server version.
 *
 * Honest limits, stated in every response that needs them:
 * - Google's free Myanmar voice (translate_tts, tl=my) is ONE female voice.
 *   Every "male" / "Studio-style" / female-preset voice here is that same
 *   base voice pitch/formant-shifted with ffmpeg, never a native voice.
 * - Thiha / Nilar (Microsoft Azure voices) cannot be produced from this
 *   server: the Microsoft Edge TTS channel is unreachable from here, so
 *   /api/tts for them returns an honest error and NEVER fake audio.
 * - /api/recap never fabricates a recap. With no transcript and no readable
 *   page description it returns an error, not invented content.
 * - /api/dub is a STUB in this build: it honestly reports that full video
 *   dubbing (source download + blur + subtitle burn-in + merge) is not
 *   implemented here yet. What works now is the part plan + SRT export.
 * - No credit system. No Telegram code. No English voices. No paid APIs.
 * - Library is in-memory only: Railway instances are ephemeral, so a
 *   restart / redeploy loses saved Library items. The UI still says so.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------- voices
// Semitones relative to the single Google free Myanmar female voice.
// Male values match the retuned v6 figures from the Muse build
// (Ko Zaw ~131 Hz, Ko Kyaw ~122 Hz, Ko Htet ~113 Hz from a ~190 Hz base).
const VOICES = [
  { id: "f1", name: "မသန်း", group: "အမျိုးသမီး — မြန်မာ", style: "ကြည်လင် · ရှင်းလင်း", kind: "derived", semitones: 0.84 },
  { id: "f2", name: "မအေး", group: "အမျိုးသမီး — မြန်မာ", style: "နူးညံ့ · နွေးထွေး", kind: "derived", semitones: -0.89 },
  { id: "f3", name: "မသီတာ", group: "အမျိုးသမီး — မြန်မာ", style: "တက်ကြွ · လန်းဆန်း", kind: "derived", semitones: 2.40 },
  { id: "f4", name: "မနှင်း", group: "အမျိုးသမီး — မြန်မာ", style: "အေးဆေး · ငြိမ်", kind: "derived", semitones: -1.82 },
  { id: "f5", name: "မပို", group: "အမျိုးသမီး — မြန်မာ", style: "ဇာတ်လမ်းပြောဟန်", kind: "derived", semitones: 0 },
  { id: "f6", name: "မခိုင်", group: "အမျိုးသမီး — မြန်မာ", style: "ပြတ်သား · ကြည်", kind: "derived", semitones: 1.34 },
  { id: "f7", name: "မစု", group: "အမျိုးသမီး — မြန်မာ", style: "ချိုသာ · နူးညံ့", kind: "derived", semitones: 1.97 },
  { id: "f8", name: "မရီ", group: "အမျိုးသမီး — မြန်မာ", style: "တည်ငြိမ် · ပုံမှန်", kind: "derived", semitones: -1.44 },
  { id: "f9", name: "မလှ", group: "အမျိုးသမီး — မြန်မာ", style: "ရှင်းလင်း · သန့်", kind: "derived", semitones: 0 },
  { id: "f10", name: "မဖြူ", group: "အမျိုးသမီး — မြန်မာ", style: "နွေးထွေး · အေး", kind: "derived", semitones: -0.52 },
  { id: "s1", name: "Studio ကြည်လင်", group: "Google · Studio ပုံစံ — မြန်မာ", style: "ကြည် · studio ဟန်", kind: "derived", note: "Google Studio အသံအစစ် မဟုတ်ပါ — အခမဲ့ မြန်မာအသံကို studio ဟန်ချိန်ထားခြင်းသာ", semitones: 1.01 },
  { id: "s2", name: "Studio နွေးထွေး", group: "Google · Studio ပုံစံ — မြန်မာ", style: "နွေး · studio ဟန်", kind: "derived", note: "Google Studio အသံအစစ် မဟုတ်ပါ — အခမဲ့ မြန်မာအသံကို studio ဟန်ချိန်ထားခြင်းသာ", semitones: -1.07 },
  { id: "s3", name: "Studio တက်ကြွ", group: "Google · Studio ပုံစံ — မြန်မာ", style: "တက်ကြွ · studio ဟန်", kind: "derived", note: "Google Studio အသံအစစ် မဟုတ်ပါ — အခမဲ့ မြန်မာအသံကို studio ဟန်ချိန်ထားခြင်းသာ", semitones: 2.85 },
  { id: "nilar", name: "Nilar", group: "Azure အမည် — မြန်မာ", style: "အမျိုးသမီး · နူးညံ့", kind: "unreachable", audioAvailable: false, note: "Microsoft Azure အသံ — ဒီ server ကနေ ထုတ်လို့ မရပါ (channel မရောက်ပါ)၊ အသံအတု မပေးပါ" },
  { id: "thiha", name: "Thiha", group: "Azure အမည် — မြန်မာ", style: "အမျိုးသား · တည်ငြိမ်", kind: "unreachable", audioAvailable: false, note: "Microsoft Azure အသံ — ဒီ server ကနေ ထုတ်လို့ မရပါ (channel မရောက်ပါ)၊ အသံအတု မပေးပါ" },
  { id: "m1", name: "ကိုဇော်", group: "အမျိုးသား — မြန်မာ", style: "နိမ့် · ယောက်ျားဟန်", kind: "derived", note: "Google အခမဲ့ အမျိုးသမီးအသံကို နိမ့်အောင် ချိန်ထားခြင်း — native အမျိုးသားအသံ မဟုတ်ပါ", semitones: -6.4 },
  { id: "m2", name: "ကိုကျော်", group: "အမျိုးသား — မြန်မာ", style: "ပိုနိမ့် · ယောက်ျားဟန်", kind: "derived", note: "Google အခမဲ့ အမျိုးသမီးအသံကို နိမ့်အောင် ချိန်ထားခြင်း — native အမျိုးသားအသံ မဟုတ်ပါ", semitones: -7.7 },
  { id: "m3", name: "ကိုထက်", group: "အမျိုးသား — မြန်မာ", style: "အနိမ့်ဆုံး · ယောက်ျားဟန်", kind: "derived", note: "Google အခမဲ့ အမျိုးသမီးအသံကို နိမ့်အောင် ချိန်ထားခြင်း — native အမျိုးသားအသံ မဟုတ်ပါ", semitones: -9.1 },
];
const findVoice = (id) => VOICES.find((v) => v.id === id) || null;

// ---------------------------------------------------------------- helpers
function splitChunks(text) {
  const sentences = text.replace(/\r/g, "").split(/(?<=[။.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > 180) {
      let cut = rest.lastIndexOf(" ", 180);
      if (cut < 60) cut = 180;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : [text];
}

async function googleTtsChunk(chunk) {
  const url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=my&client=tw-ob&q=" + encodeURIComponent(chunk);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "audio/mpeg" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("google_tts_http_" + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error("google_tts_empty");
  return buf;
}

function ffmpegAvailable() {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

// Split an atempo factor into stages each inside ffmpeg's [0.5, 2.0] range.
function atempoStages(total) {
  let n = 1;
  while (total / 1 > 2 || total < 0.5) {
    // grow n until total^(1/n) is in range; loop guard below
    const f = Math.pow(total, 1 / n);
    if (f >= 0.5 && f <= 2.0) break;
    n += 1;
    if (n > 12) break;
  }
  const f = Math.pow(total, 1 / n);
  return Array(n).fill("atempo=" + f.toFixed(4)).join(",");
}

function shapeAudio(inputPath, outputPath, semitones, speed) {
  return new Promise((resolve, reject) => {
    const factor = Math.pow(2, semitones / 12);
    const tempo = (1 / factor) * speed;
    const filters = [];
    if (Math.abs(semitones) > 0.01) {
      filters.push("asetrate=44100*" + factor.toFixed(4), "aresample=44100");
    }
    if (Math.abs(tempo - 1) > 0.01 || filters.length) filters.push(atempoStages(tempo));
    if (!filters.length) return fs.copyFile(inputPath, outputPath, (e) => (e ? reject(e) : resolve()));
    const args = ["-y", "-i", inputPath, "-filter:a", filters.join(","), "-c:a", "libmp3lame", "-b:a", "192k", outputPath];
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg_exit_" + code + " " + err.slice(-300)))));
  });
}

function cleanRecapDraft(raw) {
  let cleaned = raw.replace(/\[?\d{1,2}:\d{2}(:\d{2})?\]?/g, " ").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/ဇာတ်လမ်းက ပြီးသွားပါပြီ/g, "").replace(/\s+/g, " ").trim();
  const sentences = cleaned.split(/(?<=[။.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  return sentences.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join(" ");
}

function estSeconds(text, speed) { return (text.length / 720 / (speed || 1)) * 60; }
function fmtSrtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), x = ms % 1000;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "," + String(x).padStart(3, "0");
}
function makeSrt(text, speed) {
  const segs = text.match(/.{1,120}(\s|$)/g) || [text];
  let t = 0; const out = [];
  segs.forEach((seg, i) => {
    const dur = Math.max(1.2, seg.trim().length / 720 / (speed || 1) * 60);
    out.push((i + 1) + "\n" + fmtSrtTime(t) + " --> " + fmtSrtTime(t + dur) + "\n" + seg.trim() + "\n");
    t += dur;
  });
  return out.join("\n");
}
function makePlan(text, speed) {
  const parts = [];
  for (let i = 0; i < text.length; i += 3000) {
    const chunk = text.slice(i, i + 3000);
    parts.push({ index: i / 3000, chars: chunk.length, estimatedSeconds: Math.round(estSeconds(chunk, speed) * 10) / 10, status: "not_built" });
  }
  return { totalChars: text.length, totalSeconds: Math.round(estSeconds(text, speed) * 10) / 10, partCount: Math.max(1, parts.length), parts };
}

// In-memory Library (ephemeral on Railway — disclosed in README + UI note).
const library = [];
const newId = () => crypto.randomBytes(8).toString("hex");

// ---------------------------------------------------------------- routes
app.get("/api/health", (req, res) => res.json({ ok: true, service: "voice-application-server", voices: VOICES.length }));

app.get("/api/voices", (req, res) => res.json({
  ok: true,
  language: "my",
  baseVoice: "Google အခမဲ့ မြန်မာ အသံ (tl=my) — အမျိုးသမီး အသံ တစ်သံတည်း။ derived အသံအားလုံးသည် ထိုအသံကို ffmpeg ဖြင့် pitch/formant ချိန်ထားခြင်းသာ၊ native အသံ မဟုတ်ပါ။",
  voices: VOICES,
}));

app.post("/api/tts", async (req, res) => {
  try {
    const text = String(req.body && req.body.text ? req.body.text : "").trim();
    const voiceId = String((req.body && req.body.voiceId) || "f1");
    let speed = Number((req.body && req.body.speed) || 1);
    if (!text) return res.status(400).json({ ok: false, error: "empty_text", message: "စာသား အရင် ရိုက်ပါ။" });
    if (text.length > 20000) return res.status(400).json({ ok: false, error: "too_long", message: "စာသား 20,000 လုံးအထိသာ ရပါတယ်။" });
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 4) speed = 1;
    const voice = findVoice(voiceId);
    if (!voice) return res.status(400).json({ ok: false, error: "unknown_voice", message: "အသံ မသိပါ။" });
    if (voice.kind === "unreachable") {
      return res.status(502).json({ ok: false, error: "voice_unreachable", voiceId, message: voice.name + " (Microsoft Azure အသံ) ကို ဒီ server ကနေ ထုတ်လို့ မရပါ — channel မရောက်ပါ။ အသံအတု မပေးပါ။ Google အခမဲ့ မြန်မာအသံ (သို့) ၎င်း၏ derived အသံကို ရွေးပါ။" });
    }
    const chunks = splitChunks(text);
    const parts = [];
    for (const c of chunks) parts.push(await googleTtsChunk(c));
    const baseMp3 = Buffer.concat(parts);
    const hasFfmpeg = await ffmpegAvailable();
    res.setHeader("X-Voice-Id", voice.id);
    res.setHeader("X-Voice-Kind", voice.kind);
    if (!hasFfmpeg || (Math.abs(voice.semitones) < 0.01 && speed === 1)) {
      res.setHeader("X-Pitch-Shift", hasFfmpeg ? "none_needed" : "skipped_no_ffmpeg");
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(baseMp3);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-tts-"));
    const inPath = path.join(dir, "in.mp3"), outPath = path.join(dir, "out.mp3");
    try {
      fs.writeFileSync(inPath, baseMp3);
      await shapeAudio(inPath, outPath, voice.semitones, speed);
      res.setHeader("X-Pitch-Shift", "applied");
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(fs.readFileSync(outPath));
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  } catch (e) {
    res.status(502).json({ ok: false, error: "tts_failed", message: "အသံထုတ်ရာမှာ အမှားရှိပါတယ် — Google အခမဲ့ အသံလိုင်းက ခေတ္တ မရခြင်း ဖြစ်နိုင်ပါတယ်။ ပြန်စမ်းပါ။", detail: String(e && e.message ? e.message : e).slice(0, 200) });
  }
});

app.post("/api/recap", async (req, res) => {
  try {
    const url = String((req.body && req.body.url) || "").trim();
    const transcript = String((req.body && req.body.transcript) || "").trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: "invalid_url", message: "https:// နဲ့ စတဲ့ ဗီဒီယို link အပြည့်အစုံ ထည့်ပါ။" });
    let sourceText = transcript, basedOn = "provided_transcript";
    if (!sourceText) {
      // Honest fallback only: a readable page description/caption, if any.
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000), redirect: "follow" });
        const html = await r.text();
        const m = html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["']|name=["']twitter:description["'])[^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property=["']og:description["']|name=["']description["'])/i);
        sourceText = m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() : "";
        if (sourceText) basedOn = "page_description";
      } catch (e) { sourceText = ""; }
    }
    if (!sourceText) {
      return res.status(422).json({ ok: false, error: "unreadable_link", message: "ဒီ link ကို တိုက်ရိုက် ဖတ်လို့ မရပါ — transcript / caption ကို ကူးထည့်ပေးမှ အကျဉ်းချုပ် လုပ်လို့ရပါတယ်။ စာသား မရှိဘဲ အကျဉ်းချုပ် အတု မထုတ်ပါ။" });
    }
    const draft = cleanRecapDraft(sourceText);
    if (!draft) return res.status(422).json({ ok: false, error: "empty_source", message: "ဖတ်လို့ရတဲ့ စာသား မရှိပါ — transcript / caption ကူးထည့်ပေးပါ။" });
    return res.json({ ok: true, url, basedOn, draft, note: "မူရင်းစာသားအတိုင်း အပိုမထည့်ဘဲ ပြင်ဆင်ထားပါတယ်။ အဆုံးပိတ်စာကြောင်း မပါပါ။ English ဘာသာပြန်အလိုအလျောက် မလုပ်ပါ — မူရင်းစာသားကို မူကြမ်းအဖြစ် ပေးပါတယ်။" });
  } catch (e) {
    res.status(502).json({ ok: false, error: "recap_failed", message: "Link ဖတ်ရာမှာ အမှားရှိပါတယ်။" });
  }
});

app.post("/api/plan", (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  let speed = Number((req.body && req.body.speed) || 1);
  if (!text) return res.status(400).json({ ok: false, error: "empty_text" });
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 4) speed = 1;
  res.json({ ok: true, ...makePlan(text, speed) });
});

app.post("/api/srt", (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  let speed = Number((req.body && req.body.speed) || 1);
  if (!text) return res.status(400).json({ ok: false, error: "empty_text" });
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 4) speed = 1;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(makeSrt(text, speed));
});

// Dub: STUB on purpose. Never pretend a video was made.
app.get("/api/dub/status", (req, res) => res.json({
  ok: true, status: "stub",
  message: "ဗီဒီယို dub အပြည့် (မူရင်းဗီဒီယို ဒေါင်းခြင်း + ဝါးခြင်း + စာတန်း burn-in + အပိုင်းပေါင်းခြင်း) ကို ဒီ Railway build မှာ မလုပ်ရသေးပါ။ ရတာက အပိုင်းခွဲအစီအစဉ် (/api/plan) နဲ့ စာတန်း (.srt, /api/srt) သာ ဖြစ်ပါတယ်။",
  implemented: ["part_plan", "srt_export"],
  notImplemented: ["source_download", "blur_burn_in", "subtitle_burn_in", "part_merge", "mp4_output"],
}));
app.post("/api/dub", (req, res) => res.status(501).json({
  ok: false, status: "stub", error: "dub_not_implemented",
  message: "ဗီဒီယို dub ကို ဒီ build မှာ မလုပ်ရသေးပါ — MP4 အတု / မပြီးသေးသော ဖိုင် မပေးပါ။ /api/plan ဖြင့် အပိုင်းခွဲအစီအစဉ်နှင့် /api/srt ဖြင့် စာတန်းကို အရင် သုံးနိုင်ပါတယ်။",
}));

app.get("/api/library", (req, res) => res.json({ ok: true, note: "In-memory only — server restart/redeploy တွင် ပျောက်မယ်။", items: library }));
app.post("/api/library", (req, res) => {
  const item = { id: newId(), type: String((req.body && req.body.type) || "studio"), voice: String((req.body && req.body.voice) || ""), text: String((req.body && req.body.text) || "").slice(0, 20000), url: String((req.body && req.body.url) || ""), at: new Date().toISOString() };
  library.unshift(item);
  res.json({ ok: true, item });
});
app.delete("/api/library/:id", (req, res) => {
  const i = library.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ ok: false, error: "not_found" });
  library.splice(i, 1);
  res.json({ ok: true, deleted: true });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log("Voice server listening on " + PORT));
