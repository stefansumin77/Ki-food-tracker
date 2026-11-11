import { estimateMetabolism, approveMetabolismRecommendation } from './metabolism.js';

// Uses existing modal/form components. Opening a recommendation never writes targets.
export function initMetabolismUI(ctx) {
  const {showModal, closeModal, toast, icon, esc, fmt, getState, getDay, getStore, saveStore, saveState, render} = ctx;
  const $ = selector => document.querySelector(selector);
  const key = date => new Date(date).toISOString().slice(0, 10);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const round = value => Math.round(Number(value) || 0);
  const options = (rows, selected) => rows.map(([value, label]) => `<option value="${value}" ${value === String(selected ?? '') ? 'selected' : ''}>${label}</option>`).join('');
  const abortButton = '<button type="button" class="button secondary" id="metabolism-cancel">Zurück</button>';
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && key(value + 'T12:00:00Z') === value;
  const clone = value => structuredClone(value);
  function restore(target, snapshot) { for (const name of Object.keys(target)) delete target[name]; Object.assign(target, snapshot); }
  function storeChange(change) {
    const store = getStore(), snapshot = clone(store);
    change(store);
    if (saveStore() === false) {
      restore(store, snapshot);
      toast('Deine Änderung konnte nicht gespeichert werden. Bitte exportiere zunächst eine Sicherung.');
      return false;
    }
    return true;
  }
  function currentIntake() {
    const state = getState(), totals = new Map();
    if (!state.demo) for (const entry of state.entries || []) {
      if (validDate(entry.date) && Number.isFinite(entry.kcal)) totals.set(entry.date, (totals.get(entry.date) || 0) + entry.kcal);
    }
    return [...totals].map(([date, kcal]) => ({date, kcal, complete: getStore().completeDays?.[date] === true}));
  }
  function lastApproval() {
    const dates = (getStore().metabolismApprovals || []).map(row => row.at).filter(value => Number.isFinite(Date.parse(value)));
    return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  }
  function estimate() {
    return estimateMetabolism({
      profile: getStore().profile || {}, weightLogs: getStore().weightLogs || [],
      intakeDays: currentIntake(), currentTargets: clone(getState().goals),
      config: {asOf: today(), lastApprovedAt: lastApproval()},
    });
  }
  function open() {
    const result = estimate(), recommendation = result.recommendation;
    const level = {good: 'Gut auswertbar', limited: 'Eingeschränkt auswertbar', insufficient: 'Noch nicht ausreichend'}[result.reliability?.level] || 'Noch nicht ausreichend';
    const reasons = result.reliability?.reasons || [];
    const initial = result.initialEstimate, macro = result.macroGuidance;
    const macroNote = macro ? `<div class="form-note"><strong>Makroorientierung</strong><br>${fmt(macro.proteinG)} g Protein · ${fmt(macro.carbsG)} g Kohlenhydrate · ${fmt(macro.fatG)} g Fett bei deinem aktuellen Ziel von ${fmt(macro.kcalBudget)} kcal.<br>${esc(macro.method)}<br>Nur Orientierung: Deine manuell gesetzten Makroziele bleiben auch bei einer Kalorienanpassung erhalten. Du kannst sie bei Bedarf unter „Meine Ziele“ selbst ändern.</div>` : '';
    const initialValue = Number.isFinite(initial?.kcal) ? `${fmt(initial.kcal)} kcal` : initial?.range ? `${fmt(initial.range.min ?? initial.range[0])}–${fmt(initial.range.max ?? initial.range[1])} kcal` : 'Profil ergänzen';
    showModal('Dein Energiebedarf', `<p>Deine Entwicklung zählt. Die Berechnung verbindet vollständig erfasste Tage mit einem geglätteten Gewichtsverlauf.</p><div class="scan-result"><h3>${esc(level)}</h3><p>${esc(reasons.join(' '))}</p><div class="result-numbers"><div><strong>${esc(initialValue)}</strong>Erste Formel-Schätzung</div><div><strong>${Number.isFinite(result.observedTdee) ? fmt(result.observedTdee) + ' kcal' : '—'}</strong>Geschätzter täglicher Verbrauch</div><div><strong>${Number.isFinite(result.trend?.weeklyKg) ? fmt(result.trend.weeklyKg, 2) + ' kg' : '—'}</strong>Gewichtstrend / Woche</div></div></div>${(result.explanations || []).map(text => `<p class="form-note">${esc(text)}</p>`).join('')}${recommendation ? `<div class="scan-result"><h3>Vorschlag: ${fmt(recommendation.kcal)} kcal / Tag</h3><p>${esc(recommendation.reason)}</p><p>Aktuell: ${fmt(recommendation.baseKcal)} kcal. Änderung: ${recommendation.delta > 0 ? '+' : ''}${fmt(recommendation.delta)} kcal. Deine Makroziele bleiben unverändert.</p></div>` : '<p class="form-note">Deine aktuellen Kalorien- und Makroziele bleiben unverändert. Wenn die Datenlage ausreicht, erscheint hier gegebenenfalls ein Vorschlag.</p>'}${(result.safety || []).map(text => `<p class="form-note">${esc(text)}</p>`).join('')}${macroNote}<div class="settings-list"><button class="settings-row" id="metabolism-profile">${icon('target')}<div>Profil & Ziel<small>Alter, Größe, Aktivität und Fitnessziel</small></div></button><button class="settings-row" id="metabolism-weight">${icon('chart')}<div>Gewicht erfassen<small>Regelmäßige Messungen statt Tagesausschläge</small></div></button><button class="settings-row" id="metabolism-tracking">${icon('check')}<div>Vollständige Tage bestätigen<small>Nur bewusst bestätigte Tage werden ausgewertet</small></div></button></div><p class="form-note">Die Werte sind Schätzungen aus einer dokumentierten Formel, keine Messung des Stoffwechsels. Wasser, Erkrankungen oder veränderte Lebensumstände können den Verlauf beeinflussen. Es erfolgt keine automatische Zieländerung.</p><div class="form-actions"><button class="button secondary" id="metabolism-close">Schließen</button>${recommendation ? '<button class="button primary" id="metabolism-approve">Kalorienvorschlag übernehmen</button>' : ''}</div>`, 'DEINE ENTWICKLUNG');
    $('#metabolism-profile').onclick = openProfile;
    $('#metabolism-weight').onclick = () => openWeightLog();
    $('#metabolism-tracking').onclick = openTrackingDays;
    $('#metabolism-close').onclick = closeModal;
    if (recommendation) {
      // This snapshot makes approval a transaction against precisely the viewed target.
      const viewedTargets = clone(getState().goals), viewedRecommendation = clone(recommendation);
      $('#metabolism-approve').onclick = () => approve(viewedRecommendation, viewedTargets);
    }
  }
  function approve(recommendation, viewedTargets) {
    const state = getState(), store = getStore();
    if (state.goals.kcal !== viewedTargets.kcal) {
      toast('Dein Kalorienziel hat sich geändert. Bitte prüfe den neuen Vorschlag.'); open(); return;
    }
    let targets;
    try {
      targets = approveMetabolismRecommendation({recommendation, currentTargets: state.goals, profile: store.profile || {}, config: {asOf: today(), lastApprovedAt: lastApproval()}, approved: true});
    } catch {
      toast('Dieser Vorschlag ist nicht mehr aktuell. Bitte prüfe deine Daten erneut.'); open(); return;
    }
    const stateSnapshot = clone(state.goals), storeSnapshot = clone(store);
    state.goals = targets;
    store.metabolismApprovals ||= [];
    store.metabolismApprovals.push({at: new Date().toISOString(), from: stateSnapshot.kcal, to: targets.kcal});
    store.metabolismApprovals = store.metabolismApprovals.slice(-100);
    store.profile = {...store.profile, targetSource: 'adaptive'};
    store.targetLocks = {...store.targetLocks, kcal: false};
    if (saveState() === false || saveStore() === false) {
      state.goals = stateSnapshot; restore(store, storeSnapshot); saveState(); saveStore();
      toast('Dein Ziel konnte nicht zuverlässig gespeichert werden. Bitte prüfe die Speicherung.'); return;
    }
    render(); closeModal(); toast('Dein Kalorienziel wurde mit deiner Zustimmung angepasst. Makroziele bleiben erhalten.');
  }
  function openProfile() {
    const p = getStore().profile || {};
    showModal('Profil & Fitnessziel', `<p>Diese Angaben werden nur für deinen persönlichen Bedarf und deine Rezeptempfehlungen verwendet.</p><form id="metabolism-profile-form"><div class="form-grid"><label class="field">Alter (Jahre)<input name="age" type="number" min="18" max="90" step="1" required value="${Number.isFinite(p.age) ? p.age : ''}"></label><label class="field">Größe (cm)<input name="heightCm" type="number" min="120" max="230" step="0.1" required value="${Number.isFinite(p.heightCm) ? p.heightCm : ''}"></label><label class="field full">Geschlecht als Formelparameter<select name="sex">${options([['', 'Keine Angabe – Verbrauchsspanne anzeigen'], ['female', 'Weiblich'], ['male', 'Männlich']], p.sex)}</select></label><label class="field full">Alltagsaktivität<select name="activityLevel">${options([['sedentary', 'Überwiegend sitzend'], ['light', 'Leicht aktiv'], ['moderate', 'Mäßig aktiv'], ['high', 'Sehr aktiv']], p.activityLevel || 'sedentary')}</select></label><label class="field full">Dein Fitnessziel<select name="fitnessGoal">${options([['fat_loss', 'Körperfett reduzieren'], ['muscle_gain', 'Muskeln aufbauen'], ['recomposition', 'Körperzusammensetzung verbessern']], p.fitnessGoal || 'recomposition')}</select></label></div><p class="form-note">Die erste Formel-Schätzung braucht auch mindestens einen Gewichtseintrag. Dein bereits gesetztes Kalorienziel wird durch Profiländerungen nicht überschrieben.</p><div class="form-actions">${abortButton}<button class="button primary" type="submit">Profil speichern</button></div></form>`, 'DEIN PROFIL');
    $('#metabolism-cancel').onclick = open;
    $('#metabolism-profile-form').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const data = new FormData(form), age = Number(data.get('age')), heightCm = Number(data.get('heightCm'));
      if (!Number.isInteger(age) || age < 18 || age > 90 || heightCm < 120 || heightCm > 230) return;
      const updated = {...p, age, heightCm, sex: data.get('sex') || null, activityLevel: data.get('activityLevel'), fitnessGoal: data.get('fitnessGoal')};
      if (!storeChange(store => { store.profile = updated; })) return;
      toast('Dein Profil wurde gespeichert. Bestehende Ziele bleiben erhalten.'); open();
    };
  }
  function openWeightLog(selectedDate = getDay()) {
    const logs = getStore().weightLogs || [], row = logs.find(value => value.date === selectedDate), cutoff = today();
    const recent = logs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    showModal('Gewicht erfassen', `<p>Wiege dich möglichst unter ähnlichen Bedingungen. Einzelne Schwankungen ändern dein Ziel nicht.</p><form id="metabolism-weight-form"><div class="form-grid"><label class="field">Datum<input name="date" type="date" max="${cutoff}" required value="${esc(validDate(selectedDate) && selectedDate <= cutoff ? selectedDate : cutoff)}"></label><label class="field">Gewicht (kg)<input name="kg" type="number" min="30" max="350" step="0.1" required value="${row ? esc(row.kg) : ''}" placeholder="z. B. 72,5"></label></div><div class="form-actions">${abortButton}${row ? '<button class="button danger" type="button" id="metabolism-delete-weight">Löschen</button>' : ''}<button class="button primary" type="submit">Gewicht speichern</button></div></form>${recent.length ? `<div class="settings-list">${recent.map((value, index) => `<button class="settings-row" data-weight-row="${index}"><span>${esc(value.date)}</span><span>${fmt(value.kg, 1)} kg</span></button>`).join('')}</div>` : ''}`, 'DEIN VERLAUF');
    $('#metabolism-cancel').onclick = open;
    const form = $('#metabolism-weight-form');
    form.elements.date.onchange = () => openWeightLog(form.elements.date.value);
    form.onsubmit = event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const date = form.elements.date.value, kg = Number(form.elements.kg.value);
      if (!validDate(date) || date > today() || !Number.isFinite(kg) || kg < 30 || kg > 350) { toast('Bitte prüfe Datum und Gewicht.'); return; }
      if (!storeChange(store => { store.weightLogs = [...(store.weightLogs || []).filter(value => value.date !== date), {date, kg}].sort((a, b) => a.date.localeCompare(b.date)).slice(-3650); })) return;
      toast('Gewicht gespeichert.'); open();
    };
    if (row) $('#metabolism-delete-weight').onclick = () => {
      if (!storeChange(store => { store.weightLogs = (store.weightLogs || []).filter(value => value.date !== selectedDate); })) return;
      toast('Gewichtseintrag gelöscht.'); openWeightLog(selectedDate);
    };
    document.querySelectorAll('[data-weight-row]').forEach(button => { button.onclick = () => openWeightLog(recent[Number(button.dataset.weightRow)].date); });
  }
  function openTrackingDays() {
    const end = validDate(getDay()) && getDay() <= today() ? getDay() : today();
    const start = key(Date.parse(end + 'T12:00:00Z') - 41 * 86400000);
    const days = currentIntake().filter(day => day.date >= start && day.date <= end).sort((a, b) => b.date.localeCompare(a.date));
    showModal('Vollständig erfasste Tage', `<p>Bestätige nur Tage, an denen du wirklich alles erfasst hast – einschließlich Snacks, Getränken, Ölen und Saucen. Ein vorhandener Eintrag allein gilt nicht als vollständiger Tag.</p><form id="metabolism-days-form"><div class="settings-list">${days.length ? days.map((day, index) => `<label class="settings-row"><input type="checkbox" name="day-${index}" ${day.complete ? 'checked' : ''}><span>${esc(day.date)}<small>${fmt(day.kcal)} kcal erfasst</small></span></label>`).join('') : '<p class="form-note">In den letzten 42 Tagen gibt es noch keine eigenen Tagebucheinträge. Der Beispieltag wird nicht ausgewertet.</p>'}</div><p class="form-note">Nicht bestätigte und fehlende Tage werden nicht als null Kalorien behandelt. Eine lückenhafte Erfassung kann deshalb noch keinen belastbaren Verbrauch ergeben.</p><div class="form-actions">${abortButton}${days.length ? '<button class="button primary" type="submit">Bestätigungen speichern</button>' : ''}</div></form>`, 'VERLÄSSLICHE DATEN');
    $('#metabolism-cancel').onclick = open;
    $('#metabolism-days-form').onsubmit = event => {
      event.preventDefault(); const form = event.currentTarget;
      if (!storeChange(store => {
        store.completeDays ||= {};
        days.forEach((day, index) => { if (form.elements[`day-${index}`].checked) store.completeDays[day.date] = true; else delete store.completeDays[day.date]; });
      })) return;
      toast('Deine Tracking-Bestätigungen wurden gespeichert.'); open();
    };
  }
  return {open, openProfile, openWeightLog, openTrackingDays};
}
