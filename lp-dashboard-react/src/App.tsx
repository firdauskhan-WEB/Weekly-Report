import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import { Bar } from "@/components/charts/bar"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Grid } from "@/components/charts/grid"
import { Legend, LegendItem, LegendLabel, LegendMarker } from "@/components/charts/legend"
import { PieCenter } from "@/components/charts/pie-center"
import { PieChart } from "@/components/charts/pie-chart"
import { PieSlice } from "@/components/charts/pie-slice"
import { ChartTooltip, TooltipContent } from "@/components/charts/tooltip"

import { ErrorBoundary } from "./ErrorBoundary"
import { makeBulkDummy, makeDummy, makeEventDummy, makeKitchenDummy, type BulkEnquiry, type KitchenPayload } from "./dummy-data"
import swiggyIcon from "./Icons/swiggy.svg"
import zomatoIcon from "./Icons/Zomato.png"
import dineInIcon from "./Icons/Dine In.png"
import pickUpIcon from "./Icons/pick up.png"

// ⚠️ Web App URL (ends with /exec) of the ONE Apps Script that serves every cafe —
// deployed from apps-script/Code.gs (setup steps at its top)
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyW0rx3PlKUAJ56Jin_wUrNVbKgmQPvM1Te1A6GPnsfKQQdYBGlUUQEZ87oFlxb7PgYjQ/exec"
// id must match the cafe key in CAFES at the top of Code.gs
const CAFES = [
  { id: "lp", name: "LP Cafe" },
  { id: "bandra", name: "Bandra Cafe", lastYearCard: true },
]
// shortcut: true shows made-up numbers for every cafe; set to false once the Apps Script links are live
const USE_DUMMY = false
const DUMMY_SCALE: Record<string, number> = { lp: 1, bandra: 0.8 }
type Cafe = (typeof CAFES)[number]
const REFRESH_MS = 15 * 60 * 1000

const AMBER = "#c8963a", GREEN = "#8a9a6b", BERRY = "#8b5e83", CORAL = "#b5483a", PREV = "#dccfb0"
const SUBCOL: Record<string, string> = {
  Beverages: AMBER, Savoury: GREEN, Dessert: BERRY, Edit: CORAL,
  Bakery: AMBER, Pastry: BERRY, "Hot Kitchen": CORAL, "Sauces & Preps": GREEN,
}
const CHCOL = [AMBER, GREEN, BERRY, CORAL, "#5c3d22", "#d9803a", "#7a9cae", PREV]

type NV = { name: string; value: number }
type Item = { name: string; curr: number; prev: number; currQty: number; prevQty: number }
type VarianceRow = {
  dept: string; item: string; uom: string; opening: number | null; purchase: number | null; sale: number | null
  system: number | null; team: number | null; diff: number | null; reason: string
}
export type Payload = {
  error?: string
  kpis: {
    currTotal: number; prevTotal: number; lyTotal: number; currOrders: number; prevOrders: number
    currAOV: number; prevAOV: number; wowChange: number; yoyChange: number
  }
  dayWise: { day: string; curr: number; prev: number; orders: number }[]
  periodComparison: { label: string; value: number }[]
  subCategories: Item[]
  topBeverages: NV[]; topSavoury: NV[]; topDessert: NV[]; topEdit: NV[]
  channels: { name: string; curr: number; prev: number }[]
  areas: NV[]; areasPrev: NV[]
  hourly: { hour: number; sales: number }[]
  editSpotlight: { total: number; prevTotal: number; qty: number; prevQty: number; orders?: number; prevOrders?: number; items: Item[] }
  complaints?: {
    error?: string; total: number; validCount: number; byChannel: NV[]
    rows?: { date: string; channel: string; desc: string; item: string; valid: string; notes: string }[]
  }
  variance?: { error?: string; rows?: VarianceRow[] } | null
  ccg?: { error?: string; rows?: { item: string; cost: number | null; qty: number | null; amount: number | null; reason: string }[] } | null
  meta: { start?: string; end?: string; currDateRange: string; prevDateRange: string; totalRows: number; generatedAt: string }
}

const F = (n: number) => "INR " + Math.round(n || 0).toLocaleString("en-IN")
const S = (n: number) => {
  n = n || 0
  const a = Math.abs(n)
  return (n < 0 ? "-" : "") + "INR " + (a >= 1e5 ? (a / 1e5).toFixed(2) + "L" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : Math.round(a))
}
const chg = (c: number, p: number) => (p ? ((c - p) / p) * 100 : null)
const sign = (n: number) => (n >= 0 ? "+" : "") + n
const upDown = (n: number) => (n >= 0 ? "var(--gr)" : "var(--rd)")
// 13 -> "1 PM · Afternoon" (hourly tooltip only; the axis keeps 24h numbers)
const hourLabel = (h: number) =>
  `${h % 12 || 12} ${h < 12 ? "AM" : "PM"} · ${h < 5 || h >= 21 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"}`
const sumBy = (a: NV[] | undefined, re: RegExp) => (a || []).filter((x) => re.test(x.name)).reduce((s, x) => s + x.value, 0)

/* ── Small building blocks ── */

function Delta({ c, p, suf = "", lowerIsBetter = false }: { c: number; p: number; suf?: string; lowerIsBetter?: boolean }) {
  const v = chg(c, p)
  if (v === null) return <div className="dl n">no data</div>
  return <div className={"dl " + ((v >= 0) !== lowerIsBetter ? "u" : "d")}>{(v >= 0 ? "▲ +" : "▼ ") + Math.abs(v).toFixed(1) + "%" + suf}</div>
}
const Note = ({ children }: { children?: ReactNode }) => <div className="dl n">{children}</div>


const DINE_IN = <img alt="" className="brand-ic" src={dineInIcon} />
const PICK_UP = <img alt="" className="brand-ic" src={pickUpIcon} />
const SWIGGY = <img alt="" className="brand-ic" src={swiggyIcon} />
const ZOMATO = <img alt="" className="brand-ic" src={zomatoIcon} />

function Card({ ic, lb, vl, d, sb, c }: { ic: ReactNode; lb: string; vl: ReactNode; d?: ReactNode; sb?: ReactNode; c: string }) {
  return (
    <div className="kc" style={{ "--c": c } as CSSProperties}>
      <div className="ic">{ic}</div>
      <div className="lb">{lb}</div>
      <div className="vl">{vl}</div>
      {d}
      <div className="sb">{sb}</div>
    </div>
  )
}

const Sec = ({ children }: { children: ReactNode }) => <div className="sec">{children}</div>
const Box = ({ title, small, children, className = "" }: { title: ReactNode; small?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={"box " + className}>
    <h2>{title}{small && <small>{small}</small>}</h2>
    {children}
  </div>
)
const Dot = ({ c }: { c: string }) => <i className="dot" style={{ background: c }} />

function Top5({ name, list, total, onOpen }: { name: string; list: NV[]; total: number; onOpen?: () => void }) {
  const col = SUBCOL[name] || AMBER
  const ic = ({ Beverages: "☕", Savoury: "🥪", Dessert: "🍰", Edit: "✨", Bakery: "🥐", Pastry: "🍰", "Hot Kitchen": "🍲", "Sauces & Preps": "🥫", Others: "🎁" } as Record<string, string>)[name] || ""
  const mx = list.length ? list[0].value : 1
  const open = onOpen && {
    role: "button", tabIndex: 0, className: "box clickable", title: `See every ${name} item`, onClick: onOpen,
    onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen() } },
  }
  return (
    <div className="box" {...open}>
      <div className="t5h">
        <span><Dot c={col} />{ic} {name}</span>
        <span style={{ color: col }}>{F(total)}</span>
      </div>
      {list.length ? list.map((x, n) => (
        <div className="it" key={x.name}>
          <div className={"rk" + (n % 2 === 0 ? " p" : "")}>{n + 1}</div>
          <div>{x.name}<div className="br"><i style={{ width: (x.value / mx) * 100 + "%", background: col }} /></div></div>
          <b>{F(x.value)}</b>
        </div>
      )) : <div className="empty">No sales this week</div>}
      {onOpen && <div className="more">See all {name} items ›</div>}
    </div>
  )
}

// Every Edit item (this week vs previous) in a pop-up; Esc, the ✕ or a click outside closes it.
// Opened and closed straight on the <dialog> (no React state), so it always reopens.
function EditItems({ e, dialogRef }: { e: Payload["editSpotlight"]; dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const close = () => dialogRef.current?.close()
  const emx = Math.max(1, ...e.items.map((i) => i.curr))
  return (
    <dialog className="modal" onClick={(ev) => ev.target === dialogRef.current && close()} ref={dialogRef}>
      <div className="modal-head">
        <h2>✨ All Edit items<small>this week vs previous · {e.items.length} items</small></h2>
        <button aria-label="Close" onClick={close} type="button">✕</button>
      </div>
      {/* orders = orders containing at least one Edit item (needs the updated script) */}
      <div className="g g3 modal-cards">
        <Card ic="💰" lb="Total revenue" vl={S(e.total)} d={<Delta c={e.total} p={e.prevTotal} />} sb={"prev: " + S(e.prevTotal)} c="var(--gold)" />
        <Card ic="🧾" lb="Total orders" vl={e.orders ?? "—"} d={e.orders === undefined ? <Note>update the script</Note> : <Delta c={e.orders} p={e.prevOrders ?? 0} />}
          sb={e.orders === undefined ? "orders with an Edit item" : `prev: ${e.prevOrders ?? 0}`} c="var(--sage)" />
        <Card ic="📊" lb="Avg order value" vl={e.orders ? S(e.total / e.orders) : "—"}
          d={e.orders && e.prevOrders ? <Delta c={e.total / e.orders} p={e.prevTotal / e.prevOrders} /> : <Note>{e.orders === undefined ? "update the script" : "no data"}</Note>}
          sb={e.prevOrders ? "prev: " + S(e.prevTotal / e.prevOrders) : "per order with an Edit item"} c="var(--brown)" />
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>#</th><th className="l">Item name</th><th>Curr qty</th><th>Prev qty</th><th>Qty Δ</th><th>Curr sales</th><th>Prev sales</th><th>Sales Δ</th><th>Avg price</th><th>Bar</th></tr>
          </thead>
          <tbody>
            {e.items.length ? e.items.map((i, n) => {
              const s = i.curr - i.prev
              return (
                <tr key={i.name}>
                  <td>{n + 1}</td><td className="l">{i.name}</td><td>{i.currQty}</td><td>{i.prevQty}</td>
                  <td style={{ color: upDown(i.currQty - i.prevQty) }}>{sign(i.currQty - i.prevQty)}</td>
                  <td>{F(i.curr)}</td><td>{F(i.prev)}</td>
                  <td style={{ color: upDown(s) }}>{(s >= 0 ? "+" : "-") + F(Math.abs(s))}</td>
                  <td>{F(i.currQty ? i.curr / i.currQty : 0)}</td>
                  <td style={{ minWidth: 90 }}><div className="br"><i style={{ width: (i.curr / emx) * 100 + "%", background: CORAL }} /></div></td>
                </tr>
              )
            }) : <tr><td colSpan={10} className="empty">No Edit items in these dates</td></tr>}
          </tbody>
        </table>
      </div>
    </dialog>
  )
}

/* ── Charts (bklit) ── */

type Row = Record<string, unknown>
function Bars({ data, x, series, aspectRatio = "2 / 1", extra, title }: {
  data: Row[]; x: string; series: { key: string; color: string }[]; aspectRatio?: string
  extra?: (p: Row) => { color: string; label: string; value: string }[]
  title?: (p: Row) => string
}) {
  const rows = (p: Row) => [
    ...series.map((s) => ({ color: s.color, label: s.key, value: F(p[s.key] as number) })),
    ...(extra ? extra(p) : []),
  ]
  return (
    <BarChart data={data} xDataKey={x} aspectRatio={aspectRatio} margin={{ top: 8, right: 8, bottom: 40, left: 8 }}>
      <Grid horizontal />
      {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.color} lineCap="round" />)}
      <BarXAxis maxLabels={24} />
      <ChartTooltip
        content={({ point }) => <TooltipContent rows={rows(point)} title={title ? title(point) : String(point[x])} />}
        rows={rows}
      />
    </BarChart>
  )
}

function Donut({ list, label }: { list: NV[]; label: string }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const items = list.map((c, i) => ({ label: c.name, value: c.value, color: CHCOL[i % CHCOL.length] }))
  // Centre shows the total, or the hovered slice — rounded the same way as the cards (S): 2 decimals for lakhs, 1 for thousands
  const shown = hovered === null ? items.reduce((s, c) => s + c.value, 0) : items[hovered].value
  const digits = shown >= 1e5 ? 2 : shown >= 1e3 ? 1 : 0
  return (
    <div className="dn">
      <PieChart data={items} hoveredIndex={hovered} cornerRadius={8} innerRadius={75} onHoverChange={setHovered} padAngle={0.03} size={260}>
        {items.map((_, i) => <PieSlice index={i} key={i} />)}
        <PieCenter defaultLabel={label} formatOptions={{ notation: "compact", minimumFractionDigits: digits, maximumFractionDigits: digits }} prefix="INR " valueClassName="text-xl font-bold" />
      </PieChart>
      <Legend hoveredIndex={hovered} items={items} onHoverChange={setHovered}>
        <LegendItem className="flex items-center gap-2">
          <LegendMarker />
          <LegendLabel />
        </LegendItem>
      </Legend>
    </div>
  )
}

/* ── Data loading ── */

type Range = { start: string; end: string } // "YYYY-MM-DD"
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
// Last full Mon–Sun week
function lastWeek(): Range {
  const end = new Date()
  end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 1)
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  return { start: ymd(start), end: ymd(end) }
}

const RANGE_KEY = "dashboard:range"
const saved = <T,>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || "null") } catch { return null }
}
const save = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked or full */ }
}
const dummy = (id: string, r: Range) => makeDummy(id, DUMMY_SCALE[id] ?? 1, r.start, r.end)

// Data for every cafe, plus the ONE date range shared by all cafe pages.
// Load refills every cafe's Looker studio tab; the pages show what those tabs hold.
function useCafes() {
  const [range, setRange] = useState<Range>(() => saved<Range>(RANGE_KEY) || lastWeek())
  // Start from the last saved copies so the pages show data instantly
  const [data, setData] = useState<Record<string, Payload | null>>(() =>
    Object.fromEntries(CAFES.map((c) => [c.id, USE_DUMMY ? dummy(c.id, range) : saved<Payload>("dashboard:" + c.id)]))
  )
  const [loaded, setLoaded] = useState<Range>(range)
  const [kitchen, setKitchen] = useState<KitchenPayload | null>(() => (USE_DUMMY ? null : saved<KitchenPayload>("dashboard:kitchen")))
  const [kitchenError, setKitchenError] = useState("")
  const showKitchen = (k: KitchenPayload | undefined) => {
    if (!k) return setKitchenError("No kitchen answer — update the Apps Script")
    if (k.error) return setKitchenError(k.error)
    setKitchen(k)
    setKitchenError("")
    save("dashboard:kitchen", k)
  }
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<"" | "load" | "refresh">("")
  const latest = useRef(0) // only the newest request may update the pages

  const show = (id: string, d: Payload) => {
    setData((all) => ({ ...all, [id]: d }))
    setErrors((all) => ({ ...all, [id]: "" }))
    save("dashboard:" + id, d)
  }
  const fail = (id: string, e: unknown) => setErrors((all) => ({ ...all, [id]: e instanceof Error ? e.message : String(e) }))
  const call = async (query: string) => (await fetch(SCRIPT_URL + query)).json()

  // Read each cafe's Looker studio tab again. refresh=true skips the script's 30-min cache.
  const refresh = useCallback(async (hard = false) => {
    if (USE_DUMMY || !SCRIPT_URL) return
    const req = ++latest.current
    setBusy("refresh")
    await Promise.all([
      ...CAFES.map(async (c) => {
        try {
          const d: Payload = await call(`?cafe=${c.id}` + (hard ? "&refresh=1" : ""))
          if (req !== latest.current) return
          if (d.error) throw new Error(d.error)
          show(c.id, d)
        } catch (e) {
          if (req === latest.current) fail(c.id, e)
        }
      }),
      (async () => {
        try {
          const k: KitchenPayload = await call("?cafe=kitchen" + (hard ? "&refresh=1" : ""))
          if (req === latest.current) showKitchen(k)
        } catch (e) {
          if (req === latest.current) setKitchenError(e instanceof Error ? e.message : String(e))
        }
      })(),
    ])
    if (req === latest.current) setBusy("")
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- show/fail/call only use setters and constants

  // Load: the script refills EVERY cafe's Looker studio tab with this range and returns each dashboard
  const load = async (r: Range) => {
    save(RANGE_KEY, r)
    setLoaded(r)
    if (USE_DUMMY) return CAFES.forEach((c) => show(c.id, dummy(c.id, r)))
    if (!SCRIPT_URL) return
    const req = ++latest.current
    setBusy("load")
    try {
      const res: { error?: string; cafes?: Record<string, Payload>; kitchen?: KitchenPayload } = await call(`?action=load&start=${r.start}&end=${r.end}`)
      if (req !== latest.current) return
      if (res.error) throw new Error(res.error)
      CAFES.forEach((c) => {
        const d = res.cafes?.[c.id]
        if (!d) fail(c.id, "No answer for this cafe — is it in CAFES in Code.gs?")
        else if (d.error) fail(c.id, d.error)
        else show(c.id, d)
      })
      showKitchen(res.kitchen)
    } catch (e) {
      if (req === latest.current) CAFES.forEach((c) => fail(c.id, e))
    } finally {
      if (req === latest.current) setBusy("")
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(() => refresh(), REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  return { range, setRange, loaded, data, errors, busy, load, refresh, kitchen, kitchenError }
}

/* ── Page ── */

export default function App() {
  // The open cafe lives in the address (#bandra) so a tab can be bookmarked
  const [id, setId] = useState(() => location.hash.slice(1))
  const cafe = CAFES.find((c) => c.id === id) || CAFES[0]
  const kitchen = id === KITCHEN_ID
  const cafes = useCafes()
  return (
    <>
      <nav className="nav" aria-label="Cafes">
        <span className="brand">Weekly Dashboard</span>
        {CAFES.map((c) => (
          <a aria-current={!kitchen && c === cafe ? "page" : undefined} href={"#" + c.id} key={c.id} onClick={() => setId(c.id)}>{c.name}</a>
        ))}
        <a aria-current={kitchen ? "page" : undefined} href={"#" + KITCHEN_ID} onClick={() => setId(KITCHEN_ID)}>Central Kitchen</a>
      </nav>
      {/* key: charts replay their animation when switching page */}
      {/* a crash on one page shows its error instead of a blank screen; switching page tries again */}
      <ErrorBoundary key={kitchen ? "kitchen" : cafe.id} label={kitchen ? "Central Kitchen" : cafe.name}>
        {kitchen ? <KitchenPage cafes={cafes} /> : <CafePage cafe={cafe} cafes={cafes} key={cafe.id} />}
      </ErrorBoundary>
    </>
  )
}

type Cafes = ReturnType<typeof useCafes>
const updated = (iso: string) => "Updated " + new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

// Title + the shared From/To range with Load and Refresh (same on every page)
function Header({ title, sub, status, error, cafes }: { title: string; sub: ReactNode; status?: string; error?: string; cafes: Cafes }) {
  const { range, setRange, busy, load, refresh } = cafes
  const badRange = !range.start || !range.end || range.start > range.end
  return (
    <div className="hd">
      <div>
        <h1>{title}</h1>
        <div className="hs">{sub}</div>
      </div>
      <div className="hr">
        <form className="range" onSubmit={(e) => { e.preventDefault(); load(range) }}>
          <label>From<input max={range.end} onChange={(e) => setRange({ ...range, start: e.target.value })} required type="date" value={range.start} /></label>
          <label>To<input min={range.start} onChange={(e) => setRange({ ...range, end: e.target.value })} required type="date" value={range.end} /></label>
          <button className="primary" disabled={!!busy || badRange} title="Refill the Looker studio tab of every cafe with these dates" type="submit">
            {busy === "load" ? "Loading all cafes..." : "Load"}
          </button>
          <button disabled={!!busy} onClick={() => refresh(true)} title="Read the Looker studio tabs again" type="button">
            {busy === "refresh" ? "Refreshing..." : "↻ Refresh"}
          </button>
        </form>
        <div className={error || badRange ? "err" : undefined}>
          {badRange ? "Start date must be on or before the end date" : error ? "Failed: " + error : status}
        </div>
      </div>
    </div>
  )
}

function CafePage({ cafe, cafes }: { cafe: Cafe; cafes: Cafes }) {
  const d = cafes.data[cafe.id], error = cafes.errors[cafe.id]
  if (!SCRIPT_URL && !USE_DUMMY)
    return (
      <div className="wrap">
        <div className="hd"><h1>{cafe.name} Weekly Dashboard</h1></div>
        <div className="box"><div className="empty">{cafe.name} is not connected yet — add the Apps Script /exec URL to SCRIPT_URL in src/App.tsx.</div></div>
      </div>
    )
  return (
    <div className="wrap">
      <Header
        cafes={cafes}
        error={error}
        status={d ? updated(d.meta.generatedAt) : undefined}
        sub={<>
          {USE_DUMMY && <span className="pill w" style={{ marginRight: 8 }}>Sample data — not real figures</span>}
          {d ? `${d.meta.currDateRange} vs ${d.meta.prevDateRange} | ${d.meta.totalRows} transactions` : "Loading..."}
        </>}
        title={`${cafe.name} Weekly Dashboard`}
      />
      {d ? <Dashboard d={d} lastYearCard={!!cafe.lastYearCard} /> : <div className="box"><div className="empty">{error || "Data load ho raha hai..."}</div></div>}
    </div>
  )
}

/* ── Central Kitchen (sample data for now; Load does not fetch it) ── */

const KITCHEN_ID = "kitchen"
// Area values become channel cards; the icon and colour are picked from the name
const KITCHEN_CHANNELS: [RegExp, ReactNode, string][] = [
  [/swiggy/i, SWIGGY, "#d9803a"],
  [/zomato/i, ZOMATO, "#b5483a"],
  [/online|website|shopify/i, "🌐", "var(--gold)"],
  [/offline|store|walk/i, "🏬", "var(--sage)"],
  [/wedding|event/i, "🎉", "#8b5e83"],
  [/b2b|bulk|corporate/i, "📦", "var(--brown)"],
  [/compliment|free|sample/i, "🎁", "#b9a98a"],
]
const channelLook = (name: string) => {
  const hit = KITCHEN_CHANNELS.find(([re]) => re.test(name))
  return hit ? { ic: hit[1], c: hit[2] } : { ic: "•", c: "var(--gold)" }
}

// Complimentary is left out; every "… Bulk" area (Birthday Bulk, Festival Bulk …) becomes one Bulk card
function kitchenChannels(list: KitchenPayload["channels"]) {
  const out: KitchenPayload["channels"] = []
  const bulk = { name: "Bulk", curr: 0, prev: 0 }
  list.forEach((c) => {
    if (/compliment/i.test(c.name)) return
    if (/bulk/i.test(c.name)) { bulk.curr += c.curr; bulk.prev += c.prev } else out.push(c)
  })
  if (list.some((c) => /bulk/i.test(c.name))) out.push(bulk)
  return out.sort((a, b) => b.curr - a.curr)
}

function KitchenPage({ cafes }: { cafes: Cafes }) {
  // Real kitchen data once the script is connected; until then clearly marked sample numbers
  const sample = useMemo(() => makeKitchenDummy(cafes.loaded.start, cafes.loaded.end), [cafes.loaded])
  const k: KitchenPayload = cafes.kitchen || sample
  const isSample = !cafes.kitchen
  const bulk = useMemo(() => k.bulk?.rows || makeBulkDummy(cafes.loaded.start, cafes.loaded.end), [k, cafes.loaded])
  const events = useMemo(() => k.events?.rows || makeEventDummy(cafes.loaded.start, cafes.loaded.end), [k, cafes.loaded])
  const channels = useMemo(() => kitchenChannels(k.channels), [k])
  const share = (v: number) => (k.kpis.curr ? Math.round((v / k.kpis.curr) * 100) : 0)
  const costPct = (v: number, of: number) => (of ? ((v / of) * 100).toFixed(1) + "%" : "—")
  const t = k.topItem
  return (
    <div className="wrap">
      <Header
        cafes={cafes}
        error={cafes.kitchenError}
        status={updated(k.meta.generatedAt)}
        sub={<>{isSample && <span className="pill w" style={{ marginRight: 8 }}>Sample data — not real figures</span>}{`${k.meta.currDateRange} vs ${k.meta.prevDateRange}`}</>}
        title="Central Kitchen Weekly Dashboard"
      />

      <Sec>Revenue</Sec>
      <div className="g g3">
        <Card ic="💰" lb="Current revenue" vl={S(k.kpis.curr)} d={<Delta c={k.kpis.curr} p={k.kpis.prev} />} sb={k.meta.currDateRange} c="var(--gold)" />
        <Card ic="🗓️" lb="Previous week revenue" vl={S(k.kpis.prev)} d={<Note>{k.meta.prevDateRange}</Note>} sb="reference period" c="#b9a98a" />
        <Card ic="📅" lb="Last year revenue" vl={S(k.kpis.ly)} d={<Delta c={k.kpis.curr} p={k.kpis.ly} suf=" YoY" />} sb="same dates last year" c="#9a8f7c" />
      </div>

      <Sec>Channels</Sec>
      <div className="g g6" style={{ "--n": Math.min(Math.max(channels.length, 1), 6) } as CSSProperties}>
        {channels.map((ch) => {
          const look = channelLook(ch.name)
          return (
            <div className="kc ch" key={ch.name} style={{ "--c": look.c } as CSSProperties}>
              <div className="share" title="Share of current revenue">{share(ch.curr)}%<small>of revenue</small></div>
              <div className="ic">{look.ic}</div>
              <div className="lb">{ch.name}</div>
              <div className="vl">{S(ch.curr)}</div>
              <Delta c={ch.curr} p={ch.prev} />
              <div className="sb">prev: {S(ch.prev)}</div>
            </div>
          )
        })}
      </div>

      <Sec>Departments &amp; costs</Sec>
      <div className="ck-mid">
        <Box title="Sales by department" small="current vs previous">
          <Bars
            aspectRatio="2.4 / 1"
            data={k.departments.map((d) => ({ name: d.name, Current: d.curr, Previous: d.prev }))}
            x="name"
            series={[{ key: "Current", color: AMBER }, { key: "Previous", color: PREV }]}
          />
        </Box>
        <div className="ck-side">
          <div className="box ck-top">
            <div className="lb">🏆 Top selling item</div>
            <div className="ck-name">{t.name}</div>
            <div className="sb">{t.dept}</div>
            <div className="ck-row">
              <div><div className="vl">{S(t.curr)}</div><Delta c={t.curr} p={t.prev} /></div>
              <div className="ck-stats">
                <span><b>{t.qty}</b> sold</span>
                <span><b>{share(t.curr)}%</b> of revenue</span>
              </div>
            </div>
          </div>
          <div className="ck-costs">
            <Card ic="🥗" lb="Food cost" vl={S(k.foodCost.curr)} d={<Delta c={k.foodCost.curr} p={k.foodCost.prev} lowerIsBetter />}
              sb={`${costPct(k.foodCost.curr, k.kpis.curr)} of revenue · prev ${costPct(k.foodCost.prev, k.kpis.prev)}`} c="var(--sage)" />
            <Card ic="🧾" lb="Non-food cost" vl={S(k.nonFoodCost.curr)} d={<Delta c={k.nonFoodCost.curr} p={k.nonFoodCost.prev} lowerIsBetter />}
              sb={`${costPct(k.nonFoodCost.curr, k.kpis.curr)} of revenue · prev ${costPct(k.nonFoodCost.prev, k.kpis.prev)}`} c="var(--brown)" />
          </div>
        </div>
      </div>

      <Sec>Top 5 selling items by department</Sec>
      <div className="g gt">
        {/* "Others" (add-ons) is left out; with it gone, Edit fills the fourth card */}
        {k.top.filter((d) => !/^others?$/i.test(d.dept)).slice(0, 4).map((d) => <Top5 key={d.dept} list={d.items} name={d.dept} total={d.total} />)}
      </div>

      <Sec>Bulk orders</Sec>
      {k.bulk?.error ? <div className="box"><div className="empty">Bulk orders: {k.bulk.error}</div></div> : <BulkOrders range={k.meta.currDateRange} rows={bulk} sample={!k.bulk?.rows} />}

      <Sec>Events</Sec>
      {k.events?.error
        ? <div className="box"><div className="empty">Events: {k.events.error}</div></div>
        : <BulkOrders hasUnits={false} noun="event" ongoingNote="inquiry received, proposal sent …" range={k.meta.currDateRange} rows={events} sample={!k.events?.rows} sheet="event sheet" title="Event data" />}
    </div>
  )
}

/* ── Bulk orders: enquiry funnel + units & value (works on the sheet's rows) ── */

const pct2 = (n: number, of: number) => (of ? ((n / of) * 100).toFixed(2) : "0.00") + "%"
const BULK_COL = { converted: "var(--gold)", lost: "#b9a98a", ongoing: "#e2d6bd" }

// Enquiry funnel + units & value for the bulk sheet, or value only for the event sheet (it has no units)
function BulkOrders({ rows, range, sample = false, title = "Bulk order data", sheet = "bulk sheet", noun = "order", hasUnits = true, ongoingNote = "inquiry, awaiting confirmation …" }: {
  rows: BulkEnquiry[]; range: string; sample?: boolean; title?: string; sheet?: string; noun?: string; hasUnits?: boolean; ongoingNote?: string
}) {
  // Stage "Confirmed" = converted, "Lost" = unconverted, anything else = ongoing
  const groups = {
    converted: rows.filter((r) => /confirmed/i.test(r.stage) && !/awaiting/i.test(r.stage)),
    lost: rows.filter((r) => /lost/i.test(r.stage)),
    ongoing: [] as BulkEnquiry[],
  }
  groups.ongoing = rows.filter((r) => !groups.converted.includes(r) && !groups.lost.includes(r))
  const total = rows.length
  const units = (list: BulkEnquiry[]) => list.reduce((s, r) => s + (r.units || 0), 0)
  const value = (list: BulkEnquiry[]) => list.reduce((s, r) => s + (r.value || 0), 0)
  // averages only over confirmed orders that actually have units / a value
  const withUnits = groups.converted.filter((r) => r.units), withValue = groups.converted.filter((r) => r.value)
  const tiles: [keyof typeof groups, string][] = [["converted", "Converted enquiries"], ["lost", "Lost enquiries"], ["ongoing", "Ongoing enquiries"]]
  const table: [keyof typeof groups, string, string][] = [
    ["converted", "Converted", "Stage: Confirmed"],
    ["lost", "Unconverted", "Stage: Lost"],
    ["ongoing", "Ongoing", `Every other stage (${ongoingNote})`],
  ]

  return (
    <div className="box bulk">
      <div className="bulk-head">
        <div>
          <h2>{title}</h2>
          <div className="sb">Enquiries in {range}</div>
        </div>
        {sample && <span className="pill w">Sample data</span>}
      </div>
      <div className="bulk-grid">
        <div>
          <div className="bulk-total">
            <div><span className="vl">{total}</span> total enquiries</div>
            <div><b style={{ color: "var(--gr)" }}>{pct2(groups.converted.length, total)}</b> converted ratio</div>
          </div>
          <div className="bulk-bar" role="img" aria-label="Converted, lost and ongoing share of enquiries">
            {tiles.map(([k]) => <i key={k} style={{ width: (total ? (groups[k].length / total) * 100 : 0) + "%", background: BULK_COL[k] }} />)}
          </div>
          <div className="g g3 bulk-tiles">
            {tiles.map(([k, label]) => (
              <div className="bulk-tile" key={k}>
                <div className="lb"><Dot c={BULK_COL[k]} />{label}</div>
                <div className="vl">{groups[k].length}</div>
                <div className="sb">{pct2(groups[k].length, total)} of enquiries</div>
              </div>
            ))}
          </div>
          <div className="g g2 bulk-avgs">
            {hasUnits ? (
              <div className="bulk-tile soft">
                <div className="lb">Avg {noun} units</div>
                <div className="vl">{withUnits.length ? (units(withUnits) / withUnits.length).toFixed(2) : "—"}</div>
                <div className="sb">per confirmed {noun} · {withUnits.length} with units</div>
              </div>
            ) : (
              <div className="bulk-tile soft">
                <div className="lb">Confirmed revenue</div>
                <div className="vl">{F(value(groups.converted))}</div>
                <div className="sb">{groups.converted.length} confirmed {noun}{groups.converted.length === 1 ? "" : "s"}</div>
              </div>
            )}
            <div className="bulk-tile soft">
              <div className="lb">Avg {noun} value</div>
              <div className="vl">{withValue.length ? F(value(withValue) / withValue.length) : "—"}</div>
              <div className="sb">per confirmed {noun} · {withValue.length} with a value</div>
            </div>
          </div>
        </div>
        <div>
          <div className="bulk-head">
            <h2>{hasUnits ? <>Units &amp; value</> : "Value"}</h2>
            <div className="sb">As reported in the {sheet}, not CK revenue</div>
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Report metric</th>{hasUnits && <th>Units</th>}<th>Value</th></tr></thead>
              <tbody>
                {table.map(([k, name, note]) => (
                  <tr key={k}>
                    <td><b>{name}</b><div className="sb">{note}</div></td>
                    {hasUnits && <td>{units(groups[k]).toLocaleString("en-IN")}</td>}
                    <td><b>{F(value(groups[k]))}</b></td>
                  </tr>
                ))}
                <tr className="tot">
                  <td>Total<div className="sb">All {total} enquiries</div></td>
                  {hasUnits && <td>{units(rows).toLocaleString("en-IN")}</td>}
                  <td>{F(value(rows))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function Dashboard({ d, lastYearCard }: { d: Payload; lastYearCard: boolean }) {
  const editDialog = useRef<HTMLDialogElement>(null)
  const k = d.kpis, m = d.meta, dw = d.dayWise, sc = d.subCategories, e = d.editSpotlight
  const dine = d.channels.find((c) => /dine/i.test(c.name)) || { curr: 0, prev: 0 }
  const byType = (re: RegExp, k: "curr" | "prev") => d.channels.filter((c) => re.test(c.name)).reduce((s, c) => s + c[k], 0)
  const chan: [ReactNode, string, number, number, string][] = [
    [DINE_IN, "Dine-in", dine.curr, dine.prev, "var(--sage)"],
    [SWIGGY, "Swiggy", sumBy(d.areas, /swiggy/i), sumBy(d.areasPrev, /swiggy/i), "#d9803a"],
    [ZOMATO, "Zomato", sumBy(d.areas, /zomato/i), sumBy(d.areasPrev, /zomato/i), "#b5483a"],
    // Order Type, not Area: Pick Up rows have Area "Parcel" (Bandra) or blank (LP)
    [PICK_UP, "Pick-up", byType(/pick/i, "curr"), byType(/pick/i, "prev"), "#8b5e83"],
  ]
  const tot = (n: string) => (sc.find((s) => s.name === n) || { curr: 0 }).curr

  return (
    <>
      <Sec>Key performance indicators</Sec>
      <div className="g g5">
        <Card ic="💰" lb="Current week sales" vl={S(k.currTotal)} d={<Delta c={k.currTotal} p={k.prevTotal} />} sb={m.currDateRange} c="var(--gold)" />
        <Card ic="🗓️" lb="Previous week sales" vl={S(k.prevTotal)} d={<Note>{m.prevDateRange}</Note>} sb="reference period" c="#b9a98a" />
        {lastYearCard && <Card ic="📅" lb="Last year same week" vl={S(k.lyTotal)} d={<Delta c={k.currTotal} p={k.lyTotal} suf=" YoY" />} sb="same dates last year" c="#9a8f7c" />}
        <Card ic="🧾" lb="Total orders" vl={k.currOrders} d={<Delta c={k.currOrders} p={k.prevOrders} />} sb={`vs ${k.prevOrders} prev week`} c="var(--sage)" />
        <Card ic="📊" lb="Avg order value" vl={S(k.currAOV)} d={<Delta c={k.currAOV} p={k.prevAOV} />} sb={"prev: " + S(k.prevAOV)} c="var(--brown)" />
      </div>
      <div className="g g5">
        {chan.map((c) => <Card key={c[1]} ic={c[0]} lb={c[1] + " revenue"} vl={S(c[2])} d={<Delta c={c[2]} p={c[3]} />} sb={"prev: " + S(c[3])} c={c[4]} />)}
      </div>

      <Sec>Weekly trend</Sec>
      <div className="g g2">
        <Box title="Day-wise sales" small="current vs previous week">
          <Bars
            data={dw.map((x) => ({ day: x.day, "Current week": x.curr, "Previous week": x.prev }))}
            x="day"
            series={[{ key: "Current week", color: AMBER }, { key: "Previous week", color: PREV }]}
            extra={(p) => [{ color: "transparent", label: "Share of week", value: (k.currTotal ? Math.round(((p["Current week"] as number) / k.currTotal) * 100) : 0) + "%" }]}
          />
        </Box>
        <Box title="🕐 Hourly sales" small="by hour of day (24h)">
          <Bars
            data={d.hourly.map((x) => ({ hour: String(x.hour), Sales: x.sales }))}
            x="hour"
            series={[{ key: "Sales", color: AMBER }]}
            title={(p) => hourLabel(Number(p.hour))}
          />
        </Box>
      </div>

      <div className="g g2">
        <Box title="🚀 Order channels"><Donut label="Channels" list={d.channels.map((c) => ({ name: c.name, value: c.curr }))} /></Box>
        <Box title="Sales by sub-category" small="current vs previous">
          <Bars
            data={sc.map((s) => ({ name: s.name, Current: s.curr, Previous: s.prev }))}
            x="name"
            series={[{ key: "Current", color: AMBER }, { key: "Previous", color: PREV }]}
          />
        </Box>
      </div>

      <Sec>Top 5 selling items by category</Sec>
      <div className="g gt">
        <Top5 name="Beverages" list={d.topBeverages} total={tot("Beverages")} />
        <Top5 name="Savoury" list={d.topSavoury} total={tot("Savoury")} />
        <Top5 name="Dessert" list={d.topDessert} total={tot("Dessert")} />
        <Top5 name="Edit" list={d.topEdit} onOpen={() => editDialog.current?.showModal()} total={tot("Edit")} />
      </div>
      <EditItems dialogRef={editDialog} e={e} />

      <Sec>⚠️ Customer complaints — current week</Sec>
      <Complaints c={d.complaints} range={m.currDateRange} />

      {d.variance && (
        <>
          <Sec>📦 Stock variance</Sec>
          <Variance v={d.variance} />
        </>
      )}

      {d.ccg && (
        <>
          <Sec>🍽️ CCG breakage</Sec>
          <Ccg c={d.ccg} />
        </>
      )}
    </>
  )
}

const qty = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }))

// One table per department, in the order the departments appear in the sheet
function Variance({ v }: { v: NonNullable<Payload["variance"]> }) {
  if (v.error) return <div className="box"><div className="empty">{v.error}</div></div>
  const rows = v.rows || []
  if (!rows.length) return <div className="box"><div className="empty">No items in the variance sheet</div></div>
  const depts = [...new Set(rows.map((r) => r.dept))]
  return (
    <div className="var-list">
      {depts.map((dept) => {
        const list = rows.filter((r) => r.dept === dept)
        const off = list.filter((r) => r.diff).length
        return (
          <Box key={dept} small={`${list.length} item${list.length === 1 ? "" : "s"} · ${off} with a difference`} title={dept}>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Item</th><th className="l">UOM</th><th>Opening</th><th>Purchase</th><th>Sale</th>
                    <th>System closing</th><th>Team closing</th><th>Difference</th><th className="l">Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={i}>
                      <td className="l">{r.item}</td><td className="l">{r.uom}</td>
                      <td>{qty(r.opening)}</td><td>{qty(r.purchase)}</td><td>{qty(r.sale)}</td>
                      <td>{qty(r.system)}</td><td>{qty(r.team)}</td>
                      {/* below zero = team counted less than the system expects (shortage) */}
                      <td><span className={"pill " + (r.diff ? (r.diff < 0 ? "d" : "u") : "")}>{r.diff === null ? "—" : (r.diff > 0 ? "+" : "") + qty(r.diff)}</span></td>
                      <td className="l"><div className="clip">{r.reason || "—"}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Box>
        )
      })}
    </div>
  )
}

// Crockery, cutlery & glassware broken or missing, as listed in the cafe's CCG tab
function Ccg({ c }: { c: NonNullable<Payload["ccg"]> }) {
  if (c.error) return <div className="box"><div className="empty">{c.error}</div></div>
  const rows = c.rows || []
  const totalQty = rows.reduce((t, r) => t + (r.qty || 0), 0), totalAmt = rows.reduce((t, r) => t + (r.amount || 0), 0)
  return (
    <Box small={`${rows.length} item${rows.length === 1 ? "" : "s"} · ${F(totalAmt)}`} title="CCG broken / missing">
      <div className="scroll">
        <table className="ccg">
          <thead><tr><th className="l">CCG name</th><th>Qty</th><th>Amount per pcs</th><th>Total amount</th><th className="l">Reason</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={i}>
                <td className="l">{r.item}</td><td>{qty(r.qty)}</td><td>{r.cost === null ? "—" : F(r.cost)}</td>
                <td><b>{r.amount === null ? "—" : F(r.amount)}</b></td><td className="l"><div className="clip">{r.reason || "—"}</div></td>
              </tr>
            )) : <tr><td className="empty" colSpan={5}>No CCG breakage recorded</td></tr>}
            {rows.length > 0 && (
              <tr className="tot"><td>Total</td><td>{qty(totalQty)}</td><td /><td>{F(totalAmt)}</td><td /></tr>
            )}
          </tbody>
        </table>
      </div>
    </Box>
  )
}

function Complaints({ c, range }: { c: Payload["complaints"]; range: string }) {
  if (!c || c.error) return <div className="box"><div className="empty">{c?.error || "No complaint data"}</div></div>
  const cnt = (re: RegExp) => sumBy(c.byChannel, re)
  const rows = c.rows || []
  return (
    <>
      <div className="g g5">
        <Card ic="📨" lb="Total complaints" vl={c.total} sb={range} c="var(--gold)" />
        <Card ic="✅" lb="Valid complaints" vl={c.validCount} sb={(c.total ? Math.round((c.validCount / c.total) * 100) : 0) + "% of total"} c="var(--gr)" />
        <Card ic={SWIGGY} lb="Swiggy complaints" vl={cnt(/swiggy/i)} sb="via Swiggy channel" c="#d9803a" />
        <Card ic={ZOMATO} lb="Zomato complaints" vl={cnt(/zomato/i)} sb="via Zomato channel" c="#b5483a" />
        <Card ic={DINE_IN} lb="Dine-in complaints" vl={cnt(/dine/i)} sb="via Dine-in channel" c="var(--sage)" />
      </div>
      <Box className="log" title="📋 Complaint log" small={`${c.total} complaint(s)${c.total > rows.length ? ` — latest ${rows.length} shown` : ""}`}>
        <div className="scroll">
          <table>
            <thead>
              <tr>{["Date", "Channel", "Complaint", "Item", "Valid?", "Notes / action taken"].map((h) => <th className="l" key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((r, i) => (
                <tr key={i}>
                  <td className="l">{r.date}</td><td className="l">{r.channel}</td>
                  <td className="l"><div className="clip">{r.desc}</div></td>
                  <td className="l">{r.item || "—"}</td>
                  <td className="l"><span className={"pill " + (/^valid$/i.test(r.valid) ? "u" : /invalid/i.test(r.valid) ? "d" : "")}>{r.valid || "—"}</span></td>
                  <td className="l"><div className="clip">{r.notes}</div></td>
                </tr>
              )) : <tr><td colSpan={6} className="empty">No complaints in these dates</td></tr>}
            </tbody>
          </table>
        </div>
      </Box>
    </>
  )
}
