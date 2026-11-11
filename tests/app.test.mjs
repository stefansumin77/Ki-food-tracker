import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createFeatureStore } from '../web/feature-store.js';

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8').replace(/^import\s+[^;]+;\s*$/gm, '');
const scopedKey = userId => `nouri-diary-v1:${encodeURIComponent(userId)}`;
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function app(saved = null, overrides = {}) {
  const { metaUserId = 'test-user', storageSeed = {}, ...sandboxOverrides } = overrides;
  const nodes = new Map(), created = [];
  const stored = new Map(Object.entries(storageSeed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  if (saved !== null) stored.set(scopedKey(metaUserId || 'test-user'), typeof saved === 'string' ? saved : JSON.stringify(saved));
  const storageReads = [], storageWrites = [];
  class Element {
    constructor(selector) {
      this.selector = selector; this.listeners = {}; this.style = {}; this.dataset = {}; this.open = false;
      const classes = new Set();
      this.classList = { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle(v, enabled) { if (enabled ?? !classes.has(v)) classes.add(v); else classes.delete(v); } };
    }
    setAttribute(name,value) { this[name]=String(value); }
    click() { this.clicked=true; this.onclick?.(); }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    fire(type, detail = {}) { const event = { preventDefault() {}, target: this, ...detail }; this['on' + type]?.(event); for (const callback of this.listeners[type] || []) callback(event); }
    set value(value) { this._value = String(value ?? ''); }
    get value() { return this._value ?? ''; }
    set innerHTML(html) {
      this.html = html;
      if (this.selector === '#modal-content' && /<form id="[^"]+"/.test(html)) {
        const formId = html.match(/<form id="([^"]+)"/)[1];
        const form = new Element('#' + formId); form.elements = {};
        for (const match of html.matchAll(/<input ([^>]+)>/g)) {
          const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
          const control = new Element(attrs.name); control.attrs = attrs; control.required = /\brequired\b/.test(match[1]); control.value = attrs.value;
          form.elements[attrs.name] = control;
        }
        const select = new Element('category');
        const options = [...html.matchAll(/<option([^>]*)>([^<]+)<\/option>/g)];
        if (options.length) {
          select.value = options.find(m => m[1].includes('selected'))?.[2] || options[0][2];
          form.elements.category = select;
        }
        form.reportValidity = () => Object.values(form.elements).every(el => {
          if (el.customError || el.required && !el.value) return false;
          if (el.attrs?.type !== 'number' || el.value === '') return true;
          const number = Number(el.value);
          return Number.isFinite(number) && number >= Number(el.attrs.min) && number <= Number(el.attrs.max);
        });
        nodes.set('#' + formId, form);
      }
    }
    get innerHTML() { return this.html ?? ''; }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    setCustomValidity(message) { this.customError = message; }
    reportValidity() { return !this.customError; }
  }
  const document = {
    body: new Element('body'),
    querySelector(selector) {
      if (selector === 'meta[name="nouri-user-id"]') return metaUserId === null ? null : { content: metaUserId };
      if (!nodes.has(selector)) nodes.set(selector, new Element(selector)); return nodes.get(selector);
    },
    querySelectorAll() { return []; }, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; }, hidden: false,
    createElement(tag) { const element = new Element(tag); created.push(element); return element; },
  };
  const sandbox = {
    document, window: { addEventListener() {}, scrollTo() {} }, navigator: {},
    localStorage: {
      getItem: key => { storageReads.push(key); return stored.get(key) ?? null; },
      setItem: (key, value) => { storageWrites.push(key); stored.set(key, value); },
      removeItem: key => { storageWrites.push(key); stored.delete(key); },
    },
    createFeatureStore,
    structuredClone, Intl, Date, console, crypto: { randomUUID }, AbortController,
    fetch: async () => ({ ok: true, json: async () => ({ aiAvailable: false }) }),
    setTimeout: () => 1, clearTimeout() {}, Blob, URL, atob, Uint8Array,
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.elements[key]?.value ?? null; } },
    ...sandboxOverrides,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const json = code => JSON.parse(JSON.stringify(run(code)));
  return { run, json, nodes, stored, storageReads, storageWrites, created, context };
}

const meal = { id: 'saved-1', date: '2026-11-11', name: 'Reis', category: 'Mittagessen', time: '12:30', grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.4, fiber: 0.6, sugar: 0.1 };
const backup = () => ({ version: 1, demo: false, entries: [{ ...meal }], water: { '2026-11-11': 750 }, goals: { kcal: 2000, protein: 120, carbs: 250, fat: 65, water: 2000 } });

test('reload validates persisted records, preserves entries, and removes unsafe remote thumbnails', () => {
  const data = backup(); data.entries[0].image = 'https://untrusted.example/pixel';
  const ui = app(data);
  assert.equal(ui.json('state.entries').length, 1);
  assert.equal(ui.json('state.water')['2026-11-11'], 750);
  assert.equal(ui.json('state.entries')[0].image, undefined);
  assert.equal(ui.run('storageCorrupt'), false);
});

test('malformed storage cannot inject invalid numbers into charts or crash startup', () => {
  for (const malformed of ['{broken', { ...backup(), goals: { ...backup().goals, kcal: 0 } }, { ...backup(), water: 15 }]) {
    const ui = app(malformed);
    assert.equal(ui.run('storageCorrupt'), true);
    assert.equal(ui.run('state.goals.kcal'), 2000);
    assert.equal(ui.run('storageAvailable'), true);
  }
});

test('imports reject duplicate IDs, nonexistent calendar dates and impossible macros', () => {
  const ui = app();
  const invalids = [
    { ...backup(), entries: [meal, meal] },
    { ...backup(), entries: [{ ...meal, date: '2026-02-30' }] },
    { ...backup(), entries: [{ ...meal, sugar: 50 }] },
    { ...backup(), entries: [{ ...meal, grams: 0 }] },
  ];
  for (const data of invalids) {
    ui.context.candidate = data;
    assert.throws(() => ui.run('validateImport(candidate)'));
  }
  assert.equal(ui.run("isValidDate('2024-02-29')"), true);
  assert.equal(ui.run("isValidDate('2026-02-29')"), false);
});

test('leaving the sample view retains any real entries and water already in memory', () => {
  const ui = app(backup());
  ui.run('state.demo=true;leaveDemo()');
  assert.equal(ui.run('state.demo'), false);
  assert.equal(ui.run('state.entries.length'), 1);
  assert.equal(ui.run("state.water['2026-11-11']"), 750);
});

test('AI estimates use the shared form and save once with their image and AI marker', () => {
  const ui = app();
  ui.context.prefill = { ...meal, id: undefined, date: undefined, ai: true, image: 'data:image/jpeg;base64,/9j/AA==' };
  ui.run('openAnalysisForm(prefill)');
  const form = ui.nodes.get('#meal-form');
  assert.equal(form.elements.grams.value, '150');
  form.elements.grams.value = 300; form.elements.grams.fire('change');
  assert.equal(form.elements.kcal.value, '390');
  assert.equal(form.elements.protein.value, '8');
  form.elements.protein.value = 12;
  form.fire('submit');
  const entries = ui.json('state.entries');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].grams, 300);
  assert.equal(entries[0].protein, 12);
  assert.equal(entries[0].ai, true);
  assert.equal(entries[0].image, 'data:image/jpeg;base64,/9j/AA==');
  assert.ok(entries[0].id);
  assert.equal(ui.run('state.demo'), false);
  assert.equal(JSON.parse(ui.stored.get(scopedKey('test-user'))).entries.length, 1);
});

test('editing a meal preserves its date and ID instead of adding another record', () => {
  const ui = app(backup());
  ui.run("selectedDay='2026-11-12';openManual(state.entries[0])");
  const form = ui.nodes.get('#meal-form');
  form.elements.name.value = 'Reis mit Gemüse'; form.fire('submit');
  const entries = ui.json('state.entries');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, meal.id);
  assert.equal(entries[0].date, meal.date);
  assert.equal(entries[0].name, 'Reis mit Gemüse');
});

test('camera permission resolving after navigation stops tracks without reopening the view', async () => {
  let resolveCamera, stops = 0;
  const ui = app(null, { navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveCamera = resolve; }) } } });
  ui.run('openScan()');
  const pending = ui.run('startCamera()');
  ui.run("setView('dashboard')");
  resolveCamera({ getTracks: () => [{ stop: () => stops++ }] });
  await pending;
  assert.equal(stops, 1);
  assert.equal(ui.run('cameraStream'), null);
  assert.equal(ui.run('view'), 'dashboard');
});

test('a late photo-analysis response cannot replace a manually opened form', async () => {
  let resolveAnalysis;
  const ui = app(null, { fetch: (url) => url === '/api/config' ? Promise.resolve({ ok: true, json: async () => ({ aiAvailable: true }) }) : new Promise(resolve => { resolveAnalysis = resolve; }) });
  ui.run("openScan();aiAvailable=true;scanImage='data:image/jpeg;base64,/9j/AA=='");
  const pending = ui.run('analyzePhoto()');
  ui.run('openManual()');
  resolveAnalysis({ ok: true, json: async () => ({ name: 'Reis', items: [meal], confidence: 'medium', note: 'Schätzung' }) });
  await pending;
  assert.equal(ui.nodes.get('#modal-title').textContent, 'Etwas Gutes hinzufügen');
  assert.equal(ui.run('scanResult'), null);
  assert.equal(ui.run('abortAnalysis'), null);
});


test('scan navigation opens the full page with a labelled sample and no camera permission request', () => {
  let cameraRequests = 0;
  const ui = app(null, { navigator: { mediaDevices: { getUserMedia() { cameraRequests++; throw Error('not expected'); } } } });
  ui.run("setView('scan')");
  assert.equal(ui.run('view'), 'scan');
  assert.equal(ui.run('document.body.dataset.view'), 'scan');
  assert.equal(cameraRequests, 0);
  assert.match(ui.nodes.get('#scan-capture').innerHTML, /Beispielaufnahme/);
  assert.equal(ui.nodes.get('#scan-analyze').disabled, true);
  assert.equal(ui.run('scanImage'), '');
  assert.equal(ui.nodes.get('#modal').open, false);
});

test('sample photograph cannot be sent to AI or added to the diary', async () => {
  let analyses = 0;
  const ui = app(null, { fetch: async url => {
    if (url !== '/api/config') analyses++;
    return { ok: true, json: async () => ({ aiAvailable: true }) };
  } });
  ui.run("openScan();aiAvailable=true");
  await ui.run('analyzePhoto()');
  assert.equal(analyses, 0);
  assert.equal(ui.run('state.entries.length'), 0);
});

test('full-page analysis adopts a valid estimate once and returns home', async () => {
  const ui = app();
  ui.context.result = { name: 'Reis-Bowl', items: [meal], confidence: 'medium', note: 'Portion geschätzt.' };
  ui.run("openScan();scanImage='data:image/jpeg;base64,/9j/AA==';scanResult=result;showAnalysisResult()");
  assert.equal(ui.run('view'), 'analysis');
  assert.match(ui.nodes.get('#analysis-content').innerHTML, /Alles im Blick/);
  assert.match(ui.nodes.get('#analysis-content').innerHTML, /Übernehmen/);
  const first = ui.run('saveAnalysis()');
  const duplicate = ui.run('saveAnalysis()');
  await Promise.all([first, duplicate]);
  assert.equal(ui.run('state.entries.length'), 1);
  assert.equal(ui.run('state.entries[0].ai'), true);
  assert.equal(ui.run('view'), 'dashboard');
  assert.match(ui.nodes.get('#last-meal').innerHTML, /Reis-Bowl/);
});

test('unavailable AI is clearly explained on the scanning page', () => {
  const ui = app();
  ui.run("openScan();aiAvailable=false;scanImage='data:image/jpeg;base64,/9j/AA==';renderScan()");
  assert.equal(ui.nodes.get('#scan-analyze').disabled, true);
  assert.match(ui.nodes.get('#scan-status').textContent, /noch nicht aktiviert/);
  assert.match(ui.nodes.get('#scan-capture').innerHTML, /ausgewähltes Mahlzeitenfoto/);
  assert.doesNotMatch(ui.nodes.get('#scan-capture').innerHTML, /Beispielaufnahme/);
});


test('clicking an ordinary scan field does not route through body data-view', () => {
  const ui = app();
  ui.run("openScan();globalThis.navigationCalls=0;setView=()=>{navigationCalls++};document.listeners.click({target:{closest:selector=>selector.includes('button[')?null:document.body}})");
  assert.equal(ui.run('navigationCalls'), 0);
});

test('diary storage is isolated by the authenticated identity, including encoded user IDs', () => {
  const ownId = 'owner/ä:one';
  const otherKey = scopedKey('another-user');
  const other = backup(); other.entries[0].name = 'Private meal of another user';
  const ui = app(backup(), { metaUserId: ownId, storageSeed: { [otherKey]: other } });
  assert.equal(ui.run('state.entries[0].name'), 'Reis');
  ui.run('state.entries[0].name="Meine Mahlzeit";save()');
  assert.equal(JSON.parse(ui.stored.get(scopedKey(ownId))).entries[0].name, 'Meine Mahlzeit');
  assert.equal(JSON.parse(ui.stored.get(otherKey)).entries[0].name, 'Private meal of another user');
  assert.equal(ui.storageReads.includes(otherKey), false);
  assert.equal(ui.storageWrites.includes(otherKey), false);
});

test('legacy diary migrates once to the authenticated owner before removing the unscoped record', () => {
  const ui = app(null, { storageSeed: { 'nouri-diary-v1': backup() } });
  assert.equal(ui.run('state.entries.length'), 1);
  assert.equal(ui.stored.get('nouri-legacy-owner-v1'), 'test-user');
  assert.equal(ui.stored.has('nouri-diary-v1'), false);
  assert.equal(JSON.parse(ui.stored.get(scopedKey('test-user'))).entries[0].name, 'Reis');
});

test('a different account cannot claim or read the old owner’s legacy diary', () => {
  const legacy = backup();
  const ui = app(null, { metaUserId: 'new-owner', storageSeed: { 'nouri-diary-v1': legacy, 'nouri-legacy-owner-v1': 'old-owner' } });
  assert.equal(ui.run('state.entries.length'), 0);
  assert.equal(ui.storageReads.includes('nouri-diary-v1'), false);
  assert.equal(ui.stored.get('nouri-legacy-owner-v1'), 'old-owner');
  assert.equal(JSON.parse(ui.stored.get('nouri-diary-v1')).entries.length, 1);
});

test('anonymous startup and saving never access another user’s local records', () => {
  const seed = { [scopedKey('test-user')]: backup(), 'nouri-diary-v1': backup() };
  const ui = app(null, { metaUserId: null, storageSeed: seed });
  assert.equal(ui.run('state.entries.length'), 0);
  assert.equal(ui.run('save()'), false);
  assert.deepEqual(ui.storageReads, []);
  assert.deepEqual(ui.storageWrites, []);
  assert.equal(ui.stored.size, 2);
});

test('unknown optional nutrients remain missing on reload and in the daily summary', () => {
  const data = backup(); data.entries[0].fiber = null; data.entries[0].sugar = null;
  const ui = app(data);
  assert.equal(ui.run('storageCorrupt'), false);
  assert.equal(ui.run('state.entries[0].fiber'), null);
  assert.equal(ui.run('state.entries[0].sugar'), null);
  ui.run("selectedDay='2026-11-11';render()");
  const html = ui.nodes.get('#daily-details').innerHTML;
  assert.match(html, /Ballaststoffe/);
  assert.match(html, /keine Angabe|nicht erfasst|unbekannt|k\.\s*A\.|—/i);
  assert.doesNotMatch(html, /(?:Ballaststoffe|Davon Zucker)<\/span><strong>0(?:,0)?\s/);
});

test('core nutrient values cannot be absent, non-numeric or non-finite in restored meals', () => {
  const ui = app();
  for (const key of ['kcal', 'protein', 'carbs', 'fat']) {
    for (const invalid of [null, undefined, '20', NaN, Infinity]) {
      const data = backup(); data.entries[0][key] = invalid; ui.context.candidate = data;
      assert.throws(() => ui.run('validateImport(candidate)'), `${key}: ${String(invalid)}`);
    }
  }
});

test('the existing dashboard and three primary navigation destinations remain available', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const nav = html.match(/<nav class="bottom-nav[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.equal([...nav.matchAll(/class="nav-item(?: active)?"/g)].length, 3);
  for (const view of ['dashboard', 'scan', 'progress']) assert.match(nav, new RegExp(`data-view="${view}"`));
  const ui = app();
  for (const view of ['dashboard', 'diary', 'progress', 'scan']) {
    ui.context.next = view; ui.run('setView(next)');
    assert.equal(ui.run('view'), view);
    for (const candidate of ['dashboard', 'diary', 'progress', 'scan', 'analysis']) {
      assert.equal(ui.nodes.get(`#${candidate}-view`).classList.contains('hidden'), candidate !== view);
    }
  }
});

test('manually saved targets remain exact and lock calories and all three macros', () => {
  const ui = app(backup());
  ui.run('nutritionStore.targetLocks={kcal:false,protein:false,carbs:false,fat:false};openGoals()');
  const form = ui.nodes.get('#goals-form');
  const targets = { kcal: 2250, protein: 165, carbs: 210, fat: 75, water: 2500 };
  for (const [key, value] of Object.entries(targets)) form.elements[key].value = value;
  form.fire('submit');
  assert.deepEqual(ui.json('state.goals'), targets);
  assert.deepEqual(ui.json('nutritionStore.targetLocks'), { kcal: true, protein: true, carbs: true, fat: true });
  ui.run('render();renderCharts()');
  assert.deepEqual(ui.json('state.goals'), targets);
  const saved = JSON.parse(ui.stored.get('nouri-nutrition-v1:test-user'));
  assert.deepEqual(saved.targetLocks, { kcal: true, protein: true, carbs: true, fat: true });
});

test('changing a confirmed day’s intake invalidates that completion without changing other days', () => {
  const ui = app(backup());
  ui.run("nutritionStore.completeDays={'2026-11-11':true,'2026-11-10':true};saveNutrition();state.entries[0].kcal+=50;save()");
  assert.equal(ui.json('nutritionStore.completeDays')['2026-11-11'], undefined);
  assert.equal(ui.json('nutritionStore.completeDays')['2026-11-10'], true);
  const persisted = JSON.parse(ui.stored.get('nouri-nutrition-v1:test-user'));
  assert.equal(persisted.completeDays['2026-11-11'], undefined);
  assert.equal(persisted.completeDays['2026-11-10'], true);
});

test('export includes the current user’s nutrition data and preserves manual targets', async () => {
  let blob;
  class ExportURL extends URL {
    static createObjectURL(value) { blob = value; return 'blob:test-export'; }
    static revokeObjectURL() {}
  }
  const ui = app(backup(), { URL: ExportURL });
  ui.run("nutritionStore.profile={age:30,fitnessGoal:'recomposition'};nutritionStore.weightLogs=[{date:'2026-11-11',kg:70}];saveNutrition();exportData()");
  const exported = JSON.parse(await blob.text());
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.goals, backup().goals);
  assert.equal(exported.entries[0].name, 'Reis');
  assert.equal(exported.nutrition.version, 1);
  assert.equal(exported.nutrition.profile.fitnessGoal, 'recomposition');
  assert.deepEqual(exported.nutrition.weightLogs, [{ date: '2026-11-11', kg: 70 }]);
  assert.equal(ui.created.at(-1).clicked, true);
});

const sourcedBackup = () => {
  const data = backup();
  const values = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: null, sugar: 0.1 };
  const source = { name: 'Geprüfter Nährwertdatensatz', url: 'https://example.org/nutrition/rice', license: 'CC BY 4.0', recordId: 'rice-cooked-test' };
  data.entries = [{ ...meal, ...values, grams: 100, source, components: [{ id: 'component-1', foodId: 'rice-cooked-test', name: 'Reis, gekocht', grams: 100, cookingMethod: 'gekocht', confirmed: true, quantityEstimated: true, recognitionConfidence: 'high', quantityConfidence: 'medium', source: { ...source }, per100: { ...values } }] }];
  return data;
};

test('confirmed components retain their portions, preparation, source and uncertainty on reload', () => {
  const ui = app(sourcedBackup());
  assert.equal(ui.run('storageCorrupt'), false);
  const entry = ui.json('state.entries[0]');
  const component = entry.components[0];
  assert.equal(component.foodId, 'rice-cooked-test');
  assert.equal(component.grams, 100);
  assert.equal(component.cookingMethod, 'gekocht');
  assert.equal(component.recognitionConfidence, 'high');
  assert.equal(component.quantityConfidence, 'medium');
  assert.equal(component.confirmed, true);
  assert.equal(component.per100.fiber, null);
  assert.deepEqual(component.source, sourcedBackup().entries[0].components[0].source);
  assert.deepEqual(entry.source, sourcedBackup().entries[0].source);
  ui.run('save()');
  const reloaded = app(JSON.parse(ui.stored.get(scopedKey('test-user'))));
  assert.deepEqual(reloaded.json('state.entries[0]'), entry);
});

test('meal imports reject unconfirmed components, invented missing nutrients and tampered source totals', () => {
  const ui = app();
  const cases = [
    data => { data.entries[0].components[0].confirmed = false; },
    data => { data.entries[0].components[0].source.url = 'javascript:alert(1)'; },
    data => { data.entries[0].components[0].source.url = 'https://user:secret@example.org/food'; },
    data => { data.entries[0].components[0].per100.kcal = null; },
    data => { data.entries[0].components[0].grams = 50; },
    data => { data.entries[0].kcal = 1000; },
    data => { data.entries[0].fiber = 0; },
  ];
  for (const mutate of cases) {
    const candidate = sourcedBackup(); mutate(candidate); ui.context.candidate = candidate;
    assert.throws(() => ui.run('validateImport(candidate)'));
  }
});

test('manually changed sourced totals are labelled as manual without retaining misleading ingredient totals', () => {
  const ui = app(sourcedBackup());
  ui.run('openManual(state.entries[0])');
  const form = ui.nodes.get('#meal-form');
  assert.equal(form.elements.fiber.value, '');
  form.elements.grams.value = 200; form.elements.grams.fire('change');
  form.elements.kcal.value = 300; form.fire('submit');
  assert.equal(ui.run('state.entries.length'), 1);
  const entry = ui.json('state.entries[0]');
  assert.equal(entry.fiber, null);
  assert.equal(entry.kcal, 300);
  assert.equal(entry.components, undefined);
  assert.match(entry.source.name, /manuell/i);
  ui.context.candidate = JSON.parse(ui.stored.get(scopedKey('test-user')));
  assert.equal(ui.json('validateImport(candidate).entries').length, 1);
});

test('schema-2 photo detections route to ingredient confirmation and cannot use the legacy save shortcut', async () => {
  const ui = app();
  ui.context.detection = { schemaVersion: 2, name: 'Ungeprüfte Bowl', items: [{ id: 'detected-1', name: 'Reis', grams: 100, kcal: 9999, recognitionConfidence: 'high', quantityConfidence: 'low' }], note: 'Menge geschätzt.' };
  ui.run("globalThis.featureCalls=[];runNutrition=(...args)=>{featureCalls.push(args)};openScan();scanImage='data:image/jpeg;base64,/9j/AA==';scanResult=detection;showAnalysisResult()");
  assert.equal(ui.run('featureCalls.length'), 1);
  assert.equal(ui.run('featureCalls[0][0]'), 'showMealAnalysis');
  assert.equal(ui.run('featureCalls[0][1].schemaVersion'), 2);
  assert.equal(ui.run('state.entries.length'), 0);
  await ui.run('saveAnalysis()');
  assert.equal(ui.run('featureCalls.length'), 2);
  assert.equal(ui.run('state.entries.length'), 0);
  assert.equal(ui.stored.has(scopedKey('test-user')), false);
});
