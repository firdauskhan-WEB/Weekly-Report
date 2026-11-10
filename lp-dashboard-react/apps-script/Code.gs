/* ════════════════════════════════════════════════════════════════════
   ☕ CAFE WEEKLY DASHBOARD — one Apps Script for every cafe

   HOW IT WORKS
   • Load (dashboard button, or the sheet menu "Functions > Extract Financial
     Data"): for EVERY cafe, the old rows in its "Looker studio" tab are removed
     and replaced with the chosen range, the same number of days just before
     it, and the same dates last year (column "Type" = Current / Previous /
     Last Year). Looker Studio and the dashboard both read that tab.
       <exec URL>?action=load&start=2026-10-05&end=2026-10-11
   • The dashboard shows each cafe's Looker studio tab:
       <exec URL>?cafe=lp              (cached 30 min)
       <exec URL>?cafe=bandra&refresh=1   (read the tab again now)

   Columns are found by HEADER NAME, so the year tabs can have different
   column orders (e.g. "Price", "Tax" or "Table No." in one and not another).

   SETUP (once):
   1. Put this file in ONE Apps Script project — e.g. Extensions > Apps Script
      from either spreadsheet, or a new project at script.google.com.
   2. Fill in each cafe's Sheet ID and tab names in the ✏️ block below.
   3. Run setupDashboardTrigger once (accept the permission prompts — Google
      asks once for every spreadsheet the script opens).
   4. Deploy > Manage deployments > Edit > New version
      (Execute as: Me · Who has access: Anyone). Copy the /exec URL into
      SCRIPT_URL in src/App.tsx.
   Every later edit to this file needs another "New version" to go live.
   ════════════════════════════════════════════════════════════════════ */

/* ── ✏️ CAFES: SHEET IDs AND TAB NAMES ──
   Sheet ID = the long code in the sheet's address:
   docs.google.com/spreadsheets/d/<SHEET ID>/edit
   The key (lp, bandra) must match the cafe id in src/App.tsx.
   Tab names ignore capital letters and extra spaces.
   currentYearSheetId: optional — read the current-year tab from ANOTHER spreadsheet
     (e.g. the POS "Dashboard" sheet) instead of copying it in with IMPORTRANGE.
     Leave it out to read currentYearTab from salesSheetId.
   lastYearTab: "" when the spreadsheet has no last-year tab (last-year figures show as 0).
     When it is set, dates from 1 April of this financial year come from the current-year
     tab and earlier dates from the last-year tab, so no sale is counted twice.
   varianceTab: the stock variance tab (Department, Item, UOM, Opening, Purchase, Sale,
     System Generated Closing, Closing Given By Team, Difference, Reasons) in salesSheetId.
     Leave it out to hide the Stock variance section.
   ccgTab: the CCG breakage tab (Item Name, Cost Per Pcs, Breakage, Breakage Amount, Reasons)
     in salesSheetId. Leave it out to hide the CCG section.
   lookerTab: where Load and "Functions > Extract Financial Data" write, for Looker Studio
     (always in salesSheetId). */
var CAFES = {
  lp: {
    salesSheetId: "12j8RyerX7E9RoR3fLSpTMYWK0AaDiAPtGn47nQhd1_8", // LP weekly report (Looker studio)
    currentYearSheetId: "19ET1X4ML46LVV8W9fPd8vo4CVS73LTgrsFCwh2rCKFU", // ⚠️ source sheet with LP's Dashboard tab, read directly
    currentYearTab: "Dashboard",
    lastYearTab: "",
    lookerTab: "Looker studio",
    complaintsSheetId: "1Zrl9jv1rmoNMufbkj9DX_M6-kEnmGOMuOYaYw4U26kU",
    complaintsTab: "LP Cafe Log",
    varianceTab: "Variance",
    ccgTab: "CCG"
  },
  bandra: {
    salesSheetId: "1FFKqXxUTASMMXxX-MAbOxs27t4ESQCupK5xjSjsf0CE", // Cafe Weekly Report (last year + Looker studio)
    currentYearSheetId: "1stchxZ9C7VUGlGTOrkzN-wtW91ft46UAxwHBEfWQaZ4", // source sheet, read directly (no IMPORTRANGE)
    currentYearTab: "Dashboard",
    lastYearTab: "Last Financial year",
    lookerTab: "Looker studio",
    complaintsSheetId: "1Zrl9jv1rmoNMufbkj9DX_M6-kEnmGOMuOYaYw4U26kU",
    complaintsTab: "PV Cafe Log",
    varianceTab: "Variance",
    ccgTab: "CCG"
  }
};

/* ── ✏️ CENTRAL KITCHEN: SHEET IDs AND TAB NAMES ──
   Paste each spreadsheet's ID (the long code in its address:
   docs.google.com/spreadsheets/d/<SHEET ID>/edit) in place of the PASTE_… text. */
var KITCHEN = {
  currentYearSheetId: "1Z1581642vj3jlEXQ2yyQfGnYiovWinzxrea8SEP_vo4",     // ⚠️ "CK Itemwise Sales" — this financial year, item by item
  currentYearTab: "Dashboard",
  lastYearSheetId: "1pnqTrql7Zj4SrBOVUMGP6MBMw1f1QwF2xGIetdgk9dI",     // ⚠️ "CK New Weekly Report" — last year, invoice by invoice
  lastYearTab: "Last Year Sales Data",
  lookerTab: "Looker Studio",                           // in CK New Weekly Report; Load refills it
  bulkSheetId: "1y7PuXvD1Fun_gy-up6g00pgYKEkgo4WHlfGJ7qkRyL4",                   // ⚠️ "Bulk"
  bulkTab: "Bulk Orders",
  eventSheetId: "1ngU82tC0K5YVhoo8idjdiL6NN4DxysGXBV4Fyl8yRNk",                 // ⚠️ "Event"
  eventTab: "Event Orders"
};

var CONFIG = {
  maxRangeDays: 366,
  cacheSeconds: 1800
};

function cafeConfig_(id) {
  if (!id) throw new Error("Which cafe? Add &cafe=" + Object.keys(CAFES).join(" or &cafe=") + " to the URL.");
  var cfg = CAFES[id];
  if (!cfg) throw new Error("Unknown cafe '" + id + "'. Add it to CAFES at the top of Code.gs.");
  if (!cfg.salesSheetId) throw new Error("No Sheet ID for cafe '" + id + "'. Fill in salesSheetId in CAFES at the top of Code.gs.");
  if (/^PASTE_/.test(cfg.currentYearSheetId || "")) throw new Error("No source Sheet ID for cafe '" + id + "'. Fill in currentYearSheetId in CAFES at the top of Code.gs.");
  cfg.id = id;
  return cfg;
}

// The cafe whose spreadsheet this script is attached to (for the sheet menu)
function activeCafe_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var activeId = ss ? ss.getId() : "";
  for (var id in CAFES) if (CAFES[id].salesSheetId === activeId) return cafeConfig_(id);
  throw new Error("This spreadsheet isn't listed in CAFES at the top of Code.gs.");
}

// Header names accepted for each field, first match wins.
// Matching ignores case, spaces and punctuation ("Qty." = "qty" = "QTY").
var FIELDS = {
  month:     ["Month"],
  date:      ["Date"],
  timestamp: ["Timestamp", "Time"],
  invoice:   ["Invoice No.", "Invoice Number", "Invoice"],
  orderType: ["Order Type"],
  area:      ["Area"],
  item:      ["Item Name", "Item"],
  qty:       ["Qty.", "Quantity"],
  // Sales value. "Sub Total" exists in BOTH sheets (Final Total only in the current
  // one, with tax added), so years compare like-for-like. Put "Final Total" first
  // if you'd rather count tax wherever it exists.
  amount:    ["Sub Total"],
  // Beverages / Savoury / Dessert / Edit — "Super Category" in the current sheet,
  // "Sub-Category" in last year's
  group:     ["Super Category", "Sub-Category"],
  category:  ["Category"],
  // "Current" / "Previous" / "Last Year" — only in the Looker studio tab
  type:      ["Type"]
};
var REQUIRED = ["date", "invoice", "item", "qty", "amount", "group"];
var GROUPS = ["Beverages", "Savoury", "Dessert", "Edit"];
var DAY_MS = 24 * 60 * 60 * 1000;

/* ── Web App entry point ── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var json;
  try {
    json = p.action === "load" ? loadAllCafes_(p.start, p.end)
      : p.cafe === "kitchen" ? kitchenPayloadJson_(!!p.refresh)
      : cafePayloadJson_(p.cafe, !!p.refresh);
  } catch (err) {
    json = JSON.stringify({ error: err.message });
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
// Handy for testing from the editor: getDashboardData("bandra")
function getDashboardData(cafe) {
  return JSON.parse(cafePayloadJson_(cafe, true));
}
// One cafe's dashboard, built from its Looker studio tab (cached 30 min)
function cafePayloadJson_(cafeId, refresh) {
  var cfg = cafeConfig_(cafeId);
  return (!refresh && CacheService.getScriptCache().get("dash:" + cfg.id)) || cacheJson_(cfg, payloadFromLooker_(cfg));
}
function cacheJson_(cfg, payload) {
  var json = JSON.stringify(payload);
  // the cache holds max 100KB per value; bigger results are just served uncached
  try { CacheService.getScriptCache().put("dash:" + cfg.id, json, CONFIG.cacheSeconds); } catch (e) {}
  return json;
}

// Load button: refill EVERY cafe's Looker studio tab with the range, and return each cafe's dashboard.
// One cafe failing (e.g. a wrong tab name) doesn't stop the others.
function loadAllCafes_(startStr, endStr) {
  if (!startStr || !endStr) throw new Error("Pick a start and end date, then press Load.");
  var range = resolveRange_(startStr, endStr);
  var lock = LockService.getScriptLock(); // two Loads at once would mix up the tabs
  if (!lock.tryLock(5 * 60 * 1000)) throw new Error("Another Load is still running — try again in a minute.");
  try {
    var cafes = {};
    Object.keys(CAFES).forEach(function(id) {
      try {
        var cfg = cafeConfig_(id);
        var payload = extractToLooker_(cfg, range.start, range.end);
        cacheJson_(cfg, payload);
        cafes[id] = payload;
      } catch (err) {
        cafes[id] = { error: err.message };
      }
    });
    var kitchen;
    try {
      kitchen = extractKitchenToLooker_(range.start, range.end);
      cacheJson_(KITCHEN_CFG, kitchen);
    } catch (err) {
      kitchen = { error: err.message };
    }
    return JSON.stringify({ cafes: cafes, kitchen: kitchen });
  } finally {
    lock.releaseLock();
  }
}
// Re-reads every cafe's Looker studio tab into the cache (the 15-minute trigger)
function refreshDashboardCache() {
  Object.keys(CAFES).forEach(function(id) {
    try {
      var cfg = cafeConfig_(id);
      cacheJson_(cfg, payloadFromLooker_(cfg));
    } catch (err) {
      console.error("Cafe " + id + ": " + err.message); // one broken cafe doesn't stop the others
    }
  });
  try { cacheJson_(KITCHEN_CFG, kitchenPayloadFromLooker_()); } catch (err) { console.error("Kitchen: " + err.message); }
}
// Run ONCE from the editor: refreshes the cache from the Looker studio tabs every 15 minutes
function setupDashboardTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "refreshDashboardCache") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("refreshDashboardCache").timeBased().everyMinutes(15).create();
  refreshDashboardCache();
}

/* ── Date range ── */

// "YYYY-MM-DD" strings -> {start, end} at midnight; none -> last full Mon–Sun week
function resolveRange_(startStr, endStr) {
  if (!startStr && !endStr) {
    var end = midnight_(new Date());
    end = addDays_(end, -(((end.getDay() + 6) % 7) + 1)); // last Sunday
    return { start: addDays_(end, -6), end: end };
  }
  var start = parseYmd_(startStr), finish = parseYmd_(endStr);
  if (!start || !finish) throw new Error("Dates must look like 2026-10-05 (YYYY-MM-DD).");
  if (start > finish) throw new Error("Start date must be on or before the end date.");
  if (dayCount_(start, finish) > CONFIG.maxRangeDays) throw new Error("Pick a range of " + CONFIG.maxRangeDays + " days or less.");
  return { start: start, end: finish };
}

// Current range, the same number of days just before it, and the same dates last year
function windows_(start, end) {
  var days = dayCount_(start, end);
  return {
    curr: { start: start, end: end },
    prev: { start: addDays_(start, -days), end: addDays_(start, -1) },
    ly:   { start: shiftYears_(start, -1), end: shiftYears_(end, -1) }
  };
}

/* ── Reading the sheets by header name ── */

// Every sales row dated from..to (inclusive) from the cafe's year tabs
function readRows_(cfg, from, to) {
  // With a last-year tab, each tab only supplies its own financial year (FY starts 1 April),
  // so a sale present in both tabs is never counted twice
  var fyStart = cfg.lastYearTab ? financialYearStart_(new Date()) : null;
  var sources = [
    { id: cfg.currentYearSheetId || cfg.salesSheetId, tab: cfg.currentYearTab, from: fyStart, to: null },
    { id: cfg.salesSheetId, tab: cfg.lastYearTab, from: null, to: fyStart ? addDays_(fyStart, -1) : null }
  ];
  var out = [];
  sources.forEach(function(src) {
    if (!src.tab) return;
    var sheet = findSheet_(SpreadsheetApp.openById(src.id), src.tab);
    if (!sheet) throw new Error("Tab '" + src.tab + "' not found for cafe '" + cfg.id + "'. Check its tab names and sheet IDs in CAFES at the top of Code.gs.");
    var lo = src.from && src.from > from ? src.from : from, hi = src.to && src.to < to ? src.to : to;
    if (lo <= hi) out = out.concat(readTab_(sheet, lo, hi));
  });
  return out;
}

// 1 April of the financial year that the date falls in (Jan–Mar belong to the year that started the April before)
function financialYearStart_(d) {
  return new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
}

// One tab's rows as plain objects; from/to (midnight dates) limit the dates, null = all rows
function readTab_(sheet, from, to) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var col = mapHeaders_(values[0], sheet.getName());
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var date = parseDate_(r[col.date]);
    if (!date || (from && date < from) || (to && date > to)) continue;
    out.push({
      date: date,
      dateRaw: r[col.date],
      month: col.month >= 0 ? r[col.month] : "",
      timestampRaw: col.timestamp >= 0 ? r[col.timestamp] : "",
      hour: col.timestamp >= 0 ? parseHour_(r[col.timestamp]) : null,
      invoice: String(r[col.invoice]).trim(),
      orderType: col.orderType >= 0 ? String(r[col.orderType] || "").trim() : "",
      // Pick Up rows have a blank Area, so fall back to the Order Type
      area: (col.area >= 0 ? String(r[col.area] || "").trim() : "") || String(col.orderType >= 0 ? r[col.orderType] || "" : "").trim(),
      item: String(r[col.item] || "").trim(),
      qty: Number(r[col.qty]) || 0,
      amount: Number(r[col.amount]) || 0,
      group: String(r[col.group] || "").trim(),
      category: col.category >= 0 ? String(r[col.category] || "").trim() : "",
      type: col.type >= 0 ? String(r[col.type] || "").trim() : ""
    });
  }
  return out;
}
// Header row -> { field: column index or -1 }; throws if a required header is missing
function mapHeaders_(header, sheetName, fields, required) {
  fields = fields || FIELDS;
  required = required || REQUIRED;
  var index = {};
  header.forEach(function(h, i) {
    var k = norm_(h);
    if (k && !(k in index)) index[k] = i;
  });
  var col = {}, missing = [];
  Object.keys(fields).forEach(function(field) {
    col[field] = -1;
    for (var j = 0; j < fields[field].length; j++) {
      var k = norm_(fields[field][j]);
      if (k in index) { col[field] = index[k]; break; }
    }
    if (col[field] < 0 && required.indexOf(field) >= 0) missing.push(fields[field].join(" / "));
  });
  if (missing.length) throw new Error("Tab '" + sheetName + "' has no column named: " + missing.join(", ") + ". Rename the header or add the name to FIELDS in Code.gs.");
  return col;
}

function findSheet_(ss, name) {
  var want = norm_(name), sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) if (norm_(sheets[i].getName()) === want) return sheets[i];
  return null;
}

/* ── Dashboard payload ── */

var LOOKER_HEADER = ["Month", "Date", "Timestamp", "Invoice No.", "Order Type", "Area", "Item Name",
                     "Qty.", "Sub Total", "Category", "Sub-Category", "Type"];

// Replaces the cafe's Looker studio tab with: the range, the same number of days
// before it, and the same dates last year. Returns the dashboard for that data.
function extractToLooker_(cfg, start, end) {
  var output = findSheet_(SpreadsheetApp.openById(cfg.salesSheetId), cfg.lookerTab);
  if (!output) throw new Error("Tab '" + cfg.lookerTab + "' not found for cafe '" + cfg.id + "'. Check lookerTab in CAFES at the top of Code.gs.");
  var w = windows_(start, end);
  var rows = readRows_(cfg, minDate_([w.curr.start, w.prev.start, w.ly.start]), w.curr.end);
  var sets = { "Current": inWindow_(rows, w.curr), "Previous": inWindow_(rows, w.prev), "Last Year": inWindow_(rows, w.ly) };

  var values = [];
  Object.keys(sets).forEach(function(type) {
    sets[type].forEach(function(r) {
      values.push([r.month, r.dateRaw, r.timestampRaw, r.invoice, r.orderType, r.area, r.item,
                   r.qty, r.amount, r.category, r.group, type]);
    });
  });
  output.clearContents();
  output.getRange(1, 1, 1, LOOKER_HEADER.length).setValues([LOOKER_HEADER]);
  if (values.length) output.getRange(2, 1, values.length, LOOKER_HEADER.length).setValues(values);
  PropertiesService.getScriptProperties().setProperty("range:" + cfg.id, ymd_(start) + "|" + ymd_(end));

  return buildPayload_(cfg, sets["Current"], sets["Previous"], sets["Last Year"], w);
}

// The dashboard for whatever is in the cafe's Looker studio tab right now
function payloadFromLooker_(cfg) {
  var sheet = findSheet_(SpreadsheetApp.openById(cfg.salesSheetId), cfg.lookerTab);
  if (!sheet) throw new Error("Tab '" + cfg.lookerTab + "' not found for cafe '" + cfg.id + "'. Check lookerTab in CAFES at the top of Code.gs.");
  var by = { "current": [], "previous": [], "last year": [] };
  readTab_(sheet, null, null).forEach(function(r) {
    var t = r.type.toLowerCase();
    if (by[t]) by[t].push(r);
  });
  // The range of the last Load; if the tab was filled some other way, use the dates of its Current rows
  var saved = String(PropertiesService.getScriptProperties().getProperty("range:" + cfg.id) || "").split("|");
  var range = saved.length === 2 ? { start: parseYmd_(saved[0]), end: parseYmd_(saved[1]) } : null;
  if (!range && by["current"].length) {
    var times = by["current"].map(function(r) { return r.date.getTime(); });
    range = { start: new Date(Math.min.apply(null, times)), end: new Date(Math.max.apply(null, times)) };
  }
  if (!range) throw new Error("The Looker studio tab of cafe '" + cfg.id + "' is empty — pick dates and press Load.");
  return buildPayload_(cfg, by["current"], by["previous"], by["last year"], windows_(range.start, range.end));
}

function buildPayload_(cfg, curr, prev, ly, w) {
  var currTotal = sumAmount_(curr), prevTotal = sumAmount_(prev), lyTotal = sumAmount_(ly);
  var currOrders = countOrders_(curr), prevOrders = countOrders_(prev);

  return {
    kpis: {
      currTotal: currTotal, prevTotal: prevTotal, lyTotal: lyTotal,
      currOrders: currOrders, prevOrders: prevOrders,
      currQty: sumQty_(curr), prevQty: sumQty_(prev),
      currAOV: currOrders ? Math.round(currTotal / currOrders) : 0,
      prevAOV: prevOrders ? Math.round(prevTotal / prevOrders) : 0,
      wowChange: pct_(currTotal, prevTotal), yoyChange: pct_(currTotal, lyTotal)
    },
    dayWise: buildDayWise_(curr, prev),
    periodComparison: [
      { label: "Last Year", value: lyTotal },
      { label: "Previous Week", value: prevTotal },
      { label: "Current Week", value: currTotal }
    ],
    subCategories: buildSubCategories_(curr, prev),
    topBeverages: topItems_(curr, "Beverages"),
    topSavoury: topItems_(curr, "Savoury"),
    topDessert: topItems_(curr, "Dessert"),
    topEdit: topItems_(curr, "Edit"),
    channels: buildChannels_(curr, prev),
    areas: sumBy_(curr, "area"),
    areasPrev: sumBy_(prev, "area"),
    hourly: buildHourly_(curr),
    editSpotlight: buildEditSpotlight_(curr, prev),
    complaints: buildComplaintsData_(cfg, w.curr.start, w.curr.end),
    variance: buildVarianceData_(cfg),
    ccg: buildCcgData_(cfg),
    meta: {
      start: ymd_(w.curr.start), end: ymd_(w.curr.end),
      currDateRange: label_(w.curr), prevDateRange: label_(w.prev),
      totalRows: curr.length,
      generatedAt: new Date().toISOString()
    }
  };
}

function inWindow_(rows, win) {
  return rows.filter(function(r) { return r.date >= win.start && r.date <= win.end; });
}
function sumAmount_(rows) { return Math.round(rows.reduce(function(s, r) { return s + r.amount; }, 0)); }
function sumQty_(rows) { return rows.reduce(function(s, r) { return s + r.qty; }, 0); }
function countOrders_(rows) {
  var seen = {};
  rows.forEach(function(r) { seen[r.invoice] = true; });
  return Object.keys(seen).length;
}
function pct_(c, p) { return p ? Number((((c - p) / p) * 100).toFixed(1)) : 0; }

// Sales per distinct value of a field (e.g. Area), largest first
function sumBy_(rows, field) {
  var map = {};
  rows.forEach(function(r) {
    var k = r[field] || "Unspecified";
    map[k] = (map[k] || 0) + r.amount;
  });
  return Object.keys(map)
    .map(function(name) { return { name: name, value: Math.round(map[name]) }; })
    .sort(function(a, b) { return b.value - a.value; });
}

function buildDayWise_(curr, prev) {
  var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var c = {}, p = {}, orders = {};
  order.forEach(function(d) { c[d] = 0; p[d] = 0; orders[d] = {}; });
  curr.forEach(function(r) {
    var d = names[r.date.getDay()];
    c[d] += r.amount;
    orders[d][r.invoice] = true;
  });
  prev.forEach(function(r) { p[names[r.date.getDay()]] += r.amount; });
  return order.map(function(d) {
    var cv = Math.round(c[d]), pv = Math.round(p[d]);
    return { day: d, curr: cv, prev: pv, change: pct_(cv, pv), orders: Object.keys(orders[d]).length };
  });
}

function buildSubCategories_(curr, prev) {
  return GROUPS.map(function(name) {
    var c = curr.filter(function(r) { return r.group === name; });
    var p = prev.filter(function(r) { return r.group === name; });
    var cv = sumAmount_(c), pv = sumAmount_(p);
    return { name: name, curr: cv, prev: pv, change: pct_(cv, pv), currQty: sumQty_(c), prevQty: sumQty_(p) };
  });
}

// One channel per distinct Order Type ("Dine In" and "dine in" count as one)
function buildChannels_(curr, prev) {
  var map = {};
  function add(rows, key) {
    rows.forEach(function(r) {
      var name = r.orderType || "Unspecified", id = name.toLowerCase();
      if (!map[id]) map[id] = { name: name, curr: 0, prev: 0 };
      map[id][key] += r.amount;
    });
  }
  add(curr, "curr");
  add(prev, "prev");
  return Object.keys(map).map(function(id) {
    var c = Math.round(map[id].curr), p = Math.round(map[id].prev);
    return { name: map[id].name, curr: c, prev: p, change: pct_(c, p) };
  }).sort(function(a, b) { return b.curr - a.curr; });
}

function buildHourly_(curr) {
  var byHour = {};
  curr.forEach(function(r) {
    if (r.hour !== null) byHour[r.hour] = (byHour[r.hour] || 0) + r.amount;
  });
  var hours = [];
  for (var h = 7; h <= 22; h++) hours.push({ hour: h, sales: Math.round(byHour[h] || 0) });
  return hours;
}

function topItems_(curr, group) {
  return sumBy_(curr.filter(function(r) { return r.group === group && r.item; }), "item").slice(0, 5);
}

function buildEditSpotlight_(curr, prev) {
  var c = curr.filter(function(r) { return r.group === "Edit"; });
  var p = prev.filter(function(r) { return r.group === "Edit"; });
  var items = {};
  function add(rows, money, qty) {
    rows.forEach(function(r) {
      if (!r.item) return;
      var it = items[r.item] || (items[r.item] = { name: r.item, curr: 0, prev: 0, currQty: 0, prevQty: 0 });
      it[money] += r.amount;
      it[qty] += r.qty;
    });
  }
  add(c, "curr", "currQty");
  add(p, "prev", "prevQty");
  var list = Object.keys(items).map(function(k) {
    var it = items[k];
    it.curr = Math.round(it.curr);
    it.prev = Math.round(it.prev);
    return it;
  }).sort(function(a, b) { return b.currQty - a.currQty; }); // every Edit item (the dashboard's pop-up lists them all)
  return {
    total: sumAmount_(c), prevTotal: sumAmount_(p), qty: sumQty_(c), prevQty: sumQty_(p),
    orders: countOrders_(c), prevOrders: countOrders_(p), // orders that contain at least one Edit item
    items: list
  };
}

/* ── Customer complaints (separate spreadsheet) ── */

// Complaint columns used, found by header name (case, spaces and punctuation ignored)
var COMPLAINT_FIELDS = {
  date:    ["Date"],
  channel: ["Channel"],
  desc:    ["Complaint Description"],
  item:    ["Item Name"],
  valid:   ["Valid/Invalid"],
  notes:   ["Notes / Action Taken", "Notes & Action Taken", "Notes", "Action Taken"]
};

function buildComplaintsData_(cfg, start, end) {
  try {
    var sheet = findSheet_(SpreadsheetApp.openById(cfg.complaintsSheetId), cfg.complaintsTab);
    if (!sheet) return { error: "Tab '" + cfg.complaintsTab + "' not found in the complaints spreadsheet. Check complaintsTab in CAFES at the top of Code.gs." };
    var data = sheet.getDataRange().getValues();

    // The header row sits under a title banner: take the first row (of the top 10) that has "Date" and "Complaint Description"
    var headerRow = -1;
    for (var h = 0; h < Math.min(10, data.length) && headerRow < 0; h++) {
      var names = data[h].map(norm_);
      if (names.indexOf("date") >= 0 && names.indexOf("complaintdescription") >= 0) headerRow = h;
    }
    if (headerRow < 0) return { error: "No header row with 'Date' and 'Complaint Description' in the top 10 rows of " + cfg.complaintsTab };

    var names = data[headerRow].map(norm_), col = {};
    Object.keys(COMPLAINT_FIELDS).forEach(function(f) {
      col[f] = -1;
      COMPLAINT_FIELDS[f].some(function(n) { col[f] = names.indexOf(norm_(n)); return col[f] >= 0; });
    });
    function cell(row, i) { return i >= 0 ? String(row[i] || "").trim() : ""; }

    var rows = [];
    for (var r = headerRow + 1; r < data.length; r++) {
      var d = parseDate_(data[r][col.date]);
      if (!d || d < start || d > end) continue;
      rows.push({
        date: d, channel: cell(data[r], col.channel), desc: cell(data[r], col.desc),
        item: cell(data[r], col.item), valid: cell(data[r], col.valid), notes: cell(data[r], col.notes)
      });
    }

    var byChannel = {};
    rows.forEach(function(x) { var k = x.channel || "Unspecified"; byChannel[k] = (byChannel[k] || 0) + 1; });

    return {
      total: rows.length,
      validCount: rows.filter(function(x) { return x.valid.toLowerCase() === "valid"; }).length,
      byChannel: Object.keys(byChannel).map(function(k) { return { name: k, value: byChannel[k] }; })
        .sort(function(a, b) { return b.value - a.value; }),
      rows: rows.sort(function(a, b) { return b.date - a.date; }).slice(0, 25).map(function(x) {
        return {
          date: Utilities.formatDate(x.date, Session.getScriptTimeZone(), "d MMM"),
          channel: x.channel, desc: x.desc, item: x.item, valid: x.valid, notes: x.notes
        };
      })
    };
  } catch (err) {
    return { error: err.message };
  }
}

/* ── Stock variance (a tab in the cafe's own spreadsheet; a snapshot, not filtered by date) ── */

var VARIANCE_FIELDS = {
  dept:     ["Department"],
  item:     ["Item"],
  uom:      ["UOM", "Unit"],
  opening:  ["Opening"],
  purchase: ["Purchase"],
  sale:     ["Sale"],
  system:   ["System Generated Closing"],
  team:     ["Closing Given By Team"],
  diff:     ["Difference"],
  reason:   ["Reasons", "Reason"]
};

function buildVarianceData_(cfg) {
  if (!cfg.varianceTab) return null;
  try {
    var sheet = findSheet_(SpreadsheetApp.openById(cfg.salesSheetId), cfg.varianceTab);
    if (!sheet) return { error: "Tab '" + cfg.varianceTab + "' not found for cafe '" + cfg.id + "'. Check varianceTab in CAFES at the top of Code.gs." };
    var data = sheet.getDataRange().getValues();

    // The header row can sit below notes or a title: take the first row (of the top 30) with "Department" and "Item"
    var headerRow = -1;
    for (var h = 0; h < Math.min(30, data.length) && headerRow < 0; h++) {
      var found = data[h].map(norm_);
      if (found.indexOf("department") >= 0 && found.indexOf("item") >= 0) headerRow = h;
    }
    if (headerRow < 0) return { error: "No header row with 'Department' and 'Item' in the top 30 rows of " + cfg.varianceTab };

    var names = data[headerRow].map(norm_), col = {};
    Object.keys(VARIANCE_FIELDS).forEach(function(f) {
      col[f] = -1;
      VARIANCE_FIELDS[f].some(function(n) { col[f] = names.indexOf(norm_(n)); return col[f] >= 0; });
    });
    function text(row, i) { return i >= 0 ? String(row[i] || "").trim() : ""; }
    function num(row, i) {
      if (i < 0 || row[i] === "" || row[i] === null) return null;
      var n = Number(row[i]);
      return isNaN(n) ? null : n;
    }

    var rows = [];
    for (var r = headerRow + 1; r < data.length; r++) {
      var row = data[r], item = text(row, col.item);
      if (!item) continue;
      var system = num(row, col.system), team = num(row, col.team), diff = num(row, col.diff);
      // Difference = closing given by team − system closing, when the sheet leaves it blank
      if (diff === null && system !== null && team !== null) diff = Math.round((team - system) * 1000) / 1000;
      rows.push({
        dept: text(row, col.dept) || "Other", item: item, uom: text(row, col.uom),
        opening: num(row, col.opening), purchase: num(row, col.purchase), sale: num(row, col.sale),
        system: system, team: team, diff: diff, reason: text(row, col.reason)
      });
    }
    return { rows: rows };
  } catch (err) {
    return { error: err.message };
  }
}

/* ── CCG breakage (a tab in the cafe's own spreadsheet; a snapshot, not filtered by date) ── */

var CCG_FIELDS = {
  item:   ["Item Name", "CCG Name", "Item"],
  cost:   ["Cost Per Pcs", "Cost Per Piece", "Amount Per Pcs"],
  qty:    ["Breakage", "Qty", "Quantity"],
  amount: ["Breakage Amount", "Total Amount", "Amount"],
  reason: ["Reasons", "Reason"]
};

function buildCcgData_(cfg) {
  if (!cfg.ccgTab) return null;
  try {
    var sheet = findSheet_(SpreadsheetApp.openById(cfg.salesSheetId), cfg.ccgTab);
    if (!sheet) return { error: "Tab '" + cfg.ccgTab + "' not found for cafe '" + cfg.id + "'. Check ccgTab in CAFES at the top of Code.gs." };
    var data = sheet.getDataRange().getValues();

    // first row (of the top 30) that names the item column
    var headerRow = -1;
    for (var h = 0; h < Math.min(30, data.length) && headerRow < 0; h++) {
      var found = data[h].map(norm_);
      if (CCG_FIELDS.item.some(function(n) { return found.indexOf(norm_(n)) >= 0; })) headerRow = h;
    }
    if (headerRow < 0) return { error: "No header row with 'Item Name' in the top 30 rows of " + cfg.ccgTab };

    var names = data[headerRow].map(norm_), col = {};
    Object.keys(CCG_FIELDS).forEach(function(f) {
      col[f] = -1;
      CCG_FIELDS[f].some(function(n) { col[f] = names.indexOf(norm_(n)); return col[f] >= 0; });
    });
    function num(row, i) {
      if (i < 0 || row[i] === "" || row[i] === null) return null;
      var n = Number(row[i]);
      return isNaN(n) ? null : n;
    }

    var rows = [];
    for (var r = headerRow + 1; r < data.length; r++) {
      var row = data[r], item = col.item >= 0 ? String(row[col.item] || "").trim() : "";
      if (!item) continue;
      var cost = num(row, col.cost), qty = num(row, col.qty), amount = num(row, col.amount);
      if (amount === null && cost !== null && qty !== null) amount = cost * qty; // blank total = cost × qty
      rows.push({ item: item, cost: cost, qty: qty, amount: amount, reason: col.reason >= 0 ? String(row[col.reason] || "").trim() : "" });
    }
    return { rows: rows };
  } catch (err) {
    return { error: err.message };
  }
}

/* ════════════════════════════════════════════════════════════════════
   🏭 CENTRAL KITCHEN
   Same flow as the cafes: Load refills the kitchen's "Looker Studio" tab
   (Current / Previous / Last Year rows) and the dashboard reads that tab.
   This financial year comes item by item from CK Itemwise Sales; earlier
   dates come invoice by invoice from CK New Weekly Report. Matching columns:
     Sub Total ↔ Net Sales · Tax ↔ Total Tax · Final Total ↔ Total ·
     Month, Date, Area, Invoice — same names in both.
   Bulk and event enquiries come from their own spreadsheets.
   ════════════════════════════════════════════════════════════════════ */

var KITCHEN_FIELDS = {
  month:    ["Month"],
  date:     ["Date"],
  invoice:  ["Invoice No.", "Invoice Number", "Invoice"],
  area:     ["Area"],
  item:     ["Item Name"],
  qty:      ["Qty.", "Quantity"],
  amount:   ["Sub Total", "Net Sales"],          // sales value, before tax
  tax:      ["Tax", "Total Tax"],
  total:    ["Final Total", "Total"],
  category: ["Category"],
  group:    ["Super Category", "Sub-Category"],  // department
  cogs:     ["COGS"],
  type:     ["Type"]                             // only in the Looker Studio tab
};
var KITCHEN_LOOKER_HEADER = ["Month", "Date", "Invoice No.", "Area", "Item Name", "Qty.", "Sub Total", "Tax",
                             "Final Total", "Category", "Super Category", "COGS", "Type"];
var KITCHEN_CFG = { id: "kitchen" }; // cache key "dash:kitchen"

function kitchenReady_() {
  ["currentYearSheetId", "lastYearSheetId"].forEach(function(k) {
    if (!KITCHEN[k] || /^PASTE_/.test(KITCHEN[k]))
      throw new Error("The Central Kitchen isn't connected yet — paste " + k + " in KITCHEN at the top of Code.gs.");
  });
}

// One kitchen tab as row objects; from/to (midnight dates) limit the dates, null = all rows
function readKitchenTab_(sheetId, tab, from, to) {
  var sheet = findSheet_(SpreadsheetApp.openById(sheetId), tab);
  if (!sheet) throw new Error("Tab '" + tab + "' not found for the Central Kitchen. Check KITCHEN at the top of Code.gs.");
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var col = mapHeaders_(values[0], sheet.getName(), KITCHEN_FIELDS, ["date", "amount"]);
  function text(r, f) { return col[f] >= 0 ? String(r[col[f]] || "").trim() : ""; }
  function num(r, f) { var n = col[f] >= 0 ? Number(r[col[f]]) : 0; return isNaN(n) ? 0 : n; } // "#N/A" counts as 0
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], date = parseDate_(r[col.date]);
    if (!date || (from && date < from) || (to && date > to)) continue;
    out.push({
      date: date, dateRaw: r[col.date], month: col.month >= 0 ? r[col.month] : "",
      invoice: text(r, "invoice"), area: text(r, "area") || "Unspecified", item: text(r, "item"),
      qty: num(r, "qty"), amount: num(r, "amount"), tax: num(r, "tax"), total: num(r, "total"),
      category: text(r, "category"), group: text(r, "group"), cogs: num(r, "cogs"), type: text(r, "type")
    });
  }
  return out;
}

// This financial year from CK Itemwise Sales, earlier dates from CK New Weekly Report — never both
function readKitchenRows_(from, to) {
  var fyStart = financialYearStart_(new Date()), lastFyEnd = addDays_(fyStart, -1);
  var rows = [];
  if (to >= fyStart) rows = rows.concat(readKitchenTab_(KITCHEN.currentYearSheetId, KITCHEN.currentYearTab, from > fyStart ? from : fyStart, to));
  if (from <= lastFyEnd) rows = rows.concat(readKitchenTab_(KITCHEN.lastYearSheetId, KITCHEN.lastYearTab, from, to < lastFyEnd ? to : lastFyEnd));
  return rows;
}

// Load: refill the kitchen's Looker Studio tab for the range and return its dashboard
function extractKitchenToLooker_(start, end) {
  kitchenReady_();
  var output = findSheet_(SpreadsheetApp.openById(KITCHEN.lastYearSheetId), KITCHEN.lookerTab);
  if (!output) throw new Error("Tab '" + KITCHEN.lookerTab + "' not found in CK New Weekly Report. Check KITCHEN at the top of Code.gs.");
  var w = windows_(start, end);
  var rows = readKitchenRows_(minDate_([w.curr.start, w.prev.start, w.ly.start]), w.curr.end);
  var sets = { "Current": inWindow_(rows, w.curr), "Previous": inWindow_(rows, w.prev), "Last Year": inWindow_(rows, w.ly) };
  var values = [];
  Object.keys(sets).forEach(function(type) {
    sets[type].forEach(function(r) {
      values.push([r.month, r.dateRaw, r.invoice, r.area, r.item, r.qty, r.amount, r.tax, r.total, r.category, r.group, r.cogs, type]);
    });
  });
  output.clearContents();
  output.getRange(1, 1, 1, KITCHEN_LOOKER_HEADER.length).setValues([KITCHEN_LOOKER_HEADER]);
  if (values.length) output.getRange(2, 1, values.length, KITCHEN_LOOKER_HEADER.length).setValues(values);
  PropertiesService.getScriptProperties().setProperty("range:kitchen", ymd_(start) + "|" + ymd_(end));
  return buildKitchenPayload_(sets["Current"], sets["Previous"], sets["Last Year"], w);
}

// The kitchen dashboard for whatever is in its Looker Studio tab right now
function kitchenPayloadFromLooker_() {
  kitchenReady_();
  var by = { "current": [], "previous": [], "last year": [] };
  readKitchenTab_(KITCHEN.lastYearSheetId, KITCHEN.lookerTab, null, null).forEach(function(r) {
    var t = r.type.toLowerCase();
    if (by[t]) by[t].push(r);
  });
  var saved = String(PropertiesService.getScriptProperties().getProperty("range:kitchen") || "").split("|");
  var range = saved.length === 2 ? { start: parseYmd_(saved[0]), end: parseYmd_(saved[1]) } : null;
  if (!range && by["current"].length) {
    var times = by["current"].map(function(r) { return r.date.getTime(); });
    range = { start: new Date(Math.min.apply(null, times)), end: new Date(Math.max.apply(null, times)) };
  }
  if (!range) throw new Error("The kitchen's Looker Studio tab is empty — pick dates and press Load.");
  return buildKitchenPayload_(by["current"], by["previous"], by["last year"], windows_(range.start, range.end));
}

function kitchenPayloadJson_(refresh) {
  return (!refresh && CacheService.getScriptCache().get("dash:kitchen")) || cacheJson_(KITCHEN_CFG, kitchenPayloadFromLooker_());
}

function buildKitchenPayload_(curr, prev, ly, w) {
  function total(rows, f) { return Math.round(rows.reduce(function(s, r) { return s + (r[f] || 0); }, 0)); }
  // current vs previous per value of a field (Area, department), largest first
  function compare(field, onlyItems) {
    var map = {};
    function add(rows, key) {
      rows.forEach(function(r) {
        if (onlyItems && !r.item) return;
        var k = r[field] || "Unspecified";
        map[k] = map[k] || { name: k, curr: 0, prev: 0 };
        map[k][key] += r.amount;
      });
    }
    add(curr, "curr");
    add(prev, "prev");
    return Object.keys(map).map(function(k) {
      return { name: k, curr: Math.round(map[k].curr), prev: Math.round(map[k].prev) };
    }).sort(function(a, b) { return b.curr - a.curr; });
  }

  var items = curr.filter(function(r) { return r.item; });
  var departments = compare("group", true).filter(function(d) { return d.name !== "Unspecified"; });
  var top = departments.map(function(d) { // every department; the dashboard picks which cards to show
    var list = sumBy_(items.filter(function(r) { return (r.group || "Unspecified") === d.name; }), "item");
    return { dept: d.name, total: d.curr, items: list.slice(0, 5) };
  });
  var best = sumBy_(items, "item")[0];
  var topItem = best ? {
    name: best.name,
    dept: (items.filter(function(r) { return r.item === best.name; })[0] || {}).group || "",
    curr: best.value,
    prev: total(prev.filter(function(r) { return r.item === best.name; }), "amount"),
    qty: sumQty_(items.filter(function(r) { return r.item === best.name; }))
  } : { name: "—", dept: "", curr: 0, prev: 0, qty: 0 };

  // COGS split: the "Others" department (add-ons such as trays, candles, bouquets) is non-food
  function isNonFood(r) { return /^others?$/i.test(r.group); }
  function cogs(rows, nonFood) { return total(rows.filter(function(r) { return r.item && isNonFood(r) === nonFood; }), "cogs"); }

  return {
    kpis: { curr: total(curr, "amount"), prev: total(prev, "amount"), ly: total(ly, "amount") },
    channels: compare("area", false),
    departments: departments,
    topItem: topItem,
    foodCost: { curr: cogs(curr, false), prev: cogs(prev, false) },
    nonFoodCost: { curr: cogs(curr, true), prev: cogs(prev, true) },
    top: top,
    bulk: readEnquiries_(KITCHEN.bulkSheetId, KITCHEN.bulkTab, w.curr),
    events: readEnquiries_(KITCHEN.eventSheetId, KITCHEN.eventTab, w.curr),
    meta: {
      start: ymd_(w.curr.start), end: ymd_(w.curr.end),
      currDateRange: label_(w.curr), prevDateRange: label_(w.prev),
      generatedAt: new Date().toISOString()
    }
  };
}

// Bulk / event enquiries dated inside the range (one row per enquiry)
var ENQUIRY_FIELDS = {
  id:    ["Enquire ID", "Enquiry ID"],
  date:  ["Enquire Date", "Enquiry Date"],
  stage: ["Stage"],
  units: ["Final Units", "Units"],
  value: ["Order Value", "Confirmed Revenue"]
};
function readEnquiries_(sheetId, tab, win) {
  if (!sheetId || /^PASTE_/.test(sheetId)) return { error: "Not connected yet — paste its Sheet ID in KITCHEN at the top of Code.gs." };
  try {
    var sheet = findSheet_(SpreadsheetApp.openById(sheetId), tab);
    if (!sheet) return { error: "Tab '" + tab + "' not found. Check KITCHEN at the top of Code.gs." };
    var data = sheet.getDataRange().getValues();
    var headerRow = -1;
    for (var h = 0; h < Math.min(10, data.length) && headerRow < 0; h++) {
      var found = data[h].map(norm_);
      if (found.indexOf("stage") >= 0) headerRow = h;
    }
    if (headerRow < 0) return { error: "No header row with 'Stage' in the top 10 rows of " + tab };
    var col = mapHeaders_(data[headerRow], tab, ENQUIRY_FIELDS, ["date", "stage"]);
    var rows = [];
    for (var r = headerRow + 1; r < data.length; r++) {
      var row = data[r], d = parseDate_(row[col.date]);
      if (!d || d < win.start || d > win.end) continue;
      var units = col.units >= 0 && row[col.units] !== "" ? Number(row[col.units]) : null;
      var value = col.value >= 0 && row[col.value] !== "" ? Number(row[col.value]) : null;
      rows.push({
        id: col.id >= 0 ? String(row[col.id] || "").trim() : "",
        date: Utilities.formatDate(d, Session.getScriptTimeZone(), "d MMM"),
        stage: String(row[col.stage] || "").trim(),
        units: units === null || isNaN(units) ? null : units,
        value: value === null || isNaN(value) ? null : value
      });
    }
    return { rows: rows };
  } catch (err) {
    return { error: err.message };
  }
}

/* ── "Functions > Extract Financial Data" menu (feeds Looker Studio) ── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Functions")
    .addItem("Extract Financial Data", "extractFinancialData")
    .addToUi();
}

// Same as the dashboard's Load button, for the spreadsheet you're in
function extractFinancialData() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try { cfg = activeCafe_(); } catch (err) { return ui.alert("❌ " + err.message); }

  function ask(title, example) {
    var resp = ui.prompt(title, "Format: YYYY-MM-DD (e.g. " + example + ")", ui.ButtonSet.OK_CANCEL);
    return resp.getSelectedButton() === ui.Button.OK ? resp.getResponseText().trim() : null;
  }
  var startStr = ask("Start Date", "2026-04-01");
  if (startStr === null) return;
  var endStr = ask("End Date", "2026-04-07");
  if (endStr === null) return;

  try {
    var range = resolveRange_(startStr, endStr);
    var payload = extractToLooker_(cfg, range.start, range.end);
    cacheJson_(cfg, payload);
    ui.alert("✅ Looker studio tab refilled\n\n" +
      "Current: " + payload.meta.currDateRange + "\n" +
      "Previous: " + payload.meta.prevDateRange + "\n" +
      "Last year: same dates");
  } catch (err) {
    ui.alert("❌ " + err.message);
  }
}
/* ── Small helpers ── */

function norm_(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function midnight_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays_(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function shiftYears_(d, n) { var x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; }
function dayCount_(start, end) { return Math.round((end - start) / DAY_MS) + 1; }
function minDate_(dates) { return new Date(Math.min.apply(null, dates)); }
function ymd_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function label_(win) {
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(win.start, tz, "d MMM") + " – " + Utilities.formatDate(win.end, tz, "d MMM");
}

function parseYmd_(s) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim());
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// Sheet date cell -> midnight Date. Handles real dates, "2026-09-30", "6/29/2025" (month first).
function parseDate_(v) {
  if (v instanceof Date) return isNaN(v) ? null : midnight_(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    var u = new Date(Math.round((v - 25569) * DAY_MS)); // day 25569 = 1 Jan 1970
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  var s = String(v || "").trim();
  if (!s) return null;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  var d = new Date(s);
  return isNaN(d) ? null : midnight_(d);
}

// Timestamp cell -> hour 0–23, or null
function parseHour_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v.getHours();
  var m = /(\d{1,2}):(\d{2})/.exec(String(v || ""));
  return m ? Number(m[1]) : null;
}
