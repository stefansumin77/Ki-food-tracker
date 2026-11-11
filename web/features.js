import { catalog, resolveFood, calculatePortion, sumPortions, compareProducts } from './nutrition.js';
import { recommendRecipes } from './recipes.js';

const CORE = ['kcal', 'protein', 'carbs', 'fat'];
const ALL = [...CORE, 'fiber', 'sugar'];
const LEVELS = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig', needs_confirmation: 'Bestätigung nötig' };
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const gramsValid = value => finite(value) && value > 0 && value <= 10000;
const freshId = () => crypto.randomUUID();
const sourceFood = (id, foods = catalog) => foods.find(food => food.id === id) || null;
const rounded = value => Math.round(value * 10) / 10;
const methodLabel = value => ({ raw: 'roh', cooked: 'gekocht', roasted: 'geröstet', fried: 'gebraten', baked: 'gebacken', steamed: 'gedämpft', unknown: 'unbekannt', as_sold: 'wie verkauft' }[value] || value || '');
function matchingMethod(food, value) { if (food && (value === food.cookingMethod || value === methodLabel(food.cookingMethod))) return food.cookingMethod || ''; const matched = food && resolveFood(food.name, value); return food && matched?.id === food.id ? food.cookingMethod || value : value; }
const safeSourceURL = value => typeof value === 'string' && /^https:\/\//.test(value) ? value : null;

export function hasKnownNutritionBasis(food) {
  if (!food || !['g', 'ml'].includes(food.unit)) return false;
  const basis = food.unit === 'g' ? '100g' : '100ml';
  return (!food.per100Basis || food.per100Basis === basis) && (!food.nutritionBasis || food.nutritionBasis === basis);
}

export function hasCompleteNutrition(food) {
  return Boolean(food && food.unit === 'g' && hasKnownNutritionBasis(food) && typeof food.source?.name === 'string' && food.source.name.trim() && food.per100 && CORE.every(key => finite(food.per100[key]) && food.per100[key] >= 0 && food.per100[key] <= (key === 'kcal' ? 1500 : 100)));
}

/** AI nutrition values are deliberately ignored. Only an explicitly matched, sourced record is used. */
export function normalizeDetectionItems(result, corrections = [], foods = catalog) {
  if (!result || !Array.isArray(result.items) || result.items.length > 30) throw Error('Die Zutatenliste ist nicht gültig.');
  const detected = result.items.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) throw Error('Eine Zutat hat keinen Namen.');
    let food = sourceFood(item.foodId, foods);
    if (!food) food = resolveFood(item.name, item.cookingMethod || '') || null;
    // A resolver may expose a list of candidates; ambiguous matches always require a user selection.
    if (Array.isArray(food)) food = food.length === 1 ? food[0] : null;
    return {
      id: typeof item.id === 'string' && item.id ? item.id : freshId(),
      originalName: item.name.slice(0, 120), name: item.name.trim().slice(0, 120),
      foodId: food?.id || null, food: food ? clone(food) : null,
      grams: gramsValid(item.grams) ? item.grams : null,
      cookingMethod: food?.cookingMethod || String(item.cookingMethod || '').slice(0, 100),
      recognitionConfidence: Object.hasOwn(LEVELS, item.recognitionConfidence) ? item.recognitionConfidence : 'needs_confirmation',
      quantityConfidence: Object.hasOwn(LEVELS, item.quantityConfidence) ? item.quantityConfidence : 'needs_confirmation',
      quantityEstimated: true, confirmed: false,
    };
  });
  return applySavedCorrections(detected, corrections, foods);
}

export function applySavedCorrections(components, corrections = [], foods = catalog) {
  return components.map(component => {
    const match = corrections.filter(row => row.consent === true && row.originalName?.trim().toLocaleLowerCase('de-DE') === component.originalName.trim().toLocaleLowerCase('de-DE') && (!row.cookingMethod || row.cookingMethod === component.cookingMethod)).at(-1);
    const food = match && sourceFood(match.foodId, foods);
    return food ? { ...component, foodId: food.id, food: clone(food), cookingMethod: food.cookingMethod || '', correctionSuggested: true, confirmed: false } : component;
  });
}

export function calculateConfirmedMeal(components, { requireConfirmation = true } = {}) {
  if (!Array.isArray(components) || !components.length || components.length > 30) throw Error('Bitte prüfe mindestens eine Zutat.');
  const portions = components.map(component => {
    if (requireConfirmation && component.confirmed !== true) throw Error('Bitte bestätige jede Zutat.');
    if (!gramsValid(component.grams)) throw Error('Bitte bestätige die Menge jeder Zutat in Gramm.');
    if (!hasCompleteNutrition(component.food)) throw Error('Bitte ordne jeder Zutat vollständige Nährwertdaten zu.');
    if (component.food.cookingMethod && component.cookingMethod !== component.food.cookingMethod) throw Error('Die Zubereitung muss zum ausgewählten Nährwertdatensatz passen.');
    return calculatePortion(component.food, component.grams);
  });
  const totals = sumPortions(portions);
  const grams = rounded(components.reduce((sum, item) => sum + item.grams, 0));
  if (grams < 1 || grams > 10000) throw Error('Die gesamte Portion muss zwischen 1 und 10.000 g liegen.');
  if (!CORE.every(key => finite(totals[key]) && totals[key] >= 0)) throw Error('Die Nährwertdaten sind unvollständig.');
  if (totals.protein + totals.carbs + totals.fat > grams * 1.1) throw Error('Die Makronährstoffe passen nicht zum Portionsgewicht.');
  if (finite(totals.sugar) && totals.sugar > totals.carbs + 0.1) throw Error('Die Zuckerangabe übersteigt die Kohlenhydrate.');
  return { grams, ...Object.fromEntries(ALL.map(key => [key, finite(totals[key]) ? rounded(totals[key]) : null])) };
}

export function createConfirmedDiaryEntry({ name, components, date, time, category = 'Snack', ai = false, id = freshId() }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw Error('Bitte prüfe den Namen der Mahlzeit.');
  const nutrition = calculateConfirmedMeal(components);
  return { id, date, time, category, name: name.trim(), ...nutrition, ai: ai === true,
    components: components.map(item => ({ id: item.id || freshId(), name: item.name, foodId: item.food?.id || item.foodId || null, grams: item.grams, cookingMethod: item.cookingMethod || '', per100: clone(item.food.per100), source: clone(item.food.source), recognitionConfidence: item.recognitionConfidence || 'needs_confirmation', quantityConfidence: item.quantityConfidence || 'needs_confirmation', quantityEstimated: item.quantityEstimated === true, confirmed: true })) };
}

export function inventoryFromComponents(components, sourceKind = 'fridge') {
  return components.map(component => {
    if (component.confirmed !== true || typeof component.name !== 'string' || !component.name.trim()) throw Error('Bitte bestätige jede Zutat.');
    if (component.grams !== null && !gramsValid(component.grams)) throw Error('Bitte prüfe die Mengenangabe.');
    return { id: freshId(), foodId: component.food?.id || null, name: component.name.trim().slice(0, 120), grams: component.grams, food: component.food ? clone(component.food) : null, cookingMethod: component.cookingMethod || '', confirmed: true, quantityEstimated: component.quantityEstimated === true, sourcekind: sourceKind };
  });
}

export function validateManualProduct(values) {
  if (!values || typeof values.name !== 'string' || !values.name.trim() || values.name.length > 120) throw Error('Bitte gib einen Produktnamen ein.');
  const per100 = {};
  for (const key of ALL) {
    const value = values[key];
    if ((value === '' || value === null || value === undefined) && !CORE.includes(key)) { per100[key] = null; continue; }
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!finite(number) || number < 0 || number > (key === 'kcal' ? 1000 : 100)) throw Error('Bitte gib gültige Nährwerte pro 100 g ein.');
    per100[key] = number;
  }
  if (per100.protein + per100.carbs + per100.fat > 110 || finite(per100.sugar) && per100.sugar > per100.carbs + 0.1) throw Error('Die Nährwerte sind nicht plausibel.');
  return { id: 'manual:' + freshId(), barcode: typeof values.barcode === 'string' ? values.barcode : null, name: values.name.trim(), brand: '', unit: 'g', per100, servingGrams: null, servingLabel: null, categoryTags: [], source: { name: 'Manuell eingegeben · nicht extern geprüft', url: null, license: 'user-entered' } };
}

export function consumeRecipeInventory(inventory, ingredients) {
  const updated = inventory.map(clone);
  for (const ingredient of ingredients) {
    let remaining = Number(ingredient.grams) || 0;
    for (const item of updated) {
      if ((item.foodId || item.food?.id) !== ingredient.foodId || !gramsValid(item.grams) || item.confirmed !== true) continue;
      const used = Math.min(item.grams, remaining); item.grams = rounded(item.grams - used); remaining -= used;
      if (remaining <= 0) break;
    }
  }
  return updated.filter(item => item.grams !== 0);
}

export function initNutritionFeatures(ctx) {
  const $ = selector => document.querySelector(selector);
  const esc = ctx.esc;
  const fmt = (value, digits = 0) => finite(value) ? ctx.fmt(value, digits) : 'keine Angabe';
  const icon = ctx.icon;
  const availableFoods = () => [...new Map([...(ctx.getStore().inventory || []).filter(item => item.confirmed === true).map(item => item.food).filter(hasCompleteNutrition), ...catalog].map(food => [food.id, food])).values()];
  const lookupFood = id => sourceFood(id, availableFoods());
  let generation = 0, pending = null, stream = null, animationFrame = null, meal = null, busy = false;
  const alive = token => token === generation && (!ctx.isCurrent || ctx.isCurrent());
  const stopMedia = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; if (animationFrame !== null) cancelAnimationFrame(animationFrame); animationFrame = null; };
  const cancelWork = () => { generation++; pending?.abort(); pending = null; stopMedia(); busy = false; };
  const cleanup = () => ctx.onCleanup?.(cancelWork);
  function modal(title, html, eyebrow = 'DEINE ERNÄHRUNG') {
    ctx.showModal(title, html, eyebrow); const token = ++generation; cleanup(); return token;
  }
  function error(target, message) { const host = $(target); if (host) host.innerHTML = message ? `<div class="inline-error" role="alert">${esc(message)}</div>` : ''; }
  async function request(url, options = {}, token = generation) {
    const controller = new AbortController(); pending?.abort(); pending = controller;
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'same-origin', headers: { ...options.headers } });
      let data; try { data = await response.json(); } catch { throw Error('Die Antwort konnte nicht gelesen werden. Bitte versuche es erneut.'); }
      if (!alive(token)) return null;
      if (!response.ok) { const issue = Error(typeof data.error === 'string' ? data.error : 'Die Anfrage konnte nicht abgeschlossen werden.'); issue.status = response.status; throw issue; }
      return data;
    } finally { if (pending === controller) pending = null; }
  }
  function foodOptions(selected = null, currentFood = null) {
    const foods = availableFoods(); if (hasCompleteNutrition(currentFood) && !foods.some(food => food.id === currentFood.id)) foods.push(currentFood);
    return `<option value="">Nährwertdatensatz auswählen</option>` + foods.map(food => `<option value="${esc(food.id)}" ${food.id === selected ? 'selected' : ''}>${esc(food.name)}${food.cookingMethod ? ' · ' + esc(methodLabel(food.cookingMethod)) : ''}</option>`).join('');
  }
  function sourcesHTML(foods) {
    const rows = [...new Map(foods.filter(Boolean).map(food => [food.source?.url || food.source?.name, food.source])).values()].filter(Boolean);
    return rows.map(source => `<p class="muted">Quelle: ${safeSourceURL(source.url) ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.name)}</a>` : esc(source.name || 'Nicht angegeben')}${source.license ? ' · ' + esc(source.license) : ''}</p>`).join('');
  }
  function remainingTargets() {
    const state = ctx.getState(), eaten = state.demo ? { kcal: 0, protein: 0, carbs: 0, fat: 0 } : ctx.totals(ctx.entriesFor(ctx.getDay()));
    return Object.fromEntries(CORE.map(key => [key, Math.max(0, Number(state.goals[key]) - Number(eaten[key] || 0))]));
  }
  function recordBase(name, nutrition, components, ai = false) {
    return createConfirmedDiaryEntry({ name: String(name).slice(0, 120), components, date: ctx.getDay(), category: 'Snack', time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), ai });
  }
  function logRecord(record) {
    const state = ctx.getState(), wasDemo = state.demo; ctx.leaveDemo(); state.entries.push(record);
    if (!ctx.saveState()) { state.entries = state.entries.filter(item => item.id !== record.id); state.demo = wasDemo; return false; }
    ctx.render(); ctx.closeModal(); ctx.setView('dashboard'); ctx.toast('Deine Mahlzeit wurde eingetragen.'); return true;
  }
  async function thumbnail(dataURL) {
    if (!dataURL || typeof ctx.resizeImage !== 'function') return '';
    try {
      const [header, encoded] = dataURL.split(','); const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: header.match(/^data:([^;]+)/)[1] }));
      try { return ctx.resizeImage(bitmap, 160, .65); } finally { bitmap.close(); }
    } catch { return ''; }
  }
  function confidenceHTML(item) {
    return `<p class="muted">Erkennung: ${esc(LEVELS[item.recognitionConfidence] || LEVELS.needs_confirmation)} · Menge: ${esc(LEVELS[item.quantityConfidence] || LEVELS.needs_confirmation)}${item.quantityEstimated ? ' · geschätzt' : ''}${item.correctionSuggested ? ' · gespeicherte Zuordnung vorgeschlagen, bitte erneut prüfen' : ''}</p>`;
  }
  function previewNutrition(components) { try { return calculateConfirmedMeal(components, { requireConfirmation: false }); } catch { return null; } }
  function nutritionHTML(nutrition) {
    return `<div class="analysis-calories"><strong>${nutrition ? fmt(nutrition.kcal) : '—'}</strong><span>kcal</span></div><div class="analysis-macros">${[['protein', 'Protein'], ['carbs', 'Kohlenhydrate'], ['fat', 'Fett']].map(([key, label]) => `<div><strong>${nutrition ? fmt(nutrition[key], 1) : '—'}<span> g</span></strong><small>${label}</small></div>`).join('')}</div>`;
  }
  function showMealAnalysis(result, image) {
    meal = { result: clone(result), image, components: normalizeDetectionItems(result, ctx.getStore().corrections, availableFoods()), answers: {}, consent: false, saved: false };
    const questions = result.questions?.length ? result.questions.slice(0, 8) : [
      { id: 'oil', kind: 'oil', text: 'Wurde Öl verwendet?' }, { id: 'sauce', kind: 'sauce', text: 'Gibt es Sauce oder Dressing?' }, { id: 'butter', kind: 'butter', text: 'Wurde Butter hinzugefügt?' },
    ];
    meal.questions = questions.map((question, i) => ({ id: String(question.id || i), text: String(question.text || 'Gibt es weitere Zutaten?').slice(0, 250), kind: question.kind || 'other' }));
    renderMealAnalysis();
  }
  function mealIssues() {
    if (!meal) return 'Keine Mahlzeit vorhanden.';
    try { calculateConfirmedMeal(meal.components); } catch (issue) { return issue.message; }
    if (meal.questions.some(question => !['no', 'included'].includes(meal.answers[question.id]))) return 'Bitte beantworte die Fragen zu Öl, Sauce und weiteren Zutaten.';
    return '';
  }
  function renderMealAnalysis() {
    if (!meal) return;
    ctx.setView('analysis'); cleanup(); const nutrition = previewNutrition(meal.components), issue = mealIssues();
    $('#analysis-content').innerHTML = `<div class="analysis-top"><button class="icon-button" id="nutrition-back" aria-label="Zurück zum Foto">${icon('chevron-left')}</button><span>DEINE MAHLZEIT</span></div><h1 class="analysis-title">Alles im Blick.</h1><div class="analysis-food">${meal.image ? `<img src="${esc(meal.image)}" alt="Deine fotografierte Mahlzeit">` : ''}<h2>${esc(meal.result.name)}</h2>${nutritionHTML(nutrition)}</div><p class="analysis-note">${nutrition ? 'Nährwerte aus zugeordneten Lebensmitteldaten; Portionen bleiben Schätzungen.' : 'Für vollständige Nährwerte bitte Lebensmittel und Mengen zuordnen.'}</p><details class="analysis-ingredients" open><summary>Zutaten & Unsicherheit</summary>${meal.components.map(item => `<div class="analysis-item"><span>${esc(item.name)}<small> · ${item.grams === null ? 'Menge unbekannt' : fmt(item.grams, 1) + (item.quantityEstimated ? ' g geschätzt' : ' g angepasst')}</small>${confidenceHTML(item)}</span><span>${item.confirmed ? 'Geprüft' : 'Offen'}</span></div>`).join('')}<p>${esc(meal.result.note || '')}</p></details><div class="analysis-actions"><button class="button secondary" id="nutrition-edit">${icon('edit')}Zutaten & Portionen prüfen</button><button class="button secondary" id="nutrition-questions">Öl, Saucen & Extras prüfen</button><button class="button primary" id="nutrition-save" ${issue || meal.saved ? 'disabled' : ''}>Übernehmen ${icon('check')}</button></div><p class="analysis-note" id="nutrition-issue">${esc(issue || 'Alle Bestandteile bestätigt. Bereit zum Speichern.')}</p><button class="text-button analysis-again" id="nutrition-again">Anderes Foto</button>`;
    $('#nutrition-back').onclick = () => ctx.setView('scan');
    $('#nutrition-again').onclick = () => ctx.setView('scan');
    $('#nutrition-edit').onclick = () => editComponents('meal');
    $('#nutrition-questions').onclick = openQuestions;
    $('#nutrition-save').onclick = saveConfirmedMeal;
  }
  async function saveConfirmedMeal() {
    if (!meal || meal.saved || busy) return; const issue = mealIssues(); if (issue) { ctx.toast(issue); return; }
    busy = true; const current = meal, token = generation; $('#nutrition-save').disabled = true;
    try {
      const record = recordBase(current.result.name, calculateConfirmedMeal(current.components), current.components, true);
      const image = await thumbnail(current.image); if (meal !== current || !alive(token) || ctx.getView?.() !== 'analysis') return;
      if (image) record.image = image;
      if (logRecord(record)) {
        current.saved = true;
        if (current.consent) {
          const store = ctx.getStore();
          const rows = current.components.map(item => ({ id: freshId(), consent: true, at: new Date().toISOString(), originalName: item.originalName || item.name, foodId: item.foodId, cookingMethod: item.cookingMethod, grams: item.grams }));
          store.corrections.push(...rows); store.corrections = store.corrections.slice(-300); ctx.saveStore();
        }
      }
    } catch (issue) { ctx.toast(issue.message); } finally { busy = false; if ($('#nutrition-save')) $('#nutrition-save').disabled = Boolean(mealIssues()) || Boolean(meal?.saved); }
  }
  function openQuestions() {
    if (!meal) return;
    modal('Öl, Saucen & Extras', `<p>Ein Foto zeigt versteckte Zutaten nicht zuverlässig. „Bereits enthalten“ bedeutet, dass sie in deiner bestätigten Zutatenliste mit Menge aufgeführt sind.</p><form id="nutrition-questions-form"><div class="form-grid">${meal.questions.map(question => `<label class="field full">${esc(question.text)}<select name="q-${esc(question.id)}" required><option value="">Bitte auswählen</option><option value="no" ${meal.answers[question.id] === 'no' ? 'selected' : ''}>Nicht verwendet</option><option value="included" ${meal.answers[question.id] === 'included' ? 'selected' : ''}>In der Zutatenliste vollständig enthalten</option><option value="unknown">Weiß ich nicht / noch ergänzen</option></select></label>`).join('')}</div><p class="form-note">Bei unbekannten Mengen bitte nachfragen, wiegen oder die Zutaten ergänzen. Es werden keine versteckten Kalorien als Null angenommen.</p><div class="form-actions"><button class="button secondary" type="button" id="questions-add">Zutaten ergänzen</button><button class="button primary" type="submit">Antworten bestätigen</button></div></form>`);
    $('#questions-add').onclick = () => { collectAnswers(); ctx.closeModal(); editComponents('meal'); };
    function collectAnswers() { const data = new FormData($('#nutrition-questions-form')); for (const question of meal.questions) meal.answers[question.id] = String(data.get('q-' + question.id) || ''); }
    $('#nutrition-questions-form').onsubmit = event => { event.preventDefault(); collectAnswers(); ctx.closeModal(); renderMealAnalysis(); };
  }
  function editComponents(mode, draft = null, after = null) {
    const target = mode === 'meal' ? meal.components : draft;
    let components = target.map(clone);
    function redraw() {
      modal(mode === 'meal' ? 'Zutaten einzeln prüfen' : 'Vorräte bestätigen', `<p>${mode === 'meal' ? 'Jede Zutat braucht einen passenden Nährwertdatensatz und eine bestätigte Menge. Die Auswahl unterscheidet rohe und zubereitete Lebensmittel.' : 'Bestätige sichtbare Lebensmittel. Unbekannte Mengen oder Nährwerte bleiben ausdrücklich offen und werden für Rezepte nicht als verfügbar vorausgesetzt.'}</p><form id="nutrition-components-form"><div id="nutrition-component-rows">${components.map((item, i) => `<details class="analysis-ingredients" open><summary>${esc(item.name || 'Neue Zutat')} · ${i + 1}</summary>${confidenceHTML(item)}<div class="form-grid"><label class="field full">Bezeichnung<input data-component="name" data-index="${i}" maxlength="120" required value="${esc(item.name)}"></label><label class="field full">Lebensmittel & Zubereitung (Nährwertquelle)<select data-component="food" data-index="${i}">${foodOptions(item.foodId, item.food)}</select></label><label class="field">Zubereitung<input data-component="method" data-index="${i}" maxlength="100" value="${esc(methodLabel(item.cookingMethod))}" placeholder="z. B. gekocht"></label><label class="field">Menge in g ${item.quantityEstimated ? '(geschätzt)' : '(angepasst)'}<input data-component="grams" data-index="${i}" type="number" min="0.1" max="10000" step="0.1" ${mode === 'meal' ? 'required' : ''} value="${item.grams ?? ''}" placeholder="unbekannt"></label></div>${sourcesHTML([item.food])}<label class="settings-row"><input type="checkbox" data-component="confirmed" data-index="${i}" ${item.confirmed ? 'checked' : ''}><span>Diese Zutat und Menge habe ich geprüft.</span></label><button type="button" class="text-button" data-remove-component="${i}">${icon('trash')}Zutat entfernen</button></details>`).join('')}</div><div id="nutrition-component-total" class="form-note"></div><button class="text-button" type="button" id="nutrition-add-component">${icon('plus')}Zutat hinzufügen</button>${mode === 'meal' ? `<label class="settings-row"><input id="nutrition-save-correction" type="checkbox" ${meal.consent ? 'checked' : ''}><span>Diese Korrekturen lokal für spätere Vorschläge merken.<small>Freiwillig. Keine Fotos, keine Weitergabe. In den Einstellungen löschbar.</small></span></label>` : ''}<div id="nutrition-editor-error"></div><div class="form-actions"><button class="button secondary" type="button" id="nutrition-cancel-editor">Abbrechen</button><button class="button primary" type="submit">${mode === 'meal' ? 'Bestätigte Zutaten übernehmen' : 'Im Vorrat speichern'}</button></div></form>`);
      const form = $('#nutrition-components-form');
      form.querySelectorAll('[data-component]').forEach(input => input.addEventListener('change', () => {
        const item = components[Number(input.dataset.index)], kind = input.dataset.component;
        if (kind === 'confirmed') { item.confirmed = input.checked; updateTotal(); return; }
        item.confirmed = false;
        if (kind === 'name') item.name = input.value.trim().slice(0, 120);
        if (kind === 'grams') { item.grams = input.value.trim() ? Number(input.value) : null; item.quantityEstimated = false; }
        if (kind === 'food') { item.food = lookupFood(input.value) || (item.food?.id === input.value ? item.food : null); item.foodId = item.food?.id || null; if (item.food) { item.name = item.food.name; item.cookingMethod = item.food.cookingMethod || ''; } redraw(); return; }
        if (kind === 'method') { item.cookingMethod = matchingMethod(item.food, input.value.trim().slice(0, 100)); if (item.food?.cookingMethod && item.cookingMethod !== item.food.cookingMethod) { item.food = null; item.foodId = null; } }
        form.querySelector(`[data-component="confirmed"][data-index="${input.dataset.index}"]`).checked = false;
        updateTotal();
      }));
      form.querySelectorAll('[data-remove-component]').forEach(button => button.onclick = () => { components.splice(Number(button.dataset.removeComponent), 1); redraw(); });
      $('#nutrition-add-component').onclick = () => { components.push({ id: freshId(), name: '', originalName: '', foodId: null, food: null, grams: null, cookingMethod: '', recognitionConfidence: 'needs_confirmation', quantityConfidence: 'needs_confirmation', quantityEstimated: false, confirmed: false }); redraw(); };
      $('#nutrition-cancel-editor').onclick = () => { ctx.closeModal(); if (mode === 'meal') renderMealAnalysis(); else after?.(false); };
      function updateTotal() { const nutrition = previewNutrition(components); $('#nutrition-component-total').textContent = nutrition ? `${fmt(nutrition.kcal)} kcal · ${fmt(nutrition.protein, 1)} g Protein · ${fmt(nutrition.carbs, 1)} g Kohlenhydrate · ${fmt(nutrition.fat, 1)} g Fett` : 'Nährwerte noch unvollständig. Bitte Lebensmittel und Mengen prüfen.'; }
      updateTotal();
      form.onsubmit = event => {
        event.preventDefault(); error('#nutrition-editor-error', '');
        try {
          if (!components.length) throw Error('Bitte bestätige mindestens eine Zutat.');
          if (mode === 'meal') { calculateConfirmedMeal(components); meal.components = components; meal.answers = {}; meal.consent = $('#nutrition-save-correction').checked; ctx.closeModal(); renderMealAnalysis(); }
          else {
            const rows = inventoryFromComponents(components); const store = ctx.getStore(), before = store.inventory.slice(); store.inventory.push(...rows);
            if (!ctx.saveStore()) { store.inventory = before; throw Error('Der Vorrat konnte nicht gespeichert werden.'); }
            ctx.closeModal(); ctx.toast('Die bestätigten Zutaten sind in deinem Vorrat.'); after?.(true);
          }
        } catch (issue) { error('#nutrition-editor-error', issue.message); }
      };
    }
    redraw();
  }
  function openFridge() {
    let image = '', fridgeBusy = false, fileSequence = 0;
    const token = modal('Dein Kühlschrank', `<p>Fotografiere gut sichtbare Lebensmittel. Verdeckte Zutaten und Mengen lassen sich nicht zuverlässig erkennen. Du bestätigst alles vor dem Speichern.</p><div id="fridge-preview" class="scan-capture"><div class="empty-state"><span>${icon('camera')}</span><h3>Was ist noch da?</h3><p>Foto aufnehmen oder aus deiner Galerie auswählen.</p></div></div><input id="fridge-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><div class="form-actions"><button class="button secondary" id="fridge-camera">${icon('camera')}Kamera</button><button class="button secondary" id="fridge-gallery">${icon('image')}Foto auswählen</button></div><label class="field">Zusätzliche Hinweise<textarea id="fridge-notes" maxlength="500" placeholder="z. B. geschlossene Packungen, ungefähre Inhalte"></textarea></label><div id="fridge-error"></div><div class="form-actions"><button class="button secondary" id="fridge-manual">Manuell hinzufügen</button><button class="button primary" id="fridge-analyze" disabled>Zutaten erkennen</button></div>`, 'VORRAT & REZEPTE');
    const showImage = () => { $('#fridge-preview').innerHTML = `<div class="scan-preview"><img src="${esc(image)}" alt="Dein Kühlschrankfoto"></div>`; $('#fridge-analyze').disabled = false; $('#fridge-camera').innerHTML = icon('camera') + 'Kamera'; };
    $('#fridge-file').onchange = async event => {
      const file = event.target.files?.[0]; if (!file || fridgeBusy) return; const sequence = ++fileSequence; error('#fridge-error', '');
      try {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw Error('Bitte wähle ein JPG-, PNG- oder WebP-Foto unter 15 MB.');
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        try { if (!alive(token) || sequence !== fileSequence) return; image = ctx.resizeImage(bitmap, 1280, .82); } finally { bitmap.close(); }
        stopMedia(); showImage();
      } catch (issue) { if (alive(token) && sequence === fileSequence) error('#fridge-error', issue.message || 'Das Foto konnte nicht geöffnet werden.'); }
    };
    $('#fridge-gallery').onclick = () => $('#fridge-file').click();
    $('#fridge-manual').onclick = () => editComponents('fridge', [{ id: freshId(), name: '', foodId: null, food: null, grams: null, cookingMethod: '', recognitionConfidence: 'needs_confirmation', quantityConfidence: 'needs_confirmation', quantityEstimated: false, confirmed: false }], () => openInventory());
    $('#fridge-camera').onclick = async () => {
      if (fridgeBusy) return;
      if (stream) {
        const video = $('#fridge-video'); if (!video?.videoWidth) return;
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
        fileSequence++; image = ctx.resizeImage(canvas, 1280, .82); stopMedia(); showImage(); return;
      }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error('Kamera nicht verfügbar. Bitte wähle ein Foto aus deiner Galerie.');
        const cameraSequence = ++fileSequence;
        const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (!alive(token) || cameraSequence !== fileSequence) { opened.getTracks().forEach(track => track.stop()); return; }
        stream = opened; $('#fridge-preview').innerHTML = '<div class="scan-preview"><video id="fridge-video" autoplay muted playsinline aria-label="Kamera für Kühlschrankfoto"></video></div>'; $('#fridge-video').srcObject = stream;
        $('#fridge-camera').innerHTML = icon('camera') + 'Foto aufnehmen';
      } catch (issue) { if (alive(token)) error('#fridge-error', issue.message || 'Kamera nicht verfügbar.'); }
    };
    $('#fridge-analyze').onclick = async () => {
      if (!image || fridgeBusy) return; fridgeBusy = true; stopMedia(); $('#fridge-analyze').disabled = true; $('#fridge-gallery').disabled = true; $('#fridge-camera').disabled = true; error('#fridge-error', '');
      try {
        const result = await request('/api/fridge/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, notes: $('#fridge-notes').value }) }, token);
        if (!result || !alive(token)) return;
        const components = normalizeDetectionItems(result, ctx.getStore().corrections, availableFoods());
        if (!components.length) throw Error('Keine sichtbaren Lebensmittel erkannt. Bitte wähle ein deutlicheres Foto oder ergänze sie manuell.');
        editComponents('fridge', components, () => openInventory());
      } catch (issue) { if (alive(token) && issue.name !== 'AbortError') error('#fridge-error', issue.message); }
      finally { fridgeBusy = false; if (alive(token)) { $('#fridge-analyze').disabled = !image; $('#fridge-gallery').disabled = false; $('#fridge-camera').disabled = false; } }
    };
  }
  function openInventory() {
    const inventory = ctx.getStore().inventory || [];
    modal('Dein Vorrat', `<p>Nur bestätigte Lebensmittel werden verwendet. Geschätzte oder unbekannte Mengen bleiben sichtbar; prüfe sie vor der Rezeptplanung.</p><div>${inventory.length ? inventory.map(item => `<div class="analysis-item"><span>${esc(item.name)}<small> · ${item.grams === null ? 'Menge unbekannt' : fmt(item.grams, 1) + ' g'}${item.quantityEstimated ? ' (geschätzt)' : ''}</small><p class="muted">${item.food ? esc(item.food.source?.name || 'Nährwertquelle fehlt') : 'Noch kein Nährwertdatensatz zugeordnet'}</p></span><button class="icon-button" data-edit-stock="${esc(item.id)}" aria-label="${esc(item.name)} bearbeiten">${icon('edit')}</button><button class="icon-button" data-remove-stock="${esc(item.id)}" aria-label="${esc(item.name)} entfernen">${icon('trash')}</button></div>`).join('') : '<div class="empty-state"><h3>Dein Vorrat ist noch leer.</h3><p>Scanne deinen Kühlschrank oder ergänze Zutaten manuell.</p></div>'}</div><div class="form-actions"><button class="button secondary" id="inventory-add">${icon('plus')}Zutat hinzufügen</button><button class="button secondary" id="inventory-scan">${icon('camera')}Kühlschrank</button><button class="button primary" id="inventory-recipes" ${inventory.length ? '' : 'disabled'}>Mahlzeiten vorschlagen</button></div>${ctx.getStore().corrections.length ? '<button class="text-button analysis-again" id="inventory-corrections">Gespeicherte Korrekturen löschen</button>' : ''}`);
    if ($('#inventory-corrections')) $('#inventory-corrections').onclick = openCorrections;
    $('#inventory-add').onclick = () => editStock(); $('#inventory-scan').onclick = openFridge; $('#inventory-recipes').onclick = openRecipes;
    document.querySelectorAll('[data-edit-stock]').forEach(button => button.onclick = () => editStock(inventory.find(item => item.id === button.dataset.editStock)));
    document.querySelectorAll('[data-remove-stock]').forEach(button => button.onclick = () => {
      const store = ctx.getStore(), before = store.inventory.slice(); store.inventory = store.inventory.filter(item => item.id !== button.dataset.removeStock);
      if (!ctx.saveStore()) { store.inventory = before; ctx.toast('Der Vorrat konnte nicht geändert werden.'); return; } openInventory();
    });
  }
  function openCorrections() {
    modal('Gespeicherte Korrekturen löschen?', '<p>Du kannst deine Einwilligung widerrufen. Alle lokal gemerkten Lebensmittelzuordnungen werden gelöscht; deine Mahlzeiten und Vorräte bleiben erhalten.</p><div class="form-actions"><button class="button secondary" id="corrections-cancel">Abbrechen</button><button class="button primary" id="corrections-delete">Korrekturen löschen</button></div>');
    $('#corrections-cancel').onclick = openInventory;
    $('#corrections-delete').onclick = () => { const store = ctx.getStore(), before = store.corrections; store.corrections = []; if (!ctx.saveStore()) { store.corrections = before; ctx.toast('Die Korrekturen konnten nicht gelöscht werden.'); return; } ctx.toast('Gespeicherte Korrekturen wurden gelöscht.'); openInventory(); };
  }
  function editStock(existing = null) {
    const item = existing ? clone(existing) : { id: freshId(), name: '', grams: null, foodId: null, food: null, cookingMethod: '', confirmed: false };
    modal(existing ? 'Vorrat bearbeiten' : 'Zutat hinzufügen', `<form id="stock-form"><div class="form-grid"><label class="field full">Lebensmittel<input name="name" required maxlength="120" value="${esc(item.name)}"></label><label class="field full">Nährwertdatensatz (optional)<select name="food">${item.food && !lookupFood(item.foodId) ? `<option value="${esc(item.foodId)}" selected>Vorhandener Datensatz: ${esc(item.food.name)}</option>` : ''}${foodOptions(item.foodId, item.food)}</select></label><label class="field">Menge in Gramm<input name="grams" type="number" min="0.1" max="10000" step="0.1" value="${item.grams ?? ''}" placeholder="unbekannt"></label><label class="field">Zubereitung<input name="method" maxlength="100" value="${esc(methodLabel(item.cookingMethod))}"></label></div><label class="settings-row"><input type="checkbox" name="confirmed" required><span>Lebensmittel und Menge geprüft.<small>Leere Menge bedeutet unbekannt; sie wird nicht als Null gespeichert.</small></span></label><div id="stock-error"></div><div class="form-actions"><button class="button secondary" type="button" id="stock-cancel">Abbrechen</button><button class="button primary">Speichern</button></div></form>`);
    const form = $('#stock-form'); form.elements.food.onchange = () => { const food = lookupFood(form.elements.food.value) || (item.food?.id === form.elements.food.value ? item.food : null); if (food) { form.elements.name.value = food.name; form.elements.method.value = methodLabel(food.cookingMethod); } };
    $('#stock-cancel').onclick = openInventory;
    form.onsubmit = event => {
      event.preventDefault(); error('#stock-error', ''); if (!form.reportValidity()) return;
      try {
        const data = new FormData(form), grams = String(data.get('grams') || '').trim() ? Number(data.get('grams')) : null;
        if (grams !== null && !gramsValid(grams)) throw Error('Bitte prüfe die Menge.');
        const food = lookupFood(data.get('food')) || (item.food?.id === data.get('food') ? item.food : null); const method = matchingMethod(food, String(data.get('method') || '').trim());
        if (food && food.unit !== 'g' && grams !== null) throw Error('Für dieses Produkt ist keine passende Nährwertbasis pro 100 g vorhanden. Lass die Grammmenge offen oder ordne einen passenden Datensatz zu.');
        if (food && food.cookingMethod && food.cookingMethod !== method) throw Error('Bitte wähle einen Nährwertdatensatz für diese Zubereitung.');
        const record = { ...item, name: String(data.get('name')).trim(), grams, foodId: food?.id || null, food: food ? clone(food) : null, cookingMethod: method, confirmed: true, quantityEstimated: false };
        const store = ctx.getStore(), before = store.inventory.slice();
        if (existing) store.inventory = store.inventory.map(row => row.id === existing.id ? record : row); else store.inventory.push(record);
        if (!ctx.saveStore()) { store.inventory = before; throw Error('Der Vorrat konnte nicht gespeichert werden.'); } openInventory();
      } catch (issue) { error('#stock-error', issue.message); }
    };
  }
  function openRecipes() {
    const remaining = remainingTargets(); let recipes = [];
    try { recipes = recommendRecipes(ctx.getStore().inventory, remaining, { goal: ctx.getStore().profile?.fitnessGoal }); }
    catch (issue) { ctx.toast(issue.message || 'Rezepte sind gerade nicht verfügbar.'); return; }
    modal('Was passt heute?', `<p>Noch offen: ${fmt(remaining.kcal)} kcal und ${fmt(remaining.protein, 1)} g Protein. Vorschläge werden nach Kalorien- und Proteinpassung sortiert; sie sind keine individuelle Ernährungsempfehlung.</p>${recipes.length ? recipes.slice(0, 6).map((recipe, i) => `<button class="settings-row" data-recipe="${i}"><span>${icon('plate')}</span><span>${esc(recipe.name)}<small>${fmt(recipe.macros?.kcal)} kcal · ${fmt(recipe.macros?.protein, 1)} g Protein</small><small>${recipe.missingIngredients?.length ? esc(recipe.missingIngredients.length) + ' Zutaten/Mengen noch ergänzen' : 'Zutaten im Vorrat'}</small></span><span>${icon('chevron-right')}</span></button>`).join('') : '<div class="empty-state"><h3>Noch keine passende Kombination.</h3><p>Ordne deinen Vorräten Nährwertdatensätze zu und bestätige die Mengen.</p></div>'}<p class="form-note">Nährwerte werden aus den verknüpften Lebensmitteldaten berechnet. Wasser, Gewürze, Öl und Saucen nur in den angegebenen Mengen ergänzen.</p><div class="form-actions"><button class="button secondary" id="recipes-back">Zurück zum Vorrat</button></div>`);
    $('#recipes-back').onclick = openInventory; document.querySelectorAll('[data-recipe]').forEach(button => button.onclick = () => showRecipe(recipes[Number(button.dataset.recipe)]));
  }
  function showRecipe(recipe) {
    const ingredients = (recipe.ingredients || []).map(item => ({ ...item, food: lookupFood(item.foodId) }));
    const components = ingredients.map(item => ({ id: freshId(), name: item.name || item.food?.name || 'Zutat', foodId: item.foodId, food: item.food, grams: item.grams, cookingMethod: item.food?.cookingMethod || '', confirmed: true, quantityEstimated: false }));
    let nutrition; try { nutrition = calculateConfirmedMeal(components); } catch (issue) { ctx.toast(issue.message); return; }
    const missing = ingredients.filter(item => finite(item.missingGrams) ? item.missingGrams > 0 : item.available !== true);
    modal(recipe.name, `<div class="scan-result">${nutritionHTML(nutrition)}</div><div>${ingredients.map(item => `<div class="analysis-item"><span>${esc(item.name || item.food?.name)} · ${fmt(item.grams, 1)} g</span><small>${finite(item.missingGrams) && item.missingGrams > 0 ? fmt(item.missingGrams, 1) + ' g fehlen / noch nicht bestätigt' : item.available === true ? 'im Vorrat' : 'Menge prüfen'}</small></div>`).join('')}</div>${recipe.instructions ? `<p class="form-note">${esc(Array.isArray(recipe.instructions) ? recipe.instructions.join(' ') : recipe.instructions)}</p>` : ''}${sourcesHTML(components.map(item => item.food))}<label class="settings-row"><input id="recipe-confirm" type="checkbox"><span>Die gesamte Portion und alle Zutaten wurden verwendet.${missing.length ? '<small>Fehlende Zutaten und Mengen habe ich ergänzt; sie werden nicht stillschweigend als vorhanden angenommen.</small>' : ''}</span></label><p class="muted">Verfügbare bestätigte Vorratsmengen werden beim Eintragen abgezogen. Fehlende Zutaten werden nicht als Einkauf gespeichert.</p><div id="recipe-error"></div><div class="form-actions"><button class="button secondary" id="recipe-back">Zurück</button><button class="button primary" id="recipe-log" disabled>Im Tagebuch erfassen</button></div>`);
    $('#recipe-back').onclick = openRecipes; $('#recipe-confirm').onchange = () => $('#recipe-log').disabled = !$('#recipe-confirm').checked;
    let logged = false; $('#recipe-log').onclick = () => {
      if (logged || !$('#recipe-confirm').checked) return;
      const store = ctx.getStore(), before = clone(store.inventory), record = recordBase(recipe.name, nutrition, components);
      store.inventory = consumeRecipeInventory(store.inventory, ingredients);
      if (!ctx.saveStore()) { store.inventory = before; error('#recipe-error', 'Der Vorrat konnte nicht aktualisiert werden.'); return; }
      if (!logRecord(record)) { store.inventory = before; ctx.saveStore(); error('#recipe-error', 'Die Mahlzeit konnte nicht gespeichert werden.'); return; }
      logged = true;
    };
  }
  function openGrocery(initialBarcode = '') {
    const token = modal('Produkt scannen', `<p>Scanne einen Barcode oder gib die EAN ein. Produktdaten kommen aus Open Food Facts und müssen mit der Verpackung abgeglichen werden.</p><form id="grocery-lookup"><label class="field">Barcode / EAN<input name="barcode" id="grocery-barcode" inputmode="numeric" autocomplete="off" pattern="[0-9]{8,14}" minlength="8" maxlength="14" required value="${esc(initialBarcode)}" placeholder="z. B. 4000000000000"></label><div id="barcode-camera-preview"></div><p class="muted" id="barcode-camera-status"></p><div id="grocery-error"></div><div class="form-actions"><button type="button" class="button secondary" id="grocery-camera">${icon('camera')}Barcode-Kamera</button><button type="submit" class="button primary" id="grocery-search">Produkt suchen</button></div></form><div class="form-actions"><button class="text-button" id="grocery-manual">Produkt manuell erfassen</button></div><p class="form-note">Kein Produkt gefunden? Du kannst die Verpackungsangaben selbst eintragen. Verfügbarkeit und Supermarktpreise werden nicht erfunden.</p>`);
    $('#grocery-manual').onclick = () => openManualProduct($('#grocery-barcode').value.trim());
    $('#grocery-camera').onclick = () => startBarcodeCamera(token);
    $('#grocery-lookup').onsubmit = async event => {
      event.preventDefault(); if (!$('#grocery-lookup').reportValidity() || busy) return;
      const barcode = $('#grocery-barcode').value.trim(); busy = true; $('#grocery-search').disabled = true; stopMedia(); error('#grocery-error', '');
      try {
        const data = await request('/api/products/' + encodeURIComponent(barcode), {}, token);
        if (!data || !alive(token)) return;
        const product = data.product || data;
        if (!product.per100 || typeof product.name !== 'string') throw Error('Für dieses Produkt liegen keine verwertbaren Daten vor.');
        showProduct(product);
      } catch (issue) {
        if (!alive(token) || issue.name === 'AbortError') return;
        error('#grocery-error', issue.status === 404 ? 'Dieser Barcode ist nicht bekannt. Nutze die manuelle Erfassung mit den Angaben der Verpackung.' : issue.message);
      } finally { busy = false; if (alive(token)) $('#grocery-search').disabled = false; }
    };
  }
  async function startBarcodeCamera(token) {
    const status = $('#barcode-camera-status'); status.textContent = '';
    try {
      if (!('BarcodeDetector' in globalThis)) throw Error('Barcode-Erkennung wird in diesem Browser nicht unterstützt. Bitte gib die EAN manuell ein.');
      const supported = typeof BarcodeDetector.getSupportedFormats === 'function' ? await BarcodeDetector.getSupportedFormats() : ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(format => supported.includes(format));
      if (!formats.length || !navigator.mediaDevices?.getUserMedia) throw Error('Keine passende Barcode-Kamera verfügbar. Bitte gib die EAN manuell ein.');
      const detector = new BarcodeDetector({ formats });
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (!alive(token)) { opened.getTracks().forEach(track => track.stop()); return; }
      stopMedia(); stream = opened;
      $('#barcode-camera-preview').innerHTML = '<div class="scan-capture"><div class="scan-preview"><video id="barcode-video" autoplay muted playsinline aria-label="Livebild für Barcode-Erkennung"></video></div></div>';
      const video = $('#barcode-video'); video.srcObject = stream; status.textContent = 'Halte den Barcode ruhig ins Bild. Danach wird die EAN zur Prüfung übernommen.';
      let detecting = false;
      const tick = async () => {
        if (!alive(token) || !stream) return;
        if (video.readyState >= 2 && !detecting) {
          detecting = true;
          try {
            const codes = await detector.detect(video);
            const code = codes.find(result => /^\d{8,14}$/.test(result.rawValue));
            if (code && alive(token)) { $('#grocery-barcode').value = code.rawValue; stopMedia(); $('#barcode-camera-preview').innerHTML = ''; status.textContent = 'Barcode erkannt. Prüfe die Nummer und tippe auf „Produkt suchen“.'; return; }
          } catch { if (alive(token)) status.textContent = 'Barcode noch nicht lesbar. Sorge für gutes Licht oder gib die EAN manuell ein.'; }
          finally { detecting = false; }
        }
        if (alive(token) && stream) animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
    } catch (issue) { if (alive(token)) status.textContent = issue.message || 'Die Kamera konnte nicht geöffnet werden. Bitte gib die EAN ein.'; }
  }
  function productNutrition(product, quantity) {
    if (!hasKnownNutritionBasis(product)) return Object.fromEntries(ALL.map(key => [key, null]));
    // Scaling labelled /100 ml values is valid for display. It is never converted to a fictitious gram weight.
    if (product.unit === 'ml') return Object.fromEntries(ALL.map(key => [key, finite(product.per100?.[key]) ? rounded(product.per100[key] * quantity / 100) : null]));
    return calculatePortion(product, quantity);
  }
  function showProduct(product, quantity = null) {
    const unknownBasis = !hasKnownNutritionBasis(product);
    const isLiquid = !unknownBasis && product.unit === 'ml';
    let amount = quantity ?? (isLiquid && gramsValid(product.servingMl) ? product.servingMl : gramsValid(product.servingGrams) && !isLiquid ? product.servingGrams : 100);
    if (!gramsValid(amount)) amount = 100;
    const token = modal(product.name, `<p>${esc(product.brand || '')}${product.barcode ? ' · EAN ' + esc(product.barcode) : ''}</p><p class="muted">${product.servingLabel ? 'Herstellerportion: ' + esc(product.servingLabel) : 'Keine verlässliche Herstellerportion angegeben.'}</p><label class="field">${unknownBasis ? 'Bezugsmenge unbekannt – Verpackung prüfen' : 'Deine Portion (' + (isLiquid ? 'ml' : 'g') + ')'}<input id="product-quantity" type="number" min="0.1" max="10000" step="0.1" value="${unknownBasis ? '' : amount}" ${unknownBasis ? 'disabled' : 'required'}></label><div id="product-values" class="scan-result"></div><p class="muted" id="product-fit"></p><p class="form-note">${unknownBasis ? 'Bezugsmenge unbekannt – Verpackung prüfen. Die Daten sind widersprüchlich oder ihre Bezugseinheit fehlt. Eine Portionsberechnung und Tagebuchübernahme wären irreführend. Bitte nutze die manuelle Erfassung anhand der Verpackung.' : isLiquid ? 'Die Daten beziehen sich auf 100 ml. Ohne verlässliche Dichte wird ml nicht in g umgerechnet. Für das gewichtbasierte Tagebuch bitte die manuelle Erfassung mit tatsächlich gemessenem Portionsgewicht verwenden.' : 'Alle Vergleichswerte beziehen sich auf 100 g. Deine Portion wird proportional berechnet.'} Fehlende Angaben sind keine Nullwerte.</p>${sourcesHTML([product])}<p class="muted">Open Food Facts ist eine gemeinschaftlich gepflegte Datenbank. Bitte Verpackung prüfen. Keine verlässlichen aktuellen Preisdaten vorhanden.</p><div id="product-error"></div><div class="form-actions"><button class="button secondary" id="product-inventory">${unknownBasis ? 'Zum Vorrat (Menge offen)' : 'Zum Vorrat'}</button><button class="button primary" id="product-log" ${hasCompleteNutrition(product) ? '' : 'disabled'}>Im Tagebuch erfassen</button></div><div class="form-actions"><button class="button secondary" id="product-alternatives" ${unknownBasis ? 'disabled' : ''}>Alternativen vergleichen</button><button class="text-button" id="product-manual">Verpackungsangaben manuell erfassen</button><button class="text-button" id="product-new">Anderes Produkt</button></div>`);
    let logged = false;
    function update() {
      if (unknownBasis) {
        amount = null; $('#product-quantity').disabled = true; $('#product-values').innerHTML = '<p>Bezugsmenge unbekannt – Verpackung prüfen.</p><p class="muted">Keine Portionswerte berechnet. Fehlende Einheiten werden nicht als Gramm angenommen.</p>'; $('#product-fit').textContent = 'Ohne eindeutige Bezugsmenge ist keine verlässliche Passung zu deinen verbleibenden Makros möglich.'; $('#product-log').disabled = true; return;
      }
      amount = Number($('#product-quantity').value); const valid = gramsValid(amount), values = valid ? productNutrition(product, amount) : null;
      $('#product-values').innerHTML = `<p class="muted">Deine Portion · ${valid ? fmt(amount, 1) : '—'} ${isLiquid ? 'ml' : 'g'}</p>${nutritionHTML(values)}<p class="muted">Pro 100 ${isLiquid ? 'ml' : 'g'}: ${fmt(product.per100.kcal)} kcal · ${fmt(product.per100.protein, 1)} g Protein · ${fmt(product.per100.carbs, 1)} g Kohlenhydrate · ${fmt(product.per100.fat, 1)} g Fett</p>`;
      const remaining = remainingTargets();
      $('#product-fit').textContent = values && finite(values.kcal) && finite(values.protein) ? `Noch offen heute: ${fmt(remaining.kcal)} kcal · ${fmt(remaining.protein, 1)} g Protein · ${fmt(remaining.carbs, 1)} g Kohlenhydrate · ${fmt(remaining.fat, 1)} g Fett. Diese Portion ${values.kcal <= remaining.kcal ? 'liegt innerhalb' : 'liegt oberhalb'} deines verbleibenden Kalorienbudgets.` : 'Die Passung kann mit den fehlenden Nährwertangaben nicht vollständig berechnet werden.';
      $('#product-log').disabled = logged || !valid || !hasCompleteNutrition(product);
    }
    $('#product-quantity').oninput = update; update();
    $('#product-new').onclick = () => openGrocery(); $('#product-manual').onclick = () => openManualProduct(product.barcode || '');
    $('#product-inventory').onclick = () => {
      if (!unknownBasis && !gramsValid(amount)) { error('#product-error', 'Bitte prüfe die Portionsgröße.'); return; }
      const store = ctx.getStore(), row = { id: freshId(), name: product.name, foodId: product.id, food: clone(product), grams: unknownBasis || isLiquid ? null : amount, confirmed: true, cookingMethod: product.cookingMethod || '', quantityEstimated: false, sourcekind: 'grocery' };
      store.inventory.push(row);
      if (!ctx.saveStore()) { store.inventory.pop(); error('#product-error', 'Der Vorrat konnte nicht gespeichert werden.'); return; }
      ctx.toast(unknownBasis || isLiquid ? 'Produkt gespeichert. Die Masse in Gramm bleibt unbekannt.' : 'Produkt zum Vorrat hinzugefügt.'); openInventory();
    };
    $('#product-log').onclick = () => {
      if (logged || !hasCompleteNutrition(product) || !gramsValid(amount)) return;
      try {
        const components = [{ id: freshId(), name: product.name, foodId: product.id, food: product, grams: amount, cookingMethod: product.cookingMethod || '', confirmed: true, quantityEstimated: false }];
        const nutrition = calculateConfirmedMeal(components); const record = recordBase(product.name, nutrition, components);
        if (logRecord(record)) logged = true;
      } catch (issue) { error('#product-error', issue.message); }
    };
    $('#product-alternatives').onclick = async () => {
      if (busy) return; busy = true; $('#product-alternatives').disabled = true; error('#product-error', '');
      try {
        if (unknownBasis) throw Error('Die Bezugsmenge ist unklar. Bitte prüfe die Verpackung oder erfasse das Produkt manuell.');
        if (isLiquid) throw Error('Für dieses Produkt gelten Angaben pro 100 ml. Ein Vergleich mit 100-g-Produkten wäre irreführend und wird nicht angezeigt.');
        const category = product.categoryTags?.find(value => typeof value === 'string' && /^[a-z]{2}:[a-z0-9-]+$/.test(value));
        if (!category) throw Error('Für dieses Produkt ist keine verlässliche Vergleichskategorie vorhanden.');
        const data = await request('/api/products?category=' + encodeURIComponent(category), {}, token);
        if (data && alive(token)) showComparisons(product, data.products || data.alternatives || [], amount);
      } catch (issue) { if (alive(token) && issue.name !== 'AbortError') error('#product-error', issue.message); }
      finally { busy = false; if (alive(token)) $('#product-alternatives').disabled = false; }
    };
  }
  function showComparisons(product, candidates, quantity, criterion = 'protein') {
    const comparable = candidates.filter(candidate => candidate.id !== product.id && candidate.unit === 'g' && hasCompleteNutrition(candidate));
    const remaining = remainingTargets();
    let ranked;
    try { ranked = compareProducts(product, comparable, remaining, { criterion }); }
    catch { ranked = comparable; }
    const rows = (Array.isArray(ranked) ? ranked : ranked?.products || []).map(row => row.product || row).filter(row => row?.per100);
    const unique = [...new Map(rows.map(row => [row.id || row.barcode, row])).values()].slice(0, 8);
    modal('Produkte vergleichen', `<p>Einheitliche Basis: 100 g. Portionswerte beziehen sich bei allen Produkten auf ${fmt(quantity, 1)} g. Verglichen werden nur Produkte mit vollständigen Kernnährwerten.</p><label class="field">Vergleich nach<select id="comparison-criterion"><option value="protein" ${criterion === 'protein' ? 'selected' : ''}>Mehr Protein pro 100 g</option><option value="calories" ${criterion === 'calories' ? 'selected' : ''}>Weniger Kalorien pro 100 g</option><option value="density" ${criterion === 'density' ? 'selected' : ''}>Protein pro 100 kcal</option><option value="fit" ${criterion === 'fit' ? 'selected' : ''}>Passung zu meinen verbleibenden Zielen</option></select></label><div>${[product, ...unique].map((row, i) => `<div class="analysis-item"><span>${i === 0 ? '<strong>Gescannt: </strong>' : ''}${esc(row.name)}<p class="muted">100 g: ${fmt(row.per100.kcal)} kcal · ${fmt(row.per100.protein, 1)} g Protein · ${fmt(row.per100.carbs, 1)} g Kohlenhydrate · ${fmt(row.per100.fat, 1)} g Fett</p><p class="muted">${row.per100.kcal > 0 ? fmt(row.per100.protein / row.per100.kcal * 100, 1) + ' g Protein / 100 kcal' : 'Proteindichte nicht berechenbar'} · Portion: ${fmt(productNutrition(row, quantity).kcal)} kcal</p></span>${i > 0 ? `<button class="icon-button" data-compare-product="${i - 1}" aria-label="${esc(row.name)} ansehen">${icon('chevron-right')}</button>` : ''}</div>`).join('')}</div>${unique.length ? '' : '<p class="form-note">Keine vergleichbaren Alternativen verfügbar. Es werden keine Produkte oder Verfügbarkeiten erfunden.</p>'}<p class="form-note">Kein Preisvergleich: Es liegen keine verlässlichen aktuellen Preise vor. Der Katalog bestätigt keine Verfügbarkeit in einem bestimmten Supermarkt.</p><p class="muted">Open Food Facts · Datenbank ODbL, einzelne Inhalte DbCL. Verpackungsangaben bitte prüfen.</p><div class="form-actions"><button class="button secondary" id="comparison-back">Zurück zum Produkt</button></div>`);
    $('#comparison-back').onclick = () => showProduct(product, quantity); $('#comparison-criterion').onchange = event => showComparisons(product, candidates, quantity, event.target.value);
    document.querySelectorAll('[data-compare-product]').forEach(button => button.onclick = () => showProduct(unique[Number(button.dataset.compareProduct)], quantity));
  }
  function openManualProduct(barcode = '') {
    modal('Verpackungsangaben eintragen', `<p>Dieses Produkt wird als manuell eingegeben gespeichert, ohne externe Prüfung. Übertrage die Angaben pro 100 g direkt von der Verpackung. Leere optionale Werte bleiben unbekannt.</p><form id="manual-product-form"><div class="form-grid"><label class="field full">Produktname<input name="name" maxlength="120" required></label>${[['kcal', 'Kalorien (kcal)'], ['protein', 'Protein (g)'], ['carbs', 'Kohlenhydrate (g)'], ['fat', 'Fett (g)'], ['fiber', 'Ballaststoffe (g), optional'], ['sugar', 'Zucker (g), optional']].map(([key, label]) => `<label class="field">${label}<input name="${key}" type="number" min="0" max="${key === 'kcal' ? 1000 : 100}" step="0.1" ${CORE.includes(key) ? 'required' : ''}></label>`).join('')}</div><div id="manual-product-error"></div><div class="form-actions"><button class="button secondary" type="button" id="manual-product-cancel">Abbrechen</button><button class="button primary" type="submit">Produkt prüfen</button></div></form>`);
    $('#manual-product-cancel').onclick = () => openGrocery(barcode);
    $('#manual-product-form').onsubmit = event => {
      event.preventDefault(); if (!event.target.reportValidity()) return;
      try { const data = Object.fromEntries(new FormData(event.target)); data.barcode = barcode; showProduct(validateManualProduct(data)); }
      catch (issue) { error('#manual-product-error', issue.message); }
    };
  }
  function destroy() { cancelWork(); meal = null; const host = $('#analysis-content'); if (host) host.innerHTML = ''; }
  return { showMealAnalysis, openFridge, openInventory, openGrocery, openCorrections, pause: cancelWork, destroy };
}
