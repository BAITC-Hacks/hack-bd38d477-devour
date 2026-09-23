async function parse(response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data?.detail ?? data
    const errors = detail?.errors
    throw new Error(Array.isArray(errors) ? errors.join(' ') : typeof detail === 'string' ? detail : `Сервер вернул ошибку ${response.status}`)
  }
  return data
}

function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(parse)
}

export const api = {
  state: () => fetch('/api/state').then(parse),
  events: () => fetch('/api/events').then(parse),
  validate: (decisions, event_id) => post('/api/validate', { decisions, event_id }),
  simulate: (decisions, event_id) => post('/api/simulate', { decisions, event_id }),
  explain: (decisions, event_id) => post('/api/explain', { decisions, event_id }),
  agent: (goal, event_id) => post('/api/agent', { goal, event_id }),
  optimize: (event_id) => fetch(`/api/optimize?top=5${event_id ? `&event_id=${encodeURIComponent(event_id)}` : ''}`).then(parse),
}

export const fmt = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—')
export const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—')
export const signed = (value) => `${value > 0 ? '+' : ''}${fmt(value)}`

export const LABELS = { T1: 'Разгрузка дорог', T2: 'Доступность ОТ', E1: 'Озеленение', E2: 'Качество воздуха', S1: 'Школы и детсады', S2: 'Поликлиники', B1: 'Безопасность улиц', B2: 'Безопасность дорожного движения', C1: 'Надёжность ЖКХ', C2: 'Скорость решения обращений' }
export const DIRECTIONS = { T: 'Транспорт', E: 'Экология', S: 'Соцсфера', B: 'Безопасность', C: 'Сервисы' }
export const DIRECTION_PHOTOS = { T: 'transport', E: 'ecology', S: 'social', B: 'safety', C: 'services' }
export const DIRECTION_COLORS = { T: 'var(--color-dir-t)', E: 'var(--color-dir-e)', S: 'var(--color-dir-s)', B: 'var(--color-dir-b)', C: 'var(--color-dir-c)' }
export const DISTRICT_NOTES = { 'Есиль': 'Деловой центр, пробки на мостах', 'Алматы': 'Старое ЖКХ', 'Сарыарка': 'Смог и мало зелени', 'Байконур': 'Без ярких перекосов', 'Нура': 'Отстаёт в соцсфере и транспорте' }
export const DEMO_SET = [
  { measure_id: 'M7', district: 'Нура' },
  { measure_id: 'M8', district: 'Нура' },
  { measure_id: 'M10', district: 'Нура' },
  { measure_id: 'M12', district: null },
  { measure_id: 'M5', district: 'Сарыарка' },
]
