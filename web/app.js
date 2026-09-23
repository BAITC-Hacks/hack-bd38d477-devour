const $ = selector => document.querySelector(selector);
const labels = {T1:'Разгрузка дорог',T2:'Доступность ОТ',E1:'Озеленение',E2:'Качество воздуха',S1:'Школы и детсады',S2:'Поликлиники',B1:'Безопасность улиц',B2:'Безопасность дорожного движения',C1:'Надёжность ЖКХ',C2:'Скорость решения обращений'};
const directions = {T:'Транспорт',E:'Экология',S:'Соцсфера',B:'Безопасность',C:'Сервисы'};
const analysisLabels = {summary:'Итог',strengths:'Сильные стороны',risks:'Риски',consequences:'Последствия',tradeoffs:'Компромиссы',recommendations:'Рекомендации'};
let state = null;
let decisions = [];
let revision = 0;
let valid = false;
let calculating = false;
let result = null;
let saved = [];
let optimal = [];
let events = [];
let selectedEvent = null;
let eventRevision = 0;
let optimizing = false;
let comparing = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU',{maximumFractionDigits:2}) : '—';
const signed = value => `${value > 0 ? '+' : ''}${num(value)}`;
const localizeNumbers = value => String(value ?? '').replace(/(?<![\p{L}\p{N}_./])([+-]?\d+)\.(\d+)(?![\p{L}\p{N}_]|\.\d)/gu,'$1,$2');
const displayText = value => esc(localizeNumbers(value));
const copy = value => JSON.parse(JSON.stringify(value));
const measureName = id => state.measures.find(item => item.id === id)?.name || id;
function notice(message = '') { $('#notice').textContent = localizeNumbers(message); $('#notice').hidden = !message; }
async function request(path, body, timeout = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {method:body === undefined ? 'GET' : 'POST',headers:body === undefined ? {} : {'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body),signal:controller.signal});
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail ?? data;
      const errors = detail?.errors;
      throw new Error(Array.isArray(errors) ? errors.join(' ') : typeof detail === 'string' ? detail : `Сервер вернул ошибку ${response.status}. Попробуйте ещё раз.`);
    }
    if (!data) throw new Error('API вернул пустой ответ. Проверьте работу сервера.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Попробуйте ещё раз.');
    if (error instanceof TypeError) throw new Error('Не удалось связаться с API. Проверьте, что сервер запущен, и повторите действие.');
    throw error;
  } finally { clearTimeout(timer); }
}
function page(id) {
  if (!document.getElementById(id)?.classList.contains('page')) id = 'city';
  document.querySelectorAll('.page').forEach(item => { item.hidden = item.id !== id; });
  document.querySelectorAll('nav button').forEach(item => { item.classList.toggle('active', item.dataset.page === id); item.setAttribute('aria-current',item.dataset.page === id ? 'page' : 'false'); });
  history.replaceState(null,'',`${location.pathname}${location.search}#${id}`);
}
function renderHeaderScore() {
  const simulation = result?.simulation;
  $('#base-score').textContent = num(simulation ? simulation.score : state.base_score);
  $('#hero-score-label').textContent = simulation ? localizeNumbers(`Последний расчёт · ${result.event?.name || 'без события'}`) : 'Базовый индекс · без события';
  const delta = $('#hero-score-delta');
  delta.hidden = !simulation;
  delta.textContent = simulation ? `${signed(simulation.delta)} к базе ${num(simulation.base_score)}` : '';
  delta.classList.toggle('positive',simulation?.delta > 0);
  delta.classList.toggle('negative',simulation?.delta < 0);
}
function renderCity() {
  renderHeaderScore();
  $('#districts').innerHTML = state.districts.map(district => `<article class="district"><h3>${esc(district.name)}</h3><small>${num(district.population * 100)}% населения</small>${Object.entries(labels).map(([id,label]) => { const value = district.indicators[id]; return `<div class="indicator ${value < 40 ? 'critical' : ''}"><div class="indicator-head"><span>${esc(label)}</span><strong>${num(value)}${value < 40 ? ' !' : ''}</strong></div><div class="meter"><span style="width:${Math.max(0,Math.min(100,Number(value) || 0))}%"></span></div></div>`; }).join('')}</article>`).join('');
}
function renderCatalog() {
  $('#catalog').innerHTML = Object.entries(directions).map(([direction,label]) => `<h3 class="direction-title">${label}</h3><div class="measure-grid">${state.measures.filter(item => item.direction === direction).map(item => {
    const selected = decisions.find(decision => decision.measure_id === item.id);
    return `<article class="measure ${selected ? 'selected' : ''}"><label class="check"><input type="checkbox" data-measure="${esc(item.id)}" ${selected ? 'checked' : ''}><span>${esc(item.name)}</span></label><div class="measure-meta"><span>${esc(item.id)} · ${item.type === 'C' ? 'Весь город' : 'Один район'}</span><strong>${num(item.cost)} ед. бюджета</strong></div><div class="effects">${Object.entries(item.effects).map(([id,value]) => `${esc(labels[id] || id)} ${signed(value)}`).join(' · ')}</div><small class="muted">Лаг: ${num(item.lag)} кв. Эффект учитывается с лагом.</small>${item.type === 'R' ? `<select data-district="${esc(item.id)}" aria-label="Район для меры ${esc(item.name)}" ${selected ? '' : 'disabled'}><option value="">Выберите район</option>${state.districts.map(district => `<option value="${esc(district.name)}" ${selected?.district === district.name ? 'selected' : ''}>${esc(district.name)}</option>`).join('')}</select>` : ''}</article>`;
  }).join('')}</div>`).join('');
}
function renderBudget(validation = null) {
  const cost = decisions.reduce((total,item) => total + (state.measures.find(measure => measure.id === item.measure_id)?.cost || 0),0);
  const budget = validation?.budget ?? availableBudget();
  $('#cost').textContent = num(cost);
  $('#budget').textContent = num(budget);
  $('#remaining').textContent = num(budget-cost);
  $('#remaining').classList.toggle('critical',cost > budget);
  $('#budget-bar').max = Math.max(1,budget);
  $('#budget-bar').value = Math.max(0,Math.min(cost,budget));
  $('#count').textContent = `${decisions.length} / 5`;
}
async function validateSelection() {
  const current = ++revision;
  valid = false;
  $('#calculate').disabled = true;
  renderBudget();
  $('#validation').textContent = 'Проверяем набор…';
  try {
    const validation = await request('/api/validate',{decisions:copy(decisions),event_id:selectedEvent?.id ?? null},15000);
    if (current !== revision) return;
    renderBudget(validation);
    valid = validation.valid === true;
    $('#validation').innerHTML = valid ? '<p class="success">Набор готов к расчёту.</p>' : `<ul>${validation.errors.map(error => `<li>${displayText(error)}</li>`).join('')}</ul>`;
    $('#calculate').disabled = !valid || calculating;
  } catch (error) { if (current === revision) $('#validation').innerHTML = `<p class="critical">${displayText(error.message)}</p><button id="retry-validation" class="secondary">Повторить проверку</button>`; }
}
function districtTable(simulation) {
  return `<div class="table-wrap"><table><thead><tr><th>Район</th><th>Оценка до → после</th>${Object.keys(labels).map(id => `<th title="${esc(labels[id])}">${id}</th>`).join('')}</tr></thead><tbody>${simulation.districts.map(district => `<tr><th>${esc(district.name)}</th><td>${num(district.score_before)} → ${num(district.score_after)}</td>${Object.keys(labels).map(id => `<td class="${district.after[id] < 40 ? 'critical' : ''}">${num(district.before[id])} → <strong>${num(district.after[id])}</strong></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">${Object.entries(labels).map(([id,label]) => `${id} — ${label}`).join('; ')}.</p>`;
}
function renderResult() {
  const simulation = result.simulation;
  renderHeaderScore();
  $('#result-content').className = '';
  $('#result-content').innerHTML = `${eventSummary(result.event,result.budget)}<div class="stats"><div class="stat"><span>Score: было → стало</span><strong>${num(simulation.base_score)} → ${num(simulation.score)}</strong><p class="delta">${signed(simulation.delta)} к базовому сценарию</p></div><div class="stat"><span>Бюджет программы</span><strong>${num(simulation.total_cost)} / ${num(result.budget)}</strong><p>Остаток: ${num(simulation.budget_left)}</p></div><div class="stat"><span>Критических показателей</span><strong>${num(simulation.n_crit)}</strong><p>Самый слабый район: ${esc(simulation.min_district.name)} (${num(simulation.min_district.score)})</p></div></div>${heatmaps(simulation)}<h3>Показатели районов: до → после</h3>${districtTable(simulation)}<h3>Вклад каждой меры в Score</h3><p class="muted">Разница между полным набором и набором без этой меры. Вклады могут пересекаться из-за синергий и порогов.</p><div class="table-wrap"><table><thead><tr><th>Мера</th><th>Район</th><th>Стоимость</th><th>Вклад</th></tr></thead><tbody>${simulation.contributions.map(item => `<tr><td>${esc(measureName(item.measure_id))}</td><td>${esc(item.district || 'Весь город')}</td><td>${num(item.cost)}</td><td>${signed(item.delta_score)}</td></tr>`).join('')}</tbody></table></div><h3>Сработавшие синергии</h3><div class="panel">${simulation.synergies.length ? simulation.synergies.map(item => `<p>${item.pair.map(esc).join(' + ')} · ${esc(item.district)} · ${esc(labels[item.indicator])} ${signed(item.bonus)}</p>`).join('') : 'В этом наборе нет синергий.'}</div><h3 style="margin-top:28px">Объяснение результата</h3><div id="analysis-content"><p role="status">Готовим анализ…</p></div>`;
  $('#report-button').disabled = true;
  $('#save-panel').hidden = false;
  $('#save-status').textContent = '';
  $('#scenario-name').value = `Сценарий ${saved.length+1}`;
  $('#save').disabled = saved.length >= 3;
}
function recommendationReplacement(item) {
  const replacement = item?.replace;
  const isDecision = decision => decision && typeof decision.measure_id === 'string' && (decision.district === null || typeof decision.district === 'string');
  return replacement && isDecision(replacement.from) && isDecision(replacement.to) ? replacement : null;
}
function analysisMarkup(data, interactive = false) {
  return `<span class="badge">${data.source === 'fallback' ? 'Шаблонный анализ · без AI' : 'Анализ AI'}</span><div class="analysis-grid">${Object.entries(analysisLabels).map(([key,label]) => {
    const value = data.analysis[key];
    let content;
    if (key === 'recommendations' && Array.isArray(value) && value.length && interactive) {
      content = `<ul class="recommendation-list">${value.map((item,index) => {
        const replacement = recommendationReplacement(item);
        return `<li class="recommendation-item"><p>${displayText(typeof item === 'string' ? item : item?.text || '')}</p><button data-recommendation="${index}" ${replacement ? '' : 'disabled'} aria-label="Применить рекомендацию ${num(index+1)}">Применить</button>${replacement ? '' : '<small>В ответе нет данных о замене меры. Автоматическое применение недоступно.</small>'}</li>`;
      }).join('')}</ul>`;
    } else {
      content = Array.isArray(value) ? value.length ? `<ul>${value.map(item => `<li>${displayText(typeof item === 'string' ? item : item?.text || '')}</li>`).join('')}</ul>` : '<p class="muted">Не отмечены в анализе.</p>' : `<p>${displayText(value)}</p>`;
    }
    return `<article class="panel"><h3>${label}</h3>${content}</article>`;
  }).join('')}</div>`;
}
function applyRecommendation(index) {
  if (!Number.isInteger(index) || index < 0) return;
  const replacement = recommendationReplacement(result?.analysis?.recommendations?.[index]);
  if (!replacement) { notice('В рекомендации нет данных для замены меры.'); return; }
  const matches = decisions.map((item,position) => item.measure_id === replacement.from.measure_id && item.district === replacement.from.district ? position : -1).filter(position => position >= 0);
  if (matches.length !== 1) { notice('Исходная мера из рекомендации уже изменена или отсутствует в текущем наборе. Рассчитайте программу заново, чтобы получить актуальные рекомендации.'); return; }
  decisions = decisions.map((item,position) => position === matches[0] ? {measure_id:replacement.to.measure_id,district:replacement.to.district} : item);
  notice();
  renderCatalog();
  page('decisions');
  validateSelection();
}
async function calculate() {
  if (!valid || calculating) return;
  calculating = true;
  $('#calculate').disabled = true;
  $('#calculate').textContent = 'Рассчитываем…';
  notice();
  const snapshot = {decisions:copy(decisions),event_id:selectedEvent?.id ?? null};
  const eventSnapshot = copy(selectedEvent);
  try {
    const simulation = await request('/api/simulate',snapshot);
    const calculated = {simulation,decisions:snapshot.decisions,event_id:snapshot.event_id,event:simulation.event ?? eventSnapshot,budget:simulation.budget ?? simulation.total_cost + simulation.budget_left,analysis:null,source:null,analysisError:null};
    result = calculated;
    renderResult();
    page('result');
    try {
      const explanation = await request('/api/explain',snapshot);
      calculated.analysis = explanation.analysis;
      calculated.source = explanation.source;
      $('#analysis-content').innerHTML = analysisMarkup(calculated,true);
    } catch (error) {
      calculated.analysisError = `Расчёт сохранён, но анализ недоступен. ${error.message}`;
      $('#analysis-content').innerHTML = `<p class="critical">${displayText(calculated.analysisError)}</p>`;
    } finally { $('#report-button').disabled = false; }
  } catch (error) { notice(error.message); }
  finally { calculating = false; $('#calculate').disabled = !valid; $('#calculate').textContent = 'Рассчитать результат →'; }
}
function decisionList(items) { return `<ul>${items.map(item => `<li>${esc(measureName(item.measure_id))} · ${esc(item.district || 'Весь город')}</li>`).join('')}</ul>`; }
function renderSaved() {
  $('#saved').innerHTML = saved.length ? saved.map((item,index) => `<article class="option"><h3>${esc(item.name)}</h3><strong>${num(item.simulation.score)}</strong><p class="muted">Стоимость: ${num(item.simulation.total_cost)} / ${num(item.budget)} · ${esc(item.event?.name || 'Без события')}</p>${decisionList(item.decisions)}<button data-remove="${index}" class="secondary">Удалить</button></article>`).join('') : '<div class="empty">Сохранённых сценариев пока нет.</div>';
  $('#compare-button').disabled = saved.length < 2 || comparing;
  $('#save').disabled = saved.length >= 3;
}
async function compare() {
  if (comparing || saved.length < 2) return;
  comparing = true;
  const button = $('#compare-button');
  button.disabled = true;
  button.textContent = 'Сравниваем…';
  notice();
  const snapshot = saved.map(({name,decisions,event_id}) => ({name,decisions:copy(decisions),event_id:event_id ?? null}));
  try {
    const data = await request('/api/compare',{scenarios:snapshot});
    if (JSON.stringify(snapshot) !== JSON.stringify(saved.map(({name,decisions,event_id}) => ({name,decisions,event_id:event_id ?? null})))) return;
    $('#comparison').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Сценарий</th><th>Событие</th><th>Score</th><th>Изменение</th><th>Стоимость</th><th>Критические показатели</th></tr></thead><tbody>${data.results.map((item,index) => `<tr><th>${esc(item.name)}</th><td>${esc(item.simulation.event?.name || saved[index]?.event?.name || 'Без события')}</td><td>${num(item.simulation.score)}</td><td>${signed(item.simulation.delta)}</td><td>${num(item.simulation.total_cost)}</td><td>${num(item.simulation.n_crit)}</td></tr>`).join('')}</tbody></table></div><p class="muted">При разных событиях исходные показатели и бюджет различаются. Дельта каждого сценария рассчитана относительно его собственной базы.</p><div class="panel"><span class="badge">${data.source === 'fallback' ? 'Шаблонный анализ · без AI' : 'Анализ AI'}</span><p>${displayText(data.analysis)}</p></div>`;
  } catch (error) { notice(error.message); }
  finally { comparing = false; button.disabled = saved.length < 2; button.textContent = 'Сравнить сценарии'; }
}
async function optimize() {
  if (optimizing || !state) return;
  optimizing = true;
  const current = eventRevision;
  const eventId = selectedEvent?.id ?? null;
  const button = $('#optimize');
  button.disabled = true;
  button.textContent = 'Ищем лучшие наборы…';
  notice();
  try {
    const query = new URLSearchParams({top:'5'});
    if (eventId) query.set('event_id',eventId);
    const data = await request(`/api/optimize?${query}`);
    if (current !== eventRevision) return;
    optimal = data;
    $('#optimal').innerHTML = optimal.map((item,index) => `<article class="option"><h3>Набор ${index+1}</h3><strong>Score ${num(item.score)}</strong><p class="muted">Стоимость: ${num(item.total_cost)} / ${num(availableBudget())} · ${esc(selectedEvent?.name || 'Без события')}</p>${decisionList(item.decisions)}<button data-load="${index}">Загрузить этот набор в решения</button></article>`).join('') || '<div class="empty">Подходящие наборы не найдены.</div>';
  } catch (error) { if (current === eventRevision) notice(error.message); }
  finally { optimizing = false; button.disabled = false; button.textContent = 'Найти лучший набор'; }
}
function availableBudget() { return state.budget - (selectedEvent?.budget_penalty ?? 0); }
function eventSummary(event, budget) {
  return event ? `<section class="panel event-context"><h3>Событие: ${esc(event.name)}</h3><p>${displayText(event.description)}</p><p>Затронутый район: <strong>${esc(event.district || 'Все районы')}</strong>. На ликвидацию: <strong>${num(event.budget_penalty)}</strong>. Доступный бюджет: <strong>${num(budget)}</strong>.</p><p class="muted">Базовый Score и показатели «до» уже учитывают событие.</p></section>` : `<p class="note event-context">Рассчитанный сценарий: без события · доступный бюджет ${num(budget)}.</p>`;
}
function renderEvents() {
  $('#no-event').setAttribute('aria-pressed',String(!selectedEvent));
  $('#active-event').textContent = selectedEvent ? `${selectedEvent.name} · на ликвидацию ${num(selectedEvent.budget_penalty)} · бюджет ${num(availableBudget())}` : `Без события · бюджет ${num(availableBudget())}`;
  $('#optimizer-context').textContent = `${selectedEvent?.name || 'Без события'} · бюджет ${num(availableBudget())}`;
  $('#event-list').innerHTML = events.map(event => `<article class="panel event-card ${selectedEvent?.id === event.id ? 'selected' : ''}"><h3>${esc(event.name)}</h3><p>${displayText(event.description)}</p><div class="event-meta"><span>Затронутый район: <strong>${esc(event.district || 'Все районы')}</strong></span><span>Штраф бюджета: <strong>−${num(event.budget_penalty)}</strong></span><span>Доступный бюджет: <strong>${num(state.budget-event.budget_penalty)}</strong></span></div><p class="effects">${Object.entries(event.effects || {}).map(([id,value]) => `${esc(labels[id] || id)} ${signed(value)}`).join(' · ')}</p><button data-event="${esc(event.id)}" aria-pressed="${selectedEvent?.id === event.id}">${selectedEvent?.id === event.id ? 'Выбрано' : 'Выбрать событие'}</button></article>`).join('');
}
function selectEvent(id) {
  if (!state) return;
  const event = id === null ? null : events.find(item => item.id === id);
  if (id !== null && !event) return;
  selectedEvent = event;
  eventRevision++;
  optimal = [];
  $('#optimal').innerHTML = '';
  renderEvents();
  validateSelection();
}
async function loadEvents() {
  if (!state) return;
  const button = $('#retry-events');
  button.disabled = true;
  $('#events-status').textContent = 'Загружаем события…';
  try {
    const data = await request('/api/events',undefined,10000);
    if (!Array.isArray(data) || data.some(event => !event || typeof event.id !== 'string' || typeof event.name !== 'string' || typeof event.budget_penalty !== 'number' || !Number.isFinite(event.budget_penalty) || event.budget_penalty < 0 || event.budget_penalty > state.budget)) throw new Error('Сервер вернул некорректный список событий.');
    events = data;
    if (selectedEvent) {
      const updated = events.find(event => event.id === selectedEvent.id);
      if (JSON.stringify(updated) !== JSON.stringify(selectedEvent)) selectEvent(updated?.id ?? null);
    }
    renderEvents();
    $('#events-status').textContent = events.length ? 'Выберите одно событие или продолжите без события.' : 'Событий пока нет. Можно продолжить без события.';
  } catch (error) {
    $('#events-status').textContent = `События временно недоступны. ${error.message} ${selectedEvent ? 'Ранее выбранное событие сохранено. Кнопка «Без события» вернёт базовый режим.' : 'Остальные разделы работают без события.'} Можно повторить загрузку.`;
  } finally { button.disabled = false; }
}
function heatColor(value) {
  const bounded = Math.max(0,Math.min(100,value));
  const hue = bounded < 40 ? 5 : 45 + (bounded-40)*85/60;
  return `hsl(${hue.toFixed(1)} 70% ${(75+bounded*0.15).toFixed(1)}%)`;
}
function heatmaps(simulation) {
  const keys = Object.keys(labels);
  const tables = ['before','after'].map(stage => `<div class="table-wrap" tabindex="0" role="region" aria-label="Тепловая карта ${stage === 'before' ? 'до мер' : 'после мер'}"><table class="heatmap"><caption>${stage === 'before' ? 'До мер' : 'После мер · дельта к исходному значению'}</caption><thead><tr><th scope="col">Район</th>${keys.map(id => `<th scope="col" title="${esc(labels[id])}">${id}</th>`).join('')}</tr></thead><tbody>${simulation.districts.map(district => `<tr><th scope="row">${esc(district.name)}</th>${keys.map(id => {
    const value = district[stage][id];
    const before = district.before[id];
    if (!Number.isFinite(value)) return '<td class="heat-missing">Нет данных</td>';
    const indicatorChange = Number.isFinite(before) ? value-before : null;
    const showChange = stage === 'after' && Number.isFinite(indicatorChange) && Math.abs(indicatorChange) >= 0.005;
    const description = `${district.name}, ${labels[id]}: ${num(value)}${showChange ? `; изменение ${signed(indicatorChange)}` : ''}${value < 40 ? '; ниже критического порога 40' : ''}`;
    return `<td class="${value < 40 ? 'heat-critical' : ''}" style="background-color:${heatColor(value)}" aria-label="${esc(description)}" title="${esc(description)}"><strong>${num(value)}${value < 40 ? ' !' : ''}</strong>${showChange ? `<small class="${indicatorChange > 0 ? 'heat-gain' : 'heat-loss'}">Δ ${signed(indicatorChange)}</small>` : ''}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  return `<section class="heatmap-section"><h3>Тепловая карта районов</h3><div class="heatmap-legend"><span class="heatmap-key"><span class="heatmap-swatch" aria-hidden="true"></span>Ниже 40 · критично</span><span class="heatmap-key">40 <span class="heatmap-gradient" aria-hidden="true"></span> 100 · лучше</span></div><p class="muted">${simulation.event ? 'Исходные значения уже учитывают событие. ' : ''}Дельта показывает изменение от мер. Значения и дельты округлены до двух знаков.</p>${tables}<p class="muted">${Object.entries(labels).map(([id,label]) => `${id} — ${label}`).join('; ')}.</p></section>`;
}
function reportMarkup(snapshot, title) {
  const simulation = snapshot.simulation;
  const measures = snapshot.decisions.map(item => {
    const contribution = simulation.contributions.find(row => row.measure_id === item.measure_id);
    return `<tr><td>${esc(measureName(item.measure_id))}</td><td>${esc(item.district || 'Весь город')}</td><td>${num(contribution?.cost ?? state.measures.find(measure => measure.id === item.measure_id)?.cost)}</td></tr>`;
  }).join('');
  const districts = simulation.districts.map(district => {
    const changes = Object.keys(labels).filter(id => Number.isFinite(district.after[id]) && Number.isFinite(district.before[id])).map(id => ({id,delta:district.after[id]-district.before[id]})).filter(item => Math.abs(item.delta) >= 0.005).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta)).slice(0,3);
    return `<tr><th scope="row">${esc(district.name)}</th><td>${num(district.score_before)} → ${num(district.score_after)}</td><td>${changes.length ? `<ul>${changes.map(item => `<li>${esc(labels[item.id])}: ${num(district.before[item.id])} → ${num(district.after[item.id])} (Δ ${signed(item.delta)})</li>`).join('')}</ul>` : 'Показатели не изменились.'}</td></tr>`;
  }).join('');
  return `<p class="eyebrow">АКИМ НА 5 ЧАСОВ · АСТАНА</p><h1>${esc(title)}</h1><p>Программа развития города на 8 кварталов</p>${eventSummary(snapshot.event,snapshot.budget)}<div class="stats"><div class="stat"><span>Score: было → стало</span><strong>${num(simulation.base_score)} → ${num(simulation.score)}</strong><p>Изменение: ${signed(simulation.delta)}</p></div><div class="stat"><span>Стоимость мер / бюджет</span><strong>${num(simulation.total_cost)} / ${num(snapshot.budget)}</strong><p>Остаток: ${num(simulation.budget_left)}</p></div><div class="stat"><span>Критических показателей</span><strong>${num(simulation.n_crit)}</strong><p>Самый слабый район: ${esc(simulation.min_district.name)} · ${num(simulation.min_district.score)}</p></div></div><h2>Выбранные меры</h2><table class="report-table"><thead><tr><th>Мера</th><th>Район</th><th>Стоимость</th></tr></thead><tbody>${measures}</tbody></table><h2>Главные изменения по районам</h2><p class="muted">До трёх самых больших изменений по модулю для каждого района. База сравнения учитывает выбранное событие.</p><table class="report-table"><thead><tr><th>Район</th><th>Оценка до → после</th><th>Изменения показателей</th></tr></thead><tbody>${districts}</tbody></table><h2>Анализ программы</h2>${snapshot.analysis ? analysisMarkup(snapshot) : `<p>${displayText(snapshot.analysisError || 'Анализ недоступен.')}</p>`}<p class="report-footer">Учебная модель. Числа считает движок, AI объясняет результат. Значения округлены до двух знаков.</p>`;
}
function openReport() {
  if (!result || $('#report-button').disabled) return;
  const snapshot = copy(result);
  const title = $('#scenario-name').value.trim() || 'Отчёт о программе развития города';
  const reportWindow = window.open('','_blank');
  if (!reportWindow) { notice('Не удалось открыть отчёт. Разрешите всплывающие окна для этого сайта и повторите действие.'); return; }
  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Аким на 5 часов</title><link rel="stylesheet" href="${esc(new URL('/styles.css',location.href).href)}"></head><body class="report-document"><main class="report-main"><div class="report-toolbar"><p>В окне печати выберите «Сохранить в PDF».</p><button id="print-report">Печать / сохранить в PDF</button></div>${reportMarkup(snapshot,title)}</main></body></html>`);
  reportWindow.document.close();
  reportWindow.document.getElementById('print-report').addEventListener('click',() => reportWindow.print());
  reportWindow.opener = null;
}
$('nav').addEventListener('click',event => { if (event.target.dataset.page) page(event.target.dataset.page); });
window.addEventListener('hashchange',() => page(location.hash.slice(1)));
$('#catalog').addEventListener('change',event => {
  const target = event.target;
  if (target.dataset.measure) {
    decisions = decisions.filter(item => item.measure_id !== target.dataset.measure);
    if (target.checked) decisions.push({measure_id:target.dataset.measure,district:null});
    const card = target.closest('.measure');
    card.classList.toggle('selected',target.checked);
    const select = card.querySelector('select');
    if (select) { select.disabled = !target.checked; select.value = ''; }
  }
  if (target.dataset.district) decisions.find(item => item.measure_id === target.dataset.district).district = target.value || null;
  validateSelection();
});
$('#validation').addEventListener('click',event => { if (event.target.id === 'retry-validation') validateSelection(); });
$('#clear').addEventListener('click',() => { if (!state) return; decisions = []; renderCatalog(); validateSelection(); });
$('#calculate').addEventListener('click',calculate);
$('#report-button').addEventListener('click',openReport);
$('#result-content').addEventListener('click',event => {
  const button = event.target.closest('button[data-recommendation]');
  if (button && !button.disabled) applyRecommendation(Number(button.dataset.recommendation));
});
$('#no-event').addEventListener('click',() => selectEvent(null));
$('#retry-events').addEventListener('click',loadEvents);
$('#event-list').addEventListener('click',event => {
  const button = event.target.closest('button[data-event]');
  if (button) selectEvent(button.dataset.event);
});
$('#demo').addEventListener('click',() => {
  if (!state) return;
  decisions = [{measure_id:'M7',district:'Нура'},{measure_id:'M8',district:'Нура'},{measure_id:'M10',district:'Нура'},{measure_id:'M12',district:null},{measure_id:'M5',district:'Сарыарка'}];
  renderCatalog();
  validateSelection();
});
$('#save').addEventListener('click',() => {
  if (!result || saved.length >= 3) return;
  const name = $('#scenario-name').value.trim() || `Сценарий ${saved.length+1}`;
  if (saved.some(item => item.name === name)) { $('#save-status').textContent = 'Выберите другое название: такое уже есть.'; return; }
  saved.push({...copy(result),name});
  renderSaved();
  $('#comparison').innerHTML = '';
  $('#save-status').textContent = `«${name}» сохранён. Сценариев: ${saved.length} / 3.`;
});
$('#saved').addEventListener('click',event => { if (event.target.dataset.remove !== undefined) { saved.splice(Number(event.target.dataset.remove),1); renderSaved(); $('#comparison').innerHTML = ''; } });
$('#compare-button').addEventListener('click',compare);
$('#optimize').addEventListener('click',() => { if (state) optimize(); });
$('#optimal').addEventListener('click',event => { if (event.target.dataset.load !== undefined) { const item = optimal[Number(event.target.dataset.load)]; if (!item) return; decisions = copy(item.decisions); renderCatalog(); validateSelection(); page('decisions'); } });
async function init() {
  $('#optimize').disabled = true;
  try {
    state = await request('/api/state',undefined,15000);
    renderCity();
    renderCatalog();
    renderSaved();
    renderEvents();
    $('#demo').disabled = false;
    $('#demo').title = 'Контрольный набор стоимостью 95. Выбранное событие сохраняется.';
    $('#no-event').disabled = false;
    $('#optimize').disabled = false;
    await Promise.all([validateSelection(),loadEvents()]);
  } catch (error) { notice(`${error.message} Обновите страницу после запуска сервера.`); $('#events-status').textContent = 'Список событий недоступен: сначала необходимо загрузить данные города.'; }
  finally { $('#loading').hidden = true; }
  page(location.hash.slice(1) || 'city');
}
init();
