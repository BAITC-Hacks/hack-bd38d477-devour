(() => {
  const screen = document.getElementById('agent');
  const goal = document.getElementById('agent-goal');
  const run = document.getElementById('agent-run');
  const status = document.getElementById('agent-status');
  const steps = document.getElementById('agent-steps');
  const output = document.getElementById('agent-result');
  if (!screen || !goal || !run || !status || !steps || !output) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const number = value => Number.isFinite(value) ? value.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
  const localize = value => String(value ?? '').replace(/(\d)\.(\d)/g,'$1,$2');
  const node = (tag,text,className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = localize(text);
    if (className) element.className = className;
    return element;
  };
  const context = () => ({id:typeof selectedEvent !== 'undefined' ? selectedEvent?.id ?? null : null,revision:typeof eventRevision !== 'undefined' ? eventRevision : 0});
  const sameContext = snapshot => snapshot.id === context().id && snapshot.revision === context().revision;
  let controller = null;
  let runId = 0;
  let busy = false;
  let currentResult = null;
  let activeContext = context();
  const animations = new Set();
  const finishLoading = () => {
    busy = false;
    run.disabled = false;
    run.textContent = 'Спросить AI-акима';
    screen.setAttribute('aria-busy','false');
  };
  const animate = element => {
    if (reduced.matches) return;
    const animation = element.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'ease-out'});
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation),() => animations.delete(animation));
  };
  reduced.addEventListener('change',() => {
    if (reduced.matches) animations.forEach(animation => animation.cancel());
  });

  function decisionList(items) {
    const list = node('ul');
    for (const item of items) {
      const measure = typeof state !== 'undefined' ? state?.measures.find(measure => measure.id === item.measure_id) : null;
      list.append(node('li',`${measure?.name || item.measure_id} · ${item.district || 'Весь город'}`));
    }
    return list;
  }

  function renderStep(step,index) {
    const item = node('article',undefined,'step');
    const type = step.action === 'validate' ? 'validate' : 'simulate';
    const chip = node('span',`${index+1}. ${type === 'validate' ? 'Проверка ограничений' : 'Расчёт результата'}`,`step-chip ${type}`);
    chip.dataset.type = type;
    chip.style.background = `var(--dir-${type === 'validate' ? 'T' : 'E'})`;
    item.append(chip,node('p',step.summary));
    if (Array.isArray(step.decisions) && step.decisions.length) {
      const details = node('details');
      details.append(node('summary','Проверенный набор мер'),decisionList(step.decisions));
      item.append(details);
    }
    steps.append(item);
    animate(item);
  }

  function validResult(data) {
    if (!data || !Array.isArray(data.decisions) || data.decisions.length !== 5 || !data.simulation || !Number.isFinite(data.simulation.base_score) || !Number.isFinite(data.simulation.score)) return false;
    const known = typeof state !== 'undefined' ? state : null;
    return known && new Set(data.decisions.map(item => item?.measure_id)).size === 5 && data.decisions.every(item => {
      const measure = known.measures.find(measure => measure.id === item?.measure_id);
      return measure && (measure.type === 'C' ? item.district === null : known.districts.some(district => district.name === item.district));
    });
  }

  function renderResult(data,snapshot) {
    const simulation = data.simulation;
    const card = node('article',undefined,'card');
    card.append(node('span',data.source === 'fallback' ? 'Резервный подбор · fallback' : 'Программа AI-акима','step-chip final'));
    card.append(node('h3','Программа для города'));
    const eventName = simulation.event?.name || (snapshot.id ? selectedEvent?.name : null);
    card.append(node('p',eventName ? `Событие: ${eventName}` : 'Без события','muted'));
    if (data.source === 'fallback') card.append(node('p','AI недоступен или не завершил подбор. Показан проверенный резервный план.','muted'));
    const scores = node('div',undefined,'tile');
    scores.append(node('span','Score: было → стало','label'));
    const value = node('strong');
    const before = node('span',number(simulation.base_score));
    const after = node('span',number(simulation.score));
    before.dataset.countup = '';
    after.dataset.countup = '';
    value.append(before,document.createTextNode(' → '),after);
    scores.append(value);
    const change = node('p',`Изменение: ${simulation.delta > 0 ? '+' : ''}${number(simulation.delta)}`);
    change.style.color = simulation.delta < 0 ? 'var(--score-crit)' : 'var(--score-good)';
    scores.append(change);
    const comparison = Number.isFinite(data.optimizer_score) ? `Score оптимизатора: ${number(data.optimizer_score)} · ${simulation.score === data.optimizer_score ? 'результаты равны' : simulation.score > data.optimizer_score ? 'Score AI-акима выше' : 'Score AI-акима ниже'}.` : 'Score оптимизатора недоступен для сравнения.';
    card.append(scores,node('p',comparison));
    card.append(node('p',`Стоимость: ${number(simulation.total_cost)} · остаток бюджета: ${number(simulation.budget_left)}`));
    card.append(decisionList(data.decisions));
    const explanation = node('p',data.explanation || 'Объяснение не получено. Числа рассчитаны движком.');
    explanation.style.whiteSpace = 'pre-wrap';
    card.append(explanation);
    const load = node('button','Загрузить в решения','btn btn-primary');
    load.type = 'button';
    load.dataset.agentLoad = '';
    load.addEventListener('click',() => {
      if (!sameContext(snapshot)) {
        load.disabled = true;
        status.textContent = 'Событие изменилось. Запустите AI-акима снова для текущего бюджета.';
        return;
      }
      decisions = data.decisions.map(item => ({measure_id:item.measure_id,district:item.district}));
      renderCatalog();
      validateSelection();
      page('decisions');
      status.textContent = 'Программа загружена в решения. Можно изменить меры или рассчитать результат.';
    });
    card.append(load);
    output.replaceChildren(card);
    animate(card);
  }

  async function start() {
    if (busy) return;
    if (typeof state === 'undefined' || !state) {
      status.textContent = 'Данные города ещё не загружены. Дождитесь загрузки или обновите страницу.';
      return;
    }
    const snapshot = context();
    activeContext = snapshot;
    const current = ++runId;
    const requestController = new AbortController();
    controller = requestController;
    const signal = requestController.signal;
    busy = true;
    currentResult = null;
    run.disabled = true;
    run.textContent = 'AI-аким думает…';
    screen.setAttribute('aria-busy','true');
    steps.replaceChildren();
    output.replaceChildren();
    status.textContent = 'AI-аким думает… Это может занять до 90 секунд.';
    const started = performance.now();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; requestController.abort(); },90000);
    const heartbeat = setInterval(() => {
      if (current !== runId) return;
      const seconds = Math.min(90,Math.floor((performance.now()-started)/1000));
      status.textContent = `AI-аким думает${reduced.matches ? '…' : '.'.repeat(seconds%3+1)} ${seconds} с · до 90 секунд`;
    },1000);
    try {
      const response = await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:goal.value.trim() || null,event_id:snapshot.id}),signal});
      const data = await response.json().catch(() => null);
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (current !== runId || !sameContext(snapshot)) return;
      if (!response.ok) {
        const detail = data?.detail ?? data;
        const reason = typeof detail === 'string' ? detail : Array.isArray(detail?.errors) ? detail.errors.join(' ') : `Сервер вернул ошибку ${response.status}. Попробуйте ещё раз.`;
        throw new Error(reason);
      }
      if (!validResult(data)) throw new Error('Сервер не вернул полный набор из пяти мер и результат расчёта. Попробуйте ещё раз.');
      if (data.simulation.event !== undefined && (data.simulation.event?.id ?? null) !== snapshot.id) throw new Error('Получен план для другого события. Повторите подбор.');
      const history = Array.isArray(data.steps) ? data.steps.filter(step => step && ['validate','simulate'].includes(step.action)) : [];
      status.textContent = history.length ? 'План получен. Показываем выполненные проверки…' : 'План получен.';
      for (const [index,step] of history.entries()) {
        if (current !== runId || !sameContext(snapshot)) return;
        renderStep(step,index);
        if (!reduced.matches && index < history.length-1) await new Promise(resolve => setTimeout(resolve,320));
      }
      if (current !== runId || !sameContext(snapshot)) return;
      currentResult = {data,snapshot};
      renderResult(data,snapshot);
      status.textContent = data.source === 'fallback' ? 'Готово. Использован резервный подбор; план проверен движком.' : 'Готово. План проверен движком.';
    } catch (error) {
      if (current !== runId) return;
      status.textContent = timedOut ? 'AI-аким не ответил за 90 секунд. Попробуйте снова.' : error.name === 'AbortError' ? 'Подбор остановлен. Можно запустить его снова.' : error instanceof TypeError ? 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.' : localize(error.message);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (current === runId) { controller = null; finishLoading(); }
    }
  }

  function eventChanged() {
    if (sameContext(activeContext)) return;
    activeContext = context();
    if (busy) {
      runId++;
      controller?.abort();
      controller = null;
      finishLoading();
      steps.replaceChildren();
      status.textContent = 'Событие изменилось. Подбор остановлен — запустите его для новых условий.';
    }
    if (currentResult && !sameContext(currentResult.snapshot)) {
      output.querySelector('[data-agent-load]')?.setAttribute('disabled','');
      status.textContent = 'Этот план рассчитан для предыдущего события. Запустите AI-акима снова.';
    }
  }
  run.addEventListener('click',start);
  const eventLabel = document.getElementById('active-event');
  if (eventLabel) new MutationObserver(eventChanged).observe(eventLabel,{childList:true,subtree:true});
  document.addEventListener('click',event => {
    if (event.target.closest('#no-event,[data-event]')) eventChanged();
  });
})();
