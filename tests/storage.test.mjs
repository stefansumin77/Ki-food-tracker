import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureStore, defaultFeatureData, validateFeatureData } from '../web/feature-store.js';

function memory(initial = []) {
  const values = new Map(initial);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
const row = () => ({ id: 'inventory-1', name: 'Reis', foodId: 'rice', grams: 150, cookingMethod: 'gekocht', quantityEstimated: false, confirmed: true, food: { id: 'rice', name: 'Reis, gekocht', unit: 'g', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: .3, fiber: null, sugar: 0 }, source: { name: 'USDA', url: 'https://fdc.nal.usda.gov/', recordId: 'rice-record', license: 'public-domain' } } });
const data = () => ({ version: 1, ...defaultFeatureData(), inventory: [row()] });

test('feature data is isolated by authenticated user and never uses an anonymous namespace', () => {
  const storage = memory();
  assert.throws(() => createFeatureStore({ storage, userId: '' }));
  assert.throws(() => createFeatureStore({ storage }));
  const first = createFeatureStore({ storage, userId: 'user/one' });
  assert.equal(first.key, 'nouri-nutrition-v1:user%2Fone');
  first.get().inventory.push(row()); assert.equal(first.save(), true);
  const second = createFeatureStore({ storage, userId: 'user/two' });
  assert.deepEqual(second.get().inventory, []);
  assert.equal(createFeatureStore({ storage, userId: 'user/one' }).get().inventory.length, 1);
});

test('unknown nutritional values remain null while actual zero survives reload', () => {
  const storage = memory(), store = createFeatureStore({ storage, userId: 'one' });
  assert.equal(store.replace(data()), true);
  const restored = createFeatureStore({ storage, userId: 'one' }).get().inventory[0];
  assert.equal(restored.food.per100.fiber, null);
  assert.equal(restored.food.per100.sugar, 0);
  const unknown = { id: 'unknown', foodId: null, name: 'Behälter mit Suppe', grams: null, food: null, confirmed: true, quantityEstimated: true };
  store.get().inventory.push(unknown); assert.equal(store.save(), true);
  assert.equal(store.get().inventory[1].food, null); assert.equal(store.get().inventory[1].grams, null);
});

test('raw photos, credentials and unknown attributes are stripped at the persistence boundary', () => {
  const input = data(); input.OPENAI_API_KEY = 'not-stored'; input.inventory[0].image = 'data:image/png;base64,raw'; input.inventory[0].food.image = 'https://photo.example/'; input.profile.email = 'not-stored';
  const cleaned = validateFeatureData(input), serialized = JSON.stringify(cleaned);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY|not-stored|data:image|photo\.example/);
  assert.equal(cleaned.inventory[0].cookingMethod, 'gekocht');
});

test('invalid numbers, dates, duplicate rows, insecure sources and unsupported versions are rejected', () => {
  const mutations = [
    value => { value.inventory[0].food.per100.protein = NaN; },
    value => { value.inventory[0].food.per100.kcal = Infinity; },
    value => { value.inventory[0].grams = -1; },
    value => { value.inventory.push(structuredClone(value.inventory[0])); },
    value => { value.inventory[0].food.source.url = 'http://insecure.example/'; },
    value => { value.inventory[0].food.source.url = 'https://user:pass@source.example/'; },
    value => { value.weightLogs = [{ date: '2026-02-30', kg: 80 }]; },
    value => { value.weightLogs = [{ date: '2026-11-11', kg: 80 }, { date: '2026-11-11', kg: 81 }]; },
    value => { value.completeDays['2026-11-11'] = 1; },
    value => { value.profile.age = 12; },
    value => { value.version = 2; },
  ];
  for (const mutate of mutations) { const input = data(); mutate(input); assert.throws(() => validateFeatureData(input)); }
});

test('reusable corrections require explicit consent and retain only allowed correction fields', () => {
  const input = data(); input.corrections = [{ id: 'correction-1', consent: false, originalName: 'Reis' }];
  assert.throws(() => validateFeatureData(input));
  input.corrections[0] = { id: 'correction-1', consent: true, at: '2026-11-11T12:00:00.000Z', originalName: 'Reis', foodId: 'rice', grams: 150, cookingMethod: 'gekocht', photo: 'do not retain' };
  const clean = validateFeatureData(input).corrections[0];
  assert.equal(clean.consent, true); assert.equal(clean.grams, 150); assert.equal(clean.photo, undefined);
});

test('malformed stored data is reported without overwriting the original raw data', () => {
  const storage = memory([['nouri-nutrition-v1:one', '{broken']]);
  const store = createFeatureStore({ storage, userId: 'one' });
  assert.ok(store.error); assert.deepEqual(store.get().inventory, []);
  assert.equal(storage.getItem(store.key), '{broken');
  assert.throws(() => store.replace({ version: 2 }));
  assert.equal(storage.getItem(store.key), '{broken');
});

test('deletion removes only the current account feature namespace', () => {
  const storage = memory(), first = createFeatureStore({ storage, userId: 'one' }), second = createFeatureStore({ storage, userId: 'two' });
  first.replace(data()); second.replace(data());
  storage.setItem('nouri-diary-v1:one', 'existing-diary');
  assert.equal(first.clear(), true);
  assert.equal(storage.getItem(first.key), null);
  assert.notEqual(storage.getItem(second.key), null);
  assert.equal(storage.getItem('nouri-diary-v1:one'), 'existing-diary');
  assert.deepEqual(first.get().inventory, []);
});

test('quota errors return false and an invalid mutable store does not replace the previous saved copy', () => {
  const storage = memory(), store = createFeatureStore({ storage, userId: 'one' }); store.replace(data());
  const before = storage.getItem(store.key); store.get().inventory[0].grams = Infinity;
  assert.equal(store.save(), false); assert.equal(storage.getItem(store.key), before); assert.ok(store.error);
  const failing = { getItem: () => null, setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('denied'); } };
  const blocked = createFeatureStore({ storage: failing, userId: 'one' });
  assert.equal(blocked.save(), false); assert.equal(blocked.clear(), false);
});

test('export is a validated copy and preserves approved calorie changes and manual target locks', () => {
  const storage = memory(), store = createFeatureStore({ storage, userId: 'one' });
  store.get().profile = { heightCm: 180, age: 30, sex: 'male', activityLevel: 'moderate', fitnessGoal: 'fat_loss', targetSource: 'adaptive' };
  store.get().metabolismApprovals = [{ at: '2026-11-11T12:00:00.000Z', from: 2000, to: 1900 }];
  store.get().targetLocks.kcal = false; assert.equal(store.save(), true);
  const exported = store.export(); assert.equal(exported.version, 1); assert.equal(exported.targetLocks.kcal, false); assert.equal(exported.targetLocks.protein, true);
  exported.metabolismApprovals[0].to = 1500; assert.equal(store.get().metabolismApprovals[0].to, 1900);
});

test('unknown or conflicting nutrition bases remain unknown and cannot persist assumed inventory grams', () => {
  const input = data();
  Object.assign(input.inventory[0].food, { unit: 'unknown', nutritionBasis: 'unknown', per100Basis: 'unknown' });
  input.inventory[0].grams = null;
  const store = createFeatureStore({ storage: memory(), userId: 'basis-user' });
  assert.equal(store.replace(input), true);
  const product = store.export().inventory[0].food;
  assert.equal(product.unit, 'unknown'); assert.equal(product.nutritionBasis, 'unknown'); assert.equal(product.per100Basis, 'unknown');
  input.inventory[0].grams = 250;
  assert.throws(() => validateFeatureData(input), /Unbekannte Nährwertbasis/);
  const conflicting = data();
  Object.assign(conflicting.inventory[0].food, { unit: 'g', nutritionBasis: '100g', per100Basis: '100ml' });
  conflicting.inventory[0].grams = null;
  assert.equal(validateFeatureData(conflicting).inventory[0].food.unit, 'unknown');
});
