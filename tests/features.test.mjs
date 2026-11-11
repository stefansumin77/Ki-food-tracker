import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetectionItems, applySavedCorrections, calculateConfirmedMeal, createConfirmedDiaryEntry, inventoryFromComponents, validateManualProduct, consumeRecipeInventory, hasCompleteNutrition, initNutritionFeatures } from '../web/features.js';
import { catalog } from '../web/nutrition.js';

function replaceGlobal(t, name, value) { const descriptor = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }); }

const fixtureFood = (overrides = {}) => ({ id: 'test:food', name: 'Test-Lebensmittel', unit: 'g', cookingMethod: 'gekocht', per100: { kcal: 120, protein: 5, carbs: 20, fat: 2, fiber: null, sugar: 1 }, source: { name: 'Unit-test fixture', url: 'https://example.test/food', license: 'test' }, ...overrides });
const component = overrides => ({ id: 'component-1', name: 'Test-Lebensmittel', originalName: 'Test-Lebensmittel', foodId: 'test:food', food: fixtureFood(), grams: 150, cookingMethod: 'gekocht', confirmed: true, quantityEstimated: false, ...overrides });

test('food recognition ignores model-generated nutrient arithmetic and leaves unknown sources unresolved', () => {
  const rows = normalizeDetectionItems({ items: [{ name: 'Unbekanntes Testgericht XYZ', grams: null, cookingMethod: '', recognitionConfidence: 'low', quantityConfidence: 'needs_confirmation', per100: { kcal: 1 }, source: { name: 'model' }, kcal: 999 }] });
  assert.equal(rows[0].food, null);
  assert.equal(rows[0].grams, null);
  assert.equal(rows[0].confirmed, false);
  assert.equal(rows[0].quantityEstimated, true);
  assert.equal(rows[0].quantityConfidence, 'needs_confirmation');
});

test('meal macros are derived deterministically from confirmed components and retain missing optional values', () => {
  const nutrition = calculateConfirmedMeal([component()]);
  assert.deepEqual(nutrition, { grams: 150, kcal: 180, protein: 7.5, carbs: 30, fat: 3, fiber: null, sugar: 1.5 });
  assert.equal(calculateConfirmedMeal([component({ grams: 300 })]).kcal, 360);
});

test('confirmed diary entries retain component sources and consistent macros rather than model totals', () => {
  const entry = createConfirmedDiaryEntry({ id: 'confirmed-1', name: 'Bestätigter Teller', components: [component()], date: '2026-11-11', time: '12:00', ai: true });
  assert.equal(entry.kcal, 180);
  assert.deepEqual(entry.components[0].per100, fixtureFood().per100);
  assert.deepEqual(entry.components[0].source, fixtureFood().source);
  assert.equal(entry.components[0].confirmed, true);
  assert.equal(entry.components[0].food, undefined);
  assert.equal(entry.components[0].quantityEstimated, false);
});

test('unconfirmed components, unknown quantities, cooking mismatches and missing core nutrients cannot be logged', () => {
  for (const row of [component({ confirmed: false }), component({ grams: null }), component({ grams: 0 }), component({ cookingMethod: 'roh' }), component({ food: fixtureFood({ per100: { kcal: 100, protein: null, carbs: 20, fat: 1 } }) }), component({ food: fixtureFood({ source: null }) })]) {
    assert.throws(() => calculateConfirmedMeal([row]));
  }
  assert.equal(hasCompleteNutrition(fixtureFood({ unit: 'ml' })), false);
  assert.equal(hasCompleteNutrition(fixtureFood({ unit: 'unknown', nutritionBasis: 'unknown', per100Basis: 'unknown' })), false);
  assert.equal(hasCompleteNutrition(fixtureFood({ unit: 'g', nutritionBasis: '100ml' })), false);
});

test('consented corrections suggest only a current known food and never reuse a previous portion', () => {
  assert.ok(catalog.length, 'A sourced catalog is required for correction suggestions');
  const food = catalog[0], current = component({ originalName: 'Bekannte Zutat', cookingMethod: food.cookingMethod, grams: 80, confirmed: false });
  const correction = { consent: true, originalName: 'Bekannte Zutat', foodId: food.id, cookingMethod: food.cookingMethod, grams: 500 };
  const [suggested] = applySavedCorrections([current], [correction]);
  assert.equal(suggested.foodId, food.id);
  assert.equal(suggested.grams, 80);
  assert.equal(suggested.confirmed, false);
  assert.equal(suggested.correctionSuggested, true);
  assert.equal(applySavedCorrections([current], [{ ...correction, consent: false }])[0].correctionSuggested, undefined);
});

test('inventory confirmation preserves unknown amounts without inventing nutrition', () => {
  const rows = inventoryFromComponents([component({ food: null, foodId: null, grams: null, quantityEstimated: true })]);
  assert.equal(rows[0].grams, null);
  assert.equal(rows[0].food, null);
  assert.equal(rows[0].foodId, null);
  assert.equal(rows[0].sourcekind, 'fridge');
  assert.throws(() => inventoryFromComponents([component({ confirmed: false })]));
});

test('unknown barcode manual entry requires explicit core values and never invents optional nutrition or price', () => {
  const product = validateManualProduct({ name: 'Verpackungsangaben', barcode: '12345678', kcal: '150', protein: '10', carbs: '15', fat: '5', fiber: '', sugar: '' });
  assert.equal(product.per100.fiber, null);
  assert.equal(product.per100.sugar, null);
  assert.equal(product.source.license, 'user-entered');
  assert.match(product.source.name, /Manuell/);
  assert.equal(product.price, undefined);
  assert.throws(() => validateManualProduct({ name: 'Fehlt', kcal: '', protein: 0, carbs: 0, fat: 0 }));
  assert.throws(() => validateManualProduct({ name: 'Falsch', kcal: 100, protein: 0, carbs: 5, fat: 1, sugar: 6 }));
});

test('recipe inventory consumption is bounded and does not assign guessed quantities', () => {
  const rows = [{ id: 'a', foodId: 'rice', grams: 100, confirmed: true }, { id: 'b', foodId: 'rice', grams: 30, confirmed: true }, { id: 'c', foodId: 'rice', grams: null, confirmed: true }];
  const result = consumeRecipeInventory(rows, [{ foodId: 'rice', grams: 160 }]);
  assert.deepEqual(result, [{ id: 'c', foodId: 'rice', grams: null, confirmed: true }]);
  assert.equal(rows[0].grams, 100);
});

function fakeUI() {
  const elements = new Map(), cleanups = [];
  class Element {
    constructor() { this.value = ''; this.disabled = false; this.dataset = {}; this.listeners = {}; this.elements = {}; this.checked = false; }
    set innerHTML(value) { this.html = value; }
    get innerHTML() { return this.html || ''; }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    fire(type) { this.listeners[type]?.({ target: this, preventDefault() {} }); }
    reportValidity() { return true; }
  }
  const document = { querySelector: selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }, querySelectorAll: () => [] };
  const store = { inventory: [], corrections: [], profile: {}, weightLogs: [], completeDays: {} }, state = { demo: false, entries: [], goals: { kcal: 2000, protein: 120, carbs: 250, fat: 65 } };
  let view = 'scan', modal = false, saved = 0;
  const runCleanup = () => { for (const fn of cleanups.splice(0)) fn(); };
  const ctx = { esc: value => String(value ?? '').replaceAll('<', '&lt;'), fmt: value => String(value), icon: () => '<svg></svg>', getStore: () => store, getState: () => state, getDay: () => '2026-11-11', getView: () => view, entriesFor: () => [], totals: () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 }), showModal: (_title, html) => {
      runCleanup(); modal = true; document.querySelector('#modal-content').innerHTML = html;
      if (html.includes('id="nutrition-components-form"')) {
        const form = document.querySelector('#nutrition-components-form'), controls = [];
        for (const match of html.matchAll(/<(input|select) ([^>]*data-component[^>]*)>/g)) {
          const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(row => [row[1], row[2]]));
          const control = new Element(); control.dataset = { component: attrs['data-component'], index: attrs['data-index'] }; control.value = attrs.value || ''; control.checked = /\bchecked\b/.test(match[2]);
          controls.push(control);
        }
        form.querySelectorAll = selector => selector === '[data-component]' ? controls : [];
        form.querySelector = selector => { const field = /data-component="([^"]+)"/.exec(selector)?.[1], index = /data-index="([^"]+)"/.exec(selector)?.[1]; return controls.find(control => control.dataset.component === field && control.dataset.index === index); };
      }
      if (html.includes('id="nutrition-questions-form"')) {
        const form = document.querySelector('#nutrition-questions-form'); form.elements = {};
        for (const match of html.matchAll(/<select name="([^"]+)"/g)) form.elements[match[1]] = { value: '' };
      }
    }, closeModal: () => { runCleanup(); modal = false; }, onCleanup: fn => cleanups.push(fn), isCurrent: () => true, setView: next => { if (next !== view) runCleanup(); view = next; }, toast() {}, render() {}, leaveDemo() { state.demo = false; }, saveState() { saved++; return true; }, saveStore: () => true, resizeImage: () => 'data:image/jpeg;base64,/9j/AA==' };
  return { document, elements, ctx, state, store, cleanup: runCleanup, saved: () => saved, modal: () => modal };
}

test('fridge and barcode screens do not request camera permission when opened', t => {
  const ui = fakeUI(); let requests = 0;
  replaceGlobal(t, 'document', ui.document);
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: () => { requests++; } } });
  const features = initNutritionFeatures(ui.ctx); features.openFridge(); features.openGrocery();
  assert.equal(requests, 0);
});

test('late fridge camera permission is stopped after the modal closes', async t => {
  const ui = fakeUI(); let resolveCamera, stops = 0;
  replaceGlobal(t, 'document', ui.document);
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveCamera = resolve; }) } });
  const features = initNutritionFeatures(ui.ctx); features.openFridge();
  const opening = ui.document.querySelector('#fridge-camera').onclick();
  ui.ctx.closeModal(); resolveCamera({ getTracks: () => [{ stop: () => stops++ }] }); await opening;
  assert.equal(stops, 1); assert.equal(ui.saved(), 0);
});

test('unknown grocery barcode is explained without a fabricated product or diary entry', async t => {
  const ui = fakeUI(); replaceGlobal(t, 'document', ui.document);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404, json: async () => ({ error: 'Nicht gefunden' }) }));
  const features = initNutritionFeatures(ui.ctx); features.openGrocery(); ui.document.querySelector('#grocery-barcode').value = '12345678';
  await ui.document.querySelector('#grocery-lookup').onsubmit({ preventDefault() {} });
  assert.match(ui.document.querySelector('#grocery-error').innerHTML, /manuelle Erfassung/);
  assert.equal(ui.state.entries.length, 0); assert.equal(ui.saved(), 0);
});

test('meal analysis initially prevents saving until components and hidden-calorie questions are confirmed', t => {
  const ui = fakeUI(); replaceGlobal(t, 'document', ui.document);
  const features = initNutritionFeatures(ui.ctx);
  features.showMealAnalysis({ name: 'Test', items: [{ name: 'Unbekannte Testzutat', grams: null, recognitionConfidence: 'low', quantityConfidence: 'needs_confirmation' }], questions: [{ id: 'oil', kind: 'oil', text: 'Öl verwendet?' }] }, '');
  assert.match(ui.document.querySelector('#analysis-content').innerHTML, /id="nutrition-save" disabled/);
  assert.match(ui.document.querySelector('#analysis-content').innerHTML, /Erkennung: Niedrig/);
  assert.equal(ui.saved(), 0);
});


test('confirmed ingredients and hidden-calorie answers save sourced components once with opt-in correction consent', async t => {
  assert.ok(catalog.length);
  const food = catalog[0], ui = fakeUI(); replaceGlobal(t, 'document', ui.document);
  replaceGlobal(t, 'FormData', class { constructor(form) { this.form = form; } get(name) { return this.form.elements[name]?.value ?? null; } });
  const features = initNutritionFeatures(ui.ctx);
  features.showMealAnalysis({ name: 'Bestätigter Teller', items: [{ id: 'detected', name: food.name, foodId: food.id, grams: 100, cookingMethod: food.cookingMethod, recognitionConfidence: 'medium', quantityConfidence: 'low' }], questions: [{ id: 'oil', kind: 'oil', text: 'Öl verwendet?' }] }, '');
  ui.document.querySelector('#nutrition-edit').onclick();
  const form = ui.document.querySelector('#nutrition-components-form');
  const confirmation = form.querySelector('[data-component="confirmed"][data-index="0"]'); confirmation.checked = true; confirmation.fire('change');
  ui.document.querySelector('#nutrition-save-correction').checked = true;
  form.onsubmit({ preventDefault() {} });
  ui.document.querySelector('#nutrition-questions').onclick();
  const questions = ui.document.querySelector('#nutrition-questions-form'); questions.elements['q-oil'].value = 'no'; questions.onsubmit({ preventDefault() {} });
  const save = ui.document.querySelector('#nutrition-save').onclick; await save(); await save();
  assert.equal(ui.saved(), 1); assert.equal(ui.state.entries.length, 1);
  assert.equal(ui.state.entries[0].components[0].confirmed, true);
  assert.deepEqual(ui.state.entries[0].components[0].per100, food.per100);
  assert.equal(ui.store.corrections.length, 1); assert.equal(ui.store.corrections[0].consent, true);
});


test('grocery products with ambiguous nutrition basis show manual fallback and cannot scale or log grams', async t => {
  const ui = fakeUI(); replaceGlobal(t, 'document', ui.document);
  const product = fixtureFood({ id: 'off:12345678', barcode: '12345678', unit: 'unknown', nutritionBasis: 'unknown', per100Basis: 'unknown' });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ product }) }));
  const features = initNutritionFeatures(ui.ctx); features.openGrocery(); ui.document.querySelector('#grocery-barcode').value = '12345678';
  await ui.document.querySelector('#grocery-lookup').onsubmit({ preventDefault() {} });
  assert.match(ui.document.querySelector('#product-values').innerHTML, /Bezugsmenge unbekannt/);
  assert.equal(ui.document.querySelector('#product-quantity').disabled, true);
  assert.equal(ui.document.querySelector('#product-log').disabled, true);
  assert.match(ui.document.querySelector('#modal-content').innerHTML, /Verpackungsangaben manuell erfassen/);
  ui.document.querySelector('#product-log').onclick(); assert.equal(ui.saved(), 0);
  ui.document.querySelector('#product-inventory').onclick(); assert.equal(ui.store.inventory[0].grams, null); assert.equal(ui.store.inventory[0].food.unit, 'unknown');
});


test('explicit inventory nutrition and consented product corrections can supply meal sources without trusting AI macros', () => {
  const product = fixtureFood({ id: 'off:4000000000000', name: 'Verifiziertes Vorratsprodukt', cookingMethod: '' });
  const result = { items: [{ id: 'food', name: 'Brot aus dem Vorrat', grams: 60, cookingMethod: '', recognitionConfidence: 'low', quantityConfidence: 'low', per100: { kcal: 1 } }] };
  const correction = { consent: true, originalName: 'Brot aus dem Vorrat', foodId: product.id, cookingMethod: '', grams: 200 };
  const [item] = normalizeDetectionItems(result, [correction], [...catalog, product]);
  assert.equal(item.foodId, product.id);
  assert.equal(item.grams, 60);
  assert.deepEqual(item.food.per100, product.per100);
  assert.equal(item.confirmed, false);
  assert.equal(item.correctionSuggested, true);
  assert.equal(calculateConfirmedMeal([{ ...item, confirmed: true }]).kcal, 72);
  const [unconsented] = normalizeDetectionItems(result, [{ ...correction, consent: false }], [...catalog, product]);
  assert.equal(unconsented.food, null);
});
