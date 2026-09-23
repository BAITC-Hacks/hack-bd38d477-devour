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
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU',{maximumFractionDigits:2}) : '—';
const signed = value => `${value > 0 ? '+' : ''}${num(value)}`;
const copy = value => JSON.parse(JSON.stringify(value));
const measureName = id => state.measures.find(item => item.id === id)?.name || id;
function notice(message = '') { $('#notice').textContent = message; $('#notice').hidden = !message; }
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
function renderCity() {
  $('#base-score').textContent = num(state.base_score);
  $('#districts').innerHTML = state.districts.map(district => `<article class="district"><h3>${esc(district.name)}</h3><small>${num(district.population * 100)}% населения</small>${Object.entries(labels).map(([id,label]) => { const value = district.indicators[id]; return `<div class="indicator ${value < 40 ? 'critical' : ''}"><div class="indicator-head"><span>${esc(label)}</span><strong>${num(value)}${value < 40 ? ' !' : ''}</strong></div><div class="meter"><span style="width:${Math.max(0,Math.min(100,Number(value) || 0))}%"></span></div></div>`; }).join('')}</article>`).join('');
}
function renderCatalog() {
  $('#catalog').innerHTML = Object.entries(directions).map(([direction,label]) => `<h3 class="direction-title">${label}</h3><div class="measure-grid">${state.measures.filter(item => item.direction === direction).map(item => {
    const selected = decisions.find(decision => decision.measure_id === item.id);
    return `<article class="measure ${selected ? 'selected' : ''}"><label class="check"><input type="checkbox" data-measure="${esc(item.id)}" ${selected ? 'checked' : ''}><span>${esc(item.name)}</span></label><div class="measure-meta"><span>${esc(item.id)} · ${item.type === 'C' ? 'Весь город' : 'Один район'}</span><strong>${num(item.cost)} ед. бюджета</strong></div><div class="effects">${Object.entries(item.effects).map(([id,value]) => `${esc(labels[id] || id)} ${signed(value)}`).join(' · ')}</div><small class="muted">Лаг: ${num(item.lag)} кв. Эффект учитывается с лагом.</small>${item.type === 'R' ? `<select data-district="${esc(item.id)}" aria-label="Район для меры ${esc(item.name)}" ${selected ? '' : 'disabled'}><option value="">Выберите район</option>${state.districts.map(district => `<option value="${esc(district.name)}" ${selected?.district === district.name ? 'selected' : ''}>${esc(district.name)}</option>`).join('')}</select>` : ''}</article>`;
  }).join('')}</div>`).join('');
}
function renderBudget() {
  const cost = decisions.reduce((total,item) => total + (state.measures.find(measure => measure.id === item.measure_id)?.cost || 0),0);
  $('#cost').textContent = num(cost);
  $('#budget').textContent = num(state.budget);
  $('#remaining').textContent = num(state.budget-cost);
  $('#remaining').classList.toggle('critical',cost > state.budget);
  $('#budget-bar').max = state.budget;
  $('#budget-bar').value = Math.min(cost,state.budget);
  $('#count').textContent = `${decisions.length} / 5`;
}
async function validateSelection() {
  const current = ++revision;
  valid = false;
  $('#calculate').disabled = true;
  renderBudget();
  $('#validation').textContent = 'Проверяем набор…';
  try {
    const validation = await request('/api/validate',{decisions:copy(decisions)},15000);
    if (current !== revision) return;
    valid = validation.valid === true;
    $('#validation').innerHTML = valid ? '<p class="success">Набор готов к расчёту.</p>' : `<ul>${validation.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul>`;
    $('#calculate').disabled = !valid || calculating;
  } catch (error) { if (current === revision) $('#validation').innerHTML = `<p class="critical">${esc(error.message)}</p><button id="retry-validation" class="secondary">Повторить проверку</button>`; }
}
function districtTable(simulation) {
  return `<div class="table-wrap"><table><thead><tr><th>Район</th><th>Оценка до → после</th>${Object.keys(labels).map(id => `<th title="${esc(labels[id])}">${id}</th>`).join('')}</tr></thead><tbody>${simulation.districts.map(district => `<tr><th>${esc(district.name)}</th><td>${num(district.score_before)} → ${num(district.score_after)}</td>${Object.keys(labels).map(id => `<td class="${district.after[id] < 40 ? 'critical' : ''}">${num(district.before[id])} → <strong>${num(district.after[id])}</strong></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">${Object.entries(labels).map(([id,label]) => `${id} — ${label}`).join('; ')}.</p>`;
}
function renderResult() {
  const simulation = result.simulation;
  $('#result-content').className = '';
  $('#result-content').innerHTML = `<div class="stats"><div class="stat"><span>Score: было → стало</span><strong>${num(simulation.base_score)} → ${num(simulation.score)}</strong><p class="delta">${signed(simulation.delta)} к базовому сценарию</p></div><div class="stat"><span>Бюджет программы</span><strong>${num(simulation.total_cost)} / ${num(state.budget)}</strong><p>Остаток: ${num(simulation.budget_left)}</p></div><div class="stat"><span>Критических показателей</span><strong>${num(simulation.n_crit)}</strong><p>Самый слабый район: ${esc(simulation.min_district.name)} (${num(simulation.min_district.score)})</p></div></div><h3>Показатели районов: до → после</h3>${districtTable(simulation)}<h3>Вклад каждой меры в Score</h3><p class="muted">Разница между полным набором и набором без этой меры. Вклады могут пересекаться из-за синергий и порогов.</p><div class="table-wrap"><table><thead><tr><th>Мера</th><th>Район</th><th>Стоимость</th><th>Вклад</th></tr></thead><tbody>${simulation.contributions.map(item => `<tr><td>${esc(measureName(item.measure_id))}</td><td>${esc(item.district || 'Весь город')}</td><td>${num(item.cost)}</td><td>${signed(item.delta_score)}</td></tr>`).join('')}</tbody></table></div><h3>Сработавшие синергии</h3><div class="panel">${simulation.synergies.length ? simulation.synergies.map(item => `<p>${item.pair.map(esc).join(' + ')} · ${esc(item.district)} · ${esc(labels[item.indicator])} ${signed(item.bonus)}</p>`).join('') : 'В этом наборе нет синергий.'}</div><h3 style="margin-top:28px">Объяснение результата</h3><div id="analysis-content"><p role="status">Готовим анализ…</p></div>`;
  $('#save-panel').hidden = false;
  $('#save-status').textContent = '';
  $('#scenario-name').value = `Сценарий ${saved.length+1}`;
  $('#save').disabled = saved.length >= 3;
}
function renderAnalysis(data) {
  $('#analysis-content').innerHTML = `<span class="badge">${data.source === 'fallback' ? 'Шаблонный анализ · без AI' : 'Анализ AI'}</span><div class="analysis-grid">${Object.entries(analysisLabels).map(([key,label]) => { const value = data.analysis[key]; return `<article class="panel"><h3>${label}</h3>${Array.isArray(value) ? value.length ? `<ul>${value.map(item => `<li>${esc(typeof item === 'string' ? item : item?.text || '')}</li>`).join('')}</ul>` : '<p class="muted">Не отмечены в анализе.</p>' : `<p>${esc(value)}</p>`}</article>`; }).join('')}</div>`;
}
async function calculate() {
  if (!valid || calculating) return;
  calculating = true;
  $('#calculate').disabled = true;
  $('#calculate').textContent = 'Рассчитываем…';
  notice();
  const snapshot = copy(decisions);
  try {
    const simulation = await request('/api/simulate',{decisions:snapshot});
    result = {simulation,decisions:snapshot};
    renderResult();
    page('result');
    try { renderAnalysis(await request('/api/explain',{decisions:snapshot})); }
    catch (error) { $('#analysis-content').innerHTML = `<p class="critical">Расчёт сохранён, но анализ недоступен. ${esc(error.message)}</p>`; }
  } catch (error) { notice(error.message); }
  finally { calculating = false; $('#calculate').disabled = !valid; $('#calculate').textContent = 'Рассчитать результат →'; }
}
function decisionList(items) { return `<ul>${items.map(item => `<li>${esc(measureName(item.measure_id))} · ${esc(item.district || 'Весь город')}</li>`).join('')}</ul>`; }
function renderSaved() {
  $('#saved').innerHTML = saved.length ? saved.map((item,index) => `<article class="option"><h3>${esc(item.name)}</h3><strong>${num(item.simulation.score)}</strong><p class="muted">Стоимость: ${num(item.simulation.total_cost)}</p>${decisionList(item.decisions)}<button data-remove="${index}" class="secondary">Удалить</button></article>`).join('') : '<div class="empty">Сохранённых сценариев пока нет.</div>';
  $('#compare-button').disabled = saved.length < 2;
  $('#save').disabled = saved.length >= 3;
}
async function compare() {
  const button = $('#compare-button');
  button.disabled = true;
  button.textContent = 'Сравниваем…';
  notice();
  const snapshot = saved.map(({name,decisions}) => ({name,decisions:copy(decisions)}));
  try {
    const data = await request('/api/compare',{scenarios:snapshot});
    if (JSON.stringify(snapshot) !== JSON.stringify(saved.map(({name,decisions}) => ({name,decisions})))) return;
    $('#comparison').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Сценарий</th><th>Score</th><th>Изменение</th><th>Стоимость</th><th>Критические показатели</th></tr></thead><tbody>${data.results.map(item => `<tr><th>${esc(item.name)}</th><td>${num(item.simulation.score)}</td><td>${signed(item.simulation.delta)}</td><td>${num(item.simulation.total_cost)}</td><td>${num(item.simulation.n_crit)}</td></tr>`).join('')}</tbody></table></div><div class="panel"><span class="badge">${data.source === 'fallback' ? 'Шаблонный анализ · без AI' : 'Анализ AI'}</span><p>${esc(data.analysis)}</p></div>`;
  } catch (error) { notice(error.message); }
  finally { button.disabled = saved.length < 2; button.textContent = 'Сравнить сценарии'; }
}
async function optimize() {
  const button = $('#optimize');
  button.disabled = true;
  button.textContent = 'Ищем лучшие наборы…';
  notice();
  try {
    optimal = await request('/api/optimize?top=5');
    $('#optimal').innerHTML = optimal.map((item,index) => `<article class="option"><h3>Набор ${index+1}</h3><strong>Score ${num(item.score)}</strong><p class="muted">Стоимость: ${num(item.total_cost)}</p>${decisionList(item.decisions)}<button data-load="${index}">Загрузить этот набор в решения</button></article>`).join('') || '<div class="empty">Подходящие наборы не найдены.</div>';
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; button.textContent = 'Найти лучший набор'; }
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
$('#optimal').addEventListener('click',event => { if (event.target.dataset.load !== undefined) { decisions = copy(optimal[Number(event.target.dataset.load)].decisions); renderCatalog(); validateSelection(); page('decisions'); } });
async function init() {
  $('#optimize').disabled = true;
  try {
    state = await request('/api/state',undefined,15000);
    renderCity();
    renderCatalog();
    renderSaved();
    await validateSelection();
    $('#optimize').disabled = false;
  } catch (error) { notice(`${error.message} Обновите страницу после запуска сервера.`); }
  finally { $('#loading').hidden = true; }
  page(location.hash.slice(1) || 'city');
}
init();
