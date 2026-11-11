/** Browser-only feature data, partitioned by the authenticated Sites user ID.
 * Raw photographs and API credentials are deliberately outside this schema.
 */
const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new TypeError(message); };
const clone = value => structuredClone(value);

export function defaultFeatureData() {
  return {
    inventory: [], corrections: [], profile: {}, weightLogs: [], completeDays: {}, metabolismApprovals: [],
    targetLocks: { kcal: true, protein: true, carbs: true, fat: true },
  };
}
function text(value, label, max = 120, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`Ungültiges Feld: ${label}`);
  const result = value.trim();
  if (!result && !allowEmpty) invalid(`Leeres Feld: ${label}`);
  return result;
}
function number(value, label, min, max, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`Ungültige Zahl: ${label}`);
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Ungültiges Datum');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid('Ungültiges Datum');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid('Ungültiger Zeitpunkt');
  date(value.slice(0, 10));
  return value;
}
function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max) invalid(`Ungültige Liste: ${label}`);
  return value;
}
function optionalText(input, output, key, max = 120, nullable = false) {
  if (!own(input, key)) return;
  output[key] = input[key] === null && nullable ? null : text(input[key], key, max, true);
}
function source(input) {
  if (input === null || input === undefined) return null;
  if (input === 'manual') return { name: 'manual', url: null, license: 'user-provided' };
  if (!object(input)) invalid('Ungültige Nährwertquelle');
  const result = { name: text(input.name, 'Quelle', 200) };
  if (input.url === null || input.url === undefined || input.url === '') result.url = null;
  else {
    let parsed; try { parsed = new URL(text(input.url, 'Quellen-URL', 1000)); } catch { invalid('Ungültige Quellen-URL'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalid('Quellen benötigen HTTPS');
    result.url = parsed.href;
  }
  for (const key of ['recordId', 'license', 'attribution', 'type', 'kind']) optionalText(input, result, key, key === 'attribution' ? 500 : 200);
  for (const key of ['retrievedAt', 'fetchedAt']) if (own(input, key)) result[key] = timestamp(input[key]);
  return result;
}
export function validateStoredFood(input) {
  if (input === null) return null;
  if (!object(input) || !object(input.per100)) invalid('Ungültiger Lebensmitteleintrag');
  const food = { id: text(input.id, 'Lebensmittel-ID', 200), name: text(input.name, 'Lebensmittelname'), per100: {}, source: source(input.source), unit: input.unit || 'g' };
  if (!['g', 'ml', 'unknown'].includes(food.unit)) invalid('Ungültige Mengeneinheit');
  const declaredBases = ['nutritionBasis', 'per100Basis'].filter(key => own(input, key)).map(key => input[key]);
  if (declaredBases.some(value => !['100g', '100ml', 'unknown', null].includes(value))) invalid('Ungültige Nährwertbasis');
  const knownBases = declaredBases.filter(value => value !== null && value !== 'unknown');
  const conflicting = new Set(knownBases).size > 1 || knownBases.some(value => value !== (food.unit === 'g' ? '100g' : '100ml'));
  if (food.unit === 'unknown' || declaredBases.includes('unknown') || conflicting) {
    food.unit = 'unknown'; food.nutritionBasis = 'unknown'; food.per100Basis = 'unknown';
  } else {
    for (const key of ['nutritionBasis', 'per100Basis']) if (own(input, key)) food[key] = input[key];
  }
  for (const key of NUTRIENTS) food.per100[key] = number(input.per100[key] ?? null, key, 0, key === 'kcal' ? 1500 : 100, true);
  if (food.per100.sugar !== null && food.per100.carbs !== null && food.per100.sugar > food.per100.carbs + 1) invalid('Zucker übersteigt Kohlenhydrate');
  for (const key of ['barcode', 'brand', 'servingLabel', 'cookingMethod']) optionalText(input, food, key, key === 'brand' ? 200 : 120, true);
  if (own(input, 'servingGrams')) food.servingGrams = number(input.servingGrams, 'Portion', 0.1, 10000, true);
  if (own(input, 'servingMl')) food.servingMl = number(input.servingMl, 'Portion in ml', 0.1, 10000, true);
  if (own(input, 'categoryTags')) food.categoryTags = list(input.categoryTags, 'Kategorien', 100).map(tag => text(tag, 'Kategorie', 150));
  if (own(input, 'aliases')) food.aliases = list(input.aliases, 'Aliasnamen', 50).map(alias => text(alias, 'Aliasname'));
  for (const key of ['fetchedAt', 'updatedAt']) if (own(input, key)) food[key] = timestamp(input[key]);
  return food;
}
function uniqueRows(rows, label, map) {
  const ids = new Set();
  return rows.map(input => {
    if (!object(input)) invalid(`Ungültiger Eintrag: ${label}`);
    const id = text(input.id, `${label}-ID`, 200);
    if (ids.has(id)) invalid(`Doppelte ID: ${label}`);
    ids.add(id);
    return map(input, id);
  });
}

export function validateFeatureData(input) {
  if (!object(input) || own(input, 'version') && input.version !== 1) invalid('Unbekanntes Datenformat');
  const result = defaultFeatureData();
  result.inventory = uniqueRows(list(input.inventory ?? [], 'Vorrat', 1000), 'Vorrat', (row, id) => {
    if (row.confirmed !== true) invalid('Vorrat muss ausdrücklich bestätigt sein');
    const clean = { id, foodId: row.foodId == null ? null : text(row.foodId, 'Lebensmittel-ID', 200), name: text(row.name, 'Zutat'), grams: number(row.grams, 'Menge', 0, 100000, true), food: validateStoredFood(row.food ?? null), confirmed: true };
    if (clean.food?.unit === 'unknown' && clean.grams !== null) invalid('Unbekannte Nährwertbasis benötigt eine unbestätigte Menge');
    if (own(row, 'cookingMethod')) clean.cookingMethod = text(row.cookingMethod, 'Zubereitung', 120, true);
    if (own(row, 'quantityEstimated')) { if (typeof row.quantityEstimated !== 'boolean') invalid('Ungültiger Mengenstatus'); clean.quantityEstimated = row.quantityEstimated; }
    if (own(row, 'sourcekind')) { if (!['fridge', 'grocery', 'manual'].includes(row.sourcekind)) invalid('Ungültiger Vorratsursprung'); clean.sourcekind = row.sourcekind; }
    return clean;
  });
  result.corrections = uniqueRows(list(input.corrections ?? [], 'Korrekturen', 1000), 'Korrektur', (row, id) => {
    if (row.consent !== true) invalid('Korrekturen benötigen ausdrückliche Einwilligung');
    const clean = { id, consent: true };
    if (own(row, 'at')) clean.at = timestamp(row.at);
    optionalText(row, clean, 'originalName'); optionalText(row, clean, 'foodId', 200, true); optionalText(row, clean, 'cookingMethod');
    if (own(row, 'grams')) clean.grams = number(row.grams, 'Korrekturmenge', 0, 100000, true);
    return clean;
  });
  if (!object(input.profile ?? {})) invalid('Ungültiges Profil');
  const profile = input.profile ?? {};
  for (const [key, min, max] of [['heightCm', 100, 250], ['age', 18, 100]]) if (own(profile, key)) result.profile[key] = number(profile[key], key, min, max, true);
  for (const [key, allowed] of [['sex', ['male', 'female', null]], ['activityLevel', ['sedentary', 'light', 'moderate', 'high']], ['fitnessGoal', ['fat_loss', 'muscle_gain', 'recomposition']], ['targetSource', ['manual', 'adaptive']]]) {
    if (own(profile, key)) { if (!allowed.includes(profile[key])) invalid(`Ungültiges Profilfeld: ${key}`); result.profile[key] = profile[key]; }
  }
  const weightDates = new Set();
  result.weightLogs = list(input.weightLogs ?? [], 'Gewichte', 10000).map(row => {
    if (!object(row)) invalid('Ungültiger Gewichtseintrag');
    const key = date(row.date); if (weightDates.has(key)) invalid('Doppelter Gewichtstag'); weightDates.add(key);
    return { date: key, kg: number(row.kg, 'Gewicht', 25, 400) };
  });
  if (!object(input.completeDays ?? {}) || Object.keys(input.completeDays ?? {}).length > 15000) invalid('Ungültige Tracking-Tage');
  for (const [key, complete] of Object.entries(input.completeDays ?? {})) { date(key); if (typeof complete !== 'boolean') invalid('Ungültiger Tracking-Status'); result.completeDays[key] = complete; }
  result.metabolismApprovals = list(input.metabolismApprovals ?? [], 'Zielanpassungen', 1000).map(row => {
    if (!object(row)) invalid('Ungültige Zielanpassung');
    return { at: timestamp(row.at), from: number(row.from, 'Vorheriges Ziel', 500, 10000), to: number(row.to, 'Neues Ziel', 500, 10000) };
  });
  if (!object(input.targetLocks ?? {})) invalid('Ungültige Zielvorgaben');
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) if (own(input.targetLocks ?? {}, key)) { if (typeof input.targetLocks[key] !== 'boolean') invalid('Ungültiger Zielstatus'); result.targetLocks[key] = input.targetLocks[key]; }
  return result;
}

export function createFeatureStore({ storage, userId } = {}) {
  const identity = text(userId, 'Angemeldeter Benutzer', 256);
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') invalid('Browserspeicher fehlt');
  const key = `nouri-nutrition-v1:${encodeURIComponent(identity)}`;
  let current = defaultFeatureData(), error = null;
  try { const raw = storage.getItem(key); if (raw !== null) current = validateFeatureData(JSON.parse(raw)); } catch (cause) { error = cause; }
  const assign = clean => { for (const property of Object.keys(current)) delete current[property]; Object.assign(current, clean); };
  const persist = clean => {
    try { storage.setItem(key, JSON.stringify({ version: 1, ...clean })); assign(clean); error = null; return true; }
    catch (cause) { error = cause; return false; }
  };
  return {
    key,
    get error() { return error; },
    get() { return current; },
    save() { try { return persist(validateFeatureData(current)); } catch (cause) { error = cause; return false; } },
    replace(data) { if (!object(data) || data.version !== 1) invalid('Unbekannte Sicherung'); return persist(validateFeatureData(data)); },
    clear() { try { storage.removeItem(key); assign(defaultFeatureData()); error = null; return true; } catch (cause) { error = cause; return false; } },
    export() { return { version: 1, ...clone(validateFeatureData(current)) }; },
  };
}
