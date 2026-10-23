const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const monCommsProbePath = path.join(__dirname, "..", "tools", "mon-comms-probe", "probe.cjs");
const monCommsProbe = fs.existsSync(monCommsProbePath) ? require(monCommsProbePath) : null;

const source = fs.readFileSync(path.join(__dirname, "..", "scope.js"), "utf8").replace(/\r\n/g, "\n");

function loadFunctions(names, globals) {
  const context = vm.createContext(globals);
  const functions = names.map((name) => {
    const declaration = new RegExp(`  (?:async )?function ${name}\\(`).exec(source);
    const start = declaration?.index ?? -1;
    assert.notEqual(start, -1, `Missing function ${name}`);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  });
  vm.runInContext(functions.join("\n"), context);
  return context;
}

function workingStatus() {
  return {
    receivedAt: 90000, connectionId: 1, osnmaEnabled: 1, nmaStatus: 2, cpks: 1,
    headerAuthStatus: 1, pubKeyValid: 1, merkleRootValid: 1, teslaKeyAuthStatus: 1,
    timingAuthResult: 1, timSyncEnabled: 1, timSyncStatus: 3, dsmAuthenticationStatus: 1, satellites: [],
  };
}

test("browser script parses", () => {
  assert.doesNotThrow(() => new vm.Script(source));
});

test("legacy settings preserve OSNMA and default position source to NAV", () => {
  const defaults = { configureAllInterfaces: false, enableOsnma: true, enableGalHas: false, positionSource: "NAV", showAverage: true, averageFrames: 10, showPeak: true, peakDecay: 0.5, darkMap: false, waterfallMinutes: 10, waterfallMarkerMinutes: 5, lastReceiver: "f9p", baudByReceiver: { f9p: 115200, x20: 38400 } };
  const context = loadFunctions(["loadSettings"], {
    DEFAULT_SETTINGS: defaults,
    SETTINGS_KEY: "settings",
    localStorage: { getItem: () => JSON.stringify({ lastReceiver: "x20", baudByReceiver: { x20: 38400 } }) },
  });
  const settings = context.loadSettings();
  assert.equal(settings.enableOsnma, true);
  assert.equal(settings.enableGalHas, false);
  assert.equal(settings.positionSource, "NAV");
  assert.equal(settings.lastReceiver, "x20");
});

test("position-source setting keeps NAV2 preference for X20 but falls back to NAV on F9P", () => {
  const select = { value: "", disabled: false, title: "" };
  const note = { hidden: true };
  const context = loadFunctions(["syncPositionSourceForm", "positionSourceForReceiver"], {
    settings: { positionSource: "NAV2" }, receiver: { value: "f9p" }, positionSourceSelect: select, positionSourceNote: note,
  });
  context.syncPositionSourceForm();
  assert.equal(select.value, "NAV2");
  assert.equal(select.disabled, true);
  assert.equal(note.hidden, false);
  assert.equal(context.positionSourceForReceiver("f9p", select.value), "NAV");
  context.receiver.value = "x20";
  context.syncPositionSourceForm();
  assert.equal(select.disabled, false);
  assert.equal(note.hidden, true);
  assert.equal(context.positionSourceForReceiver("x20", select.value), "NAV2");
});

test("HAS settings disable on F9P and warn for the unsupported X20 combination", () => {
  const label = { title: "" };
  const context = loadFunctions(["updateGnssIntegritySettingsForm"], {
    receiver: { value: "f9p" },
    enableOsnma: { checked: true },
    enableGalHas: { checked: true, disabled: false, title: "", closest: () => label },
    hasSupportNote: { hidden: true },
    gnssIntegrityWarning: { hidden: true },
  });
  context.updateGnssIntegritySettingsForm();
  assert.equal(context.enableGalHas.disabled, true);
  assert.equal(context.hasSupportNote.hidden, false);
  assert.equal(context.gnssIntegrityWarning.hidden, true);
  context.receiver.value = "x20";
  context.updateGnssIntegritySettingsForm();
  assert.equal(context.enableGalHas.disabled, false);
  assert.equal(context.hasSupportNote.hidden, true);
  assert.equal(context.gnssIntegrityWarning.hidden, false);
});

test("canvas PNG export downloads a timestamped PNG and revokes its object URL", () => {
  let exportedBlob;
  let exportType;
  let revokedUrl;
  let scheduledCleanup;
  let exportCanvas;
  let copiedCanvas;
  const captionLines = [];
  const anchor = { clickCount: 0, click() { this.clickCount += 1; }, remove() { this.removed = true; } };
  const context = loadFunctions(["canvasPngFilename", "downloadCanvasPng"], {
    window: { devicePixelRatio: 1 },
    URL: {
      createObjectURL(blob) { exportedBlob = blob; return "blob:graph"; },
      revokeObjectURL(url) { revokedUrl = url; },
    },
    document: {
      createElement(tag) {
        if (tag === "a") return anchor;
        const drawing = {
          fillRect() {}, drawImage(canvas) { copiedCanvas = canvas; },
          fillText(text) { captionLines.push(text); },
        };
        exportCanvas = {
          width: 0, height: 0, getContext: () => drawing,
          toBlob(callback, type) { exportType = type; callback({ type }); },
        };
        return exportCanvas;
      },
      body: { append(element) { this.appended = element; } },
    },
    setTimeout(callback, delay) { scheduledCleanup = { callback, delay }; },
    setStatus() {},
  });
  const timestamp = new Date("2026-10-18T12:34:56.000Z");
  assert.equal(context.canvasPngFilename("RF Block 1 Spectrum", timestamp), "rf-block-1-spectrum-2026-10-18T12-34-56-000Z.png");
  const canvas = { width: 100, height: 200 };
  context.downloadCanvasPng(canvas, "Position Track", () => "Cursor: PSD 42 dB");
  assert.equal(exportType, "image/png");
  assert.equal(exportedBlob.type, "image/png");
  assert.equal(exportCanvas.width, 100);
  assert.equal(exportCanvas.height, 244);
  assert.equal(copiedCanvas, canvas);
  assert.deepEqual(captionLines, ["Position Track", "Cursor: PSD 42 dB"]);
  assert.equal(anchor.download.startsWith("position-track-"), true);
  assert.equal(anchor.download.endsWith(".png"), true);
  assert.equal(anchor.href, "blob:graph");
  assert.equal(anchor.clickCount, 1);
  assert.equal(anchor.removed, true);
  assert.equal(scheduledCleanup.delay, 1000);
  scheduledCleanup.callback();
  assert.equal(revokedUrl, "blob:graph");
});

test("signal charts handle accumulated multi-satellite histories without argument overflow", () => {
  const labels = [];
  const drawing = new Proxy({ fillText(text) { labels.push(text); } }, {
    get(target, property) { return target[property] ?? (() => {}); },
  });
  const canvas = { getContext: () => drawing };
  const context = loadFunctions(["drawSignalChart"], {
    sizeCanvas: () => ({ width: 800, height: 400 }), window: { devicePixelRatio: 1 },
    HISTORY_LENGTH: 600, signalChartState: new Map(), signalHover: new Map(),
  });
  const series = Array.from({ length: 300 }, (_, satellite) => ({
    color: "#ffffff",
    values: Array.from({ length: 600 }, (_, index) => ({ epoch: 3600 + index + satellite, value: satellite - index })),
  }));
  assert.doesNotThrow(() => context.drawSignalChart(canvas, series, {}));
  assert.equal(context.signalChartState.get(canvas).lastEpoch, 4498);
  assert.equal(context.signalChartState.get(canvas).firstEpoch, 3899);
  assert.equal(labels[0], "299");
  assert.equal(labels[4], "-599");
  labels.length = 0;
  assert.doesNotThrow(() => context.drawSignalChart(canvas, series, { min: 0, max: 55 }));
  assert.equal(labels[0], "55");
  assert.equal(labels[4], "0");
  assert.doesNotThrow(() => context.drawSignalChart(canvas, [], {}));
});

test("signal chart keeps empty frequency epochs on the timeline without plotting them", () => {
  const labels = [];
  let plottedPoints = 0;
  const drawing = new Proxy({
    fillText(text) { labels.push(String(text)); },
    arc() { plottedPoints += 1; },
  }, { get(target, property) { return target[property] ?? (() => {}); } });
  const canvas = { getContext: () => drawing };
  const context = loadFunctions(["drawSignalChart"], {
    sizeCanvas: () => ({ width: 800, height: 400 }), window: { devicePixelRatio: 1 },
    HISTORY_LENGTH: 600, signalChartState: new Map(), signalHover: new Map(),
  });
  const series = [{ label: "Jammed frequency", color: "red", values: [
    { epoch: 1, value: 1575420000 }, { epoch: 2, value: null },
  ] }];
  context.drawSignalChart(canvas, series, { min: 1150000000, max: 1650000000, points: true });
  assert.equal(context.signalChartState.get(canvas).lastEpoch, 2);
  assert.equal(labels.at(-1), "2");
  assert.equal(plottedPoints, 1);
});

test("empty SEC-SIG frequency frames retain their epoch and detection state", () => {
  const context = loadFunctions(["parseSecSig"], {
    secSigRawFramesReceived: 0, secSigFramesReceived: 0,
    secSecuritySummary: { innerHTML: "" }, signalsEmpty: { hidden: true }, replayRebuilding: false,
    receiverThreat: { secJam: null, secSpoof: null, secJamEnabled: null, secSpoofEnabled: null },
    signalEpoch: { sec: 0 }, signalHistory: { secJam: [], secSpoof: [], secFrequency: [] },
    appendHistory(history, sample) { history.push(sample); }, drawSignals() {},
  });
  const payload = new Uint8Array([2, 0b00101011, 0, 0]);
  context.parseSecSig(payload);
  assert.equal(context.signalHistory.secFrequency[0].epoch, 1);
  assert.equal(context.signalHistory.secFrequency[0].value, null);
  assert.equal(context.receiverThreat.secJamEnabled, true);
  assert.equal(context.receiverThreat.secSpoofEnabled, true);
});

test("signal hover reports an empty frequency epoch as unavailable", () => {
  const readout = { innerHTML: "" };
  const canvas = { getBoundingClientRect: () => ({ left: 0 }), closest: () => ({ querySelector: () => readout }) };
  const context = loadFunctions(["updateSignalHover"], {
    signalChartState: new Map([[canvas, { series: [{ label: "Jammed frequency", color: "red", values: [{ epoch: 2, value: null }] }], box: { x: 0, width: 100 }, firstEpoch: 1, lastEpoch: 2 }]]),
    signalHover: new Map(), signalHoverPinned: new Set(), window: { devicePixelRatio: 1 }, drawSignals() {},
  });
  context.updateSignalHover(canvas, { clientX: 100 });
  assert.match(readout.innerHTML, /Jammed frequency: n\/a/);
});

test("GNSS threat summary distinguishes status severity and disabled detection", () => {
  const context = loadFunctions(["gnssThreatPresentation"], {});
  const check = (kind, value, label, state, enabled) => {
    const result = context.gnssThreatPresentation(kind, value, enabled);
    assert.equal(result.label, label);
    assert.equal(result.state, state);
  };
  check("monRfJam", null, "Waiting", "waiting");
  check("monRfJam", 1, "Normal", "good");
  check("secJam", 2, "Warning", "warning");
  check("secSpoof", 3, "Affirmed", "bad");
  check("secJam", 1, "Detection off", "off", false);
  check("navSpoof", 0, "Inactive", "off");
});

test("MON-COMMS selects a recognized port with both RX and TX activity", () => {
  const context = loadFunctions(["parseMonCommsInterface"], { receiverInterface: { title: "" } });
  const payload = new Uint8Array(8 + 2 * 40);
  payload[0] = 0; payload[1] = 2;
  const data = new DataView(payload.buffer);
  data.setUint16(8, 0x0300, true);
  data.setUint32(12, 10000, true);
  data.setUint32(20, 0, true);
  data.setUint16(48, 0x0100, true);
  data.setUint32(52, 500, true);
  data.setUint32(60, 700, true);
  assert.equal(context.parseMonCommsInterface(payload), "UART1");
  assert.match(context.receiverInterface.title, /USB: TX 10000, RX 0; UART1: TX 500, RX 700/);
  assert.equal(context.parseMonCommsInterface(new Uint8Array(8)), null);
  const truncated = new Uint8Array(8 + 2 * 15); truncated[1] = 2;
  assert.equal(context.parseMonCommsInterface(truncated), null);
  const malformed = new Uint8Array(8 + 2 * 40 + 1); malformed[1] = 2;
  assert.equal(context.parseMonCommsInterface(malformed), null);
});

test("UBX dispatcher routes MON-COMMS responses to the pending interface poll", () => {
  const resolved = [];
  const context = loadFunctions(["handleUbx"], {
    pendingInterfacePoll: (name) => resolved.push(name),
    parseMonCommsInterface: () => "USB",
  });
  context.handleUbx(0x0a, 0x36, new Uint8Array(0));
  assert.deepEqual(resolved, ["USB"]);
});

test("MON-VER parses firmware and receiver metadata", () => {
  const context = loadFunctions(["parseMonVer"], {
    TextDecoder,
    receiverFirmware: { textContent: "", title: "" },
    receiverFirmwareTimeout: null,
    clearTimeout,
  });
  const payload = new Uint8Array(40 + 3 * 30);
  const fields = ["SW version", "HW 1.00", "FWVER=HPG 2.11", "PROTVER=35.00", "MOD=ZED-X20P"];
  fields.forEach((field, index) => payload.set(Buffer.from(field), index < 2 ? (index === 0 ? 0 : 30) : 40 + (index - 2) * 30));
  const version = context.parseMonVer(payload);
  assert.equal(version.firmware, "HPG 2.11");
  assert.equal(version.model, "ZED-X20P");
  assert.equal(version.protocol, "35.00");
  assert.equal(context.receiverFirmware.textContent, "FW: HPG 2.11 (ZED-X20P)");
  assert.match(context.receiverFirmware.title, /Hardware: HW 1\.00; Protocol: 35\.00/);
});

test("UBX dispatcher routes MON-VER responses", () => {
  const payload = new Uint8Array([1]);
  const received = [];
  const context = loadFunctions(["handleUbx"], { pendingInterfacePoll: null, parseMonVer: (value) => received.push(value) });
  context.handleUbx(0x0a, 0x04, payload);
  assert.deepEqual(received, [payload]);
});

test("HAS configuration is only sent to X20 and feature values follow settings", () => {
  const context = loadFunctions(["gnssFeatureConfigurationRequests"], {});
  const requests = (receiverName, enableOsnma, enableGalHas) => JSON.parse(JSON.stringify(context.gnssFeatureConfigurationRequests(receiverName, enableOsnma, enableGalHas)));
  assert.deepEqual(requests("x20", true, true), [
    ["Galileo OSNMA", 0x10350005, 1, 1],
    ["Galileo HAS", 0x100d0002, 1, 1],
  ]);
  assert.deepEqual(requests("x20", false, false), [
    ["Galileo OSNMA", 0x10350005, 0, 1],
    ["Galileo HAS", 0x100d0002, 0, 1],
  ]);
  assert.deepEqual(requests("f9p", true, true), [["Galileo OSNMA", 0x10350005, 1, 1]]);
});

test("Configure all receiver interfaces controls X20 output routing", () => {
  const context = loadFunctions(["receiverInterfaceRequests"], { receiver: { value: "x20" } });
  const requestList = [
    ["UART1 NMEA output off", 0x10740002, 0, 4],
    ["MON-SPAN UART1", 0x2091038c, 1, 1],
    ["NAV-PVT UART1", 0x20910007, 1, 1],
  ];
  const requests = (allInterfaces) => JSON.parse(JSON.stringify(context.receiverInterfaceRequests(requestList, allInterfaces)));
  const uart1Only = requests(false);
  assert.ok(uart1Only.some(([name]) => name === "MON-SPAN UART1"));
  assert.ok(!uart1Only.some(([name]) => name === "MON-SPAN USB"));
  assert.ok(!uart1Only.some(([name]) => name === "USB UBX output on"));
  const allPorts = requests(true);
  assert.ok(allPorts.some(([name, key]) => name === "MON-SPAN USB" && key === 0x2091038e));
  assert.ok(allPorts.some(([name, key]) => name === "NAV-PVT USB" && key === 0x20910009));
  assert.ok(allPorts.some(([name]) => name === "USB UBX output on"));
});

test("NAV-SAT HAS correction flags count GPS and Galileo independently", () => {
  const context = loadFunctions(["parseHasCorrectionCounts"], { DataView });
  const payload = new Uint8Array(8 + 4 * 12);
  payload[5] = 4;
  const data = new DataView(payload.buffer);
  payload[8] = 0; payload[9] = 1;
  data.setUint32(16, 0x02000000, true);
  payload[20] = 2; payload[21] = 3;
  data.setUint32(28, 0x02000000, true);
  payload[32] = 0; payload[33] = 5;
  data.setUint32(40, 0x00000008, true);
  payload[44] = 6; payload[45] = 7;
  data.setUint32(52, 0x02000000, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseHasCorrectionCounts(payload))), { gps: 1, galileo: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.parseHasCorrectionCounts(new Uint8Array(7)))), null);
});

test("interface detection polls MON-COMMS and displays its parsed result", async () => {
  let writtenFrame;
  const context = loadFunctions(["detectReceiverInterface", "ubxFrame", "checksum"], {
    receiverInterface: { textContent: "" }, pendingInterfacePoll: null,
    writer: { write(frame) { writtenFrame = frame; return Promise.resolve(); } },
    setTimeout, clearTimeout,
  });
  const detecting = context.detectReceiverInterface();
  assert.equal(writtenFrame[2], 0x0a);
  assert.equal(writtenFrame[3], 0x36);
  context.pendingInterfacePoll("USB");
  await detecting;
  assert.equal(context.receiverInterface.textContent, "Interface: USB");
});

test("Node MON-COMMS probe decodes bidirectional activity and split UBX frames", { skip: !monCommsProbe }, () => {
  const payload = Buffer.alloc(8 + 2 * 40);
  payload[0] = 0; payload[1] = 2;
  const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  data.setUint16(8, 0x0300, true);
  data.setUint32(12, 50000, true);
  data.setUint32(20, 0, true);
  data.setUint16(48, 0x0100, true);
  data.setUint32(52, 700, true);
  data.setUint32(60, 900, true);
  const result = monCommsProbe.parseMonCommsPayload(payload);
  assert.equal(result.recordBytes, 40);
  assert.equal(result.activeInterface, "UART1");
  assert.equal(monCommsProbe.formatInterfaceText(result.activeInterface, "COM26"), "Interface: UART1 (COM26)");
  assert.deepEqual(result.ports.map(({ name, active }) => `${name}:${active}`), ["USB:false", "UART1:true"]);

  const response = monCommsProbe.buildUbxFrame(0x0a, 0x36, payload);
  assert.equal(monCommsProbe.formatHex(response.subarray(0, 2)), "B5 62");
  const first = monCommsProbe.extractUbxFrames(Buffer.concat([Buffer.from([0x00]), response.subarray(0, 7)]));
  assert.equal(first.frames.length, 0);
  const second = monCommsProbe.extractUbxFrames(Buffer.concat([first.remainder, response.subarray(7)]));
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0][2], 0x0a);
  assert.equal(second.frames[0][3], 0x36);
});

test("map accepts only valid position fixes", () => {
  let trackDraws = 0;
  let mapUpdates = 0;
  const positionPanel = { hidden: true };
  const positionRecenter = { disabled: true };
  const positionZoomIn = { disabled: true };
  const positionZoomOut = { disabled: true };
  const context = loadFunctions(["parseNavPvt", "positionSourceForReceiver"], {
    receiver: { value: "x20" }, settings: { positionSource: "NAV" },
    DataView, positionFixes: [], positionEmpty: {}, positionInfo: {}, positionPanel, positionRecenter, positionZoomIn, positionZoomOut,
    receiverThreat: { monRfJam: 0, navSpoof: 0, secJam: 0, secSpoof: 0 }, replayRebuilding: false,
    latLonToUtm33: () => ({}), drawPositionTrack() { trackDraws += 1; }, updatePositionMap() { mapUpdates += 1; }, updateReceiverStatus() {}, refreshOsnmaClock() {},
  });
  for (const [fixType, flags, pointCount] of [[0, 0, 0], [5, 1, 0], [3, 0, 0], [2, 1, 1], [3, 1, 2], [4, 1, 3]]) {
    const payload = new Uint8Array(92);
    payload[20] = fixType; payload[21] = flags;
    context.parseNavPvt(payload);
    assert.equal(context.positionFixes.length, pointCount);
  }
  const nav2Fix = new Uint8Array(92); nav2Fix[20] = 3; nav2Fix[21] = 1;
  context.parseNavPvt(nav2Fix, "NAV2");
  assert.equal(context.positionFixes.length, 3);
  context.settings.positionSource = "NAV2";
  context.parseNavPvt(nav2Fix, "NAV2");
  assert.equal(context.positionFixes.length, 4);
  assert.equal(context.positionFixes.at(-1).positionSource, "NAV2");
  assert.equal(trackDraws, 0);
  assert.equal(mapUpdates, 0);
  assert.equal(positionRecenter.disabled, false);
  assert.equal(positionZoomIn.disabled, false);
  assert.equal(positionZoomOut.disabled, false);
  positionPanel.hidden = false;
  context.parseNavPvt(Object.assign(new Uint8Array(92), { 20: 3, 21: 1 }), "NAV2");
  assert.equal(trackDraws, 1);
  assert.equal(mapUpdates, 1);
});

test("NAV-PVT clock parsing retains confirmation flags and time accuracy", () => {
  const context = loadFunctions(["parseNavPvt", "positionSourceForReceiver"], { DataView, receiver: { value: "x20" }, settings: { positionSource: "NAV" }, refreshOsnmaClock() {} });
  const payload = new Uint8Array(92);
  const data = new DataView(payload.buffer);
  data.setUint16(4, 2026, true); payload[6] = 10; payload[7] = 19; payload[8] = 3; payload[9] = 4; payload[10] = 5;
  payload[11] = 0x37; data.setUint32(12, 80, true); data.setInt32(16, -250000000, true); data.setInt32(24, 1810000000, true);
  context.parseNavPvt(payload);
  assert.equal(context.latestPvtClock.utcMs, Date.UTC(2026, 9, 19, 3, 4, 4, 750));
  assert.equal(context.latestPvtClock.tAccNs, 80);
  assert.equal(context.latestPvtClock.validDate, true);
  assert.equal(context.latestPvtClock.validTime, true);
  assert.equal(context.latestPvtClock.fullyResolved, true);
  assert.equal(context.latestPvtClock.confirmedDate, true);
  assert.equal(context.latestPvtClock.confirmedTime, true);
});

test("NAV-TIMEUTC parsing retains UTC validity and accuracy", () => {
  const context = loadFunctions(["parseNavTimeUtc"], { DataView, refreshOsnmaClock() {} });
  const payload = new Uint8Array(20);
  const data = new DataView(payload.buffer);
  data.setUint32(4, 125, true); data.setInt32(8, 500000000, true); data.setUint16(12, 2026, true);
  payload[14] = 10; payload[15] = 19; payload[16] = 3; payload[17] = 4; payload[18] = 5; payload[19] = 0x07;
  context.parseNavTimeUtc(payload);
  assert.equal(context.latestTimeUtcClock.utcMs, Date.UTC(2026, 9, 19, 3, 4, 5, 500));
  assert.equal(context.latestTimeUtcClock.tAccNs, 125);
  assert.equal(context.latestTimeUtcClock.validTow, true);
  assert.equal(context.latestTimeUtcClock.validWeek, true);
  assert.equal(context.latestTimeUtcClock.validUtc, true);
});

test("OSNMA clock shows receiver freshness, local-time preference, and separate verification status", () => {
  const now = 100000;
  const state = () => ({ textContent: "", dataset: {} });
  const context = loadFunctions(["refreshOsnmaClock"], {
    settings: { enableOsnma: true },
    latestPvtClock: { utcMs: Date.UTC(2026, 9, 19), receivedAt: now - 125, tAccNs: 80, validDate: true, validTime: true, fullyResolved: true, confirmedDate: true, confirmedTime: true },
    latestTimeUtcClock: null, osnmaClockSettings: { showLocalTime: false },
    osnmaClockValue: state(), osnmaClockAge: state(), osnmaClockPvt: state(), osnmaClockTimeUtc: state(), osnmaClockAuth: state(),
    latestOsnmaStatus: { ...workingStatus(), receivedAt: now, connectionId: 1 },
    latestOsnmaTimeCheck: { status: 3, authenticated: true }, liveConnectionId: 1,
  });
  context.refreshOsnmaClock(now);
  assert.match(context.osnmaClockValue.textContent, /UTC$/);
  assert.equal(context.osnmaClockAge.dataset.state, "good");
  assert.match(context.osnmaClockAuth.textContent, /check passed/);
  assert.equal(context.osnmaClockAuth.dataset.state, "good");
  context.osnmaClockSettings.showLocalTime = true;
  context.refreshOsnmaClock(now);
  assert.match(context.osnmaClockValue.textContent, /local$/);
  context.settings.enableOsnma = false;
  context.refreshOsnmaClock(now);
  assert.equal(context.osnmaClockAuth.textContent, "OSNMA disabled in settings");
  assert.equal(context.osnmaClockAuth.dataset.state, "off");
  context.settings.enableOsnma = true;
  context.latestOsnmaStatus.timSyncStatus = 4;
  context.latestOsnmaStatus.timingAuthResult = 2;
  context.latestOsnmaTimeCheck.status = 4;
  context.refreshOsnmaClock(now);
  assert.equal(context.osnmaClockAuth.dataset.state, "bad");
});

test("MapLibre track geometry stays bounded and includes the latest fix", () => {
  const positionFixes = Array.from({ length: 3600 }, (_, index) => ({
    latitude: index / 1000, longitude: index / 1000, threatColor: index < 1800 ? "red" : "blue",
  }));
  const context = loadFunctions(["vectorTrackData", "vectorTrackVertices"], {
    MAX_MAP_TRACK_POINTS: 600, positionFixes,
  });
  const lines = context.vectorTrackData();
  const vertices = context.vectorTrackVertices();
  assert.ok(lines.features.length <= 600);
  assert.equal(lines.features.length, 2);
  assert.ok(vertices.features.length <= 600);
  assert.deepEqual(Array.from(vertices.features.at(-1).geometry.coordinates), [3.599, 3.599]);
});

test("position controls recenter on the latest fix and clamp zoom", () => {
  let draws = 0;
  const context = loadFunctions(["recenterPositionTrack", "zoomPositionTrack"], {
    positionFixes: [{ easting: 100, northing: 200 }],
    positionView: { centerEasting: 0, centerNorthing: 0, span: 100 },
    drawPositionTrack() { draws += 1; },
  });
  context.recenterPositionTrack();
  assert.equal(context.positionView.centerEasting, 100);
  assert.equal(context.positionView.centerNorthing, 200);
  assert.equal(context.positionView.span, 100);
  context.zoomPositionTrack(0.8);
  assert.equal(context.positionView.span, 80);
  context.positionView.span = 1;
  context.zoomPositionTrack(0.8);
  assert.equal(context.positionView.span, 1);
  context.positionView.span = 1e7;
  context.zoomPositionTrack(1.25);
  assert.equal(context.positionView.span, 1e7);
  assert.equal(draws, 4);
});

test("position grid interval follows the 1-5 metric sequence as zoom changes", () => {
  const context = loadFunctions(["positionGridInterval"], { window: { devicePixelRatio: 1 } });
  assert.deepEqual(
    [80, 16, 8, 1.6, 0.8].map((scale) => context.positionGridInterval(scale)),
    [1, 5, 10, 50, 100],
  );
  assert.equal(context.positionGridInterval(0.008), 10000);
});

test("OSNMA age boundaries and receiver state colors", () => {
  const names = ["osnmaLastUpdate", "osnmaServiceState", "osnmaTimeSyncState", "osnmaTimeDelta", "osnmaHeaderAuth", "osnmaDsmAuth", "osnmaTeslaAuth", "osnmaTimingAuth", "osnmaReceiverStatus"];
  const context = loadFunctions(["osnmaCodeState", "osnmaRetainedResultState", "refreshOsnmaIndicators"], {
    settings: { enableOsnma: true },
    ...Object.fromEntries(names.map((name) => [name, { dataset: {} }])),
    latestOsnmaTimeCheck: null, latestOsnmaStatus: null, retainedOsnmaCodes: {}, refreshLocalClock() {},
  });
  context.refreshOsnmaIndicators(90000);
  assert.equal(context.osnmaReceiverStatus.dataset.state, "waiting");
  context.latestOsnmaStatus = workingStatus();
  for (const [age, state] of [[40000, "good"], [40001, "waiting"], [60000, "waiting"], [60001, "bad"]]) {
    context.refreshOsnmaIndicators(90000 + age);
    assert.equal(context.osnmaLastUpdate.dataset.state, state);
    assert.equal(context.osnmaReceiverStatus.dataset.state, state);
  }
  for (const code of [3, 5, 7]) assert.equal(context.osnmaCodeState("cpks", code), "bad");
  for (const code of [0, 2, 4, 6]) assert.equal(context.osnmaCodeState("cpks", code), "waiting");
  assert.equal(context.osnmaCodeState("dsm", 8), "waiting");
  assert.equal(context.osnmaCodeState("timing", 99), "bad");
  context.latestOsnmaStatus.timingAuthResult = 2;
  context.refreshOsnmaIndicators(90000);
  assert.equal(context.osnmaReceiverStatus.dataset.state, "bad");
});

test("disabled OSNMA remains clearly disabled during periodic refresh", () => {
  const names = ["osnmaLastUpdate", "osnmaServiceState", "osnmaTimeSyncState", "osnmaTimeDelta", "osnmaHeaderAuth", "osnmaDsmAuth", "osnmaTeslaAuth", "osnmaTimingAuth", "osnmaReceiverStatus", "osnmaAuthStatus"];
  const context = loadFunctions(["refreshOsnmaIndicators"], {
    settings: { enableOsnma: false },
    ...Object.fromEntries(names.map((name) => [name, { textContent: "", dataset: {} }])),
    refreshLocalClock() {},
  });
  context.refreshOsnmaIndicators(100000);
  assert.equal(context.osnmaReceiverStatus.textContent, "Disabled by settings");
  assert.equal(context.osnmaReceiverStatus.dataset.state, "off");
  assert.equal(context.osnmaAuthStatus.dataset.state, "off");
});

test("periodic OSNMA indicators retain success until the expected update is overdue", () => {
  const names = ["osnmaLastUpdate", "osnmaServiceState", "osnmaTimeSyncState", "osnmaTimeDelta", "osnmaHeaderAuth", "osnmaDsmAuth", "osnmaTeslaAuth", "osnmaTimingAuth", "osnmaReceiverStatus"];
  const context = loadFunctions(["osnmaCodeState", "osnmaRetainedResultState", "refreshOsnmaIndicators"], {
    settings: { enableOsnma: true },
    ...Object.fromEntries(names.map((name) => [name, { dataset: {} }])),
    latestOsnmaStatus: { ...workingStatus(), timSyncStatus: 0, timingAuthResult: 0, dsmAuthenticationStatus: 0, teslaKeyAuthStatus: 0 },
    latestOsnmaTimeCheck: { status: 3, receivedAt: 90000 },
    retainedOsnmaCodes: { timing: { code: 1, receivedAt: 90000 }, dsm: { code: 1, receivedAt: 90000 }, tesla: { code: 1, receivedAt: 90000 } },
    refreshLocalClock() {},
  });
  for (const [age, timingState, dsmState] of [[0, "good", "good"], [1000, "good", "good"], [60000, "good", "good"], [60001, "waiting", "good"], [240000, "waiting", "good"], [240001, "waiting", "waiting"]]) {
    const now = 90000 + age;
    context.latestOsnmaStatus.receivedAt = now;
    context.refreshOsnmaIndicators(now);
    assert.equal(context.osnmaTimeSyncState.dataset.state, timingState, `time-sync age ${age}`);
    assert.equal(context.osnmaTimeDelta.dataset.state, timingState, `time difference age ${age}`);
    assert.equal(context.osnmaTimingAuth.dataset.state, timingState, `timing age ${age}`);
    assert.equal(context.osnmaTeslaAuth.dataset.state, timingState, `TESLA idle age ${age}`);
    context.latestOsnmaStatus.teslaKeyAuthStatus = 3;
    context.refreshOsnmaIndicators(now);
    assert.equal(context.osnmaTeslaAuth.dataset.state, timingState, `TESLA ongoing age ${age}`);
    context.latestOsnmaStatus.teslaKeyAuthStatus = 0;
    assert.equal(context.osnmaDsmAuth.dataset.state, dsmState, `DSM age ${age}`);
  }
  context.latestOsnmaStatus.receivedAt = 90000;
  context.refreshOsnmaIndicators(130001);
  assert.equal(context.osnmaTimingAuth.dataset.state, "waiting");
  assert.equal(context.osnmaDsmAuth.dataset.state, "waiting");
  assert.equal(context.osnmaTeslaAuth.dataset.state, "waiting");
  context.latestOsnmaStatus.teslaKeyAuthStatus = 2;
  context.refreshOsnmaIndicators(90001);
  assert.equal(context.osnmaTeslaAuth.dataset.state, "bad");
  context.retainedOsnmaCodes.tesla = { code: 2, receivedAt: 90001 };
  for (const code of [0, 3]) {
    context.latestOsnmaStatus.teslaKeyAuthStatus = code;
    context.refreshOsnmaIndicators(90002);
    assert.equal(context.osnmaTeslaAuth.dataset.state, "bad");
  }
  context.retainedOsnmaCodes.tesla = { code: 1, receivedAt: 90003 };
  context.refreshOsnmaIndicators(90003);
  assert.equal(context.osnmaTeslaAuth.dataset.state, "good");
  context.latestOsnmaStatus = { ...workingStatus(), timSyncStatus: 4, timingAuthResult: 2, dsmAuthenticationStatus: 4 };
  context.refreshOsnmaIndicators(90001);
  for (const name of ["osnmaTimeSyncState", "osnmaTimeDelta", "osnmaTimingAuth", "osnmaDsmAuth"]) assert.equal(context[name].dataset.state, "bad");
  context.latestOsnmaStatus = { ...workingStatus(), timSyncStatus: 0, timingAuthResult: 0, dsmAuthenticationStatus: 0, receivedAt: 400000 };
  context.latestOsnmaTimeCheck = { status: 4, receivedAt: 90000 };
  context.retainedOsnmaCodes = { timing: { code: 2, receivedAt: 90000 }, dsm: { code: 4, receivedAt: 90000 } };
  context.refreshOsnmaIndicators(400000);
  for (const name of ["osnmaTimeSyncState", "osnmaTimeDelta", "osnmaTimingAuth", "osnmaDsmAuth"]) assert.equal(context[name].dataset.state, "bad");
  context.latestOsnmaTimeCheck = { status: 3, receivedAt: 400001 };
  context.retainedOsnmaCodes = { timing: { code: 1, receivedAt: 400001 }, dsm: { code: 2, receivedAt: 400001 } };
  context.refreshOsnmaIndicators(400001);
  for (const name of ["osnmaTimeSyncState", "osnmaTimeDelta", "osnmaTimingAuth", "osnmaDsmAuth"]) assert.equal(context[name].dataset.state, "good");
});

test("clock correction adds the OSNMA difference, resends UTC and consumes the checked baseline", async () => {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [Clock.now()])); }
    static now() { return 100000; }
  }
  const sample = { offsetMs: 0, connectionId: 1, awaitingCheck: false };
  const sent = [];
  const context = loadFunctions(["canCorrectLocalClock", "refreshLocalClock", "updateLocalClock", "resetLocalClock", "osnmaCodeState", "buildTrustedComputerUtcPayload", "sendTrustedClockTime"], {
    Date: Clock, Uint8Array, DataView, settings: { enableOsnma: true }, port: {}, writer: {}, reading: true, replayData: null,
    latestReceiverUtc: null, latestOsnmaStatus: workingStatus(), liveConnectionId: 1,
    trustedClockSample: sample, trustedClockUpdatePending: false,
    latestOsnmaTimeCheck: { differenceMs: -513, status: 3, receivedAt: 99000, trustedClockSample: sample, authenticated: true },
    appClockOffsetMs: 0, osnmaUpdateLocalTime: {}, osnmaSendTrustedTime: {}, osnmaLocalTime: {}, clockOffset: {}, refreshOsnmaClock() {},
    configureButton: { disabled: false },
    osnmaClockSettings: { accuracySeconds: 1 }, setStatus() {},
    async sendMgaAssistance(payload, messageId) { sent.push({ payload, messageId }); return { accepted: true }; },
  });
  context.settings.enableOsnma = false;
  assert.equal(context.canCorrectLocalClock(), false);
  context.settings.enableOsnma = true;
  const assistanceBefore = Array.from(context.buildTrustedComputerUtcPayload());
  assert.equal(context.canCorrectLocalClock(), true);
  const correction = context.updateLocalClock();
  assert.equal(context.osnmaUpdateLocalTime.disabled, true);
  await context.updateLocalClock();
  await correction;
  assert.equal(context.appClockOffsetMs, -513);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageId, 0x40);
  assert.deepEqual(Array.from(sent[0].payload), Array.from(context.buildTrustedComputerUtcPayload(-513)));
  assert.equal(context.trustedClockSample.offsetMs, -513);
  assert.equal(context.trustedClockSample.awaitingCheck, true);
  await context.updateLocalClock();
  assert.equal(sent.length, 1);
  assert.deepEqual(Array.from(context.buildTrustedComputerUtcPayload()), assistanceBefore);
  context.latestOsnmaTimeCheck = { differenceMs: 20, status: 3, receivedAt: 100000, trustedClockSample: context.trustedClockSample, authenticated: true };
  context.trustedClockSample.awaitingCheck = false;
  assert.equal(context.canCorrectLocalClock(), true);
  for (const changes of [{ timingAuthResult: 2 }, { teslaKeyAuthStatus: 2 }, { timSyncEnabled: 0 }, { timSyncStatus: 4 }, { timSyncStatus: 7 }, { cpks: 3 }, { pubKeyValid: 0 }, { receivedAt: 59999 }, { connectionId: 0 }, { satellites: [{ authStatus: 0 }] }]) {
    context.latestOsnmaStatus = { ...workingStatus(), ...changes };
    assert.equal(context.canCorrectLocalClock(), false, JSON.stringify(changes));
  }
  context.latestOsnmaStatus = workingStatus();
  context.latestOsnmaTimeCheck.receivedAt = 59999;
  assert.equal(context.canCorrectLocalClock(), true);
  context.latestOsnmaStatus = { ...workingStatus(), timSyncStatus: 0, timingAuthResult: 0, teslaKeyAuthStatus: 0, headerAuthStatus: 0 };
  assert.equal(context.canCorrectLocalClock(), true);
  context.refreshLocalClock();
  assert.equal(context.osnmaUpdateLocalTime.disabled, false);
  context.latestOsnmaTimeCheck.authenticated = false;
  assert.equal(context.canCorrectLocalClock(), false);
  context.latestOsnmaTimeCheck.authenticated = true;
  context.latestOsnmaStatus = workingStatus();
  context.latestOsnmaTimeCheck.receivedAt = 100000;
  context.replayData = {};
  assert.equal(context.canCorrectLocalClock(), false);
  context.replayData = null;
  await context.updateLocalClock();
  assert.equal(context.appClockOffsetMs, -493);
  context.latestOsnmaTimeCheck = { differenceMs: 10, status: 3, receivedAt: 100000, trustedClockSample: context.trustedClockSample, authenticated: true };
  context.sendMgaAssistance = async () => ({ accepted: false, message: "receiver acknowledgement timed out" });
  await context.updateLocalClock();
  assert.equal(context.appClockOffsetMs, -493);
  assert.equal(context.trustedClockSample, null);
  context.resetLocalClock();
  assert.equal(context.appClockOffsetMs, 0);
  assert.equal(context.latestReceiverUtc, null);
  assert.equal(context.osnmaUpdateLocalTime.disabled, true);
});

test("trusted UTC is sent only by explicit action after opt-in", async () => {
  let sendCount = 0;
  const context = loadFunctions(["sendTrustedTimeNow"], {
    settings: { enableOsnma: true },
    osnmaClockSettings: { useComputerClock: false },
    osnmaTrustedTimeStatus: {}, configureButton: { disabled: false },
    writer: {}, reading: true, replayData: null, liveConnectionId: 1,
    async sendTrustedClockTime() { sendCount += 1; return { accepted: true }; },
  });
  await context.sendTrustedTimeNow();
  assert.equal(sendCount, 0);
  assert.match(context.osnmaTrustedTimeStatus.textContent, /Enable/);
  context.osnmaClockSettings.useComputerClock = true;
  await context.sendTrustedTimeNow();
  assert.equal(sendCount, 1);
  assert.match(context.osnmaTrustedTimeStatus.textContent, /accepted/);
});

test("OSNMA correction waits for a new check cycle after each accepted trusted UTC sample", () => {
  const firstSample = { offsetMs: 0, connectionId: 1, awaitingCheck: true };
  const context = loadFunctions(["parseSecOsnma", "hasAuthenticatedOsnmaTiming", "osnmaCodeState"], {
    DataView, Date, latestOsnmaStatus: null, latestOsnmaTimeCheck: null,
    trustedClockSample: firstSample, liveConnectionId: 1, replayRebuilding: true,
    retainedOsnmaCodes: {}, osnmaSatelliteResults: new Map(),
  });
  const payload = new Uint8Array(28);
  payload[0] = 3;
  const data = new DataView(payload.buffer);
  data.setInt32(8, -513, true);
  payload[4] = 1 | (3 << 1);
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck.trustedClockSample, null);
  payload[4] = 1;
  context.parseSecOsnma(payload);
  payload[4] = 1 | (3 << 1);
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck.trustedClockSample, firstSample);
  assert.equal(context.latestOsnmaTimeCheck.differenceMs, -513);
  assert.equal(context.latestOsnmaTimeCheck.authenticated, false);
  payload[1] = 1 | (2 << 1) | (1 << 5);
  data.setUint16(2, 1, true);
  data.setUint32(16, 1, true);
  data.setUint32(20, 1, true);
  data.setUint32(24, (1 << 12) | (1 << 19) | (1 << 23), true);
  context.parseSecOsnma(payload);
  const authenticatedCheck = context.latestOsnmaTimeCheck;
  assert.equal(authenticatedCheck.authenticated, true);
  data.setUint32(20, 0, true);
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck, authenticatedCheck);
  payload[4] = 1;
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck, authenticatedCheck);
  payload[4] = 1 | (4 << 1);
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck.status, 4);
  assert.equal(context.latestOsnmaTimeCheck.authenticated, false);
  context.trustedClockSample = { offsetMs: -513, connectionId: 1, awaitingCheck: true };
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck.trustedClockSample, null);
  payload[4] = 1;
  context.parseSecOsnma(payload);
  payload[4] = 1 | (4 << 1);
  context.parseSecOsnma(payload);
  assert.equal(context.latestOsnmaTimeCheck.status, 4);
  assert.equal(context.latestOsnmaTimeCheck.trustedClockSample, context.trustedClockSample);
});

test("UTC capture includes signed nanoseconds and excludes unresolved or replay time", () => {
  const context = loadFunctions(["updateReceiverStatus"], {
    fixStatus: {}, gpsTime: {}, clockOffset: {}, latitudeStatus: {}, longitudeStatus: {}, altitudeStatus: {}, speedStatus: {}, headingStatus: {},
    port: {}, reading: true, replayData: null, appClockOffsetMs: 0, latestReceiverUtc: null, liveConnectionId: 1,
  });
  const fix = { year: 2026, month: 10, day: 15, hour: 10, minute: 30, second: 0, nano: -250000000, valid: 7, fixType: 5, positionValid: false };
  context.updateReceiverStatus(fix);
  assert.equal(context.latestReceiverUtc.utcMs, Date.UTC(2026, 9, 15, 10, 30) - 250);
  context.updateReceiverStatus({ ...fix, valid: 3 });
  assert.equal(context.latestReceiverUtc, null);
  context.replayData = {};
  context.updateReceiverStatus(fix);
  assert.equal(context.latestReceiverUtc, null);
});

test("waterfall cursor maps pointer rows through the timestamp ring buffer", () => {
  const context = loadFunctions(["waterfallCursorAt", "waterfallCursorDetails"], {
    Date,
  });
  const timestamp = new Date(2026, 9, 18, 12, 34, 56).getTime();
  const view = {
    rowCount: 4, waterfallFrame: 12, filledRows: 3, row: 0,
    timestamps: new Float64Array([0, 0, timestamp, 0]),
    waterfallCursor: { frame: 10 },
  };
  const box = { x: 20, y: 10, width: 80, height: 40 };
  assert.equal(context.waterfallCursorAt(view, 60, 115, 0, 100, 1, box), 11);
  assert.equal(context.waterfallCursorAt(view, 60, 145, 0, 100, 1, box), null);
  assert.equal(context.waterfallCursorAt(view, 10, 115, 0, 100, 1, box), null);
  assert.equal(context.waterfallCursorDetails(view).age, 1);
  assert.equal(context.waterfallCursorDetails(view).label, "12:34:56");
});

test("waterfall cursor draws a horizontal line labeled with the selected row time", () => {
  const labels = [];
  const positions = [];
  const drawing = new Proxy({
    moveTo(x, y) { positions.push([x, y]); },
    lineTo(x, y) { positions.push([x, y]); },
    fillText(text, x, y) { labels.push([text, x, y]); },
  }, { get(target, property) { return target[property] ?? (() => {}); } });
  const context = loadFunctions(["waterfallCursorDetails", "drawWaterfallCursor"], {
    window: { devicePixelRatio: 1 }, Date,
  });
  const view = {
    rowCount: 4, waterfallFrame: 12, filledRows: 3, row: 0,
    timestamps: new Float64Array([0, 0, new Date(2026, 9, 18, 12, 34, 56).getTime(), 0]),
    waterfallCursor: { frame: 10, pinned: true },
  };
  const box = { x: 20, y: 10, width: 80, height: 40 };
  context.drawWaterfallCursor(drawing, view, box);
  assert.equal(labels[0][0], "12:34:56");
  assert.equal(labels[0][2], 25);
  assert.deepEqual(positions, [[20, 25], [100, 25]]);
});

test("pinned waterfall cursor stays on its frame and clears explicitly", () => {
  let selectedFrame = 8;
  let draws = 0;
  const context = loadFunctions(["updateWaterfallHover", "pinWaterfallCursor", "clearWaterfallCursor"], {
    PLOT_MARGIN: { left: 54, right: 14 }, window: { devicePixelRatio: 1 },
    sizeCanvas: () => ({ width: 300, height: 200 }),
    waterfallCursorAt: () => selectedFrame,
    drawWaterfall() { draws += 1; },
  });
  const view = { frame: {}, waterfallCursor: null, waterfall: { getBoundingClientRect: () => ({ top: 0 }) } };
  const firstMove = { clientY: 50 };
  assert.equal(context.updateWaterfallHover(view, firstMove), true);
  context.pinWaterfallCursor(view, firstMove);
  assert.equal(view.waterfallCursor.frame, 8);
  assert.equal(view.waterfallCursor.pinned, true);
  selectedFrame = 7;
  assert.equal(context.updateWaterfallHover(view, { clientY: 70 }), false);
  assert.equal(view.waterfallCursor.frame, 8);
  context.clearWaterfallCursor(view);
  assert.equal(view.waterfallCursor, null);
  assert.equal(draws, 3);
});

test("spectrum cursor can be cleared after it is pinned", () => {
  let draws = 0;
  const view = { hoverPinned: true, hoverBin: 12, inspect: { textContent: "pinned" } };
  const context = loadFunctions(["clearSpectrumCursor"], { drawSpectrum() { draws += 1; } });
  context.clearSpectrumCursor(view);
  assert.equal(view.hoverPinned, false);
  assert.equal(view.hoverBin, null);
  assert.equal(view.inspect.textContent, "Move cursor over spectrum");
  assert.equal(draws, 1);
});

test("spectrum cursor stays at its clicked bin until cleared", () => {
  const view = {
    hoverPinned: false, hoverBin: null, inspect: { textContent: "" },
    spectrum: { width: 100, getBoundingClientRect: () => ({ left: 0 }) },
    frame: { center: 1000, span: 100, bins: new Uint8Array(256), average: null }, peak: null,
  };
  const context = loadFunctions(["updateHover", "pinSpectrumCursor"], {
    BIN_COUNT: 256, window: { devicePixelRatio: 1 }, plotBox: () => ({ x: 0, width: 100 }),
    formatHz: String, drawSpectrum() {},
  });
  context.pinSpectrumCursor(view, { clientX: 20 });
  const pinnedBin = view.hoverBin;
  assert.equal(view.hoverPinned, true);
  context.updateHover(view, { clientX: 80 });
  assert.equal(view.hoverBin, pinnedBin);
});

test("signal chart cursor stays at its clicked epoch until cleared", () => {
  const readout = { innerHTML: "", textContent: "" };
  const canvas = { getBoundingClientRect: () => ({ left: 0 }), closest: () => ({ querySelector: () => readout }) };
  const series = [{ label: "Jamming", color: "red", values: [{ epoch: 4, value: 1 }, { epoch: 5, value: 2 }, { epoch: 6, value: 3 }] }];
  const signalHover = new Map();
  const signalHoverPinned = new Set();
  const context = loadFunctions(["updateSignalHover", "clearSignalHover"], {
    signalChartState: new Map([[canvas, { series, box: { x: 0, width: 100 }, firstEpoch: 0, lastEpoch: 10 }]]),
    signalHover, signalHoverPinned, window: { devicePixelRatio: 1 }, drawSignals() {},
  });
  assert.equal(context.updateSignalHover(canvas, { clientX: 50 }, true), true);
  signalHoverPinned.add(canvas);
  const pinnedEpoch = signalHover.get(canvas);
  assert.equal(context.updateSignalHover(canvas, { clientX: 90 }), false);
  assert.equal(signalHover.get(canvas), pinnedEpoch);
  context.clearSignalHover(canvas);
  assert.equal(signalHover.has(canvas), false);
  assert.equal(signalHoverPinned.has(canvas), false);
});