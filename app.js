"use strict";
/* 聊天存档 — all data lives in this browser's IndexedDB on the phone. */

const DEFAULT_AVATAR = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#e6dcfa"/><circle cx="24" cy="19" r="8" fill="#b9a3ec"/><path d="M8 44c2-9 9-14 16-14s14 5 16 14z" fill="#b9a3ec"/></svg>');
const $ = id => document.getElementById(id);

/* ---------------- IndexedDB ---------------- */
let idb;
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("bubble-archive", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
      d.createObjectStore("media");   // key -> Blob
      d.createObjectStore("meta");    // "profile" -> {...}
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const store = (name, mode = "readonly") => idb.transaction(name, mode).objectStore(name);
const dbGet = (s, k) => req(store(s).get(k));
const dbAll = s => req(store(s).getAll());
const dbPut = (s, v, k) => req(store(s, "readwrite").put(v, k));
const dbDel = (s, k) => req(store(s, "readwrite").delete(k));
const newKey = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------------- state ---------------- */
let messages = [];   // {id,date,t,from,ko,zh,media:{type,key,missing}|null}
let profile = { title: "聊天存档", name: "艺人", days: 0, avatarKey: null };
let avatarUrl = DEFAULT_AVATAR;
let firstPaint = true, ready = false;
const urlCache = new Map();

function sortMessages() {
  messages.sort((a, b) => a.date.localeCompare(b.date) || (a.t || "").localeCompare(b.t || "") || a.id - b.id);
}
async function loadAll() {
  messages = await dbAll("messages");
  sortMessages();
  const p = await dbGet("meta", "profile");
  if (p) profile = { ...profile, ...p };
  avatarUrl = DEFAULT_AVATAR;
  if (profile.avatarKey) { const u = await mediaUrl(profile.avatarKey); if (u) avatarUrl = u; }
}
async function mediaUrl(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await dbGet("media", key);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(key, u);
  return u;
}
function dropUrl(key) { const u = urlCache.get(key); if (u) { URL.revokeObjectURL(u); urlCache.delete(key); } }
async function askPersist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {} }

/* ---------------- helpers ---------------- */
function toast(t, ms = 2200) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, ms); }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function hl(s, q) {
  const e = esc(s); if (!q) return e;
  const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return e.replace(re, m => `<mark>${m}</mark>`);
}
function dateLabel(d) { const [y, m, dd] = d.split("-").map(Number); return `${y}年${m}月${dd}日 星期${"日一二三四五六"[new Date(y, m - 1, dd).getDay()]}`; }
function mediaType(mime, name = "") {
  if (/^image\//.test(mime)) return "image";
  if (/^video\//.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["m4a", "mp3", "aac", "wav", "ogg", "opus"].includes(ext)) return "audio";
  return null;
}
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", json: "application/json" };
const mimeOf = name => MIME[name.split(".").pop().toLowerCase()] || "application/octet-stream";
const extOf = mime => (Object.entries(MIME).find(([, m]) => m === mime) || ["bin"])[0];
const TYPE_LABEL = { image: "图片", video: "视频", audio: "语音" };

/* ---------------- render ---------------- */
function mediaHtml(m) {
  const md = m.media; if (!md) return "";
  if (md.missing || !md.key) return `<div class="missing media">[${TYPE_LABEL[md.type] || "附件"}] 还没上传文件，点这里补充</div>`;
  if (md.type === "image") return `<img class="media" data-key="${md.key}" alt="图片">`;
  if (md.type === "video") return `<video class="media" data-key="${md.key}" controls playsinline preload="metadata"></video>`;
  if (md.type === "audio") return `<div class="audio media"><audio data-key="${md.key}" controls preload="metadata"></audio></div>`;
  return "";
}
function render() {
  $("title").textContent = profile.title; document.title = profile.title;
  $("days").textContent = "+ " + (profile.days ?? 0);
  const q = $("q").value.trim().toLowerCase();
  const list = $("list");
  const shown = q ? messages.filter(m => ((m.ko || "") + " " + (m.zh || "")).toLowerCase().includes(q)) : messages;
  $("count").textContent = q ? `${shown.length} 条` : "";
  if (!shown.length) {
    list.innerHTML = `<div class="empty">${q ? "没有找到相关消息"
      : !ready ? "正在打开…"
      : "还没有聊天记录<br>可以导入 Claude 识别截图后给你的文件，<br>或者点下方输入框手动添加<br><button id=\"emptyImport\">导入文件</button>"}</div>`;
    $("emptyImport")?.addEventListener("click", () => $("importFile").click());
    return;
  }
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  let html = "", last = "";
  for (const m of shown) {
    if (m.date !== last) { html += `<div class="date" id="d-${m.date}">${dateLabel(m.date)}</div>`; last = m.date; }
    const inner = mediaHtml(m) + (m.ko ? `<div class="t">${hl(m.ko, q)}</div>` : "") + (m.zh ? `<div class="t">${hl(m.zh, q)}</div>` : "");
    const time = `<button class="time" data-id="${m.id}">${esc(m.t)}</button>`;
    if (m.from === "me") {
      html += `<div class="msg me"><div class="row">${time}<div class="bubble" data-id="${m.id}">${inner}</div></div></div>`;
    } else {
      html += `<div class="msg"><div class="ava"><img src="${avatarUrl}" alt=""></div><div class="body">
        <div class="who"><span class="badge">ARTIST</span><span class="name">${esc(profile.name)}</span></div>
        <div class="row"><div class="bubble" data-id="${m.id}">${inner}</div>${time}</div></div></div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll("[data-key]").forEach(el => lazy.observe(el));
  if (firstPaint) { firstPaint = false; list.scrollTop = list.scrollHeight; }
  else if (atBottom && !q) list.scrollTop = list.scrollHeight;
}
const lazy = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazy.unobserve(e.target);
    mediaUrl(e.target.dataset.key).then(u => { if (u) e.target.src = u; });
  }
}, { root: null, rootMargin: "800px 0px" });

/* ---------------- search & nav ---------------- */
$("btnSearch").onclick = () => { const sb = $("searchbox"); sb.hidden = !sb.hidden; if (!sb.hidden) $("q").focus(); else { $("q").value = ""; render(); } };
$("q").oninput = render;
$("btnTop").onclick = () => $("list").scrollTo({ top: 0 });
const show = id => $(id).hidden = false, hide = id => $(id).hidden = true;
document.querySelectorAll(".mask").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.hidden = true; }));

$("btnMenu").onclick = async () => {
  show("menuMask");
  try {
    const e = await navigator.storage.estimate();
    $("storageInfo").textContent = `共 ${messages.length} 条消息 · 已用 ${(e.usage / 1048576).toFixed(1)} MB`;
  } catch { $("storageInfo").textContent = `共 ${messages.length} 条消息`; }
};
document.querySelectorAll("#menuMask button").forEach(b => b.onclick = () => {
  hide("menuMask");
  const a = b.dataset.act;
  if (a === "add") openEdit(null);
  if (a === "bottom") $("list").scrollTo({ top: $("list").scrollHeight });
  if (a === "import") $("importFile").click();
  if (a === "export") exportBackup();
  if (a === "password") { ["pwOld", "pwNew", "pwNew2"].forEach(id => $(id).value = ""); show("pwMask"); }
  if (a === "jump") {
    const first = messages[0]?.date, lastD = messages[messages.length - 1]?.date;
    $("jDate").value = lastD || "";
    $("jHint").textContent = first ? `记录范围：${first} 至 ${lastD}` : "还没有记录";
    show("jumpMask");
  }
  if (a === "profile") {
    $("pTitle").value = profile.title; $("pName").value = profile.name; $("pDays").value = profile.days; $("pAva").value = "";
    show("profMask");
  }
});
$("jCancel").onclick = () => hide("jumpMask");
$("jGo").onclick = () => {
  const v = $("jDate").value; if (!v) return;
  hide("jumpMask");
  if ($("q").value) { $("q").value = ""; render(); }
  const target = messages.find(m => m.date >= v) || messages[messages.length - 1];
  if (!target) return;
  if (target.date !== v) toast(`${v} 没有消息，已跳到 ${target.date}`);
  document.getElementById("d-" + target.date)?.scrollIntoView({ block: "start" });
};

/* ---------------- edit ---------------- */
let editing = null, from = "artist", delArmed = false;
function setFrom(f) { from = f; $("segArtist").setAttribute("aria-checked", f === "artist"); $("segMe").setAttribute("aria-checked", f === "me"); }
$("segArtist").onclick = () => setFrom("artist");
$("segMe").onclick = () => setFrom("me");

function openEdit(id) {
  const m = id != null ? messages.find(x => x.id === id) : null;
  editing = m; delArmed = false;
  $("editTitle").textContent = m ? "编辑消息" : "添加消息";
  const lastM = messages[messages.length - 1];
  setFrom(m ? m.from || "artist" : "artist");
  $("fDate").value = m ? m.date : (lastM?.date || new Date().toISOString().slice(0, 10));
  $("fTime").value = m ? m.t : new Date().toTimeString().slice(0, 5);
  $("fKo").value = m?.ko || ""; $("fZh").value = m?.zh || "";
  $("fMedia").value = ""; $("fRm").checked = false;
  const md = m?.media;
  $("mediaHint").textContent = md ? (md.missing || !md.key ? `这条是${TYPE_LABEL[md.type] || "附件"}，还没上传文件` : `已有${TYPE_LABEL[md.type]}，重新选择可以替换`) : "";
  $("rmRow").hidden = !md;
  $("btnDel").hidden = !m; $("btnDel").classList.remove("armed"); $("btnDel").textContent = "删除";
  show("editMask");
}
$("list").addEventListener("click", e => {
  if (e.target.closest("video,audio")) return;
  const img = e.target.closest("img.media");
  if (img && img.src) { $("vImg").src = img.src; $("viewer").dataset.id = img.closest(".bubble").dataset.id; show("viewer"); return; }
  const b = e.target.closest(".bubble,.time");
  if (!b || window.getSelection().toString()) return;
  openEdit(+b.dataset.id);
});
$("vClose").onclick = () => hide("viewer");
$("vEdit").onclick = () => { hide("viewer"); openEdit(+$("viewer").dataset.id); };
$("btnAdd").onclick = $("btnAdd2").onclick = () => openEdit(null);
$("btnCancel").onclick = () => hide("editMask");

$("btnSave").onclick = async () => {
  const file = $("fMedia").files[0];
  const rec = { date: $("fDate").value, t: $("fTime").value, from, ko: $("fKo").value.trim(), zh: $("fZh").value.trim(), media: editing?.media || null };
  if (!rec.date) { toast("请选择日期"); return; }
  if (file && !mediaType(file.type, file.name)) { toast("只支持图片、视频或音频文件"); return; }
  if ($("fRm").checked && rec.media) { if (rec.media.key) { await dbDel("media", rec.media.key); dropUrl(rec.media.key); } rec.media = null; }
  if (!rec.ko && !rec.zh && !file && !rec.media) { toast("请至少填写一段内容或选择一个文件"); return; }
  const btn = $("btnSave"); btn.disabled = true; btn.textContent = "保存中…";
  try {
    if (file) {
      if (rec.media?.key) { await dbDel("media", rec.media.key); dropUrl(rec.media.key); }
      const key = newKey();
      await dbPut("media", file, key);
      rec.media = { type: mediaType(file.type, file.name), key };
    }
    if (editing) rec.id = editing.id;
    rec.id = await dbPut("messages", rec);
    const i = messages.findIndex(x => x.id === rec.id);
    if (i >= 0) messages[i] = rec; else messages.push(rec);
    sortMessages(); render(); hide("editMask"); toast("已保存"); askPersist();
  } catch (e) { toast(e?.name === "QuotaExceededError" ? "手机存储空间不足，保存失败" : "保存失败：" + (e?.message || e)); }
  finally { btn.disabled = false; btn.textContent = "保存"; }
};
$("btnDel").onclick = async () => {
  const b = $("btnDel");
  if (!delArmed) { delArmed = true; b.classList.add("armed"); b.textContent = "确认删除"; return; }
  const m = editing;
  if (m.media?.key) { await dbDel("media", m.media.key); dropUrl(m.media.key); }
  await dbDel("messages", m.id);
  messages = messages.filter(x => x.id !== m.id);
  render(); hide("editMask"); toast("已删除");
};

/* ---------------- profile ---------------- */
$("pCancel").onclick = () => hide("profMask");
$("pSave").onclick = async () => {
  profile.title = $("pTitle").value.trim() || profile.title;
  profile.name = $("pName").value.trim() || profile.name;
  profile.days = +$("pDays").value || 0;
  const f = $("pAva").files[0];
  if (f) {
    if (profile.avatarKey) { await dbDel("media", profile.avatarKey); dropUrl(profile.avatarKey); }
    profile.avatarKey = newKey();
    await dbPut("media", f, profile.avatarKey);
    avatarUrl = await mediaUrl(profile.avatarKey);
  }
  await dbPut("meta", profile, "profile");
  render(); hide("profMask"); toast("已保存");
};

/* ---------------- zip (store-only writer, store/deflate reader) ---------------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function crc32(blob) {
  let c = 0xFFFFFFFF; const r = blob.stream().getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; for (let i = 0; i < value.length; i++) c = CRC_TABLE[(c ^ value[i]) & 0xFF] ^ (c >>> 8); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0, cdSize = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = await crc32(f.blob), size = f.blob.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, f.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name); cdSize += 46 + name.length;
    offset += 30 + name.length + size;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let p = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error("不是有效的 zip 文件");
  const count = tail.getUint16(p + 10, true), cdSize = tail.getUint32(p + 12, true), cdOff = tail.getUint32(p + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder();
  const entries = {}; let o = 0;
  for (let i = 0; i < count; i++) {
    const method = cd.getUint16(o + 10, true), csize = cd.getUint32(o + 20, true), nlen = cd.getUint16(o + 28, true),
      elen = cd.getUint16(o + 30, true), clen = cd.getUint16(o + 32, true), lho = cd.getUint32(o + 42, true);
    entries[dec.decode(new Uint8Array(cd.buffer, o + 46, nlen))] = { method, csize, lho };
    o += 46 + nlen + elen + clen;
  }
  return {
    names: Object.keys(entries),
    async get(name) {
      const e = entries[name]; if (!e) return null;
      const lh = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
      const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = blob.slice(start, start + e.csize), type = mimeOf(name);
      if (e.method === 0) return new Blob([raw], { type });
      if (e.method === 8) return new Blob([await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()], { type });
      throw new Error("不支持这种压缩格式");
    }
  };
}

/* ---------------- import ---------------- */
// Import format: data.json = {profile?, messages:[{date,t,from,ko,zh,media?:{type,file?}}]}; media files beside it in the zip.
const sig = m => [m.date, m.t, m.from || "artist", m.ko || "", m.zh || "", m.media?.type || ""].join("\u0001");
$("importFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  toast("正在导入…", 60000);
  try {
    let data, zip = null, base = "";
    if (/\.json$/i.test(f.name) || f.type === "application/json") data = JSON.parse(await f.text());
    else {
      zip = await readZip(f);
      const dj = zip.names.find(n => /(^|\/)data\.json$/.test(n) && !n.startsWith("__MACOSX"));
      if (!dj) throw new Error("压缩包里没有 data.json");
      base = dj.slice(0, -"data.json".length);
      data = JSON.parse(await (await zip.get(dj)).text());
    }
    if (!Array.isArray(data.messages)) throw new Error("文件里没有消息列表");
    const seen = new Set(messages.map(sig));
    let added = 0, dup = 0, filled = 0;
    for (const raw of data.messages) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")) continue;
      const rec = { date: raw.date, t: raw.t || "", from: raw.from === "me" ? "me" : "artist", ko: raw.ko || "", zh: raw.zh || "", media: null };
      let blob = null;
      if (raw.media?.type) {
        rec.media = { type: raw.media.type, missing: true };
        if (zip && raw.media.file) blob = await zip.get(base + raw.media.file);
      }
      const s = sig(rec);
      if (seen.has(s)) {
        // Same message already here: if it was waiting for its file and the backup has it, fill it in.
        const ex = messages.find(m => sig(m) === s);
        if (blob && ex?.media && !ex.media.key) {
          const key = newKey(); await dbPut("media", blob, key);
          ex.media = { type: ex.media.type, key }; await dbPut("messages", ex); filled++;
        } else dup++;
        continue;
      }
      if (blob) { const key = newKey(); await dbPut("media", blob, key); rec.media = { type: rec.media.type, key }; }
      rec.id = await dbPut("messages", rec);
      messages.push(rec); seen.add(s); added++;
    }
    if (data.profile) {
      const p = data.profile;
      for (const k of ["title", "name", "days"]) if (p[k] != null && p[k] !== "") profile[k] = p[k];
      if (zip && p.avatar) {
        const blob = await zip.get(base + p.avatar);
        if (blob) { if (profile.avatarKey) await dbDel("media", profile.avatarKey); profile.avatarKey = newKey(); await dbPut("media", blob, profile.avatarKey); avatarUrl = await mediaUrl(profile.avatarKey); }
      }
      await dbPut("meta", profile, "profile");
    }
    sortMessages(); firstPaint = true; render(); askPersist();
    toast(`导入了 ${added} 条` + (filled ? `，补上 ${filled} 个附件` : "") + (dup ? `，跳过重复 ${dup} 条` : ""), 4000);
  } catch (err) { toast("导入失败：" + (err?.message || err), 5000); }
};

/* ---------------- export ---------------- */
async function exportBackup() {
  toast("正在打包备份…", 120000);
  try {
    const files = [], out = [];
    for (const m of messages) {
      const o = { date: m.date, t: m.t, from: m.from || "artist", ko: m.ko, zh: m.zh };
      if (m.media) {
        o.media = { type: m.media.type };
        const blob = m.media.key && await dbGet("media", m.media.key);
        if (blob) { o.media.file = `media/${m.media.key}.${extOf(blob.type)}`; files.push({ name: o.media.file, blob }); }
      }
      out.push(o);
    }
    const prof = { title: profile.title, name: profile.name, days: profile.days };
    if (profile.avatarKey) {
      const blob = await dbGet("media", profile.avatarKey);
      if (blob) { prof.avatar = `media/avatar.${extOf(blob.type)}`; files.push({ name: prof.avatar, blob }); }
    }
    files.unshift({ name: "data.json", blob: new Blob([JSON.stringify({ version: 1, profile: prof, messages: out }, null, 1)], { type: "application/json" }) });
    const zip = await makeZip(files);
    const fname = `聊天存档备份-${new Date().toISOString().slice(0, 10)}.zip`;
    const file = new File([zip], fname, { type: "application/zip" });
    $("toast").hidden = true;
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(zip); a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (err) { toast("备份失败：" + (err?.message || err), 5000); }
}

/* ---------------- open password ---------------- */
// A gate for people who pick up the phone. It does not encrypt what is stored.
async function hashPw(pw, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const randHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
async function savePw(pw) { const salt = randHex(16); await dbPut("meta", { salt, hash: await hashPw(pw, salt) }, "lock"); }
async function checkPw(pw) { const l = await dbGet("meta", "lock"); return !!l && await hashPw(pw, l.salt) === l.hash; }

let lockMode = "unlock", wipeArmed = false;
function showLock(mode) {
  lockMode = mode;
  $("lockTitle").textContent = mode === "setup" ? "设置打开密码" : "输入密码";
  $("lockHint").textContent = mode === "setup" ? "以后每次打开 App 都要输入这个密码。密码忘了无法找回，请记牢。" : "";
  $("lockPw").value = ""; $("lockPw2").value = "";
  $("lockPw").autocomplete = mode === "setup" ? "new-password" : "current-password";
  $("lockPw2").hidden = mode !== "setup";
  $("lockGo").textContent = mode === "setup" ? "设置并进入" : "解锁";
  $("lockForgot").hidden = mode === "setup"; $("forgotBox").hidden = true;
  show("lock"); setTimeout(() => $("lockPw").focus(), 50);
}
async function enter() {
  hide("lock");
  await loadAll(); ready = true; render();
}
$("lockForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pw = $("lockPw").value;
  if (lockMode === "setup") {
    if (pw.length < 4) { toast("密码至少 4 位"); return; }
    if (pw !== $("lockPw2").value) { toast("两次输入的密码不一样"); return; }
    await savePw(pw); await enter();
  } else {
    if (await checkPw(pw)) await enter();
    else { toast("密码不对"); $("lockPw").value = ""; $("lockPw").focus(); }
  }
});
$("lockForgot").onclick = () => { $("forgotBox").hidden = !$("forgotBox").hidden; };
$("wipeBtn").onclick = () => {
  const b = $("wipeBtn");
  if (!wipeArmed) { wipeArmed = true; b.classList.add("armed"); b.textContent = "再点一次，确认清空"; return; }
  idb.close();
  const r = indexedDB.deleteDatabase("bubble-archive");
  r.onsuccess = r.onerror = r.onblocked = () => location.reload();
};
// Lock again after the app has been in the background for 5 minutes.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (ready && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) location.reload();
});

$("pwCancel").onclick = () => hide("pwMask");
$("pwSave").onclick = async () => {
  if (!(await checkPw($("pwOld").value))) { toast("当前密码不对"); return; }
  const n = $("pwNew").value;
  if (n.length < 4) { toast("新密码至少 4 位"); return; }
  if (n !== $("pwNew2").value) { toast("两次输入的新密码不一样"); return; }
  await savePw(n); hide("pwMask"); toast("密码已修改");
};

/* ---------------- boot ---------------- */
(async () => {
  try { idb = await openDB(); }
  catch (e) { $("list").innerHTML = `<div class="empty">打不开本地存储：${esc(e?.message || e)}<br>请不要使用无痕浏览模式</div>`; return; }
  $("list").innerHTML = "";
  showLock((await dbGet("meta", "lock")) ? "unlock" : "setup");
})();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
