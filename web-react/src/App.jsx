import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { AlertTriangle, ArrowRight, Check, CircleDot, Leaf, Plus, RefreshCw, Sparkles, Zap } from 'lucide-react'
import { DEMO_SET, DIRECTIONS, DIRECTION_COLORS, DIRECTION_PHOTOS, DISTRICT_NOTES, LABELS, api, fmt, num, signed } from './api.js'

const ease = [0.22, 1, 0.36, 1]
const PAGES = [['city', 'Город'], ['decisions', 'Решения'], ['result', 'Результат'], ['events', 'События'], ['agent', 'AI-аким'], ['optimizer', 'Оптимизатор']]

function Counter({ value, digits = 2, className = '' }) {
  const motionValue = useMotionValue(value ?? 0)
  const [text, setText] = useState(fmt(value ?? 0, digits))
  const previous = useRef(value ?? 0)
  useEffect(() => {
    if (typeof value !== 'number') return
    const controls = animate(motionValue, value, { duration: 1.1, ease, onUpdate: (latest) => setText(fmt(latest, digits)) })
    previous.current = value
    return () => controls.stop()
  }, [value, digits, motionValue])
  return <span className={`tabular ${className}`}>{text}</span>
}

function Fade({ children, delay = 0, className = '' }) {
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.55, ease, delay }} className={className}>
      {children}
    </motion.div>
  )
}

function Letters({ text }) {
  return text.split('').map((letter, index) => (
    <motion.span key={index} className="inline-block" initial={{ opacity: 0, y: 48, rotateX: -40 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 0.7, delay: 0.15 + index * 0.09, ease }}>{letter}</motion.span>
  ))
}

function useTilt() {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-0.5, 0.5], [6, -6])
  const rotateY = useTransform(x, [-0.5, 0.5], [-6, 6])
  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    x.set((event.clientX - rect.left) / rect.width - 0.5)
    y.set((event.clientY - rect.top) / rect.height - 0.5)
  }
  const onLeave = () => { x.set(0); y.set(0) }
  return { rotateX, rotateY, onMove, onLeave }
}

function ScoreRing({ value, children }) {
  const radius = 88
  const length = 2 * Math.PI * radius
  const ratio = Math.min(1, Math.max(0, ((value ?? 40) - 40) / 30))
  return (
    <div className="relative grid place-items-center w-[240px] h-[240px] shrink-0">
      <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgb(23 46 50 / 10%)" strokeWidth="10" />
        <motion.circle cx="100" cy="100" r={radius} fill="none" stroke="var(--color-gold)" strokeWidth="10" strokeLinecap="round" strokeDasharray={length} initial={{ strokeDashoffset: length }} animate={{ strokeDashoffset: length * (1 - ratio) }} transition={{ duration: 1.4, ease, delay: 0.3 }} style={{ filter: 'drop-shadow(0 0 10px rgb(212 185 120 / 70%))' }} />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  )
}

function ScenarioPanel({ state, event, decisions, setPage }) {
  const measures = state?.measures ?? []
  const available = (state?.budget ?? 100) - (event?.budget_penalty ?? 0)
  const cost = decisions.reduce((sum, item) => sum + (measures.find((measure) => measure.id === item.measure_id)?.cost ?? 0), 0)
  return (
    <motion.aside initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.9, ease }} className="hidden lg:block absolute right-11 top-24 z-30 w-[300px] rounded-2xl border border-cream/20 bg-cream/10 backdrop-blur-xl p-5 text-cream shadow-[0_20px_60px_rgb(16_47_53/40%)]">
      <p className="eyebrow text-gold mb-1">Ваш сценарий</p>
      <div className="flex items-baseline justify-between mb-3"><span className="text-sm text-cream/75">Бюджет</span><span className="display text-[28px] tabular">{num(cost)} / {num(available)}</span></div>
      <div className="h-1.5 rounded-full bg-cream/15 overflow-hidden mb-4"><motion.div className="h-full bg-gold rounded-full" animate={{ width: `${Math.min(100, (cost / available) * 100)}%` }} transition={{ duration: 0.5, ease }} /></div>
      <ol className="list-none m-0 p-0 grid gap-1.5 mb-4">
        {Array.from({ length: 5 }, (_, index) => { const item = decisions[index]; const measure = item && measures.find((entry) => entry.id === item.measure_id); return (
          <li key={index} className={`flex items-center gap-2 text-[13px] rounded-lg px-2.5 py-1.5 border ${item ? 'border-cream/25 bg-cream/10' : 'border-dashed border-cream/25 text-cream/55'}`}><span className={`w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${item ? 'bg-gold text-ink' : 'bg-cream/15'}`}>{index + 1}</span><span className="truncate">{measure ? measure.name : 'Свободный слот'}</span></li>
        ) })}
      </ol>
      <button onClick={() => setPage('decisions')} className="btn btn-gold w-full min-h-[42px]">{decisions.length ? 'Продолжить' : 'Собрать сценарий'} <ArrowRight size={16} /></button>
    </motion.aside>
  )
}

function TopNav({ page, setPage, event }) {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (latest) => setScrolled(latest > 40))
  return (
    <header className={`sticky top-0 z-30 flex items-center gap-6 px-6 md:px-12 py-3 text-cream transition-all duration-500 ${scrolled ? 'bg-petrol/85 backdrop-blur-xl shadow-[0_10px_40px_rgb(16_47_53/30%)] border-b border-cream/10' : 'bg-petrol/60 backdrop-blur-md border-b border-transparent'}`}>
      <button onClick={() => setPage('city')} className="flex items-center gap-2 font-bold text-[13px] leading-tight text-left">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-gold/15 border border-gold/40"><Leaf className="text-gold" size={20} /></span>
        <span>Аким<br />на 5 часов</span>
      </button>
      <nav className="flex gap-1 mx-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PAGES.map(([id, label]) => (
          <button key={id} onClick={() => setPage(id)} className={`relative px-4 py-2 text-sm font-medium whitespace-nowrap transition ${page === id ? 'text-cream' : 'text-cream/70 hover:text-cream'}`}>
            {label}
            {page === id && <motion.span layoutId="nav-underline" className="absolute left-3 right-3 -bottom-1 h-0.5 bg-gold rounded-full" />}
          </button>
        ))}
      </nav>
      <span className="text-[13px] font-semibold tracking-widest opacity-80">{event ? <span className="text-negative-bg flex items-center gap-2"><CircleDot size={14} className="animate-pulse text-[#E07A5F]" /> {event.name}</span> : 'RU'}</span>
    </header>
  )
}

function Hero({ state, result, event, setPage, pending, decisions }) {
  const score = result?.simulation?.score ?? state?.base_score
  const alive = Boolean(result && result.simulation.delta > 0)
  const budget = (state?.budget ?? 100) - (event?.budget_penalty ?? 0)
  const { scrollY } = useScroll()
  const parallax = useTransform(scrollY, [0, 700], [0, 140])
  return (
    <section className="relative overflow-hidden rounded-[20px] bg-petrol text-cream shadow-[0_12px_36px_rgb(16_47_53/8%)] min-h-[560px]">
      <motion.div className="absolute inset-[-10%_0]" style={{ y: parallax }}>
        <motion.img src="/app/assets/hero-city.jpg" alt="" className="absolute inset-0 w-full h-full object-cover object-[62%_55%]" initial={{ scale: 1, filter: 'saturate(0.82) brightness(0.72)' }} animate={{ scale: [1, 1.08], filter: pending ? 'saturate(0.7) brightness(0.65)' : alive ? 'saturate(1.05) brightness(1)' : 'saturate(0.82) brightness(0.78)' }} transition={{ scale: { duration: 20, ease: 'linear', repeat: Infinity, repeatType: 'mirror' }, filter: { duration: 1.4, ease } }} />
      </motion.div>
      <motion.div className="absolute inset-0 pointer-events-none mix-blend-screen" style={{ background: 'radial-gradient(ellipse 70% 60% at 68% 42%, rgb(212 185 120 / 40%), transparent 70%)' }} animate={{ opacity: alive ? 1 : 0 }} transition={{ duration: 1.2, delay: 0.4, ease }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgb(16 47 53 / 85%) 0%, rgb(16 47 53 / 45%) 38%, transparent 62%)' }} />
      <div className="absolute inset-0 pointer-events-none opacity-15" style={{ backgroundImage: 'linear-gradient(rgb(247 243 233 / 40%) 1px, transparent 1px), linear-gradient(90deg, rgb(247 243 233 / 40%) 1px, transparent 1px)', backgroundSize: '96px 96px', maskImage: 'radial-gradient(ellipse at 70% 30%, #000 20%, transparent 70%)' }} />
      <div aria-hidden className="display absolute left-6 md:left-11 top-6 md:top-12 text-cream leading-[0.9] select-none pointer-events-none" style={{ fontSize: 'clamp(80px, 13vw, 200px)', letterSpacing: '-0.02em', textShadow: '0 10px 40px rgb(16 47 53 / 60%)', perspective: '600px' }}>
        <Letters text="АСТАНА" />
      </div>
      <motion.img src="/app/assets/bayterek-cutout.png" alt="" className="absolute -top-[4%] h-[118%] w-auto pointer-events-none z-[5]" style={{ right: 'clamp(6%, 16vw, 22%)', filter: 'drop-shadow(0 20px 40px rgb(16 47 53 / 70%))' }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.2, ease }} />
      <div className="relative z-10 max-w-[560px] px-6 md:px-11 pt-[clamp(180px,29vw,300px)] pb-10">
        <Fade delay={0.5}><h1 className="display text-[clamp(30px,3.4vw,46px)] leading-[1.05] mb-3">Город начинается<br />с ваших решений</h1></Fade>
        <Fade delay={0.6}><p className="text-cream/80 max-w-[420px] mb-6">Реальный город. Реальные вызовы.<br />Попробуйте, каким будет завтра.</p></Fade>
        <Fade delay={0.7}><button onClick={() => setPage('decisions')} className="btn btn-gold min-h-[52px] px-8 text-[17px]">Начать управление <ArrowRight size={18} /></button></Fade>
        <Fade delay={0.8}>
          <dl className="flex gap-8 mt-6">
            <div className="pr-8 border-r border-cream/25">
              <dt className="text-[12px] uppercase tracking-widest text-cream/70">{result ? 'Score после расчёта' : 'Текущий Score города'}</dt>
              <dd className="flex items-baseline gap-3"><Counter value={score} className="display text-[clamp(36px,4vw,54px)]" />{result && <span className={`px-3 py-1 rounded-full text-sm font-semibold ${result.simulation.delta > 0 ? 'bg-gold text-ink' : 'bg-negative text-cream'}`}>{signed(result.simulation.delta)}</span>}</dd>
            </div>
            <div>
              <dt className="text-[12px] uppercase tracking-widest text-cream/70">Бюджет</dt>
              <dd><Counter value={budget} digits={0} className="display text-[clamp(36px,4vw,54px)]" /></dd>
            </div>
          </dl>
        </Fade>
        {pending && <p className="mt-4 text-gold text-sm flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Считаем результат…</p>}
      </div>
      <ScenarioPanel state={state} event={event} decisions={decisions} setPage={setPage} />
      <p aria-hidden className="absolute right-6 md:right-11 top-8 md:top-16 lg:hidden text-right text-[11px] tracking-[0.24em] uppercase leading-[1.7] text-cream/80">Большие<br />возможности<br />начинаются<br />здесь</p>
      <p aria-hidden className="absolute right-6 md:right-11 bottom-6 md:bottom-10 text-right text-[11px] tracking-[0.24em] uppercase leading-[1.7] text-cream/80">Астана<br />Казахстан</p>
    </section>
  )
}

function DistrictStrip({ state }) {
  return (
    <ul className="card grid grid-cols-1 md:grid-cols-5 mt-4 mb-8 px-6 py-4 list-none m-0">
      {(state?.districts ?? []).map((district, index) => (
        <motion.li key={district.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 + index * 0.08, duration: 0.4, ease }} className="grid grid-cols-[1fr_auto] gap-x-3 px-4 first:pl-0 border-t md:border-t-0 md:border-l border-line first:border-0 py-2 md:py-0">
          <strong className="display text-[17px]">{district.name}</strong>
          <span className="col-start-1 text-[12px] uppercase tracking-wider text-muted">{DISTRICT_NOTES[district.name]}</span>
          <em className="col-start-2 row-start-1 row-span-2 self-center display not-italic text-[22px] text-petrol-soft tabular">{fmt(district.base_score)}</em>
        </motion.li>
      ))}
    </ul>
  )
}

function CityScreen({ state, result, event, setPage, pending, decisions }) {
  return (
    <div>
      <Hero state={state} result={result} event={event} setPage={setPage} pending={pending} decisions={decisions} />
      <DistrictStrip state={state} />
      <div className="flex items-end justify-between gap-6 mb-6">
        <div><p className="eyebrow mb-2">Астана сегодня</p><h2 className="display text-[28px]">Пять районов — один город</h2></div>
        <button onClick={() => setPage('decisions')} className="btn btn-light">К решениям →</button>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(state?.districts ?? []).map((district, index) => {
          const entries = Object.entries(district.indicators)
          const critical = entries.filter(([, value]) => value < 40).length
          const lowest = entries.reduce((best, item) => (item[1] < best[1] ? item : best))
          return (
            <Fade key={district.name} delay={index * 0.06} className="card p-6 relative overflow-hidden"><span className="absolute left-0 top-0 h-full w-1.5" style={{ background: district.base_score < 55 ? 'var(--color-dir-s)' : 'var(--color-positive)' }} />
              <div className="flex justify-between items-start gap-3">
                <div><h3 className="display text-[20px]">{district.name}</h3><small className="text-muted">{num(district.population * 100)}% населения</small></div>
                <strong className="display text-[40px] tabular">{fmt(district.base_score)}</strong>
              </div>
              <p className="text-[13px] text-muted mt-3">Слабый показатель: {LABELS[lowest[0]]} · {num(lowest[1])}{critical > 0 && <b className="text-negative"> · Критично: {critical}</b>}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-[12px]">
                {entries.map(([id, value]) => (
                  <div key={id}>
                    <div className="flex justify-between gap-2"><span className="text-muted truncate">{LABELS[id]}</span><strong className={value < 40 ? 'text-negative' : ''}>{num(value)}{value < 40 ? ' !' : ''}</strong></div>
                    <div className="h-1 bg-surface-muted rounded-full overflow-hidden mt-1"><motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.8, delay: 0.3 + index * 0.05, ease }} className="h-full" style={{ background: value < 40 ? 'var(--color-negative)' : 'var(--color-dir-e)' }} /></div>
                  </div>
                ))}
              </div>
            </Fade>
          )
        })}
      </div>
    </div>
  )
}

function MeasureCard({ measure, decision, districts, onToggle, onDistrict, index }) {
  const selected = Boolean(decision)
  const effects = Object.entries(measure.effects).map(([id, value]) => `${LABELS[id]} ${value > 0 ? '+' : ''}${num(value)}`).join(' · ')
  const tilt = useTilt()
  return (
    <motion.article initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} whileHover={{ y: -6 }} onMouseMove={tilt.onMove} onMouseLeave={tilt.onLeave} style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformPerspective: 900 }} transition={{ duration: 0.5, delay: (index % 6) * 0.06, ease }} className={`group card overflow-hidden flex flex-col will-change-transform ${selected ? 'selected-glow' : 'hover:shadow-[0_24px_60px_rgb(16_47_53/16%)]'}`}>
      <div className="aspect-[16/8] overflow-hidden border-b border-line relative">
        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 ease-out group-hover:scale-110" style={{ backgroundImage: `url('/app/assets/dir-${DIRECTION_PHOTOS[measure.direction]}.jpg')` }} />
        <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${DIRECTION_COLORS[measure.direction]}55, transparent 60%)` }} />
      </div>
      <label className="flex items-start gap-3 p-4 pb-0 cursor-pointer">
        <span className="display text-[17px] leading-tight flex-1">{measure.name}</span>
        <input type="checkbox" checked={selected} onChange={onToggle} className="sr-only" />
        <motion.span animate={selected ? { scale: [1, 1.25, 1] } : { scale: 1 }} transition={{ duration: 0.4 }} className={`w-[26px] h-[26px] rounded-full border-2 grid place-items-center shrink-0 transition ${selected ? 'bg-gold border-gold' : 'border-line bg-surface group-hover:border-gold'}`}>{selected && <Check size={14} className="text-ink" strokeWidth={3} />}</motion.span>
      </label>
      <div className="flex justify-between gap-4 px-4 pt-2 text-[13px] text-muted"><span>{measure.id} · {measure.type === 'C' ? 'Весь город' : 'Один район'}</span><strong className="text-ink">{num(measure.cost)} ед. бюджета</strong></div>
      <p className="px-4 pt-2 text-sm m-0">{effects}</p>
      <span className="block px-4 pt-2 pb-4 text-[13px] text-warning">Начало эффекта: {measure.lag + 1}-й квартал</span>
      {measure.type === 'R' && selected && (
        <select value={decision.district ?? ''} onChange={(event) => onDistrict(event.target.value || null)} className="mx-4 mb-4 min-h-[44px] rounded-lg border border-line bg-surface px-3">
          <option value="">Выберите район</option>
          {districts.map((district) => <option key={district.name} value={district.name}>{district.name}</option>)}
        </select>
      )}
    </motion.article>
  )
}

function BudgetPanel({ state, event, decisions, validation, onCalculate, calculating }) {
  const total = state?.budget ?? 100
  const available = validation?.budget ?? total - (event?.budget_penalty ?? 0)
  const cost = validation?.total_cost ?? decisions.reduce((sum, item) => sum + (state?.measures.find((measure) => measure.id === item.measure_id)?.cost ?? 0), 0)
  const measures = state?.measures ?? []
  return (
    <aside className="bg-petrol text-cream rounded-[14px] p-6 sticky top-[84px]">
      <p className="eyebrow text-gold mb-2">Бюджет</p>
      <p className="text-cream/70 text-sm mb-4">{event ? `${event.name} · на ликвидацию ${num(event.budget_penalty)}` : 'Без события'}</p>
      <dl className="grid grid-cols-3 gap-3 mb-4">
        {[['Доступно', available, 'text-gold text-[40px]'], ['Выбрано', cost, 'text-[30px]'], ['Остаток', available - cost, `text-[30px] ${available - cost < 0 ? 'text-[#E07A5F]' : ''}`]].map(([label, value, cls]) => (
          <div key={label}><dt className="text-[11px] uppercase tracking-widest text-cream/65">{label}</dt><dd className={`display leading-none ${cls}`}><Counter value={value} digits={0} /></dd></div>
        ))}
      </dl>
      <div className="flex h-3 rounded-full overflow-hidden bg-cream/10 gap-[3px] mb-2">
        {decisions.map((item) => { const measure = measures.find((entry) => entry.id === item.measure_id); return measure ? <motion.div key={item.measure_id} layout initial={{ width: 0 }} animate={{ width: `${(measure.cost / total) * 100}%` }} transition={{ duration: 0.4, ease }} style={{ background: DIRECTION_COLORS[measure.direction] }} className="h-full rounded-full" /> : null })}
        {event && <div className="h-full rounded-full" style={{ width: `${(event.budget_penalty / total) * 100}%`, background: 'repeating-linear-gradient(135deg, #A04436 0 4px, rgb(160 68 54 / 55%) 4px 8px)' }} title={`Потеря бюджета: ${num(event.budget_penalty)}`} />}
      </div>
      {event && <p className="text-[13px] text-negative-bg mb-3">Событие «{event.name}»: −{num(event.budget_penalty)} ед., доступно {num(available)}.</p>}
      <p className="text-sm mb-2">Выберите <strong>ровно 5 решений</strong> · {decisions.length} / 5</p>
      <ol className="list-none p-0 m-0 grid gap-2 mb-4">
        {Array.from({ length: 5 }, (_, index) => {
          const item = decisions[index]
          const measure = item && measures.find((entry) => entry.id === item.measure_id)
          return (
            <motion.li key={item ? item.measure_id : `empty-${index}`} layout initial={{ opacity: 0, scale: 0.85, x: -30 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }} className={`flex items-center gap-3 min-h-[46px] px-3 py-2 rounded-lg text-[13px] border ${item ? 'border-solid bg-cream/10 border-cream/25' : 'border-dashed border-cream/30 text-cream/60'}`}>
              <span className={`w-[26px] h-[26px] rounded-full grid place-items-center font-bold shrink-0 ${item ? 'bg-gold text-ink' : 'bg-cream/15'}`}>{item ? index + 1 : <Plus size={14} />}</span>
              {item ? <span className="flex flex-col leading-tight min-w-0"><strong className="font-semibold truncate">{measure?.name ?? item.measure_id}</strong><small className="text-cream/65">{measure?.type === 'C' ? 'весь город' : item.district ?? 'район не выбран'} · {num(measure?.cost)} ед.</small></span> : <span>Выберите решение</span>}
            </motion.li>
          )
        })}
      </ol>
      <div className="text-[13px] mb-4 min-h-[20px]">
        {validation?.valid ? <p className="text-sage flex items-center gap-2 m-0"><Check size={14} /> Набор готов к расчёту.</p> : validation?.errors?.length ? <ul className="m-0 pl-4 text-warning-bg space-y-1">{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
      </div>
      <button onClick={onCalculate} disabled={!validation?.valid || calculating} className="btn btn-gold w-full">{calculating ? 'Рассчитываем…' : 'Рассчитать результат →'}</button>
      <p className="text-cream/65 text-[13px] mt-3 mb-0">Не больше двух мер из одного направления. Для районных мер выберите район.</p>
    </aside>
  )
}

function DecisionsScreen({ state, event, decisions, setDecisions, validation, onCalculate, calculating }) {
  const groups = Object.keys(DIRECTIONS).map((direction) => [direction, (state?.measures ?? []).filter((measure) => measure.direction === direction)])
  const toggle = (measure) => setDecisions((current) => (current.some((item) => item.measure_id === measure.id) ? current.filter((item) => item.measure_id !== measure.id) : [...current, { measure_id: measure.id, district: null }]))
  const setDistrict = (measure, district) => setDecisions((current) => current.map((item) => (item.measure_id === measure.id ? { ...item, district } : item)))
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
        <div><p className="eyebrow mb-2">Решения</p><h2 className="display text-[32px] leading-tight">Пять решений для города</h2><p className="text-muted mt-2 max-w-[560px]">Выбирайте меры, которые сделают Астану комфортнее, современнее и устойчивее.</p></div>
        <div className="flex gap-2"><button onClick={() => setDecisions(DEMO_SET.map((item) => ({ ...item })))} className="btn btn-light">Демо-сценарий</button><button onClick={() => setDecisions([])} className="btn btn-light">Сбросить выбор</button></div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div>
          {groups.map(([direction, measures]) => (
            <section key={direction} className="mb-8">
              <h3 className="display text-[20px] mb-4 flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: DIRECTION_COLORS[direction] }} />{DIRECTIONS[direction]}</h3>
              <div className="grid md:grid-cols-2 gap-6">
                {measures.map((measure, index) => <MeasureCard key={measure.id} measure={measure} index={index} decision={decisions.find((item) => item.measure_id === measure.id)} districts={state?.districts ?? []} onToggle={() => toggle(measure)} onDistrict={(district) => setDistrict(measure, district)} />)}
              </div>
            </section>
          ))}
        </div>
        <BudgetPanel state={state} event={event} decisions={decisions} validation={validation} onCalculate={onCalculate} calculating={calculating} />
      </div>
    </div>
  )
}

const ANALYSIS_BLOCKS = [['strengths', 'Что улучшилось', 'text-positive'], ['tradeoffs', 'Чем пришлось пожертвовать', 'text-warning'], ['risks', 'Что осталось критичным', 'text-negative'], ['consequences', 'Последствия', 'text-petrol-soft']]

function ResultScreen({ state, result, event, explaining, applyRecommendation, setPage, stale }) {
  const simulation = result?.simulation
  if (!simulation) return <div className="card p-12 text-center text-muted">Выберите валидный набор из пяти мер и нажмите «Рассчитать». <button onClick={() => setPage('decisions')} className="btn btn-gold ml-4">К решениям</button></div>
  const analysis = result.analysis
  const positive = simulation.delta > 0
  return (
    <div>
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-6 mb-8 items-stretch">
        <div className="py-4">
          <p className="eyebrow mb-2">Астана сегодня</p>
          <h2 className="display text-[clamp(36px,4.6vw,64px)] leading-[1.05] mb-3">{positive ? 'Город стал лучше' : 'Город изменился'}</h2>
          <p className="text-muted mb-4">{positive ? 'Ваши решения меняют реальность.' : 'Балл не вырос — посмотрите, что можно сделать иначе.'}</p>
          <div className="flex items-center gap-6 flex-wrap">
            <ScoreRing value={simulation.score}><Counter value={simulation.score} className="display text-[56px] leading-none block" /><span className="text-[11px] uppercase tracking-widest text-muted">Score</span></ScoreRing>
            <div>
              <motion.span initial={{ opacity: 0, scale: 0.5, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 1.2 }} className={`inline-block px-5 py-3 rounded-xl font-bold text-2xl ${positive ? 'bg-gold text-ink' : 'bg-negative-bg text-negative'}`}>{signed(simulation.delta)} балла</motion.span>
              <ul className="list-none m-0 mt-5 p-0 grid gap-2 w-[280px] max-w-full">
                {simulation.districts.map((district, index) => (
                  <li key={district.name} className="text-[12px]">
                    <div className="flex justify-between"><span>{district.name}</span><span className="tabular"><span className="text-muted">{fmt(district.score_before)}</span> → <strong>{fmt(district.score_after)}</strong></span></div>
                    <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden mt-1"><motion.div className="h-full rounded-full" style={{ background: district.score_after < 55 ? 'var(--color-dir-s)' : 'var(--color-positive)' }} initial={{ width: `${district.score_before}%` }} animate={{ width: `${district.score_after}%` }} transition={{ duration: 1, delay: 1.4 + index * 0.12, ease }} /></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-muted text-sm mt-3">{fmt(simulation.base_score)} → {fmt(simulation.score)} · бюджет {num(simulation.total_cost)} из {num(simulation.budget)} · критических показателей: {simulation.n_crit} · самый слабый район: {simulation.min_district.name} ({fmt(simulation.min_district.score)})</p>
          {event && <p className="text-sm text-warning mt-2">Событие «{event.name}» учтено: базовый Score и показатели «до» уже с его эффектом.</p>}
          {stale && <p className="mt-4 px-4 py-3 rounded-lg bg-warning-bg text-warning text-sm flex items-center gap-2"><AlertTriangle size={16} /> Набор изменился после расчёта — результат устарел. Пересчитайте.</p>}
        </div>
        <figure className="relative m-0 min-h-[260px] rounded-[20px] overflow-hidden shadow-[0_12px_36px_rgb(16_47_53/8%)]">
          <motion.img src="/app/assets/hero-result.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" initial={{ filter: 'saturate(0.8) brightness(0.8)' }} animate={{ filter: positive ? 'saturate(1) brightness(1)' : 'saturate(0.85) brightness(0.85)' }} transition={{ duration: 1.4, delay: 0.4, ease }} />
          <motion.div className="absolute inset-0 mix-blend-screen" style={{ background: 'radial-gradient(ellipse 70% 60% at 60% 40%, rgb(212 185 120 / 45%), transparent 70%)' }} initial={{ opacity: 0 }} animate={{ opacity: positive ? 0.9 : 0 }} transition={{ duration: 1.2, delay: 0.6 }} />
          <figcaption className="absolute right-4 bottom-4 text-right text-[11px] tracking-[0.22em] uppercase text-cream drop-shadow">Современный город<br />для больших людей</figcaption>
        </figure>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {[['Score: было → стало', `${fmt(simulation.base_score)} → ${fmt(simulation.score)}`, `${signed(simulation.delta)} к базовому сценарию`], ['Бюджет программы', `${num(simulation.total_cost)} / ${num(simulation.budget)}`, `Остаток: ${num(simulation.budget_left)}`], ['Критических показателей', String(simulation.n_crit), `Самый слабый район: ${simulation.min_district.name} (${fmt(simulation.min_district.score)})`]].map(([label, value, note], index) => (
          <Fade key={label} delay={0.2 + index * 0.1} className="card p-6 relative overflow-hidden"><span className="absolute -right-10 -top-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgb(212 185 120 / 35%), transparent 70%)' }} /><p className="eyebrow mb-3">{label}</p><strong className="display text-[clamp(28px,2.8vw,40px)] block tabular">{value}</strong><p className="text-[13px] text-muted mt-2 m-0">{note}</p></Fade>
        ))}
      </div>
      <Fade delay={0.5} className="card p-6 mb-6 overflow-x-auto">
        <h3 className="display text-[20px] mb-4">Районы: до → после</h3>
        <table className="w-full text-[13px] border-collapse">
          <thead><tr className="text-left text-muted"><th className="py-2 pr-3">Район</th><th className="py-2 pr-3">Оценка</th>{Object.keys(LABELS).map((id) => <th key={id} className="py-2 pr-2" title={LABELS[id]}>{id}</th>)}</tr></thead>
          <tbody>
            {simulation.districts.map((district) => (
              <tr key={district.name} className="border-t border-line">
                <th className="py-2 pr-3 text-left">{district.name}</th>
                <td className="py-2 pr-3 tabular"><span className="text-muted">{fmt(district.score_before)}</span> → <strong>{fmt(district.score_after)}</strong></td>
                {Object.keys(LABELS).map((id) => { const after = district.after[id]; const delta = after - district.before[id]; return <td key={id} className="py-2 pr-2 tabular"><span className={`inline-block px-2 py-1 rounded-md ${after < 40 ? 'bg-negative text-cream' : after < 55 ? 'bg-[#E9C46A]/60' : after <= 65 ? 'bg-dir-e/50' : 'bg-positive text-cream'}`}>{num(after)}{delta !== 0 && <small className="block text-[10px] opacity-80">Δ {signed(delta)}</small>}</span></td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </Fade>
      <Fade delay={0.6} className="card p-6 mb-6">
        <h3 className="display text-[20px] mb-2">Как рассчитано</h3>
        <p className="text-sm text-muted">Score = 0,7 × среднее по городу + 0,3 × слабейший район − число критических показателей. Эффект меры учитывается с множителем (8 − лаг) / 8, синергии лагом не масштабируются.</p>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div><p className="eyebrow mb-2">Вклад мер</p><ul className="m-0 pl-4 text-sm space-y-1">{simulation.contributions.map((item) => <li key={item.measure_id}>{state?.measures.find((measure) => measure.id === item.measure_id)?.name ?? item.measure_id} · {item.district ?? 'весь город'} · <strong className="text-positive">{signed(item.delta_score)}</strong></li>)}</ul></div>
          <div><p className="eyebrow mb-2">Синергии</p>{simulation.synergies.length ? <ul className="m-0 pl-4 text-sm">{simulation.synergies.map((item) => <li key={item.pair.join()}>{item.pair.join(' + ')} · {item.district} · {LABELS[item.indicator]} +{num(item.bonus)}</li>)}</ul> : <p className="text-sm text-muted m-0">В этом наборе нет синергий.</p>}</div>
        </div>
      </Fade>
      <Fade delay={0.7} className="bg-petrol text-cream rounded-[14px] p-6 relative overflow-hidden">
        <div className="absolute -left-[20%] -top-[40%] w-[60%] h-[120%] pointer-events-none" style={{ background: 'radial-gradient(ellipse, rgb(212 185 120 / 22%), transparent 70%)' }} />
        <div className="relative">
          <div className="flex items-center justify-between gap-4 mb-4"><h3 className="display text-[22px] m-0">Записка советника</h3>{result.source && <span className="px-3 py-1 rounded-full bg-gold text-ink text-xs font-semibold">{result.source === 'ai' ? 'Анализ AI' : 'Шаблонный анализ · без AI'}</span>}</div>
          {explaining && <p className="text-cream/70 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Готовим анализ…</p>}
          {analysis && (
            <div>
              <p className="text-cream/90 mb-6">{analysis.summary}</p>
              <div className="grid md:grid-cols-2 gap-6">
                {ANALYSIS_BLOCKS.map(([key, title]) => (
                  <div key={key} className="border-t border-cream/15 pt-4"><h4 className="text-gold text-[15px] font-semibold mb-2">{title}</h4>{analysis[key]?.length ? <ul className="m-0 pl-4 text-sm space-y-1 text-cream/85">{analysis[key].map((item, index) => <li key={index}>{typeof item === 'string' ? item : item.text}</li>)}</ul> : <p className="text-sm text-cream/60 m-0">Не отмечено в анализе.</p>}</div>
                ))}
              </div>
              <div className="border-t border-cream/15 pt-4 mt-6">
                <h4 className="text-gold text-[15px] font-semibold mb-3">Что попробовать иначе</h4>
                {analysis.recommendations?.length ? <ul className="m-0 p-0 list-none grid gap-3">{analysis.recommendations.map((item, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-3 bg-cream/8 rounded-lg px-4 py-3 text-sm"><span>{typeof item === 'string' ? item : item.text}{typeof item !== 'string' && typeof item.score === 'number' && <small className="block text-cream/60">Score станет {fmt(item.score)}</small>}</span>{typeof item !== 'string' && item.replace && <button onClick={() => applyRecommendation(item)} className="btn btn-gold min-h-[38px]">Применить</button>}</li>)}</ul> : <p className="text-sm text-cream/60 m-0">Рекомендаций нет — набор уже сбалансирован.</p>}
              </div>
            </div>
          )}
        </div>
      </Fade>
    </div>
  )
}

function EventsScreen({ events, event, selectEvent, state }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
        <div><p className="eyebrow mb-2">События</p><h2 className="display text-[32px] leading-tight">Когда город меняет ваши планы</h2><p className="text-muted mt-2 max-w-[600px]">Событие меняет исходные показатели и уменьшает бюджет на ликвидацию последствий. После выбора набор мер проверяется заново.</p></div>
        <button onClick={() => selectEvent(null)} disabled={!event} className="btn btn-light">Без события</button>
      </div>
      <AnimatePresence>{event && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 px-6 py-4 rounded-[14px] bg-negative-bg text-negative flex flex-wrap items-center gap-3"><CircleDot size={16} className="animate-pulse" /><strong>{event.name}</strong><span>{event.district ? `район ${event.district}` : 'все районы'} · бюджет {num(state?.budget)} → <b>{num((state?.budget ?? 100) - event.budget_penalty)}</b></span></motion.div>}</AnimatePresence>
      <div className="grid md:grid-cols-2 gap-4">
        {events.map((item, index) => {
          const active = event?.id === item.id
          return (
            <Fade key={item.id} delay={index * 0.06} className={`card p-6 border-l-4 ${active ? 'ring-2 ring-gold' : ''}`} >
              <div style={{ borderColor: DIRECTION_COLORS[['S', 'T', 'B', 'E', 'C'][index % 5]] }}>
                <h3 className="display text-[20px] mb-2">{item.name}</h3>
                <p className="text-sm text-muted mb-4">{item.description}</p>
                <dl className="grid gap-1 text-[13px] mb-3 m-0"><div>Затронутый район: <strong>{item.district ?? 'Все районы'}</strong></div><div>Штраф бюджета: <strong className="text-negative">−{num(item.budget_penalty)}</strong></div><div>Доступный бюджет: <strong>{num((state?.budget ?? 100) - item.budget_penalty)}</strong></div></dl>
                <p className="text-[13px] text-petrol-soft mb-4">{Object.entries(item.effects).map(([id, value]) => `${LABELS[id]} ${num(value)}`).join(' · ')}</p>
                <button onClick={() => selectEvent(active ? null : item)} className={`btn ${active ? 'btn-dark' : 'btn-gold'}`}>{active ? <><Check size={16} /> Выбрано</> : 'Выбрать событие'}</button>
              </div>
            </Fade>
          )
        })}
      </div>
    </div>
  )
}

function AgentScreen({ event, agent, runAgent, applyPlan, state }) {
  const [goal, setGoal] = useState('')
  const plan = agent.result
  return (
    <div>
      <figure className="relative m-0 mb-6 h-[clamp(160px,22vw,240px)] rounded-[20px] overflow-hidden shadow-[0_12px_36px_rgb(16_47_53/8%)]">
        <img src="/app/assets/hero-agent.jpg" alt="" className="w-full h-full object-cover object-[center_60%] saturate-[.85]" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgb(16 47 53 / 80%), transparent 45%, rgb(16 47 53 / 70%))' }} />
        <figcaption className="absolute inset-0 flex justify-between items-end p-6 text-[11px] tracking-[0.22em] uppercase text-cream"><span>Больше данных<br />больше возможностей<br />лучшей Астане</span><span className="text-right">Город<br />в твоих<br />решениях</span></figcaption>
      </figure>
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] gap-6 items-start">
        <div>
          <p className="eyebrow mb-2">Ваш AI-помощник</p>
          <h2 className="display text-[clamp(40px,5vw,64px)] leading-none mb-4">AI-аким</h2>
          <label className="block font-bold text-lg mb-3" htmlFor="goal">Какой вы хотите видеть Астану?</label>
          <textarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Например, подтянуть Нуру, сохранив общий Score." className="w-full min-h-[132px] rounded-lg border border-line bg-surface p-4" />
          <p className="text-sm text-muted mt-3">Опишите приоритеты. AI предложит программу, а движок проверит ограничения и рассчитает результат — каждый шаг ниже настоящий.{event && <> Событие «{event.name}» учитывается.</>}</p>
          <button onClick={() => runAgent(goal)} disabled={agent.busy} className="btn btn-gold mt-4">{agent.busy ? <><RefreshCw size={16} className="animate-spin" /> Проверяем варианты…</> : <><Sparkles size={16} /> Спросить AI-акима</>}</button>
          {agent.error && <p className="mt-4 text-negative text-sm">{agent.error}</p>}
          {agent.busy && (
            <div className="mt-8" aria-live="polite">
              <p className="flex items-center gap-3 text-sm font-semibold text-petrol-soft mb-4"><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-gold opacity-75 animate-ping" /><span className="relative inline-flex rounded-full h-3 w-3 bg-gold" /></span>AI-аким анализирует город…</p>
              <div className="grid gap-2">{[0, 1, 2].map((index) => <div key={index} className="shimmer h-[58px] rounded-[14px]" style={{ animationDelay: `${index * 0.15}s` }} />)}</div>
            </div>
          )}
          {plan && (
            <div className="mt-8">
              <p className="eyebrow mb-3">Ход работы · {plan.steps.length} шагов · {plan.source === 'ai' ? 'план собрала модель' : 'план собран движком'}</p>
              <ol className="list-none m-0 p-0 grid gap-2">
                {plan.steps.map((step, index) => (
                  <motion.li key={index} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.14, duration: 0.4, ease }} className="card px-4 py-3 text-sm flex gap-3 items-start">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${step.action === 'simulate' ? 'bg-dir-e/50' : 'bg-dir-t/50'}`}>{step.action}</span>
                    <span><span className="text-muted">{step.decisions.map((item) => item.measure_id).join(', ')}</span><br />{step.summary}</span>
                  </motion.li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <aside className="bg-petrol text-cream rounded-[14px] p-6 sticky top-[84px]">
          <p className="eyebrow text-gold mb-2">План действий</p>
          <h3 className="display text-[22px] mb-4">Рекомендации AI-акима</h3>
          {!plan && <p className="text-cream/65 text-sm">Здесь появится проверенный набор из пяти мер и кнопка применения.</p>}
          {plan && (
            <div>
              <div className="flex items-baseline gap-3 mb-4"><Counter value={plan.simulation.score} className="display text-[48px] leading-none" /><span className="text-sm text-cream/70">Score · {signed(plan.simulation.delta)} к базе</span></div>
              <ol className="list-none m-0 p-0 grid gap-2 mb-4">
                {plan.decisions.map((item, index) => { const measure = state?.measures.find((entry) => entry.id === item.measure_id); return <li key={item.measure_id} className="flex gap-3 items-center bg-cream/10 rounded-lg px-3 py-2 text-sm"><span className="w-[26px] h-[26px] rounded-full bg-gold text-ink grid place-items-center font-bold shrink-0">{index + 1}</span><span><strong className="font-semibold">{measure?.name ?? item.measure_id}</strong><br /><small className="text-cream/65">{measure?.type === 'C' ? 'весь город' : item.district} · {num(measure?.cost)} ед.</small></span></li> })}
              </ol>
              <p className="text-sm text-cream/85 mb-4">{plan.explanation}</p>
              <button onClick={() => applyPlan(plan.decisions)} className="btn btn-gold w-full">Применить сценарий <ArrowRight size={16} /></button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function OptimizerScreen({ event, optimal, loadOptimal, applyPlan, state, busy }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
        <div><p className="eyebrow mb-2">Оптимизатор</p><h2 className="display text-[32px] leading-tight">Больше пользы на тот же бюджет</h2><p className="text-muted mt-2 max-w-[600px]">Движок перебирает все допустимые наборы по Score с учётом бюджета и ограничений. AI не участвует в расчёте чисел. {event ? `Событие «${event.name}» · бюджет ${num((state?.budget ?? 100) - event.budget_penalty)}` : 'Без события · бюджет 100'}.</p></div>
        <button onClick={loadOptimal} disabled={busy} className="btn btn-gold"><Zap size={16} /> {busy ? 'Ищем…' : 'Найти лучший набор'}</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {optimal.map((item, index) => (
          <Fade key={index} delay={index * 0.06} className="card p-6">
            <p className="eyebrow mb-2">Набор {index + 1}</p>
            <strong className="display text-[32px] block tabular">Score {fmt(item.score)}</strong>
            <p className="text-muted text-sm">Стоимость: {num(item.total_cost)}</p>
            <ul className="m-0 pl-4 text-sm space-y-1 mb-4">{item.decisions.map((decision) => <li key={decision.measure_id}>{state?.measures.find((measure) => measure.id === decision.measure_id)?.name ?? decision.measure_id} · {decision.district ?? 'весь город'}</li>)}</ul>
            <button onClick={() => applyPlan(item.decisions)} className="btn btn-dark w-full">Загрузить этот набор в решения</button>
          </Fade>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('city')
  const [state, setState] = useState(null)
  const [events, setEvents] = useState([])
  const [event, setEvent] = useState(null)
  const [decisions, setDecisions] = useState([])
  const [validation, setValidation] = useState(null)
  const [result, setResult] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [explaining, setExplaining] = useState(false)
  const [agent, setAgent] = useState({ busy: false, result: null, error: null })
  const [optimal, setOptimal] = useState([])
  const [optimizing, setOptimizing] = useState(false)
  const [notice, setNotice] = useState(null)
  const validationRequest = useRef(0)

  useEffect(() => {
    api.state().then(setState).catch((error) => setNotice(`${error.message} Проверьте, что сервер запущен.`))
    api.events().then((data) => setEvents(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  useEffect(() => {
    const requestId = ++validationRequest.current
    api.validate(decisions, event?.id ?? null).then((data) => { if (requestId === validationRequest.current) setValidation(data) }).catch((error) => { if (requestId === validationRequest.current) setValidation({ valid: false, errors: [error.message] }) })
  }, [decisions, event])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [page])

  const stale = useMemo(() => Boolean(result) && (JSON.stringify(result.decisions) !== JSON.stringify(decisions) || (result.event_id ?? null) !== (event?.id ?? null)), [result, decisions, event])

  const calculate = async () => {
    setCalculating(true)
    setNotice(null)
    const snapshot = decisions.map((item) => ({ ...item }))
    const eventId = event?.id ?? null
    try {
      const simulation = await api.simulate(snapshot, eventId)
      setResult({ simulation, decisions: snapshot, event_id: eventId, analysis: null, source: null })
      setPage('result')
      setExplaining(true)
      try {
        const explanation = await api.explain(snapshot, eventId)
        setResult((current) => (current && current.simulation === simulation ? { ...current, analysis: explanation.analysis, source: explanation.source } : current))
      } catch (error) {
        setNotice(`Расчёт сохранён, но анализ недоступен. ${error.message}`)
      } finally {
        setExplaining(false)
      }
    } catch (error) {
      setNotice(error.message)
    } finally {
      setCalculating(false)
    }
  }

  const applyRecommendation = (item) => {
    setDecisions((current) => current.map((decision) => (decision.measure_id === item.replace.from.measure_id ? { ...item.replace.to } : decision)))
    setPage('decisions')
  }

  const applyPlan = (plan) => { setDecisions(plan.map((item) => ({ ...item }))); setPage('decisions') }

  const selectEvent = (item) => { setEvent(item); setOptimal([]) }

  const runAgent = async (goal) => {
    setAgent({ busy: true, result: null, error: null })
    try {
      const data = await api.agent(goal.trim() || null, event?.id ?? null)
      setAgent({ busy: false, result: data, error: null })
    } catch (error) {
      setAgent({ busy: false, result: null, error: error.message })
    }
  }

  const loadOptimal = async () => {
    setOptimizing(true)
    try { setOptimal(await api.optimize(event?.id ?? null)) } catch (error) { setNotice(error.message) } finally { setOptimizing(false) }
  }

  return (
    <div className="min-h-screen">
      <TopNav page={page} setPage={setPage} event={event} />
      <main className="max-w-[1440px] mx-auto px-6 md:px-12 py-6">
        <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mb-6 px-6 py-4 rounded-lg bg-negative-bg text-negative border border-negative flex justify-between gap-4"><span>{notice}</span><button onClick={() => setNotice(null)} className="font-bold">×</button></motion.div>}</AnimatePresence>
        {!state && !notice && <p className="text-muted">Загружаем данные города…</p>}
        <AnimatePresence initial={false}>
          <motion.div key={page} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease }}>
            {page === 'city' && <CityScreen state={state} result={result} event={event} setPage={setPage} pending={calculating} decisions={decisions} />}
            {page === 'decisions' && <DecisionsScreen state={state} event={event} decisions={decisions} setDecisions={setDecisions} validation={validation} onCalculate={calculate} calculating={calculating} />}
            {page === 'result' && <ResultScreen state={state} result={result} event={event} explaining={explaining} applyRecommendation={applyRecommendation} setPage={setPage} stale={stale} />}
            {page === 'events' && <EventsScreen events={events} event={event} selectEvent={selectEvent} state={state} />}
            {page === 'agent' && <AgentScreen event={event} agent={agent} runAgent={runAgent} applyPlan={applyPlan} state={state} />}
            {page === 'optimizer' && <OptimizerScreen event={event} optimal={optimal} loadOptimal={loadOptimal} applyPlan={applyPlan} state={state} busy={optimizing} />}
          </motion.div>
        </AnimatePresence>
        <footer className="flex flex-wrap justify-between gap-4 text-muted border-t border-line pt-6 mt-12 text-[13px]"><span className="flex items-center gap-2"><Leaf size={14} className="text-gold" /> Аким на 5 часов · команда DEVour</span><span>Учебная модель · Числа считает движок, AI объясняет результат</span></footer>
      </main>
    </div>
  )
}
