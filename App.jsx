import { useState, useMemo, useCallback } from "react";
import * as Papa from "papaparse";
import * as XLSX from "xlsx";

// ─── Helpers ────────────────────────────────────────────────────────────────
const parseNum = (v) => {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[$€£¥\s,]/g, "");
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1);
  const n = Number(s);
  return isNaN(n) ? NaN : n;
};

const fmt = (v) => {
  if (v == null || v === "") return "—";
  const n = parseNum(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const isExcel = (file) => {
  const ext = file.name.toLowerCase();
  return ext.endsWith(".xls") || ext.endsWith(".xlsx") || ext.endsWith(".xlsm") || ext.endsWith(".xlsb");
};

const readAsArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });

const parseCSV = (file) =>
  new Promise((resolve) => {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data) });
  });

const parseFile = async (file) => {
  if (isExcel(file)) {
    const buffer = await readAsArrayBuffer(file);
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" });
  }
  return parseCSV(file);
};

const detectIdCol = (headers) => {
  const candidates = ["manageddealname", "managed_deal_name", "deal_id", "dealid", "deal id", "trade_id", "tradeid", "trade id", "id"];
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) { const idx = lower.indexOf(c); if (idx !== -1) return headers[idx]; }
  return headers[0];
};

const detectInstrCol = (headers) => {
  const candidates = ["instrumenttype","instrument_type","instrument type","instrumentname","instrument_name","instrument name","instrument_id","instrumentid","instrument id","instrument","security_id","securityid","security id","security","isin","cusip","ticker","symbol","asset_id","assetid","asset id","asset","position_id","positionid","position id","leg_id","legid","leg id","leg"];
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) { const idx = lower.indexOf(c); if (idx !== -1) return headers[idx]; }
  return headers.length > 1 ? headers[1] : headers[0];
};

const detectCurrCol = (headers) => {
  const candidates = ["exposurecurrency","exposure_currency","currency","curr","ccy","exposure_ccy","deal_currency","deal_ccy"];
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) { const idx = lower.indexOf(c); if (idx !== -1) return headers[idx]; }
  for (let i = 0; i < lower.length; i++) { if (lower[i].includes("curr") || lower[i].includes("ccy")) return headers[i]; }
  return "";
};

const detectTypeCol = (headers) => {
  const candidates = ["instrumenttype","instrument_type","type","row_type","entry_type","record_type","category","pnl_type"];
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) { const idx = lower.indexOf(c); if (idx !== -1) return headers[idx]; }
  for (let i = 0; i < lower.length; i++) { if (lower[i].includes("type")) return headers[i]; }
  return "";
};

const classifyStatus = (a, b, pnlPairs) => {
  let hasBreak = false, withinTol = false, totalDiff = 0;
  for (const pair of pnlPairs) {
    const va = parseNum(a[pair.colA]), vb = parseNum(b[pair.colB]);
    if (!isNaN(va) && !isNaN(vb)) {
      const absDiff = Math.abs(va - vb);
      totalDiff += va - vb;
      if (absDiff >= 1) {
        const pct = va !== 0 ? Math.abs((va - vb) / va) * 100 : Infinity;
        if (pct < 1) withinTol = true; else hasBreak = true;
      }
    }
  }
  return { status: hasBreak ? "Break" : withinTol ? "Tolerance" : "Match", totalDiff };
};

const aggregateByKey = (data, keyCol, pnlCols) => {
  const map = new Map();
  data.forEach((row) => {
    const key = String(row[keyCol] != null ? row[keyCol] : "").trim();
    if (!key) return;
    if (!map.has(key)) { const e = { ...row, _rowCount: 0 }; pnlCols.forEach((c) => (e[c] = 0)); map.set(key, e); }
    const entry = map.get(key);
    entry._rowCount += 1;
    pnlCols.forEach((col) => { const v = parseNum(row[col]); if (!isNaN(v)) entry[col] = (entry[col] || 0) + v; });
  });
  return map;
};

const zeroEntry = (cols) => { const e = { _rowCount: 0 }; cols.forEach((c) => (e[c] = 0)); return e; };

const detectPnlCols = (headers) => {
  const pnl = headers.filter((h) => { const l = h.toLowerCase(); return l.includes("pnl")||l.includes("p&l")||l.includes("profit")||l.includes("loss")||l.includes("mtm")||l.includes("mark")||l.includes("value")||l.includes("amount")||l.includes("total")||l.includes("realized")||l.includes("unrealized")||l.includes("proceeds"); });
  return pnl.length > 0 ? pnl : headers.filter((h) => { const l = h.toLowerCase(); return !l.includes("id")&&!l.includes("name")&&!l.includes("desk")&&!l.includes("book")&&!l.includes("date")&&!l.includes("type"); });
};

// ─── Theme ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#0B0F19", surface: "#121828", surfaceAlt: "#182038", border: "#1E2A45",
  text: "#E2E8F0", textDim: "#7A8BA8", accent: "#3B82F6",
  green: "#22C55E", red: "#EF4444", amber: "#F59E0B",
  greenBg: "rgba(34,197,94,0.08)", redBg: "rgba(239,68,68,0.08)", amberBg: "rgba(245,158,11,0.08)",
};

const selectStyle = { width: "100%", padding: "10px 14px", background: C.surfaceAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, outline: "none" };

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({ status }) {
  const map = {
    Match:         { bg: C.greenBg, color: C.green,   border: "rgba(34,197,94,0.25)" },
    Break:         { bg: C.redBg,   color: C.red,     border: "rgba(239,68,68,0.25)" },
    Tolerance:     { bg: C.amberBg, color: C.amber,   border: "rgba(245,158,11,0.25)" },
    "Missing DB":  { bg: C.redBg,   color: C.red,     border: "rgba(239,68,68,0.25)" },
    "Missing ACFT":{ bg: C.redBg,   color: C.red,     border: "rgba(239,68,68,0.25)" },
  };
  const s = map[status] || map.Break;
  return <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, letterSpacing: 0.4, background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: "uppercase", whiteSpace: "nowrap" }}>{status}</span>;
}

// ─── StatCard ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon, onClick, active }) {
  return (
    <div onClick={onClick} style={{ background: active ? "rgba(59,130,246,0.08)" : C.surface, border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 150, cursor: onClick ? "pointer" : "default", transition: "all 0.15s" }}>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 500 }}>{icon} {label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{value}</div>
    </div>
  );
}

// ─── UploadZone ──────────────────────────────────────────────────────────────
function UploadZone({ file, onUpload, systemLabel }) {
  const handleDrop = useCallback((e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) onUpload(f); }, [onUpload]);
  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv,.tsv,.txt,.xls,.xlsx,.xlsm,.xlsb"; inp.onchange = (e) => e.target.files[0] && onUpload(e.target.files[0]); inp.click(); }}
      style={{ flex: 1, minWidth: 280, border: `2px dashed ${file ? C.accent : C.border}`, borderRadius: 14, padding: 32, textAlign: "center", cursor: "pointer", background: file ? "rgba(59,130,246,0.04)" : C.surface, transition: "all 0.2s" }}
    >
      <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.7 }}>{file ? "✓" : "⇧"}</div>
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4, fontSize: 15 }}>{systemLabel}</div>
      {file ? (
        <div style={{ color: C.accent, fontSize: 13, fontWeight: 500 }}>{file.name}</div>
      ) : (
        <>
          <div style={{ color: C.textDim, fontSize: 13 }}>Drop CSV or Excel file, or click to upload</div>
          <div style={{ color: C.textDim, fontSize: 10, marginTop: 6, opacity: 0.5 }}>CSV up to 50 MB · XLSX up to 15 MB</div>
        </>
      )}
    </div>
  );
}

// ─── ConfigModal ─────────────────────────────────────────────────────────────
function ConfigModal({ headersA, headersB, onConfirm, onClose }) {
  const [idColA,   setIdColA]   = useState(() => detectIdCol(headersA));
  const [idColB,   setIdColB]   = useState(() => detectIdCol(headersB));
  const [instrColA,setInstrColA]= useState(() => detectInstrCol(headersA));
  const [instrColB,setInstrColB]= useState(() => detectInstrCol(headersB));
  const [currColA, setCurrColA] = useState(() => detectCurrCol(headersA));
  const [typeColA, setTypeColA] = useState(() => detectTypeCol(headersA));

  const [pnlPairs, setPnlPairs] = useState(() => {
    const detectedA = detectPnlCols(headersA);
    const detectedB = detectPnlCols(headersB);
    const knownPairs = [["pnl - itd","usdproceeds"],["pnl_itd","usdproceeds"],["pnl-itd","usdproceeds"]];
    const pairs = []; const usedB = new Set();
    detectedA.forEach((colA) => {
      const exact = detectedB.find((hb) => !usedB.has(hb) && hb === colA);
      const loose = detectedB.find((hb) => !usedB.has(hb) && hb.toLowerCase() === colA.toLowerCase());
      const known = !exact && !loose ? detectedB.find((hb) => { const la = colA.toLowerCase().trim(), lb = hb.toLowerCase().trim(); return !usedB.has(hb) && knownPairs.some(([ka,kb]) => (la===ka&&lb===kb)||(la===kb&&lb===ka)); }) : null;
      const colB = exact || loose || known || headersB[0] || "";
      usedB.add(colB); pairs.push({ colA, colB });
    });
    return pairs.length > 0 ? pairs : [{ colA: headersA[0] || "", colB: headersB[0] || "" }];
  });

  const addPair    = () => setPnlPairs((p) => [...p, { colA: headersA[0]||"", colB: headersB[0]||"" }]);
  const removePair = (i) => setPnlPairs((p) => p.filter((_,idx) => idx !== i));
  const updatePair = (i, field, val) => setPnlPairs((p) => p.map((x,idx) => idx===i ? {...x,[field]:val} : x));
  const lbl = { fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 8, fontWeight: 500 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 580, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 20 }}>Configure Reconciliation</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div><label style={lbl}>Managed Deal — Databricks</label><select value={idColA} onChange={(e)=>setIdColA(e.target.value)} style={selectStyle}>{headersA.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
          <div><label style={lbl}>Managed Deal — ACFT</label><select value={idColB} onChange={(e)=>setIdColB(e.target.value)} style={selectStyle}>{headersB.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div><label style={lbl}>Instrument Type — Databricks</label><select value={instrColA} onChange={(e)=>setInstrColA(e.target.value)} style={selectStyle}>{headersA.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
          <div><label style={lbl}>Instrument Type — ACFT</label><select value={instrColB} onChange={(e)=>setInstrColB(e.target.value)} style={selectStyle}>{headersB.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
        </div>

        <div style={{ marginBottom: 20, padding: 16, background: C.surfaceAlt, borderRadius: 10, border: `1px solid ${C.border}` }}>
          <label style={{ ...lbl, marginBottom: 12, color: C.amber }}>FX Handling (Databricks)</label>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12 }}>Non-USD deals will exclude rows where the Type column = "CURR" from Databricks before reconciliation.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>Currency Column</label><select value={currColA} onChange={(e)=>setCurrColA(e.target.value)} style={selectStyle}><option value="">— None —</option>{headersA.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
            <div><label style={lbl}>Type Column (to filter "CURR")</label><select value={typeColA} onChange={(e)=>setTypeColA(e.target.value)} style={selectStyle}><option value="">— None —</option>{headersA.map((h)=><option key={h} value={h}>{h}</option>)}</select></div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ ...lbl, marginBottom: 12 }}>PnL Columns to Reconcile</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Databricks</div>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>ACFT</div>
            <div />
          </div>
          {pnlPairs.map((pair, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <select value={pair.colA} onChange={(e)=>updatePair(i,"colA",e.target.value)} style={{ ...selectStyle, padding: "8px 10px" }}>{headersA.map((h)=><option key={h} value={h}>{h}</option>)}</select>
              <select value={pair.colB} onChange={(e)=>updatePair(i,"colB",e.target.value)} style={{ ...selectStyle, padding: "8px 10px" }}>{headersB.map((h)=><option key={h} value={h}>{h}</option>)}</select>
              <button onClick={()=>removePair(i)} disabled={pnlPairs.length<=1} style={{ width:32, height:32, borderRadius:6, background:"transparent", border:`1px solid ${C.border}`, color: pnlPairs.length<=1 ? C.border : C.red, cursor: pnlPairs.length<=1 ? "not-allowed" : "pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
            </div>
          ))}
          <button onClick={addPair} style={{ width:"100%", padding:"8px 0", marginTop:4, background:"transparent", border:`1px dashed ${C.border}`, color:C.accent, borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>+ Add Column Pair</button>
        </div>

        <button onClick={()=>onConfirm({ idColA, idColB, instrColA, instrColB, currColA, typeColA, pnlPairs })} style={{ width:"100%", padding:14, background:C.accent, color:"#fff", border:"none", borderRadius:10, cursor:"pointer", fontSize:14, fontWeight:700, letterSpacing:0.3 }}>Run Reconciliation →</button>
      </div>
    </div>
  );
}

// ─── DrilldownModal ───────────────────────────────────────────────────────────
function DrilldownModal({ deal, onClose, config, dataA, dataB }) {
  if (!deal || !config) return null;
  const { pnlPairs } = config;
  const pnlColsA = pnlPairs.map((p) => p.colA);
  const pnlColsB = pnlPairs.map((p) => p.colB);

  let dealRowsA = (dataA||[]).filter((r) => String(r[config.idColA] != null ? r[config.idColA] : "").trim() === deal.id);
  const dealRowsB = (dataB||[]).filter((r) => String(r[config.idColB] != null ? r[config.idColB] : "").trim() === deal.id);

  if (!deal.isUSD && config.currColA && config.typeColA) {
    dealRowsA = dealRowsA.filter((r) => String(r[config.typeColA] != null ? r[config.typeColA] : "").trim().toUpperCase() !== "CURR");
  }

  const instrMapA = aggregateByKey(dealRowsA, config.instrColA, pnlColsA);
  const instrMapB = aggregateByKey(dealRowsB, config.instrColB, pnlColsB);
  const allInstrIds = [...new Set([...instrMapA.keys(), ...instrMapB.keys()])];

  const instrRows = allInstrIds.map((instrId) => {
    const a = instrMapA.get(instrId) || zeroEntry(pnlColsA);
    const b = instrMapB.get(instrId) || zeroEntry(pnlColsB);
    const missingA = !instrMapA.has(instrId), missingB = !instrMapB.has(instrId);
    const { status: calcStatus } = classifyStatus(a, b, pnlPairs);
    const status = missingA ? "Missing DB" : missingB ? "Missing ACFT" : calcStatus;
    return { instrId, a, b, status, rowsA: a._rowCount||0, rowsB: b._rowCount||0 };
  });

  const statusOrder = { Break:0, Tolerance:1, "Missing DB":2, "Missing ACFT":2, Match:3 };
  instrRows.sort((a,b) => (statusOrder[a.status]??4) - (statusOrder[b.status]??4));

  const thStyle = { textAlign:"right", padding:"10px 12px", fontSize:10, color:C.textDim, textTransform:"uppercase", letterSpacing:0.5, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap", background:C.surface, position:"sticky", top:0 };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:999 }}>
      <div onClick={(e)=>e.stopPropagation()} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:32, width:"92vw", maxWidth:1100, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 25px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div>
            <div style={{ fontSize:11, color:C.textDim, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Deal Drill-Down — Instrument Type Level</div>
            <div style={{ fontSize:22, fontWeight:700, color:C.text, fontFamily:"'JetBrains Mono', monospace" }}>{deal.id}</div>
            <div style={{ fontSize:12, color:C.textDim, marginTop:4 }}>
              {instrRows.length} instrument type{instrRows.length!==1?"s":""} · {dealRowsA.length} rows (DB) &amp; {dealRowsB.length} rows (ACFT)
              {deal.currency && <span style={{ marginLeft:8, color:deal.isUSD?C.green:C.amber, fontWeight:600 }}> · {deal.currency}{!deal.isUSD&&config.typeColA?" (CURR rows excluded from DB)":""}</span>}
            </div>
          </div>
          <Badge status={deal.status} />
        </div>

        <div style={{ background:C.surfaceAlt, borderRadius:10, padding:16, marginBottom:20, border:`1px solid ${C.border}` }}>
          <div style={{ fontSize:11, color:C.textDim, textTransform:"uppercase", letterSpacing:0.6, marginBottom:10, fontWeight:600 }}>Deal-Level Totals</div>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
            {pnlPairs.map((pair, pi) => {
              const a = deal.a?.[pair.colA], b = deal.b?.[pair.colB];
              const numA = parseNum(a), numB = parseNum(b);
              const diff = !isNaN(numA)&&!isNaN(numB) ? numA-numB : null;
              const pctDiff = diff!==null&&numA!==0 ? (diff/numA)*100 : null;
              const absDiff = diff!==null ? Math.abs(diff) : null;
              const absPct = pctDiff!==null ? Math.abs(pctDiff) : null;
              const cc = diff===null ? C.textDim : absDiff<1 ? C.green : absPct!==null&&absPct<1 ? C.amber : C.red;
              return (
                <div key={pi} style={{ flex:1, minWidth:160 }}>
                  <div style={{ fontSize:11, color:C.textDim, marginBottom:4 }}>{pair.colA===pair.colB?pair.colA:`${pair.colA} / ${pair.colB}`}</div>
                  <div style={{ display:"flex", gap:8, alignItems:"baseline", flexWrap:"wrap" }}>
                    <span style={{ fontSize:13, fontFamily:"monospace", color:C.text }}>{fmt(a)}</span>
                    <span style={{ fontSize:11, color:C.textDim }}>vs</span>
                    <span style={{ fontSize:13, fontFamily:"monospace", color:C.text }}>{fmt(b)}</span>
                    <span style={{ fontSize:13, fontFamily:"monospace", fontWeight:700, color:cc }}>{diff!==null?fmt(diff):"—"}</span>
                    <span style={{ fontSize:11, fontFamily:"monospace", color:cc }}>{pctDiff!==null?`(${pctDiff.toFixed(2)}%)`:""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ overflowX:"auto", border:`1px solid ${C.border}`, borderRadius:10 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:600 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign:"left" }}>Instrument Type</th>
                <th style={{ ...thStyle, textAlign:"center" }}>Status</th>
                <th style={thStyle}>Rows DB</th>
                <th style={thStyle}>Rows ACFT</th>
                {pnlPairs.flatMap((p,pi) => [
                  <th key={`h${pi}a`} style={thStyle}>{p.colA} (DB)</th>,
                  <th key={`h${pi}b`} style={thStyle}>{p.colB} (ACFT)</th>,
                  <th key={`h${pi}d`} style={thStyle}>Diff</th>,
                  <th key={`h${pi}p`} style={thStyle}>% Diff</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {instrRows.map((row) => (
                <tr key={row.instrId} style={{ borderBottom:`1px solid ${C.border}` }} onMouseEnter={(e)=>e.currentTarget.style.background=C.surfaceAlt} onMouseLeave={(e)=>e.currentTarget.style.background="transparent"}>
                  <td style={{ padding:"8px 12px", fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:500, whiteSpace:"nowrap", color:C.text }}>{row.instrId}</td>
                  <td style={{ padding:"8px 12px", textAlign:"center" }}><Badge status={row.status} /></td>
                  <td style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.textDim }}>{row.rowsA}</td>
                  <td style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.textDim }}>{row.rowsB}</td>
                  {pnlPairs.map((pair, pi) => {
                    const a = row.a?.[pair.colA], b = row.b?.[pair.colB];
                    const numA = parseNum(a), numB = parseNum(b);
                    const diff = !isNaN(numA)&&!isNaN(numB) ? numA-numB : null;
                    const pctDiff = diff!==null&&numA!==0 ? (diff/numA)*100 : null;
                    const absDiff = diff!==null ? Math.abs(diff) : null;
                    const absPct = pctDiff!==null ? Math.abs(pctDiff) : null;
                    const cc = diff===null ? C.textDim : absDiff<1 ? C.green : absPct!==null&&absPct<1 ? C.amber : C.red;
                    return [
                      <td key={`${pi}a`} style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.text }}>{fmt(a)}</td>,
                      <td key={`${pi}b`} style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.text }}>{fmt(b)}</td>,
                      <td key={`${pi}d`} style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", fontWeight:600, color:cc }}>{diff!==null?fmt(diff):"—"}</td>,
                      <td key={`${pi}p`} style={{ padding:"8px 12px", fontSize:11, textAlign:"right", fontFamily:"monospace", fontWeight:600, color:cc }}>{pctDiff!==null?pctDiff.toFixed(2)+"%":"—"}</td>,
                    ];
                  })}
                </tr>
              ))}
              {instrRows.length===0 && <tr><td colSpan={99} style={{ padding:30, textAlign:"center", color:C.textDim, fontSize:13 }}>No instrument type data found for this deal.</td></tr>}
            </tbody>
          </table>
        </div>

        <button onClick={onClose} style={{ marginTop:20, width:"100%", padding:"12px", background:C.surfaceAlt, color:C.text, border:`1px solid ${C.border}`, borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600 }}>Close</button>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function DealPnLReconciliation() {
  const [fileA, setFileA]         = useState(null);
  const [fileB, setFileB]         = useState(null);
  const [dataA, setDataA]         = useState(null);
  const [dataB, setDataB]         = useState(null);
  const [config, setConfig]       = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [results, setResults]     = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [filter, setFilter]       = useState("All");
  const [search, setSearch]       = useState("");
  const [sortCol, setSortCol]     = useState(null);
  const [sortDir, setSortDir]     = useState("asc");
  const [currScope, setCurrScope] = useState("all");
  const [exportStatus, setExportStatus] = useState(null);

  const MAX_CSV_MB = 50, MAX_XLSX_MB = 15;

  const handleUpload = async (file, system) => {
    const sizeMB = file.size / 1024 / 1024;
    const excel = isExcel(file);
    if (excel && sizeMB > MAX_XLSX_MB) { alert(`Excel file is ${sizeMB.toFixed(0)}MB — exceeds ${MAX_XLSX_MB}MB limit. Save as CSV instead.`); return; }
    if (!excel && sizeMB > MAX_CSV_MB) { alert(`CSV file is ${sizeMB.toFixed(0)}MB — exceeds ${MAX_CSV_MB}MB limit.`); return; }
    try {
      const data = await parseFile(file);
      if (system === "A") { setFileA(file); setDataA(data); }
      else                { setFileB(file); setDataB(data); }
      setResults(null); setConfig(null); setExportStatus(null);
    } catch (err) {
      alert("Failed to parse file: " + (err.message || "Unknown error"));
    }
  };

  const runReconciliation = ({ idColA, idColB, instrColA, instrColB, currColA, typeColA, pnlPairs }) => {
    setShowConfig(false);
    setConfig({ idColA, idColB, instrColA, instrColB, currColA, typeColA, pnlPairs });

    const pnlColsA = pnlPairs.map((p) => p.colA);
    const pnlColsB = pnlPairs.map((p) => p.colB);
    const hasFxLogic = !!(currColA && typeColA);

    const dealGroupsA = new Map();
    dataA.forEach((row) => { const id = String(row[idColA]??'').trim(); if (!id) return; if (!dealGroupsA.has(id)) dealGroupsA.set(id,[]); dealGroupsA.get(id).push(row); });

    const dealCurrency = new Map();
    dealGroupsA.forEach((rows, id) => {
      const currencies = [...new Set(rows.map((r) => String(r[currColA]??'').trim().toUpperCase()).filter(Boolean))];
      const isUSD = !hasFxLogic || currencies.length===0 || (currencies.length===1&&currencies[0]==="USD");
      dealCurrency.set(id, { isUSD, currencies });
    });

    const filteredDataA = hasFxLogic
      ? dataA.filter((row) => { const id=String(row[idColA]??'').trim(); const info=dealCurrency.get(id); if (!info||info.isUSD) return true; return String(row[typeColA]??'').trim().toUpperCase() !== "CURR"; })
      : dataA;

    const mapA = aggregateByKey(filteredDataA, idColA, pnlColsA);
    const mapB = aggregateByKey(dataB, idColB, pnlColsB);
    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);
    const rows = [];

    allIds.forEach((id) => {
      const a = mapA.get(id) || zeroEntry(pnlColsA);
      const b = mapB.get(id) || zeroEntry(pnlColsB);
      const missingA = !mapA.has(id), missingB = !mapB.has(id);
      const { status: calcStatus, totalDiff } = classifyStatus(a, b, pnlPairs);
      const status = missingA ? "Missing DB" : missingB ? "Missing ACFT" : calcStatus;
      const currInfo = dealCurrency.get(id);
      const isUSD = currInfo ? currInfo.isUSD : true;
      rows.push({ id, a, b, status, totalDiff, rowsA:a._rowCount||0, rowsB:b._rowCount||0, isUSD,
        currency: currInfo ? (currInfo.isUSD ? "USD" : currInfo.currencies.filter((c)=>c!=="USD").join(", ")||currInfo.currencies.join(", ")) : "—"
      });
    });

    setResults(rows); setFilter("All"); setSearch(""); setCurrScope("all");
  };

  const filtered = useMemo(() => {
    if (!results) return [];
    let r = results;
    if (currScope==="usd") r = r.filter((d)=>d.isUSD);
    else if (currScope==="nonUsd") r = r.filter((d)=>!d.isUSD);
    if (filter!=="All") {
      if (filter==="Missing") r = r.filter((d)=>d.status==="Missing DB"||d.status==="Missing ACFT");
      else r = r.filter((d)=>d.status===filter);
    }
    if (search) r = r.filter((d)=>d.id.toLowerCase().includes(search.toLowerCase()));
    if (sortCol) {
      r = [...r].sort((a,b) => {
        let va, vb;
        if (sortCol==="id") { va=a.id; vb=b.id; }
        else if (sortCol==="status") { va=a.status; vb=b.status; }
        else if (sortCol==="currency") { va=a.currency; vb=b.currency; }
        else if (sortCol==="totalDiff") { va=a.totalDiff??0; vb=b.totalDiff??0; }
        else { va=parseNum(a.a?.[sortCol]??0); vb=parseNum(b.a?.[sortCol]??0); }
        if (typeof va==="string") return sortDir==="asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        return sortDir==="asc" ? va-vb : vb-va;
      });
    }
    return r;
  }, [results, filter, search, sortCol, sortDir, currScope]);

  const stats = useMemo(() => {
    if (!results) return null;
    const calc = (arr) => {
      const total=arr.length, matches=arr.filter((r)=>r.status==="Match").length, breaks=arr.filter((r)=>r.status==="Break").length;
      const tolerance=arr.filter((r)=>r.status==="Tolerance").length, missing=arr.filter((r)=>r.status==="Missing DB"||r.status==="Missing ACFT").length;
      const totalBreakAmt=arr.reduce((s,r)=>s+(r.status==="Break"?Math.abs(r.totalDiff||0):0),0);
      return { total, matches, breaks, tolerance, missing, totalBreakAmt, matchRate: total ? ((matches/total)*100).toFixed(1) : 0 };
    };
    return { all:calc(results), usd:calc(results.filter((r)=>r.isUSD)), nonUsd:calc(results.filter((r)=>!r.isUSD)) };
  }, [results]);

  const exportToClipboard = useCallback(() => {
    if (!filtered||!config) return;
    const headers = ["Managed Deal","Status","Currency","USD/Non-USD",...config.pnlPairs.flatMap((p)=>[`${p.colA} (DB)`,`${p.colB} (ACFT)`,"Diff","% Diff"])];
    const csvRows = [headers.join("\t")];
    filtered.forEach((r) => {
      const vals = [r.id, r.status, r.currency, r.isUSD?"USD":"Non-USD"];
      config.pnlPairs.forEach((pair) => {
        const a=r.a?.[pair.colA]??"", b=r.b?.[pair.colB]??"";
        const numA=parseNum(a), numB=parseNum(b);
        const diff=!isNaN(numA)&&!isNaN(numB)?numA-numB:"";
        const pctDiff=diff!==""&&numA!==0?((diff/numA)*100).toFixed(2)+"%":"";
        vals.push(a,b,diff,pctDiff);
      });
      csvRows.push(vals.join("\t"));
    });
    const text = csvRows.join("\n");
    navigator.clipboard.writeText(text).catch(()=>{
      const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    });
    setExportStatus("copied"); setTimeout(()=>setExportStatus(null),3000);
  }, [filtered, config]);

  const handleSort = (col) => { if (sortCol===col) setSortDir((d)=>d==="asc"?"desc":"asc"); else { setSortCol(col); setSortDir("asc"); } };

  const s = stats?.[currScope];

  return (
    <div style={{ height:"100vh", overflow:"hidden", display:"flex", flexDirection:"column", background:C.bg, color:C.text, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes fadeIn { from{opacity:0}to{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
      `}</style>

      {/* Header */}
      <div style={{ padding:"20px 28px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background: results?(stats?.all?.breaks>0?C.red:C.green):C.amber }} />
            <h1 style={{ fontSize:19, fontWeight:700, letterSpacing:-0.3 }}>Deal PnL Reconciliation</h1>
          </div>
          <p style={{ fontSize:12, color:C.textDim, marginTop:3, marginLeft:18 }}>
            {results ? `${stats.all.total} deals · ${stats.all.matchRate}% match rate` : "Upload Databricks and ACFT exports — line items are summed by Managed Deal"}
          </p>
        </div>
        {results && (
          <button onClick={exportToClipboard} style={{ padding:"9px 18px", background:exportStatus==="copied"?C.green:C.surfaceAlt, color:exportStatus==="copied"?"#fff":C.text, border:`1px solid ${exportStatus==="copied"?C.green:C.border}`, borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:8, transition:"all 0.2s" }}>
            {exportStatus==="copied" ? `✓ Copied ${filtered.length} rows` : `⎘ Copy ${filter==="All"?"All":filter} (${filtered.length})`}
          </button>
        )}
      </div>

      <div style={{ flex:1, overflow:results?"hidden":"auto", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:results?"16px 28px 0":"24px 28px", maxWidth:1400, margin:"0 auto", width:"100%", flexShrink:0 }}>

          {/* Upload */}
          {!results && (
            <div style={{ animation:"slideUp 0.3s ease" }}>
              <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:20 }}>
                <UploadZone systemLabel="Databricks" file={fileA} onUpload={(f)=>handleUpload(f,"A")} />
                <UploadZone systemLabel="ACFT" file={fileB} onUpload={(f)=>handleUpload(f,"B")} />
              </div>
              {dataA&&dataB&&(
                <button onClick={()=>setShowConfig(true)} style={{ width:"100%", padding:14, background:`linear-gradient(135deg,${C.accent},#2563EB)`, color:"#fff", border:"none", borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:700, letterSpacing:0.3, boxShadow:"0 4px 20px rgba(59,130,246,0.3)" }}>
                  Configure &amp; Reconcile →
                </button>
              )}
              {dataA&&!dataB&&<div style={{ textAlign:"center", color:C.textDim, padding:16, fontSize:13 }}>Upload ACFT to continue…</div>}
            </div>
          )}

          {showConfig&&dataA&&dataB&&(
            <ConfigModal headersA={Object.keys(dataA[0]||{})} headersB={Object.keys(dataB[0]||{})} onConfirm={runReconciliation} onClose={()=>setShowConfig(false)} />
          )}

          {results&&stats&&s&&(
            <>
              {/* Scope Tabs */}
              <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                {[{key:"all",label:`All Deals (${stats.all.total})`},{key:"usd",label:`USD (${stats.usd.total})`},{key:"nonUsd",label:`Non-USD (${stats.nonUsd.total})`}].map((t)=>(
                  <button key={t.key} onClick={()=>setCurrScope(t.key)} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:700, border:currScope===t.key?`2px solid ${C.accent}`:`1px solid ${C.border}`, background:currScope===t.key?"rgba(59,130,246,0.12)":C.surface, color:currScope===t.key?C.accent:C.textDim, cursor:"pointer" }}>{t.label}</button>
                ))}
              </div>

              {/* Stats */}
              <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:14 }}>
                <StatCard icon="◎" label="Total" value={s.total} onClick={()=>setFilter("All")} active={filter==="All"} />
                <StatCard icon="✓" label="Matched" value={s.matches} color={C.green} onClick={()=>setFilter("Match")} active={filter==="Match"} />
                <StatCard icon="⚠" label="Tolerance" value={s.tolerance} color={C.amber} onClick={()=>setFilter("Tolerance")} active={filter==="Tolerance"} />
                <StatCard icon="✗" label="Breaks" value={s.breaks} color={C.red} onClick={()=>setFilter("Break")} active={filter==="Break"} />
                <StatCard icon="?" label="Missing" value={s.missing} color={C.textDim} onClick={()=>setFilter("Missing")} active={filter==="Missing"} />
                <StatCard icon="$" label="Break Amt" value={fmt(s.totalBreakAmt)} color={C.red} onClick={()=>setFilter("Break")} active={false} />
              </div>

              {/* Bar */}
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 16px", marginBottom:14 }}>
                <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", gap:2 }}>
                  {s.matches>0&&<div style={{ flex:s.matches, background:C.green, borderRadius:4 }} />}
                  {s.tolerance>0&&<div style={{ flex:s.tolerance, background:C.amber, borderRadius:4 }} />}
                  {s.breaks>0&&<div style={{ flex:s.breaks, background:C.red, borderRadius:4 }} />}
                  {s.missing>0&&<div style={{ flex:s.missing, background:C.textDim, borderRadius:4 }} />}
                </div>
              </div>

              {/* Filters */}
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:14 }}>
                {["All","Match","Tolerance","Break","Missing","Missing DB","Missing ACFT"].map((f)=>(
                  <button key={f} onClick={()=>setFilter(f)} style={{ padding:"6px 14px", borderRadius:8, fontSize:11, fontWeight:600, border:`1px solid ${filter===f?C.accent:C.border}`, background:filter===f?"rgba(59,130,246,0.12)":"transparent", color:filter===f?C.accent:C.textDim, cursor:"pointer", letterSpacing:0.3 }}>{f}</button>
                ))}
                <div style={{ flex:1 }} />
                <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search deal…" style={{ padding:"7px 12px", background:C.surface, color:C.text, border:`1px solid ${C.border}`, borderRadius:8, fontSize:12, outline:"none", width:180, fontFamily:"monospace" }} />
                <button onClick={()=>{setResults(null);setConfig(null);setExportStatus(null);}} style={{ padding:"7px 12px", background:C.surfaceAlt, color:C.textDim, border:`1px solid ${C.border}`, borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600 }}>← New Recon</button>
              </div>
            </>
          )}
        </div>

        {/* Table */}
        {results&&stats&&(
          <div style={{ flex:1, overflow:"auto", padding:"0 28px 20px", maxWidth:1400, margin:"0 auto", width:"100%" }}>
            <div style={{ border:`1px solid ${C.border}`, borderRadius:12, background:C.surface, overflow:"hidden" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
                  <thead>
                    <tr>
                      {[
                        {key:"id",label:"Managed Deal",align:"left"},
                        {key:"status",label:"Status",align:"center"},
                        {key:"currency",label:"Currency",align:"center"},
                        ...(config?.pnlPairs||[]).flatMap((p,i)=>[
                          {key:`pnl_${i}_a`,label:`${p.colA} (DB)`,align:"right"},
                          {key:`pnl_${i}_b`,label:`${p.colB} (ACFT)`,align:"right"},
                          {key:`pnl_${i}_d`,label:"Diff",align:"center"},
                          {key:`pnl_${i}_pct`,label:"% Diff",align:"center"},
                        ]),
                      ].map((h)=>(
                        <th key={h.key} onClick={()=>["id","status","currency"].includes(h.key)&&handleSort(h.key)} style={{ padding:"11px 14px", textAlign:h.align, fontSize:10, color:sortCol===h.key?C.accent:C.textDim, textTransform:"uppercase", letterSpacing:0.6, fontWeight:600, borderBottom:`1px solid ${C.border}`, cursor:["id","status","currency"].includes(h.key)?"pointer":"default", whiteSpace:"nowrap", position:"sticky", top:0, background:C.surface, userSelect:"none" }}>
                          {h.label}{sortCol===h.key?(sortDir==="asc"?" ↑":" ↓"):""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0,200).map((row,i)=>(
                      <tr key={row.id+i} onClick={()=>setSelectedDeal(row)} style={{ cursor:"pointer", borderBottom:`1px solid ${C.border}`, transition:"background 0.1s" }} onMouseEnter={(e)=>e.currentTarget.style.background=C.surfaceAlt} onMouseLeave={(e)=>e.currentTarget.style.background="transparent"}>
                        <td style={{ padding:"9px 14px", fontSize:12, fontFamily:"'JetBrains Mono',monospace", fontWeight:500, whiteSpace:"nowrap" }}>{row.id}</td>
                        <td style={{ padding:"9px 14px", textAlign:"center" }}><Badge status={row.status} /></td>
                        <td style={{ padding:"9px 14px", fontSize:11, textAlign:"center", fontFamily:"monospace", color:row.isUSD?C.green:C.amber, fontWeight:500 }}>{row.currency}</td>
                        {(config?.pnlPairs||[]).map((pair,pi)=>{
                          const a=row.a?.[pair.colA], b=row.b?.[pair.colB];
                          const numA=parseNum(a), numB=parseNum(b);
                          const diff=!isNaN(numA)&&!isNaN(numB)?numA-numB:null;
                          const pctDiff=diff!==null&&numA!==0?(diff/numA)*100:null;
                          const absDiff=diff!==null?Math.abs(diff):null;
                          const absPct=pctDiff!==null?Math.abs(pctDiff):null;
                          const cc=diff===null?C.textDim:absDiff<1?C.green:absPct!==null&&absPct<1?C.amber:C.red;
                          return [
                            <td key={`${pi}a`} style={{ padding:"9px 14px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.text }}>{fmt(a)}</td>,
                            <td key={`${pi}b`} style={{ padding:"9px 14px", fontSize:11, textAlign:"right", fontFamily:"monospace", color:C.text }}>{fmt(b)}</td>,
                            <td key={`${pi}d`} style={{ padding:"9px 14px", fontSize:11, textAlign:"center", fontFamily:"monospace", fontWeight:600, color:cc }}>{diff!==null?fmt(diff):"—"}</td>,
                            <td key={`${pi}p`} style={{ padding:"9px 14px", fontSize:11, textAlign:"center", fontFamily:"monospace", fontWeight:600, color:cc }}>{pctDiff!==null?pctDiff.toFixed(2)+"%":"—"}</td>,
                          ];
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length===0&&<div style={{ padding:40, textAlign:"center", color:C.textDim, fontSize:13 }}>No deals match the current filter.</div>}
                {filtered.length>200&&<div style={{ padding:12, textAlign:"center", color:C.textDim, fontSize:11, borderTop:`1px solid ${C.border}` }}>Showing 200 of {filtered.length} deals · Export for full results</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedDeal&&config&&<DrilldownModal deal={selectedDeal} onClose={()=>setSelectedDeal(null)} config={config} dataA={dataA} dataB={dataB} />}
    </div>
  );
}
