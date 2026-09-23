(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { baseScore: null, score: null, districts: null, events: [], budget: 100, hasResult: false, greenBase: null, roadBase: null, greenNow: null, roadNow: null };
  const windows = [];
  const trees = [];
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const ru = value => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  function windowsFor(x, y, width, height, cols, rows, fill) {
    const cellW = width / cols;
    const cellH = height / rows;
    let markup = '';
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (rand() > fill) continue;
        const index = windows.length;
        windows.push(index);
        markup += `<rect class="win" data-win="${index}" x="${(x + c * cellW + cellW * 0.28).toFixed(1)}" y="${(y + r * cellH + cellH * 0.25).toFixed(1)}" width="${(cellW * 0.44).toFixed(1)}" height="${(cellH * 0.5).toFixed(1)}" rx="0.6"/>`;
      }
    }
    return markup;
  }

  function tower(x, width, height, cols, options = {}) {
    const top = 420 - height;
    const rows = Math.max(2, Math.round(height / 13));
    const roof = options.round
      ? `<ellipse class="bldg" cx="${x + width / 2}" cy="${top}" rx="${width / 2}" ry="${width / 5}"/>`
      : options.spire
        ? `<path class="bldg" d="M${x} ${top} L${x + width / 2} ${top - options.spire} L${x + width} ${top} Z"/>`
        : '';
    return `<g class="tower">${roof}<rect class="bldg" x="${x}" y="${top}" width="${width}" height="${height}" rx="${options.round ? width / 2.2 : 1.5}"/>${windowsFor(x, top + 8, width, height - 14, cols, rows, options.fill ?? 0.55)}</g>`;
  }

  function tree(x, y, size, threshold) {
    const index = trees.length;
    trees.push({ index, threshold });
    return `<g class="tree" data-tree="${index}" style="transform-origin:${x}px ${y}px"><rect class="trunk" x="${x - 1.5}" y="${y - size * 0.55}" width="3" height="${size * 0.55}"/><circle class="leaf" cx="${x}" cy="${y - size * 0.75}" r="${size * 0.42}"/><circle class="leaf" cx="${x - size * 0.28}" cy="${y - size * 0.55}" r="${size * 0.32}"/><circle class="leaf" cx="${x + size * 0.3}" cy="${y - size * 0.58}" r="${size * 0.34}"/></g>`;
  }

  function stars() {
    let markup = '';
    for (let i = 0; i < 70; i += 1) {
      const x = rand() * 1200;
      const y = -230 + rand() * 440;
      const r = 0.6 + rand() * 1.3;
      markup += `<circle class="star" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" style="--tw:${(rand() * 4).toFixed(2)}s"/>`;
    }
    return markup;
  }

  function bridge(x1, x2, cars) {
    const width = x2 - x1;
    const mid = (x1 + x2) / 2;
    let markup = `<g class="bridge"><path class="arch" d="M${x1} 452 Q${mid} 400 ${x2} 452"/><rect class="deck" x="${x1 - 6}" y="438" width="${width + 12}" height="6" rx="2"/>`;
    for (let i = 0; i < 7; i += 1) {
      const px = x1 + (width / 6) * i;
      const t = (px - x1) / width;
      const archY = 452 - 52 * 4 * t * (1 - t);
      markup += `<line class="cable" x1="${px.toFixed(1)}" y1="438" x2="${px.toFixed(1)}" y2="${archY.toFixed(1)}"/>`;
    }
    for (let i = 0; i < cars; i += 1) {
      const forward = i % 2 === 0;
      const duration = (6 + rand() * 5).toFixed(2);
      const delay = (-rand() * 10).toFixed(2);
      markup += `<circle class="car ${forward ? 'fwd' : 'back'}" cx="${forward ? x1 - 6 : x2 + 6}" cy="${forward ? 435.5 : 440.5}" r="2.4" style="--drive:${width + 12}px;--dur:${duration}s;--delay:${delay}s"/>`;
    }
    return markup + '</g>';
  }

  function baiterek() {
    let legs = '';
    for (let i = 0; i < 7; i += 1) {
      const dx = -22 + i * 7.3;
      legs += `<path class="lattice" d="M600 262 Q${600 + dx * 1.4} 225 ${600 + dx} 194"/>`;
    }
    return `<g class="landmark baiterek"><rect class="bldg light" x="595" y="262" width="10" height="158" rx="2"/>${legs}<path class="lattice" d="M578 194 Q600 186 622 194"/><circle class="orb-glow" cx="600" cy="176" r="34"/><circle class="orb" cx="600" cy="176" r="23"/><circle class="orb-shine" cx="592" cy="168" r="7"/></g>`;
  }

  function khanShatyr() {
    return `<g class="landmark khan"><path class="tent" d="M300 420 C318 330 340 262 372 214 C398 262 436 330 452 420 Z"/><path class="tent-inner" d="M330 420 C342 340 358 285 372 240 C388 285 410 340 424 420 Z"/><line class="mast" x1="372" y1="214" x2="380" y2="188"/><circle class="mast-tip" cx="380" cy="188" r="2.5"/>${windowsFor(322, 356, 104, 58, 8, 4, 0.5)}</g>`;
  }

  function akorda() {
    let columns = '';
    for (let i = 0; i < 9; i += 1) {
      columns += `<rect class="column" x="${708 + i * 17.5}" y="352" width="5" height="68" rx="1"/>`;
    }
    return `<g class="landmark akorda"><rect class="bldg light" x="696" y="344" width="168" height="76" rx="2"/><rect class="bldg light" x="734" y="322" width="92" height="24" rx="2"/>${columns}<circle class="dome" cx="780" cy="318" r="30"/><rect class="bldg light" x="750" y="318" width="60" height="6"/><line class="spire" x1="780" y1="288" x2="780" y2="256"/><circle class="orb" cx="780" cy="253" r="4"/><circle class="dome small" cx="716" cy="336" r="11"/><circle class="dome small" cx="844" cy="336" r="11"/>${windowsFor(700, 360, 160, 50, 12, 3, 0.65)}</g>`;
  }

  function farSkyline() {
    let markup = '';
    let x = -20;
    while (x < 1240) {
      const w = 26 + rand() * 40;
      const h = 30 + rand() * 90;
      markup += `<rect class="far" x="${x.toFixed(1)}" y="${(420 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`;
      x += w + 6 + rand() * 18;
    }
    return markup;
  }

  function buildPanorama() {
    const left = [
      tower(40, 34, 110, 3), tower(84, 46, 150, 4, { spire: 22 }), tower(140, 38, 126, 3),
      tower(186, 58, 178, 5), tower(254, 34, 136, 3),
    ].join('');
    const center = [tower(478, 40, 190, 3, { round: true }), tower(526, 40, 190, 3, { round: true }), tower(648, 32, 128, 3)].join('');
    const right = [
      tower(884, 44, 168, 4), tower(936, 62, 262, 5, { spire: 30 }), tower(1008, 40, 206, 3),
      tower(1056, 56, 292, 5), tower(1122, 42, 184, 3, { round: true }), tower(1172, 40, 142, 3),
    ].join('');
    const treeMarkup = [
      [14, 484, 30, 0.05], [58, 490, 24, 0.5], [122, 486, 34, 0.15], [176, 492, 26, 0.7], [236, 484, 30, 0.3],
      [292, 490, 22, 0.85], [470, 488, 30, 0.1], [520, 492, 26, 0.6], [590, 486, 32, 0.25], [666, 490, 28, 0.95],
      [720, 486, 30, 0.4], [780, 492, 24, 0.75], [842, 488, 32, 0.2], [906, 492, 26, 0.9], [980, 486, 30, 0.35],
      [1040, 490, 26, 0.65], [1112, 486, 32, 0.12], [1172, 492, 26, 0.8], [1210, 486, 28, 0.55],
    ].map(([x, y, size, threshold]) => tree(x, y, size, threshold)).join('');
    return `<svg class="sky-svg" viewBox="0 -240 1200 760" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="sun-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="var(--sun)" stop-opacity=".9"/><stop offset="1" stop-color="var(--sun)" stop-opacity="0"/></radialGradient>
        <radialGradient id="city-glow" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="var(--window)" stop-opacity=".45"/><stop offset="1" stop-color="var(--window)" stop-opacity="0"/></radialGradient>
        <linearGradient id="river-shine" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--card)" stop-opacity=".35"/><stop offset="1" stop-color="var(--card)" stop-opacity="0"/></linearGradient>
      </defs>
      <g class="layer-stars">${stars()}</g>
      <g class="layer-sun"><circle class="sun-halo" cx="1010" cy="-70" r="90" fill="url(#sun-glow)"/><circle class="sun" cx="1010" cy="-70" r="26"/></g>
      <ellipse class="glow" cx="600" cy="430" rx="720" ry="200" fill="url(#city-glow)"/>
      <g class="layer-far">${farSkyline()}</g>
      <g class="layer-city">${left}${khanShatyr()}${center}${baiterek()}${akorda()}${right}</g>
      <rect class="ground" x="0" y="418" width="1200" height="14"/>
      <rect class="river" x="0" y="430" width="1200" height="46"/>
      <rect class="river-shine" x="0" y="430" width="1200" height="22" fill="url(#river-shine)"/>
      <path class="wave" d="M0 452 Q40 447 80 452 T160 452 T240 452 T320 452 T400 452 T480 452 T560 452 T640 452 T720 452 T800 452 T880 452 T960 452 T1040 452 T1120 452 T1200 452"/>
      <path class="wave second" d="M0 464 Q40 460 80 464 T160 464 T240 464 T320 464 T400 464 T480 464 T560 464 T640 464 T720 464 T800 464 T880 464 T960 464 T1040 464 T1120 464 T1200 464"/>
      ${bridge(196, 424, 4)}${bridge(814, 1066, 4)}
      <rect class="bank" x="0" y="474" width="1200" height="46"/>
      <g class="layer-trees">${treeMarkup}</g>
    </svg>`;
  }

  function weightedAverage(rows, key, stage) {
    let total = 0;
    let weight = 0;
    for (const row of rows || []) {
      const value = stage ? row?.[stage]?.[key] : row?.indicators?.[key];
      if (typeof value !== 'number') continue;
      total += value * (row.population || 0);
      weight += row.population || 0;
    }
    return weight ? total / weight : null;
  }

  function applyScene() {
    const hero = document.querySelector('#hero');
    if (!hero) return;
    const score = state.score ?? state.baseScore;
    const daylight = score == null ? 0.18 : clamp((score - 47) / 13, 0.08, 1);
    const lit = score == null ? 0.12 : clamp(0.18 + (score - 47) / 12 * 0.75, 0.12, 0.95);
    const greenLevel = state.greenNow == null ? 0.3 : clamp((state.greenNow - 42) / 24, 0, 1);
    const roadGain = state.roadBase != null && state.roadNow != null ? state.roadNow - state.roadBase : 0;
    const traffic = clamp(roadGain / 6, 0, 1);
    hero.style.setProperty('--daylight', daylight.toFixed(3));
    hero.style.setProperty('--night', (1 - daylight).toFixed(3));
    hero.style.setProperty('--lit', lit.toFixed(3));
    hero.style.setProperty('--green', greenLevel.toFixed(3));
    hero.style.setProperty('--traffic', traffic.toFixed(3));
    hero.classList.toggle('has-result', state.hasResult);
    hero.classList.toggle('traffic', traffic > 0.05);
    const litCount = Math.round(windows.length * lit);
    const nodes = hero.querySelectorAll('.win');
    nodes.forEach(node => { node.classList.toggle('on', Number(node.dataset.win) < litCount); });
    hero.querySelectorAll('.tree').forEach(node => { const item = trees[Number(node.dataset.tree)]; node.classList.toggle('grown', greenLevel >= item.threshold); });
    updateRing(score);
  }

  function updateRing(score) {
    const ring = document.querySelector('#score-ring circle.progress');
    if (!ring) return;
    const length = Number(ring.dataset.length);
    const ratio = score == null ? 0 : clamp((score - 40) / 30, 0, 1);
    ring.style.strokeDashoffset = (length * (1 - ratio)).toFixed(1);
    const band = score == null ? 'mid' : score < 40 ? 'crit' : score < 55 ? 'low' : score <= 65 ? 'mid' : 'good';
    ring.closest('.score-ring')?.setAttribute('data-band', band);
  }

  function mountRing() {
    const target = document.querySelector('#score-ring');
    if (!target || target.querySelector('svg')) return;
    const radius = 88;
    const length = 2 * Math.PI * radius;
    const svg = `<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false"><circle class="track" cx="100" cy="100" r="${radius}"/><circle class="progress" cx="100" cy="100" r="${radius}" data-length="${length.toFixed(1)}" style="stroke-dasharray:${length.toFixed(1)};stroke-dashoffset:${length.toFixed(1)}"/></svg>`;
    target.insertAdjacentHTML('afterbegin', svg);
  }

  function shuffleWindows() {
    for (let i = windows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [windows[i], windows[j]] = [windows[j], windows[i]];
    }
    const order = new Map(windows.map((id, position) => [id, position]));
    document.querySelectorAll('#hero .win').forEach(node => { node.dataset.win = order.get(Number(node.dataset.win)); });
  }

  function mountSkyline() {
    const host = document.querySelector('#skyline');
    if (!host || host.querySelector('svg')) return;
    host.innerHTML = buildPanorama();
    shuffleWindows();
    mountRing();
    applyScene();
  }

  function handleState(data) {
    state.baseScore = Number(data.base_score);
    state.budget = Number(data.budget) || 100;
    state.districts = data.districts;
    state.greenBase = weightedAverage(data.districts, 'E1');
    state.roadBase = weightedAverage(data.districts, 'T1');
    state.greenNow = state.greenBase;
    state.roadNow = state.roadBase;
    if (!state.hasResult) state.score = null;
    applyScene();
  }

  function handleSimulation(data) {
    if (!data || typeof data.score !== 'number') return;
    state.score = data.score;
    state.hasResult = true;
    state.greenNow = weightedAverage(data.districts, 'E1', 'after');
    state.roadBase = weightedAverage(data.districts, 'T1', 'before');
    state.roadNow = weightedAverage(data.districts, 'T1', 'after');
    applyScene();
  }

  function installFetchHook() {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (response.ok && /\/api\/(state|simulate|events|agent)(\?|$)/.test(url)) {
          response.clone().json().then(data => {
            if (url.includes('/api/state')) handleState(data);
            else if (url.includes('/api/events')) state.events = Array.isArray(data) ? data : [];
            else if (url.includes('/api/agent')) handleSimulation(data?.simulation);
            else handleSimulation(data);
          }).catch(() => {});
        }
      } catch (error) {}
      return response;
    };
  }

  const parseNumber = text => {
    const cleaned = String(text).trim().replace(/\s/g, '').replace(',', '.');
    return /^[-+]?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  };

  const running = new WeakMap();
  function countUp(element) {
    const entry = running.get(element);
    if (entry && element.textContent === entry.expected) return;
    const target = parseNumber(element.textContent);
    if (target == null) return;
    const previous = entry ? entry.value : Number(element.dataset.countFrom ?? target);
    if (previous === target || reduced.matches) { element.dataset.countFrom = target; return; }
    const decimals = (String(element.textContent).split(',')[1] || '').length;
    const start = performance.now();
    const duration = 900;
    if (entry) cancelAnimationFrame(entry.frame);
    const current = { value: previous, expected: null, frame: 0 };
    running.set(element, current);
    const tick = now => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = previous + (target - previous) * eased;
      current.value = value;
      current.expected = value.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      element.textContent = current.expected;
      if (progress < 1) current.frame = requestAnimationFrame(tick);
      else { running.delete(element); element.dataset.countFrom = target; }
    };
    current.frame = requestAnimationFrame(tick);
  }

  function watchCountups() {
    const observer = new MutationObserver(records => {
      const seen = new Set();
      for (const record of records) {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const element = node?.closest?.('[data-countup]');
        if (!element || seen.has(element)) continue;
        seen.add(element);
        countUp(element);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function flyToBudget(source) {
    if (reduced.matches) return;
    const target = document.querySelector('#remaining');
    if (!source || !target) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const chip = document.createElement('span');
    chip.className = 'fly-chip';
    chip.textContent = source.querySelector('.measure-meta strong')?.textContent || '';
    chip.style.left = `${from.left + from.width / 2}px`;
    chip.style.top = `${from.top + 24}px`;
    document.body.append(chip);
    requestAnimationFrame(() => {
      chip.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + 24)}px) scale(.4)`;
      chip.style.opacity = '0';
    });
    const panel = document.querySelector('.budget-panel');
    panel?.classList.remove('pulse');
    void panel?.offsetWidth;
    panel?.classList.add('pulse');
    setTimeout(() => chip.remove(), 700);
  }

  function watchCatalog() {
    document.addEventListener('change', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.dataset.measure || !input.checked) return;
      flyToBudget(input.closest('.measure'));
    });
  }

  let lastEventName = null;
  function showEventAlert(name) {
    const event = state.events.find(item => item.name === name);
    const alert = document.querySelector('#event-alert');
    if (!alert || !event) return;
    const penalty = Number(event.budget_penalty) || 0;
    alert.innerHTML = `<div class="event-alert-card"><p class="eyebrow">СРОЧНО · ГОРОДСКОЕ СОБЫТИЕ</p><h2>${event.name}</h2><p>${event.description || ''}</p><div class="event-alert-budget"><span>Бюджет</span><strong><span data-countup>${ru(state.budget)}</span></strong><span class="arrow" aria-hidden="true">→</span><strong class="after"><span data-countup id="event-alert-after">${ru(state.budget)}</span></strong></div><p class="muted">${event.district ? `Затронут район ${event.district}` : 'Затронуты все районы'} · на ликвидацию ${ru(penalty)}</p></div>`;
    alert.hidden = false;
    alert.classList.remove('leaving');
    document.body.classList.add('alert-open');
    requestAnimationFrame(() => {
      const after = alert.querySelector('#event-alert-after');
      if (after) { after.dataset.countFrom = state.budget; after.textContent = ru(state.budget - penalty); }
    });
    clearTimeout(showEventAlert.timer);
    showEventAlert.timer = setTimeout(() => {
      alert.classList.add('leaving');
      setTimeout(() => { alert.hidden = true; document.body.classList.remove('alert-open'); }, reduced.matches ? 0 : 320);
    }, 2000);
  }

  function watchEvents() {
    const label = document.querySelector('#active-event');
    if (!label) return;
    const observer = new MutationObserver(() => {
      const text = label.textContent || '';
      const name = text.startsWith('Без события') ? null : text.split(' · ')[0].trim();
      document.body.classList.toggle('has-event', Boolean(name));
      const topbar = document.querySelector('#event-topbar');
      if (topbar) {
        const event = state.events.find(item => item.name === name);
        topbar.hidden = !name;
        topbar.innerHTML = name ? `<span class="event-topbar-dot" aria-hidden="true"></span><strong>${name}</strong><span>${event?.district ? `район ${event.district}` : 'весь город'} · бюджет ${ru(state.budget - (event?.budget_penalty || 0))}</span><a class="btn btn-glass" href="#events">К событиям</a>` : '';
      }
      if (name && name !== lastEventName) showEventAlert(name);
      lastEventName = name;
    });
    observer.observe(label, { childList: true, characterData: true, subtree: true });
  }

  installFetchHook();
  document.addEventListener('DOMContentLoaded', () => {
    mountSkyline();
    watchCountups();
    watchCatalog();
    watchEvents();
  });
})();
