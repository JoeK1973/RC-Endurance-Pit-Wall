import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Play, Pause, RotateCcw, BatteryCharging, Users, UserPlus, Pencil,
  Check, X, ChevronUp, ChevronDown, Moon, Sun, Trash2, ArrowLeftRight,
  Repeat, Flag, Share2, Copy, Timer, Settings as SettingsIcon,
  FileSpreadsheet, FileDown, Volume2, VolumeX, ExternalLink, Gauge,
  LayoutDashboard, Users2, LineChart as LineChartIcon, BellRing
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from "recharts";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---- timing hook -----------------------------------------------------
function useClock(isRunning) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const accumRef = useRef(0);

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(accumRef.current + (Date.now() - startRef.current));
    }, 200);
    return () => {
      if (startRef.current != null) accumRef.current += Date.now() - startRef.current;
      clearInterval(id);
    };
  }, [isRunning]);

  const reset = useCallback(() => {
    accumRef.current = 0;
    startRef.current = Date.now();
    setElapsed(0);
  }, []);

  // Correct a running clock from a shared authoritative snapshot.
  const sync = useCallback((ms) => {
    const safe = Math.max(0, Number(ms) || 0);
    accumRef.current = safe;
    startRef.current = isRunning ? Date.now() : null;
    setElapsed(safe);
  }, [isRunning]);

  return [elapsed, reset, sync];
}

function pad(n) { return n.toString().padStart(2, "0"); }

function formatClock(ms, forceHours) {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const body = h > 0 || forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return (neg ? "-" : "") + body;
}

function formatSec(ms, decimals = 2) {
  return (ms / 1000).toFixed(decimals) + "s";
}

let idCounter = 1;
function nextId() { idCounter += 1; return "d" + idCounter; }

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const DEFAULT_DRIVERS = [
  { id: "d1", name: "Alex" },
  { id: "d2", name: "Sam" },
  { id: "d3", name: "Jordan" },
  { id: "d4", name: "Casey" },
];

const ROLE_CYCLE = ["Drive", "Rest", "Pit", "Marshal"];

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "team", label: "Team", icon: Users2 },
  { id: "analysis", label: "Analysis", icon: LineChartIcon },
  { id: "strategy", label: "Strategy", icon: Gauge },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function PitWall() {
  const [isDark, setIsDark] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [raceDurationMin, setRaceDurationMin] = useState(60);
  const [stintTargetMin, setStintTargetMin] = useState(5);
  const [activeTab, setActiveTab] = useState("dashboard");

  const [raceElapsed, resetRaceClock, syncRaceClock] = useClock(isRunning);
  const [batteryElapsed, resetBatteryClock, syncBatteryClock] = useClock(isRunning); // battery / pit-light clock
  const [driverElapsed, resetDriverClock, syncDriverClock] = useClock(isRunning);   // current driver's on-track clock

  const [drivers, setDrivers] = useState(DEFAULT_DRIVERS);
  const [queueIds, setQueueIds] = useState(["d1", "d2", "d3", "d4"]);
  const [newDriverName, setNewDriverName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const [pitLog, setPitLog] = useState([]); // rotation / battery-change log
  const [stintHistory, setStintHistory] = useState([]); // completed driver stints
  const [currentStintLaps, setCurrentStintLaps] = useState([]);
  const finishedRef = useRef(false);
  const alertFiredRef = useRef(false);
  const alertAudioCtxRef = useRef(null);

  const [sessionId, setSessionId] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("session");
      return (fromUrl || genCode()).trim().toUpperCase().slice(0, 6);
    } catch { return genCode(); }
  });
  const remoteApplyRef = useRef(false);
  const sharedStateRef = useRef(null);
  const lastSyncedHashRef = useRef("");
  const [connectionState, setConnectionState] = useState(supabase ? "connecting" : "offline");
  const [shareOpen, setShareOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [syncStatus, setSyncStatus] = useState("");

  const [settings, setSettings] = useState({
    alertThresholdSec: 90,
    audioEnabled: true,
    showBatteryBtn: true,
    showDriverBtn: true,
    showCombinedBtn: true,
    liveResultsUrl: "",
    liveTeamName: "",
  });

  const [historyFilterDriver, setHistoryFilterDriver] = useState("all");
  const [historyFilterDate, setHistoryFilterDate] = useState("");

  const [sim, setSim] = useState({
    raceDurationMin: 60,
    lapTimeSec: 22,
    batteryEnduranceMin: 6,
    swapTimeSec: 25,
  });

  const raceTargetMs = Math.max(0, raceDurationMin) * 60000;
  const stintTargetMs = Math.max(0.1, stintTargetMin) * 60000;
  const raceRemaining = raceTargetMs - raceElapsed;
  const batteryRemaining = stintTargetMs - batteryElapsed;
  const raceFinished = raceTargetMs > 0 && raceElapsed >= raceTargetMs;

  const currentDriver = drivers.find((d) => d.id === queueIds[0]) || null;
  const nextDriver = drivers.find((d) => d.id === queueIds[1]) || null;

  const addPitLog = useCallback((type, text) => {
    setPitLog((prev) => [
      { id: Date.now() + Math.random(), t: raceElapsed, wallClock: Date.now(), type, text },
      ...prev,
    ].slice(0, 300));
  }, [raceElapsed]);

  // ---- race finish ----
  useEffect(() => {
    if (raceFinished && isRunning) {
      setIsRunning(false);
      if (!finishedRef.current) {
        finishedRef.current = true;
        addPitLog("system", "Race time complete");
      }
    }
    if (!raceFinished) finishedRef.current = false;
  }, [raceFinished, isRunning, addPitLog]);

  // ---- stint-ending alert ----
  function playBeep() {
    try {
      if (!alertAudioCtxRef.current) {
        alertAudioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = alertAudioCtxRef.current;
      [0, 0.22].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.15);
      });
    } catch (e) { /* audio unavailable */ }
  }

  const alertThresholdMs = Math.max(1, settings.alertThresholdSec) * 1000;
  const stintEndingSoon = batteryRemaining > 0 && batteryRemaining <= alertThresholdMs && isRunning;

  useEffect(() => {
    if (stintEndingSoon && !alertFiredRef.current) {
      alertFiredRef.current = true;
      if (settings.audioEnabled) playBeep();
    }
    if (batteryRemaining > alertThresholdMs) alertFiredRef.current = false;
  }, [stintEndingSoon, batteryRemaining, alertThresholdMs, settings.audioEnabled]);

  function toggleRun() {
    if (raceFinished) return;
    setIsRunning((r) => !r);
  }

  function handleReset() {
    const ok = window.confirm("Reset the race clock and logs? Drivers and queue stay as they are.");
    if (!ok) return;
    setIsRunning(false);
    resetRaceClock();
    resetBatteryClock();
    resetDriverClock();
    setCurrentStintLaps([]);
    setPitLog([]);
    setStintHistory([]);
    finishedRef.current = false;
    alertFiredRef.current = false;
  }

  function finalizeDriverStint(note) {
    if (!currentDriver) return;
    const record = {
      id: Date.now() + Math.random(),
      driverId: currentDriver.id,
      driver: currentDriver.name,
      totalMs: driverElapsed,
      laps: currentStintLaps.map((ms, i) => ({ n: i + 1, ms })),
      lapCount: currentStintLaps.length,
      note,
      wallClock: Date.now(),
      raceElapsedAt: raceElapsed,
    };
    setStintHistory((prev) => [record, ...prev]);
  }

  function logLap() {
    if (!currentDriver || !isRunning) return;
    const prevSum = currentStintLaps.reduce((a, b) => a + b, 0);
    const lapMs = Math.max(0, driverElapsed - prevSum);
    setCurrentStintLaps((prev) => [...prev, lapMs]);
  }

  function doBatterySwap() {
    resetBatteryClock();
    alertFiredRef.current = false;
    addPitLog("battery", `Battery swap — ${currentDriver ? currentDriver.name : "no driver"} continues`);
  }

  function doDriverSwap() {
    if (queueIds.length < 2) return;
    const [first, ...rest] = queueIds;
    const incoming = drivers.find((d) => d.id === rest[0]);
    finalizeDriverStint("Driver swap");
    setQueueIds([...rest, first]);
    resetDriverClock();
    setCurrentStintLaps([]);
    addPitLog("driver", `Driver change — ${incoming ? incoming.name : "?"} in for ${currentDriver ? currentDriver.name : "?"}`);
  }

  function doCombinedSwap() {
    const outgoing = currentDriver;
    finalizeDriverStint("Battery + driver swap");
    resetBatteryClock();
    resetDriverClock();
    setCurrentStintLaps([]);
    alertFiredRef.current = false;
    if (queueIds.length >= 2) {
      const [first, ...rest] = queueIds;
      const incoming = drivers.find((d) => d.id === rest[0]);
      setQueueIds([...rest, first]);
      addPitLog("combined", `Battery + driver swap — ${incoming ? incoming.name : "?"} in for ${outgoing ? outgoing.name : "?"}`);
    } else {
      addPitLog("battery", `Battery swap — ${outgoing ? outgoing.name : "no driver"} continues`);
    }
  }

  function addDriver() {
    const name = newDriverName.trim();
    if (!name) return;
    const id = nextId();
    setDrivers((prev) => [...prev, { id, name }]);
    setQueueIds((prev) => [...prev, id]);
    setNewDriverName("");
  }

  function removeDriver(id) {
    setDrivers((prev) => prev.filter((d) => d.id !== id));
    setQueueIds((prev) => prev.filter((qid) => qid !== id));
    if (editingId === id) setEditingId(null);
  }

  function startEdit(d) { setEditingId(d.id); setEditingName(d.name); }
  function saveEdit() {
    const name = editingName.trim();
    if (name) setDrivers((prev) => prev.map((d) => (d.id === editingId ? { ...d, name } : d)));
    setEditingId(null);
  }

  function moveInQueue(index, dir) {
    setQueueIds((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // ---- pit lights / battery status ----
  const stintPct = stintTargetMs > 0 ? batteryElapsed / stintTargetMs : 0;
  const isOver = batteryRemaining < 0;
  const status = isOver ? "over" : stintPct < 0.6 ? "green" : stintPct < 0.85 ? "amber" : "red";
  const LIGHTS = 8;
  const litCount = isOver ? LIGHTS : Math.min(LIGHTS, Math.floor(stintPct * LIGHTS));
  function lightZoneColor(i) {
    const zonePct = (i + 1) / LIGHTS;
    if (zonePct <= 0.6) return "var(--green)";
    if (zonePct <= 0.85) return "var(--amber)";
    return "var(--red)";
  }
  const racePct = raceTargetMs > 0 ? Math.min(1, raceElapsed / raceTargetMs) : 0;

  // ---- activity tracker ----
  const activityRows = queueIds.map((id, i) => {
    const d = drivers.find((dr) => dr.id === id);
    return { id, name: d ? d.name : "?", role: ROLE_CYCLE[i % ROLE_CYCLE.length] };
  });

  // ---- driver load summary ----
  const driverLoad = useMemo(() => {
    const totals = {};
    drivers.forEach((d) => { totals[d.id] = 0; });
    stintHistory.forEach((s) => { totals[s.driverId] = (totals[s.driverId] || 0) + s.totalMs; });
    if (currentDriver) totals[currentDriver.id] = (totals[currentDriver.id] || 0) + driverElapsed;
    const rows = drivers.map((d) => ({ id: d.id, name: d.name, ms: totals[d.id] || 0 }));
    rows.sort((a, b) => b.ms - a.ms);
    return rows;
  }, [drivers, stintHistory, currentDriver, driverElapsed]);
  const maxLoadMs = Math.max(1, ...driverLoad.map((r) => r.ms));

  // ---- history filtering ----
  const filteredHistory = stintHistory.filter((s) => {
    if (historyFilterDriver !== "all" && s.driverId !== historyFilterDriver) return false;
    if (historyFilterDate) {
      const d = new Date(s.wallClock);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== historyFilterDate) return false;
    }
    return true;
  });

  // ---- chart data ----
  const currentLapChartData = currentStintLaps.map((ms, i) => ({ lap: i + 1, seconds: Number((ms / 1000).toFixed(2)) }));

  const paceByDriver = useMemo(() => {
    const grouped = {};
    stintHistory.forEach((s) => {
      if (!s.lapCount) return;
      const avg = s.laps.reduce((a, l) => a + l.ms, 0) / s.laps.length / 1000;
      if (!grouped[s.driver]) grouped[s.driver] = [];
      grouped[s.driver].push(avg);
    });
    return Object.entries(grouped).map(([name, vals]) => ({
      name,
      avgLap: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
    }));
  }, [stintHistory]);

  const recentStintLapChart = useMemo(() => {
    const byDriver = {};
    drivers.forEach((d) => {
      const latest = stintHistory.find((s) => s.driverId === d.id && s.lapCount > 0);
      if (latest) byDriver[d.name] = latest.laps;
    });
    const maxLen = Math.max(0, ...Object.values(byDriver).map((l) => l.length));
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const row = { lap: i + 1 };
      Object.entries(byDriver).forEach(([name, laps]) => {
        if (laps[i]) row[name] = Number((laps[i].ms / 1000).toFixed(2));
      });
      rows.push(row);
    }
    return { rows, drivers: Object.keys(byDriver) };
  }, [drivers, stintHistory]);

  const chartLineColors = ["#2f80ed", "#e24c4c", "#2fb170", "#f5a623", "#8e6fed", "#e24ca0"];

  // ---- strategy simulator ----
  const simCandidates = useMemo(() => {
    const battery = Math.max(0.5, sim.batteryEnduranceMin);
    const raceMin = Math.max(1, sim.raceDurationMin);
    const lapSec = Math.max(1, sim.lapTimeSec);
    const swapSec = Math.max(0, sim.swapTimeSec);
    const fractions = [1, 0.9, 0.8, 0.7, 0.6];
    const rows = fractions.map((f) => {
      const stintLen = Math.max(0.5, battery * f);
      const numStints = Math.ceil(raceMin / stintLen);
      const numSwaps = Math.max(0, numStints - 1);
      const swapTimeMin = (numSwaps * swapSec) / 60;
      const driveTimeMin = Math.max(0, raceMin - swapTimeMin);
      const laps = Math.floor((driveTimeMin * 60) / lapSec);
      return { fraction: f, stintLen, numStints, numSwaps, swapTimeMin, driveTimeMin, laps };
    });
    let best = rows[0];
    rows.forEach((r) => { if (r.laps > best.laps) best = r; });
    return { rows, best };
  }, [sim]);

  // ---- live recommendation ----
  const recommendation = useMemo(() => {
    if (!currentDriver) return "Add a driver and start the race to see recommendations here.";
    if (currentStintLaps.length < 2) return `Log a couple of laps for ${currentDriver.name} to unlock a live recommendation.`;
    const baseline = currentStintLaps.slice(0, Math.min(2, currentStintLaps.length)).reduce((a, b) => a + b, 0) / Math.min(2, currentStintLaps.length);
    const recentN = Math.min(3, currentStintLaps.length);
    const recent = currentStintLaps.slice(-recentN).reduce((a, b) => a + b, 0) / recentN;
    const deltaSec = (recent - baseline) / 1000;
    const pctDelta = baseline > 0 ? ((recent - baseline) / baseline) * 100 : 0;
    const avgLapSec = Math.max(1, (currentStintLaps.reduce((a, b) => a + b, 0) / currentStintLaps.length) / 1000);
    const swapCostLaps = sim.swapTimeSec / avgLapSec;
    const line1 = pctDelta < 5
      ? `Keep ${currentDriver.name} out for another ${formatClock(Math.max(0, batteryRemaining))}.`
      : `Consider pitting ${currentDriver.name} soon — pace has dropped ${pctDelta.toFixed(1)}%.`;
    const line2 = `Battery performance is ${Math.abs(deltaSec).toFixed(2)}s ${deltaSec >= 0 ? "slower than" : "within"} baseline.`;
    const line3 = `Changing now would cost approximately ${swapCostLaps.toFixed(1)} laps.`;
    const nextEta = raceElapsed + Math.max(0, batteryRemaining);
    const line4 = nextDriver ? `Next: ${nextDriver.name} + battery change at ${formatClock(nextEta, true)}.` : `No driver queued after ${currentDriver.name}.`;
    return [line1, line2, line3, line4];
  }, [currentDriver, currentStintLaps, batteryRemaining, sim.swapTimeSec, raceElapsed, nextDriver]);

  // ---- export ----
  function exportExcel() {
    const historySheet = stintHistory.map((s) => ({
      Driver: s.driver,
      "Total Time": formatClock(s.totalMs),
      "Lap Count": s.lapCount,
      "Avg Lap (s)": s.lapCount ? (s.laps.reduce((a, l) => a + l.ms, 0) / s.lapCount / 1000).toFixed(2) : "",
      "Lap Times (s)": s.laps.map((l) => (l.ms / 1000).toFixed(2)).join("; "),
      Note: s.note,
      Date: new Date(s.wallClock).toLocaleString(),
    }));
    const pitSheet = pitLog.map((p) => ({
      "Race Time": formatClock(p.t, true),
      Type: p.type,
      Details: p.text,
      Date: new Date(p.wallClock).toLocaleString(),
    }));
    const loadSheet = driverLoad.map((r) => ({ Driver: r.name, "Total Track Time": formatClock(r.ms) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historySheet), "Stint History");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pitSheet), "Pit Log");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loadSheet), "Driver Load");
    XLSX.writeFile(wb, `pit-wall-${sessionId}.xlsx`);
  }

  function exportSheetsCsv() {
    const rows = [["Driver", "Total Stint Time", "Lap Count", "Note", "Date"]];
    stintHistory.forEach((s) => {
      rows.push([s.driver, formatClock(s.totalMs), s.lapCount, s.note, new Date(s.wallClock).toLocaleString()]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pit-wall-${sessionId}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- multi-device session sync -----------------------------------
  // Supabase stores the latest snapshot and Realtime pushes changes to all
  // connected pit-wall devices. Clock values are periodically corrected from
  // the shared snapshot so a newly joined tablet/phone catches up quickly.
  const sharedSnapshot = useMemo(() => ({
    drivers, queueIds, stintHistory, pitLog, settings, raceDurationMin, stintTargetMin,
    isRunning, raceElapsed, batteryElapsed, driverElapsed, currentStintLaps,
  }), [drivers, queueIds, stintHistory, pitLog, settings, raceDurationMin, stintTargetMin,
      isRunning, raceElapsed, batteryElapsed, driverElapsed, currentStintLaps]);

  useEffect(() => { sharedStateRef.current = sharedSnapshot; }, [sharedSnapshot]);

  const applyRemoteSnapshot = useCallback((data) => {
    if (!data) return;
    remoteApplyRef.current = true;
    setDrivers(data.drivers || []);
    setQueueIds(data.queueIds || []);
    setStintHistory(data.stintHistory || []);
    setPitLog(data.pitLog || []);
    setSettings((s) => ({ ...s, ...(data.settings || {}) }));
    if (Number.isFinite(data.raceDurationMin)) setRaceDurationMin(data.raceDurationMin);
    if (Number.isFinite(data.stintTargetMin)) setStintTargetMin(data.stintTargetMin);
    setCurrentStintLaps(data.currentStintLaps || []);
    syncRaceClock(data.raceElapsed || 0);
    syncBatteryClock(data.batteryElapsed || 0);
    syncDriverClock(data.driverElapsed || 0);
    setIsRunning(Boolean(data.isRunning));
    setTimeout(() => { remoteApplyRef.current = false; }, 0);
  }, [syncRaceClock, syncBatteryClock, syncDriverClock]);

  const shareLink = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareLink)}`;

  useEffect(() => {
    if (!supabase || !sessionId) { setConnectionState("offline"); return undefined; }
    let cancelled = false;
    const channel = supabase.channel(`pitwall:${sessionId}`, { config: { broadcast: { self: false } } });

    const initialise = async () => {
      setConnectionState("connecting");
      const { data, error } = await supabase.from("pitwall_sessions").select("state").eq("session_id", sessionId).maybeSingle();
      if (cancelled) return;
      if (error) { setConnectionState("error"); setSyncStatus(`Sync error: ${error.message}`); }
      else if (data?.state && Object.keys(data.state).length) {
        lastSyncedHashRef.current = JSON.stringify(data.state);
        applyRemoteSnapshot(data.state);
        setSyncStatus("Live session connected");
      }
      else {
        await supabase.from("pitwall_sessions").upsert({ session_id: sessionId, state: sharedStateRef.current || {} }, { onConflict: "session_id" });
        setSyncStatus("Live session created");
      }
    };

    channel
      .on("broadcast", { event: "state" }, ({ payload }) => { applyRemoteSnapshot(payload?.state); })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { setConnectionState("live"); initialise(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnectionState("error");
      });

    const dbChannel = supabase.channel(`pitwall-db:${sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pitwall_sessions", filter: `session_id=eq.${sessionId}` }, (payload) => {
        if (!remoteApplyRef.current && payload.new?.state) applyRemoteSnapshot(payload.new.state);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      supabase.removeChannel(dbChannel);
    };
  }, [sessionId, applyRemoteSnapshot]);

  useEffect(() => {
    if (!supabase || !sessionId) return undefined;
    const timer = setInterval(async () => {
      if (remoteApplyRef.current) return;
      const state = sharedStateRef.current;
      if (!state) return;
      const hash = JSON.stringify(state);
      if (hash === lastSyncedHashRef.current) return;
      const { error } = await supabase.from("pitwall_sessions").upsert({ session_id: sessionId, state, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
      if (error) { setConnectionState("error"); }
      else lastSyncedHashRef.current = hash;
    }, isRunning ? 1000 : 1500);
    return () => clearInterval(timer);
  }, [sessionId, isRunning]);

  const copyText = useCallback((text, label) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => setSyncStatus(`${label} copied`)).catch(() => setSyncStatus("Copy failed"));
  }, []);

  async function saveSnapshot() {
    if (!supabase) { setSyncStatus("Supabase is not configured"); return; }
    const state = sharedStateRef.current || sharedSnapshot;
    const { error } = await supabase.from("pitwall_sessions").upsert({ session_id: sessionId, state, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
    if (!error) lastSyncedHashRef.current = JSON.stringify(state);
    setSyncStatus(error ? `Save failed: ${error.message}` : "Session snapshot saved");
  }

  async function loadSnapshot() {
    const code = joinCode.trim().toUpperCase();
    if (!code) { setSyncStatus("Enter a session code first"); return; }
    if (!supabase) { setSyncStatus("Supabase is not configured"); return; }
    const { data, error } = await supabase.from("pitwall_sessions").select("state").eq("session_id", code).maybeSingle();
    if (error) { setSyncStatus(`Load failed: ${error.message}`); return; }
    if (!data?.state) { setSyncStatus("No saved session found for that code"); return; }
    setSessionId(code);
    const url = new URL(window.location.href);
    url.searchParams.set("session", code);
    window.history.replaceState({}, "", url);
    applyRemoteSnapshot(data.state);
    setSyncStatus("Joined live session");
  }

  return (
    <div className="rcpit-root" data-theme={isDark ? "dark" : "light"}>
      <style>{`
        .rcpit-root {
          --font-display: 'Space Mono', monospace;
          --font-body: 'Inter', sans-serif;
          font-family: var(--font-body);
          box-sizing: border-box;
          width: 100%;
          min-height: 100vh;
          padding: 0.9rem;
        }
        .rcpit-root * { box-sizing: border-box; }
        .rcpit-root[data-theme="dark"] {
          --bg: #14171a; --surface: #1c2024; --surface-raised: #22272b;
          --border-c: #2e3438; --text: #f2f0ea; --text-muted: #8b9298;
          --green: #2fb170; --green-dim: #1c3f2c;
          --amber: #f5a623; --amber-dim: #423714;
          --red: #e24c4c; --red-dim: #482222;
          --blue: #3d8bfd; --blue-dim: #1a2c47;
          background: var(--bg); color: var(--text);
        }
        .rcpit-root[data-theme="light"] {
          --bg: #efede6; --surface: #ffffff; --surface-raised: #faf9f5;
          --border-c: #d8d4c8; --text: #1b1d1f; --text-muted: #6b6f73;
          --green: #1f8a55; --green-dim: #d9ecdf;
          --amber: #b8760f; --amber-dim: #f6e6c8;
          --red: #c73e3e; --red-dim: #f6dcdc;
          --blue: #1d63d8; --blue-dim: #dbe7fb;
          background: var(--bg); color: var(--text);
        }
        .rcpit-wrap { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.9rem; }
        .rcpit-header { display: flex; align-items: center; justify-content: space-between; padding: 0.2rem 0.1rem; flex-wrap: wrap; gap: 0.5rem; }
        .rcpit-brand { display: flex; align-items: center; gap: 0.5rem; }
        .rcpit-brand-mark { color: var(--amber); }
        .rcpit-eyebrow { font-family: var(--font-display); font-size: 0.65rem; letter-spacing: 0.14em; color: var(--text-muted); text-transform: uppercase; margin: 0; }
        .rcpit-title { font-size: 1.05rem; font-weight: 700; margin: 0; letter-spacing: 0.01em; }
        .rcpit-session-tag { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-muted); }
        .rcpit-sync-dot { font-family: var(--font-display); font-size: 0.58rem; margin-left: 0.35rem; letter-spacing: 0.08em; }
        .rcpit-sync-dot.live { color: var(--green); } .rcpit-sync-dot.error { color: var(--red); } .rcpit-sync-dot.offline { color: var(--text-muted); } .rcpit-sync-dot.connecting { color: var(--amber); }
        .rcpit-header-actions { display: flex; align-items: center; gap: 0.5rem; }
        .rcpit-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 10px; border: 1px solid var(--border-c); background: var(--surface); color: var(--text); cursor: pointer; }
        .rcpit-icon-btn:active { transform: scale(0.96); }

        .rcpit-tabs { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.2rem; }
        .rcpit-tab { display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; font-family: var(--font-body); font-weight: 600; font-size: 0.82rem; border-radius: 10px; border: 1px solid var(--border-c); background: var(--surface); color: var(--text-muted); padding: 0.55rem 0.9rem; cursor: pointer; min-height: 42px; }
        .rcpit-tab.active { background: var(--amber-dim); border-color: var(--amber); color: var(--amber); }

        .rcpit-card { background: var(--surface); border: 1px solid var(--border-c); border-radius: 14px; padding: 1rem; }
        .rcpit-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.7rem; flex-wrap: wrap; gap: 0.5rem; }
        .rcpit-label { font-family: var(--font-display); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); margin: 0; }

        .rcpit-grid { display: grid; grid-template-columns: 1fr; gap: 0.9rem; }
        @media (min-width: 860px) { .rcpit-grid { grid-template-columns: 1.1fr 0.9fr; align-items: start; } }
        .rcpit-col { display: flex; flex-direction: column; gap: 0.9rem; }

        .rcpit-race-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1.5rem; }
        .rcpit-race-block { display: flex; flex-direction: column; gap: 0.15rem; }
        .rcpit-big-num { font-family: var(--font-display); font-weight: 700; font-size: clamp(1.7rem, 6vw, 2.4rem); font-variant-numeric: tabular-nums; line-height: 1; }
        .rcpit-num-sub { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
        .rcpit-progress { height: 8px; border-radius: 5px; background: var(--border-c); overflow: hidden; margin-top: 0.8rem; }
        .rcpit-progress-fill { height: 100%; background: var(--amber); border-radius: 5px; transition: width 0.3s linear; }

        .rcpit-controls-row { display: flex; gap: 0.6rem; margin-top: 0.9rem; flex-wrap: wrap; }
        .rcpit-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; font-family: var(--font-body); font-weight: 600; font-size: 0.85rem; border-radius: 10px; border: 1px solid var(--border-c); background: var(--surface-raised); color: var(--text); padding: 0.7rem 1rem; min-height: 48px; cursor: pointer; }
        .rcpit-btn:active { transform: scale(0.98); }
        .rcpit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rcpit-btn-start { background: var(--green); border-color: var(--green); color: #04150c; }
        .rcpit-btn-pause { background: var(--red); border-color: var(--red); color: #fff; }
        .rcpit-btn-reset { background: transparent; border-color: var(--amber); color: var(--amber); }
        .rcpit-btn-swap { background: var(--blue); border-color: var(--blue); color: #fff; }
        .rcpit-btn-ghost { background: transparent; }
        .rcpit-btn-sm { padding: 0.4rem 0.6rem; min-height: 34px; font-size: 0.78rem; }

        .rcpit-mini-input { width: 4.2rem; text-align: center; font-family: var(--font-display); font-weight: 700; background: var(--surface-raised); border: 1px solid var(--border-c); border-radius: 8px; color: var(--text); padding: 0.35rem; font-size: 0.85rem; }
        .rcpit-setting { display: flex; align-items: center; gap: 0.5rem; }
        .rcpit-setting label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

        .rcpit-stint-driver { font-size: clamp(1.3rem, 5vw, 1.7rem); font-weight: 800; margin: 0 0 0.15rem; }
        .rcpit-stint-time { font-family: var(--font-display); font-weight: 700; font-size: clamp(2.1rem, 9vw, 3.1rem); font-variant-numeric: tabular-nums; line-height: 1; }
        .rcpit-stint-status { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.15rem 0.55rem; border-radius: 6px; display: inline-block; }
        .rcpit-ontrack { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem; }
        .rcpit-lights { display: flex; gap: 5px; margin: 0.85rem 0 0.3rem; }
        .rcpit-light { flex: 1; height: 14px; border-radius: 3px; background: var(--border-c); transition: background-color 0.15s ease; }
        .rcpit-light.on.flash { animation: rcpit-flash 0.6s ease-in-out infinite; }
        @keyframes rcpit-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .rcpit-alert-banner { display: flex; align-items: center; gap: 0.5rem; background: var(--amber-dim); border: 1px solid var(--amber); color: var(--amber); font-weight: 700; font-size: 0.8rem; padding: 0.5rem 0.7rem; border-radius: 9px; margin-top: 0.7rem; animation: rcpit-flash 1s ease-in-out infinite; }
        .rcpit-next-up { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.9rem; padding-top: 0.8rem; border-top: 1px solid var(--border-c); font-size: 0.85rem; color: var(--text-muted); }
        .rcpit-next-up b { color: var(--text); font-weight: 700; }

        .rcpit-action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
        @media (max-width: 480px) { .rcpit-action-grid { grid-template-columns: 1fr; } }
        .rcpit-action-btn { flex-direction: column; min-height: 72px; gap: 0.3rem; font-size: 0.78rem; text-align: center; }
        .rcpit-action-btn span.rcpit-action-title { font-size: 0.82rem; }

        .rcpit-add-row { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; }
        .rcpit-text-input { flex: 1; background: var(--surface-raised); border: 1px solid var(--border-c); border-radius: 9px; color: var(--text); padding: 0.6rem 0.7rem; font-size: 0.88rem; font-family: var(--font-body); min-height: 42px; }
        .rcpit-select { background: var(--surface-raised); border: 1px solid var(--border-c); border-radius: 9px; color: var(--text); padding: 0.5rem 0.6rem; font-size: 0.85rem; min-height: 40px; }

        .rcpit-queue-list { display: flex; flex-direction: column; gap: 0.45rem; }
        .rcpit-queue-item { display: flex; align-items: center; gap: 0.55rem; padding: 0.55rem 0.6rem; border-radius: 10px; border: 1px solid var(--border-c); background: var(--surface-raised); }
        .rcpit-queue-item.current { border-color: var(--amber); background: var(--amber-dim); }
        .rcpit-queue-pos { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-muted); min-width: 1.4rem; }
        .rcpit-queue-item.current .rcpit-queue-pos { color: var(--amber); font-weight: 700; }
        .rcpit-queue-name { flex: 1; font-weight: 600; font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rcpit-role-tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; padding: 0.12rem 0.5rem; border-radius: 6px; }
        .rcpit-role-Drive { color: var(--green); background: var(--green-dim); }
        .rcpit-role-Rest { color: var(--text-muted); background: var(--surface); }
        .rcpit-role-Pit { color: var(--blue); background: var(--blue-dim); }
        .rcpit-role-Marshal { color: var(--amber); background: var(--amber-dim); }
        .rcpit-queue-actions { display: flex; gap: 0.25rem; }
        .rcpit-tiny-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border-c); background: var(--surface); color: var(--text-muted); cursor: pointer; }
        .rcpit-tiny-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .rcpit-edit-row { display: flex; flex: 1; gap: 0.35rem; }

        .rcpit-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .rcpit-table th { text-align: left; font-family: var(--font-display); font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border-c); }
        .rcpit-table td { padding: 0.5rem; border-bottom: 1px solid var(--border-c); vertical-align: top; }
        .rcpit-table-wrap { overflow-x: auto; max-height: 340px; overflow-y: auto; }
        .rcpit-empty { color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.2rem 0.5rem; }

        .rcpit-load-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.55rem; }
        .rcpit-load-name { width: 5.5rem; font-size: 0.82rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rcpit-load-bar-track { flex: 1; height: 10px; border-radius: 5px; background: var(--surface-raised); overflow: hidden; }
        .rcpit-load-bar-fill { height: 100%; background: var(--blue); border-radius: 5px; }
        .rcpit-load-time { font-family: var(--font-display); font-size: 0.78rem; min-width: 4.5rem; text-align: right; }

        .rcpit-finished-banner { background: var(--red-dim); border: 1px solid var(--red); color: var(--red); font-weight: 700; font-size: 0.85rem; padding: 0.6rem 0.8rem; border-radius: 10px; text-align: center; letter-spacing: 0.04em; text-transform: uppercase; }

        .rcpit-share-panel { position: relative; }
        .rcpit-share-pop { position: absolute; right: 0; top: 50px; z-index: 20; width: 280px; background: var(--surface); border: 1px solid var(--border-c); border-radius: 14px; padding: 1rem; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
        .rcpit-code-box { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; text-align: center; letter-spacing: 0.15em; background: var(--surface-raised); border: 1px solid var(--border-c); border-radius: 10px; padding: 0.6rem; margin: 0.5rem 0; }
        .rcpit-qr-wrap { display: flex; justify-content: center; margin: 0.6rem 0; }
        .rcpit-sync-status { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem; text-align: center; }

        .rcpit-rec-box { background: var(--surface-raised); border-left: 3px solid var(--blue); border-radius: 8px; padding: 0.9rem; font-size: 0.88rem; line-height: 1.7; }
        .rcpit-rec-title { font-family: var(--font-display); font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--blue); margin: 0 0 0.4rem; }

        .rcpit-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid var(--border-c); }
        .rcpit-toggle-row:last-child { border-bottom: none; }
        .rcpit-toggle-label { font-size: 0.88rem; font-weight: 600; }
        .rcpit-toggle-sub { font-size: 0.75rem; color: var(--text-muted); }
        .rcpit-switch { position: relative; width: 44px; height: 26px; border-radius: 13px; border: 1px solid var(--border-c); background: var(--surface-raised); cursor: pointer; flex-shrink: 0; }
        .rcpit-switch.on { background: var(--blue); border-color: var(--blue); }
        .rcpit-switch-knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface); transition: left 0.15s ease; }
        .rcpit-switch.on .rcpit-switch-knob { left: 20px; background: #fff; }

        .rcpit-sim-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 0.7rem; }
        .rcpit-sim-table th, .rcpit-sim-table td { padding: 0.5rem; text-align: center; border-bottom: 1px solid var(--border-c); }
        .rcpit-sim-table th { font-family: var(--font-display); font-size: 0.64rem; text-transform: uppercase; color: var(--text-muted); }
        .rcpit-sim-row-best { background: var(--green-dim); }
        .rcpit-sim-row-best td:first-child { color: var(--green); font-weight: 700; }
      `}</style>

      <div className="rcpit-wrap">
        <div className="rcpit-header">
          <div className="rcpit-brand">
            <Flag size={20} className="rcpit-brand-mark" />
            <div>
              <p className="rcpit-eyebrow">Endurance</p>
              <p className="rcpit-title">Pit Wall <span className="rcpit-session-tag">· {sessionId}</span> <span className={`rcpit-sync-dot ${connectionState}`} title={connectionState}>{connectionState === "live" ? "● LIVE" : connectionState === "offline" ? "● OFFLINE" : "● SYNC"}</span></p>
            </div>
          </div>
          <div className="rcpit-header-actions">
            <div className="rcpit-share-panel">
              <button className="rcpit-icon-btn" onClick={() => setShareOpen((s) => !s)} aria-label="Share session">
                <Share2 size={18} />
              </button>
              {shareOpen && (
                <div className="rcpit-share-pop">
                  <p className="rcpit-label">Session code</p>
                  <div className="rcpit-code-box">{sessionId}</div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="rcpit-btn rcpit-btn-sm" style={{ flex: 1 }} onClick={() => copyText(sessionId, "Code")}>
                      <Copy size={14} /> Copy code
                    </button>
                    <button className="rcpit-btn rcpit-btn-sm" style={{ flex: 1 }} onClick={() => copyText(shareLink, "Link")}>
                      <Copy size={14} /> Copy link
                    </button>
                  </div>
                  <div className="rcpit-qr-wrap">
                    <img src={qrUrl} width={140} height={140} alt="QR code for session link" onError={(e) => { e.target.style.display = "none"; }} />
                  </div>
                  <button className="rcpit-btn rcpit-btn-sm" style={{ width: "100%" }} onClick={saveSnapshot}>Save session snapshot</button>
                  <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
                    <input className="rcpit-text-input" placeholder="Enter code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} style={{ minHeight: 36, fontSize: "0.8rem" }} />
                    <button className="rcpit-btn rcpit-btn-sm" onClick={loadSnapshot}>Load</button>
                  </div>
                  {syncStatus && <p className="rcpit-sync-status">{syncStatus}</p>}
                </div>
              )}
            </div>
            <button className="rcpit-icon-btn" onClick={() => setIsDark((d) => !d)} aria-label="Toggle theme">
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>

        <div className="rcpit-tabs">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} className={`rcpit-tab ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
                <Icon size={16} /> {t.label}
              </button>
            );
          })}
        </div>

        {raceFinished && <div className="rcpit-finished-banner">Race time complete</div>}

        {activeTab === "dashboard" && (
          <div className="rcpit-grid">
            <div className="rcpit-col">
              <div className="rcpit-card">
                <div className="rcpit-card-head">
                  <p className="rcpit-label">Race clock</p>
                  <div className="rcpit-setting">
                    <label htmlFor="raceDur">Length (min)</label>
                    <input id="raceDur" className="rcpit-mini-input" type="number" min="1" value={raceDurationMin} onChange={(e) => setRaceDurationMin(Number(e.target.value) || 0)} />
                  </div>
                </div>
                <div className="rcpit-race-row">
                  <div className="rcpit-race-block">
                    <span className="rcpit-big-num">{formatClock(raceElapsed, true)}</span>
                    <span className="rcpit-num-sub">Elapsed</span>
                  </div>
                  <div className="rcpit-race-block">
                    <span className="rcpit-big-num" style={{ color: raceRemaining < 300000 ? "var(--red)" : undefined }}>{formatClock(Math.max(0, raceRemaining), true)}</span>
                    <span className="rcpit-num-sub">Remaining</span>
                  </div>
                </div>
                <div className="rcpit-progress"><div className="rcpit-progress-fill" style={{ width: `${racePct * 100}%` }} /></div>
                <div className="rcpit-controls-row">
                  <button className={`rcpit-btn ${isRunning ? "rcpit-btn-pause" : "rcpit-btn-start"}`} onClick={toggleRun} disabled={raceFinished}>
                    {isRunning ? <Pause size={17} /> : <Play size={17} />}
                    {isRunning ? "Pause" : "Start"}
                  </button>
                  <button className="rcpit-btn rcpit-btn-reset" onClick={handleReset}>
                    <RotateCcw size={17} /> Reset
                  </button>
                </div>
              </div>

              <div className="rcpit-card">
                <div className="rcpit-card-head">
                  <p className="rcpit-label">Current stint</p>
                  <div className="rcpit-setting">
                    <label htmlFor="stintDur">Battery target (min)</label>
                    <input id="stintDur" className="rcpit-mini-input" type="number" min="0.5" step="0.5" value={stintTargetMin} onChange={(e) => setStintTargetMin(Number(e.target.value) || 0)} />
                  </div>
                </div>
                <p className="rcpit-stint-driver">{currentDriver ? currentDriver.name : "No driver queued"}</p>
                <span className="rcpit-stint-time" style={{ color: status === "green" ? "var(--green)" : status === "amber" ? "var(--amber)" : "var(--red)" }}>
                  {status === "over" ? "+" : ""}{formatClock(Math.abs(batteryRemaining))}
                </span>
                <div>
                  <span className="rcpit-stint-status" style={{ color: status === "green" ? "var(--green)" : status === "amber" ? "var(--amber)" : "var(--red)", background: status === "green" ? "var(--green-dim)" : status === "amber" ? "var(--amber-dim)" : "var(--red-dim)" }}>
                    {status === "over" ? "Overtime" : status === "green" ? "On pace" : status === "amber" ? "Pit soon" : "Pit now"}
                  </span>
                </div>
                <p className="rcpit-ontrack">On track this stint: {formatClock(driverElapsed)} · {currentStintLaps.length} laps logged</p>

                <div className="rcpit-lights">
                  {Array.from({ length: LIGHTS }).map((_, i) => {
                    const lit = i < litCount;
                    return <div key={i} className={`rcpit-light ${lit ? "on" : ""} ${isOver ? "flash" : ""}`} style={{ background: lit ? (isOver ? "var(--red)" : lightZoneColor(i)) : "var(--border-c)" }} />;
                  })}
                </div>

                {stintEndingSoon && (
                  <div className="rcpit-alert-banner"><BellRing size={16} /> Stint ending soon — get the next driver ready</div>
                )}

                <div className="rcpit-controls-row">
                  <button className="rcpit-btn rcpit-btn-swap" onClick={logLap} disabled={!currentDriver || !isRunning}>
                    <Timer size={16} /> Log lap
                  </button>
                </div>

                {currentLapChartData.length > 0 && (
                  <div style={{ height: 160, marginTop: "0.9rem" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={currentLapChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
                        <XAxis dataKey="lap" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={36} />
                        <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-c)", fontSize: "0.78rem" }} />
                        <Line type="monotone" dataKey="seconds" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="rcpit-next-up">
                  <Users size={15} />
                  {nextDriver ? <span>Next up: <b>{nextDriver.name}</b></span> : <span>No driver on deck</span>}
                </div>
              </div>

              <div className="rcpit-card">
                <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Pit actions</p>
                <div className="rcpit-action-grid">
                  {settings.showBatteryBtn && (
                    <button className="rcpit-btn rcpit-btn-swap rcpit-action-btn" onClick={doBatterySwap} disabled={!currentDriver}>
                      <BatteryCharging size={20} /> <span className="rcpit-action-title">Battery swap</span>
                    </button>
                  )}
                  {settings.showDriverBtn && (
                    <button className="rcpit-btn rcpit-btn-swap rcpit-action-btn" onClick={doDriverSwap} disabled={queueIds.length < 2}>
                      <ArrowLeftRight size={20} /> <span className="rcpit-action-title">Driver swap</span>
                    </button>
                  )}
                  {settings.showCombinedBtn && (
                    <button className="rcpit-btn rcpit-btn-swap rcpit-action-btn" onClick={doCombinedSwap} disabled={!currentDriver}>
                      <Repeat size={20} /> <span className="rcpit-action-title">Battery + driver</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="rcpit-col">
              <div className="rcpit-card">
                <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Activity tracker</p>
                <div className="rcpit-queue-list">
                  {activityRows.map((r) => (
                    <div key={r.id} className={`rcpit-queue-item ${r.role === "Drive" ? "current" : ""}`}>
                      <span className="rcpit-queue-name">{r.name}</span>
                      <span className={`rcpit-role-tag rcpit-role-${r.role}`}>{r.role}</span>
                    </div>
                  ))}
                  {activityRows.length === 0 && <p className="rcpit-empty">Add drivers on the Team tab to populate the tracker.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "team" && (
          <div className="rcpit-grid">
            <div className="rcpit-col">
              <div className="rcpit-card">
                <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Driver load</p>
                {driverLoad.length === 0 ? <p className="rcpit-empty">No drivers yet.</p> : driverLoad.map((r) => (
                  <div key={r.id} className="rcpit-load-row">
                    <span className="rcpit-load-name">{r.name}</span>
                    <div className="rcpit-load-bar-track"><div className="rcpit-load-bar-fill" style={{ width: `${(r.ms / maxLoadMs) * 100}%` }} /></div>
                    <span className="rcpit-load-time">{formatClock(r.ms)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rcpit-col">
              <div className="rcpit-card">
                <div className="rcpit-card-head"><p className="rcpit-label">Driver queue</p></div>
                <div className="rcpit-add-row">
                  <input className="rcpit-text-input" placeholder="Driver name" value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDriver()} />
                  <button className="rcpit-btn rcpit-btn-swap rcpit-btn-sm" onClick={addDriver}><UserPlus size={16} /> Add</button>
                </div>
                {queueIds.length === 0 ? <p className="rcpit-empty">Add drivers to build your queue.</p> : (
                  <div className="rcpit-queue-list">
                    {queueIds.map((id, index) => {
                      const d = drivers.find((dr) => dr.id === id);
                      if (!d) return null;
                      const isCurrent = index === 0;
                      const isEditing = editingId === id;
                      const role = ROLE_CYCLE[index % ROLE_CYCLE.length];
                      return (
                        <div key={id} className={`rcpit-queue-item ${isCurrent ? "current" : ""}`}>
                          <span className="rcpit-queue-pos">{isCurrent ? <BatteryCharging size={14} /> : index + 1}</span>
                          {isEditing ? (
                            <div className="rcpit-edit-row">
                              <input className="rcpit-text-input" value={editingName} autoFocus onChange={(e) => setEditingName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                              <button className="rcpit-tiny-btn" onClick={saveEdit} aria-label="Save name"><Check size={15} /></button>
                              <button className="rcpit-tiny-btn" onClick={() => setEditingId(null)} aria-label="Cancel edit"><X size={15} /></button>
                            </div>
                          ) : (
                            <>
                              <span className="rcpit-queue-name">{d.name}</span>
                              <span className={`rcpit-role-tag rcpit-role-${role}`}>{role}</span>
                              <div className="rcpit-queue-actions">
                                <button className="rcpit-tiny-btn" onClick={() => moveInQueue(index, -1)} disabled={index === 0} aria-label="Move up"><ChevronUp size={15} /></button>
                                <button className="rcpit-tiny-btn" onClick={() => moveInQueue(index, 1)} disabled={index === queueIds.length - 1} aria-label="Move down"><ChevronDown size={15} /></button>
                                <button className="rcpit-tiny-btn" onClick={() => startEdit(d)} aria-label="Rename driver"><Pencil size={15} /></button>
                                <button className="rcpit-tiny-btn" onClick={() => removeDriver(id)} aria-label="Remove driver"><Trash2 size={15} /></button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "analysis" && (
          <div className="rcpit-col">
            <div className="rcpit-card">
              <div className="rcpit-card-head">
                <p className="rcpit-label">Driver pace comparison</p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="rcpit-btn rcpit-btn-sm" onClick={exportExcel}><FileSpreadsheet size={14} /> Export Excel</button>
                  <button className="rcpit-btn rcpit-btn-sm" onClick={exportSheetsCsv}><FileDown size={14} /> Export to Sheets (CSV)</button>
                </div>
              </div>
              {paceByDriver.length === 0 ? <p className="rcpit-empty">No completed stints yet — lap data appears here once a driver stint ends.</p> : (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={paceByDriver}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={36} />
                      <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-c)", fontSize: "0.78rem" }} />
                      <Bar dataKey="avgLap" fill="var(--blue)" name="Avg lap (s)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {recentStintLapChart.rows.length > 0 && (
                <div style={{ height: 240, marginTop: "1rem" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={recentStintLapChart.rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-c)" />
                      <XAxis dataKey="lap" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={36} />
                      <Tooltip contentStyle={{ background: "var(--surface-raised)", border: "1px solid var(--border-c)", fontSize: "0.78rem" }} />
                      <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
                      {recentStintLapChart.drivers.map((name, i) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={chartLineColors[i % chartLineColors.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rcpit-card">
              <div className="rcpit-card-head">
                <p className="rcpit-label">Stint history</p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <select className="rcpit-select" value={historyFilterDriver} onChange={(e) => setHistoryFilterDriver(e.target.value)}>
                    <option value="all">All drivers</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <input className="rcpit-select" type="date" value={historyFilterDate} onChange={(e) => setHistoryFilterDate(e.target.value)} />
                </div>
              </div>
              {filteredHistory.length === 0 ? <p className="rcpit-empty">No stints logged yet.</p> : (
                <div className="rcpit-table-wrap">
                  <table className="rcpit-table">
                    <thead><tr><th>Driver</th><th>Total time</th><th>Laps</th><th>Avg lap</th><th>Note</th><th>Date</th></tr></thead>
                    <tbody>
                      {filteredHistory.map((s) => (
                        <tr key={s.id}>
                          <td>{s.driver}</td>
                          <td>{formatClock(s.totalMs)}</td>
                          <td>{s.lapCount}</td>
                          <td>{s.lapCount ? formatSec(s.laps.reduce((a, l) => a + l.ms, 0) / s.lapCount) : "—"}</td>
                          <td>{s.note}</td>
                          <td>{new Date(s.wallClock).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Rotation and pit log</p>
              {pitLog.length === 0 ? <p className="rcpit-empty">Swaps will show up here.</p> : (
                <div className="rcpit-table-wrap">
                  <table className="rcpit-table">
                    <thead><tr><th>Race time</th><th>Type</th><th>Details</th><th>Timestamp</th></tr></thead>
                    <tbody>
                      {pitLog.map((p) => (
                        <tr key={p.id}>
                          <td>{formatClock(p.t, true)}</td>
                          <td style={{ textTransform: "capitalize" }}>{p.type}</td>
                          <td>{p.text}</td>
                          <td>{new Date(p.wallClock).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "strategy" && (
          <div className="rcpit-col">
            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Optimal strategy simulator</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.7rem" }}>
                <div className="rcpit-setting" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
                  <label>Race duration (min)</label>
                  <input className="rcpit-mini-input" style={{ width: "100%" }} type="number" min="1" value={sim.raceDurationMin} onChange={(e) => setSim((s) => ({ ...s, raceDurationMin: Number(e.target.value) || 0 }))} />
                </div>
                <div className="rcpit-setting" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
                  <label>Lap time (sec)</label>
                  <input className="rcpit-mini-input" style={{ width: "100%" }} type="number" min="1" value={sim.lapTimeSec} onChange={(e) => setSim((s) => ({ ...s, lapTimeSec: Number(e.target.value) || 0 }))} />
                </div>
                <div className="rcpit-setting" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
                  <label>Battery endurance (min)</label>
                  <input className="rcpit-mini-input" style={{ width: "100%" }} type="number" min="0.5" step="0.5" value={sim.batteryEnduranceMin} onChange={(e) => setSim((s) => ({ ...s, batteryEnduranceMin: Number(e.target.value) || 0 }))} />
                </div>
                <div className="rcpit-setting" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.3rem" }}>
                  <label>Swap time (sec)</label>
                  <input className="rcpit-mini-input" style={{ width: "100%" }} type="number" min="0" value={sim.swapTimeSec} onChange={(e) => setSim((s) => ({ ...s, swapTimeSec: Number(e.target.value) || 0 }))} />
                </div>
              </div>

              <div className="rcpit-rec-box" style={{ marginTop: "1rem", borderLeftColor: "var(--green)" }}>
                <p className="rcpit-rec-title" style={{ color: "var(--green)" }}>Optimal plan</p>
                Run <b>{simCandidates.best.stintLen.toFixed(1)} min</b> stints — {simCandidates.best.numSwaps} swap{simCandidates.best.numSwaps === 1 ? "" : "s"} across the race, finishing an estimated <b>{simCandidates.best.laps}</b> laps.
              </div>

              <div className="rcpit-table-wrap">
                <table className="rcpit-sim-table">
                  <thead><tr><th>Stint length</th><th>Stints</th><th>Swaps</th><th>Pit time</th><th>Laps</th></tr></thead>
                  <tbody>
                    {simCandidates.rows.map((r) => (
                      <tr key={r.fraction} className={r === simCandidates.best ? "rcpit-sim-row-best" : ""}>
                        <td>{r.stintLen.toFixed(1)} min</td>
                        <td>{r.numStints}</td>
                        <td>{r.numSwaps}</td>
                        <td>{r.swapTimeMin.toFixed(1)} min</td>
                        <td>{r.laps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.7rem" }}>Recommendation</p>
              <div className="rcpit-rec-box">
                <p className="rcpit-rec-title">Live call</p>
                {Array.isArray(recommendation) ? recommendation.map((line, i) => <div key={i}>{line}</div>) : recommendation}
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="rcpit-col">
            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.4rem" }}>Stint-ending alert</p>
              <div className="rcpit-toggle-row">
                <div>
                  <div className="rcpit-toggle-label">Alert threshold</div>
                  <div className="rcpit-toggle-sub">Trigger this many seconds before the battery target runs out</div>
                </div>
                <input className="rcpit-mini-input" type="number" min="5" value={settings.alertThresholdSec} onChange={(e) => setSettings((s) => ({ ...s, alertThresholdSec: Number(e.target.value) || 5 }))} />
              </div>
              <div className="rcpit-toggle-row">
                <div>
                  <div className="rcpit-toggle-label">Audio alert</div>
                  <div className="rcpit-toggle-sub">Play a beep alongside the visual banner</div>
                </div>
                <div className={`rcpit-switch ${settings.audioEnabled ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, audioEnabled: !s.audioEnabled }))} role="switch" aria-checked={settings.audioEnabled}>
                  <div className="rcpit-switch-knob" />
                </div>
              </div>
            </div>

            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.4rem" }}>Pit action buttons</p>
              <div className="rcpit-toggle-row">
                <div className="rcpit-toggle-label">Show battery swap button</div>
                <div className={`rcpit-switch ${settings.showBatteryBtn ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, showBatteryBtn: !s.showBatteryBtn }))} role="switch" aria-checked={settings.showBatteryBtn}><div className="rcpit-switch-knob" /></div>
              </div>
              <div className="rcpit-toggle-row">
                <div className="rcpit-toggle-label">Show driver swap button</div>
                <div className={`rcpit-switch ${settings.showDriverBtn ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, showDriverBtn: !s.showDriverBtn }))} role="switch" aria-checked={settings.showDriverBtn}><div className="rcpit-switch-knob" /></div>
              </div>
              <div className="rcpit-toggle-row">
                <div className="rcpit-toggle-label">Show combined swap button</div>
                <div className={`rcpit-switch ${settings.showCombinedBtn ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, showCombinedBtn: !s.showCombinedBtn }))} role="switch" aria-checked={settings.showCombinedBtn}><div className="rcpit-switch-knob" /></div>
              </div>
            </div>

            <div className="rcpit-card">
              <p className="rcpit-label" style={{ marginBottom: "0.4rem" }}>Live results</p>
              <p className="rcpit-toggle-sub" style={{ marginBottom: "0.6rem" }}>
                Browser sandboxing means this app can't pull live data from rc-results.com automatically — the site doesn't allow cross-origin reads. Save the race URL here for quick access, and use the Log lap button on the Dashboard to record your team's times as you watch the feed.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <input className="rcpit-text-input" placeholder="rc-results.com race URL" value={settings.liveResultsUrl} onChange={(e) => setSettings((s) => ({ ...s, liveResultsUrl: e.target.value }))} />
                <input className="rcpit-text-input" placeholder="Your team's name as shown in results" value={settings.liveTeamName} onChange={(e) => setSettings((s) => ({ ...s, liveTeamName: e.target.value }))} />
                <button className="rcpit-btn rcpit-btn-sm" disabled={!settings.liveResultsUrl} onClick={() => window.open(settings.liveResultsUrl, "_blank")}>
                  <ExternalLink size={14} /> Open live results
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
