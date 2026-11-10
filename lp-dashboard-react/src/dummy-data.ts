import type { Payload } from "./App"

// Sample data so the dashboard can be shown before the Apps Script links are live.
// Same seed per cafe = same numbers on every load.

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MENU: Record<string, string[]> = {
  Beverages: ["Cappuccino", "Cold Brew", "Flat White", "Iced Latte", "Masala Chai"],
  Savoury: ["Avocado Toast", "Chicken Panini", "Pesto Pasta", "Croissant Sandwich", "Shakshuka"],
  Dessert: ["Chocolate Tart", "Blueberry Cheesecake", "Tiramisu", "Almond Croissant", "Walnut Brownie"],
  Edit: ["Seasonal Edit Cake", "Edit Truffle Box", "Edit Macaron Set", "Edit Granola Jar"],
}
const SHARE: Record<string, number> = { Beverages: 0.34, Savoury: 0.38, Dessert: 0.22, Edit: 0.06 }

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const pct = (c: number, p: number) => (p ? Number((((c - p) / p) * 100).toFixed(1)) : 0)
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })

const parse = (s?: string) => (s ? new Date(s + "T00:00:00") : null)

// start/end = "YYYY-MM-DD"; none = the last full Mon–Sun week
export function makeDummy(cafeId: string, scale: number, startStr?: string, endStr?: string): Payload {
  const r = rng([...(cafeId + (startStr || "") + (endStr || ""))].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7))
  const vary = (n: number, spread = 0.3) => Math.round(n * (1 - spread / 2 + r() * spread))

  // Chosen range (default: last full Mon–Sun week), and the same number of days before it
  let end = parse(endStr) || new Date()
  if (!endStr) end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 1)
  end = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const start = parse(startStr) || new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1)
  const prevStart = new Date(prevEnd); prevStart.setDate(prevEnd.getDate() - (days - 1))
  // how many Mondays, Tuesdays… the range contains
  const occ = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < days; i++) occ[(new Date(start.getTime() + i * 86400000).getDay() + 6) % 7]++

  const weight = [0.8, 0.85, 0.9, 0.95, 1.15, 1.45, 1.5]
  const dayWise = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
    const curr = vary(150000 * scale * weight[i] * occ[i])
    return { day: d, curr, prev: vary(curr * 0.9), orders: Math.round(curr / vary(1750, 0.1)) }
  })
  const currTotal = sum(dayWise.map((d) => d.curr)), prevTotal = sum(dayWise.map((d) => d.prev))
  const lyTotal = vary(currTotal * 0.82, 0.1)
  const currOrders = sum(dayWise.map((d) => d.orders)), prevOrders = vary(currOrders * 0.92, 0.1)
  const kpis = {
    currTotal, prevTotal, lyTotal, currOrders, prevOrders,
    currAOV: Math.round(currTotal / currOrders), prevAOV: Math.round(prevTotal / prevOrders),
    wowChange: pct(currTotal, prevTotal), yoyChange: pct(currTotal, lyTotal),
  }

  const subCategories = Object.keys(SHARE).map((name) => {
    const curr = vary(currTotal * SHARE[name], 0.1), prev = vary(prevTotal * SHARE[name], 0.2)
    return { name, curr, prev, currQty: Math.round(curr / 260), prevQty: Math.round(prev / 260) }
  })
  const top = (name: string) => {
    const total = subCategories.find((s) => s.name === name)!.curr
    return MENU[name].map((n, i) => ({ name: n, value: vary(total * [0.26, 0.21, 0.17, 0.13, 0.1][i] || 0, 0.1) })).sort((a, b) => b.value - a.value)
  }

  const split = (total: number, shares: [string, number][]) => shares.map(([name, s]) => ({ name, value: vary(total * s, 0.1) }))
  const channelShares: [string, number][] = [["Dine In", 0.72], ["Delivery", 0.18], ["Pick Up", 0.1]]
  const areaShares: [string, number][] = [["Indoor", 0.45], ["Outdoor", 0.27], ["Swiggy", 0.1], ["Zomato", 0.08], ["Pick up", 0.1]]
  const chC = split(currTotal, channelShares), chP = split(prevTotal, channelShares)

  const hourly = Array.from({ length: 16 }, (_, i) => {
    const h = i + 7
    const shape = Math.exp(-((h - 13) ** 2) / 6) + 0.8 * Math.exp(-((h - 19) ** 2) / 5) + 0.15
    return { hour: h, sales: vary((currTotal / 9) * shape, 0.2) }
  })

  const edit = subCategories.find((s) => s.name === "Edit")!
  const items = MENU.Edit.map((name) => {
    const currQty = vary(edit.currQty / 4, 0.6), prevQty = vary(edit.prevQty / 4, 0.6), price = vary(320, 0.3)
    return { name, curr: currQty * price, prev: prevQty * price, currQty, prevQty }
  }).sort((a, b) => b.currQty - a.currQty)

  // channel, complaint, item, valid, notes
  const complaintRows = [
    ["Swiggy", "Order arrived 25 minutes late", "Chicken Panini", "Valid", "Refunded delivery fee"],
    ["Dine In", "Cold brew too diluted", "Cold Brew", "Valid", "Remade the drink"],
    ["Zomato", "Missing croissant in order", "Almond Croissant", "Valid", "Checking packing slip"],
    ["Dine In", "Long wait for the bill", "", "Invalid", "Peak hour rush, explained"],
    ["Swiggy", "Tart arrived broken", "Chocolate Tart", "Invalid", "POD available, rider issue"],
  ].slice(0, cafeId === "lp" ? 5 : 3)
  const rows = complaintRows.map(([channel, desc, item, valid, notes], i) => ({
    date: day(new Date(start.getTime() + i * 86400000)), channel, desc, item, valid, notes,
  }))
  const count = (key: number) => {
    const m: Record<string, number> = {}
    complaintRows.forEach((row) => { m[row[key]] = (m[row[key]] || 0) + 1 })
    return Object.entries(m).map(([name, value]) => ({ name, value }))
  }

  return {
    kpis,
    dayWise,
    periodComparison: [
      { label: "Last Year", value: lyTotal }, { label: "Previous Week", value: prevTotal }, { label: "Current Week", value: currTotal },
    ],
    subCategories,
    topBeverages: top("Beverages"), topSavoury: top("Savoury"), topDessert: top("Dessert"), topEdit: top("Edit"),
    channels: chC.map((c, i) => ({ name: c.name, curr: c.value, prev: chP[i].value })),
    areas: split(currTotal, areaShares).sort((a, b) => b.value - a.value),
    areasPrev: split(prevTotal, areaShares),
    hourly,
    editSpotlight: {
      total: sum(items.map((i) => i.curr)), prevTotal: sum(items.map((i) => i.prev)),
      qty: sum(items.map((i) => i.currQty)), prevQty: sum(items.map((i) => i.prevQty)),
      orders: Math.round(sum(items.map((i) => i.currQty)) * 0.8), prevOrders: Math.round(sum(items.map((i) => i.prevQty)) * 0.8), items,
    },
    complaints: {
      total: rows.length,
      validCount: rows.filter((x) => x.valid === "Valid").length,
      byChannel: count(0),
      rows,
    },
    variance: {
      rows: [
        { dept: "Dessert", item: "Sugar Free Dark Chocolate Carre", uom: "Portion", opening: 11, purchase: 28, sale: 31, system: 8, team: 3, diff: -5, reason: "" },
        { dept: "Dessert", item: "Hazelnut Tea Cake", uom: "Portion", opening: 9, purchase: 9, sale: 5, system: 13, team: 7, diff: -6, reason: "" },
        { dept: "Barista", item: "Arabica Coffee Beans", uom: "Kg", opening: 6.663, purchase: 0, sale: 0, system: -15.855, team: 13.193, diff: 29.048, reason: "Purchased on Tuesday but no PO has been raised for it" },
        { dept: "Barista", item: "Whole Milk", uom: "Litre", opening: 40, purchase: 120, sale: 138, system: 22, team: 22, diff: 0, reason: "" },
        { dept: "Savoury", item: "Sourdough", uom: "Loaf", opening: 10, purchase: 5, sale: 2, system: 15, team: 13, diff: -2, reason: "Two loaves used for staff meal" },
      ],
    },
    meta: {
      currDateRange: `${day(start)} – ${day(end)}`,
      prevDateRange: `${day(prevStart)} – ${day(prevEnd)}`,
      totalRows: currOrders * 3,
      generatedAt: new Date().toISOString(),
    },
  }
}

/* ── Central Kitchen (sample only — not connected to a sheet yet) ── */

export type KitchenPayload = {
  kpis: { curr: number; prev: number; ly: number }
  channels: { name: string; curr: number; prev: number }[]
  departments: { name: string; curr: number; prev: number }[]
  topItem: { name: string; dept: string; curr: number; prev: number; qty: number }
  foodCost: { curr: number; prev: number }
  nonFoodCost: { curr: number; prev: number }
  top: { dept: string; total: number; items: { name: string; value: number }[] }[]
  bulk?: { error?: string; rows?: BulkEnquiry[] }
  events?: { error?: string; rows?: BulkEnquiry[] }
  meta: { start?: string; end?: string; currDateRange: string; prevDateRange: string; generatedAt: string }
  error?: string
}

const KITCHEN_MENU: Record<string, string[]> = {
  Bakery: ["Sourdough Loaf", "Butter Croissant", "Focaccia", "Multigrain Bread", "Brioche Buns"],
  Pastry: ["Chocolate Tart", "Blueberry Cheesecake", "Tiramisu Jar", "Pistachio Entremet", "Lemon Tart"],
  "Hot Kitchen": ["Chicken Lasagne", "Paneer Makhani Bowl", "Mushroom Risotto", "Pesto Pasta", "Butter Chicken"],
  "Sauces & Preps": ["Pesto", "Hummus Tub", "Marinara Sauce", "Caramel Sauce", "Granola Jar"],
}

// start/end = "YYYY-MM-DD"
export function makeKitchenDummy(startStr: string, endStr: string): KitchenPayload {
  const r = rng([..."kitchen" + startStr + endStr].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7))
  const vary = (n: number, spread = 0.3) => Math.round(n * (1 - spread / 2 + r() * spread))
  const start = new Date(startStr + "T00:00:00"), end = new Date(endStr + "T00:00:00")
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1)
  const prevStart = new Date(prevEnd); prevStart.setDate(prevEnd.getDate() - (days - 1))

  const channels = ([["Website", 0.18], ["Offline", 0.3], ["Swiggy", 0.14], ["Zomato", 0.12], ["Bulk", 0.16], ["Event", 0.1]] as const)
    .map(([name, share]) => { const curr = vary(95000 * days * share, 0.25); return { name, curr, prev: vary(curr * 0.92, 0.3) } })
  const curr = sum(channels.map((c) => c.curr)), prev = sum(channels.map((c) => c.prev))

  const deptShare: Record<string, number> = { Bakery: 0.3, Pastry: 0.28, "Hot Kitchen": 0.27, "Sauces & Preps": 0.15 }
  const departments = Object.keys(deptShare).map((name) => ({ name, curr: vary(curr * deptShare[name], 0.1), prev: vary(prev * deptShare[name], 0.15) }))
  const top = departments.map((d) => ({
    dept: d.name, total: d.curr,
    items: KITCHEN_MENU[d.name].map((name, i) => ({ name, value: vary(d.curr * [0.24, 0.19, 0.15, 0.12, 0.09][i], 0.1) })).sort((a, b) => b.value - a.value),
  }))
  const best = top.flatMap((t) => t.items.map((it) => ({ ...it, dept: t.dept }))).sort((a, b) => b.value - a.value)[0]

  return {
    kpis: { curr, prev, ly: vary(curr * 0.78, 0.1) },
    channels,
    departments,
    topItem: { name: best.name, dept: best.dept, curr: best.value, prev: vary(best.value * 0.9, 0.2), qty: Math.round(best.value / vary(380, 0.2)) },
    foodCost: { curr: vary(curr * 0.31, 0.06), prev: vary(prev * 0.3, 0.06) },
    nonFoodCost: { curr: vary(curr * 0.12, 0.08), prev: vary(prev * 0.12, 0.08) },
    top,
    meta: { currDateRange: `${day(start)} – ${day(end)}`, prevDateRange: `${day(prevStart)} – ${day(prevEnd)}`, generatedAt: new Date().toISOString() },
  }
}

/* ── Bulk orders (sample only) — one row per enquiry, like the bulk sheet ── */

export type BulkEnquiry = { id: string; date: string; stage: string; units: number | null; value: number | null }

// start/end = "YYYY-MM-DD"
export function makeBulkDummy(startStr: string, endStr: string): BulkEnquiry[] {
  const r = rng([..."bulk" + startStr + endStr].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7))
  const start = new Date(startStr + "T00:00:00")
  const days = Math.round((new Date(endStr + "T00:00:00").getTime() - start.getTime()) / 86400000) + 1
  const count = Math.max(4, Math.round(days * (2 + r() * 1.2)))
  return Array.from({ length: count }, (_, i) => {
    const roll = r()
    const stage = roll < 0.18 ? "Confirmed" : roll < 0.38 ? "Lost" : roll < 0.5 ? "Awaiting Confirmation" : "Inquiry Received"
    // like the sheet: confirmed orders usually have units and a value, others only sometimes have units
    const units = stage === "Confirmed" ? (r() < 0.85 ? Math.round(20 + r() * 400) : null) : r() < 0.25 ? Math.round(10 + r() * 200) : null
    const value = stage === "Confirmed" && units ? Math.round(units * (300 + r() * 900)) : null
    return { id: "BULK-" + (200 + count - i), date: day(new Date(start.getTime() + Math.floor(r() * days) * 86400000)), stage, units, value }
  })
}

/* ── Events (sample only) — like the Event Sheets tab: Stage + Confirmed Revenue, no units ── */
export function makeEventDummy(startStr: string, endStr: string): BulkEnquiry[] {
  const r = rng([..."event" + startStr + endStr].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 7))
  const start = new Date(startStr + "T00:00:00")
  const days = Math.round((new Date(endStr + "T00:00:00").getTime() - start.getTime()) / 86400000) + 1
  const count = Math.max(3, Math.round(days * (0.8 + r() * 0.6)))
  return Array.from({ length: count }, (_, i) => {
    const roll = r()
    const stage = roll < 0.4 ? "Confirmed" : roll < 0.7 ? "Lost" : roll < 0.85 ? "Proposal Sent" : "Inquiry Received"
    // like the sheet: most confirmed events have a revenue, some are still blank
    const value = stage === "Confirmed" && r() < 0.75 ? Math.round(6000 + r() * r() * 300000) : null
    return { id: "EVT-" + String(100 + count - i), date: day(new Date(start.getTime() + Math.floor(r() * days) * 86400000)), stage, units: null, value }
  })
}
