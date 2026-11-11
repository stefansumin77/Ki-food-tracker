import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.2.0/+esm";

/* ---------------- Speicher ---------------- */
const KEY_ENTRIES = "kft.entries";
const KEY_SETTINGS = "kft.settings";

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { alert("Speichern fehlgeschlagen: " + e.message); return false; }
}

let entries = load(KEY_ENTRIES, []);
let settings = Object.assign({ goal: 2000, apiKey: "" }, load(KEY_SETTINGS, {}));

/* ---------------- Hilfen ---------------- */
const $ = (id) => document.getElementById(id);
const dayKey = (d) => d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in lokaler Zeit
let currentDay = new Date();

function round(n) { return Math.round(Number(n) || 0); }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Bild verkleinern und als JPEG-Base64 zurückgeben. */
function resizeImage(file, maxSide, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------- Navigation ---------------- */
document.querySelectorAll("nav.tabs button").forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view));
});
function showView(name) {
  ["heute", "neu", "einst"].forEach((v) => $("view-" + v).classList.toggle("hidden", v !== name));
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "heute") renderDay();
  window.scrollTo(0, 0);
}

/* ---------------- Tagebuch ---------------- */
$("prevDay").onclick = () => { currentDay.setDate(currentDay.getDate() - 1); renderDay(); };
$("nextDay").onclick = () => { currentDay.setDate(currentDay.getDate() + 1); renderDay(); };

function renderDay() {
  const key = dayKey(currentDay);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 864e5));
  $("dayTitle").textContent = key === today ? "Heute" : key === yesterday ? "Gestern"
    : currentDay.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });

  const list = entries.filter((e) => e.day === key).sort((a, b) => a.time - b.time);
  const sum = list.reduce((s, e) => ({ kcal: s.kcal + e.kcal, p: s.p + e.protein_g, k: s.k + e.carbs_g, f: s.f + e.fat_g }),
    { kcal: 0, p: 0, k: 0, f: 0 });

  const goal = Number(settings.goal) || 2000;
  $("kcalTotal").textContent = round(sum.kcal);
  $("kcalGoalText").textContent = `von ${goal} kcal`;
  const left = goal - sum.kcal;
  $("kcalLeft").textContent = left >= 0 ? `noch ${round(left)} kcal` : `${round(-left)} kcal drüber`;
  $("kcalBar").classList.toggle("over", left < 0);
  $("kcalBar").firstElementChild.style.width = Math.min(100, (sum.kcal / goal) * 100) + "%";
  $("mP").textContent = round(sum.p) + " g";
  $("mK").textContent = round(sum.k) + " g";
  $("mF").textContent = round(sum.f) + " g";

  $("noEntries").classList.toggle("hidden", list.length > 0);
  $("entries").innerHTML = list.map((e) => `
    <div class="entry">
      ${e.thumb ? `<img src="${e.thumb}" alt="">` : ""}
      <div class="grow">
        <div class="name">${escapeHtml(e.name)}</div>
        <div class="muted">${new Date(e.time).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          · E ${round(e.protein_g)} g · K ${round(e.carbs_g)} g · F ${round(e.fat_g)} g</div>
      </div>
      <div style="text-align:right">
        <b>${round(e.kcal)}</b><div class="muted">kcal</div>
        <button class="ghost small" data-del="${e.id}" aria-label="Löschen">✕</button>
      </div>
    </div>`).join("");
  $("entries").querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      if (!confirm("Eintrag löschen?")) return;
      entries = entries.filter((e) => e.id !== b.dataset.del);
      store(KEY_ENTRIES, entries);
      renderDay();
    };
  });
}

/* ---------------- Erfassen ---------------- */
let photoDataUrl = null;
let thumbDataUrl = null;

$("photo").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  photoDataUrl = thumbDataUrl = null;
  $("photoPreview").classList.add("hidden");
  if (!file) return;
  try {
    photoDataUrl = await resizeImage(file, 1280);
    thumbDataUrl = await resizeImage(file, 160, 0.7);
    $("photoPreview").src = photoDataUrl;
    $("photoPreview").classList.remove("hidden");
  } catch (e) { showError(e.message); }
});

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Kurzer deutscher Name der Mahlzeit" },
    kcal: { type: "number" },
    protein_g: { type: "number" },
    carbs_g: { type: "number" },
    fat_g: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string", description: "Geschätzte Menge, z. B. '150 g' oder '1 Stück'" },
          kcal: { type: "number" },
        },
        required: ["name", "amount", "kcal"],
        additionalProperties: false,
      },
    },
    note: { type: "string", description: "Kurzer Hinweis zur Unsicherheit der Schätzung, auf Deutsch" },
  },
  required: ["name", "kcal", "protein_g", "carbs_g", "fat_g", "items", "note"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "Du bist ein Ernährungsassistent in einer Kalorien-Tracker-App. " +
  "Schätze aus dem Foto und/oder der Beschreibung die Nährwerte der gesamten Mahlzeit. " +
  "Schätze Portionsgrößen realistisch anhand von Tellergröße, Besteck und üblichen Portionen. " +
  "Gib Zahlen für die komplette sichtbare bzw. beschriebene Menge an. " +
  "Ist auf dem Foto kein Essen zu sehen, setze alle Werte auf 0 und erkläre das im Feld note. " +
  "Antworte auf Deutsch.";

$("analyze").addEventListener("click", async () => {
  hideError();
  const desc = $("desc").value.trim();
  if (!photoDataUrl && !desc) { showError("Bitte ein Foto aufnehmen oder eine Beschreibung eingeben."); return; }
  if (!settings.apiKey) { showError("Bitte zuerst unter „Einstellungen“ deinen Claude API-Schlüssel eintragen."); return; }

  const btn = $("analyze");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analysiere …';

  try {
    const content = [];
    if (photoDataUrl) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: photoDataUrl.split(",")[1] },
      });
    }
    content.push({ type: "text", text: desc ? `Beschreibung: ${desc}` : "Schätze die Nährwerte dieser Mahlzeit." });

    const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Die KI hat diese Anfrage abgelehnt. Bitte mit einem anderen Foto oder Text versuchen.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Die Antwort war unvollständig. Bitte erneut versuchen.");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("Keine Antwort erhalten.");
    showResult(JSON.parse(textBlock.text));
  } catch (e) {
    showError(friendlyError(e));
  } finally {
    btn.disabled = false;
    btn.textContent = "KI analysieren lassen";
  }
});

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.";
  if (e instanceof Anthropic.RateLimitError) return "Zu viele Anfragen. Bitte kurz warten und erneut versuchen.";
  if (e instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur Claude-API. Bitte Internet prüfen.";
  if (e instanceof Anthropic.APIError) return `Fehler der Claude-API (${e.status ?? "?"}): ${e.message}`;
  return e.message || String(e);
}

function showResult(r) {
  $("rName").value = r.name;
  $("rKcal").value = round(r.kcal);
  $("rP").value = round(r.protein_g);
  $("rK").value = round(r.carbs_g);
  $("rF").value = round(r.fat_g);
  $("rItems").innerHTML = (r.items || [])
    .map((i) => `<li>${escapeHtml(i.name)} – ${escapeHtml(i.amount)} (${round(i.kcal)} kcal)</li>`).join("");
  $("rNote").textContent = r.note || "";
  $("resultCard").classList.remove("hidden");
  $("resultCard").scrollIntoView({ behavior: "smooth" });
}

$("save").addEventListener("click", () => {
  const now = new Date();
  // Auf einen früheren Tag eintragen, wenn im Tagebuch gerade ein anderer Tag offen ist
  const target = new Date(currentDay);
  target.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  entries.push({
    id: crypto.randomUUID(),
    day: dayKey(target),
    time: target.getTime(),
    name: $("rName").value.trim() || "Mahlzeit",
    kcal: Number($("rKcal").value) || 0,
    protein_g: Number($("rP").value) || 0,
    carbs_g: Number($("rK").value) || 0,
    fat_g: Number($("rF").value) || 0,
    thumb: thumbDataUrl,
  });
  if (!store(KEY_ENTRIES, entries)) { entries.pop(); return; }
  resetForm();
  showView("heute");
});

$("discard").addEventListener("click", resetForm);

function resetForm() {
  $("photo").value = "";
  $("desc").value = "";
  $("photoPreview").classList.add("hidden");
  $("resultCard").classList.add("hidden");
  photoDataUrl = thumbDataUrl = null;
  hideError();
}
function showError(t) { $("analyzeError").textContent = t; $("analyzeError").classList.remove("hidden"); }
function hideError() { $("analyzeError").classList.add("hidden"); }

/* ---------------- Einstellungen ---------------- */
$("goal").value = settings.goal;
$("apiKey").value = settings.apiKey;
$("saveSettings").addEventListener("click", () => {
  settings.goal = Number($("goal").value) || 2000;
  settings.apiKey = $("apiKey").value.trim();
  if (store(KEY_SETTINGS, settings)) {
    $("settingsSaved").textContent = " Gespeichert ✓";
    setTimeout(() => ($("settingsSaved").textContent = ""), 2000);
  }
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ entries, goal: settings.goal }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `food-tracker-${dayKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("import").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error("Ungültige Datei.");
    const known = new Set(entries.map((e) => e.id));
    const neu = data.entries.filter((e) => e && e.id && !known.has(e.id));
    entries = entries.concat(neu);
    store(KEY_ENTRIES, entries);
    alert(`${neu.length} Einträge importiert.`);
    renderDay();
  } catch (e) {
    alert("Import fehlgeschlagen: " + e.message);
  }
  ev.target.value = "";
});

/* ---------------- Start ---------------- */
renderDay();
if (!settings.apiKey) showView("einst");
