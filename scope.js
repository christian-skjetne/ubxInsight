(() => {
  "use strict";
  const BIN_COUNT = 256;
  const BLOCK_BYTES = 272;
  const MAX_MAP_TRACK_POINTS = 600;
  const WATERFALL_ROWS_PER_MINUTE = 60;
  const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000, 3000000, 4000000, 6000000, 8000000];
  const HISTORY_LENGTH = 600;
  const DARK_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
  const LIGHT_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  const SETTINGS_KEY = "ubx-scope-settings-v1";
  const OSNMA_CLOCK_SETTINGS_KEY = "ubx-scope-osnma-clock-v1";
  const DEFAULT_SETTINGS = { configureAllInterfaces: false, showAverage: true, averageFrames: 10, showPeak: true, peakDecay: 0.5, darkMap: false, waterfallMinutes: 10, waterfallMarkerMinutes: 5, lastReceiver: "f9p", baudByReceiver: { f9p: 115200, x20: 38400 } };
  const DEFAULT_OSNMA_CLOCK_SETTINGS = { useComputerClock: false, accuracySeconds: 1, showLocalTime: false };
  const SPECTRUM_MIN_DB = 0;
  const SPECTRUM_MAX_DB = 240;
  const PLOT_MARGIN = { left: 54, right: 14, top: 16, bottom: 72 };
  const BAND_MARKERS = [
    { frequency: 1575420000, label: "GPS L1", color: "#ffb347", level: 0 }, { frequency: 1227600000, label: "GPS L2", color: "#ffb347", level: 0 }, { frequency: 1176450000, label: "GPS L5", color: "#ffb347", level: 0 },
    { frequency: 1575420000, label: "GAL E1", color: "#66ff88", level: 1 }, { frequency: 1176450000, label: "GAL E5a", color: "#66ff88", level: 1 }, { frequency: 1207140000, label: "GAL E5b", color: "#66ff88", level: 1 }, { frequency: 1191795000, label: "GAL AltBOC", color: "#66ff88", level: 2 }, { frequency: 1278750000, label: "GAL E6", color: "#66ff88", level: 1 },
    { frequency: 1561098000, label: "BDS B1 I/Q", color: "#ff7262", level: 3 }, { frequency: 1575420000, label: "BDS B1 C/a", color: "#ff7262", level: 4 }, { frequency: 1176450000, label: "BDS B2a", color: "#ff7262", level: 3 }, { frequency: 1207140000, label: "BDS B2 I/Q", color: "#ff7262", level: 4 }, { frequency: 1268520000, label: "BDS B3", color: "#ff7262", level: 3 },
    { frequency: 1575420000, label: "QZSS L1", color: "#ffff66", level: 5 }, { frequency: 1227600000, label: "QZSS L2", color: "#ffff66", level: 5 }, { frequency: 1176450000, label: "QZSS L5", color: "#ffff66", level: 5 }, { frequency: 1278750000, label: "QZSS E6", color: "#ffff66", level: 5 },
    { frequency: 1600995000, label: "GLO L1", color: "#f27bfd", level: 1 }, { frequency: 1248060000, label: "GLO L2", color: "#f27bfd", level: 1 }, { frequency: 1202025000, label: "GLO L3", color: "#f27bfd", level: 1 }, { frequency: 1621250000, label: "IRIDIUM", color: "#f27bfd", level: 2 }, { frequency: 1626250000, label: "IRIDIUM STL", color: "#f27bfd", level: 0 },
  ];
  const OSNMA_STATUS_LABELS = {
    nma: ["Service not authenticated", "Service in test", "Operational", "Invalid; unusable"],
    cpks: ["Not applicable", "Nominal", "New root key in progress", "Chain revoked", "Public key renewal", "Public key revoked", "Merkle tree renewal", "Alert; cryptographic data dropped"],
    timeSync: ["Not checked", "Trusted time unavailable", "Trusted time not accurate enough", "Check passed", "Failed; replay attack detected"],
    headerAuth: ["Not authenticated", "Authenticated"],
    dsm: ["No DSM authentication", "DSM-KROOT authenticated; configuration accepted", "DSM-PKR authenticated; public key accepted", "Alert; cryptographic data dropped", "DSM-KROOT authentication failed", "DSM-PKR authentication failed", "Unknown public key", "Public key decompression failed", "Authenticated; configuration unsupported", "New key not authenticated; future Merkle root missing"],
    tesla: ["No TESLA key check", "TESLA key authenticated", "TESLA key authentication failed", "Authentication in progress", "Key is in the past; replay or simulation possible", "Root key too old"],
    timing: ["No timing authentication", "Timing parameters authenticated", "Timing authentication failed"],
    satelliteAuth: ["Navigation data authentication failed", "Navigation data authenticated"],
  };

  const output = document.querySelector("#blocks");
  const empty = document.querySelector("#empty");
  const status = document.querySelector("#status");
  const fixStatus = document.querySelector("#fix-status");
  const gpsTime = document.querySelector("#gps-time");
  const clockOffset = document.querySelector("#clock-offset");
  const latestPosition = document.querySelector("#latest-position");
  const altitudeStatus = document.querySelector("#altitude-status");
  const speedStatus = document.querySelector("#speed-status");
  const headingStatus = document.querySelector("#heading-status");
  const configurationStatus = document.querySelector("#configuration-status");
  const configurationTooltip = configurationStatus.querySelector(".configuration-tooltip");
  const connectButton = document.querySelector("#connect");
  const configureButton = document.querySelector("#configure");
  const recordButton = document.querySelector("#record");
  const replayButton = document.querySelector("#replay");
  const showPlaybackButton = document.querySelector("#show-playback");
  const settingsButton = document.querySelector("#settings");
  const settingsDialog = document.querySelector("#settings-dialog");
  const settingsForm = document.querySelector("#settings-form");
  const settingsClose = document.querySelector("#settings-close");
  const settingsReset = document.querySelector("#settings-reset");
  const playbackDialog = document.querySelector("#playback-dialog");
  const playbackHead = document.querySelector("#playback-head");
  const playbackCollapse = document.querySelector("#playback-collapse");
  const playbackClose = document.querySelector("#playback-close");
  const playbackFile = document.querySelector("#playback-file");
  const playbackScrubber = document.querySelector("#playback-scrubber");
  const playbackPosition = document.querySelector("#playback-position");
  const playbackTotal = document.querySelector("#playback-total");
  const playbackToggle = document.querySelector("#playback-toggle");
  const playbackEnd = document.querySelector("#playback-end");
  const playbackSpeed = document.querySelector("#playback-speed");
  const spectrumTab = document.querySelector("#spectrum-tab");
  const positionTab = document.querySelector("#position-tab");
  const signalsTab = document.querySelector("#signals-tab");
  const osnmaTab = document.querySelector("#osnma-tab");
  const spectrumPanel = document.querySelector("#spectrum-panel");
  const positionPanel = document.querySelector("#position-panel");
  const signalsPanel = document.querySelector("#signals-panel");
  const osnmaPanel = document.querySelector("#osnma-panel");
  const osnmaInputStatus = document.querySelector("#osnma-input-status");
  const osnmaTimeStatus = document.querySelector("#osnma-time-status");
  const osnmaFrameCount = document.querySelector("#osnma-frame-count");
  const osnmaFrameRows = document.querySelector("#osnma-frame-rows");
  const osnmaAuthStatus = document.querySelector("#osnma-auth-status");
  const osnmaReceiverStatus = document.querySelector("#osnma-receiver-status");
  const osnmaLastUpdate = document.querySelector("#osnma-last-update");
  const osnmaServiceState = document.querySelector("#osnma-service-state");
  const osnmaTimeSyncState = document.querySelector("#osnma-time-sync-state");
  const osnmaTimeDelta = document.querySelector("#osnma-time-delta");
  const osnmaHeaderAuth = document.querySelector("#osnma-header-auth");
  const osnmaDsmAuth = document.querySelector("#osnma-dsm-auth");
  const osnmaTeslaAuth = document.querySelector("#osnma-tesla-auth");
  const osnmaTimingAuth = document.querySelector("#osnma-timing-auth");
  const osnmaAuthSatelliteCount = document.querySelector("#osnma-auth-satellite-count");
  const osnmaSatelliteRows = document.querySelector("#osnma-satellite-rows");
  const osnmaTrustStatus = document.querySelector("#osnma-trust-status");
  const osnmaProvisionButton = document.querySelector("#osnma-provision");
  const osnmaFolderPicker = document.querySelector("#osnma-folder-picker");
  const osnmaProvisionStatus = document.querySelector("#osnma-provision-status");
  const osnmaTrustComputerClock = document.querySelector("#osnma-trust-computer-clock");
  const osnmaClockAccuracy = document.querySelector("#osnma-clock-accuracy");
  const osnmaSendTrustedTime = document.querySelector("#osnma-send-trusted-time");
  const osnmaTrustedTimeStatus = document.querySelector("#osnma-trusted-time-status");
  const osnmaUpdateLocalTime = document.querySelector("#osnma-update-local-time");
  const osnmaLocalTime = document.querySelector("#osnma-local-time");
  const osnmaClockValue = document.querySelector("#osnma-clock-value");
  const osnmaClockAge = document.querySelector("#osnma-clock-age");
  const osnmaClockPvt = document.querySelector("#osnma-clock-pvt");
  const osnmaClockTimeUtc = document.querySelector("#osnma-clock-timeutc");
  const osnmaClockAuth = document.querySelector("#osnma-clock-auth");
  const osnmaClockLocalTime = document.querySelector("#osnma-clock-local-time");
  let appClockOffsetMs = 0;
  let latestReceiverUtc = null;
  let latestPvtClock = null;
  let latestTimeUtcClock = null;
  let liveConnectionId = 0;
  let trustedClockSample = null;
  let trustedClockUpdatePending = false;
  const positionEmpty = document.querySelector("#position-empty");
  const positionTrack = document.querySelector("#position-track");
  const positionRecenter = document.querySelector("#position-recenter");
  const positionZoomIn = document.querySelector("#position-zoom-in");
  const positionZoomOut = document.querySelector("#position-zoom-out");
  const positionInfo = document.querySelector("#position-info");
  const signalsEmpty = document.querySelector("#signals-empty");
  const constellationFilter = document.querySelector("#constellation-filter");
  const gnssThreatIndicators = [...document.querySelectorAll("#gnss-threat-summary .gnss-threat-indicator")];
  const signalCharts = { cno: document.querySelector("#cno-chart"), doppler: document.querySelector("#doppler-chart"), jamState: document.querySelector("#jam-state-chart"), jamIndex: document.querySelector("#jam-index-chart"), agc: document.querySelector("#agc-chart"), spoof: document.querySelector("#spoof-chart"), secState: document.querySelector("#sec-state-chart"), secFrequency: document.querySelector("#sec-frequency-chart") };
  const secSecuritySummary = document.querySelector("#sec-security-summary");
  const secEventLog = document.querySelector("#sec-event-log");
  const showAverage = document.querySelector("#show-average");
  const averageFrames = document.querySelector("#average-frames");
  const showPeak = document.querySelector("#show-peak");
  const peakDecay = document.querySelector("#peak-decay");
  const darkMap = document.querySelector("#dark-map");
  const receiverBaud = document.querySelector("#receiver-baud");
  const configureAllInterfaces = document.querySelector("#configure-all-interfaces");
  const receiverInterface = document.querySelector("#receiver-interface");
  let pendingInterfacePoll = null;
  const waterfallMinutes = document.querySelector("#waterfall-minutes");
  const waterfallMarkerMinutes = document.querySelector("#waterfall-marker-minutes");
  const receiver = document.querySelector("#receiver");
  const baud = document.querySelector("#baud");
  let port = null;
  let reader = null;
  let writer = null;
  let reading = false;
  let recordingActive = false;
  let recordingChunks = null;
  let recordingName = null;
  let replayData = null;
  let replayName = "";
  let replayOffset = 0;
  let replayPlaying = false;
  let replayAnimationFrame = null;
  let replayLastTimestamp = null;
  let replayByteBudget = 0;
  let replayFrames = [];
  let replaySeekAnimationFrame = null;
  let replayRebuilding = false;
  let playbackDrag = null;
  let secSigPollTimer = null;
  const osnmaFrames = new Map();
  let osnmaE1bFrameCount = 0;
  let osnmaGalileoTime = null;
  let latestOsnmaStatus = null;
  let latestOsnmaTimeCheck = null;
  const osnmaSatelliteResults = new Map();
  const retainedOsnmaCodes = { headerAuth: null, dsm: null, tesla: null, timing: null };
  const pendingMgaAcks = [];
  const pendingConfigAcks = [];
  let receiveBuffer = new Uint8Array(0);
  let blockViews = [];
  let viewDrawQueued = false;
  const viewsPendingDraw = new Set();
  let settings = loadSettings();
  let osnmaClockSettings = loadOsnmaClockSettings();
  let positionFixes = [];
  let positionMap = null;
  let mapLibreMap = null;
  let mapTiles = null;
  let mapTrack = null;
  let mapTrackSegments = [];
  let mapMarker = null;
  let positionView = null;
  let positionDrag = null;
  const receiverThreat = { monRfJam: null, navSpoof: null, secJam: null, secSpoof: null, secJamEnabled: null, secSpoofEnabled: null };
  const signalHistory = { cno: new Map(), doppler: new Map(), jamState: [], jamIndex: [], agc: [], pga: [], spoof: [], secJam: [], secSpoof: [], secFrequency: [] };
  const secEvents = [];
  let secSigFramesReceived = 0;
  let secSigRawFramesReceived = 0;
  const latestPga = [];
  let signalEpoch = { cno: 0, doppler: 0, monRf: 0, pga: 0, spoof: 0, sec: 0 };
  const activeConstellations = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  const signalHover = new WeakMap();
  const signalHoverPinned = new WeakSet();
  const signalChartState = new WeakMap();

  const setStatus = (message) => { status.textContent = message; };
  const receiverBlockCount = () => receiver.value === "x20" ? 3 : 2;
  const formatHz = (value) => value >= 1e9 ? `${(value / 1e9).toFixed(6)} GHz` : `${(value / 1e6).toFixed(3)} MHz`;
  const plotBox = (width, height) => { const dpr = window.devicePixelRatio || 1; return { x: PLOT_MARGIN.left * dpr, y: PLOT_MARGIN.top * dpr, width: width - (PLOT_MARGIN.left + PLOT_MARGIN.right) * dpr, height: height - (PLOT_MARGIN.top + PLOT_MARGIN.bottom) * dpr }; };

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (!saved || typeof saved !== "object") return { ...DEFAULT_SETTINGS };
      const baudByReceiver = { ...DEFAULT_SETTINGS.baudByReceiver, ...(saved.baudByReceiver || {}) };
      for (const receiverName of Object.keys(baudByReceiver)) baudByReceiver[receiverName] = Number(baudByReceiver[receiverName]) || DEFAULT_SETTINGS.baudByReceiver[receiverName];
      return { configureAllInterfaces: saved.configureAllInterfaces === true, showAverage: typeof saved.showAverage === "boolean" ? saved.showAverage : DEFAULT_SETTINGS.showAverage, averageFrames: Math.max(1, Math.min(120, Number(saved.averageFrames) || DEFAULT_SETTINGS.averageFrames)), showPeak: typeof saved.showPeak === "boolean" ? saved.showPeak : DEFAULT_SETTINGS.showPeak, peakDecay: Math.max(0, Math.min(30, Number(saved.peakDecay) || 0)), darkMap: typeof saved.darkMap === "boolean" ? saved.darkMap : DEFAULT_SETTINGS.darkMap, waterfallMinutes: Math.max(5, Math.min(30, Number(saved.waterfallMinutes) || DEFAULT_SETTINGS.waterfallMinutes)), waterfallMarkerMinutes: Math.max(1, Math.min(10, Number(saved.waterfallMarkerMinutes) || DEFAULT_SETTINGS.waterfallMarkerMinutes)), lastReceiver: saved.lastReceiver === "x20" ? "x20" : "f9p", baudByReceiver };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function loadOsnmaClockSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(OSNMA_CLOCK_SETTINGS_KEY));
      const accuracy = Number(saved?.accuracySeconds);
      return { useComputerClock: saved?.useComputerClock === true, accuracySeconds: Number.isFinite(accuracy) && accuracy >= 1 ? Math.min(60, Math.round(accuracy)) : DEFAULT_OSNMA_CLOCK_SETTINGS.accuracySeconds, showLocalTime: saved?.showLocalTime === true };
    } catch { return { ...DEFAULT_OSNMA_CLOCK_SETTINGS }; }
  }

  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session-only settings when storage is unavailable. */ } }
  function saveOsnmaClockSettings() { try { localStorage.setItem(OSNMA_CLOCK_SETTINGS_KEY, JSON.stringify(osnmaClockSettings)); } catch { /* Session-only OSNMA time setting when storage is unavailable. */ } }
  function syncOsnmaClockForm() { osnmaTrustComputerClock.checked = osnmaClockSettings.useComputerClock; osnmaClockAccuracy.value = String(osnmaClockSettings.accuracySeconds); osnmaClockAccuracy.disabled = !osnmaClockSettings.useComputerClock; osnmaClockLocalTime.checked = osnmaClockSettings.showLocalTime; }
  function updateOsnmaClockSettings() {
    osnmaClockSettings.useComputerClock = osnmaTrustComputerClock.checked;
    const value = Number(osnmaClockAccuracy.value);
    osnmaClockSettings.accuracySeconds = Number.isFinite(value) ? Math.max(1, Math.min(60, Math.round(value))) : DEFAULT_OSNMA_CLOCK_SETTINGS.accuracySeconds;
    osnmaClockSettings.showLocalTime = osnmaClockLocalTime.checked;
    syncOsnmaClockForm(); saveOsnmaClockSettings(); refreshLocalClock();
    refreshOsnmaClock();
  }
  function syncReceiverBaud() { baud.value = String(settings.baudByReceiver[receiver.value] || DEFAULT_SETTINGS.baudByReceiver[receiver.value]); }
  function syncSettingsForm() { configureAllInterfaces.checked = settings.configureAllInterfaces; showAverage.checked = settings.showAverage; averageFrames.value = settings.averageFrames; showPeak.checked = settings.showPeak; peakDecay.value = settings.peakDecay; darkMap.checked = settings.darkMap; receiverBaud.value = String(settings.baudByReceiver[receiver.value] || DEFAULT_SETTINGS.baudByReceiver[receiver.value]); waterfallMinutes.value = settings.waterfallMinutes; waterfallMarkerMinutes.value = settings.waterfallMarkerMinutes; }
  function resetTraceBuffers() { blockViews.forEach((view) => { view.averageHistory = []; view.peak = null; }); }
  function resetWaterfallHistory() {
    blockViews.forEach((view) => {
      view.rows.fill(0); view.timestamps.fill(0); view.row = 0; view.filledRows = 0; view.hasRows = false; view.waterfallFrame = 0;
      view.timestampMarkers = []; view.lastMarkerSlot = null; view.frame = null; view.averageHistory = []; view.peak = null;
      view.waterfallCursor = null; view.hoverBin = null; view.hoverPinned = false;
      view.meta.textContent = "Awaiting MON-SPAN";
      for (const canvas of [view.spectrum, view.waterfall]) {
        const { width, height } = sizeCanvas(canvas); const context = canvas.getContext("2d");
        context.clearRect(0, 0, width, height); context.fillStyle = "#090c12"; context.fillRect(0, 0, width, height);
      }
    });
  }
  function resetReplayDerivedViews(removeMaps = true) {
    resetLocalClock();
    resetWaterfallHistory(); positionFixes = []; positionView = null; positionDrag = null; positionEmpty.hidden = false; positionInfo.textContent = "No position data.";
    positionRecenter.disabled = true; positionZoomIn.disabled = true; positionZoomOut.disabled = true;
    if (removeMaps) {
      if (positionMap) positionMap.remove(); if (mapLibreMap) mapLibreMap.remove();
      positionMap = null; mapLibreMap = null; mapTiles = null; mapTrack = null; mapTrackSegments = []; mapMarker = null;
    } else {
      if (mapTrack) mapTrack.clearLayers(); mapTrackSegments = [];
      if (positionMap && mapMarker) positionMap.removeLayer(mapMarker); mapMarker = null;
      if (mapLibreMap?.isStyleLoaded()) {
        mapLibreMap.getSource("track")?.setData(vectorTrackData()); mapLibreMap.getSource("track-vertices")?.setData(vectorTrackVertices()); mapLibreMap.getSource("latest-fix")?.setData(latestFixData());
      }
    }
    for (const history of Object.values(signalHistory)) history instanceof Map ? history.clear() : history.length = 0;
    secEvents.length = 0; latestPga.length = 0; secSigFramesReceived = 0; secSigRawFramesReceived = 0;
    osnmaFrames.clear(); osnmaE1bFrameCount = 0; osnmaGalileoTime = null; latestOsnmaStatus = null; latestOsnmaTimeCheck = null; osnmaSatelliteResults.clear(); Object.keys(retainedOsnmaCodes).forEach((key) => { retainedOsnmaCodes[key] = null; }); osnmaTrustStatus.textContent = "Not loaded"; osnmaAuthStatus.textContent = "Not verified"; renderOsnma();
    signalEpoch = { cno: 0, doppler: 0, monRf: 0, pga: 0, spoof: 0, sec: 0 }; Object.assign(receiverThreat, { monRfJam: null, navSpoof: null, secJam: null, secSpoof: null, secJamEnabled: null, secSpoofEnabled: null });
    signalsEmpty.hidden = false; secSecuritySummary.innerHTML = "<strong>SEC-SIG:</strong> awaiting X20 security data."; secEventLog.innerHTML = "<strong>SEC-SIGLOG:</strong> no events.";
    Object.values(signalCharts).forEach((canvas) => {
      signalHover.delete(canvas); signalHoverPinned.delete(canvas);
      if (!inspectionDisabledCharts.has(canvas)) canvas.closest(".signal-plot").querySelector(".chart-inspect").textContent = "Move cursor over chart to inspect values.";
    });
    drawSignals();
    const { width: trackWidth, height: trackHeight } = sizeCanvas(positionTrack); const trackContext = positionTrack.getContext("2d"); trackContext.fillStyle = "#090c12"; trackContext.fillRect(0, 0, trackWidth, trackHeight);
    fixStatus.className = "status-item status-no-data"; fixStatus.textContent = "Fix: no data"; gpsTime.textContent = "GPS UTC: --"; clockOffset.textContent = "NTP/local clock offset: --";
    latestPosition.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">location_on</span>--'; altitudeStatus.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">terrain</span>--'; speedStatus.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">speed</span>--'; headingStatus.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">navigation</span>--';
  }

  function createBlock(index) {
    const section = document.createElement("section");
    section.className = "block";
    section.innerHTML = `<div class="block-head"><h2>RF Block ${index + 1}</h2><span class="meta">Awaiting MON-SPAN</span><div class="graph-export-actions"></div></div><div class="inspect-strip"><span class="inspect">Move cursor over spectrum</span></div><canvas class="spectrum"></canvas><canvas class="waterfall"></canvas>`;
    output.append(section);
    const spectrum = section.querySelector(".spectrum");
    spectrum.id = `rf-block-${index + 1}-spectrum`;
    const rowCount = settings.waterfallMinutes * WATERFALL_ROWS_PER_MINUTE;
    const waterfall = section.querySelector(".waterfall");
    waterfall.id = `rf-block-${index + 1}-waterfall`;
    const exportActions = section.querySelector(".graph-export-actions");
    waterfall.style.height = `${settings.waterfallMinutes * 80}px`;
    const view = { section, spectrum, waterfall, meta: section.querySelector(".meta"), inspect: section.querySelector(".inspect"), rows: new Uint8Array(rowCount * BIN_COUNT), timestamps: new Float64Array(rowCount), rowCount, row: 0, filledRows: 0, hasRows: false, waterfallFrame: 0, timestampMarkers: [], lastMarkerSlot: null, frame: null, averageHistory: [], peak: null, hoverBin: null, hoverPinned: false, waterfallCursor: null };
    exportActions.append(createCanvasExportButton(spectrum, `RF block ${index + 1} spectrum`, () => view.hoverBin !== null ? `Cursor: ${view.inspect.textContent}` : ""));
    exportActions.append(createCanvasExportButton(waterfall, `RF block ${index + 1} waterfall`, () => {
      const details = waterfallCursorDetails(view);
      return details ? `Cursor time: ${details.label}` : "";
    }));
    spectrum.addEventListener("pointermove", (event) => updateHover(view, event));
    spectrum.addEventListener("pointerleave", () => { if (!view.hoverPinned) clearSpectrumCursor(view); });
    spectrum.addEventListener("click", (event) => { if (event.button === 0) pinSpectrumCursor(view, event); });
    spectrum.addEventListener("contextmenu", (event) => { event.preventDefault(); clearSpectrumCursor(view); });
    waterfall.addEventListener("pointermove", (event) => updateWaterfallHover(view, event));
    waterfall.addEventListener("pointerleave", () => { if (!view.waterfallCursor?.pinned) clearWaterfallCursor(view); });
    waterfall.addEventListener("click", (event) => { if (event.button === 0) pinWaterfallCursor(view, event); });
    waterfall.addEventListener("contextmenu", (event) => { event.preventDefault(); clearWaterfallCursor(view); });
    new ResizeObserver(() => draw(view)).observe(section);
    return view;
  }

  function buildBlocks(count) { output.replaceChildren(); blockViews = Array.from({ length: count }, (_, index) => createBlock(index)); empty.hidden = true; }
  function sizeCanvas(canvas) { const dpr = window.devicePixelRatio || 1; const width = Math.max(1, Math.round(canvas.clientWidth * dpr)); const height = Math.max(1, Math.round(canvas.clientHeight * dpr)); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } return { width, height }; }

  function canvasPngFilename(name, timestamp = new Date()) {
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const date = timestamp.toISOString().replace(/[:.]/g, "-");
    return `${safeName}-${date}.png`;
  }

  function downloadCanvasPng(canvas, name, cursorInfo = null) {
    const detail = cursorInfo?.().trim() || "";
    const dpr = window.devicePixelRatio || 1;
    const exportCanvas = document.createElement("canvas");
    const footerHeight = (detail ? 44 : 30) * dpr;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + footerHeight;
    const context = exportCanvas.getContext("2d");
    context.fillStyle = "#090c12"; context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(canvas, 0, 0);
    context.fillStyle = "#e5e9f0"; context.font = `${12 * dpr}px "Segoe UI", sans-serif`;
    context.textAlign = "left"; context.textBaseline = "top";
    context.fillText(name, 12 * dpr, canvas.height + 5 * dpr, exportCanvas.width - 24 * dpr);
    if (detail) {
      context.fillStyle = "#9ba8bc"; context.font = `${11 * dpr}px "Segoe UI", sans-serif`;
      context.fillText(detail, 12 * dpr, canvas.height + 22 * dpr, exportCanvas.width - 24 * dpr);
    }
    exportCanvas.toBlob((blob) => {
      if (!blob) { setStatus(`Could not export ${name} as PNG`); return; }
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = url; download.download = canvasPngFilename(name); download.hidden = true;
      document.body.append(download); download.click(); download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  function createCanvasExportButton(canvas, name, cursorInfo = null) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary graph-export-button";
    button.setAttribute("aria-label", `Save ${name} as PNG`); button.title = `Save ${name} as PNG`;
    const icon = document.createElement("span"); icon.className = "material-symbols-outlined"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "download";
    button.append(icon);
    button.addEventListener("click", () => downloadCanvasPng(canvas, name, cursorInfo));
    return button;
  }

  function palette(value) {
    const t = Math.max(0, Math.min(1, (value - 30) / 180));
    const stops = [[0, 0, 4], [31, 12, 72], [120, 28, 109], [220, 68, 57], [252, 190, 65], [252, 255, 164]];
    const position = t * (stops.length - 1); const lower = Math.floor(position); const upper = Math.min(stops.length - 1, lower + 1); const fraction = position - lower;
    return stops[lower].map((channel, index) => Math.round(channel + (stops[upper][index] - channel) * fraction));
  }

  function drawBandMarkers(context, frame, box, labelBaseline = null) {
    const start = frame.center - frame.span / 2; const end = frame.center + frame.span / 2; const dpr = window.devicePixelRatio || 1;
    context.save(); context.setLineDash([4 * dpr, 4 * dpr]); context.lineWidth = dpr; context.font = `${Math.max(10, Math.round(10 * dpr))}px "Segoe UI", sans-serif`; context.textAlign = "center";
    const markerGroups = new Map();
    BAND_MARKERS.forEach((marker) => {
      if (marker.frequency < start || marker.frequency > end) return;
      if (!markerGroups.has(marker.frequency)) markerGroups.set(marker.frequency, marker);
    });
    markerGroups.forEach((marker) => {
      const x = box.x + (marker.frequency - start) / frame.span * box.width;
      context.strokeStyle = marker.color; context.globalAlpha = 0.72; context.beginPath(); context.moveTo(x, box.y); context.lineTo(x, box.y + box.height); context.stroke();
    });
    if (labelBaseline !== null) drawBandLegend(context, frame, box, labelBaseline);
    context.restore();
  }

  function drawBandLegend(context, frame, box, baseline) {
    const dpr = window.devicePixelRatio || 1;
    const start = frame.center - frame.span / 2;
    const end = frame.center + frame.span / 2;
    const groups = new Map();
    const compactBandLabel = (label) => label
      .replace("QZSS", "QZ")
      .replace("GAL AltBOC", "GAL E5Alt")
      .replace("BDS B1 I/Q", "BDS B1")
      .replace("BDS B2 I/Q", "BDS B2");
    BAND_MARKERS.forEach((marker) => {
      if (marker.frequency < start || marker.frequency > end) return;
      const key = marker.frequency;
      if (!groups.has(key)) groups.set(key, { frequency: marker.frequency, color: marker.color, names: [] });
      const group = groups.get(key); const name = compactBandLabel(marker.label);
      if (!group.names.includes(name)) group.names.push(name);
    });
    const lanes = [[], [], [], []];
    context.font = `${Math.max(8, Math.round(8 * dpr))}px "Segoe UI", sans-serif`;
    [...groups.values()].sort((left, right) => left.frequency - right.frequency).forEach((group) => {
      const x = box.x + (group.frequency - start) / frame.span * box.width;
      const text = group.names.join("/");
      const halfWidth = context.measureText(text).width / 2 + 4 * dpr;
      const lane = lanes.find((items) => items.every((item) => Math.abs(item.x - x) > item.halfWidth + halfWidth)) || lanes[lanes.length - 1];
      lane.push({ x, text, color: group.color, halfWidth });
    });
    lanes.forEach((items, laneIndex) => items.forEach((item) => {
      context.fillStyle = item.color; context.textAlign = "center"; context.textBaseline = "top";
      context.fillText(item.text, item.x, baseline + laneIndex * 10 * dpr);
    }));
  }

  function drawSpectrumAxes(context, frame, box) {
    const dpr = window.devicePixelRatio || 1; const start = frame.center - frame.span / 2;
    context.save(); context.font = `${Math.round(11 * dpr)}px "Segoe UI", sans-serif`; context.fillStyle = "#9ba8bc"; context.strokeStyle = "#293447"; context.lineWidth = dpr; context.textAlign = "right"; context.textBaseline = "middle";
    for (let db = SPECTRUM_MIN_DB; db <= SPECTRUM_MAX_DB; db += 30) { const y = box.y + box.height - (db - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB) * box.height; context.beginPath(); context.moveTo(box.x, y); context.lineTo(box.x + box.width, y); context.stroke(); context.fillText(`${db}`, box.x - 7 * dpr, y); }
    context.textAlign = "center"; context.textBaseline = "top";
    for (let tick = 0; tick <= 4; tick++) { const x = box.x + tick / 4 * box.width; const frequency = start + tick / 4 * frame.span; context.strokeStyle = "#59677d"; context.beginPath(); context.moveTo(x, box.y + box.height); context.lineTo(x, box.y + box.height + 4 * dpr); context.stroke(); context.fillText(`${(frequency / 1e6).toFixed(1)}M`, x, box.y + box.height + 7 * dpr); }
    context.restore();
  }

  function drawSpectrum(view) {
    if (!view.frame) return;
    const { width, height } = sizeCanvas(view.spectrum); const context = view.spectrum.getContext("2d"); const box = plotBox(width, height); const dpr = window.devicePixelRatio || 1;
    context.clearRect(0, 0, width, height); context.fillStyle = "#090c12"; context.fillRect(0, 0, width, height); drawSpectrumAxes(context, view.frame, box);
    const drawTrace = (values, color, lineWidth) => { context.strokeStyle = color; context.lineWidth = lineWidth * dpr; context.beginPath(); values.forEach((value, index) => { const x = box.x + index / (BIN_COUNT - 1) * box.width; const y = box.y + box.height - Math.max(0, Math.min(1, (value - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB))) * box.height; index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke(); };
    if (settings.showPeak && view.peak) drawTrace(view.peak, "#ff6363", 1);
    if (settings.showAverage && view.frame.average) drawTrace(view.frame.average, "#ffe066", 1);
    drawTrace(view.frame.bins, "#68d8dd", 1.25);
    drawBandMarkers(context, view.frame, box, box.y + box.height + 30 * dpr);
    if (view.hoverBin !== null) {
      const x = box.x + view.hoverBin / (BIN_COUNT - 1) * box.width;
      context.save(); context.strokeStyle = "#ffffff"; context.globalAlpha = 0.8; context.setLineDash([3 * dpr, 3 * dpr]); context.lineWidth = dpr; context.beginPath(); context.moveTo(x, box.y); context.lineTo(x, box.y + box.height); context.stroke(); context.restore();
    }
  }

  function updateHover(view, event, force = false) {
    if (!view.frame) return;
    if (view.hoverPinned && !force) return;
    const bounds = view.spectrum.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; const box = plotBox(view.spectrum.width, view.spectrum.height); const x = (event.clientX - bounds.left) * dpr;
    if (x < box.x || x > box.x + box.width) { if (view.hoverBin !== null) { view.hoverBin = null; view.inspect.textContent = "Move cursor over spectrum"; drawSpectrum(view); } return false; }
    const bin = Math.max(0, Math.min(BIN_COUNT - 1, Math.round((x - box.x) / box.width * (BIN_COUNT - 1))));
    view.hoverBin = bin;
    const frequency = view.frame.center - view.frame.span / 2 + (bin + .5) / BIN_COUNT * view.frame.span;
    const average = view.frame.average ? ` | Avg ${view.frame.average[bin].toFixed(1)} dB` : "";
    const peak = view.peak ? ` | Peak ${view.peak[bin].toFixed(1)} dB` : "";
    view.inspect.textContent = `${formatHz(frequency)} | PSD ${view.frame.bins[bin]} dB${average}${peak}`;
    drawSpectrum(view);
    return true;
  }

  function pinSpectrumCursor(view, event) {
    view.hoverPinned = false;
    view.hoverPinned = updateHover(view, event, true) === true;
  }

  function clearSpectrumCursor(view) {
    view.hoverPinned = false;
    view.hoverBin = null;
    view.inspect.textContent = "Move cursor over spectrum";
    drawSpectrum(view);
  }

  function drawWaterfall(view) {
    if (!view.frame) return;
    const { width, height } = sizeCanvas(view.waterfall); const context = view.waterfall.getContext("2d"); const dpr = window.devicePixelRatio || 1;
    const box = { x: PLOT_MARGIN.left * dpr, y: 12 * dpr, width: width - (PLOT_MARGIN.left + PLOT_MARGIN.right) * dpr, height: height - 42 * dpr };
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#090c12";
    context.fillRect(0, 0, width, height);
    const image = context.createImageData(BIN_COUNT, view.rowCount);
    for (let destinationRow = 0; destinationRow < view.rowCount; destinationRow++) {
      const pixelRow = destinationRow * BIN_COUNT * 4;
      if (destinationRow >= view.filledRows) {
        for (let column = 0; column < BIN_COUNT; column++) image.data[pixelRow + column * 4 + 3] = 255;
        continue;
      }
      const sourceRow = (view.row - 1 - destinationRow + view.rowCount) % view.rowCount;
      for (let column = 0; column < BIN_COUNT; column++) {
        const [r, g, b] = palette(view.rows[sourceRow * BIN_COUNT + column]); const pixel = pixelRow + column * 4;
        image.data[pixel] = r; image.data[pixel + 1] = g; image.data[pixel + 2] = b; image.data[pixel + 3] = 255;
      }
    }
    const scratch = document.createElement("canvas"); scratch.width = BIN_COUNT; scratch.height = view.rowCount; scratch.getContext("2d").putImageData(image, 0, 0); context.imageSmoothingEnabled = false; context.drawImage(scratch, box.x, box.y, box.width, box.height);
    drawBandMarkers(context, view.frame, box);
    drawWaterfallAxes(context, view.frame, box);
    drawWaterfallTimestampMarkers(context, view, box);
    drawWaterfallCursor(context, view, box);
  }

  function waterfallCursorAt(view, clientX, clientY, boundsLeft, boundsTop, dpr, box) {
    const x = (clientX - boundsLeft) * dpr;
    const y = (clientY - boundsTop) * dpr;
    if (x < box.x || x >= box.x + box.width) return null;
    if (y < box.y || y >= box.y + box.height) return null;
    const age = Math.floor((y - box.y) / box.height * view.rowCount);
    if (age >= view.filledRows) return null;
    return view.waterfallFrame - 1 - age;
  }

  function waterfallCursorDetails(view) {
    if (!view.waterfallCursor) return null;
    const age = view.waterfallFrame - 1 - view.waterfallCursor.frame;
    if (age < 0 || age >= view.filledRows) return null;
    const row = (view.row - 1 - age + view.rowCount) % view.rowCount;
    const timestamp = view.timestamps[row];
    return { age, label: timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : `-${age}s` };
  }

  function drawWaterfallCursor(context, view, box) {
    const details = waterfallCursorDetails(view);
    if (!details) { view.waterfallCursor = null; return; }
    const dpr = window.devicePixelRatio || 1;
    const y = box.y + (details.age + 0.5) / view.rowCount * box.height;
    context.save();
    context.strokeStyle = "#ffffff"; context.fillStyle = "#ffffff"; context.globalAlpha = 0.9; context.lineWidth = dpr;
    context.setLineDash([3 * dpr, 3 * dpr]); context.beginPath(); context.moveTo(box.x, y); context.lineTo(box.x + box.width, y); context.stroke();
    context.setLineDash([]); context.font = `${11 * dpr}px "Segoe UI", sans-serif`; context.textAlign = "right"; context.textBaseline = "middle";
    context.fillText(details.label, box.x - 7 * dpr, y);
    context.restore();
  }

  function updateWaterfallHover(view, event, force = false) {
    if (!view.frame || (view.waterfallCursor?.pinned && !force)) return false;
    const { width, height } = sizeCanvas(view.waterfall); const dpr = window.devicePixelRatio || 1;
    const box = { x: PLOT_MARGIN.left * dpr, y: 12 * dpr, width: width - (PLOT_MARGIN.left + PLOT_MARGIN.right) * dpr, height: height - 42 * dpr };
    const bounds = view.waterfall.getBoundingClientRect();
    const frame = waterfallCursorAt(view, event.clientX, event.clientY, bounds.left, bounds.top, dpr, box);
    if (frame === null) {
      if (!view.waterfallCursor?.pinned || force) { view.waterfallCursor = null; drawWaterfall(view); }
      return false;
    }
    view.waterfallCursor = { frame, pinned: false };
    drawWaterfall(view);
    return true;
  }

  function pinWaterfallCursor(view, event) {
    if (updateWaterfallHover(view, event, true)) view.waterfallCursor.pinned = true;
  }

  function clearWaterfallCursor(view) {
    view.waterfallCursor = null;
    drawWaterfall(view);
  }

  function drawWaterfallAxes(context, frame, box) {
    const dpr = window.devicePixelRatio || 1;
    const start = frame.center - frame.span / 2;
    context.save(); context.font = `${11 * dpr}px "Segoe UI", sans-serif`; context.fillStyle = "#9ba8bc"; context.strokeStyle = "#59677d"; context.lineWidth = dpr;
    context.textAlign = "center"; context.textBaseline = "top";
    for (let tick = 0; tick <= 4; tick++) { const x = box.x + tick / 4 * box.width; const frequency = start + tick / 4 * frame.span; context.strokeStyle = "#59677d"; context.beginPath(); context.moveTo(x, box.y + box.height); context.lineTo(x, box.y + box.height + 4 * dpr); context.stroke(); context.fillText(`${(frequency / 1e6).toFixed(1)}M`, x, box.y + box.height + 7 * dpr); }
    context.restore();
  }

  function drawWaterfallTimestampMarkers(context, view, box) {
    const dpr = window.devicePixelRatio || 1;
    context.save(); context.font = `${11 * dpr}px "Segoe UI", sans-serif`; context.textBaseline = "bottom";
    view.timestampMarkers.forEach((marker) => {
      const age = view.waterfallFrame - 1 - marker.frame;
      if (age < 0 || age >= view.rowCount) return;
      const y = box.y + age / Math.max(1, view.rowCount - 1) * box.height;
      context.strokeStyle = "rgba(255, 255, 255, 0.8)"; context.setLineDash([4 * dpr, 4 * dpr]); context.lineWidth = dpr;
      context.beginPath(); context.moveTo(box.x, y); context.lineTo(box.x + box.width, y); context.stroke();
      context.setLineDash([]); context.fillStyle = "#ffffff"; context.textAlign = "right"; context.textBaseline = "middle"; context.fillText(marker.label, box.x - 7 * dpr, y);
    });
    context.restore();
  }

  function draw(view) { drawSpectrum(view); drawWaterfall(view); }
  function scheduleViewDraw(view) {
    viewsPendingDraw.add(view);
    if (viewDrawQueued) return;
    viewDrawQueued = true;
    requestAnimationFrame(() => {
      viewDrawQueued = false;
      viewsPendingDraw.forEach((pendingView) => draw(pendingView));
      viewsPendingDraw.clear();
    });
  }
  function checksum(bytes) { let a = 0; let b = 0; for (const byte of bytes) { a = (a + byte) & 0xff; b = (b + a) & 0xff; } return [a, b]; }

  function appendHistory(history, sample) { history.push(sample); if (history.length > HISTORY_LENGTH) history.shift(); }
  function appendSeries(map, key, epoch, value, color) {
    if (!map.has(key)) map.set(key, { label: key, color, values: [] });
    appendHistory(map.get(key).values, { epoch, value });
  }

  function drawSignalChart(canvas, series, options) {
    if (!canvas) return;
    const { width, height } = sizeCanvas(canvas); const context = canvas.getContext("2d"); const dpr = window.devicePixelRatio || 1;
    const margin = { left: 48 * dpr, right: 14 * dpr, top: 12 * dpr, bottom: 27 * dpr }; const box = { x: margin.left, y: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
    context.fillStyle = "#090c12"; context.fillRect(0, 0, width, height);
    let lastEpoch = -Infinity; let minValue = Infinity; let maxValue = -Infinity;
    let hasSamples = false; let hasValues = false;
    for (const item of series) {
      for (const sample of item.values) {
        hasSamples = true;
        lastEpoch = Math.max(lastEpoch, sample.epoch);
        if (!Number.isFinite(sample.value)) continue;
        hasValues = true;
        minValue = Math.min(minValue, sample.value);
        maxValue = Math.max(maxValue, sample.value);
      }
    }
    if (!hasSamples) return;
    const firstEpoch = lastEpoch - HISTORY_LENGTH + 1;
    signalChartState.set(canvas, { series, box, firstEpoch, lastEpoch });
    const min = options.min ?? (hasValues ? minValue : 0); const max = options.max ?? (hasValues ? maxValue : 1); const range = Math.max(max - min, 1);
    const yForValue = (value, axisMin = min, axisMax = max) => box.y + box.height - (value - axisMin) / Math.max(axisMax - axisMin, 1) * box.height;
    context.font = `${11 * dpr}px "Segoe UI", sans-serif`; context.fillStyle = "#9ba8bc"; context.strokeStyle = "#293447"; context.lineWidth = dpr; context.textAlign = "right"; context.textBaseline = "middle";
    const yTicks = options.yTicks || Array.from({ length: 5 }, (_, tick) => min + (4 - tick) / 4 * range);
    yTicks.forEach((value) => { const y = yForValue(value); context.beginPath(); context.moveTo(box.x, y); context.lineTo(box.x + box.width, y); context.stroke(); context.fillText(options.formatY ? options.formatY(value) : value.toFixed(0), box.x - 6 * dpr, y); });
    context.textAlign = "center"; context.textBaseline = "top";
    for (let tick = 0; tick <= 4; tick++) { const epoch = Math.round(firstEpoch + tick / 4 * (lastEpoch - firstEpoch)); const x = box.x + tick / 4 * box.width; context.fillText(epoch < 0 ? "n/a" : epoch, x, box.y + box.height + 6 * dpr); }
    context.save(); context.beginPath(); context.rect(box.x, box.y, box.width, box.height); context.clip();
    if (options.thresholds) { context.save(); context.setLineDash([4 * dpr, 4 * dpr]); options.thresholds.forEach((threshold) => { if (threshold.value < min || threshold.value > max) return; const y = yForValue(threshold.value); context.strokeStyle = threshold.color; context.beginPath(); context.moveTo(box.x, y); context.lineTo(box.x + box.width, y); context.stroke(); if (threshold.label) { context.setLineDash([]); context.globalAlpha = 0.9; context.fillStyle = threshold.color; context.font = `${9 * dpr}px "Segoe UI", sans-serif`; context.textAlign = "right"; context.textBaseline = "bottom"; context.fillText(threshold.label, box.x + box.width - 4 * dpr, y - 2 * dpr); context.setLineDash([4 * dpr, 4 * dpr]); } }); context.restore(); }
    series.forEach((item) => {
      if (!item.values.length) return;
      const itemMin = item.min ?? min; const itemMax = item.max ?? max;
      context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = 1.5 * dpr; context.beginPath();
      let hasSegment = false;
      item.values.forEach((sample) => {
        if (!Number.isFinite(sample.value)) { hasSegment = false; return; }
        const x = box.x + (sample.epoch - firstEpoch) / (lastEpoch - firstEpoch) * box.width; const y = yForValue(sample.value, itemMin, itemMax);
        if (options.points) { context.beginPath(); context.arc(x, y, 3 * dpr, 0, Math.PI * 2); context.fill(); }
        else { if (hasSegment) context.lineTo(x, y); else context.moveTo(x, y); hasSegment = true; }
      });
      if (!options.points && hasSegment) context.stroke();
    });
    const hoverEpoch = signalHover.get(canvas);
    if (hoverEpoch !== undefined) {
      const x = box.x + (hoverEpoch - firstEpoch) / (lastEpoch - firstEpoch) * box.width;
      context.save(); context.strokeStyle = "#ffffff"; context.globalAlpha = 0.8; context.setLineDash([3 * dpr, 3 * dpr]); context.lineWidth = dpr; context.beginPath(); context.moveTo(x, box.y); context.lineTo(x, box.y + box.height); context.stroke(); context.restore();
    }
    context.restore();
  }

  function updateSignalHover(canvas, event, force = false) {
    if (signalHoverPinned.has(canvas) && !force) return false;
    const state = signalChartState.get(canvas);
    if (!state || !state.series.length) return false;
    const bounds = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    const x = (event.clientX - bounds.left) * dpr;
    if (x < state.box.x || x > state.box.x + state.box.width) return false;
    const epoch = Math.round(state.firstEpoch + (x - state.box.x) / state.box.width * (state.lastEpoch - state.firstEpoch));
    signalHover.set(canvas, epoch);
    const readout = canvas.closest(".signal-plot").querySelector(".chart-inspect");
    const values = state.series.filter((item) => item.values.length).map((item) => {
      const sample = epoch < 0 ? undefined : item.values.find((candidate) => candidate.epoch === epoch);
      return `<span style="color:${item.color}">${item.label}: ${sample && Number.isFinite(sample.value) ? sample.value.toFixed(1) : "n/a"}</span>`;
    });
    readout.innerHTML = `Epoch ${epoch < 0 ? "n/a" : epoch} | ${values.join(" | ")}`;
    drawSignals();
    return true;
  }

  function clearSignalHover(canvas) {
    signalHover.delete(canvas);
    signalHoverPinned.delete(canvas);
    canvas.closest(".signal-plot").querySelector(".chart-inspect").textContent = "Move cursor over chart to inspect values.";
    drawSignals();
  }

  function drawSignals() {
    const selectedSeries = (history) => [...history.entries()].filter(([key]) => activeConstellations.has(Number(key.split(":")[0]))).map(([, series]) => series);
    const cnoSeries = selectedSeries(signalHistory.cno); const dopplerSeries = selectedSeries(signalHistory.doppler);
    const blockSeries = (history, colors) => history.map((values, index) => ({ label: `RF ${index + 1}`, color: colors[index % colors.length], values }));
    drawSignalChart(signalCharts.cno, cnoSeries, { min: 0, max: 55 });
    drawSignalChart(signalCharts.doppler, dopplerSeries, {});
    drawSignalChart(signalCharts.jamState, blockSeries(signalHistory.jamState, ["#ffff00", "#ff9d00", "#44ffaa"]), { min: 0, max: 3, yTicks: [0, 1, 2, 3], thresholds: [{ value: 1, color: "#44ff44" }, { value: 2, color: "#ffff44" }, { value: 3, color: "#ff4444" }] });
    drawSignalChart(signalCharts.jamIndex, blockSeries(signalHistory.jamIndex, ["#ffff00", "#ff9d00", "#44ffaa"]), { min: 0, max: 255 });
    const pgaSeries = blockSeries(signalHistory.pga, ["#ff66cc", "#ffaaaa", "#ccccff"]).map((series) => ({ ...series, min: 0, max: 55 }));
    drawSignalChart(signalCharts.agc, [...blockSeries(signalHistory.agc, ["#44ccff", "#88eeff", "#bbeddd"]), ...pgaSeries], { min: 0, max: 8191 });
    drawSignalChart(signalCharts.spoof, [{ label: "Spoof", color: "#00ffff", values: signalHistory.spoof }], { min: 0, max: 3, yTicks: [0, 1, 2, 3], thresholds: [{ value: 1, color: "#44ff44" }, { value: 2, color: "#ffff44" }, { value: 3, color: "#ff4444" }] });
    drawSignalChart(signalCharts.secState, [{ label: "Jamming", color: "#ffb347", values: signalHistory.secJam }, { label: "Spoofing", color: "#ff66cc", values: signalHistory.secSpoof }], { min: 0, max: 3, yTicks: [0, 1, 2, 3], points: true, thresholds: [{ value: 1, color: "#44ff44" }, { value: 2, color: "#ffff44" }, { value: 3, color: "#ff4444" }] });
    renderGnssThreatSummary();
    const frequencyGuides = [...BAND_MARKERS.reduce((groups, marker) => {
      if (!groups.has(marker.frequency)) groups.set(marker.frequency, { value: marker.frequency, color: marker.color, labels: [] });
      const group = groups.get(marker.frequency); const shortName = marker.label.replace("GPS ", "G ").replace("GAL ", "E ").replace("BDS ", "B ").replace("QZSS ", "Q ");
      if (!group.labels.includes(shortName)) group.labels.push(shortName);
      return groups;
    }, new Map()).values()].filter((guide) => guide.value >= 1150000000 && guide.value <= 1650000000).map((guide) => ({ ...guide, label: guide.labels.join("/") }));
    drawSignalChart(signalCharts.secFrequency, [{ label: "Jammed frequency", color: "#ff4444", values: signalHistory.secFrequency }], { min: 1150000000, max: 1650000000, formatY: (value) => `${(value / 1e6).toFixed(0)}M`, points: true, thresholds: frequencyGuides });
  }

  function gnssThreatPresentation(kind, value, enabled = true) {
    if (value === null) return { label: "Waiting", state: "waiting" };
    if (!enabled) return { label: "Detection off", state: "off" };
    const states = {
      monRfJam: [["Unknown", "waiting"], ["Normal", "good"], ["Warning", "warning"], ["Critical", "bad"]],
      navSpoof: [["Inactive", "off"], ["Normal", "good"], ["Indicated", "warning"], ["Multiple indications", "bad"]],
      secJam: [["Unknown", "waiting"], ["None", "good"], ["Warning", "warning"], ["Critical", "bad"]],
      secSpoof: [["Unknown", "waiting"], ["None", "good"], ["Indicated", "warning"], ["Affirmed", "bad"]],
    };
    return states[kind]?.[value] ? { label: states[kind][value][0], state: states[kind][value][1] } : { label: `Unknown (${value})`, state: "waiting" };
  }

  function renderGnssThreatSummary() {
    const statuses = [
      gnssThreatPresentation("monRfJam", receiverThreat.monRfJam),
      gnssThreatPresentation("navSpoof", receiverThreat.navSpoof),
      gnssThreatPresentation("secJam", receiverThreat.secJam, receiverThreat.secJamEnabled !== false),
      gnssThreatPresentation("secSpoof", receiverThreat.secSpoof, receiverThreat.secSpoofEnabled !== false),
    ];
    gnssThreatIndicators.forEach((indicator, index) => {
      indicator.dataset.state = statuses[index].state;
      indicator.querySelector("strong").textContent = statuses[index].label;
    });
  }

  const inspectionDisabledCharts = new Set([signalCharts.cno, signalCharts.doppler]);
  Object.values(signalCharts).forEach((canvas) => {
    const readout = document.createElement("span");
    readout.className = "chart-inspect";
    const inspectStrip = document.createElement("div");
    inspectStrip.className = "chart-inspect-strip";
    readout.textContent = inspectionDisabledCharts.has(canvas) ? "Cursor inspection disabled for multi-series view." : "Move cursor over chart to inspect values.";
    inspectStrip.append(readout);
    const plot = canvas.closest(".signal-plot");
    const header = plot.querySelector("header");
    const title = header.querySelector("h2").childNodes[0].textContent.trim();
    header.append(createCanvasExportButton(canvas, title, () => signalHover.has(canvas) ? `Cursor: ${plot.querySelector(".chart-inspect").textContent}` : ""));
    header.after(inspectStrip);
    if (inspectionDisabledCharts.has(canvas)) { canvas.classList.add("inspection-disabled"); return; }
    canvas.addEventListener("pointermove", (event) => updateSignalHover(canvas, event));
    canvas.addEventListener("pointerleave", () => { if (!signalHoverPinned.has(canvas)) clearSignalHover(canvas); });
    canvas.addEventListener("click", (event) => { if (event.button === 0 && updateSignalHover(canvas, event, true)) signalHoverPinned.add(canvas); });
    canvas.addEventListener("contextmenu", (event) => { event.preventDefault(); clearSignalHover(canvas); });
  });

  function latLonToUtm33(latitude, longitude) {
    const semiMajor = 6378137;
    const flattening = 1 / 298.257223563;
    const eccentricitySquared = flattening * (2 - flattening);
    const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared);
    const scale = 0.9996;
    const radians = Math.PI / 180;
    const latitudeRadians = latitude * radians;
    const longitudeRadians = longitude * radians;
    const centralMeridian = 15 * radians;
    const sine = Math.sin(latitudeRadians);
    const cosine = Math.cos(latitudeRadians);
    const tangent = Math.tan(latitudeRadians);
    const radius = semiMajor / Math.sqrt(1 - eccentricitySquared * sine * sine);
    const tangentSquared = tangent * tangent;
    const correction = eccentricityPrimeSquared * cosine * cosine;
    const arc = semiMajor * ((1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64 - 5 * eccentricitySquared ** 3 / 256) * latitudeRadians - (3 * eccentricitySquared / 8 + 3 * eccentricitySquared ** 2 / 32 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(2 * latitudeRadians) + (15 * eccentricitySquared ** 2 / 256 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(4 * latitudeRadians) - (35 * eccentricitySquared ** 3 / 3072) * Math.sin(6 * latitudeRadians));
    const delta = cosine * (longitudeRadians - centralMeridian);
    const easting = scale * radius * (delta + (1 - tangentSquared + correction) * delta ** 3 / 6 + (5 - 18 * tangentSquared + tangentSquared ** 2 + 72 * correction - 58 * eccentricityPrimeSquared) * delta ** 5 / 120) + 500000;
    const northing = scale * (arc + radius * tangent * (delta ** 2 / 2 + (5 - tangentSquared + 9 * correction + 4 * correction ** 2) * delta ** 4 / 24 + (61 - 58 * tangentSquared + tangentSquared ** 2 + 600 * correction - 330 * eccentricityPrimeSquared) * delta ** 6 / 720));
    return { easting, northing };
  }

  function drawPositionTrack() {
    if (!positionFixes.length) return;
    const { width, height } = sizeCanvas(positionTrack);
    const context = positionTrack.getContext("2d");
    const padding = 36 * (window.devicePixelRatio || 1);
    const eastings = positionFixes.map((fix) => fix.easting);
    const northings = positionFixes.map((fix) => fix.northing);
    const minEasting = Math.min(...eastings); const maxEasting = Math.max(...eastings);
    const minNorthing = Math.min(...northings); const maxNorthing = Math.max(...northings);
    const fittedSpan = Math.max(maxEasting - minEasting, maxNorthing - minNorthing, 20) * 1.2;
    if (!positionView) positionView = { centerEasting: (minEasting + maxEasting) / 2, centerNorthing: (minNorthing + maxNorthing) / 2, span: fittedSpan };
    const scale = Math.min((width - 2 * padding) / positionView.span, (height - 2 * padding) / positionView.span);
    const toCanvas = (fix) => ({ x: width / 2 + (fix.easting - positionView.centerEasting) * scale, y: height / 2 - (fix.northing - positionView.centerNorthing) * scale });
    context.fillStyle = "#090c12"; context.fillRect(0, 0, width, height);
    drawPositionGrid(context, width, height, padding, positionView, scale);
    context.lineWidth = 2 * (window.devicePixelRatio || 1);
    for (let index = 1; index < positionFixes.length; index++) {
      const previous = toCanvas(positionFixes[index - 1]); const current = toCanvas(positionFixes[index]);
      context.strokeStyle = positionFixes[index].threatColor; context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(current.x, current.y); context.stroke();
    }
    const latest = toCanvas(positionFixes[positionFixes.length - 1]); context.fillStyle = "#ff7262"; context.beginPath(); context.arc(latest.x, latest.y, 5 * (window.devicePixelRatio || 1), 0, Math.PI * 2); context.fill();
    context.fillStyle = "#9ba8bc"; context.font = `${11 * (window.devicePixelRatio || 1)}px "Segoe UI", sans-serif`; context.fillText("UTM33N", padding, 18 * (window.devicePixelRatio || 1));
    drawScaleBar(context, width, height, padding, scale);
  }

  function positionGridInterval(pixelsPerMetre, dpr = window.devicePixelRatio || 1) {
    const targetMetres = 80 * dpr / pixelsPerMetre;
    const magnitude = 10 ** Math.floor(Math.log10(targetMetres));
    return [magnitude, 5 * magnitude, 10 * magnitude].find((interval) => interval >= targetMetres) || 10 * magnitude;
  }

  function drawPositionGrid(context, width, height, padding, view, scale) {
    const dpr = window.devicePixelRatio || 1;
    const interval = positionGridInterval(scale, dpr);
    const halfWidthMetres = (width / 2 - padding) / scale;
    const halfHeightMetres = (height / 2 - padding) / scale;
    const firstEasting = Math.ceil((view.centerEasting - halfWidthMetres) / interval) * interval;
    const lastEasting = view.centerEasting + halfWidthMetres;
    const firstNorthing = Math.ceil((view.centerNorthing - halfHeightMetres) / interval) * interval;
    const lastNorthing = view.centerNorthing + halfHeightMetres;
    context.save();
    context.strokeStyle = "#293447";
    context.lineWidth = dpr;
    context.beginPath();
    for (let easting = firstEasting; easting <= lastEasting; easting += interval) {
      const x = width / 2 + (easting - view.centerEasting) * scale;
      context.moveTo(x, padding); context.lineTo(x, height - padding);
    }
    for (let northing = firstNorthing; northing <= lastNorthing; northing += interval) {
      const y = height / 2 - (northing - view.centerNorthing) * scale;
      context.moveTo(padding, y); context.lineTo(width - padding, y);
    }
    context.stroke();
    const intervalLabel = interval >= 1000 ? `${interval / 1000} km` : `${interval} m`;
    context.fillStyle = "#9ba8bc";
    context.font = `${11 * dpr}px "Segoe UI", sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(`UTM33N | Grid ${intervalLabel}`, padding, 10 * dpr);
    context.restore();
  }

  function drawScaleBar(context, width, height, padding, pixelsPerMetre) {
    const dpr = window.devicePixelRatio || 1;
    const targetMetres = 110 * dpr / pixelsPerMetre;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(targetMetres, 1)));
    const multiplier = targetMetres / magnitude >= 5 ? 5 : targetMetres / magnitude >= 2 ? 2 : 1;
    const metres = multiplier * magnitude;
    const length = metres * pixelsPerMetre;
    const x = padding;
    const y = height - padding / 2;
    context.save(); context.strokeStyle = "#e5e9f0"; context.fillStyle = "#e5e9f0"; context.lineWidth = 2 * dpr;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + length, y); context.moveTo(x, y - 4 * dpr); context.lineTo(x, y + 4 * dpr); context.moveTo(x + length, y - 4 * dpr); context.lineTo(x + length, y + 4 * dpr); context.stroke();
    context.font = `${11 * dpr}px "Segoe UI", sans-serif`; context.textAlign = "center"; context.textBaseline = "bottom"; context.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x + length / 2, y - 6 * dpr); context.restore();
  }

  function resetPositionView() {
    if (!positionFixes.length) return;
    const eastings = positionFixes.map((fix) => fix.easting);
    const northings = positionFixes.map((fix) => fix.northing);
    positionView = { centerEasting: (Math.min(...eastings) + Math.max(...eastings)) / 2, centerNorthing: (Math.min(...northings) + Math.max(...northings)) / 2, span: Math.max(Math.max(...eastings) - Math.min(...eastings), Math.max(...northings) - Math.min(...northings), 20) * 1.2 };
    drawPositionTrack();
  }

  function recenterPositionTrack() {
    if (!positionFixes.length) return;
    if (!positionView) resetPositionView();
    const latest = positionFixes[positionFixes.length - 1];
    positionView.centerEasting = latest.easting;
    positionView.centerNorthing = latest.northing;
    drawPositionTrack();
  }

  function zoomPositionTrack(factor) {
    if (!positionView || !positionFixes.length) return;
    positionView.span = Math.max(1, Math.min(1e7, positionView.span * factor));
    drawPositionTrack();
  }

  function trackCanvasPoint(event) {
    const bounds = positionTrack.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (event.clientX - bounds.left) * dpr, y: (event.clientY - bounds.top) * dpr };
  }

  positionTrack.addEventListener("wheel", (event) => {
    if (!positionView || !positionFixes.length) return;
    event.preventDefault();
    const { width, height } = sizeCanvas(positionTrack);
    const padding = 36 * (window.devicePixelRatio || 1);
    const scale = Math.min((width - 2 * padding) / positionView.span, (height - 2 * padding) / positionView.span);
    const point = trackCanvasPoint(event);
    const easting = positionView.centerEasting + (point.x - width / 2) / scale;
    const northing = positionView.centerNorthing - (point.y - height / 2) / scale;
    const zoom = event.deltaY < 0 ? 0.8 : 1.25;
    positionView.span = Math.max(1, Math.min(1e7, positionView.span * zoom));
    const nextScale = Math.min((width - 2 * padding) / positionView.span, (height - 2 * padding) / positionView.span);
    positionView.centerEasting = easting - (point.x - width / 2) / nextScale;
    positionView.centerNorthing = northing + (point.y - height / 2) / nextScale;
    drawPositionTrack();
  }, { passive: false });

  positionTrack.addEventListener("pointerdown", (event) => {
    if (!positionView) return;
    positionDrag = { point: trackCanvasPoint(event), centerEasting: positionView.centerEasting, centerNorthing: positionView.centerNorthing };
    positionTrack.setPointerCapture(event.pointerId);
  });
  positionTrack.addEventListener("pointermove", (event) => {
    if (!positionDrag || !positionView) return;
    const { width, height } = sizeCanvas(positionTrack); const padding = 36 * (window.devicePixelRatio || 1);
    const scale = Math.min((width - 2 * padding) / positionView.span, (height - 2 * padding) / positionView.span); const point = trackCanvasPoint(event);
    positionView.centerEasting = positionDrag.centerEasting - (point.x - positionDrag.point.x) / scale;
    positionView.centerNorthing = positionDrag.centerNorthing + (point.y - positionDrag.point.y) / scale;
    drawPositionTrack();
  });
  positionTrack.addEventListener("pointerup", () => { positionDrag = null; });
  positionTrack.addEventListener("pointercancel", () => { positionDrag = null; });
  positionTrack.addEventListener("dblclick", resetPositionView);
  positionTrack.parentElement.querySelector(".track-controls").append(createCanvasExportButton(positionTrack, "GNSS position track", () => {
    const latest = positionFixes.at(-1);
    return latest ? `Latest fix: ${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}` : "";
  }));
  positionRecenter.addEventListener("click", recenterPositionTrack);
  positionZoomIn.addEventListener("click", () => zoomPositionTrack(0.8));
  positionZoomOut.addEventListener("click", () => zoomPositionTrack(1.25));

  function updatePositionMap(fix, droppedOldestFix = false) {
    if (settings.darkMap || location.protocol === "file:") { updateVectorPositionMap(fix); return; }
    if (!window.L) return;
    if (!positionMap) {
      positionMap = window.L.map("position-map").setView([fix.latitude, fix.longitude], 15);
      updateMapTiles();
    }
    if (!mapTrack) mapTrack = window.L.layerGroup().addTo(positionMap);
    if (!mapMarker) mapMarker = window.L.circleMarker([fix.latitude, fix.longitude], { radius: 7, color: "#ff7262", fillColor: "#ff7262", fillOpacity: 1 }).addTo(positionMap);
    const segmentCount = positionFixes.length - 1;
    if (droppedOldestFix && mapTrackSegments.length === segmentCount) mapTrack.removeLayer(mapTrackSegments.shift());
    while (mapTrackSegments.length > segmentCount) mapTrack.removeLayer(mapTrackSegments.pop());
    while (mapTrackSegments.length < segmentCount) {
      const index = mapTrackSegments.length + 1;
      const previous = positionFixes[index - 1]; const current = positionFixes[index];
      mapTrackSegments.push(window.L.polyline([[previous.latitude, previous.longitude], [current.latitude, current.longitude]], { color: current.threatColor, weight: 3 }).addTo(mapTrack));
    }
    mapMarker.setLatLng([fix.latitude, fix.longitude]);
    positionMap.panTo([fix.latitude, fix.longitude], { animate: false });
  }

  function updateMapTiles() {
    if (settings.darkMap || location.protocol === "file:") {
      if (positionMap) { positionMap.remove(); positionMap = null; mapTiles = null; mapTrack = null; mapTrackSegments = []; mapMarker = null; }
      if (mapLibreMap) { mapLibreMap.remove(); mapLibreMap = null; }
      if (positionFixes.length) updateVectorPositionMap(positionFixes[positionFixes.length - 1]);
      return;
    }
    if (mapLibreMap) { mapLibreMap.remove(); mapLibreMap = null; }
    if (!positionMap && positionFixes.length) { updatePositionMap(positionFixes[positionFixes.length - 1]); return; }
    if (!positionMap || !window.L) return;
    if (mapTiles) positionMap.removeLayer(mapTiles);
    mapTiles = window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors", referrerPolicy: "origin" }).addTo(positionMap);
  }

  function vectorTrackData() {
    const step = Math.max(1, Math.ceil((positionFixes.length - 1) / (MAX_MAP_TRACK_POINTS - 1)));
    const fixes = positionFixes.filter((fix, index) => index % step === 0 || index === positionFixes.length - 1);
    const features = [];
    for (let index = 1; index < fixes.length; index++) {
      const previous = fixes[index - 1]; const current = fixes[index];
      const feature = features.at(-1);
      if (feature?.properties.color === current.threatColor) feature.geometry.coordinates.push([current.longitude, current.latitude]);
      else features.push({ type: "Feature", properties: { color: current.threatColor }, geometry: { type: "LineString", coordinates: [[previous.longitude, previous.latitude], [current.longitude, current.latitude]] } });
    }
    return {
      type: "FeatureCollection",
      features,
    };
  }

  function vectorTrackVertices() {
    const step = Math.max(1, Math.ceil((positionFixes.length - 1) / (MAX_MAP_TRACK_POINTS - 1)));
    return {
      type: "FeatureCollection",
      features: positionFixes.filter((fix, index) => index % step === 0 || index === positionFixes.length - 1).map((fix) => ({ type: "Feature", properties: { color: fix.threatColor }, geometry: { type: "Point", coordinates: [fix.longitude, fix.latitude] } })),
    };
  }

  function latestFixData() {
    const fix = positionFixes.at(-1);
    return { type: "FeatureCollection", features: fix ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [fix.longitude, fix.latitude] } }] : [] };
  }

  function updateVectorPositionMap(fix) {
    if (!window.maplibregl) return;
    if (positionMap) { positionMap.remove(); positionMap = null; mapTiles = null; mapTrack = null; mapTrackSegments = []; mapMarker = null; }
    if (!mapLibreMap) {
      mapLibreMap = new window.maplibregl.Map({
        container: "position-map", center: [fix.longitude, fix.latitude], zoom: 15,
        style: settings.darkMap ? DARK_MAP_STYLE_URL : LIGHT_MAP_STYLE_URL,
      });
      mapLibreMap.on("load", () => {
        mapLibreMap.addSource("track", { type: "geojson", data: vectorTrackData() });
        mapLibreMap.addSource("track-vertices", { type: "geojson", data: vectorTrackVertices() });
        const trackWidth = ["interpolate", ["linear"], ["zoom"], 0, 5, 8, 5, 12, 6, 16, 8];
        mapLibreMap.addLayer({ id: "track-casing", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#071018", "line-width": ["interpolate", ["linear"], ["zoom"], 0, 8, 8, 8, 12, 9, 16, 11], "line-opacity": 0.9 } });
        mapLibreMap.addLayer({ id: "track-lines", type: "line", source: "track", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": trackWidth, "line-opacity": 1 } });
        mapLibreMap.addLayer({ id: "track-vertices", type: "circle", source: "track-vertices", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 5, 12, 3, 16, 2], "circle-color": ["get", "color"], "circle-stroke-color": "#071018", "circle-stroke-width": 1, "circle-opacity": 0.9 } });
        mapLibreMap.addSource("latest-fix", { type: "geojson", data: latestFixData() });
        mapLibreMap.addLayer({ id: "latest-fix", type: "circle", source: "latest-fix", paint: { "circle-radius": 7, "circle-color": "#ff7262", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
      });
      return;
    }
    if (!mapLibreMap.isStyleLoaded()) return;
    mapLibreMap.getSource("track")?.setData(vectorTrackData());
    mapLibreMap.getSource("track-vertices")?.setData(vectorTrackVertices());
    mapLibreMap.getSource("latest-fix")?.setData(latestFixData());
    mapLibreMap.panTo([fix.longitude, fix.latitude], { animate: false });
  }

  function parseNavPvt(payload) {
    if (payload.length < 92) return;
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const longitude = data.getInt32(24, true) / 1e7;
    const latitude = data.getInt32(28, true) / 1e7;
    const altitudeMetres = data.getInt32(36, true) / 1000;
    const groundSpeedMetresPerSecond = data.getInt32(60, true) / 1000;
    const headingDegrees = data.getInt32(64, true) / 1e5;
    const fixNames = ["No fix", "Dead reckoning", "2D fix", "3D fix", "GNSS + DR", "Time only"];
    const fixType = payload[20]; const satellites = payload[23];
    const year = data.getUint16(4, true); const month = payload[6]; const day = payload[7]; const hour = payload[8]; const minute = payload[9]; const second = payload[10];
    const valid = payload[11]; const nano = data.getInt32(16, true); const receivedAt = Date.now();
    latestPvtClock = { utcMs: Date.UTC(year, month - 1, day, hour, minute, second) + nano / 1e6, nano, tAccNs: data.getUint32(12, true), receivedAt, validDate: Boolean(valid & 0x01), validTime: Boolean(valid & 0x02), fullyResolved: Boolean(valid & 0x04), confirmedDate: Boolean(valid & 0x10), confirmedTime: Boolean(valid & 0x20) };
    refreshOsnmaClock(receivedAt);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
    const time = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    const positionValid = Boolean(payload[21] & 0x01) && [2, 3, 4].includes(fixType);
    updateReceiverStatus({ latitude, longitude, fixType, satellites, time, year, month, day, hour, minute, second, nano, altitudeMetres, groundSpeedMetresPerSecond, headingDegrees, valid, positionValid });
    if (!positionValid) return;
    const utm = latLonToUtm33(latitude, longitude);
    const threatLevel = Math.max(receiverThreat.monRfJam, receiverThreat.navSpoof, receiverThreat.secJam, receiverThreat.secSpoof);
    const threatColor = threatLevel >= 3 ? "#ff4444" : threatLevel >= 2 ? "#ffb347" : "#72c7e7";
    const fix = { latitude, longitude, fixType, satellites, time, threatLevel, threatColor, ...utm };
    const droppedOldestFix = positionFixes.length === 3600;
    positionFixes.push(fix); if (positionFixes.length > 3600) positionFixes.shift();
    positionRecenter.disabled = false; positionZoomIn.disabled = false; positionZoomOut.disabled = false;
    positionEmpty.hidden = true;
    positionInfo.innerHTML = `<strong>Latitude:</strong> ${latitude.toFixed(6)}&deg; &nbsp; <strong>Longitude:</strong> ${longitude.toFixed(6)}&deg; &nbsp; <strong>Fix:</strong> ${fixNames[fixType] || `Fix ${fixType}`} &nbsp; <strong>SVs:</strong> ${satellites} &nbsp; <strong>Time:</strong> ${time} &nbsp; <a href="https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}" target="_blank">Open in Maps</a>`;
    if (!replayRebuilding && !positionPanel.hidden) { drawPositionTrack(); updatePositionMap(fix, droppedOldestFix); }
  }

  function parseNavTimeUtc(payload) {
    if (payload.length < 20) return;
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const valid = payload[19]; const year = data.getUint16(12, true); const month = payload[14]; const day = payload[15];
    const hour = payload[16]; const minute = payload[17]; const second = payload[18]; const nano = data.getInt32(8, true); const receivedAt = Date.now();
    latestTimeUtcClock = { utcMs: Date.UTC(year, month - 1, day, hour, minute, second) + nano / 1e6, nano, tAccNs: data.getUint32(4, true), receivedAt, validTow: Boolean(valid & 0x01), validWeek: Boolean(valid & 0x02), validUtc: Boolean(valid & 0x04) };
    refreshOsnmaClock(receivedAt);
  }

  function updateReceiverStatus(fix) {
    const fixName = ["No fix", "Dead reckoning", "2D fix", "3D fix", "GNSS + DR", "Time only"][fix.fixType] || `Fix ${fix.fixType}`;
    const indicator = fix.fixType >= 3 ? "🟢" : fix.fixType === 2 ? "🟡" : "🔴";
    fixStatus.className = `status-item ${fix.fixType >= 3 ? "status-fix-good" : fix.fixType === 2 ? "status-fix-warning" : "status-fix-bad"}`;
    fixStatus.textContent = `${indicator} ${fixName} | ${fix.satellites} SV`;
    const utcValid = (fix.valid & 0x03) === 0x03;
    gpsTime.textContent = `GPS UTC: ${utcValid ? `${fix.time} UTC` : "unavailable"}`;
    if (utcValid) {
      const receiverUtc = Date.UTC(fix.year, fix.month - 1, fix.day, fix.hour, fix.minute, fix.second) + fix.nano / 1e6;
      if ((fix.valid & 0x07) === 0x07 && port && reading && !replayData) latestReceiverUtc = { utcMs: receiverUtc, receivedAt: Date.now(), connectionId: liveConnectionId };
      else latestReceiverUtc = null;
      const offsetMilliseconds = Date.now() + appClockOffsetMs - receiverUtc;
      const sign = offsetMilliseconds >= 0 ? "+" : "-";
      clockOffset.textContent = `${appClockOffsetMs ? "App" : "NTP/local"} clock offset: ${sign}${(Math.abs(offsetMilliseconds) / 1000).toFixed(3)} s`;
    } else { latestReceiverUtc = null; clockOffset.textContent = "NTP/local clock offset: unavailable"; }
    if (!fix.positionValid) {
      latestPosition.textContent = "Position: no fix"; altitudeStatus.textContent = "Altitude: --"; speedStatus.textContent = "Speed: --"; headingStatus.textContent = "Heading: --";
      return;
    }
    const latitude = fix.latitude.toFixed(6); const longitude = fix.longitude.toFixed(6);
    latestPosition.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">location_on</span><a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" rel="noopener">${latitude}, ${longitude}</a>`;
    altitudeStatus.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">terrain</span>${fix.altitudeMetres.toFixed(1)} m`;
    speedStatus.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">speed</span>${(fix.groundSpeedMetresPerSecond * 3.6).toFixed(1)} km/h`;
    headingStatus.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">navigation</span>${((fix.headingDegrees % 360) + 360).toFixed(1)}°`;
  }

  function refreshOsnmaClock(now = Date.now()) {
    const source = [latestPvtClock?.validDate && latestPvtClock.validTime ? { ...latestPvtClock, source: "NAV-PVT" } : null, latestTimeUtcClock?.validUtc ? { ...latestTimeUtcClock, source: "NAV-TIMEUTC" } : null]
      .filter(Boolean).sort((left, right) => right.receivedAt - left.receivedAt)[0];
    const age = source ? Math.max(0, now - source.receivedAt) : null;
    const fresh = age !== null && age <= 2500;
    if (!source) osnmaClockValue.textContent = "Waiting for valid receiver UTC";
    else {
      const clockMs = source.utcMs + (fresh ? age : 0);
      const date = new Date(clockMs);
      const options = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" };
      if (!osnmaClockSettings.showLocalTime) options.timeZone = "UTC";
      osnmaClockValue.textContent = `${new Intl.DateTimeFormat(undefined, options).format(date)} ${osnmaClockSettings.showLocalTime ? "local" : "UTC"}`;
    }
    osnmaClockAge.textContent = age === null ? "Waiting for receiver time" : fresh ? `${source.source}; updated ${age} ms ago` : `${source.source}; stale (${(age / 1000).toFixed(1)} s old)`;
    osnmaClockAge.dataset.state = age === null ? "waiting" : fresh ? "good" : "bad";
    if (latestPvtClock) {
      const pvt = latestPvtClock;
      osnmaClockPvt.textContent = `${pvt.validDate && pvt.validTime ? "Date/time valid" : "Date/time invalid"}; date ${pvt.confirmedDate ? "confirmed" : "unconfirmed"}; time ${pvt.confirmedTime ? "confirmed" : "unconfirmed"}; fully resolved ${pvt.fullyResolved ? "yes" : "no"}; tAcc ${pvt.tAccNs.toLocaleString()} ns`;
      osnmaClockPvt.dataset.state = pvt.validDate && pvt.validTime ? "good" : "waiting";
    } else { osnmaClockPvt.textContent = "Waiting for NAV-PVT"; osnmaClockPvt.dataset.state = "waiting"; }
    if (latestTimeUtcClock) {
      const utc = latestTimeUtcClock;
      osnmaClockTimeUtc.textContent = `UTC ${utc.validUtc ? "valid" : "invalid"}; TOW ${utc.validTow ? "valid" : "invalid"}; week ${utc.validWeek ? "valid" : "invalid"}; tAcc ${utc.tAccNs.toLocaleString()} ns`;
      osnmaClockTimeUtc.dataset.state = utc.validUtc ? "good" : "waiting";
    } else { osnmaClockTimeUtc.textContent = "Waiting for NAV-TIMEUTC"; osnmaClockTimeUtc.dataset.state = "waiting"; }
    const status = latestOsnmaStatus;
    const statusFresh = status && now >= status.receivedAt && now - status.receivedAt <= 40000 && status.connectionId === liveConnectionId;
    const timeCheck = latestOsnmaTimeCheck;
    if (statusFresh && (status.timSyncStatus === 4 || status.timingAuthResult === 2 || timeCheck?.status === 4)) {
      osnmaClockAuth.textContent = "OSNMA time verification failed";
      osnmaClockAuth.dataset.state = "bad";
    } else if (statusFresh && timeCheck?.status === 3 && timeCheck.authenticated) {
      osnmaClockAuth.textContent = "OSNMA timing authenticated; receiver time-sync check passed";
      osnmaClockAuth.dataset.state = "good";
    } else if (statusFresh && status.timingAuthResult === 1) {
      osnmaClockAuth.textContent = "Timing parameters authenticated; clock check pending";
      osnmaClockAuth.dataset.state = "waiting";
    } else {
      osnmaClockAuth.textContent = statusFresh ? "Clock time not authenticated by OSNMA" : "OSNMA verification unavailable";
      osnmaClockAuth.dataset.state = "waiting";
    }
    [osnmaClockPvt, osnmaClockTimeUtc, osnmaClockAuth].forEach((element) => {
      if (element.parentElement?.classList?.contains("gnss-threat-indicator")) element.parentElement.dataset.state = element.dataset.state || "waiting";
    });
  }

  function gnssColor(gnssId) { return ["#ffb347", "#00ffff", "#66ff88", "#ff7262", "#ffffff", "#ffff66", "#f27bfd", "#88aaff"][gnssId] || "#aaaaaa"; }

  function parseNavSat(payload) {
    if (payload.length < 8) return;
    const count = Math.min(payload[5], Math.floor((payload.length - 8) / 12)); const epoch = ++signalEpoch.cno;
    for (let index = 0; index < count; index++) { const offset = 8 + index * 12; const gnssId = payload[offset]; const svId = payload[offset + 1]; appendSeries(signalHistory.cno, `${gnssId}:${svId}`, epoch, payload[offset + 2], gnssColor(gnssId)); }
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function parseNavSig(payload) {
    if (payload.length < 8) return;
    const count = Math.min(payload[5], Math.floor((payload.length - 8) / 16)); const epoch = ++signalEpoch.cno;
    for (let index = 0; index < count; index++) {
      const offset = 8 + index * 16; const gnssId = payload[offset]; const svId = payload[offset + 1]; const sigId = payload[offset + 2];
      appendSeries(signalHistory.cno, `${gnssId}:${svId}:${sigId}`, epoch, payload[offset + 6], gnssColor(gnssId));
    }
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function parseRawx(payload) {
    if (payload.length < 16) return;
    const count = Math.min(payload[11], Math.floor((payload.length - 16) / 32)); const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength); const epoch = ++signalEpoch.doppler;
    for (let index = 0; index < count; index++) { const offset = 16 + index * 32; const gnssId = payload[offset + 20]; const svId = payload[offset + 21]; const sigId = payload[offset + 22]; appendSeries(signalHistory.doppler, `${gnssId}:${svId}:${sigId}`, epoch, data.getFloat32(offset + 16, true), gnssColor(gnssId)); }
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function parseMonRf(payload) {
    if (payload.length < 4) return;
    const count = Math.min(payload[1], Math.floor((payload.length - 4) / 24)); const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength); const epoch = ++signalEpoch.monRf;
    for (let index = 0; index < count; index++) {
      const offset = 4 + index * 24;
      while (signalHistory.jamState.length <= index) { signalHistory.jamState.push([]); signalHistory.jamIndex.push([]); signalHistory.agc.push([]); }
      appendHistory(signalHistory.jamState[index], { epoch, value: payload[offset + 1] & 0x03 });
      appendHistory(signalHistory.jamIndex[index], { epoch, value: payload[offset + 16] });
      appendHistory(signalHistory.agc[index], { epoch, value: data.getUint16(offset + 14, true) });
      while (signalHistory.pga.length <= index) signalHistory.pga.push([]);
      appendHistory(signalHistory.pga[index], { epoch, value: latestPga[index] ?? 0 });
    }
    receiverThreat.monRfJam = Math.max(0, ...signalHistory.jamState.map((history) => history.at(-1)?.value ?? 0));
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function parseNavStatus(payload) {
    if (payload.length < 8) return;
    const state = (payload[7] >> 3) & 0x03;
    receiverThreat.navSpoof = state;
    appendHistory(signalHistory.spoof, { epoch: ++signalEpoch.spoof, value: state });
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function renderOsnma() {
    osnmaInputStatus.textContent = osnmaE1bFrameCount ? `Receiving Galileo E1-B (${osnmaFrames.size} satellites)` : "Waiting for Galileo E1-B data";
    osnmaInputStatus.dataset.state = osnmaE1bFrameCount ? "good" : "waiting";
    osnmaTimeStatus.textContent = osnmaGalileoTime || "Waiting for NAV-TIMEGAL";
    osnmaTimeStatus.dataset.state = osnmaGalileoTime?.startsWith("GST week") ? "good" : "waiting";
    osnmaFrameCount.textContent = `${osnmaE1bFrameCount} frame${osnmaE1bFrameCount === 1 ? "" : "s"}`;
    if (latestOsnmaStatus) {
      const status = latestOsnmaStatus;
      osnmaTrustStatus.textContent = `PKID ${status.pubKeyId || "none"} ${status.pubKeyValid ? "key valid" : "key not validated"}; Merkle root ${status.merkleRootValid ? "valid" : "not validated"}`;
      osnmaTrustStatus.dataset.state = status.pubKeyValid && status.merkleRootValid ? "good" : "waiting";
      const satelliteResults = [...osnmaSatelliteResults.values()];
      const authenticatedSatellites = satelliteResults.filter((satellite) => satellite.authStatus === 1).length;
      const failedSatellites = satelliteResults.filter((satellite) => satellite.authStatus === 0).length;
      osnmaAuthStatus.textContent = satelliteResults.length ? `${authenticatedSatellites} authenticated; ${failedSatellites} failed (retained)` : "No satellite results yet";
      osnmaAuthStatus.dataset.state = failedSatellites ? "bad" : authenticatedSatellites ? "good" : "waiting";
      const nmaDescription = osnmaCodeDescription("nma", status.nmaStatus);
      const cpksDescription = osnmaCodeDescription("cpks", status.cpks);
      osnmaServiceState.textContent = `${status.osnmaEnabled ? "OSNMA enabled" : "OSNMA disabled"}; ${nmaDescription}; chain ${status.chainInForce}; ${cpksDescription}`;
      osnmaServiceState.title = `NMA status ${status.nmaStatus}: ${nmaDescription}. Chain in force: ${status.chainInForce}. CPKS ${status.cpks}: ${cpksDescription}.`;
      const timeSyncDescription = osnmaCodeDescription("timeSync", status.timSyncStatus);
      const timeSyncSetting = status.timSyncEnabled ? "Requirement enabled" : "Requirement disabled";
      osnmaTimeSyncState.textContent = latestOsnmaTimeCheck ? `${timeSyncSetting}; last check ${osnmaCodeDescription("timeSync", latestOsnmaTimeCheck.status)} (${formatOsnmaClock(latestOsnmaTimeCheck.receivedAt)})` : `${timeSyncSetting}; ${timeSyncDescription}`;
      osnmaTimeSyncState.title = `Current status ${status.timSyncStatus}: ${timeSyncDescription}.${latestOsnmaTimeCheck ? ` Last completed check: ${latestOsnmaTimeCheck.status}: ${osnmaCodeDescription("timeSync", latestOsnmaTimeCheck.status)} at ${formatOsnmaClock(latestOsnmaTimeCheck.receivedAt)}.` : " No completed check has been reported yet."}`;
      osnmaTimeDelta.textContent = latestOsnmaTimeCheck ? `${latestOsnmaTimeCheck.differenceMs} ms; ${osnmaCodeDescription("timeSync", latestOsnmaTimeCheck.status)}; ${formatOsnmaClock(latestOsnmaTimeCheck.receivedAt)}` : "No completed check yet";
      osnmaTimeDelta.title = latestOsnmaTimeCheck ? `Last completed time-sync check: ${osnmaCodeDescription("timeSync", latestOsnmaTimeCheck.status)} (${formatOsnmaClock(latestOsnmaTimeCheck.receivedAt)}).` : "The receiver has not reported a completed time-sync check yet.";
      renderRetainedOsnmaCode(osnmaHeaderAuth, "headerAuth", "headerAuth", status.headerAuthStatus, [0], "Waiting for authenticated header");
      renderRetainedOsnmaCode(osnmaDsmAuth, "dsm", "dsm", status.dsmAuthenticationStatus, [0], "Waiting for DSM authentication");
      renderRetainedOsnmaCode(osnmaTeslaAuth, "tesla", "tesla", status.teslaKeyAuthStatus, [0, 3], "Waiting for TESLA key authentication");
      renderRetainedOsnmaCode(osnmaTimingAuth, "timing", "timing", status.timingAuthResult, [0], "Waiting for timing authentication");
      const newestSatelliteResult = satelliteResults.reduce((newest, satellite) => Math.max(newest, satellite.receivedAt), 0);
      osnmaAuthSatelliteCount.textContent = satelliteResults.length ? `${satelliteResults.length} retained; updated ${formatOsnmaClock(newestSatelliteResult)}` : "Waiting for results";
      if (!satelliteResults.length) osnmaSatelliteRows.innerHTML = '<tr><td colspan="5">Waiting for the first satellite authentication result.</td></tr>';
      else {
        const rows = satelliteResults.sort((left, right) => left.svId - right.svId).map((satellite) => {
          const row = document.createElement("tr");
          [`GAL ${String(satellite.svId).padStart(2, "0")}`, String(satellite.iode), String(satellite.authCount), osnmaCodeDescription("satelliteAuth", satellite.authStatus), formatOsnmaClock(satellite.receivedAt)].forEach((value, index) => {
            const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
            if (index === 3) cell.title = `Receiver satellite authentication code ${satellite.authStatus}: ${value}.`;
          });
          return row;
        });
        osnmaSatelliteRows.replaceChildren(...rows);
      }
    } else {
      osnmaReceiverStatus.textContent = "Waiting for SEC-OSNMA";
      osnmaServiceState.textContent = "--"; osnmaTimeSyncState.textContent = "--"; osnmaTimeDelta.textContent = "--"; osnmaHeaderAuth.textContent = "--";
      osnmaDsmAuth.textContent = "--"; osnmaTeslaAuth.textContent = "--"; osnmaTimingAuth.textContent = "--";
      osnmaHeaderAuth.title = ""; osnmaDsmAuth.title = ""; osnmaTeslaAuth.title = ""; osnmaTimingAuth.title = "";
      osnmaTrustStatus.dataset.state = "waiting"; osnmaAuthStatus.dataset.state = "waiting";
      osnmaAuthSatelliteCount.textContent = "No results";
      osnmaSatelliteRows.innerHTML = '<tr><td colspan="4">No SEC-OSNMA satellite results received.</td></tr>';
    }
    [osnmaInputStatus, osnmaTimeStatus, osnmaTrustStatus, osnmaAuthStatus].forEach((element) => {
      if (element.parentElement?.classList?.contains("gnss-threat-indicator")) element.parentElement.dataset.state = element.dataset.state || "waiting";
    });
    refreshOsnmaIndicators();
    if (!osnmaFrames.size) {
      osnmaFrameRows.innerHTML = '<tr><td colspan="4">No Galileo E1-B frames received.</td></tr>';
      return;
    }
    const rows = [...osnmaFrames.values()].sort((left, right) => left.svId - right.svId).map((frame) => {
      const row = document.createElement("tr");
      const satellite = document.createElement("td"); satellite.textContent = `GAL ${String(frame.svId).padStart(2, "0")}`;
      const count = document.createElement("td"); count.textContent = String(frame.count);
      const received = document.createElement("td"); received.textContent = frame.lastReceived;
      const words = document.createElement("td"); const code = document.createElement("code"); code.textContent = frame.words.join(" "); words.append(code);
      row.append(satellite, count, received, words);
      return row;
    });
    osnmaFrameRows.replaceChildren(...rows);
  }

  function hasAuthenticatedOsnmaTiming(status) {
    return Boolean(status.osnmaEnabled && status.nmaStatus === 2 && status.cpks === 1
      && status.headerAuthStatus === 1 && status.pubKeyValid && status.merkleRootValid
      && status.teslaKeyAuthStatus === 1 && status.timingAuthResult === 1
      && status.timSyncEnabled && status.timSyncStatus === 3 && osnmaCodeState("dsm", status.dsmAuthenticationStatus) !== "bad"
      && status.satellites.every((satellite) => satellite.authStatus === 1));
  }
  function canCorrectLocalClock(now = Date.now()) {
    const status = latestOsnmaStatus;
    const check = latestOsnmaTimeCheck;
    return Boolean(port && writer && reading && !replayData && !trustedClockUpdatePending && status && check && trustedClockSample
      && status.connectionId === liveConnectionId && trustedClockSample.connectionId === liveConnectionId
      && check.trustedClockSample === trustedClockSample && check.status === 3 && check.authenticated && Number.isFinite(check.differenceMs)
      && now >= check.receivedAt
      && now >= status.receivedAt && now - status.receivedAt <= 40000
      && status.osnmaEnabled && status.nmaStatus === 2 && status.cpks === 1
      && status.pubKeyValid && status.merkleRootValid
      && [["headerAuth", status.headerAuthStatus], ["tesla", status.teslaKeyAuthStatus], ["timing", status.timingAuthResult], ["timeSync", status.timSyncStatus], ["dsm", status.dsmAuthenticationStatus]].every(([group, code]) => osnmaCodeState(group, code) !== "bad")
      && status.timSyncEnabled
      && status.satellites.every((satellite) => satellite.authStatus === 1));
  }
  function refreshLocalClock(now = Date.now()) {
    osnmaUpdateLocalTime.disabled = !canCorrectLocalClock(now);
    osnmaSendTrustedTime.disabled = !writer || !reading || replayData || !osnmaClockSettings.useComputerClock || trustedClockUpdatePending || configureButton.disabled;
    const correction = `${appClockOffsetMs >= 0 ? "+" : "-"}${(Math.abs(appClockOffsetMs) / 1000).toFixed(3)} s`;
    osnmaLocalTime.textContent = `Local UTC: ${new Date(now + appClockOffsetMs).toISOString().replace("T", " ").replace("Z", " UTC")}; correction ${correction}`;
  }
  async function sendTrustedTimeNow() {
    if (!osnmaClockSettings.useComputerClock) {
      osnmaTrustedTimeStatus.textContent = "Enable the trusted computer UTC requirement before sending.";
      return;
    }
    if (!writer || !reading || replayData || configureButton.disabled) {
      osnmaTrustedTimeStatus.textContent = "Connect a receiver and finish configuration before sending trusted UTC.";
      return;
    }
    const connectionId = liveConnectionId;
    osnmaTrustedTimeStatus.textContent = "Sending trusted UTC and waiting for receiver acknowledgement...";
    const result = await sendTrustedClockTime();
    if (connectionId !== liveConnectionId) return;
    osnmaTrustedTimeStatus.textContent = result.accepted
      ? "Trusted UTC accepted."
      : `Trusted UTC was not accepted (${result.message || `MGA-ACK info ${result.infoCode}`}).`;
  }
  async function updateLocalClock() {
    if (!canCorrectLocalClock()) { refreshLocalClock(); setStatus("App time unchanged: an authenticated passed OSNMA check of accepted computer UTC assistance and a healthy live receiver are required"); return; }
    const correctedOffsetMs = trustedClockSample.offsetMs + latestOsnmaTimeCheck.differenceMs;
    const connectionId = liveConnectionId;
    const result = await sendTrustedClockTime(correctedOffsetMs);
    if (connectionId !== liveConnectionId) return;
    if (!result.accepted) { setStatus(`App time unchanged: adjusted trusted UTC was not acknowledged (${result.message || `MGA info ${result.infoCode}`}); send receiver configuration before retrying`); return; }
    appClockOffsetMs = correctedOffsetMs;
    refreshLocalClock();
    clockOffset.textContent = "App clock offset: waiting for next NAV-PVT";
    setStatus("OSNMA offset added to app UTC and adjusted trusted UTC accepted; waiting for a new time-sync check. Windows clock unchanged");
  }
  function resetLocalClock() {
    liveConnectionId += 1; latestReceiverUtc = null; appClockOffsetMs = 0;
    trustedClockSample = null;
    latestPvtClock = null; latestTimeUtcClock = null; refreshOsnmaClock();
    clockOffset.textContent = "NTP/local clock offset: --";
    refreshLocalClock();
  }
  function osnmaCodeState(group, code) {
    const goodCodes = { nma: [2], cpks: [1], timeSync: [3], headerAuth: [1], dsm: [1, 2], tesla: [1], timing: [1], satelliteAuth: [1] };
    const waitingCodes = { nma: [0, 1], cpks: [0, 2, 4, 6], timeSync: [0, 1, 2], headerAuth: [0], dsm: [0, 8], tesla: [0, 3], timing: [0], satelliteAuth: [] };
    return goodCodes[group]?.includes(code) ? "good" : waitingCodes[group]?.includes(code) ? "waiting" : "bad";
  }
  function osnmaRetainedResultState(group, currentCode, result, expectedIntervalMs, now) {
    const currentState = currentCode === undefined ? "waiting" : osnmaCodeState(group, currentCode);
    const idle = currentCode === 0 || (group === "tesla" && currentCode === 3);
    if (currentState === "bad" || (!idle && currentState !== "good") || !result) return currentState;
    const retainedState = osnmaCodeState(group, result.code);
    return retainedState === "good" && (now < result.receivedAt || now - result.receivedAt > expectedIntervalMs) ? "waiting" : retainedState;
  }
  function refreshOsnmaIndicators(now = Date.now()) {
    const status = latestOsnmaStatus;
    const age = status ? Math.max(0, now - status.receivedAt) : null;
    osnmaLastUpdate.textContent = age === null ? "Last update: --" : `Last update: ${Math.floor(age / 1000)} s ago`;
    osnmaLastUpdate.dataset.state = age === null ? "waiting" : age > 60000 ? "bad" : age > 40000 ? "waiting" : "good";
    const fields = [[osnmaServiceState, "nma", status?.nmaStatus], [osnmaTimeSyncState, "timeSync", status?.timSyncStatus], [osnmaTimeDelta, "timeSync", latestOsnmaTimeCheck?.status], [osnmaHeaderAuth, "headerAuth", status?.headerAuthStatus], [osnmaDsmAuth, "dsm", status?.dsmAuthenticationStatus], [osnmaTeslaAuth, "tesla", status?.teslaKeyAuthStatus], [osnmaTimingAuth, "timing", status?.timingAuthResult]];
    for (const [element, group, code] of fields) element.dataset.state = code === undefined ? "waiting" : osnmaCodeState(group, code);
    const timeCheck = latestOsnmaTimeCheck ? { code: latestOsnmaTimeCheck.status, receivedAt: latestOsnmaTimeCheck.receivedAt } : null;
    const periodicResults = [[osnmaTimeSyncState, "timeSync", status?.timSyncStatus, timeCheck, 60000], [osnmaTimeDelta, "timeSync", status?.timSyncStatus, timeCheck, 60000], [osnmaDsmAuth, "dsm", status?.dsmAuthenticationStatus, retainedOsnmaCodes.dsm, 240000], [osnmaTeslaAuth, "tesla", status?.teslaKeyAuthStatus, retainedOsnmaCodes.tesla, 60000], [osnmaTimingAuth, "timing", status?.timingAuthResult, retainedOsnmaCodes.timing, 60000]];
    for (const [element, group, code, result, interval] of periodicResults) {
      const state = osnmaRetainedResultState(group, code, result, interval, now);
      element.dataset.state = state === "good" && (age === null || age > 40000 || (group === "timeSync" && !status.timSyncEnabled)) ? "waiting" : state;
    }
    if (status && osnmaCodeState("cpks", status.cpks) === "bad") osnmaServiceState.dataset.state = "bad";
    const error = fields.some(([element]) => element.dataset.state === "bad") || status?.satellites.some((satellite) => satellite.authStatus === 0);
    const working = status?.osnmaEnabled && status.pubKeyValid && status.merkleRootValid && [osnmaServiceState, osnmaHeaderAuth, osnmaTeslaAuth, osnmaTimingAuth].every((element) => element.dataset.state === "good");
    const state = error || age > 60000 ? "bad" : working && age <= 40000 ? "good" : "waiting";
    osnmaReceiverStatus.dataset.state = state;
    osnmaReceiverStatus.textContent = status ? `${state === "bad" ? "Error" : state === "good" ? "Working" : "Waiting"}; SEC-OSNMA v${status.version}; ${status.numSvs} SVs monitored` : "Waiting for SEC-OSNMA";
    [osnmaServiceState, osnmaTimeSyncState, osnmaTimeDelta, osnmaHeaderAuth, osnmaDsmAuth, osnmaTeslaAuth, osnmaTimingAuth].forEach((element) => {
      if (element.parentElement?.classList?.contains("gnss-threat-indicator")) element.parentElement.dataset.state = element.dataset.state || "waiting";
    });
    refreshLocalClock(now);
  }
  function osnmaCodeDescription(group, code) { return OSNMA_STATUS_LABELS[group][code] || `Unknown status (${code})`; }
  function formatOsnmaClock(timestamp) { return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  function renderRetainedOsnmaCode(element, key, group, currentCode, idleCodes, waitingText) {
    const retained = retainedOsnmaCodes[key];
    const currentDescription = osnmaCodeDescription(group, currentCode);
    if (!retained) {
      element.textContent = waitingText;
      element.title = `Current receiver status ${currentCode}: ${currentDescription}. No completed result has been reported yet.`;
      return;
    }
    const retainedDescription = osnmaCodeDescription(group, retained.code);
    element.textContent = `${retainedDescription}; ${formatOsnmaClock(retained.receivedAt)}`;
    element.title = `Last result ${retained.code}: ${retainedDescription}, reported ${formatOsnmaClock(retained.receivedAt)}. Current receiver status ${currentCode}: ${currentDescription}${idleCodes.includes(currentCode) ? " (waiting/no new result)" : ""}.`;
  }

  function parseRxmSfrbx(payload) {
    if (payload.length < 8 || payload[0] !== 2 || payload[2] !== 1) return;
    const wordCount = payload[4];
    if (!wordCount || payload.length < 8 + wordCount * 4) return;
    const svId = payload[1]; const words = []; const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (let index = 0; index < wordCount; index++) words.push(data.getUint32(8 + index * 4, true).toString(16).padStart(8, "0").toUpperCase());
    const satellite = osnmaFrames.get(svId) || { svId, count: 0 };
    satellite.count += 1; satellite.lastReceived = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); satellite.words = words;
    osnmaFrames.set(svId, satellite); osnmaE1bFrameCount += 1;
    if (!replayRebuilding) renderOsnma();
  }

  function parseNavTimeGal(payload) {
    if (payload.length < 16) return;
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const galTow = data.getUint32(4, true); const galWeek = data.getInt16(12, true); const valid = payload[15];
    osnmaGalileoTime = (valid & 0x03) === 0x03 ? `GST week ${galWeek}, ${galTow} ms` : "NAV-TIMEGAL received; GST not valid yet";
    if (!replayRebuilding) renderOsnma();
  }

  function parseSecOsnma(payload) {
    if (payload.length < 28 || payload[0] !== 3) return;
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const dsm = data.getUint32(16, true); const tesla = data.getUint32(20, true); const general = data.getUint32(24, true);
    const satelliteCount = general & 0x3f; const availableCount = Math.floor((payload.length - 28) / 4); const satellites = [];
    for (let index = 0; index < Math.min(satelliteCount, availableCount); index++) {
      const offset = 28 + index * 4; const bitfield = data.getUint16(offset, true);
      satellites.push({ iode: bitfield & 0x03ff, authCount: (bitfield >>> 10) & 0x1f, authStatus: (bitfield >>> 15) & 0x01, svId: payload[offset + 2] });
    }
    const header = payload[1]; const monitoring = data.getUint16(2, true); const timeSync = payload[4];
    latestOsnmaStatus = {
      version: payload[0], headerAuthStatus: header & 0x01, nmaStatus: (header >>> 1) & 0x03,
      chainInForce: (header >>> 3) & 0x03, cpks: (header >>> 5) & 0x07,
      osnmaEnabled: monitoring & 0x01, numSvs: (monitoring >>> 1) & 0x1f,
      timSyncEnabled: timeSync & 0x01, timSyncStatus: (timeSync >>> 1) & 0x07, timSyncReqDiff: data.getInt32(8, true),
      dsmAuthenticationStatus: dsm & 0x3f, pubKeyId: (dsm >>> 10) & 0x0f, fromNvs: (dsm >>> 30) & 0x01,
      teslaKeyAuthStatus: tesla & 0x07, wnSf: (tesla >>> 3) & 0x0fff, towSf: (tesla >>> 15) & 0x7fff,
      satelliteCount, timingAuthResult: (general >>> 12) & 0x03,
      merkleRootValid: (general >>> 19) & 0x01, pubKeyValid: (general >>> 23) & 0x01, satellites,
    };
    const receivedAt = Date.now();
    latestOsnmaStatus.receivedAt = receivedAt;
    latestOsnmaStatus.connectionId = liveConnectionId;
    if (latestOsnmaStatus.headerAuthStatus === 1) retainedOsnmaCodes.headerAuth = { code: latestOsnmaStatus.headerAuthStatus, receivedAt };
    if (latestOsnmaStatus.dsmAuthenticationStatus !== 0) retainedOsnmaCodes.dsm = { code: latestOsnmaStatus.dsmAuthenticationStatus, receivedAt };
    if (![0, 3].includes(latestOsnmaStatus.teslaKeyAuthStatus)) retainedOsnmaCodes.tesla = { code: latestOsnmaStatus.teslaKeyAuthStatus, receivedAt };
    if (latestOsnmaStatus.timingAuthResult !== 0) retainedOsnmaCodes.timing = { code: latestOsnmaStatus.timingAuthResult, receivedAt };
    if (trustedClockSample && ![3, 4].includes(latestOsnmaStatus.timSyncStatus)) trustedClockSample.awaitingCheck = false;
    if ([3, 4].includes(latestOsnmaStatus.timSyncStatus)) {
      const previousCheck = latestOsnmaTimeCheck;
      const authenticated = hasAuthenticatedOsnmaTiming(latestOsnmaStatus);
      latestOsnmaTimeCheck = { differenceMs: latestOsnmaStatus.timSyncReqDiff, status: latestOsnmaStatus.timSyncStatus, receivedAt, trustedClockSample: trustedClockSample && !trustedClockSample.awaitingCheck ? trustedClockSample : null, authenticated };
      if (!authenticated && previousCheck?.authenticated && latestOsnmaTimeCheck.status === 3 && previousCheck.trustedClockSample === latestOsnmaTimeCheck.trustedClockSample && previousCheck.differenceMs === latestOsnmaTimeCheck.differenceMs) latestOsnmaTimeCheck = previousCheck;
    }
    for (const satellite of satellites) osnmaSatelliteResults.set(satellite.svId, { ...satellite, receivedAt });
    if (!replayRebuilding) renderOsnma();
  }

  function readOsnmaXmlText(xml, tag, scope = xml) {
    const element = scope.getElementsByTagName(tag)[0];
    if (!element?.textContent?.trim()) throw new Error(`OSNMA package is missing ${tag}`);
    return element.textContent.trim();
  }

  function readDerElement(bytes, offset) {
    if (offset + 2 > bytes.length) throw new Error("Malformed X.509 certificate");
    const tag = bytes[offset++]; let length = bytes[offset++];
    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      if (!lengthBytes || lengthBytes > 4 || offset + lengthBytes > bytes.length) throw new Error("Malformed X.509 length");
      length = 0;
      for (let index = 0; index < lengthBytes; index++) length = length * 256 + bytes[offset++];
    }
    const contentOffset = offset; const end = contentOffset + length;
    if (end > bytes.length) throw new Error("Truncated X.509 certificate");
    return { tag, contentOffset, end };
  }

  function certificateSpki(pem) {
    const certificateBlock = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
    if (!certificateBlock) throw new Error("X.509 certificate block is missing");
    const base64 = certificateBlock[1].replace(/\s/g, "");
    const der = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const certificate = readDerElement(der, 0); const tbs = readDerElement(der, certificate.contentOffset);
    let offset = tbs.contentOffset; let field = readDerElement(der, offset);
    if (field.tag === 0xa0) offset = field.end;
    for (let index = 0; index < 5; index++) offset = readDerElement(der, offset).end;
    field = readDerElement(der, offset);
    if (field.tag !== 0x30) throw new Error("X.509 public key is missing");
    return der.slice(offset, field.end);
  }

  async function importOsnmaCertificateKey(file, extractable = false) {
    const spki = certificateSpki(await file.text());
    return crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, extractable, ["verify"]);
  }

  function base64UrlBytes(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
  }

  function bytesToHex(bytes) { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase(); }

  function parseHexBytes(value, length, label) {
    if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(value)) throw new Error(`${label} must be ${length} bytes of hexadecimal data`);
    return Uint8Array.from(value.match(/../g), (part) => Number.parseInt(part, 16));
  }

  function findOsnmaFile(files, name, label) {
    const matches = files.filter((file) => file.name === name);
    if (matches.length !== 1) throw new Error(`${label} file ${name} was not found exactly once`);
    return matches[0];
  }

  async function buildOsnmaAssistance(files) {
    const publicXmlFiles = files.filter((file) => /^OSNMA_PublicKey_.+\.xml$/i.test(file.name));
    const merkleXmlFiles = files.filter((file) => /^OSNMA_MerkleTree_.+\.xml$/i.test(file.name));
    if (publicXmlFiles.length !== 1 || merkleXmlFiles.length !== 1) throw new Error("Select the folder containing one OSNMA public-key package and one Merkle-tree package");
    const publicKeyFile = publicXmlFiles[0]; const merkleFile = merkleXmlFiles[0];
    const parser = new DOMParser();
    const publicXml = parser.parseFromString(await publicKeyFile.text(), "application/xml");
    const merkleXml = parser.parseFromString(await merkleFile.text(), "application/xml");
    if (publicXml.querySelector("parsererror") || merkleXml.querySelector("parsererror")) throw new Error("An OSNMA XML file could not be parsed");

    const pkid = Number(readOsnmaXmlText(publicXml, "PKID"));
    const publicKeyType = readOsnmaXmlText(publicXml, "PKType");
    const publicKeyPoint = readOsnmaXmlText(publicXml, "point").toUpperCase();
    if (!Number.isInteger(pkid) || pkid < 0 || pkid > 15) throw new Error("OSNMA public-key ID is outside the receiver’s supported range");
    if (publicKeyType !== "ECDSA P-256/SHA-256" || !/^0[23][0-9A-F]{64}$/.test(publicKeyPoint)) throw new Error("Only a compressed ECDSA P-256 OSNMA public key is supported");
    if (readOsnmaXmlText(publicXml, "State") !== "Applicable") throw new Error("The OSNMA public key is not marked applicable");
    if (Date.parse(readOsnmaXmlText(publicXml, "Begin")) > Date.now()) throw new Error("The OSNMA public key is not applicable yet");

    const merklePublicKey = merkleXml.getElementsByTagName("PublicKey")[0];
    if (Number(readOsnmaXmlText(merkleXml, "PKID", merklePublicKey)) !== pkid || readOsnmaXmlText(merkleXml, "point", merklePublicKey).toUpperCase() !== publicKeyPoint) throw new Error("The public-key and Merkle packages do not match");
    if (readOsnmaXmlText(merkleXml, "N") !== "16" || readOsnmaXmlText(merkleXml, "HashFunction") !== "SHA-256") throw new Error("The Merkle package is not a supported 16-leaf SHA-256 tree");
    const treeNode = [...merkleXml.getElementsByTagName("TreeNode")].find((node) => readOsnmaXmlText(merkleXml, "j", node) === "4" && readOsnmaXmlText(merkleXml, "i", node) === "0");
    if (!treeNode || readOsnmaXmlText(merkleXml, "lengthInBits", treeNode) !== "256") throw new Error("The Merkle package has no 256-bit root node");
    const merkleState = readOsnmaXmlText(merkleXml, "State");
    if (merkleState !== "Applicable") throw new Error("The Merkle root is not marked applicable");
    const merkleBegin = Date.parse(readOsnmaXmlText(merkleXml, "Begin"));
    if (!Number.isFinite(merkleBegin)) throw new Error("The Merkle package has an invalid applicability date");

    const keyCertificate = findOsnmaFile(files, readOsnmaXmlText(publicXml, "Certificate"), "Public-key certificate");
    findOsnmaFile(files, readOsnmaXmlText(publicXml, "CRL"), "Public-key CRL");
    const merkleCertificate = findOsnmaFile(files, readOsnmaXmlText(merkleXml, "SignatureVerificationCertificate"), "Merkle signature certificate");
    const signatureFile = findOsnmaFile(files, readOsnmaXmlText(merkleXml, "SignatureFile"), "Merkle signature");
    const keyCertificateKey = await importOsnmaCertificateKey(keyCertificate, true);
    const keyJwk = await crypto.subtle.exportKey("jwk", keyCertificateKey);
    const keyX = base64UrlBytes(keyJwk.x); const keyY = base64UrlBytes(keyJwk.y);
    const certificatePoint = `${keyY[keyY.length - 1] & 1 ? "03" : "02"}${bytesToHex(keyX)}`;
    if (certificatePoint !== publicKeyPoint) throw new Error("The public-key XML point does not match its certificate");

    const signatureHex = (await signatureFile.text()).trim();
    const signature = parseHexBytes(signatureHex, 64, "Merkle XML signature");
    const merkleSignerKey = await importOsnmaCertificateKey(merkleCertificate);
    const signatureValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, merkleSignerKey, signature, await merkleFile.arrayBuffer());
    if (!signatureValid) throw new Error("Merkle XML signature verification failed");

    const keyPayload = new Uint8Array(72); keyPayload[0] = 0x07; keyPayload[1] = 0x00; keyPayload[2] = (0x01 << 4) | pkid;
    keyPayload.set(parseHexBytes(publicKeyPoint, 33, "OSNMA public-key point"), 4);
    const merklePayload = new Uint8Array(36); merklePayload[0] = 0x08; merklePayload[1] = 0x00; merklePayload[2] = merkleBegin > Date.now() ? 0x01 : 0x00;
    merklePayload.set(parseHexBytes(readOsnmaXmlText(merkleXml, "x_ji", treeNode), 32, "Merkle root"), 4);
    return { pkid, keyPayload, merklePayload };
  }

  function parseSecSig(payload) {
    secSigRawFramesReceived += 1;
    if (!payload.length) { secSecuritySummary.innerHTML = `<strong>SEC-SIG:</strong> ${secSigRawFramesReceived} empty frame${secSigRawFramesReceived === 1 ? "" : "s"} received.`; return; }
    const version = payload[0];
    let jamEnabled; let jamState; let spoofEnabled; let spoofState; let frequencyCount = 0; let frequencyOffset = 0;
    if (version === 1 && payload.length >= 9) {
      jamEnabled = payload[4] & 0x01; jamState = (payload[4] >> 1) & 0x03;
      spoofEnabled = payload[8] & 0x01; spoofState = (payload[8] >> 1) & 0x07;
    } else if (version >= 2 && payload.length >= 4) {
      jamEnabled = payload[1] & 0x01; jamState = (payload[1] >> 1) & 0x03;
      spoofEnabled = (payload[1] >> 3) & 0x01; spoofState = (payload[1] >> 4) & 0x07;
      frequencyCount = Math.min(payload[3], Math.floor((payload.length - 4) / 4)); frequencyOffset = 4;
    } else {
      secSecuritySummary.innerHTML = `<strong>SEC-SIG:</strong> ${secSigRawFramesReceived} frame${secSigRawFramesReceived === 1 ? "" : "s"} received, but v${version} payload length ${payload.length} is not decoded yet.`;
      return;
    }
    const epoch = ++signalEpoch.sec;
    secSigFramesReceived += 1;
    appendHistory(signalHistory.secJam, { epoch, value: jamState });
    appendHistory(signalHistory.secSpoof, { epoch, value: spoofState });
    receiverThreat.secJam = jamState;
    receiverThreat.secSpoof = spoofState;
    receiverThreat.secJamEnabled = Boolean(jamEnabled);
    receiverThreat.secSpoofEnabled = Boolean(spoofEnabled);
    const jammedFrequencies = [];
    for (let index = 0; index < frequencyCount; index++) {
      const offset = frequencyOffset + index * 4; const packed = payload[offset] | (payload[offset + 1] << 8) | (payload[offset + 2] << 16) | (payload[offset + 3] << 24);
      if (!(payload[offset + 3] & 0x01)) continue;
      const frequency = (packed & 0x00ffffff) * 1000;
      appendHistory(signalHistory.secFrequency, { epoch, value: frequency }); jammedFrequencies.push(frequency);
    }
    if (!jammedFrequencies.length) appendHistory(signalHistory.secFrequency, { epoch, value: null });
    const jamNames = ["Unknown", "None", "Warning", "Critical"]; const spoofNames = ["Unknown", "None", "Indicated", "Affirmed"];
    secSecuritySummary.innerHTML = `<strong>SEC-SIG v${version}:</strong> ${secSigFramesReceived} decoded frame${secSigFramesReceived === 1 ? "" : "s"} (${secSigRawFramesReceived} raw); jamming detection ${jamEnabled ? "on" : "off"}, ${jamNames[jamState] || jamState}; spoof detection ${spoofEnabled ? "on" : "off"}, ${spoofNames[spoofState] || spoofState}; jammed frequencies ${jammedFrequencies.length ? jammedFrequencies.map((value) => `${(value / 1e6).toFixed(3)} MHz`).join(", ") : "none"}.`;
    signalsEmpty.hidden = true; if (!replayRebuilding) drawSignals();
  }

  function parseSecSigLog(payload) {
    if (payload.length < 8) return;
    const count = Math.min(payload[1], Math.floor((payload.length - 8) / 8));
    const detectionNames = ["Unknown", "Jamming", "Spoofing"]; const eventNames = ["Stopped", "Started", "Triggered", "Ongoing"];
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    for (let index = 0; index < count; index++) {
      const offset = 8 + index * 8; const elapsed = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, true); const detection = payload[offset + 4]; const event = payload[offset + 5];
      secEvents.unshift(`${now}  ${detectionNames[detection] || `Type ${detection}`} - ${eventNames[event] || `Event ${event}`} (${elapsed} ms ago)`);
    }
    if (secEvents.length > 25) secEvents.length = 25;
    secEventLog.innerHTML = `<strong>SEC-SIGLOG:</strong>\n${secEvents.length ? secEvents.join("\n") : "no events."}`;
    signalsEmpty.hidden = true;
  }

  function appendData(chunk) {
    const merged = new Uint8Array(receiveBuffer.length + chunk.length); merged.set(receiveBuffer); merged.set(chunk, receiveBuffer.length); receiveBuffer = merged;
    while (receiveBuffer.length >= 8) {
      let start = 0; while (start + 1 < receiveBuffer.length && !(receiveBuffer[start] === 0xb5 && receiveBuffer[start + 1] === 0x62)) start++;
      if (start > 0) receiveBuffer = receiveBuffer.slice(start); if (receiveBuffer.length < 8) return;
      const payloadLength = receiveBuffer[4] | (receiveBuffer[5] << 8); const totalLength = payloadLength + 8; if (receiveBuffer.length < totalLength) return;
      const [a, b] = checksum(receiveBuffer.slice(2, totalLength - 2));
      if (a === receiveBuffer[totalLength - 2] && b === receiveBuffer[totalLength - 1]) { handleUbx(receiveBuffer[2], receiveBuffer[3], receiveBuffer.slice(6, totalLength - 2)); receiveBuffer = receiveBuffer.slice(totalLength); } else receiveBuffer = receiveBuffer.slice(1);
    }
  }

  function handleUbx(messageClass, messageId, payload) {
    if (pendingInterfacePoll && messageClass === 0x0a && messageId === 0x36) pendingInterfacePoll(parseMonCommsInterface(payload));
    if (messageClass === 0x05 && (messageId === 0x01 || messageId === 0x00)) receiveConfigAck(messageId, payload);
    if (messageClass === 0x13 && messageId === 0x60) receiveMgaAck(payload);
    if (messageClass === 0x0a && messageId === 0x31) parseMonSpan(payload);
    if (messageClass === 0x01 && messageId === 0x07) parseNavPvt(payload);
    if ((messageClass === 0x01 || messageClass === 0x29) && messageId === 0x21) parseNavTimeUtc(payload);
    if (messageClass === 0x01 && messageId === 0x35) parseNavSat(payload);
    if (messageClass === 0x01 && messageId === 0x43) parseNavSig(payload);
    if (messageClass === 0x02 && messageId === 0x15) parseRawx(payload);
    if (messageClass === 0x0a && messageId === 0x38) parseMonRf(payload);
    if (messageClass === 0x01 && messageId === 0x03) parseNavStatus(payload);
    if (messageClass === 0x27 && messageId === 0x09) parseSecSig(payload);
    if (messageClass === 0x27 && messageId === 0x10) parseSecSigLog(payload);
    if (messageClass === 0x27 && messageId === 0x0a) parseSecOsnma(payload);
    if (messageClass === 0x29 && messageId === 0x35) parseNavSat(payload); // NAV2-SAT on newer X20 firmware
    if (messageClass === 0x29 && messageId === 0x07) parseNavPvt(payload); // NAV2-PVT on newer X20 firmware
    if (messageClass === 0x29 && messageId === 0x43) parseNavSig(payload); // NAV2-SIG on newer X20 firmware
    if (messageClass === 0x02 && messageId === 0x13) parseRxmSfrbx(payload);
    if ((messageClass === 0x01 || messageClass === 0x29) && messageId === 0x25) parseNavTimeGal(payload);
  }

  function parseMonCommsInterface(payload) {
    const headerBytes = 8;
    const minimumPortBytes = 16;
    if (payload.length < headerBytes || payload[0] !== 0) return null;
    const portCount = payload[1];
    if (!portCount || (payload.length - headerBytes) % portCount !== 0) return null;
    const portBytes = (payload.length - headerBytes) / portCount;
    if (portBytes < minimumPortBytes) return null;
    const portNames = new Map([[0x0000, "I2C"], [0x0100, "UART1"], [0x0200, "UART2"], [0x0300, "USB"], [0x0400, "SPI"]]);
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let activePort = null;
    for (let index = 0; index < portCount; index++) {
      const offset = headerBytes + index * portBytes;
      const portId = data.getUint16(offset, true);
      const txBytes = data.getUint32(offset + 4, true);
      const rxBytes = data.getUint32(offset + 12, true);
      const name = portNames.get(portId);
      if (name && txBytes > 0 && rxBytes > 0 && (!activePort || txBytes + rxBytes > activePort.activity)) activePort = { name, activity: txBytes + rxBytes };
    }
    return activePort?.name || null;
  }

  function parseMonSpan(payload) {
    if (payload.length < 4) return;
    const usable = Math.min(payload[1], Math.floor((payload.length - 4) / BLOCK_BYTES)); if (!usable) return; if (blockViews.length !== usable) buildBlocks(usable);
    const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const pgaEpoch = ++signalEpoch.pga;
    const now = new Date();
    const markerSlot = Math.floor(now.getTime() / (settings.waterfallMarkerMinutes * 60 * 1000));
    for (let index = 0; index < usable; index++) {
      const offset = 4 + index * BLOCK_BYTES; const bins = payload.slice(offset, offset + BIN_COUNT); const span = data.getUint32(offset + 256, true); const center = data.getUint32(offset + 264, true); const pga = payload[offset + 268]; const view = blockViews[index];
      view.averageHistory.push(bins); while (view.averageHistory.length > settings.averageFrames) view.averageHistory.shift();
      const average = new Float32Array(BIN_COUNT); view.averageHistory.forEach((historyBins) => { for (let bin = 0; bin < BIN_COUNT; bin++) average[bin] += historyBins[bin]; }); for (let bin = 0; bin < BIN_COUNT; bin++) average[bin] /= view.averageHistory.length;
      if (!view.peak) view.peak = Float32Array.from(bins); else for (let bin = 0; bin < BIN_COUNT; bin++) view.peak[bin] = Math.max(bins[bin], view.peak[bin] - settings.peakDecay);
      if (view.lastMarkerSlot === null) view.lastMarkerSlot = markerSlot;
      else if (markerSlot !== view.lastMarkerSlot) {
        const boundary = new Date(markerSlot * settings.waterfallMarkerMinutes * 60 * 1000);
        view.timestampMarkers.push({ frame: view.waterfallFrame, label: boundary.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) });
        view.lastMarkerSlot = markerSlot;
      }
      view.timestampMarkers = view.timestampMarkers.filter((marker) => view.waterfallFrame - marker.frame < view.rowCount);
      view.frame = { center, span, pga, bins, average }; view.rows.set(bins, view.row * BIN_COUNT); view.timestamps[view.row] = now.getTime(); view.row = (view.row + 1) % view.rowCount; view.filledRows = Math.min(view.rowCount, view.filledRows + 1); if (view.row === 0) view.hasRows = true; view.waterfallFrame += 1; view.meta.textContent = `${formatHz(center - span / 2)} - ${formatHz(center + span / 2)} | span ${formatHz(span)} | PGA ${pga}dB`; scheduleViewDraw(view);
      latestPga[index] = pga;
    }
    if (signalHistory.pga.length && !replayRebuilding) drawSignals();
    if (!replayRebuilding) setStatus(`Receiving MON-SPAN: ${usable} RF block${usable === 1 ? "" : "s"}`);
  }

  function ubxFrame(messageClass, messageId, payload) { const bytes = new Uint8Array(payload.length + 8); bytes.set([0xb5, 0x62, messageClass, messageId, payload.length & 0xff, payload.length >> 8]); bytes.set(payload, 6); const [a, b] = checksum(bytes.slice(2, -2)); bytes[bytes.length - 2] = a; bytes[bytes.length - 1] = b; return bytes; }
  function stopSecSigPolling() { if (secSigPollTimer !== null) { clearInterval(secSigPollTimer); secSigPollTimer = null; } }
  function startSecSigPolling() {
    stopSecSigPolling();
    if (receiver.value !== "x20" || !writer) return;
    const poll = async () => { try { await writer.write(ubxFrame(0x27, 0x09, new Uint8Array(0))); } catch { /* The normal reader/disconnect path reports transport failures. */ } };
    poll();
    secSigPollTimer = setInterval(poll, 1000);
    if (!secSigFramesReceived) secSecuritySummary.innerHTML = "<strong>SEC-SIG:</strong> awaiting X20 security data; polling once per second.";
  }
  function waitForValsetAck(name) {
    return new Promise((resolve) => {
      const pending = { name, resolve, timeout: null };
      pending.timeout = setTimeout(() => {
        const index = pendingConfigAcks.indexOf(pending);
        if (index >= 0) pendingConfigAcks.splice(index, 1);
        resolve("timeout");
      }, 3000);
      pendingConfigAcks.push(pending);
    });
  }
  function waitForMgaAck(messagePayload, messageId) {
    let pending;
    const promise = new Promise((resolve) => {
      pending = { messageId, prefix: messagePayload.slice(0, 4), resolve, timeout: null };
      pending.timeout = setTimeout(() => {
        const index = pendingMgaAcks.indexOf(pending);
        if (index >= 0) pendingMgaAcks.splice(index, 1);
        resolve({ accepted: false, message: "receiver acknowledgement timed out" });
      }, 4000);
      pendingMgaAcks.push(pending);
    });
    return { pending, promise };
  }
  function receiveMgaAck(payload) {
    if (payload.length < 8 || payload[1] !== 0) return;
    const index = pendingMgaAcks.findIndex((pending) => pending.messageId === payload[3] && pending.prefix.every((value, byte) => payload[4 + byte] === value));
    if (index < 0) return;
    const pending = pendingMgaAcks.splice(index, 1)[0]; clearTimeout(pending.timeout);
    const infoCode = payload[2]; pending.resolve({ accepted: payload[0] === 1 && infoCode === 0, infoCode });
  }
  async function sendMgaAssistance(payload, messageId = 0x02) {
    const acknowledgement = waitForMgaAck(payload, messageId);
    try { await writer.write(ubxFrame(0x13, messageId, payload)); }
    catch (error) {
      const index = pendingMgaAcks.indexOf(acknowledgement.pending);
      if (index >= 0) pendingMgaAcks.splice(index, 1);
      clearTimeout(acknowledgement.pending.timeout);
      acknowledgement.pending.resolve({ accepted: false, message: "serial write failed" });
    }
    return acknowledgement.promise;
  }
  async function sendTrustedClockTime(offsetMs = 0) {
    if (trustedClockUpdatePending) return { accepted: false, message: "trusted UTC update already in progress" };
    const connectionId = liveConnectionId;
    trustedClockUpdatePending = true;
    trustedClockSample = null;
    refreshLocalClock();
    try {
      const result = await sendMgaAssistance(buildTrustedComputerUtcPayload(offsetMs), 0x40);
      if (result.accepted && connectionId === liveConnectionId) trustedClockSample = { offsetMs, connectionId, awaitingCheck: true };
      return result;
    } catch (error) {
      return { accepted: false, message: error.message };
    } finally {
      trustedClockUpdatePending = false;
      refreshLocalClock();
    }
  }
  function buildTrustedComputerUtcPayload(offsetMs = 0) {
    const now = new Date(Date.now() + offsetMs);
    const payload = new Uint8Array(24); const data = new DataView(payload.buffer);
    payload[0] = 0x10; payload[1] = 0x00; payload[2] = 0x00; payload[3] = 0x80;
    data.setUint16(4, now.getUTCFullYear(), true); payload[6] = now.getUTCMonth() + 1; payload[7] = now.getUTCDate();
    payload[8] = now.getUTCHours(); payload[9] = now.getUTCMinutes(); payload[10] = now.getUTCSeconds(); payload[11] = 0x01;
    data.setUint32(12, now.getUTCMilliseconds() * 1000000, true);
    data.setUint16(16, osnmaClockSettings.accuracySeconds, true);
    return payload;
  }
  async function provisionOsnmaFolder() {
    if (!writer) { osnmaProvisionStatus.textContent = "Connect a receiver before provisioning."; return; }
    if (!osnmaFolderPicker.files.length) return;
    osnmaProvisionButton.disabled = true;
    osnmaTrustStatus.textContent = "Validating package";
    osnmaProvisionStatus.textContent = "Checking key, Merkle root, and package signature...";
    let bundle = null; let keyAccepted = false;
    try {
      bundle = await buildOsnmaAssistance([...osnmaFolderPicker.files]);
      osnmaProvisionStatus.textContent = `Sending PKID ${bundle.pkid} to receiver...`;
      const keyResult = await sendMgaAssistance(bundle.keyPayload);
      if (!keyResult.accepted) throw new Error(keyResult.message || `Receiver rejected the public key (MGA-ACK ${keyResult.infoCode})`);
      keyAccepted = true;
      osnmaTrustStatus.textContent = `PKID ${bundle.pkid} accepted; Merkle root pending`;
      osnmaProvisionStatus.textContent = "Public key accepted; sending current Merkle root...";
      const merkleResult = await sendMgaAssistance(bundle.merklePayload);
      if (!merkleResult.accepted) throw new Error(merkleResult.message || `Receiver rejected the Merkle root (MGA-ACK ${merkleResult.infoCode})`);
      osnmaTrustStatus.textContent = `PKID ${bundle.pkid} and Merkle root accepted`;
      osnmaProvisionStatus.textContent = "Receiver accepted the public key and Merkle root. This app does not verify navigation authentication.";
    } catch (error) {
      osnmaTrustStatus.textContent = keyAccepted ? `PKID ${bundle.pkid} accepted; Merkle root not confirmed` : "Not provisioned";
      osnmaProvisionStatus.textContent = `Provisioning failed: ${error.message}`;
    } finally {
      osnmaFolderPicker.value = "";
      osnmaProvisionButton.disabled = !writer;
    }
  }
  function receiveConfigAck(messageId, payload) {
    if (payload.length < 2 || payload[0] !== 0x06 || payload[1] !== 0x8a || !pendingConfigAcks.length) return;
    const pending = pendingConfigAcks.shift(); clearTimeout(pending.timeout);
    pending.resolve(messageId === 0x01 ? "ack" : "nak");
  }
  async function sendValset(name, key, value = 1, valueBytes = 1) {
    const payload = new Uint8Array(8 + valueBytes); const data = new DataView(payload.buffer); payload[1] = 1; data.setUint32(4, key, true);
    if (valueBytes === 1) payload[8] = value;
    else if (valueBytes === 2) data.setUint16(8, value, true);
    else data.setUint32(8, value, true);
    const acknowledgement = waitForValsetAck(name);
    try { await writer.write(ubxFrame(0x06, 0x8a, payload)); }
    catch (error) {
      const pending = pendingConfigAcks.find((item) => item.name === name);
      if (pending) { clearTimeout(pending.timeout); pendingConfigAcks.splice(pendingConfigAcks.indexOf(pending), 1); pending.resolve("write failed"); }
    }
    return acknowledgement;
  }
  function showConfigResults(results) {
    const resultLabel = (result) => result === "ack" ? "ACK" : result === "nak" ? "NAK" : result === "timeout" ? "unconfirmed" : result;
    const resultClass = (result) => result === "ack" ? "config-result-ok" : result === "nak" ? "config-result-nak" : result === "timeout" ? "config-result-unconfirmed" : "config-result-write-failed";
    const resultColor = (result) => result === "ack" ? "#66ff88" : result === "nak" || result === "write failed" ? "#ff7262" : "#ffff66";
    const hasErrors = results.some((item) => item.result === "nak" || item.result === "write failed");
    const hasUnconfirmed = results.some((item) => item.result === "timeout");
    configurationStatus.className = `configuration-light ${hasErrors ? "config-error" : hasUnconfirmed ? "config-warning" : "config-ok"}`;
    configurationStatus.setAttribute("aria-label", hasErrors ? "Configuration has rejected settings" : hasUnconfirmed ? "Configuration has unconfirmed settings" : "Configuration accepted");
    configurationTooltip.innerHTML = `Configuration: ${results.map((item) => `<span class="${resultClass(item.result)}" style="color:${resultColor(item.result)}">${item.name} ${resultLabel(item.result)}</span>`).join(" | ")}`;
  }
  async function detectReceiverInterface() {
    receiverInterface.textContent = "Interface: detecting...";
    const interfaceName = await new Promise((resolve) => {
      const timeout = setTimeout(() => pendingInterfacePoll?.(null), 1500);
      pendingInterfacePoll = (name) => { clearTimeout(timeout); pendingInterfacePoll = null; resolve(name); };
      writer.write(ubxFrame(0x0a, 0x36, new Uint8Array(0))).catch(() => pendingInterfacePoll?.(null));
    });
    receiverInterface.textContent = interfaceName ? `Interface: ${interfaceName}` : "Interface: unknown (MON-COMMS reported no active RX/TX port)";
  }

  function receiverInterfaceRequests(requests, allInterfaces) {
    const interfaces = allInterfaces
      ? [["I2C", -1, 0x10720000], ["UART1", 0, 0x10740000], ["UART2", 1, 0x10760000], ["USB", 2, 0x10780000], ["SPI", 3, 0x107a0000]]
      : [["UART1", 0, 0x10740000]];
    const protocolRequests = interfaces.flatMap(([name, offset, protocolKey]) => [
      [`${name} UBX output on`, protocolKey + 1, 1, 1],
      [`${name} NMEA output off`, protocolKey + 2, 0, 1],
    ]);
    return protocolRequests.concat(requests.flatMap(([name, key, value, valueBytes]) => {
      if (name === "UART1 NMEA output off") return [];
      if (!name.endsWith(" UART1")) return [[name, key, value, valueBytes]];
      return interfaces.map(([interfaceName, offset]) => [name.replace(/UART1$/, interfaceName), key + offset, value, valueBytes]);
    }));
  }

  async function configureMonSpan() {
    if (!writer) return;
    configureButton.disabled = true;
    try {
      const requests = [
        ["UART1 NMEA output off", 0x10740002, 0, 4],
        ["Measurement rate 1 Hz", 0x30210001, 1000, 2],
        ["Navigation rate", 0x30210002, 1, 2],
        ["MON-SPAN UART1", 0x2091038c, 1, 1],
        ["NAV-PVT UART1", 0x20910007, 1, 1],
        ["NAV-TIMEUTC UART1", 0x2091005c, 1, 1],
        ["NAV-SAT UART1", 0x20910016, 1, 1],
        ["NAV-STATUS UART1", 0x2091001b, 1, 1],
        ["Assistance message ACKs", 0x10110025, 1, 1],
        ["Galileo OSNMA enabled", 0x10350005, 1, 1],
        [osnmaClockSettings.useComputerClock ? "Require trusted computer time" : "OSNMA without trusted computer time", 0x10350009, osnmaClockSettings.useComputerClock ? 1 : 0, 1],
        ["SEC-OSNMA UART1", 0x209106cb, 1, 1],
        ["RXM-RAWX UART1", 0x209102a5, 1, 1],
        ["RXM-SFRBX UART1", 0x20910232, 1, 1],
        ["NAV-TIMEGAL UART1", 0x20910057, 1, 1],
        ["MON-RF UART1", 0x2091035a, 1, 1],
      ];
      if (receiver.value === "x20") requests.push(
        ["NAV2 output enabled", 0x10170001, 1, 4],
        ["Galileo enabled", 0x10310021, 1, 4],
        ["Galileo E1 enabled", 0x10310007, 1, 4], ["Galileo E5a enabled", 0x10310009, 1, 4],
        ["Galileo E5b enabled", 0x1031000a, 1, 4], ["Galileo E6 enabled", 0x1031000b, 1, 4],
        ["QZSS enabled", 0x10310024, 1, 4],
        ["QZSS L1CA enabled", 0x10310012, 1, 4], ["QZSS L2C enabled", 0x10310015, 1, 4], ["QZSS L5 enabled", 0x10310017, 1, 4],
        ["NAV2-PVT UART1", 0x20910491, 1, 1],
        ["NAV2-SAT UART1", 0x20910496, 1, 1],
        ["NAV2-SIG UART1", 0x20910506, 1, 1],
        ["NAV2-TIMEGAL UART1", 0x20910531, 1, 1],
        ["SEC-SIG UART1", 0x20910635, 1, 1],
        ["SEC-SIGLOG UART1", 0x2091068a, 1, 1],
      );
      configurationStatus.className = "configuration-light config-pending"; configurationStatus.setAttribute("aria-label", "Configuration in progress"); configurationTooltip.textContent = "Configuration: waiting for ACK/NAK responses...";
      const results = [];
      for (const [name, key, value, valueBytes] of receiverInterfaceRequests(requests, settings.configureAllInterfaces)) results.push({ name, result: await sendValset(name, key, value, valueBytes) });
      trustedClockSample = null;
      osnmaTrustedTimeStatus.textContent = "Configuration updated; send trusted UTC explicitly when ready.";
      showConfigResults(results);
      startSecSigPolling();
      setStatus(`Configuration completed for ${receiver.value.toUpperCase()}; waiting for NAV and monitoring data`);
    } catch (error) { setStatus(`Configuration failed: ${error.message}`); }
    finally { configureButton.disabled = false; refreshLocalClock(); }
  }

  async function reconnectAtBaud(rate) {
    reading = false;
    if (reader) await reader.cancel().catch(() => {});
    if (writer) { writer.releaseLock(); writer = null; }
    if (port) await port.close();
    await port.open({ baudRate: rate, bufferSize: 1 << 20 });
    writer = port.writable.getWriter(); reading = true; readPort();
    settings.baudByReceiver[receiver.value] = rate; saveSettings(); baud.value = String(rate);
  }

  async function applyReceiverBaud(rate) {
    if (!port || !writer) {
      settings.baudByReceiver[receiver.value] = rate; saveSettings(); baud.value = String(rate);
      return "saved";
    }
    configurationStatus.className = "status-item";
    configurationStatus.textContent = `Configuration: changing UART1 to ${rate.toLocaleString("en-US").replaceAll(",", " ")}...`;
    const result = await sendValset("UART1 baud rate", 0x40520001, rate, 4);
    showConfigResults([{ name: "UART1 baud rate", result }]);
    if (result !== "ack") throw new Error(`UART1 baud rate change ${result}`);
    await reconnectAtBaud(rate);
    setStatus(`Reconnected at ${rate.toLocaleString("en-US").replaceAll(",", " ")}`);
    return result;
  }

  function defaultLogName() { return `ubx-${new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19)}.ubx`; }
  function isRecording() { return recordingActive; }
  function startRecording() {
    if (!port || isRecording()) return;
    recordingActive = true; recordingChunks = []; recordingName = defaultLogName();
    recordButton.textContent = "Stop recording"; recordButton.classList.add("recording");
    setStatus(`Recording incoming data; ${recordingName} will download when stopped`);
  }
  function recordChunk(chunk) {
    if (!recordingActive) return;
    recordingChunks.push(chunk.slice());
  }
  async function stopRecording() {
    if (!isRecording()) return;
    const chunks = recordingChunks; const fileName = recordingName || defaultLogName();
    recordingActive = false; recordingChunks = null; recordingName = null; recordButton.textContent = "Start recording"; recordButton.classList.remove("recording"); recordButton.disabled = true;
    try {
      const url = URL.createObjectURL(new Blob(chunks, { type: "application/octet-stream" }));
      const download = document.createElement("a"); download.href = url; download.download = fileName; download.hidden = true;
      document.body.append(download); download.click(); download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Recording saved as ${fileName}`);
    } catch (error) { setStatus(`Could not save recording: ${error.message}`); }
    finally { recordButton.disabled = !port; }
  }
  async function readPort() { while (port && port.readable && reading) { reader = port.readable.getReader(); try { while (reading) { const { value, done } = await reader.read(); if (done) break; if (value) { recordChunk(value); appendData(value); } } } catch (error) { if (reading) setStatus(`Port read failed: ${error.message}`); } finally { reader.releaseLock(); reader = null; } } }
  function formatBytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }
  function updatePlaybackControls() {
    const total = replayData?.length || 0;
    playbackScrubber.max = String(Math.max(total, 1)); playbackScrubber.value = String(Math.min(replayOffset, total));
    playbackPosition.textContent = `${formatBytes(replayOffset)} (${total ? Math.round(replayOffset * 100 / total) : 0}%)`;
    playbackTotal.textContent = formatBytes(total);
    const icon = playbackToggle.querySelector(".material-symbols-outlined");
    icon.textContent = replayPlaying ? "pause" : "play_arrow";
    playbackToggle.lastElementChild.textContent = replayPlaying ? "Pause" : "Play";
  }
  function pauseReplay() {
    replayPlaying = false; replayLastTimestamp = null; replayByteBudget = 0;
    if (replayAnimationFrame !== null) cancelAnimationFrame(replayAnimationFrame);
    replayAnimationFrame = null; updatePlaybackControls();
  }
  function replayFrameGroup(messageClass, messageId) {
    if (messageClass === 0x0a && messageId === 0x31) return "span";
    if ((messageClass === 0x01 || messageClass === 0x29) && messageId === 0x07) return "position";
    if ((messageClass === 0x01 || messageClass === 0x29) && (messageId === 0x35 || messageId === 0x43)) return "cno";
    if (messageClass === 0x02 && messageId === 0x15) return "rawx";
    if (messageClass === 0x0a && messageId === 0x38) return "monrf";
    if (messageClass === 0x01 && messageId === 0x03) return "navstatus";
    if (messageClass === 0x27 && messageId === 0x09) return "secsig";
    if (messageClass === 0x27 && messageId === 0x10) return "secsiglog";
    if (messageClass === 0x27 && messageId === 0x0a) return "osnmaStatus";
    if (messageClass === 0x02 && messageId === 0x13) return "osnma";
    if ((messageClass === 0x01 || messageClass === 0x29) && messageId === 0x25) return "osnma";
    return null;
  }
  function indexReplayFrames(bytes) {
    const frames = [];
    for (let start = 0; start + 7 < bytes.length;) {
      if (bytes[start] !== 0xb5 || bytes[start + 1] !== 0x62) { start += 1; continue; }
      const payloadLength = bytes[start + 4] | (bytes[start + 5] << 8); const end = start + payloadLength + 8;
      if (end > bytes.length) { start += 1; continue; }
      const [a, b] = checksum(bytes.subarray(start + 2, end - 2));
      if (a !== bytes[end - 2] || b !== bytes[end - 1]) { start += 1; continue; }
      const messageClass = bytes[start + 2]; const messageId = bytes[start + 3]; const group = replayFrameGroup(messageClass, messageId);
      if (group) frames.push({ end, messageClass, messageId, group, payloadStart: start + 6, payloadEnd: end - 2 });
      start = end;
    }
    return frames;
  }
  function rebuildReplayViewsAtOffset(offset) {
    replaySeekAnimationFrame = null; resetReplayDerivedViews(false);
    let frameEnd = 0;
    while (frameEnd < replayFrames.length && replayFrames[frameEnd].end <= offset) frameEnd += 1;
    const limits = { span: Math.max(settings.waterfallMinutes * WATERFALL_ROWS_PER_MINUTE, settings.averageFrames), position: 3600, cno: HISTORY_LENGTH * 2, rawx: HISTORY_LENGTH, monrf: 3600, navstatus: 3600, secsig: 3600, secsiglog: 25, osnma: 3600, osnmaStatus: 600 };
    const counts = {}; const selectedFrames = [];
    for (let index = frameEnd - 1; index >= 0; index--) {
      const frame = replayFrames[index]; const count = counts[frame.group] || 0;
      if (count >= limits[frame.group]) continue;
      counts[frame.group] = count + 1; selectedFrames.push(frame);
    }
    replayRebuilding = true;
    try {
      selectedFrames.reverse().forEach((frame) => handleUbx(frame.messageClass, frame.messageId, replayData.subarray(frame.payloadStart, frame.payloadEnd)));
    } finally { replayRebuilding = false; }
    blockViews.forEach((view) => draw(view));
    if (positionFixes.length) { drawPositionTrack(); if (!positionPanel.hidden) updatePositionMap(positionFixes[positionFixes.length - 1]); }
    drawSignals(); renderOsnma();
    setStatus(`Replay paused at ${replayData?.length ? Math.round(offset * 100 / replayData.length) : 0}%`);
  }
  function scheduleReplayViewRebuild(offset) {
    if (replaySeekAnimationFrame !== null) cancelAnimationFrame(replaySeekAnimationFrame);
    replaySeekAnimationFrame = requestAnimationFrame(() => rebuildReplayViewsAtOffset(offset));
  }
  function replayTick(timestamp) {
    if (!replayPlaying || !replayData) return;
    if (replayLastTimestamp === null) replayLastTimestamp = timestamp;
    const elapsed = Math.min(timestamp - replayLastTimestamp, 250); replayLastTimestamp = timestamp;
    const bytesPerSecond = Math.max(960, Number(baud.value) || 115200) / 10 * Number(playbackSpeed.value);
    replayByteBudget += bytesPerSecond * elapsed / 1000;
    const byteCount = Math.min(Math.floor(replayByteBudget), 262144, replayData.length - replayOffset);
    if (byteCount > 0) {
      appendData(replayData.subarray(replayOffset, replayOffset + byteCount)); replayOffset += byteCount; replayByteBudget -= byteCount;
      updatePlaybackControls();
    }
    if (replayOffset >= replayData.length) {
      pauseReplay(); setStatus(`Replay complete: ${replayName}`); return;
    }
    replayAnimationFrame = requestAnimationFrame(replayTick);
  }
  function playReplay() {
    if (!replayData || replayPlaying) return;
    if (replayOffset >= replayData.length) { replayOffset = 0; receiveBuffer = new Uint8Array(0); resetReplayDerivedViews(); }
    if (replaySeekAnimationFrame !== null) { cancelAnimationFrame(replaySeekAnimationFrame); rebuildReplayViewsAtOffset(replayOffset); }
    replayPlaying = true; replayLastTimestamp = null; replayByteBudget = 0; updatePlaybackControls();
    setStatus(`Replaying ${replayName} at ${playbackSpeed.value}×`); replayAnimationFrame = requestAnimationFrame(replayTick);
  }
  function seekReplay(offset) {
    pauseReplay(); replayOffset = Math.max(0, Math.min(Number(offset), replayData?.length || 0)); receiveBuffer = new Uint8Array(0);
    updatePlaybackControls(); scheduleReplayViewRebuild(replayOffset);
  }
  function showPlayback() {
    if (!replayData) return;
    if (!playbackDialog.open) playbackDialog.show();
    requestAnimationFrame(clampPlaybackPosition);
    showPlaybackButton.hidden = false; showPlaybackButton.disabled = true; setStatus(`Replay ready: ${replayName}`);
  }
  function hidePlayback() {
    pauseReplay(); if (playbackDialog.open) playbackDialog.close(); showPlaybackButton.hidden = false; showPlaybackButton.disabled = false; setStatus("Playback hidden");
  }
  function endPlayback() {
    pauseReplay();
    if (replaySeekAnimationFrame !== null) cancelAnimationFrame(replaySeekAnimationFrame);
    replaySeekAnimationFrame = null; replayData = null; replayFrames = []; replayName = ""; replayOffset = 0; receiveBuffer = new Uint8Array(0);
    if (playbackDialog.open) playbackDialog.close(); playbackDialog.classList.remove("collapsed");
    playbackDialog.style.removeProperty("left"); playbackDialog.style.removeProperty("right"); playbackDialog.style.removeProperty("top");
    playbackCollapse.querySelector(".material-symbols-outlined").textContent = "expand_less"; playbackCollapse.setAttribute("aria-label", "Collapse playback"); playbackCollapse.title = "Collapse playback";
    playbackSpeed.value = "1"; playbackFile.textContent = "No file selected"; updatePlaybackControls();
    resetReplayDerivedViews(); output.replaceChildren(); blockViews = []; empty.hidden = false;
    connectButton.textContent = "Connect port"; connectButton.disabled = false; configureButton.disabled = true; recordButton.disabled = true; replayButton.disabled = false; showPlaybackButton.hidden = true; showPlaybackButton.disabled = false; receiver.disabled = false; baud.disabled = false;
    activateTab("spectrum"); setStatus("Waiting for a port");
  }
  function togglePlaybackCollapse() {
    const collapsed = playbackDialog.classList.toggle("collapsed");
    playbackCollapse.querySelector(".material-symbols-outlined").textContent = collapsed ? "expand_more" : "expand_less";
    playbackCollapse.setAttribute("aria-label", collapsed ? "Expand playback" : "Collapse playback");
    playbackCollapse.title = collapsed ? "Expand playback" : "Collapse playback";
  }
  function clampPlaybackPosition() {
    if (!playbackDialog.open) return;
    const bounds = playbackDialog.getBoundingClientRect();
    playbackDialog.style.right = "auto";
    playbackDialog.style.left = `${Math.max(0, Math.min(innerWidth - bounds.width, bounds.left))}px`;
    playbackDialog.style.top = `${Math.max(0, Math.min(innerHeight - bounds.height, bounds.top))}px`;
  }
  async function replayFile() {
    if (!("showOpenFilePicker" in window)) { setStatus("Replay requires Chrome or Edge over localhost/HTTPS"); return; }
    try {
      const [fileHandle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: "u-blox binary log", accept: { "application/octet-stream": [".ubx"] } }] });
      pauseReplay();
      const file = await fileHandle.getFile(); resetReplayDerivedViews(false); replayData = new Uint8Array(await file.arrayBuffer()); replayFrames = indexReplayFrames(replayData); replayName = file.name; replayOffset = 0; receiveBuffer = new Uint8Array(0);
      playbackFile.textContent = replayName; playbackTotal.textContent = formatBytes(replayData.length); connectButton.disabled = true; receiver.disabled = true; baud.disabled = true;
      buildBlocks(receiverBlockCount()); pauseReplay(); showPlayback();
    } catch (error) { if (error.name !== "AbortError") setStatus(`Replay failed: ${error.message}`); }
  }
  function hasValidUbxFrame(bytes) {
    for (let start = 0; start + 7 < bytes.length; start++) {
      if (bytes[start] !== 0xb5 || bytes[start + 1] !== 0x62) continue;
      const payloadLength = bytes[start + 4] | (bytes[start + 5] << 8); const end = start + payloadLength + 8;
      if (end > bytes.length) continue;
      const [a, b] = checksum(bytes.slice(start + 2, end - 2));
      if (a === bytes[end - 2] && b === bytes[end - 1]) return true;
    }
    return false;
  }
  function hasValidNmeaSentence(bytes) {
    for (let start = 0; start < bytes.length; start++) {
      if (bytes[start] !== 0x24) continue;
      const end = bytes.indexOf(0x0a, start);
      if (end < 0) continue;
      const sentence = new TextDecoder().decode(bytes.slice(start, end)).trim();
      const separator = sentence.indexOf("*");
      if (separator < 1 || separator + 3 !== sentence.length) continue;
      let checksumValue = 0;
      for (let index = 1; index < separator; index++) checksumValue ^= sentence.charCodeAt(index);
      if (checksumValue === Number.parseInt(sentence.slice(separator + 1), 16)) return true;
    }
    return false;
  }
  async function probeBaudRate(candidatePort, rate) {
    let probeReader = null; let probeWriter = null; let probeBuffer = new Uint8Array(0);
    try {
      await candidatePort.open({ baudRate: rate, bufferSize: 1 << 20 });
      probeReader = candidatePort.readable.getReader();
      probeWriter = candidatePort.writable.getWriter();
      // MON-VER is a read-only UBX poll. It allows detection even when the firmware
      // has no periodic message output enabled after an upgrade or reset.
      await probeWriter.write(ubxFrame(0x0a, 0x04, new Uint8Array(0)));
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        const result = await Promise.race([probeReader.read(), new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining))]);
        if (result.timeout || result.done) break;
        if (!result.value) continue;
        const merged = new Uint8Array(probeBuffer.length + result.value.length); merged.set(probeBuffer); merged.set(result.value, probeBuffer.length); probeBuffer = merged.slice(-8192);
        if (hasValidUbxFrame(probeBuffer) || hasValidNmeaSentence(probeBuffer)) return true;
      }
      return false;
    } catch (error) {
      // Wrong baud rates can cause Web Serial to reject reads with a framing error.
      // That is an expected probe miss, not a connection failure.
      return false;
    } finally {
      if (probeWriter) probeWriter.releaseLock();
      if (probeReader) { await probeReader.cancel().catch(() => {}); probeReader.releaseLock(); }
      if (candidatePort.readable || candidatePort.writable) await candidatePort.close().catch(() => {});
    }
  }
  async function detectBaudRate(candidatePort) {
    const preferred = settings.baudByReceiver[receiver.value] || DEFAULT_SETTINGS.baudByReceiver[receiver.value];
    // Recent X20 firmware commonly returns to 38 400 after an update/reset.
    // Probe it first before an old saved rate can trigger a framing error.
    const firstChoice = receiver.value === "x20" ? 38400 : preferred;
    const candidates = [firstChoice, preferred, ...BAUD_RATES.filter((rate) => rate !== firstChoice && rate !== preferred)];
    for (const rate of candidates) {
      setStatus(`Detecting baud: ${rate.toLocaleString("en-US").replaceAll(",", " ")}`);
      try { if (await probeBaudRate(candidatePort, rate)) return rate; }
      catch { /* A port-specific probe failure is treated as a miss. */ }
    }
    throw new Error("No valid UBX data found at the supported baud rates");
  }
  async function connect() {
    if (!("serial" in navigator)) { setStatus("Web Serial requires Chrome or Edge over localhost/HTTPS"); return; }
    connectButton.disabled = true;
    try {
      const selectedPort = await navigator.serial.requestPort();
      const rate = baud.value === "auto" ? await detectBaudRate(selectedPort) : Number(baud.value);
      await selectedPort.open({ baudRate: rate, bufferSize: 1 << 20 });
      port = selectedPort; writer = port.writable.getWriter(); reading = true;
      resetLocalClock();
      settings.baudByReceiver[receiver.value] = rate; saveSettings(); baud.value = String(rate);
      connectButton.textContent = "Disconnect"; configureButton.disabled = true; recordButton.disabled = false; replayButton.disabled = true; showPlaybackButton.hidden = true; receiver.disabled = true; baud.disabled = true; buildBlocks(receiverBlockCount()); readPort(); await detectReceiverInterface(); await configureMonSpan(); setStatus(`Connected at ${rate.toLocaleString("en-US").replaceAll(",", " ")}; waiting for UBX data`);
    } catch (error) { setStatus(`Connection failed: ${error.message}`); }
    finally { connectButton.disabled = false; }
  }
  async function disconnect() { reading = false; resetLocalClock(); stopSecSigPolling(); if (reader) await reader.cancel(); if (writer) { writer.releaseLock(); writer = null; } if (port) { await port.close(); port = null; } if (isRecording()) await stopRecording(); receiverInterface.textContent = "Interface: --"; connectButton.textContent = "Connect port"; configureButton.disabled = true; recordButton.disabled = true; replayButton.disabled = false; receiver.disabled = false; baud.disabled = false; setStatus("Disconnected"); }

  connectButton.addEventListener("click", () => port ? disconnect() : connect());
  recordButton.addEventListener("click", () => isRecording() ? stopRecording() : startRecording());
  replayButton.addEventListener("click", replayFile);
  showPlaybackButton.addEventListener("click", showPlayback);
  playbackToggle.addEventListener("click", () => replayPlaying ? pauseReplay() : playReplay());
  playbackEnd.addEventListener("click", endPlayback);
  playbackScrubber.addEventListener("input", () => seekReplay(playbackScrubber.value));
  playbackSpeed.addEventListener("change", () => { if (replayPlaying) setStatus(`Replaying ${replayName} at ${playbackSpeed.value}×`); });
  playbackCollapse.addEventListener("click", togglePlaybackCollapse);
  playbackClose.addEventListener("click", hidePlayback);
  playbackDialog.addEventListener("cancel", (event) => { event.preventDefault(); hidePlayback(); });
  playbackHead.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const bounds = playbackDialog.getBoundingClientRect(); playbackDrag = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    playbackDialog.style.right = "auto";
    playbackHead.setPointerCapture(event.pointerId);
  });
  playbackHead.addEventListener("pointermove", (event) => {
    if (!playbackDrag) return;
    const maxLeft = Math.max(0, innerWidth - playbackDialog.offsetWidth); const maxTop = Math.max(0, innerHeight - playbackDialog.offsetHeight);
    playbackDialog.style.left = `${Math.max(0, Math.min(maxLeft, playbackDrag.left + event.clientX - playbackDrag.x))}px`;
    playbackDialog.style.top = `${Math.max(0, Math.min(maxTop, playbackDrag.top + event.clientY - playbackDrag.y))}px`;
  });
  playbackHead.addEventListener("pointerup", () => { playbackDrag = null; });
  playbackHead.addEventListener("pointercancel", () => { playbackDrag = null; });
  window.addEventListener("resize", clampPlaybackPosition);
  receiver.addEventListener("change", () => { settings.lastReceiver = receiver.value; saveSettings(); syncReceiverBaud(); });
  baud.addEventListener("change", () => { if (baud.value !== "auto") { settings.baudByReceiver[receiver.value] = Number(baud.value); saveSettings(); } });
  receiver.value = settings.lastReceiver;
  syncReceiverBaud();
  syncOsnmaClockForm();
  refreshOsnmaIndicators();
  refreshOsnmaClock();
  setInterval(refreshOsnmaIndicators, 1000);
  setInterval(refreshOsnmaClock, 100);
  configureButton.addEventListener("click", configureMonSpan);
  osnmaTrustComputerClock.addEventListener("change", updateOsnmaClockSettings);
  osnmaClockAccuracy.addEventListener("change", updateOsnmaClockSettings);
  osnmaClockLocalTime.addEventListener("change", updateOsnmaClockSettings);
  osnmaSendTrustedTime.addEventListener("click", sendTrustedTimeNow);
  osnmaUpdateLocalTime.addEventListener("click", updateLocalClock);
  osnmaProvisionButton.addEventListener("click", () => {
    if (!writer) { osnmaProvisionStatus.textContent = "Connect a receiver before provisioning."; return; }
    osnmaProvisionStatus.textContent = "Select the folder containing the OSNMA XML, certificates, CRL, and signature.";
    osnmaFolderPicker.click();
  });
  osnmaFolderPicker.addEventListener("change", provisionOsnmaFolder);
  function activateTab(active) {
    const showPosition = active === "position";
    const showSignals = active === "signals";
    const showOsnma = active === "osnma";
    spectrumTab.classList.toggle("active", !showPosition && !showSignals && !showOsnma); spectrumTab.setAttribute("aria-selected", String(!showPosition && !showSignals && !showOsnma)); spectrumPanel.hidden = showPosition || showSignals || showOsnma;
    positionTab.classList.toggle("active", showPosition); positionTab.setAttribute("aria-selected", String(showPosition)); positionPanel.hidden = !showPosition;
    signalsTab.classList.toggle("active", showSignals); signalsTab.setAttribute("aria-selected", String(showSignals)); signalsPanel.hidden = !showSignals;
    osnmaTab.classList.toggle("active", showOsnma); osnmaTab.setAttribute("aria-selected", String(showOsnma)); osnmaPanel.hidden = !showOsnma;
    if (showPosition) {
      drawPositionTrack();
      if (positionMap) positionMap.invalidateSize(); else if (mapLibreMap) mapLibreMap.resize(); else if (positionFixes.length) updatePositionMap(positionFixes[positionFixes.length - 1]);
    }
    if (showSignals) drawSignals();
  }
  spectrumTab.addEventListener("click", () => activateTab("spectrum"));
  positionTab.addEventListener("click", () => activateTab("position"));
  signalsTab.addEventListener("click", () => activateTab("signals"));
  osnmaTab.addEventListener("click", () => activateTab("osnma"));
  constellationFilter.addEventListener("change", (event) => {
    if (!event.target.matches("input[type=checkbox]")) return;
    const constellation = Number(event.target.value);
    if (event.target.checked) activeConstellations.add(constellation); else activeConstellations.delete(constellation);
    drawSignals();
  });
  settingsButton.addEventListener("click", () => { syncSettingsForm(); settingsDialog.showModal(); });
  settingsClose.addEventListener("click", () => settingsDialog.close());
  settingsReset.addEventListener("click", () => { Object.assign(settings, DEFAULT_SETTINGS); syncSettingsForm(); });
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextBaud = Number(receiverBaud.value);
    const interfacesChanged = settings.configureAllInterfaces !== configureAllInterfaces.checked;
    const currentBaud = settings.baudByReceiver[receiver.value] || DEFAULT_SETTINGS.baudByReceiver[receiver.value];
    const nextSettings = { showAverage: showAverage.checked, averageFrames: Math.max(1, Math.min(120, Number(averageFrames.value) || DEFAULT_SETTINGS.averageFrames)), showPeak: showPeak.checked, peakDecay: Math.max(0, Math.min(30, Number(peakDecay.value) || 0)), darkMap: darkMap.checked, waterfallMinutes: Math.max(5, Math.min(30, Number(waterfallMinutes.value) || DEFAULT_SETTINGS.waterfallMinutes)), waterfallMarkerMinutes: Math.max(1, Math.min(10, Number(waterfallMarkerMinutes.value) || DEFAULT_SETTINGS.waterfallMarkerMinutes)), baudByReceiver: { ...settings.baudByReceiver } };
    const markerIntervalChanged = nextSettings.waterfallMarkerMinutes !== settings.waterfallMarkerMinutes; const durationChanged = nextSettings.waterfallMinutes !== settings.waterfallMinutes; const blockCount = blockViews.length;
    nextSettings.configureAllInterfaces = configureAllInterfaces.checked;
    nextSettings.lastReceiver = receiver.value;
    const mapThemeChanged = nextSettings.darkMap !== settings.darkMap;
    settings = nextSettings; resetTraceBuffers(); if (durationChanged && blockCount) buildBlocks(blockCount); else if (markerIntervalChanged) blockViews.forEach((view) => { view.timestampMarkers = []; view.lastMarkerSlot = null; }); if (mapThemeChanged) updateMapTiles(); saveSettings();
    try { if (nextBaud !== currentBaud) await applyReceiverBaud(nextBaud); if (interfacesChanged && writer) await configureMonSpan(); settingsDialog.close(); }
    catch (error) { setStatus(`Baud change failed: ${error.message}`); }
  });
  navigator.serial?.addEventListener("disconnect", () => { if (port) disconnect(); });
})();
