import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMetabolism, approveMetabolismRecommendation } from '../web/metabolism.js';

const asOf = '2026-11-11';
const profile = { heightCm: 180, age: 35, sex: 'male', activityLevel: 'moderate', fitnessGoal: 'fat_loss', targetSource: 'manual' };
const targets = { kcal: 2400, protein: 160, carbs: 240, fat: 75, water: 2500 };
const date = i => new Date(Date.parse(asOf + 'T00:00:00Z') - (27 - i) * 86400000).toISOString().slice(0, 10);
function history({ kcal = 2500, weeklyKg = 0, kilograms = 80 } = {}) {
  return {
    profile: { ...profile }, currentTargets: { ...targets }, config: { asOf },
    weightLogs: Array.from({ length: 28 }, (_, i) => ({ date: date(i), kg: kilograms + weeklyKg * i / 7 })),
    intakeDays: Array.from({ length: 28 }, (_, i) => ({ date: date(i), kcal, complete: true })),
  };
}
function approve(result, overrides = {}) {
  return approveMetabolismRecommendation({ recommendation: result.recommendation, currentTargets: targets,
    profile, config: { asOf }, approved: true, ...overrides });
}

test('initial requirement uses Mifflin St Jeor while sparse history never produces target changes', () => {
  const input = history(); input.weightLogs = [input.weightLogs[27]]; input.intakeDays = input.intakeDays.slice(20);
  const result = estimateMetabolism(input);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.initialEstimate.kcal, 2725);
  assert.equal(result.recommendation, null);
  assert.equal(result.observedTdee, null);
  assert.equal(result.reliability.level, 'insufficient');
});

test('unspecified sex produces an initial range rather than silently assuming a sex', () => {
  const input = history(); input.profile.sex = null;
  const result = estimateMetabolism(input);
  assert.equal(result.initialEstimate.kcal, null);
  assert.deepEqual(result.initialEstimate.range, [2475, 2725]);
});

test('a full stable multiweek history supports a modest loss recommendation without mutation', () => {
  const input = history(); const before = structuredClone(input);
  const result = estimateMetabolism(input);
  assert.equal(result.status, 'ready');
  assert.equal(result.observedTdee, 2500);
  assert.equal(result.trend.weeklyKg, 0);
  assert.equal(result.recommendation.kcal, 2300);
  assert.equal(result.recommendation.delta, -100);
  assert.equal(result.recommendation.requiresApproval, true);
  assert.equal(result.recommendation.macroTargets, null);
  assert.equal(result.reliability.level, 'good');
  assert.deepEqual(input, before);
  assert.deepEqual(estimateMetabolism(input), result);
});

test('energy expenditure accounts for smoothed weight loss using deterministic arithmetic', () => {
  const result = estimateMetabolism(history({ kcal: 2205, weeklyKg: -0.2 }));
  assert.equal(result.observedTdee, 2425);
  assert.equal(result.trend.weeklyKg, -0.2);
});

test('single daily water-weight spikes do not trigger a different recommendation', () => {
  const stable = history(); const noisy = structuredClone(stable);
  noisy.weightLogs[27].kg += 3.5;
  assert.equal(estimateMetabolism(noisy).observedTdee, estimateMetabolism(stable).observedTdee);
  assert.equal(estimateMetabolism(noisy).recommendation.kcal, estimateMetabolism(stable).recommendation.kcal);
});

test('unconfirmed and missing days are excluded, never filled with zero or called complete', () => {
  const input = history({ kcal: 2300 });
  input.intakeDays.slice(0, 6).forEach(day => { day.complete = false; day.kcal = 100; });
  const incomplete = estimateMetabolism(input);
  assert.equal(incomplete.status, 'insufficient_data');
  assert.equal(incomplete.reliability.trackingDays, 22);
  assert.equal(incomplete.observedTdee, null);
  input.intakeDays[0].complete = true; input.intakeDays[0].kcal = 2300;
  const enough = estimateMetabolism(input);
  assert.equal(enough.reliability.trackingDays, 23);
  assert.equal(enough.observedTdee, 2300);
  assert.equal(enough.reliability.level, 'limited');
});

test('weights must be distributed across every week instead of clustered in a short interval', () => {
  const input = history(); input.weightLogs = input.weightLogs.slice(7);
  const result = estimateMetabolism(input);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.reliability.weeks, 3);
  assert.equal(result.recommendation, null);
});

test('rapid multiweek shifts are treated as unreliable rather than causing aggressive adjustments', () => {
  const result = estimateMetabolism(history({ weeklyKg: -1.6 }));
  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.recommendation, null);
  assert.match(result.reliability.reasons.join(' '), /ungewöhnlich groß/);
});

test('muscle gain and recomposition have distinct deterministic energy objectives', () => {
  const gain = history({ kcal: 2400 }); gain.profile.fitnessGoal = 'muscle_gain'; gain.currentTargets.kcal = 2400;
  const recomp = structuredClone(gain); recomp.profile.fitnessGoal = 'recomposition';
  const a = estimateMetabolism(gain), b = estimateMetabolism(recomp);
  assert.equal(a.status, 'ready'); assert.ok(a.recommendation.kcal > 2400);
  assert.equal(b.status, 'not_recommended'); assert.equal(b.recommendation, null);
});

test('configurable change and calorie floors cap recommendations, including manual targets', () => {
  const input = history({ kcal: 3500 }); input.profile.fitnessGoal = 'recomposition';
  input.config.maxAdjustmentKcal = 75; input.config.maxAdjustmentFraction = 0.02;
  const result = estimateMetabolism(input);
  assert.equal(result.recommendation.delta, 48);
  const tooLow = history(); tooLow.currentTargets.kcal = 1000;
  assert.equal(estimateMetabolism(tooLow).status, 'not_recommended');
  assert.equal(estimateMetabolism(tooLow).recommendation, null);
});

test('low weight and nonadult profiles cannot receive a deficit recommendation', () => {
  const underweight = history({ kilograms: 50 }); underweight.profile.heightCm = 180;
  assert.equal(estimateMetabolism(underweight).status, 'not_recommended');
  const child = history(); child.profile.age = 16;
  assert.equal(estimateMetabolism(child).status, 'profile_required');
  assert.equal(estimateMetabolism(child).initialEstimate, null);
});

test('cooldown avoids reacting again shortly after an approved target change', () => {
  const input = history(); input.config.lastApprovedAt = '2026-11-05T09:00:00.000Z';
  const result = estimateMetabolism(input);
  assert.equal(result.status, 'cooldown'); assert.equal(result.recommendation, null);
});

test('approval requires explicit consent and applies calories only without mutating targets', () => {
  const result = estimateMetabolism(history());
  assert.throws(() => approve(result, { approved: false }), /Zustimmung/);
  const approved = approve(result);
  assert.equal(approved.kcal, 2300);
  assert.equal(targets.kcal, 2400);
  for (const key of ['protein', 'carbs', 'fat', 'water']) assert.equal(approved[key], targets[key]);
  assert.notEqual(approved, targets);
});

test('stale targets, changed goals, expired recommendations and out-of-bound changes are rejected', () => {
  const result = estimateMetabolism(history());
  assert.throws(() => approve(result, { currentTargets: { ...targets, kcal: 2500 } }), /inzwischen geändert/);
  assert.throws(() => approve(result, { profile: { ...profile, fitnessGoal: 'muscle_gain' } }), /Profil/);
  assert.throws(() => approve(result, { config: { asOf: '2026-11-19' } }), /abgelaufen/);
  assert.throws(() => approve(result, { recommendation: { ...result.recommendation, kcal: 1500 } }), /grenzen/i);
  assert.throws(() => approve(result, { config: { asOf, lastApprovedAt: '2026-11-08' } }), /nicht genug Zeit/);
});

test('invalid/future history rows are ignored and duplicate dates do not create fake coverage', () => {
  const input = history(); input.intakeDays = [input.intakeDays[0], input.intakeDays[0], { date: '2026-02-30', kcal: 2300, complete: true }, { date: '2026-11-12', kcal: 2300, complete: true }];
  input.weightLogs.push({ date: '2026-11-12', kg: 60 }, { date: '2026-11-11', kg: Number.NaN });
  const result = estimateMetabolism(input);
  assert.equal(result.reliability.trackingDays, 1);
  assert.equal(result.reliability.weightDays, 28);
  assert.equal(result.recommendation, null);
});

test('optional macro guidance is goal-specific deterministic arithmetic inside the current calorie budget', () => {
  const input = history();
  const guidance = estimateMetabolism(input).macroGuidance;
  assert.equal(guidance.proteinG, 144);
  assert.equal(guidance.fatG, 80);
  assert.equal(guidance.carbsG, 276);
  assert.equal(guidance.kcalBudget, 2400);
  assert.equal(guidance.estimatedKcal, 2400);
  assert.equal(guidance.guidanceOnly, true);
  assert.equal(guidance.preservesManualTargets, true);
  assert.equal(guidance.sources.length, 2);
  assert.deepEqual(estimateMetabolism(input).macroGuidance, guidance);
  const gain = history(); gain.profile.fitnessGoal = 'muscle_gain';
  assert.equal(estimateMetabolism(gain).macroGuidance.proteinG, 128);
  assert.deepEqual(input.currentTargets, targets);
});

test('macro guidance requires a recent measured weight, valid adult profile and a sensible budget', () => {
  const cases = [
    { ...history(), weightLogs: [], profile: { ...profile, weightKg: 80 } },
    { ...history(), profile: { ...profile, age: 17 } },
    { ...history(), profile: { ...profile, heightCm: null } },
    { ...history(), currentTargets: { ...targets, kcal: 900 } },
    history({ kilograms: 450 }),
  ];
  for (const input of cases) assert.equal(estimateMetabolism(input).macroGuidance, null);
  const stale = history(); stale.weightLogs = [{ date: '2026-09-01', kg: 80 }];
  assert.equal(estimateMetabolism(stale).macroGuidance, null);
});

test('macro configuration is bounded and approval still preserves every manual macro target', () => {
  const input = history(); input.config.lossProteinPerKg = 100; input.config.fatEnergyFraction = 0.9;
  const result = estimateMetabolism(input);
  assert.equal(result.macroGuidance.proteinPerKg, 2);
  assert.equal(result.macroGuidance.fatEnergyFraction, 0.35);
  const applied = approve(result);
  assert.equal(applied.protein, targets.protein);
  assert.equal(applied.carbs, targets.carbs);
  assert.equal(applied.fat, targets.fat);
  assert.notEqual(applied.fat, result.macroGuidance.fatG);
});
