/**
 * Deterministic, conservative adult energy-budget estimation.
 * Mifflin–St Jeor: Am J Clin Nutr. 1990;51:241–247, doi:10.1093/ajcn/51.2.241.
 * The 7,700 kcal/kg conversion is an approximation, not a physiological measurement.
 * Weekly medians + a Theil–Sen slope reduce (but do not remove) water-weight noise.
 * Incomplete days are NEVER zero-filled or silently called complete.
 */
const DAY_MS = 86400000;
const ACTIVITY = Object.freeze({ sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 });
const GOALS = new Set(['fat_loss', 'muscle_gain', 'recomposition']);
export const DEFAULT_METABOLISM_CONFIG = Object.freeze({
  windowDays: 28, minWindowDays: 28, minTrackingCoverage: 0.8,
  minWeightsPerWeek: 4, kcalPerKg: 7700, maxAdjustmentKcal: 100,
  maxAdjustmentFraction: 0.05, minKcal: 1500, maxKcal: 5000,
  cooldownDays: 14, recommendationValidDays: 7,
  lossProteinPerKg: 1.8, gainProteinPerKg: 1.6, recompProteinPerKg: 1.8, fatEnergyFraction: 0.3,
});
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const rounded = (n, increment = 1) => Math.round(n / increment) * increment;
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}
function dayNumber(date) { return Date.parse(date + 'T00:00:00Z') / DAY_MS; }
function dateFromDay(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function configuration(overrides = {}) {
  const c = { ...DEFAULT_METABOLISM_CONFIG };
  for (const key of Object.keys(c)) if (finite(overrides[key])) c[key] = overrides[key];
  c.windowDays = Math.round(clamp(c.windowDays, 28, 84));
  c.minWindowDays = Math.round(clamp(c.minWindowDays, 28, c.windowDays));
  c.minTrackingCoverage = clamp(c.minTrackingCoverage, 0.8, 1);
  c.minWeightsPerWeek = Math.round(clamp(c.minWeightsPerWeek, 4, 7));
  c.kcalPerKg = clamp(c.kcalPerKg, 6500, 8500);
  c.maxAdjustmentKcal = clamp(c.maxAdjustmentKcal, 25, 250);
  c.maxAdjustmentFraction = clamp(c.maxAdjustmentFraction, 0.01, 0.1);
  c.minKcal = clamp(c.minKcal, 1200, 2500);
  c.maxKcal = clamp(c.maxKcal, Math.max(3000, c.minKcal), 6000);
  c.cooldownDays = Math.round(clamp(c.cooldownDays, 14, 90));
  c.recommendationValidDays = Math.round(clamp(c.recommendationValidDays, 1, 7));
  for (const key of ['lossProteinPerKg', 'gainProteinPerKg', 'recompProteinPerKg']) c[key] = clamp(c[key], 1.6, 2);
  c.fatEnergyFraction = clamp(c.fatEnergyFraction, 0.2, 0.35);
  return c;
}
function initialRequirement(profile, weight) {
  if (!finite(weight) || !finite(profile.heightCm) || profile.heightCm < 120 || profile.heightCm > 230 ||
      !finite(profile.age) || profile.age < 18 || profile.age > 90 || !ACTIVITY[profile.activityLevel]) return null;
  const base = 10 * weight + 6.25 * profile.heightCm - 5 * profile.age;
  const factor = ACTIVITY[profile.activityLevel];
  if (profile.sex === 'female' || profile.sex === 'male') {
    const kcal = rounded((base + (profile.sex === 'male' ? 5 : -161)) * factor, 25);
    return { kcal, range: null, method: 'Mifflin–St Jeor × Aktivitätsfaktor', approximate: true };
  }
  return { kcal: null, range: [rounded((base - 161) * factor, 25), rounded((base + 5) * factor, 25)],
    method: 'Mifflin–St Jeor: Spanne ohne Geschlechtsangabe', approximate: true };
}
/** Optional orientation, not a prescription or a target update.
 * Protein factor selected inside the ISSN 1.4–2.0 g/kg/day exercise range
 * (Jäger et al. 2017, doi:10.1186/s12970-017-0177-8).
 * Default fat fraction 30% lies inside the adult 20–35% AMDR
 * (National Academies DRI, doi:10.17226/10490). Carbohydrates fill the budget.
 */
function macroOrientation(profile, latestMeasurement, kcalBudget, end, c) {
  if (!latestMeasurement || end - dayNumber(latestMeasurement.date) > 28 ||
      !finite(profile.age) || profile.age < 18 || profile.age > 90 ||
      !finite(profile.heightCm) || profile.heightCm < 120 || profile.heightCm > 230 ||
      !GOALS.has(profile.fitnessGoal) || !finite(kcalBudget) || kcalBudget < c.minKcal || kcalBudget > c.maxKcal) return null;
  const kg = latestMeasurement.kg;
  if (profile.fitnessGoal === 'fat_loss' && kg / ((profile.heightCm / 100) ** 2) < 18.5) return null;
  const factor = { fat_loss: c.lossProteinPerKg, muscle_gain: c.gainProteinPerKg, recomposition: c.recompProteinPerKg }[profile.fitnessGoal];
  const proteinG = Math.round(kg * factor), fatG = Math.round(kcalBudget * c.fatEnergyFraction / 9);
  const remaining = kcalBudget - proteinG * 4 - fatG * 9;
  if (remaining < 0) return null;
  const carbsG = Math.round(remaining / 4);
  return {
    proteinG, fatG, carbsG, kcalBudget, estimatedKcal: proteinG * 4 + carbsG * 4 + fatG * 9,
    proteinPerKg: factor, fatEnergyFraction: c.fatEnergyFraction, measuredWeightKg: kg,
    measuredOn: latestMeasurement.date, guidanceOnly: true, preservesManualTargets: true,
    method: `${factor} g Protein je kg, ${Math.round(c.fatEnergyFraction * 100)} % der aktuellen Kalorien aus Fett; übrige Energie aus Kohlenhydraten. Rundungen können wenige kcal abweichen.`,
    sources: [
      { name: 'ISSN Position Stand: Protein and Exercise (2017)', url: 'https://doi.org/10.1186/s12970-017-0177-8' },
      { name: 'Dietary Reference Intakes: Adult AMDR', url: 'https://doi.org/10.17226/10490' },
    ],
  };
}
function lastApprovalDay(value) {
  if (!value) return null;
  const date = String(value).slice(0, 10);
  return validDate(date) ? dayNumber(date) : null;
}
function recommendationId(values) {
  let hash = 2166136261;
  for (const char of values.join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 'metabolic-' + (hash >>> 0).toString(16);
}

export function estimateMetabolism({ profile = {}, weightLogs = [], intakeDays = [], currentTargets = {}, config = {} } = {}) {
  const c = configuration(config);
  // An explicit analysis date keeps historical results reproducible and unit tests deterministic.
  const asOf = validDate(config.asOf) ? config.asOf : new Date().toISOString().slice(0, 10);
  const end = dayNumber(asOf), start = end - c.windowDays + 1;
  const weightsByDate = new Map();
  for (const entry of Array.isArray(weightLogs) ? weightLogs : []) {
    if (entry && validDate(entry.date) && finite(entry.kg) && entry.kg >= 20 && entry.kg <= 450 && dayNumber(entry.date) <= end) {
      weightsByDate.set(entry.date, { date: entry.date, kg: entry.kg });
    }
  }
  const allWeights = [...weightsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const weights = allWeights.filter(w => dayNumber(w.date) >= start);
  const latestWeight = allWeights.at(-1)?.kg ?? (finite(profile.weightKg) ? profile.weightKg : null);
  const initialEstimate = initialRequirement(profile, latestWeight);
  const intakeByDate = new Map();
  for (const entry of Array.isArray(intakeDays) ? intakeDays : []) {
    if (entry && validDate(entry.date) && dayNumber(entry.date) >= start && dayNumber(entry.date) <= end &&
        finite(entry.kcal) && entry.kcal >= 0 && entry.kcal <= 15000 && entry.complete === true) intakeByDate.set(entry.date, entry);
  }
  const complete = [...intakeByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const coverage = complete.length / c.windowDays;
  const weekCount = Math.floor(c.windowDays / 7);
  const weekly = Array.from({ length: weekCount }, (_, i) => {
    const first = start + i * 7, last = first + 6;
    const sample = weights.filter(w => dayNumber(w.date) >= first && dayNumber(w.date) <= last);
    return { start: dateFromDay(first), end: dateFromDay(last), count: sample.length,
      medianKg: sample.length ? median(sample.map(w => w.kg)) : null, midpoint: first + 3 };
  });
  const supported = weekly.filter(w => w.count >= c.minWeightsPerWeek);
  const reasons = [];
  if (coverage < c.minTrackingCoverage) reasons.push(`Nur ${complete.length} von ${c.windowDays} Tagen wurden ausdrücklich als vollständig erfasst bestätigt.`);
  if (supported.length < weekCount) reasons.push(`Pro Woche werden mindestens ${c.minWeightsPerWeek} Gewichtseinträge benötigt; ${supported.length} von ${weekCount} Wochen erfüllen das.`);
  const firstEvidence = Math.min(...weights.map(w => dayNumber(w.date)), ...complete.map(d => dayNumber(d.date)));
  const evidenceSpan = Number.isFinite(firstEvidence) ? end - firstEvidence + 1 : 0;
  if (evidenceSpan < c.minWindowDays) reasons.push(`Für eine Anpassung sind mindestens ${c.minWindowDays} Tage Verlauf erforderlich.`);
  const result = {
    status: 'insufficient_data', initialEstimate, observedTdee: null,
    macroGuidance: macroOrientation(profile, allWeights.at(-1), currentTargets.kcal, end, c),
    trend: { weeklyKg: null, startKg: supported[0]?.medianKg ?? null, endKg: supported.at(-1)?.medianKg ?? null, weekly },
    reliability: { level: 'insufficient', reasons, trackingDays: complete.length, totalDays: c.windowDays, coverage,
      weightDays: weights.length, weeks: supported.length },
    recommendation: null,
    explanations: ['Einträge an nicht bestätigten Tagen werden nicht als vollständige Kalorienaufnahme behandelt.',
      'Gewichtstrends werden aus Wochenmedianen geglättet; Wasser, Verdauung und veränderte Körperzusammensetzung bleiben Unsicherheitsquellen.',
      'Die Energieumrechnung von 7.700 kcal je kg ist eine Näherung, keine Messung des Stoffwechsels.'],
    safety: [], asOf,
  };
  if (!finite(profile.age) || profile.age < 18 || profile.age > 90 || !GOALS.has(profile.fitnessGoal)) {
    result.status = 'profile_required'; result.reliability.reasons.push('Bitte ergänze Alter (18–90 Jahre) und Trainingsziel im Profil.'); return result;
  }
  if (!finite(currentTargets.kcal) || currentTargets.kcal < c.minKcal || currentTargets.kcal > c.maxKcal) {
    result.status = 'not_recommended'; result.safety.push('Dein aktuelles Kalorienziel liegt außerhalb der konfigurierten Anpassungsgrenzen. Es wird nicht automatisch angehoben oder abgesenkt.'); return result;
  }
  if (supported.length < weekCount || coverage < c.minTrackingCoverage || evidenceSpan < c.minWindowDays) return result;
  const slopes = [];
  for (let i = 0; i < supported.length; i++) for (let j = i + 1; j < supported.length; j++) {
    slopes.push((supported[j].medianKg - supported[i].medianKg) / (supported[j].midpoint - supported[i].midpoint));
  }
  const dailyKg = median(slopes), weeklyKg = dailyKg * 7;
  const trendWeight = median(supported.map(w => w.medianKg));
  result.trend.weeklyKg = rounded(weeklyKg, 0.01);
  if (Math.abs(weeklyKg) > Math.min(1.5, trendWeight * 0.015)) {
    result.reliability.reasons.push('Die Gewichtsänderung ist ungewöhnlich groß; mögliche Wasser- oder Messschwankungen verhindern eine verlässliche Anpassung.'); return result;
  }
  const meanIntake = complete.reduce((sum, day) => sum + day.kcal, 0) / complete.length;
  const estimate = meanIntake - dailyKg * c.kcalPerKg;
  if (!finite(estimate) || estimate < 1200 || estimate > 6000) {
    result.reliability.reasons.push('Die errechnete Energiespanne ist unplausibel. Bitte prüfe Gewichte und vollständige Mahlzeitenerfassung.'); return result;
  }
  result.observedTdee = rounded(estimate, 25);
  result.reliability.level = coverage >= 0.9 && weights.length >= weekCount * 5 ? 'good' : 'limited';
  if (coverage < 1) result.reliability.reasons.push('Einzelne Tage fehlen. Der Mittelwert der bestätigten Tage kann die tatsächliche Aufnahme verzerren.');
  result.explanations.push(`Durchschnitt der bestätigten Tage: ${rounded(meanIntake)} kcal. Geglätteter Gewichtstrend: ${weeklyKg >= 0 ? '+' : ''}${rounded(weeklyKg, 0.01)} kg pro Woche.`);
  if (finite(profile.heightCm) && profile.heightCm >= 120 && profile.heightCm <= 230 && profile.fitnessGoal === 'fat_loss' &&
      trendWeight / ((profile.heightCm / 100) ** 2) < 18.5) {
    result.status = 'not_recommended'; result.safety.push('Bei einem niedrigen Körpergewicht wird kein weiteres Kaloriendefizit vorgeschlagen.'); return result;
  }
  const lastDay = lastApprovalDay(config.lastApprovedAt);
  if (lastDay !== null && end - lastDay < c.cooldownDays) {
    result.status = 'cooldown'; result.safety.push(`Nach einer bestätigten Anpassung werden mindestens ${c.cooldownDays} Tage ohne weitere Änderung abgewartet.`); return result;
  }
  const targetWeeklyKg = profile.fitnessGoal === 'fat_loss' ? -trendWeight * 0.0035 : profile.fitnessGoal === 'muscle_gain' ? trendWeight * 0.001 : 0;
  const energyOffset = profile.fitnessGoal === 'fat_loss' ? Math.max(-350, targetWeeklyKg * c.kcalPerKg / 7) :
    profile.fitnessGoal === 'muscle_gain' ? Math.min(200, targetWeeklyKg * c.kcalPerKg / 7) : 0;
  const ideal = clamp(estimate + energyOffset, c.minKcal, c.maxKcal);
  const gap = ideal - currentTargets.kcal;
  const threshold = Math.max(50, currentTargets.kcal * 0.025);
  if (Math.abs(gap) < threshold) {
    result.status = 'not_recommended'; result.explanations.push('Dein aktuelles Kalorienziel liegt bereits nahe am aus dem Verlauf abgeleiteten Ziel. Keine Anpassung nötig.'); return result;
  }
  const limit = Math.min(c.maxAdjustmentKcal, currentTargets.kcal * c.maxAdjustmentFraction);
  const delta = Math.sign(gap) * Math.min(Math.abs(gap), limit);
  const nextKcal = clamp(Math.round(currentTargets.kcal + delta), c.minKcal, c.maxKcal);
  if (nextKcal === currentTargets.kcal) { result.status = 'not_recommended'; return result; }
  const goalText = { fat_loss: 'moderaten Fettverlust', muscle_gain: 'langsamen Muskelaufbau', recomposition: 'ein stabiles Gewicht bei Körperrekomposition' }[profile.fitnessGoal];
  result.status = 'ready';
  result.recommendation = {
    id: recommendationId([asOf, currentTargets.kcal, nextKcal, profile.fitnessGoal, result.observedTdee]),
    baseKcal: currentTargets.kcal, kcal: nextKcal, delta: nextKcal - currentTargets.kcal,
    reason: `Dein geglätteter Gewichtsverlauf und die bestätigte Kalorienaufnahme sprechen für einen ungefähren Tagesverbrauch von ${result.observedTdee} kcal. Für ${goalText} wird ein kleiner Schritt von ${nextKcal - currentTargets.kcal > 0 ? '+' : ''}${nextKcal - currentTargets.kcal} kcal vorgeschlagen.`,
    createdForDate: asOf, expiresAt: dateFromDay(end + c.recommendationValidDays), fitnessGoal: profile.fitnessGoal,
    requiresApproval: true, preservesManualMacros: true, macroTargets: null,
  };
  result.explanations.push('Manuelle Kalorien- und Makroziele bleiben unverändert, bis du diesen konkreten Kalorienvorschlag ausdrücklich bestätigst. Makroziele werden dabei nicht verändert.');
  return result;
}

/** Applies one approved, still-current recommendation without mutating its inputs. */
export function approveMetabolismRecommendation({ recommendation, currentTargets = {}, profile = {}, config = {}, approved = false } = {}) {
  const c = configuration(config), asOf = validDate(config.asOf) ? config.asOf : new Date().toISOString().slice(0, 10);
  if (approved !== true) throw new Error('Eine ausdrückliche Zustimmung ist erforderlich.');
  if (!recommendation || recommendation.requiresApproval !== true || !finite(recommendation.baseKcal) || !finite(recommendation.kcal) ||
      recommendation.baseKcal !== currentTargets.kcal) throw new Error('Dein Kalorienziel wurde inzwischen geändert. Bitte berechne den Vorschlag neu.');
  if (!validDate(recommendation.createdForDate) || !validDate(recommendation.expiresAt) || asOf < recommendation.createdForDate || asOf > recommendation.expiresAt) throw new Error('Dieser Vorschlag ist abgelaufen. Bitte berechne ihn neu.');
  if (!GOALS.has(profile.fitnessGoal) || recommendation.fitnessGoal !== profile.fitnessGoal || !finite(profile.age) || profile.age < 18 || profile.age > 90) throw new Error('Dein Profil wurde geändert. Bitte berechne den Vorschlag neu.');
  const delta = Math.abs(recommendation.kcal - currentTargets.kcal), limit = Math.min(c.maxAdjustmentKcal, currentTargets.kcal * c.maxAdjustmentFraction);
  if (recommendation.kcal < c.minKcal || recommendation.kcal > c.maxKcal || delta > Math.ceil(limit) || delta === 0 ||
      currentTargets.kcal < c.minKcal || currentTargets.kcal > c.maxKcal) throw new Error('Der Vorschlag überschreitet die erlaubten Anpassungsgrenzen.');
  const previous = lastApprovalDay(config.lastApprovedAt);
  if (previous !== null && dayNumber(asOf) - previous < c.cooldownDays) throw new Error('Seit der letzten Anpassung ist noch nicht genug Zeit vergangen.');
  return { ...currentTargets, kcal: recommendation.kcal };
}
