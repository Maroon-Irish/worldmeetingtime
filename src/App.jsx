import { useState, useMemo, useCallback } from "react";
// v2 — day-view bars, no external map dependencies

const ALL_ZONES = [
  // === Priority: US zones + India ===
  { label: "Los Angeles — US Pacific", tz: "America/Los_Angeles", city: "Los Angeles", lon: -118.2 },
  { label: "Denver — US Mountain", tz: "America/Denver", city: "Denver", lon: -105.0 },
  { label: "Chicago — US Central", tz: "America/Chicago", city: "Chicago", lon: -87.6 },
  { label: "New York — US Eastern", tz: "America/New_York", city: "New York", lon: -74.0 },
  { label: "Mumbai — India (IST)", tz: "Asia/Kolkata", city: "Mumbai", lon: 72.8 },

  // === Geographic, from GMT eastward ===
  { label: "London — UK (GMT/BST)", tz: "Europe/London", city: "London", lon: -0.1 },
  { label: "Paris — Central Europe (CET/CEST)", tz: "Europe/Paris", city: "Paris", lon: 2.4 },
  { label: "Cairo — Egypt (EET)", tz: "Africa/Cairo", city: "Cairo", lon: 31.2 },
  { label: "Johannesburg — South Africa (SAST)", tz: "Africa/Johannesburg", city: "Johannesburg", lon: 28.0 },
  { label: "Istanbul — Turkey (TRT)", tz: "Europe/Istanbul", city: "Istanbul", lon: 29.0 },
  { label: "Moscow — Russia (MSK)", tz: "Europe/Moscow", city: "Moscow", lon: 37.6 },
  { label: "Dubai — UAE (GST)", tz: "Asia/Dubai", city: "Dubai", lon: 55.3 },
  { label: "Bangkok — Thailand (ICT)", tz: "Asia/Bangkok", city: "Bangkok", lon: 100.5 },
  { label: "Singapore (SGT)", tz: "Asia/Singapore", city: "Singapore", lon: 103.8 },
  { label: "Hong Kong (HKT)", tz: "Asia/Hong_Kong", city: "Hong Kong", lon: 114.2 },
  { label: "Tokyo — Japan (JST)", tz: "Asia/Tokyo", city: "Tokyo", lon: 139.7 },
  { label: "Sydney — Australia (AEST/AEDT)", tz: "Australia/Sydney", city: "Sydney", lon: 151.2 },
  { label: "Auckland — New Zealand (NZST/NZDT)", tz: "Pacific/Auckland", city: "Auckland", lon: 174.8 },

  // === Americas (other than priority US) ===
  { label: "Mexico City — Mexico (CST)", tz: "America/Mexico_City", city: "Mexico City", lon: -99.1 },
  { label: "São Paulo — Brazil (BRT)", tz: "America/Sao_Paulo", city: "São Paulo", lon: -46.6 },
];

const DEFAULT_ZONES = ["America/Chicago", "Asia/Kolkata", "Europe/Paris"];

// ---------- Timezone math ----------
function getUTCOffsetMinutes(tz, utcMs) {
  const ref = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(ref);
  const get = (t) => parseInt(parts.find(p => p.type === t)?.value ?? "0");
  const localAsUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (localAsUTC - utcMs) / 60000;
}

function localToUTC(dateStr, hour, minute, tz) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const offset = getUTCOffsetMinutes(tz, guess);
  return new Date(Date.UTC(y, mo - 1, d, hour, minute, 0) - offset * 60000);
}

function getTZParts(date, tz) {
  const fmt = (opts) => new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(date);
  const hour = parseInt(fmt({ hour: "numeric", hour12: false })) % 24;
  const minute = parseInt(fmt({ minute: "2-digit" }));
  const day = parseInt(fmt({ day: "numeric" }));
  const month = parseInt(fmt({ month: "numeric" }));
  const abbr = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(date).find(p => p.type === "timeZoneName")?.value ?? tz;
  const weekday = fmt({ weekday: "short" });
  const dateStr = fmt({ month: "short", day: "numeric" });
  return { hour, minute, day, month, abbr, weekday, dateStr };
}

const getMinutes = (date, tz) => {
  const { hour, minute } = getTZParts(date, tz);
  return hour * 60 + minute;
};

// Default thresholds in minutes since midnight.
// workStart/workEnd = green zone (work hours)
// earlyStart .. workStart  + workEnd .. lateEnd = yellow (early/late)
// difficultStart .. earlyStart + lateEnd .. difficultEnd = red (difficult)
// before difficultStart or after difficultEnd = dark red (avoid)
const DEFAULT_HOURS = {
  difficultStart: 6 * 60,    // 6:00 AM
  earlyStart:     7 * 60 + 30, // 7:30 AM
  workStart:      9 * 60,    // 9:00 AM
  workEnd:        17 * 60,   // 5:00 PM
  lateEnd:        20 * 60,   // 8:00 PM
  difficultEnd:   22 * 60,   // 10:00 PM
};

function getCategory(startMin, durationMin, h) {
  let worst = 1;
  for (let m = startMin; m < startMin + durationMin; m += 15) {
    const t = m % 1440;
    let cat;
    if (t < h.difficultStart || t >= h.difficultEnd) cat = 4;
    else if (t < h.earlyStart || t >= h.lateEnd) cat = 3;
    else if (t < h.workStart || t >= h.workEnd) cat = 2;
    else cat = 1;
    if (cat > worst) worst = cat;
  }
  return worst;
}

// Format a minute-of-day as a readable time range string
function fmtMin(min, use24) {
  const h = Math.floor(min / 60), m = min % 60;
  const date = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: m === 0 ? undefined : "2-digit",
    hour12: !use24, timeZone: "UTC",
  }).format(date);
}

function makeRangeLabels(h, use24) {
  return {
    1: `${fmtMin(h.workStart, use24)} – ${fmtMin(h.workEnd, use24)}`,
    2: `${fmtMin(h.earlyStart, use24)}–${fmtMin(h.workStart, use24)} · ${fmtMin(h.workEnd, use24)}–${fmtMin(h.lateEnd, use24)}`,
    3: `${fmtMin(h.difficultStart, use24)}–${fmtMin(h.earlyStart, use24)} · ${fmtMin(h.lateEnd, use24)}–${fmtMin(h.difficultEnd, use24)}`,
    4: `Before ${fmtMin(h.difficultStart, use24)} / after ${fmtMin(h.difficultEnd, use24)}`,
  };
}

const CAT = {
  1: { bg: "#10b981", soft: "#d1fae5", dark: "#065f46", label: "Work hours" },
  2: { bg: "#f59e0b", soft: "#fef3c7", dark: "#92400e", label: "Early/late" },
  3: { bg: "#ef4444", soft: "#fee2e2", dark: "#991b1b", label: "Difficult" },
  4: { bg: "#7f1d1d", soft: "#fecaca", dark: "#450a0a", label: "Avoid" },
};

const formatTime = (date, tz, use24) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: !use24, timeZone: tz }).format(date);

const scoreWindow = (date, dur, zones, hours) => {
  const cats = zones.map(z => getCategory(getMinutes(date, z.tz), dur, hours));
  return Math.max(...cats) * 100 + cats.reduce((a, b) => a + b, 0);
};

const qualityLabel = (score) => {
  const base = Math.floor(score / 100);
  if (base <= 1) return { label: "Best", color: CAT[1].bg, soft: CAT[1].soft };
  if (base === 2) return { label: "Good", color: CAT[2].bg, soft: CAT[2].soft };
  if (base === 3) return { label: "Poor", color: CAT[3].bg, soft: CAT[3].soft };
  return { label: "Avoid", color: CAT[4].bg, soft: CAT[4].soft };
};

// ---------- 24-hour timezone strip ----------
// Each timezone displays as a horizontal bar with 24 hour segments,
// color-coded by work-hours category. The "now" position is highlighted.

function TimezoneStrip({ zone, displaySlot, duration, use24, isOrganizer, dateStr, onPickTime, hours }) {
  if (!displaySlot) return null;

  // Build 24 hour segments showing category for each hour of the local day
  const segments = Array.from({ length: 24 }, (_, h) => {
    const startMin = h * 60;
    return getCategory(startMin, 60, hours); // base category for that hour
  });

  // Current local time for the selected meeting
  const parts = getTZParts(displaySlot, zone.tz);
  const localHour = parts.hour + parts.minute / 60;
  const indicatorPct = (localHour / 24) * 100;

  // Meeting duration extends from local time
  const durHours = duration / 60;
  const durPct = (durHours / 24) * 100;
  const meetingCat = getCategory(parts.hour * 60 + parts.minute, duration, hours);

  // Handle click on strip → set meeting to clicked local hour in this zone
  const handleStripClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const totalMin = Math.round((pct * 24 * 60) / 30) * 30; // snap to 30 min
    const h = Math.max(0, Math.min(23, Math.floor(totalMin / 60)));
    const m = totalMin % 60 === 30 ? 30 : 0;
    const utc = localToUTC(dateStr, h, m, zone.tz);
    if (!isNaN(utc.getTime())) onPickTime(utc);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
      {/* City label */}
      <div style={{ minWidth: 110, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: 6 }}>
          {zone.city}
          {isOrganizer && (
            <span style={{
              fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
              background: "#0f172a", color: "#fff", letterSpacing: "0.04em",
            }}>HOST</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{parts.abbr}</div>
      </div>

      {/* 24-hour strip — clickable */}
      <div style={{ flex: 1, position: "relative" }}>
        <div
          onClick={handleStripClick}
          title={`Click to set meeting time in ${zone.city}`}
          style={{
            display: "flex", height: 28, borderRadius: 6, overflow: "hidden",
            border: "1px solid #e2e8f0", cursor: "pointer",
          }}>
          {segments.map((cat, h) => (
            <div key={h} style={{
              flex: 1, background: CAT[cat].soft,
              borderRight: h < 23 ? "1px solid rgba(0,0,0,0.04)" : "none",
            }} />
          ))}
        </div>

        {/* Meeting duration indicator */}
        <div style={{
          position: "absolute", top: 0, height: 28,
          left: `${indicatorPct}%`, width: `${durPct}%`,
          background: CAT[meetingCat].bg, opacity: 0.85,
          borderRadius: 4, border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(15,23,42,0.3)",
          minWidth: 4, pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#fff",
            whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,0.3)",
          }}>
            {formatTime(displaySlot, zone.tz, use24)}
          </span>
        </div>

        {/* Hour ticks */}
        <div style={{ display: "flex", marginTop: 3, fontSize: 9, color: "#94a3b8" }}>
          {[0, 6, 12, 18, 24].map(h => (
            <div key={h} style={{
              position: "absolute", left: `${(h / 24) * 100}%`, transform: "translateX(-50%)",
            }}>{h === 24 ? "24" : String(h).padStart(2, "0")}</div>
          ))}
        </div>
      </div>

      {/* Status badge */}
      <div style={{ minWidth: 90, textAlign: "right", flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 999,
          background: CAT[meetingCat].bg, color: "#fff", letterSpacing: "0.02em",
        }}>{CAT[meetingCat].label.toUpperCase()}</span>
      </div>
    </div>
  );
}

// ---------- Styles ----------
const labelStyle = {
  fontSize: 11, fontWeight: 500, color: "#64748b", textTransform: "uppercase",
  letterSpacing: "0.04em", display: "block", marginBottom: 6,
};
const inputStyle = {
  width: "100%", fontSize: 13, padding: "8px 10px",
  border: "1px solid #e2e8f0", borderRadius: 8,
  background: "#fff", color: "#0f172a", outline: "none", fontFamily: "inherit",
};
const cardStyle = {
  background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 12, padding: 16,
};

export default function App() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateStr, setDateStr] = useState(todayStr);
  const [duration, setDuration] = useState(60);
  const [use24, setUse24] = useState(false);
  const [orgTZ, setOrgTZ] = useState("America/Chicago");
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(20);
  const [activeZones, setActiveZones] = useState(DEFAULT_ZONES);
  const [addZone, setAddZone] = useState("");
  const [selectedTime, setSelectedTime] = useState(null);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [showSettings, setShowSettings] = useState(false);

  const rangeLabels = useMemo(() => makeRangeLabels(hours, use24), [hours, use24]);

  // Ensure organizer's timezone is always in the active list
  const allActiveZones = useMemo(() => {
    return activeZones.includes(orgTZ) ? activeZones : [orgTZ, ...activeZones];
  }, [activeZones, orgTZ]);

  const zones = useMemo(() =>
    ALL_ZONES.filter(z => allActiveZones.includes(z.tz))
      .sort((a, b) => a.lon - b.lon),
  [allActiveZones]);

  const slots = useMemo(() => {
    const result = [];
    try {
      for (let h = startHour; h <= endHour; h++) {
        for (let m = 0; m < 60; m += 30) {
          const utc = localToUTC(dateStr, h, m, orgTZ);
          if (!isNaN(utc.getTime())) result.push(utc);
        }
      }
    } catch (e) { console.error(e); }
    return result;
  }, [dateStr, startHour, endHour, orgTZ]);

  const bestWindows = useMemo(() => {
    if (!slots.length || !zones.length) return [];
    return [...slots]
      .map(s => ({ date: s, score: scoreWindow(s, duration, zones, hours) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [slots, duration, zones, hours]);

  const removeZone = useCallback((tz) => {
    if (tz === orgTZ) return; // can't remove organizer
    setActiveZones(z => z.filter(t => t !== tz));
  }, [orgTZ]);

  const addZoneFn = useCallback(() => {
    if (addZone && !activeZones.includes(addZone)) {
      setActiveZones(z => [...z, addZone]);
      setAddZone("");
    }
  }, [addZone, activeZones]);

  const displaySlot = selectedTime || bestWindows[0]?.date;
  const orgPartsHeader = slots[0] ? getTZParts(slots[0], orgTZ) : null;

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      background: "#f8fafc", padding: "24px 20px", minHeight: "100vh", color: "#0f172a",
    }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
            Global meeting time finder
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
            Find the best times across time zones, with automatic daylight saving handling.
          </p>
        </div>

        {/* Controls */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Duration</label>
              <select value={duration} onChange={e => setDuration(+e.target.value)} style={inputStyle}>
                {[15, 30, 45, 60, 90, 120].map(d => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Organizer timezone</label>
              <select value={orgTZ} onChange={e => setOrgTZ(e.target.value)} style={inputStyle}>
                {ALL_ZONES.map(z => <option key={z.tz} value={z.tz}>{z.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>From</label>
              <select value={startHour} onChange={e => setStartHour(+e.target.value)} style={inputStyle}>
                {Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>To</label>
              <select value={endHour} onChange={e => setEndHour(+e.target.value)} style={inputStyle}>
                {Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Format</label>
              <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 8, padding: 2, height: 36, background: "#fff" }}>
                <button onClick={() => setUse24(false)} style={{
                  flex: 1, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                  borderRadius: 6, background: !use24 ? "#0f172a" : "transparent",
                  color: !use24 ? "#fff" : "#64748b", fontFamily: "inherit",
                }}>12h</button>
                <button onClick={() => setUse24(true)} style={{
                  flex: 1, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                  borderRadius: 6, background: use24 ? "#0f172a" : "transparent",
                  color: use24 ? "#fff" : "#64748b", fontFamily: "inherit",
                }}>24h</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
            <label style={labelStyle}>Time zones</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {zones.map(z => (
                <span key={z.tz} style={{
                  fontSize: 12, fontWeight: 500, padding: "5px 6px 5px 12px", borderRadius: 999,
                  background: z.tz === orgTZ ? "#0f172a" : "#f1f5f9",
                  color: z.tz === orgTZ ? "#fff" : "#0f172a",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  {z.city}
                  {z.tz !== orgTZ && (
                    <button onClick={() => removeZone(z.tz)} style={{
                      border: "none", background: "#cbd5e1", cursor: "pointer", padding: 0,
                      fontSize: 11, color: "#475569", lineHeight: 1, width: 16, height: 16,
                      borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>×</button>
                  )}
                </span>
              ))}
              <select
                value=""
                onChange={e => {
                  const tz = e.target.value;
                  if (tz && !allActiveZones.includes(tz)) {
                    setActiveZones(z => [...z, tz]);
                  }
                }}
                style={{ ...inputStyle, fontSize: 12, padding: "5px 8px", width: "auto" }}>
                <option value="">+ Add timezone</option>
                {ALL_ZONES.filter(z => !allActiveZones.includes(z.tz)).map(z =>
                  <option key={z.tz} value={z.tz}>{z.label}</option>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Timezone strips visualization */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Day view</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {displaySlot
                  ? `Meeting at ${formatTime(displaySlot, orgTZ, use24)} ${getTZParts(displaySlot, orgTZ).abbr} · click any bar to reschedule`
                  : "Select a meeting time"}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 4 }}>
            {zones.map(z => (
              <TimezoneStrip key={z.tz} zone={z} displaySlot={displaySlot}
                duration={duration} use24={use24} isOrganizer={z.tz === orgTZ}
                dateStr={dateStr} onPickTime={setSelectedTime} hours={hours} />
            ))}
          </div>
        </div>

        {/* Best windows */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Best meeting windows</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Top 5 for this date</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {bestWindows.map((w, i) => {
              const q = qualityLabel(w.score);
              const orgParts = getTZParts(w.date, orgTZ);
              const isSelected = selectedTime?.getTime() === w.date.getTime();
              return (
                <button key={i} onClick={() => setSelectedTime(isSelected ? null : w.date)}
                  style={{
                    border: `1px solid ${isSelected ? q.color : "#e2e8f0"}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                    background: isSelected ? q.soft : "#fff",
                    textAlign: "left", fontFamily: "inherit",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>#{i + 1}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                      background: q.color, color: "#fff", letterSpacing: "0.02em",
                    }}>{q.label.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em" }}>
                    {formatTime(w.date, orgTZ, use24)}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {orgParts.abbr} · {orgParts.dateStr}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center",
          marginBottom: 12, padding: "10px 14px",
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
        }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Legend</span>
          {Object.entries(CAT).map(([k, v]) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: v.bg, display: "inline-block" }} />
              <span style={{ color: "#0f172a", fontWeight: 500 }}>{v.label}</span>
              <span style={{ color: "#94a3b8", fontSize: 11 }}>· {rangeLabels[k]}</span>
            </span>
          ))}
          <button onClick={() => setShowSettings(s => !s)} style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 500, padding: "4px 10px",
            border: "1px solid #e2e8f0", borderRadius: 6, background: showSettings ? "#0f172a" : "#fff",
            color: showSettings ? "#fff" : "#0f172a", cursor: "pointer", fontFamily: "inherit",
          }}>
            {showSettings ? "Done" : "Customize hours"}
          </button>
        </div>

        {/* Customizable work-hours settings */}
        {showSettings && (
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Customize work hours</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Adjust the thresholds that define each category for your team
                </div>
              </div>
              <button onClick={() => setHours(DEFAULT_HOURS)} style={{
                fontSize: 11, fontWeight: 500, padding: "4px 10px",
                border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff",
                color: "#0f172a", cursor: "pointer", fontFamily: "inherit",
              }}>Reset to defaults</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
              {[
                { key: "difficultStart", label: "Earliest tolerable", desc: "Before this = avoid", color: CAT[4].bg },
                { key: "earlyStart", label: "Early shift starts", desc: "Difficult ends here", color: CAT[3].bg },
                { key: "workStart", label: "Work hours start", desc: "Green zone begins", color: CAT[1].bg },
                { key: "workEnd", label: "Work hours end", desc: "Green zone ends", color: CAT[1].bg },
                { key: "lateEnd", label: "Late shift ends", desc: "Difficult starts here", color: CAT[3].bg },
                { key: "difficultEnd", label: "Latest tolerable", desc: "After this = avoid", color: CAT[4].bg },
              ].map(({ key, label, desc, color }) => {
                const val = hours[key];
                const h = Math.floor(val / 60), m = val % 60;
                const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                return (
                  <div key={key}>
                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
                      {label}
                    </label>
                    <input
                      type="time"
                      value={timeStr}
                      onChange={e => {
                        const [hh, mm] = e.target.value.split(":").map(Number);
                        if (isNaN(hh) || isNaN(mm)) return;
                        const newVal = hh * 60 + mm;
                        // Enforce ordering: each threshold must respect its neighbors
                        const order = ["difficultStart", "earlyStart", "workStart", "workEnd", "lateEnd", "difficultEnd"];
                        const idx = order.indexOf(key);
                        const newHours = { ...hours, [key]: newVal };
                        // Push later thresholds forward if needed
                        for (let i = idx + 1; i < order.length; i++) {
                          if (newHours[order[i]] <= newHours[order[i - 1]]) {
                            newHours[order[i]] = newHours[order[i - 1]] + 15;
                          }
                        }
                        // Push earlier thresholds back if needed
                        for (let i = idx - 1; i >= 0; i--) {
                          if (newHours[order[i]] >= newHours[order[i + 1]]) {
                            newHours[order[i]] = newHours[order[i + 1]] - 15;
                          }
                        }
                        setHours(newHours);
                      }}
                      style={inputStyle}
                    />
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{desc}</div>
                  </div>
                );
              })}
            </div>

            {/* Quick presets */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
              <label style={labelStyle}>Quick presets</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { name: "Standard 9–5", hours: { difficultStart: 360, earlyStart: 450, workStart: 540, workEnd: 1020, lateEnd: 1200, difficultEnd: 1320 } },
                  { name: "Early bird (7–4)", hours: { difficultStart: 300, earlyStart: 360, workStart: 420, workEnd: 960, lateEnd: 1140, difficultEnd: 1260 } },
                  { name: "Late riser (10–6)", hours: { difficultStart: 420, earlyStart: 510, workStart: 600, workEnd: 1080, lateEnd: 1260, difficultEnd: 1380 } },
                  { name: "Flexible (8–7)", hours: { difficultStart: 330, earlyStart: 420, workStart: 480, workEnd: 1140, lateEnd: 1260, difficultEnd: 1380 } },
                  { name: "Night owl (12p–8p)", hours: { difficultStart: 540, earlyStart: 630, workStart: 720, workEnd: 1200, lateEnd: 1320, difficultEnd: 1410 } },
                ].map(preset => (
                  <button key={preset.name} onClick={() => setHours(preset.hours)} style={{
                    fontSize: 12, fontWeight: 500, padding: "5px 11px",
                    border: "1px solid #e2e8f0", borderRadius: 999, background: "#fff",
                    color: "#0f172a", cursor: "pointer", fontFamily: "inherit",
                  }}>{preset.name}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Comparison table */}
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>All meeting times</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              Click any row to highlight on the day view · 30-minute intervals
            </div>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 480, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 480 }}>
              <colgroup>
                <col style={{ width: 120 }} />
                {zones.map(z => <col key={z.tz} />)}
              </colgroup>
              <thead>
                <tr style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
                  <th style={{
                    padding: "10px 14px", fontSize: 11, fontWeight: 600, textAlign: "left",
                    color: "#64748b", borderBottom: "1px solid #e2e8f0",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    {orgPartsHeader?.abbr || "Organizer"}
                  </th>
                  {zones.map(z => (
                    <th key={z.tz} style={{
                      padding: "10px 6px", fontSize: 11, fontWeight: 600, textAlign: "center",
                      color: "#64748b", borderBottom: "1px solid #e2e8f0",
                      textTransform: "uppercase", letterSpacing: "0.04em",
                    }}>{z.city}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, idx) => {
                  const isSelected = selectedTime?.getTime() === slot.getTime();
                  const orgDate = getTZParts(slot, orgTZ);
                  return (
                    <tr key={idx} onClick={() => setSelectedTime(isSelected ? null : slot)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "#eff6ff" : "#fff",
                        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
                      }}>
                      <td style={{
                        padding: "8px 14px", fontSize: 13, fontWeight: isSelected ? 600 : 500,
                        color: "#0f172a", borderBottom: "1px solid #f1f5f9",
                      }}>
                        {formatTime(slot, orgTZ, use24)}
                        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 5, fontWeight: 400 }}>{orgDate.abbr}</span>
                      </td>
                      {zones.map(z => {
                        const mins = getMinutes(slot, z.tz);
                        const cat = getCategory(mins, duration, hours);
                        const s = CAT[cat];
                        const parts = getTZParts(slot, z.tz);
                        const diffDay = parts.day !== orgDate.day || parts.month !== orgDate.month;
                        return (
                          <td key={z.tz} style={{ padding: 0, textAlign: "center", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{
                              margin: 3, padding: "6px 4px", borderRadius: 6,
                              background: s.soft, border: `1px solid ${s.bg}33`,
                            }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: s.dark }}>
                                {formatTime(slot, z.tz, use24)}
                              </div>
                              <div style={{ fontSize: 9, color: s.dark, opacity: 0.75, marginTop: 1 }}>
                                {parts.abbr}{diffDay ? ` · ${parts.weekday}` : ""}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
