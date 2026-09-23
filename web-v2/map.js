(() => {
  const host = document.getElementById('city-map');
  const budgetHost = document.getElementById('budget-segments');
  if (!host || !budgetHost) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const names = {T1:'Разгрузка дорог',T2:'Доступность ОТ',E1:'Озеленение',E2:'Качество воздуха',S1:'Школы и детсады',S2:'Поликлиники',B1:'Безопасность улиц',B2:'Безопасность дорожного движения',C1:'Надёжность ЖКХ',C2:'Скорость решения обращений'};
  const groups = {T:'Транспорт',E:'Экология',S:'Соцсфера',B:'Безопасность',C:'Сервисы'};
  const positions = {'Сарыарка':[145,116,89],'Байконур':[345,109,75],'Алматы':[403,250,85],'Есиль':[224,337,99],'Нура':[299,474,78]};
  const format = value => Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const band = score => score < 40 ? 'crit' : score < 55 ? 'low' : score <= 65 ? 'mid' : 'good';
  const svgNode = (tag,attributes = {}) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attributes).forEach(([key,value]) => node.setAttribute(key,value));
    return node;
  };
  const element = (tag,text,className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let cityState = null;
  let epoch = 0;
  let focused = null;
  const districts = new Map();
  const svg = svgNode('svg',{viewBox:'0 0 560 580',role:'group','aria-label':'Схематическая карта районов Астаны'});
  const defs = svgNode('defs');
  svg.append(defs);
  const river = svgNode('path',{class:'map-river',d:'M -20 231 C 75 190 91 276 177 249 S 294 221 332 297 S 456 384 580 328'});
  svg.append(river);
  const riverLabel = svgNode('text',{x:65,y:230,fill:'var(--ink-2)','font-size':12,transform:'rotate(12 65 230)'});
  riverLabel.textContent = 'Есиль';
  svg.append(riverLabel);
  const tooltip = element('div',undefined,'map-tooltip');
  tooltip.id = 'city-map-tooltip';
  tooltip.setAttribute('role','tooltip');
  tooltip.hidden = true;
  tooltip.style.maxWidth = 'calc(100% - 16px)';
  tooltip.style.width = '320px';
  tooltip.style.fontSize = '12px';
  host.replaceChildren(svg,tooltip);

  function showTooltip(entry) {
    focused = entry;
    tooltip.replaceChildren(element('strong',`${entry.name} · ${format(entry.score)}`));
    const list = element('dl');
    list.style.margin = 'var(--s2) 0 0';
    for (const [key,label] of Object.entries(names)) {
      const row = element('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.gap = 'var(--s2)';
      row.style.padding = '2px 0';
      const value = entry.values[key];
      const number = element('dd',Number.isFinite(value) ? format(value) : '—');
      number.style.margin = '0';
      if (value < 40) number.style.color = 'var(--score-crit)';
      row.append(element('dt',label),number);
      list.append(row);
    }
    tooltip.append(list);
    tooltip.hidden = false;
    const width = host.clientWidth;
    tooltip.style.left = `${Math.max(8,Math.min(width-tooltip.offsetWidth-8,entry.x/560*width-tooltip.offsetWidth/2))}px`;
    tooltip.style.top = `${Math.max(8,Math.min(host.clientHeight-tooltip.offsetHeight-8,entry.y/580*svg.getBoundingClientRect().height+30))}px`;
  }

  function hideTooltip() {
    focused = null;
    tooltip.hidden = true;
  }

  function updateMap(rows,base = false) {
    for (const row of rows || []) {
      const position = positions[row.name];
      const score = base ? row.base_score : row.score_after;
      const values = base ? row.indicators : row.after;
      if (!position || !Number.isFinite(score) || !values) continue;
      let entry = districts.get(row.name);
      if (!entry) {
        const [x,y,radius] = position;
        const id = `city-district-${districts.size}`;
        const gradient = svgNode('radialGradient',{id,cx:'38%',cy:'32%',r:'72%'});
        for (const [offset,opacity] of [['0%','.65'],['65%','.28'],['100%','.06']]) gradient.append(svgNode('stop',{offset,'stop-opacity':opacity}));
        defs.append(gradient);
        const group = svgNode('g',{tabindex:0,role:'img','aria-describedby':tooltip.id});
        const circle = svgNode('circle',{class:'map-circle',cx:x,cy:y,r:radius});
        circle.style.fill = `url(#${id})`;
        circle.style.transformOrigin = `${x}px ${y}px`;
        const bubble = svgNode('circle',{class:'map-bubble',cx:x,cy:y,r:29});
        const number = svgNode('text',{class:'map-bubble',x,y:y+5,'text-anchor':'middle','font-size':14,'data-countup':''});
        const label = svgNode('text',{x,y:y+49,'text-anchor':'middle',fill:'var(--ink)','font-size':16,'font-weight':500});
        label.textContent = row.name;
        group.append(circle,bubble,number,label);
        svg.append(group);
        entry = {name:row.name,x,y,group,circle,gradient,number,score,values};
        districts.set(row.name,entry);
        group.addEventListener('pointerenter',() => showTooltip(entry));
        group.addEventListener('pointerleave',() => { if (document.activeElement !== group) hideTooltip(); });
        group.addEventListener('focus',() => showTooltip(entry));
        group.addEventListener('blur',hideTooltip);
        group.addEventListener('click',() => showTooltip(entry));
        group.addEventListener('keydown',event => { if (event.key === 'Escape') hideTooltip(); });
      }
      const growing = score > entry.score;
      entry.score = score;
      entry.values = {...values};
      entry.group.setAttribute('aria-label',`${row.name}: ${format(score)} балла`);
      entry.circle.style.setProperty('--score-color',`var(--score-${band(score)})`);
      entry.circle.style.transition = reduced.matches ? 'none' : 'stroke 700ms ease';
      for (const stop of entry.gradient.children) {
        stop.style.transition = reduced.matches ? 'none' : 'stop-color 700ms ease';
        stop.style.stopColor = `var(--score-${band(score)})`;
      }
      entry.number.textContent = format(score);
      if (growing && !reduced.matches) {
        entry.circle.getAnimations().forEach(animation => animation.cancel());
        entry.circle.animate([{transform:'scale(1)'},{transform:'scale(1.055)'},{transform:'scale(1)'}],{duration:900,easing:'ease-in-out'});
      }
      if (focused === entry) showTooltip(entry);
    }
  }

  function resetMap() {
    epoch++;
    hideTooltip();
    if (cityState) updateMap(cityState.districts,true);
  }

  function renderSegments() {
    const data = cityState || (typeof state !== 'undefined' ? state : null);
    if (!data) return;
    const selection = typeof decisions !== 'undefined' ? decisions : [];
    const event = typeof selectedEvent !== 'undefined' ? selectedEvent : null;
    const available = Math.max(0,data.budget-(event?.budget_penalty || 0));
    const totals = Object.fromEntries(Object.keys(groups).map(key => [key,0]));
    for (const decision of selection) {
      const measure = data.measures.find(item => item.id === decision.measure_id);
      if (measure && measure.direction in totals) totals[measure.direction] += measure.cost;
    }
    const used = Object.values(totals).reduce((sum,value) => sum+value,0);
    const track = element('div');
    track.style.display = 'flex';
    track.style.gap = '2px';
    track.style.borderRadius = 'var(--r-pill)';
    track.style.overflow = 'hidden';
    track.style.background = 'var(--line)';
    track.style.minHeight = '8px';
    track.setAttribute('role','img');
    track.setAttribute('aria-label',`Использовано ${format(used)} из ${format(available)}`);
    const legend = element('div');
    legend.style.display = 'flex';
    legend.style.flexWrap = 'wrap';
    legend.style.gap = 'var(--s2)';
    for (const [key,total] of Object.entries(totals)) {
      if (!total) continue;
      const label = `${groups[key]} · ${format(total)}`;
      const segment = element('div',undefined,'budget-seg');
      segment.style.setProperty('--direction',`var(--dir-${key})`);
      segment.style.width = `${total/Math.max(available,used,1)*100}%`;
      segment.title = label;
      const chip = element('span',label,'chip');
      chip.style.background = `color-mix(in srgb, var(--dir-${key}) 20%, transparent)`;
      track.append(segment);
      legend.append(chip);
    }
    if (!used) legend.append(element('span','Выберите меры — здесь появится распределение бюджета.','muted'));
    if (used > available) legend.append(element('span',`Перерасход: ${format(used-available)}`,'critical'));
    budgetHost.style.display = 'flex';
    budgetHost.style.flexDirection = 'column';
    budgetHost.style.borderRadius = '0';
    budgetHost.style.background = 'none';
    budgetHost.replaceChildren(track,legend);
  }

  const previousFetch = window.fetch;
  window.fetch = function(...args) {
    const currentEpoch = epoch;
    const currentEvent = typeof eventRevision !== 'undefined' ? eventRevision : 0;
    const currentSelection = typeof revision !== 'undefined' ? revision : 0;
    let path;
    try { path = new URL(args[0] instanceof Request ? args[0].url : args[0],location.href).pathname; } catch {}
    return previousFetch.apply(this,args).then(response => {
      if (response.ok && ['/api/state','/api/simulate','/api/explain'].includes(path)) {
        response.clone().json().then(data => {
          if (path === '/api/state') {
            const initial = !cityState;
            cityState = data;
            if (initial) updateMap(data.districts,true);
            renderSegments();
          } else if (currentEpoch === epoch && currentEvent === (typeof eventRevision !== 'undefined' ? eventRevision : 0) && currentSelection === (typeof revision !== 'undefined' ? revision : 0)) {
            updateMap((data.simulation || data).districts);
          }
        }).catch(() => {});
      }
      return response;
    });
  };

  document.addEventListener('click',event => {
    if (event.target.closest('#clear,#no-event,[data-event]')) resetMap();
    if (event.target.closest('#clear,#demo,[data-load],#no-event,[data-event]')) renderSegments();
  });
  document.getElementById('catalog')?.addEventListener('change',renderSegments);
  const catalog = document.getElementById('catalog');
  if (catalog) new MutationObserver(renderSegments).observe(catalog,{childList:true,subtree:true});
  const activeEvent = document.getElementById('active-event');
  if (activeEvent) new MutationObserver(renderSegments).observe(activeEvent,{childList:true,subtree:true});
  document.addEventListener('keydown',event => { if (event.key === 'Escape') hideTooltip(); });
  reduced.addEventListener('change',() => {
    if (reduced.matches) svg.getAnimations({subtree:true}).forEach(animation => animation.cancel());
  });

  const counts = new WeakMap();
  const activeCounts = new Set();
  const countOptions = {childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['data-countup'],attributeOldValue:true};
  const countPattern = /[+−-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[,.]\d+)?/g;
  const countObserver = new MutationObserver(records => {
    const targets = new Set();
    for (const record of records) {
      if (record.type === 'attributes' && record.oldValue === record.target.getAttribute('data-countup')) continue;
      const parent = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const target = parent?.closest('[data-countup]');
      if (target) targets.add(target);
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('[data-countup]')) targets.add(node);
        node.querySelectorAll('[data-countup]').forEach(item => targets.add(item));
      }
    }
    targets.forEach(animateCount);
  });
  function writeCount(node,text) {
    countObserver.disconnect();
    node.textContent = text;
    countObserver.observe(document.body,countOptions);
  }
  function animateCount(node) {
    const text = node.textContent;
    const tokens = [...text.matchAll(countPattern)];
    const values = tokens.map(match => Number(match[0].replace(/[\s\u00a0\u202f]/g,'').replace('−','-').replace(',','.')));
    const previous = counts.get(node);
    if (previous?.frame) cancelAnimationFrame(previous.frame);
    activeCounts.delete(node);
    if (!values.length || node.children.length) { counts.delete(node); return; }
    const item = {values,current:values.map((value,index) => previous?.current[index] ?? 0),text,frame:0};
    counts.set(node,item);
    if (reduced.matches || !node.isConnected || item.current.every((value,index) => value === values[index])) { item.current = values; return; }
    const startValues = [...item.current];
    const start = performance.now();
    activeCounts.add(node);
    const tick = now => {
      if (!node.isConnected) { activeCounts.delete(node); return; }
      const progress = Math.min(1,(now-start)/650);
      item.current = values.map((value,index) => startValues[index]+(value-startValues[index])*(1-Math.pow(1-progress,3)));
      let index = 0;
      const frameText = text.replace(countPattern,token => {
        const digits = (token.match(/[,.](\d+)/)?.[1] || '').length;
        const value = item.current[index++];
        return `${token.startsWith('+') && value >= 0 ? '+' : ''}${value.toLocaleString('ru-RU',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
      });
      writeCount(node,progress === 1 ? text : frameText);
      if (progress < 1) item.frame = requestAnimationFrame(tick);
      else { item.frame = 0; activeCounts.delete(node); }
    };
    item.frame = requestAnimationFrame(tick);
  }
  countObserver.observe(document.body,countOptions);
  document.querySelectorAll('[data-countup]').forEach(animateCount);
  reduced.addEventListener('change',() => {
    if (!reduced.matches) return;
    for (const node of activeCounts) {
      const item = counts.get(node);
      cancelAnimationFrame(item.frame);
      item.current = item.values;
      item.frame = 0;
      writeCount(node,item.text);
    }
    activeCounts.clear();
  });
  if (typeof state !== 'undefined' && state) {
    cityState = state;
    updateMap(state.districts,true);
    renderSegments();
  } else {
    fetch('/api/state',{signal:AbortSignal.timeout(15000)}).then(response => {
      if (!response.ok) throw new Error('state');
    }).catch(() => {
      if (!cityState) {
        const retry = element('button','Повторить загрузку карты','btn btn-glass');
        retry.type = 'button';
        retry.addEventListener('click',() => location.reload());
        host.append(element('p','Не удалось загрузить данные карты.','muted'),retry);
      }
    });
  }
})();
