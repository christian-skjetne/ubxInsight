const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const monCommsProbePath = path.join(__dirname, "..", "tools", "mon-comms-probe", "probe.cjs");
const monCommsProbe = fs.existsSync(monCommsProbePath) ? require(monCommsProbePath) : null;

const source = fs.readFileSync(path.join(__dirname, "..", "insight.js"), "utf8").replace(/\r\n/g, "\n");

function loadFunctions(names, globals) {
  const context = vm.createContext({ SIGNAL_TOW_DISCONTINUITY_MS: 10000, latestAuthenticatedTimeCheck: null, lastAppliedAuthenticatedTimeCheck: null, satellitePredictionsEnabled: true, requestAnimationFrame(callback) { callback(); }, scheduleSignalDraw() { globals.drawSignals?.(); }, ...globals });
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

function recordingContext() {
  const saved = [];
  const metadata = [];
  const existing = new Set();
  const directory = {
    name: "logs",
    async getFileHandle(name, options) {
      if (!options?.create) {
        if (existing.has(name)) return {};
        throw Object.assign(new Error("Missing file"), { name: "NotFoundError" });
      }
      existing.add(name);
      return {
        async createWritable() {
          const bytes = [];
          return {
            async write(chunk) { bytes.push(...chunk); },
            async close() {
              if (name.endsWith(".json")) metadata.push(JSON.parse(bytes.join("")));
              else saved.push({ name, bytes });
            },
            async abort() {},
          };
        },
      };
    },
  };
  const session = { directory, prefix: "test", index: 0, stream: null, saved: 0, queuedBytes: 0, accepting: true, error: null, queue: Promise.resolve(), timer: null, segmentStartedAt: 0, segmentBytes: 0, segments: [], configuration: { atStart: [], changes: [] } };
  const context = loadFunctions(["recordChunk", "enqueueRecordingOperation", "openRecordingSegment", "closeRecordingSegment", "stopRecording"], {
    recordingSession: session, recordingStatus: {}, port: {},
    recordButton: { classList: { remove() {} } }, clearInterval() {}, performance: { now: () => 10000 },
  });
  return { context, session, saved, existing, metadata };
}

test("segmented recording writes in order and commits each segment independently", async () => {
  const { context, session, saved, existing, metadata } = recordingContext();
  existing.add("test-000001.ubx");
  const chunk = new Uint8Array([1, 2]);
  context.recordChunk(chunk);
  chunk[0] = 9;
  await session.queue;
  assert.equal(saved.length, 0, "Open segment is not yet committed");
  context.enqueueRecordingOperation(session, () => context.closeRecordingSegment(session));
  context.recordChunk(new Uint8Array([3, 4]));
  await session.queue;
  assert.deepEqual(saved, [{ name: "test-000002.ubx", bytes: [1, 2] }]);
  assert.deepEqual(metadata[0], { version: 1, segments: [{ fileName: "test-000002.ubx", sizeBytes: 2, durationMs: 10000 }], configuration: { atStart: [], changes: [] } });
  context.performance.now = () => 12500;
  await context.stopRecording();
  assert.deepEqual(saved[1], { name: "test-000003.ubx", bytes: [3, 4] });
  assert.equal(metadata[1].segments.length, 2);
  assert.equal(metadata[1].segments[1].durationMs, 2500);
  assert.ok(existing.has("session.json"));
  assert.ok(![...existing].some((name) => name.endsWith(".timing.json")));
  assert.equal(context.recordingSession, null);
  assert.equal(session.queuedBytes, 0);
  assert.match(context.recordingStatus.textContent, /2 segments saved/);
});

test("recording reports disk errors and stops accepting data without claiming success", async () => {
  const { context, session } = recordingContext();
  session.directory.getFileHandle = async () => { throw new Error("Permission revoked"); };
  context.recordChunk(new Uint8Array([1]));
  await session.queue;
  assert.equal(session.accepting, false);
  assert.match(context.recordingStatus.textContent, /Recording failed: Permission revoked/);
  await context.stopRecording();
  assert.match(context.recordingStatus.textContent, /current segment may be lost/);
});

test("recording stores computer UTC segment starts independently of delayed disk closing", async () => {
  const { context, session, metadata } = recordingContext();
  session.startedAt = Date.parse("2026-10-30T18:00:00Z");
  session.startedMonotonic = 100;
  session.segmentStartedAt = 100;
  context.recordChunk(new Uint8Array([1]));
  await session.queue;
  await context.closeRecordingSegment(session, 10100);
  assert.equal(metadata[0].segments[0].startedAt, "2026-10-30T18:00:00.000Z");
  context.recordChunk(new Uint8Array([2]));
  await session.queue;
  await context.closeRecordingSegment(session, 12100);
  assert.equal(metadata[1].segments[1].startedAt, "2026-10-30T18:00:10.000Z");
  assert.equal(metadata[1].segments[1].durationMs, 2000);
});

test("timing metadata failures leave the committed raw segment intact and report failure", async () => {
  const { context, session, saved } = recordingContext();
  const getFileHandle = session.directory.getFileHandle;
  session.directory.getFileHandle = async (name, options) => {
    if (name.endsWith(".json")) throw new Error("Cannot save timing");
    return getFileHandle(name, options);
  };
  context.recordChunk(new Uint8Array([1, 2]));
  await context.stopRecording();
  assert.equal(saved.length, 1);
  assert.match(context.recordingStatus.textContent, /Recording failed: Cannot save timing/);
  assert.equal(session.saved, 1);
});

test("recording bounds the pending write buffer and preserves completed data on overflow", async () => {
  const { context, session, saved } = recordingContext();
  context.recordChunk(new Uint8Array([1, 2]));
  await session.queue;
  session.queuedBytes = 16 * 1024 * 1024;
  context.recordChunk(new Uint8Array([3]));
  await session.queue;
  assert.equal(session.accepting, false);
  assert.deepEqual(saved[0].bytes, [1, 2]);
  assert.match(context.recordingStatus.textContent, /could not keep up/);
});

test("multiple replay segments sort numerically and restore UBX frames split at boundaries", async () => {
  const context = loadFunctions(["loadReplayFiles", "indexReplayFrames", "replayFrameGroup", "ubxFrame", "checksum"], {});
  const frame = context.ubxFrame(0x01, 0x07, new Uint8Array(92));
  const file = (name, data) => ({ name, size: data.length, arrayBuffer: async () => data.slice().buffer });
  const loaded = await context.loadReplayFiles([file("log-10.ubx", frame.slice(7)), file("log-2.ubx", frame.slice(0, 7))]);
  assert.deepEqual(Array.from(loaded.bytes), Array.from(frame));
  assert.equal(context.indexReplayFrames(loaded.bytes).length, 1);
  assert.match(loaded.name, /^2 files: log-2.ubx, log-10.ubx$/);
});

test("recording setup validates inputs and starts the chosen segment interval", async () => {
  let interval;
  const context = loadFunctions(["beginSegmentedRecording", "isRecording", "defaultLogName", "createRecordingDirectory"], {
    port: {}, recordingSession: null, recordingStarting: false,
    recordingPrefix: { value: "field" }, recordingMinutes: { value: "10" },
    recordingSetupStatus: {}, recordingStatus: {}, recordingStart: {}, recordingCancel: {},
    recordingDialog: { close() {} }, recordButton: { classList: { add() {} } },
    window: { showDirectoryPicker: async () => ({
      async getDirectoryHandle(name, options) {
        if (options?.create) return { name };
        throw Object.assign(new Error("Missing folder"), { name: "NotFoundError" });
      },
    }) },
    performance: { now: () => 0 },
    recordingConfigurationSnapshot: () => ({ atStart: [], changes: [] }),
    setInterval(callback, ms) { interval = ms; return 1; },
  });
  await context.beginSegmentedRecording({ preventDefault() {} });
  assert.equal(interval, 600000);
  assert.equal(context.recordingSession.accepting, true);
  assert.match(context.recordingSession.prefix, /^field-/);
  assert.equal(context.recordingSession.directory.name, context.recordingSession.prefix);
  context.recordingSession = null;
  context.recordingPrefix.value = "../invalid";
  await context.beginSegmentedRecording({ preventDefault() {} });
  assert.equal(context.recordingSession, null);
  assert.match(context.recordingSetupStatus.textContent, /Use a prefix/);
});

test("configuration metadata snapshots this connection and records subsequent VALSET outcomes", async () => {
  const context = loadFunctions(["sendValset", "recordingConfigurationSnapshot", "ubxFrame", "checksum"], {
    receiverConfigurationLog: new Map(), liveConnectionId: 1, receiver: { value: "x20" },
    recordingSession: null, writer: { async write() {} },
    waitForValsetAck: async () => "ack",
  });
  await context.sendValset("NAV-SAT UART1", 0x20910016, 1, 1);
  const snapshot = context.recordingConfigurationSnapshot();
  assert.equal(snapshot.atStart.length, 1);
  assert.equal(snapshot.atStart[0].key, "0x20910016");
  assert.equal(snapshot.atStart[0].result, "ack");
  assert.equal(snapshot.atStart[0].valueBytes, 1);
  assert.equal(snapshot.atStart[0].layer, "RAM");
  assert.match(snapshot.atStart[0].requestedAt, /^\d{4}-/);
  context.recordingSession = { accepting: true, configuration: snapshot };
  for (const result of ["nak", "timeout"]) {
    context.waitForValsetAck = async () => result;
    await context.sendValset("NAV-SAT UART1", 0x20910016, 0, 1);
  }
  assert.equal(snapshot.atStart[0].result, "ack", "Initial snapshot must not mutate");
  assert.deepEqual(Array.from(snapshot.changes, (entry) => entry.result), ["nak", "timeout"]);
  assert.ok(snapshot.changes.every((entry) => entry.value === 0));
  context.pendingConfigAcks = [];
  context.clearTimeout = () => {};
  context.waitForValsetAck = (name) => new Promise((resolve) => context.pendingConfigAcks.push({ name, resolve }));
  context.writer.write = async () => { throw new Error("Port closed"); };
  assert.equal(await context.sendValset("NAV-SAT UART1", 0x20910016, 1, 1), "write failed");
  assert.equal(snapshot.changes[2].result, "write failed");
  context.liveConnectionId = 2;
  assert.equal(context.recordingConfigurationSnapshot().atStart.length, 0, "Previous receiver connection must not leak");
});

test("recording persists initial configuration and later changes in session JSON", async () => {
  const { context, session, metadata } = recordingContext();
  session.configuration = { source: "App-issued requests", atStart: [{ name: "MON-SPAN UART1", value: 1, result: "ack" }], changes: [{ name: "MON-SPAN UART1", value: 0, result: "nak" }] };
  context.recordChunk(new Uint8Array([1]));
  await context.stopRecording();
  assert.deepEqual(metadata[0].configuration, session.configuration);
});

test("recording creates a new session folder without reusing existing folders", async () => {
  const context = loadFunctions(["createRecordingDirectory"], {});
  const created = [];
  const parent = {
    async getDirectoryHandle(name, options) {
      if (options?.create) { created.push(name); return { name }; }
      if (name === "field-session") return {};
      throw Object.assign(new Error("Missing"), { name: "NotFoundError" });
    },
  };
  const directory = await context.createRecordingDirectory(parent, "field-session");
  assert.equal(directory.name, "field-session-1");
  assert.deepEqual(created, ["field-session-1"]);
  await assert.rejects(() => context.createRecordingDirectory({
    async getDirectoryHandle() { throw new Error("Permission denied"); },
  }, "field"), /Permission denied/);
});

test("folder replay reads only direct UBX segments and timing companions", async () => {
  const context = loadFunctions(["readRecordingDirectory", "loadReplayFiles"], {});
  const files = [
    { name: "log-1.ubx", size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer },
    { name: "log-1.ubx.timing.json", text: async () => JSON.stringify({ version: 1, fileName: "log-1.ubx", sizeBytes: 2, durationMs: 1000 }) },
  ];
  const directory = {
    async *values() {
      for (const file of files) yield { kind: "file", name: file.name, getFile: async () => file };
      yield { kind: "directory", name: "nested.ubx" };
      yield { kind: "file", name: "notes.txt", getFile() { throw new Error("Should not read"); } };
    },
  };
  const selected = await context.readRecordingDirectory(directory);
  assert.equal(selected.length, 2);
  const loaded = await context.loadReplayFiles(selected);
  assert.equal(loaded.timing[0].durationMs, 1000);
  await assert.rejects(() => context.loadReplayFiles([]), /Select at least one/);
});

test("replay uses measured per-segment durations across boundaries and when seeking", () => {
  const context = loadFunctions(["advanceReplayTiming"], {});
  const timing = [{ start: 0, end: 100, durationMs: 1000 }, { start: 100, end: 300, durationMs: 4000 }];
  assert.equal(context.advanceReplayTiming(0, 1000, 300, timing, 999).offset, 100);
  assert.equal(context.advanceReplayTiming(0, 3000, 300, timing, 999).offset, 200);
  assert.equal(context.advanceReplayTiming(150, 1000, 300, timing, 999).offset, 200);
  assert.equal(context.advanceReplayTiming(0, 5000, 300, timing, 999).offset, 300);
  assert.equal(context.advanceReplayTiming(0, 500, 300, [], 100).offset, 50);
  assert.equal(context.advanceReplayTiming(0, 2000, 300, [timing[0], { start: 100, end: 300, durationMs: null }], 100).offset, 200);
});

test("playback details follow segment boundaries, seeking, duration and unknown timestamps", () => {
  const context = loadFunctions(["replayPlaybackDetails"], {});
  const timing = [
    { start: 0, end: 100, durationMs: 10000, fileName: "first.ubx", startedAt: "2026-10-30T18:00:00Z" },
    { start: 100, end: 200, durationMs: 20000, fileName: "second.ubx", startedAt: "2026-10-30T18:00:10Z" },
  ];
  assert.equal(context.replayPlaybackDetails(timing, 50, 100).duration, "00:00:05 / 00:00:30");
  const next = context.replayPlaybackDetails(timing, 100, 100);
  assert.equal(next.currentFile, "2/2: second.ubx");
  assert.match(next.recordedAt, /2026-10-30 18:00:10.*UTC/);
  assert.equal(context.replayPlaybackDetails(timing, 200, 100).duration, "00:00:30 / 00:00:30");
  timing[1].durationMs = null; timing[1].startedAt = null;
  const legacy = context.replayPlaybackDetails(timing, 150, 100);
  assert.equal(legacy.duration, "00:00:10 / 00:00:11 (estimated)");
  assert.match(legacy.recordedAt, /Unknown/);
  assert.equal(context.replayPlaybackDetails([], 0, 100).currentFile, "--");
});

test("session manifest times listed segments and recovers unlisted files with fallback", async () => {
  const context = loadFunctions(["readRecordingDirectory", "loadReplayFiles"], {});
  const file = (name) => ({ name, size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  const segments = [{ fileName: "log-1.ubx", sizeBytes: 2, durationMs: 1500 }];
  const manifest = { name: "session.json", text: async () => JSON.stringify({ version: 1, segments }) };
  const files = [file("log-1.ubx"), file("log-2.ubx"), manifest];
  const directory = { async *values() {
    for (const entry of files) yield { kind: "file", name: entry.name, getFile: async () => entry };
  } };
  const loaded = await context.loadReplayFiles(await context.readRecordingDirectory(directory));
  assert.equal(loaded.bytes.length, 4);
  assert.equal(loaded.timing[0].durationMs, 1500);
  assert.equal(loaded.timing[1].durationMs, null);
  assert.match(loaded.timingSummary, /log-2.ubx: missing timing metadata/);
  for (const text of ["{bad", "null", '{"version":99,"segments":[]}', JSON.stringify({ version: 1, segments: [segments[0], segments[0]] }), JSON.stringify({ version: 1, segments: [{ ...segments[0], sizeBytes: 99 }] })]) {
    const invalid = await context.loadReplayFiles([files[0], { name: "session.json", text: async () => text }]);
    assert.equal(invalid.timing[0].durationMs, null);
    assert.match(invalid.timingSummary, /baud-rate estimate/);
  }
});

test("replay accepts arbitrary filenames and explicitly falls back for invalid timing companions", async () => {
  const context = loadFunctions(["loadReplayFiles"], {});
  const file = { name: "arbitrary recording.ubx", size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
  const companion = (value) => ({ name: `${file.name}.timing.json`, text: async () => value });
  const good = await context.loadReplayFiles([file, companion(JSON.stringify({ version: 1, fileName: file.name, sizeBytes: 2, durationMs: 1200 }))]);
  assert.equal(good.timing[0].durationMs, 1200);
  assert.match(good.timingSummary, /measured average/);
  for (const json of ["{bad", "null", JSON.stringify({ version: 1, fileName: file.name, sizeBytes: 2, durationMs: 0 }), JSON.stringify({ version: 1, fileName: file.name, sizeBytes: 9, durationMs: 20 })]) {
    const result = await context.loadReplayFiles([file, companion(json)]);
    assert.equal(result.timing[0].durationMs, null);
    assert.match(result.timingSummary, /baud-rate estimate/);
    assert.deepEqual(Array.from(result.bytes), [1, 2]);
  }
  const missing = await context.loadReplayFiles([file]);
  assert.match(missing.timingSummary, /missing timing metadata/);
});

function wakeLockContext(request) {
  return loadFunctions(["renderScreenWakeLock", "requestScreenWakeLock", "toggleScreenWakeLock"], {
    navigator: request ? { wakeLock: { request } } : {},
    document: { visibilityState: "visible" },
    screenWakeLock: null, screenWakeLockEnabled: false, screenWakeLockPending: false, screenWakeLockError: "",
    screenWakeLockToggle: {},
    screenWakeLockStatus: {},
  });
}

test("screen wake lock is opt-in, releases on toggle and reacquires after visibility returns", async () => {
  const locks = [];
  const context = wakeLockContext(async (type) => {
    assert.equal(type, "screen");
    const lock = {
      released: false,
      addEventListener(name, callback) { assert.equal(name, "release"); this.onRelease = callback; },
      async release() { this.released = true; this.onRelease(); },
    };
    locks.push(lock);
    return lock;
  });
  context.renderScreenWakeLock();
  assert.equal(locks.length, 0);
  assert.equal(context.screenWakeLockToggle.checked, false);
  await context.toggleScreenWakeLock();
  assert.equal(context.screenWakeLockStatus.textContent, "Screen wake lock: active");
  assert.equal(context.screenWakeLockToggle.checked, true);
  context.document.visibilityState = "hidden";
  await locks[0].release();
  await context.requestScreenWakeLock();
  assert.equal(locks.length, 1);
  assert.match(context.screenWakeLockStatus.textContent, /paused/);
  context.document.visibilityState = "visible";
  await context.requestScreenWakeLock();
  assert.equal(locks.length, 2);
  await context.toggleScreenWakeLock();
  assert.equal(locks[1].released, true);
  assert.equal(context.screenWakeLockEnabled, false);
  assert.equal(context.screenWakeLockToggle.checked, false);
  assert.equal(context.screenWakeLockStatus.textContent, "Screen wake lock: off");
});

test("screen wake lock reports unavailable and denied requests without affecting receiver state", async () => {
  const unavailable = wakeLockContext();
  unavailable.renderScreenWakeLock();
  assert.equal(unavailable.screenWakeLockToggle.disabled, true);
  assert.match(unavailable.screenWakeLockStatus.textContent, /unavailable/);
  const denied = wakeLockContext(async () => { throw new Error("Permission denied"); });
  await denied.toggleScreenWakeLock();
  assert.match(denied.screenWakeLockStatus.textContent, /request failed: Permission denied/);
  assert.equal(denied.screenWakeLockEnabled, false);
  assert.equal(denied.screenWakeLockToggle.disabled, false);
  assert.equal(denied.screenWakeLockToggle.checked, false);
});

test("screen wake lock prevents concurrent requests and reports release errors", async () => {
  let resolveRequest;
  let calls = 0;
  const context = wakeLockContext(() => {
    calls++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  });
  const enabling = context.toggleScreenWakeLock();
  assert.equal(context.screenWakeLockToggle.disabled, true);
  await context.requestScreenWakeLock();
  await context.toggleScreenWakeLock();
  assert.equal(calls, 1);
  resolveRequest({
    released: false, addEventListener() {},
    async release() { throw new Error("Release denied"); },
  });
  await enabling;
  await context.toggleScreenWakeLock();
  assert.equal(context.screenWakeLockEnabled, true);
  assert.equal(context.screenWakeLockToggle.disabled, false);
  assert.equal(context.screenWakeLockToggle.checked, true);
  assert.match(context.screenWakeLockStatus.textContent, /release failed: Release denied/);
});

test("SEC-SIGLOG renders documented detection and event types with elapsed seconds", () => {
  const context = loadFunctions(["parseSecSigLog"], {
    secEvents: [],
    secEventLog: { innerHTML: "" },
    signalsEmpty: { hidden: true },
  });
  const events = [
    [125, 0, 0], [60, 1, 1], [3600, 2, 2], [86400, 3, 3],
    [12, 4, 3], [0xffffffff, 5, 0], [1, 6, 1], [3, 9, 8],
  ];
  const payload = new Uint8Array(8 + events.length * 8);
  payload[1] = events.length;
  const data = new DataView(payload.buffer);
  events.forEach(([elapsed, detection, event], index) => {
    const offset = 8 + index * 8;
    data.setUint32(offset, elapsed, true);
    payload[offset + 4] = detection;
    payload[offset + 5] = event;
  });

  context.parseSecSigLog(payload);

  assert.match(context.secEventLog.innerHTML, /Simulated signal - Indication started \(2m 5s ago\)/);
  assert.match(context.secEventLog.innerHTML, /Abnormal signal \(unsupported\) - Indication stopped \(1m 0s ago\)/);
  assert.match(context.secEventLog.innerHTML, /INS\/GNSS mismatch \(unsupported\) - Indication triggered \(1h 0m ago\)/);
  assert.match(context.secEventLog.innerHTML, /Abrupt GNSS signal changes - Indication timed out \(1d 0h ago\)/);
  assert.match(context.secEventLog.innerHTML, /Jamming indicated - Indication timed out \(12s ago\)/);
  assert.match(context.secEventLog.innerHTML, /Navigation-data authentication failed - Indication started \(more than 45 days ago\)/);
  assert.match(context.secEventLog.innerHTML, /Replayed signals - Indication stopped \(1s ago\)/);
  assert.match(context.secEventLog.innerHTML, /Detection type 9 - Event type 8 \(3s ago\)/);
  assert.equal(context.signalsEmpty.hidden, true);
});

test("SEC-SIGLOG replaces its event snapshot on repeated polls", () => {
  const context = loadFunctions(["parseSecSigLog"], {
    secEvents: [],
    secEventLog: { innerHTML: "" },
    signalsEmpty: { hidden: true },
  });
  const makePayload = (elapsed) => {
    const payload = new Uint8Array(16);
    payload[1] = 1;
    new DataView(payload.buffer).setUint32(8, elapsed, true);
    payload[12] = 4;
    payload[13] = 0;
    return payload;
  };

  context.parseSecSigLog(makePayload(60));
  context.parseSecSigLog(makePayload(61));

  assert.equal(context.secEvents.length, 1);
  assert.equal((context.secEventLog.innerHTML.match(/Jamming indicated/g) || []).length, 1);
  assert.match(context.secEventLog.innerHTML, /1m 1s ago/);
});

test("offline library copies are used before starting the app", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const loader = /<script>\s*((?:\s|.)*?)\s*<\/script>\s*<\/body>/.exec(html);
  assert.ok(loader, "Expected inline GNSS API loader before the end of the document");
  const scripts = [];
  const document = {
    createElement(tag) {
      assert.equal(tag, "script");
      return {};
    },
    head: { appendChild(script) { scripts.push(script); } },
    body: { appendChild(script) { scripts.push(script); } },
  };
  const window = {};
  vm.runInNewContext(loader[1], { document, window, console: { warn() {} } });

  assert.match(scripts[0].src, /^https:\/\/unpkg\.com\/leaflet@.+\/leaflet\.js$/);
  scripts[0].onerror();
  assert.equal(scripts[1].src, "leaflet.js");
  window.L = {};
  scripts[1].onload();
  assert.match(scripts[2].src, /^https:\/\/unpkg\.com\/maplibre-gl@.+\/maplibre-gl\.js$/);
  scripts[2].onerror();
  assert.equal(scripts[3].src, "maplibre-gl.js");
  window.maplibregl = {};
  scripts[3].onload();
  assert.match(scripts[4].src, /^https:\/\/cdn\.jsdelivr\.net\/npm\/satellite\.js@.+\/satellite\.min\.js$/);
  scripts[4].onerror();
  assert.equal(scripts[5].src, "satellite.min.js");
  window.satellite = {
    twoline2satrec() {}, propagate() {}, eciToEcf() {}, ecfToLookAngles() {},
    degreesToRadians() {}, radiansToDegrees() {}, gstime() {},
  };
  scripts[5].onload();
  assert.match(scripts[6].src, /^https:\/\/cdn\.jsdelivr\.net\/gh\/.+\/gnss-api\.js$/);
  scripts[6].onerror();
  assert.equal(scripts[7].src, "gnss-api.js");
  window.GNSSSatelliteAPI = { calculate() {} };
  scripts[7].onload();
  assert.equal(scripts[8].src, "insight.js");
  assert.equal(window.GNSSSatellitePredictionsEnabled, true);
});

test("app starts with TLE predictions disabled when satellite.js is unavailable", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const loader = /<script>\s*((?:\s|.)*?)\s*<\/script>\s*<\/body>/.exec(html);
  const scripts = [];
  const document = {
    createElement() { return {}; },
    head: { appendChild(script) { scripts.push(script); } },
    body: { appendChild(script) { scripts.push(script); } },
  };
  const window = {};
  vm.runInNewContext(loader[1], { document, window, console: { warn() {} } });

  scripts[0].onerror();
  scripts[1].onerror();
  scripts[2].onerror();
  scripts[3].onerror();
  scripts[4].onerror();
  scripts[5].onerror();
  scripts[6].onerror();
  scripts[7].onerror();
  assert.equal(scripts[8].src, "insight.js");
  assert.equal(window.GNSSSatellitePredictionsEnabled, false);
});

test("missing satellite.js disables prediction work but reports that live satellite data remains active", async () => {
  const context = loadFunctions(["renderSatellitePredictionComparison", "requestSatelliteOrbitPredictions"], {
    satellitePredictionsEnabled: false,
    satellitePredictionStatus: { textContent: "" },
    satelliteComparisonRows: { innerHTML: "" },
  });
  context.renderSatellitePredictionComparison([], null, [], "NAV", null, Date.now());
  await context.requestSatelliteOrbitPredictions("NAV");
  assert.match(context.satellitePredictionStatus.textContent, /satellite\.js could not be loaded/);
  assert.match(context.satelliteComparisonRows.innerHTML, /live satellite data is still active/);
});

test("compact mode defaults off and preserves only boolean saved choices", () => {
  for (const saved of [{}, { compactMode: true }, { compactMode: false }, { compactMode: "true" }]) {
    const context = loadFunctions(["loadSettings"], {
      DEFAULT_SETTINGS: { compactMode: false, baudByReceiver: {} }, SETTINGS_KEY: "settings",
      localStorage: { getItem: () => JSON.stringify(saved) },
    });
    assert.equal(context.loadSettings().compactMode, saved.compactMode === true);
  }
});

test("compact mode applies and removes the layout class", () => {
  const classes = new Set();
  const context = loadFunctions(["applyCompactMode"], {
    settings: { compactMode: true },
    document: { body: { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } } },
  });
  context.applyCompactMode();
  assert.equal(classes.has("compact-mode"), true);
  context.settings.compactMode = false;
  context.applyCompactMode();
  assert.equal(classes.has("compact-mode"), false);
});

test("legacy settings use enabled map and interface defaults and preserve explicit choices", () => {
  const defaults = { configureAllInterfaces: true, enableOsnma: true, enableGalHas: false, strictOsnma: false, satelliteLocationLocked: false, satelliteLocationMode: "receiver", satelliteLockedLatitude: null, satelliteLockedLongitude: null, positionSource: "NAV", showAverage: true, averageFrames: 10, showPeak: true, peakDecay: 0.5, darkMap: true, waterfallMinutes: 10, waterfallMarkerMinutes: 5, lastReceiver: "x20", baudByReceiver: { f9p: 115200, x20: 38400 } };
  const context = loadFunctions(["loadSettings"], {
    DEFAULT_SETTINGS: defaults,
    SETTINGS_KEY: "settings",
    localStorage: { getItem: () => JSON.stringify({ lastReceiver: "x20", baudByReceiver: { x20: 38400 } }) },
  });
  const settings = context.loadSettings();
  assert.equal(settings.configureAllInterfaces, true);
  assert.equal(settings.enableOsnma, true);
  assert.equal(settings.enableGalHas, false);
  assert.equal(settings.strictOsnma, false);
  assert.equal(settings.positionSource, "NAV");
  assert.equal(settings.darkMap, true);
  assert.equal(settings.lastReceiver, "x20");

  const explicitContext = loadFunctions(["loadSettings"], {
    DEFAULT_SETTINGS: defaults,
    SETTINGS_KEY: "settings",
    localStorage: { getItem: () => JSON.stringify({ configureAllInterfaces: false, darkMap: false, strictOsnma: true, satelliteLocationLocked: true, satelliteLocationMode: "manual", satelliteLockedLatitude: 64.1, satelliteLockedLongitude: -21.9 }) },
  });
  const explicitSettings = explicitContext.loadSettings();
  assert.equal(explicitSettings.configureAllInterfaces, false);
  assert.equal(explicitSettings.darkMap, false);
  assert.equal(explicitSettings.strictOsnma, true);
  assert.equal(explicitSettings.satelliteLocationLocked, true);
  assert.equal(explicitSettings.satelliteLocationMode, "manual");
  assert.equal(explicitSettings.satelliteLockedLatitude, 64.1);
  assert.equal(explicitSettings.satelliteLockedLongitude, -21.9);
  assert.equal(explicitSettings.lastReceiver, "x20");
  const f9pContext = loadFunctions(["loadSettings"], {
    DEFAULT_SETTINGS: defaults,
    SETTINGS_KEY: "settings",
    localStorage: { getItem: () => JSON.stringify({ lastReceiver: "f9p" }) },
  });
  assert.equal(f9pContext.loadSettings().lastReceiver, "f9p");
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

test("HAS diagnostics stays collapsed when disabled or unsupported and returns when enabled", () => {
  const context = loadFunctions(["renderHasDiagnostics"], {
    receiver: { value: "x20" }, settings: { enableGalHas: false, enableOsnma: false },
    hasDiagnosticsPanel: {}, hasDiagnosticsStatus: { dataset: {} }, hasNav2Engine: {},
    hasCoexistWarning: {}, hasNavCount: {}, hasNav2Count: {},
    hasCorrectionReports: { NAV: null, NAV2: null },
  });
  context.renderHasDiagnostics();
  assert.equal(context.hasDiagnosticsPanel.hidden, true);
  context.settings.enableGalHas = true;
  context.renderHasDiagnostics();
  assert.equal(context.hasDiagnosticsPanel.hidden, false);
  assert.equal(context.hasNavCount.textContent, "Waiting for NAV-SAT");
  context.settings.enableOsnma = true;
  context.renderHasDiagnostics();
  assert.equal(context.hasDiagnosticsPanel.hidden, false);
  assert.equal(context.hasCoexistWarning.hidden, false);
  context.settings.enableGalHas = false;
  context.renderHasDiagnostics();
  assert.equal(context.hasDiagnosticsPanel.hidden, true);
  context.settings.enableGalHas = true;
  context.receiver.value = "f9p";
  context.renderHasDiagnostics();
  assert.equal(context.hasDiagnosticsPanel.hidden, true);
});

test("HAS settings disable on F9P and warn for the unsupported X20 combination", () => {
  const label = { title: "" };
  const strictLabel = { title: "" };
  const context = loadFunctions(["updateGnssIntegritySettingsForm"], {
    receiver: { value: "f9p" },
    enableOsnma: { checked: true },
    enableGalHas: { checked: true, disabled: false, title: "", closest: () => label },
    strictOsnma: { checked: false, disabled: false, title: "", closest: () => strictLabel },
    strictOsnmaSupportNote: { hidden: true },
    hasSupportNote: { hidden: true },
    gnssIntegrityWarning: { hidden: true },
  });
  context.updateGnssIntegritySettingsForm();
  assert.equal(context.enableGalHas.disabled, true);
  assert.equal(context.strictOsnma.disabled, true);
  assert.equal(context.strictOsnmaSupportNote.hidden, false);
  assert.equal(context.hasSupportNote.hidden, false);
  assert.equal(context.gnssIntegrityWarning.hidden, true);
  context.receiver.value = "x20";
  context.updateGnssIntegritySettingsForm();
  assert.equal(context.enableGalHas.disabled, false);
  assert.equal(context.strictOsnma.disabled, false);
  assert.equal(context.strictOsnmaSupportNote.hidden, true);
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

test("signal PNG export retains readout colors and wraps values within the image", () => {
  const textRuns = [];
  let exportCanvas;
  const drawing = {
    measureText(text) { return { width: text.length * 6 }; }, fillRect() {}, drawImage() {},
    fillText(text, x, y) { textRuns.push({ text, x, y, color: this.fillStyle }); },
  };
  const readout = { childNodes: [
    { nodeType: 3, textContent: "Epoch 5 | 2026-10-23 12:00:00.000 UTC | " },
    { nodeType: 1, textContent: "RF 1: 1234.0", style: { color: "#44ccff" } },
    { nodeType: 3, textContent: " | " },
    { nodeType: 1, textContent: "RF 2: 2345.0", style: { color: "#88eeff" } },
    { nodeType: 3, textContent: " | " },
    { nodeType: 1, textContent: "PGA: 25.0", style: { color: "#ff66cc" } },
  ] };
  const canvas = { width: 240, height: 200, closest: () => ({ querySelector: () => readout }) };
  const context = loadFunctions(["downloadCanvasPng", "signalExportReadout"], {
    window: { devicePixelRatio: 1 }, signalHover: new Map([[canvas, 5]]),
    document: { createElement() { exportCanvas = { getContext: () => drawing, toBlob() {} }; return exportCanvas; } },
  });
  context.downloadCanvasPng(canvas, "AGC", () => context.signalExportReadout(canvas));
  assert.ok(exportCanvas.height > canvas.height + 44);
  const footer = textRuns.slice(1);
  assert.equal(footer.map((run) => run.text).join(""), "Cursor: " + readout.childNodes.map((node) => node.textContent).join(""));
  for (const color of ["#44ccff", "#88eeff", "#ff66cc"]) assert.ok(footer.some((run) => run.color === color));
  assert.ok(footer.every((run) => run.x >= 12 && run.x + drawing.measureText(run.text).width <= 228));
  assert.ok(footer.every((run) => run.y + 11 <= exportCanvas.height));
  context.signalHover.clear();
  assert.equal(context.signalExportReadout(canvas).length, 0);
  context.downloadCanvasPng(canvas, "AGC", () => context.signalExportReadout(canvas));
  assert.equal(exportCanvas.height, canvas.height + 30);
});

test("RXM-RAWX decodes Doppler per signal and draws successive measurements", () => {
  let segments = 0;
  let redraws = 0;
  const drawing = new Proxy({ lineTo() { segments += 1; } }, {
    get(target, property) { return target[property] ?? (() => {}); },
  });
  const canvas = { getContext: () => drawing };
  const context = loadFunctions(["appendHistory", "appendSeries", "parseRawx", "drawSignalChart", "signalSampleEpoch"], {
    DataView, Number, signalEpoch: { latest: null, tow: null }, signalHistory: { doppler: new Map() },
    signalsEmpty: { hidden: false }, replayRebuilding: false, gnssColor: () => "#ffffff",
    drawSignals() { redraws += 1; }, HISTORY_LENGTH: 600,
    sizeCanvas: () => ({ width: 800, height: 400 }), window: { devicePixelRatio: 1 },
    signalChartState: new Map(), signalHover: new Map(),
  });
  const payload = new Uint8Array(96).subarray(8, 88);
  const data = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  payload[11] = 2;
  payload[13] = 1;
  for (const [index, signalId] of [0, 3].entries()) {
    const offset = 16 + index * 32;
    payload[offset + 20] = 2;
    payload[offset + 21] = 12;
    payload[offset + 22] = signalId;
    data.setFloat32(offset + 16, -1234.5 - index * 100, true);
  }
  context.parseRawx(payload);
  data.setFloat64(0, 1, true);
  data.setFloat32(32, -1230.25, true);
  context.parseRawx(payload);
  const histories = context.signalHistory.doppler;
  assert.equal(histories.size, 2);
  assert.equal(histories.get("2:12:0").values[0].value, -1234.5);
  assert.equal(histories.get("2:12:0").values[1].value, -1230.25);
  assert.equal(histories.get("2:12:3").values[1].value, -1334.5);
  assert.equal(redraws, 2);
  assert.equal(context.signalsEmpty.hidden, true);
  context.drawSignalChart(canvas, [...histories.values()], {});
  assert.equal(context.signalChartState.get(canvas).lastEpoch, 2);
  assert.equal(segments, 7);
});

test("shared signal epochs preserve missing seconds, duplicates, late arrival and GPS week rollover", () => {
  const context = loadFunctions(["signalSampleEpoch"], { signalEpoch: { latest: null, tow: null } });
  assert.equal(context.signalSampleEpoch(), 1);
  assert.equal(context.signalSampleEpoch(604798000), 1);
  assert.equal(context.signalSampleEpoch(604798000), 1);
  assert.equal(context.signalSampleEpoch(1000), 4);
  assert.equal(context.signalSampleEpoch(), 4);
  assert.equal(context.signalSampleEpoch(604799000), 2);
  assert.equal(context.signalEpoch.latest, 4);
  assert.equal(context.signalSampleEpoch(2000), 5);
  assert.equal(context.signalSampleEpoch(NaN), 5);
});

test("signal timeline rebases on receiver time-of-week resets", () => {
  const signalEpoch = { latest: null, tow: null, clocks: new Map([[1, 123]]), computerClocks: new Map([[1, 456]]) };
  const marker = {};
  const signalHover = new WeakMap([[marker, 1]]);
  const signalHoverPinned = new WeakSet([marker]);
  const context = loadFunctions(["signalSampleEpoch"], { signalEpoch, signalHover, signalHoverPinned });
  assert.equal(context.signalSampleEpoch(50000), 1);
  assert.equal(context.signalSampleEpoch(51000), 2);
  assert.equal(context.signalSampleEpoch(0), 4);
  assert.equal(context.signalSampleEpoch(1000), 5);
  assert.equal(signalEpoch.clocks.size, 0);
  assert.equal(signalEpoch.computerClocks.size, 0);
  assert.equal(context.signalHover.has(marker), false);
  assert.equal(context.signalHoverPinned.has(marker), false);
});

test("signal redraw requests coalesce within an animation frame", () => {
  let scheduled;
  let redraws = 0;
  const context = loadFunctions(["scheduleSignalDraw"], {
    signalDrawQueued: false,
    requestAnimationFrame(callback) { scheduled = callback; },
    drawSignals() { redraws += 1; },
  });
  context.scheduleSignalDraw();
  context.scheduleSignalDraw();
  assert.equal(redraws, 0);
  scheduled();
  assert.equal(redraws, 1);
});

test("status tooltip tracks the full visible message", () => {
  const status = { textContent: "", title: "", classList: { toggle() {} } };
  const context = loadFunctions(["renderStatusMessage"], {
    status,
    statusMessage: "Connected at 38 400; waiting for UBX data",
    receiverTxWarningMessage: "UART1 TX 98% above 90%: increase baud rate in Settings (MON-COMMS telemetry stale)",
  });
  context.renderStatusMessage();
  assert.equal(status.title, status.textContent);
  assert.match(status.title, /MON-COMMS telemetry stale/);
  context.receiverTxWarningMessage = "";
  context.renderStatusMessage();
  assert.equal(status.title, "Connected at 38 400; waiting for UBX data");
});

test("live reconnect clears partial UBX frames and resets derived graph state", () => {
  let resetMaps;
  const context = loadFunctions(["resetLiveConnectionState"], {
    receiveBuffer: new Uint8Array([0xb5, 0x62, 0x01]),
    resetReplayDerivedViews(removeMaps) { resetMaps = removeMaps; },
  });
  context.resetLiveConnectionState();
  assert.equal(context.receiveBuffer.length, 0);
  assert.equal(resetMaps, false);
});

test("all signal chart windows advance together despite missing reports and constellation filtering", () => {
  const charts = [];
  const context = loadFunctions(["drawSignals"], {
    signalEpoch: { latest: 20, tow: 19000 }, activeConstellations: new Set([0]), BAND_MARKERS: [],
    signalHistory: { cno: new Map([["0:1", { values: [{ epoch: 18, value: 42 }] }]]), doppler: new Map([["2:1:0", { values: [{ epoch: 1, value: -100 }] }]]), jamState: [], jamIndex: [], agc: [], pga: [], spoof: [], secJam: [], secSpoof: [], secFrequency: [] },
    signalCharts: { cno: "cno", doppler: "doppler", jamState: "jamState", jamIndex: "jamIndex", agc: "agc", spoof: "spoof", secState: "secState", secFrequency: "secFrequency" },
    drawSignalChart(canvas, series, options) { charts.push({ canvas, series, options }); }, renderGnssThreatSummary() {},
    renderSignalReadout() {},
  });
  context.drawSignals();
  assert.equal(charts.length, 8);
  assert.ok(charts.every((chart) => chart.options.lastEpoch === 20));
  assert.equal(charts.find((chart) => chart.canvas === "doppler").series.length, 0);
  for (const name of ["jamState", "spoof"]) {
    const { options } = charts.find((chart) => chart.canvas === name);
    assert.equal(options.min, -0.5);
    assert.equal(options.max, 3.5);
    assert.deepEqual(Array.from(options.yTicks), [0, 1, 2, 3]);
  }
  const secStateOptions = charts.find((chart) => chart.canvas === "secState").options;
  assert.equal(secStateOptions.min, 0.5);
  assert.equal(secStateOptions.max, 3.5);
  assert.deepEqual(Array.from(secStateOptions.yTicks), [1, 2, 3]);
  assert.equal(charts.find((chart) => chart.canvas === "jamIndex").options.min, 0);
  assert.equal(charts.find((chart) => chart.canvas === "jamIndex").options.max, 255);
});

test("NAV epochs advance every graph even when C/N0 and RAWX reports are missing", () => {
  let redraws = 0;
  const context = loadFunctions(["handleUbx", "parseNavSat", "decodeSatelliteReport", "parseHasCorrectionCounts", "parseRawx", "parseMonRf", "parseNavStatus", "parseSecSig", "signalSampleEpoch", "recordSignalUtc", "recordSignalComputerTime", "appendHistory", "appendSeries"], {
    signalEpoch: { latest: null, tow: null }, replayRebuilding: false, HISTORY_LENGTH: 600,
    replayData: null,
    satelliteReports: { NAV: null, NAV2: null }, hasCorrectionReports: { NAV: null, NAV2: null },
    signalHistory: { cno: new Map(), doppler: new Map(), jamState: [], jamIndex: [], agc: [], pga: [], spoof: [], secJam: [], secSpoof: [], secFrequency: [] },
    receiverThreat: {}, signalsEmpty: {}, secSecuritySummary: {}, secSigFramesReceived: 0, secSigRawFramesReceived: 0,
    renderSatellites() {}, renderHasDiagnostics() {}, gnssColor() {}, parseNavPvt() {}, drawSignals() { redraws++; },
  });
  const sat = new Uint8Array(20); sat[4] = 1; sat[5] = 1; sat[9] = 1; sat[10] = 42;
  const raw = new Uint8Array(48); raw[11] = 1; raw[37] = 1;
  const pvt = new Uint8Array(92);
  const rf = new Uint8Array(28); rf[1] = 1;
  const sec = new Uint8Array([2, 0, 0, 0]);
  context.handleUbx(1, 0x35, sat);
  context.handleUbx(2, 0x15, raw);
  context.handleUbx(0x0a, 0x38, rf);
  context.handleUbx(0x27, 9, sec);
  new DataView(pvt.buffer).setUint32(0, 3000, true);
  const previousRedraws = redraws;
  context.handleUbx(1, 7, pvt);
  assert.equal(context.signalEpoch.latest, 4);
  assert.ok(redraws > previousRedraws);
  context.handleUbx(0x0a, 0x38, rf);
  context.handleUbx(0x27, 9, sec);
  assert.deepEqual(Array.from(context.signalHistory.jamState[0], (sample) => sample.epoch), [1, 4]);
  assert.deepEqual(Array.from(context.signalHistory.secJam, (sample) => sample.epoch), [1, 4]);
  assert.equal(context.signalHistory.pga.length, 0);
  assert.equal(context.signalHistory.cno.get("0:1").values.length, 1);
  new DataView(raw.buffer).setFloat64(0, 3, true);
  context.handleUbx(2, 0x15, raw);
  assert.deepEqual(Array.from(context.signalHistory.doppler.get("0:1:0").values, (sample) => sample.epoch), [1, 4]);
  new DataView(sat.buffer).setUint32(0, 1000, true);
  context.handleUbx(1, 0x35, sat);
  assert.equal(context.signalEpoch.latest, 4);
  assert.equal(context.signalHistory.cno.get("0:1").values.at(-1).epoch, 2);
});

test("signal charts retain a shared empty window and break lines across missing epochs", () => {
  const connections = [];
  const drawing = new Proxy({ lineTo(x, y) { connections.push([x, y]); } }, { get(target, property) { return target[property] ?? (() => {}); } });
  const canvas = { getContext: () => drawing };
  const context = loadFunctions(["drawSignalChart"], {
    sizeCanvas: () => ({ width: 800, height: 400 }), window: { devicePixelRatio: 1 },
    HISTORY_LENGTH: 600, signalChartState: new Map(), signalHover: new Map(),
  });
  context.drawSignalChart(canvas, [{ values: [{ epoch: 1, value: 42 }, { epoch: 3, value: 43 }, { epoch: 4, value: 44 }] }], { lastEpoch: 10 });
  assert.equal(connections.length, 6);
  assert.equal(context.signalChartState.get(canvas).lastEpoch, 10);
  assert.equal(context.signalChartState.get(canvas).firstEpoch, -589);
  context.drawSignalChart(canvas, [], { lastEpoch: 11 });
  assert.equal(context.signalChartState.get(canvas).lastEpoch, 11);
  context.drawSignalChart(canvas, [{ values: [{ epoch: 1, value: 99999 }] }], { lastEpoch: 700 });
  assert.equal(context.signalChartState.get(canvas).firstEpoch, 101);
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
  const context = loadFunctions(["parseSecSig", "signalSampleEpoch"], {
    secSigRawFramesReceived: 0, secSigFramesReceived: 0,
    secSecuritySummary: { innerHTML: "" }, signalsEmpty: { hidden: true }, replayRebuilding: false,
    receiverThreat: { secJam: null, secSpoof: null, secJamEnabled: null, secSpoofEnabled: null },
    signalEpoch: { latest: null, tow: null }, signalHistory: { secJam: [], secSpoof: [], secFrequency: [] },
    appendHistory(history, sample) { history.push(sample); }, drawSignals() {},
  });
  const payload = new Uint8Array([2, 0b00101011, 0, 0]);
  context.parseSecSig(payload);
  assert.equal(context.signalHistory.secFrequency[0].epoch, 1);
  assert.equal(context.signalHistory.secFrequency[0].value, null);
  assert.equal(context.receiverThreat.secJamEnabled, true);
  assert.equal(context.receiverThreat.secSpoofEnabled, true);
});

test("computer marker timestamps are independent of receiver time and app corrections", () => {
  let now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const Clock = class extends Date { static now() { return now; } };
  const context = loadFunctions(["recordSignalComputerTime", "signalEpochTime", "signalSampleEpoch", "formatSignalTimestamp"], {
    Date: Clock, signalEpoch: { latest: null, tow: null }, HISTORY_LENGTH: 600,
    signalMarkerLocalTime: { checked: false },
    replayData: null, replayRebuilding: false, signalMarkerTimeSource: { value: "computer" }, appClockOffsetMs: 86400000,
  });
  const first = context.signalSampleEpoch(100000);
  context.recordSignalComputerTime(first);
  assert.equal(context.signalEpochTime(first), "Computer RX 2026-10-23 12:00:00.000 UTC");
  now += 1000;
  context.recordSignalComputerTime(first);
  assert.equal(context.signalEpochTime(first), "Computer RX 2026-10-23 12:00:00.000 UTC");
  const jumped = context.signalSampleEpoch(200000);
  context.recordSignalComputerTime(jumped);
  context.signalEpoch.clocks = new Map([[jumped, Date.UTC(2099, 0, 1)]]);
  assert.equal(context.signalEpochTime(jumped), "Computer RX 2026-10-23 12:00:01.000 UTC");
  assert.equal(context.signalEpochTime(jumped - 1), "Computer reception time unavailable");
  context.signalMarkerTimeSource.value = "receiver";
  assert.equal(context.signalEpochTime(jumped), "Receiver 2099-01-01 00:00:00.000 UTC");
  context.signalMarkerTimeSource.value = "computer";
  assert.equal(context.signalEpochTime(jumped), "Computer RX 2026-10-23 12:00:01.000 UTC");
});

test("computer marker time never stamps replay with the current clock and stays bounded live", () => {
  const context = loadFunctions(["recordSignalComputerTime", "signalEpochTime", "formatSignalTimestamp"], {
    signalEpoch: { latest: 1, tow: 0 }, HISTORY_LENGTH: 600, replayData: new Uint8Array(1), replayRebuilding: false,
    signalMarkerLocalTime: { checked: false },
    signalMarkerTimeSource: { value: "computer" },
  });
  context.recordSignalComputerTime(1);
  assert.equal(context.signalEpoch.computerClocks, undefined);
  assert.equal(context.signalEpochTime(1), "Computer capture time unavailable (replay)");
  context.replayData = null;
  context.replayRebuilding = true;
  context.recordSignalComputerTime(1);
  assert.equal(context.signalEpoch.computerClocks, undefined);
  context.replayRebuilding = false;
  for (let epoch = 1; epoch <= 601; epoch++) {
    context.signalEpoch.latest = epoch;
    context.recordSignalComputerTime(epoch);
  }
  assert.equal(context.signalEpoch.computerClocks.size, 600);
  assert.equal(context.signalEpoch.computerClocks.has(1), false);
  context.signalEpoch = { latest: null, tow: null };
  assert.equal(context.signalEpochTime(1), "Time unavailable");
});

test("signal marker local-time checkbox formats both clock sources without changing timestamps", () => {
  const timestamp = Date.UTC(2026, 9, 23, 2, 0, 0, 123);
  const localTime = { checked: false };
  const context = loadFunctions(["signalEpochTime", "formatSignalTimestamp"], {
    signalEpoch: { latest: 5, tow: 100000, computerClocks: new Map([[5, timestamp]]), clocks: new Map([[5, timestamp]]) },
    signalMarkerTimeSource: { value: "computer" }, signalMarkerLocalTime: localTime, replayData: null,
    Intl: { DateTimeFormat: function(locale, options) { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "America/New_York" }); } },
  });
  assert.equal(context.signalEpochTime(5), "Computer RX 2026-10-23 02:00:00.123 UTC");
  assert.equal(context.signalEpochTime(5.02), "Computer RX 2026-10-23 02:00:00.123 UTC");
  localTime.checked = true;
  assert.match(context.signalEpochTime(5), /Computer RX.*22\/10\/2026.*22:00:00.123.*\(local\)/);
  context.signalMarkerTimeSource.value = "receiver";
  assert.match(context.signalEpochTime(5), /Receiver.*22\/10\/2026.*22:00:00.123.*\(local\)/);
  assert.equal(context.signalEpoch.computerClocks.get(5), timestamp);
  assert.equal(context.signalEpoch.clocks.get(5), timestamp);
  assert.match(context.formatSignalTimestamp(Date.UTC(2026, 0, 23, 12)), /07:00:00.000.*\(local\)/);
  localTime.checked = false;
  assert.equal(context.signalEpochTime(5), "Receiver 2026-10-23 02:00:00.123 UTC");
});

test("signal marker time uses GPS TOW until valid receiver UTC is available", () => {
  const context = loadFunctions(["signalSampleEpoch", "recordSignalUtc", "signalEpochTime", "formatSignalTimestamp"], {
    signalEpoch: { latest: null, tow: null }, HISTORY_LENGTH: 600,
    signalMarkerLocalTime: { checked: false },
    signalMarkerTimeSource: { value: "receiver" },
  });
  assert.equal(context.signalEpochTime(1), "Time unavailable");
  context.signalSampleEpoch(604799000);
  context.signalSampleEpoch(1000);
  assert.equal(context.signalEpochTime(1), "GPS TOW 604799.000 s");
  assert.equal(context.signalEpochTime(3), "GPS TOW 1.000 s");
  const payload = new Uint8Array(92); const data = new DataView(payload.buffer);
  data.setUint32(0, 1000, true); data.setUint16(4, 2026, true);
  payload[6] = 10; payload[7] = 24;
  context.recordSignalUtc(payload, 7);
  assert.equal(context.signalEpochTime(3), "GPS TOW 1.000 s");
  payload[11] = 3; data.setInt32(16, -250000000, true);
  context.recordSignalUtc(payload, 7);
  assert.equal(context.signalEpochTime(3), "Receiver 2026-10-23 23:59:59.750 UTC");
  assert.equal(context.signalEpochTime(2), "Receiver 2026-10-23 23:59:58.750 UTC (estimated)");
  payload[6] = 13;
  context.recordSignalUtc(payload, 7);
  assert.equal(context.signalEpochTime(3), "Receiver 2026-10-23 23:59:59.750 UTC");
  assert.equal(context.signalEpochTime(0), "Time unavailable");
});

test("signal UTC history preserves clock changes, handles TIMEUTC and stays bounded", () => {
  const context = loadFunctions(["signalSampleEpoch", "recordSignalUtc", "signalEpochTime", "formatSignalTimestamp"], {
    signalEpoch: { latest: null, tow: null }, HISTORY_LENGTH: 600,
    signalMarkerLocalTime: { checked: false },
    signalMarkerTimeSource: { value: "receiver" },
  });
  const payload = new Uint8Array(20); const data = new DataView(payload.buffer);
  data.setUint16(12, 2026, true); payload[14] = 10; payload[15] = 23; payload[16] = 12;
  payload[19] = 4;
  context.recordSignalUtc(payload, 0x21);
  assert.equal(context.signalEpochTime(1), "Time unavailable");
  payload[19] = 7;
  context.recordSignalUtc(payload, 0x21);
  data.setUint32(0, 1000, true); payload[18] = 10;
  context.recordSignalUtc(payload, 0x21);
  assert.equal(context.signalEpochTime(1), "Receiver 2026-10-23 12:00:00.000 UTC");
  assert.equal(context.signalEpochTime(2), "Receiver 2026-10-23 12:00:10.000 UTC");
  for (let index = 2; index <= 601; index++) {
    data.setUint32(0, index * 1000, true);
    context.recordSignalUtc(payload, 0x21);
  }
  assert.equal(context.signalEpoch.clocks.size, 600);
  assert.equal(context.signalEpoch.clocks.has(1), false);
  context.signalEpoch = { latest: null, tow: null };
  assert.equal(context.signalEpochTime(1), "Time unavailable");
});

test("signal markers synchronize hover, pin and clear across empty and populated charts", () => {
  const chart = () => {
    const readout = { innerHTML: "", textContent: "" };
    return { readout, getBoundingClientRect: () => ({ left: 0 }), closest: () => ({ querySelector: () => readout }) };
  };
  const cno = chart(); const jam = chart(); const empty = chart();
  const state = (series) => ({ series, box: { x: 0, width: 100 }, firstEpoch: 0, lastEpoch: 10 });
  const context = loadFunctions(["updateSignalHover", "clearSignalHover", "renderSignalReadout"], {
    signalCharts: { cno, jam, empty }, signalHover: new Map(), signalHoverPinned: new Set(),
    signalChartState: new Map([[cno, state([{ label: "0:1", values: [{ epoch: 5, value: 42 }] }])], [jam, state([{ label: "Jamming", color: "red", values: [{ epoch: 5, value: 1 }] }])], [empty, state([])]]),
    signalEpochTime: () => "2026-10-23 12:00:05.000 UTC", window: { devicePixelRatio: 1 }, drawSignals() {},
  });
  assert.equal(context.updateSignalHover(cno, { clientX: 50 }), true);
  for (const canvas of [cno, jam, empty]) {
    assert.equal(context.signalHover.get(canvas), 5);
    assert.match(canvas.readout.innerHTML, /Epoch 5.*2026-10-23 12:00:05.000 UTC/);
  }
  assert.doesNotMatch(cno.readout.innerHTML, /0:1/);
  assert.match(jam.readout.innerHTML, /Jamming: 1.0/);
  context.updateSignalHover(empty, { clientX: 60 }, true);
  assert.equal(context.signalHoverPinned.size, 3);
  assert.equal(context.updateSignalHover(jam, { clientX: 90 }), false);
  assert.equal(context.signalHover.get(cno), 6);
  assert.match(jam.readout.innerHTML, /Jamming: n\/a/);
  context.clearSignalHover(jam);
  assert.equal(context.signalHover.size, 0);
  assert.equal(context.signalHoverPinned.size, 0);
  for (const canvas of [cno, jam, empty]) assert.match(canvas.readout.textContent, /Move cursor/);
});

test("signal cursor snaps to fractional samples and matches small timing offsets without filling gaps", () => {
  const chart = () => {
    const readout = { innerHTML: "", textContent: "" };
    return { readout, getBoundingClientRect: () => ({ left: 0 }), closest: () => ({ querySelector: () => readout }) };
  };
  const jam = chart(); const agc = chart(); const frequency = chart();
  const state = (label, values) => ({ series: [{ label, color: "red", values }], box: { x: 0, width: 900 }, firstEpoch: 1, lastEpoch: 10 });
  const context = loadFunctions(["updateSignalHover", "renderSignalReadout"], {
    signalCharts: { jam, agc, frequency }, signalHover: new Map(), signalHoverPinned: new Set(),
    signalChartState: new Map([
      [jam, state("RF 1", [{ epoch: 5.25, value: 2 }, { epoch: 7.25, value: 3 }])],
      [agc, state("RF 1", [{ epoch: 5.27, value: 1234 }, { epoch: 7.27, value: 2345 }])],
      [frequency, state("Frequency", [{ epoch: 5.25, value: 1575420000 }, { epoch: 5.25, value: 1227600000 }])],
    ]),
    signalEpochTime: () => "test time", window: { devicePixelRatio: 1 }, drawSignals() {},
  });
  context.updateSignalHover(jam, { clientX: 425 });
  assert.equal(context.signalHover.get(jam), 5.25);
  assert.equal(context.signalHover.get(agc), 5.25);
  assert.match(jam.readout.innerHTML, /RF 1: 2.0/);
  assert.match(agc.readout.innerHTML, /RF 1: 1234.0/);
  assert.match(frequency.readout.innerHTML, /1575420000.0, 1227600000.0/);
  context.updateSignalHover(jam, { clientX: 525 });
  assert.match(jam.readout.innerHTML, /RF 1: n\/a/);
  assert.match(agc.readout.innerHTML, /RF 1: n\/a/);
  assert.match(frequency.readout.innerHTML, /Frequency: n\/a/);
});

test("signal hover reports an empty frequency epoch as unavailable", () => {
  const readout = { innerHTML: "" };
  const canvas = { getBoundingClientRect: () => ({ left: 0 }), closest: () => ({ querySelector: () => readout }) };
  const context = loadFunctions(["updateSignalHover", "renderSignalReadout"], {
    signalChartState: new Map([[canvas, { series: [{ label: "Jammed frequency", color: "red", values: [{ epoch: 2, value: null }] }], box: { x: 0, width: 100 }, firstEpoch: 1, lastEpoch: 2 }]]),
    signalHover: new Map(), signalHoverPinned: new Set(), window: { devicePixelRatio: 1 }, drawSignals() {},
    signalCharts: { secFrequency: canvas }, signalEpochTime: () => "GPS TOW 2.000 s",
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

test("compact GNSS threat summaries appear on every tab and share the same live statuses", () => {
  const makeSummary = () => {
    const indicators = Array.from({ length: 4 }, () => {
      const status = { textContent: "Waiting" };
      return { dataset: { state: "waiting" }, querySelector: () => status, status };
    });
    const classes = new Set(["gnss-threat-summary"]);
    return {
      id: "gnss-threat-summary",
      classList: { add: (value) => classes.add(value), contains: (value) => classes.has(value) },
      removeAttribute(name) { if (name === "id") this.id = ""; },
      cloneNode() { return makeSummary(); },
      querySelectorAll: () => indicators,
      indicators,
    };
  };
  const sourceSummary = makeSummary();
  const panels = Array.from({ length: 4 }, () => ({ prepend(summary) { this.summary = summary; } }));
  const document = {
    querySelector(selector) {
      assert.equal(selector, "#gnss-threat-summary");
      return sourceSummary;
    },
    querySelectorAll(selector) {
      if (selector === '[role="tabpanel"]:not(#signals-panel)') return panels;
      assert.equal(selector, ".gnss-threat-summary .gnss-threat-indicator");
      return [sourceSummary, ...panels.map((panel) => panel.summary)].flatMap((summary) => summary.indicators);
    },
  };
  const context = loadFunctions(["addCompactGnssThreatSummaries", "gnssThreatPresentation", "renderGnssThreatSummary"], {
    document,
    receiverThreat: { monRfJam: 3, navSpoof: 2, secJam: 2, secSpoof: 3, secJamEnabled: true, secSpoofEnabled: true },
  });

  context.addCompactGnssThreatSummaries();
  context.gnssThreatIndicators = document.querySelectorAll(".gnss-threat-summary .gnss-threat-indicator");
  context.renderGnssThreatSummary();

  assert.equal(panels.length, 4);
  assert.ok(panels.every((panel) => panel.summary.id === "" && panel.summary.classList.contains("gnss-threat-summary-compact")));
  const indicators = context.gnssThreatIndicators;
  assert.equal(indicators.length, 20);
  for (let index = 0; index < indicators.length; index += 4) {
    assert.deepEqual(
      Array.from(indicators.slice(index, index + 4), (indicator) => [indicator.dataset.state, indicator.status.textContent]),
      [["bad", "Critical"], ["warning", "Indicated"], ["warning", "Warning"], ["bad", "Affirmed"]],
    );
  }
});

test("system stats thresholds use current CPU, memory and serial TX percentages", () => {
  const context = loadFunctions(["systemStatsSeverity"], {});
  const tx = (usage) => ({ ports: new Map([[0x0300, { usage, peak: 100 }]]) });
  assert.equal(context.systemStatsSeverity(null, null).state, "idle");
  assert.equal(context.systemStatsSeverity({ cpu: 90, memory: 60, cpuMax: 100, io: 100 }, tx(6)).state, "normal");
  assert.equal(context.systemStatsSeverity({ cpu: 91 }, null).state, "warning");
  assert.equal(context.systemStatsSeverity({ memory: 95 }, null).state, "warning");
  assert.equal(context.systemStatsSeverity({ cpu: 96 }, null).state, "critical");
  assert.equal(context.systemStatsSeverity(null, tx(96)).state, "critical");
  assert.equal(context.systemStatsSeverity(null, tx(95)).state, "warning");
  assert.equal(context.systemStatsSeverity({ cpu: 255, memory: NaN }, tx(255)).state, "idle");
});

test("system stats indicator exposes severity and stale or replay state", () => {
  const button = { dataset: {}, setAttribute(name, value) { this[name] = value; } };
  const context = loadFunctions(["systemStatsSeverity", "renderSystemStatsIndicator"], {
    systemStatsButton: button, receiverSystemSample: { cpu: 56, memory: 60, receivedAt: 1000 },
    receiverTxSample: { ports: new Map([[0x0200, { usage: 98 }]]), receivedAt: 1000 },
    replayData: null, Date: { now: () => 5001 },
  });
  context.renderSystemStatsIndicator();
  assert.equal(button.dataset.state, "critical");
  assert.match(button["aria-label"], /highest usage 98%.*stale telemetry/);
  context.replayData = new Uint8Array(1);
  context.renderSystemStatsIndicator();
  assert.match(button.title, /recorded telemetry/);
  assert.doesNotMatch(button.title, /stale/);
});

test("MON-SYS reports receiver CPU and memory with peaks and stale state", () => {
  let now = 10000;
  const context = loadFunctions(["parseMonSys", "renderReceiverLoad", "receiverMonitoringConfigurationRequests"], {
    receiverCpu: {}, receiverMemory: {}, receiverSystemSample: null,
    renderSystemStatsIndicator() {},
    receiver: { value: "x20" }, replayData: null, replayRebuilding: false, Date: { now: () => now },
  });
  context.renderReceiverLoad();
  assert.equal(context.receiverCpu.textContent, "CPU: --");
  const payload = new Uint8Array(24);
  payload.set([1, 0, 76, 98, 43, 61, 99, 100]);
  context.parseMonSys(payload);
  assert.equal(context.receiverCpu.textContent, "CPU: 76%");
  assert.equal(context.receiverMemory.textContent, "MEM: 43%");
  assert.match(context.receiverCpu.title, /peak since restart 98%/);
  assert.match(context.receiverMemory.title, /peak since restart 61%/);
  now += 4000;
  context.renderReceiverLoad();
  assert.equal(context.receiverCpu.textContent, "CPU: 76% (stale)");
  context.parseMonSys(new Uint8Array(23));
  payload[0] = 2;
  context.parseMonSys(payload);
  assert.equal(context.receiverSystemSample.receivedAt, 10000);
  context.replayData = new Uint8Array(1);
  context.renderReceiverLoad();
  assert.equal(context.receiverCpu.textContent, "CPU: 76%");
  assert.match(context.receiverCpu.title, /Recorded MON-SYS/);
  context.receiverSystemSample = null;
  context.receiver.value = "f9p";
  context.renderReceiverLoad();
  assert.match(context.receiverCpu.title, /not available on standard F9P/);
  assert.equal(context.receiverMemory.textContent, "MEM: --");
  assert.deepEqual(JSON.parse(JSON.stringify(context.receiverMonitoringConfigurationRequests("f9p"))), [["MON-COMMS UART1", 0x20910350, 1, 1]]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.receiverMonitoringConfigurationRequests("x20"))), [["MON-COMMS UART1", 0x20910350, 1, 1], ["MON-SYS UART1", 0x2091069e, 1, 1]]);
});

test("MON-COMMS displays only serial TX queues, handles short records and marks stale telemetry", () => {
  let now = 10000;
  const makeElement = () => ({ classes: new Set(), classList: { toggle(name, enabled) { if (enabled) this.owner.classes.add(name); else this.owner.classes.delete(name); } } });
  const uart1 = makeElement(); const uart2 = makeElement(); const usb = makeElement();
  const status = makeElement();
  status.textContent = "Receiving MON-SPAN: 3 RF blocks";
  let baseStatus = status.textContent;
  let warningMessage = "";
  for (const element of [uart1, uart2, usb]) element.classList.owner = element;
  status.classList.owner = status;
  const context = loadFunctions(["parseMonCommsTx", "renderReceiverTx", "replayFrameGroup"], {
    receiverTxPorts: [[0x0100, "UART1", uart1], [0x0200, "UART2", uart2], [0x0300, "USB", usb]],
    status,
    setReceiverTxWarning(message) { warningMessage = message; status.textContent = warningMessage || baseStatus; status.classList.toggle("status-tx-warning", Boolean(warningMessage)); },
    setStatus(message) { baseStatus = message; status.textContent = warningMessage || baseStatus; },
    receiverTxSample: null, replayData: null, replayRebuilding: false, Date: { now: () => now },
    renderSystemStatsIndicator() {},
  });
  context.renderReceiverTx();
  assert.equal(usb.textContent, "USB TX: --");
  assert.equal(status.textContent, "Receiving MON-SPAN: 3 RF blocks");
  const payload = new Uint8Array(8 + 5 * 40);
  payload[1] = 5;
  const data = new DataView(payload.buffer);
  for (let index = 0; index < 5; index++) {
    const offset = 8 + index * 40;
    data.setUint16(offset, index * 0x0100, true);
    data.setUint16(offset + 2, index * 100, true);
    data.setUint32(offset + 4, 123456, true);
    payload[offset + 8] = [99, 20, 98, 3, 99][index];
    payload[offset + 9] = 100;
    data.setUint16(offset + 18, 4, true);
    data.setUint32(offset + 36, 12, true);
  }
  context.parseMonCommsTx(payload);
  assert.equal(context.receiverTxSample.ports.size, 3);
  assert.equal(uart1.textContent, "UART1 TX: 20% (100 B)");
  assert.equal(uart2.textContent, "UART2 TX: 98% (200 B)");
  assert.equal(uart2.classes.has("status-tx-critical"), true);
  assert.equal(status.textContent, "UART2 TX 98% above 90%: increase baud rate in Settings");
  assert.match(uart2.title, /raise the UART baud rate in Settings/);
  assert.equal(usb.textContent, "USB TX: 3% (300 B)");
  assert.match(usb.title, /peak 100%.*total transmitted 123456 bytes.*RX overrun timeslots 4.*skipped bytes 12/);
  context.setStatus("Receiving MON-SPAN: 3 RF blocks");
  assert.match(status.textContent, /UART2 TX 98%/);
  assert.equal(status.classes.has("status-tx-warning"), true);
  now += 4000;
  context.renderReceiverTx();
  assert.match(status.textContent, /UART2 TX 98%.*MON-COMMS telemetry stale/);
  assert.equal(uart2.classes.has("status-tx-critical"), true);
  baseStatus = "Connected at 38 400; waiting for UBX data";
  data.setUint8(8 + 2 * 40 + 8, 95);
  context.parseMonCommsTx(payload);
  assert.equal(uart2.classes.has("status-tx-warning"), true);
  assert.equal(uart2.classes.has("status-tx-critical"), false);
  data.setUint8(8 + 2 * 40 + 8, 90);
  context.parseMonCommsTx(payload);
  assert.equal(uart2.classes.has("status-tx-normal"), true);
  assert.equal(uart2.classes.has("status-tx-warning"), false);
  now += 4000;
  context.renderReceiverTx();
  assert.match(usb.textContent, /\(stale\)/);
  assert.equal(status.textContent, "Connected at 38 400; waiting for UBX data");
  for (const invalid of [new Uint8Array(7), new Uint8Array(8), payload.subarray(0, payload.length - 1)]) context.parseMonCommsTx(invalid);
  payload[0] = 1;
  context.parseMonCommsTx(payload);
  assert.equal(context.receiverTxSample.receivedAt, 14000);
  context.replayData = payload;
  context.renderReceiverTx();
  assert.equal(usb.textContent, "USB TX: 3% (300 B)");
  assert.match(usb.title, /Recorded MON-COMMS/);
  const short = new Uint8Array(24);
  short[1] = 1;
  new DataView(short.buffer).setUint16(8, 0x0300, true);
  short[16] = 255;
  context.parseMonCommsTx(short);
  assert.equal(usb.textContent, "USB TX: n/a (0 B)");
  assert.doesNotMatch(usb.title, /overrun|skipped/);
  assert.equal(uart1.textContent, "UART1 TX: --");
  assert.equal(context.replayFrameGroup(0x0a, 0x36), "comms");
  context.receiverTxSample = null;
  context.renderReceiverTx();
  assert.equal(usb.textContent, "USB TX: --");
});

test("MON-COMMS detects current RX activity instead of historical RX/TX totals", () => {
  const context = loadFunctions(["parseMonCommsInterface"], { receiverInterface: { title: "" }, interfaceRxState: { counters: new Map(), name: null } });
  const payload = new Uint8Array(8 + 2 * 40);
  payload[0] = 0; payload[1] = 2;
  const data = new DataView(payload.buffer);
  data.setUint16(8, 0x0300, true);
  data.setUint32(12, 10000, true);
  data.setUint32(20, 100, true);
  data.setUint16(48, 0x0100, true);
  data.setUint32(52, 5000000, true);
  data.setUint32(60, 7000000, true);
  assert.equal(context.parseMonCommsInterface(payload), null);
  data.setUint32(20, 108, true);
  assert.equal(context.parseMonCommsInterface(payload), "USB");
  assert.match(context.receiverInterface.title, /USB: TX 10000, RX 108 \(\+8\)/);
  assert.equal(context.parseMonCommsInterface(payload), "USB");
  data.setUint32(20, 116, true);
  data.setUint32(60, 7000008, true);
  assert.equal(context.parseMonCommsInterface(payload), null);
  assert.match(context.receiverInterface.title, /Ambiguous RX activity/);
  data.setUint32(20, 124, true);
  assert.equal(context.parseMonCommsInterface(payload), "USB");
  data.setUint32(20, 0, true);
  data.setUint32(60, 0, true);
  assert.equal(context.parseMonCommsInterface(payload), null);
  assert.match(context.receiverInterface.title, /RX counters reset/);
  data.setUint32(20, 8, true);
  assert.equal(context.parseMonCommsInterface(payload), "USB");
  assert.equal(context.parseMonCommsInterface(new Uint8Array(8)), null);
  const truncated = new Uint8Array(8 + 2 * 15); truncated[1] = 2;
  assert.equal(context.parseMonCommsInterface(truncated), null);
  const malformed = new Uint8Array(8 + 2 * 40 + 1); malformed[1] = 2;
  assert.equal(context.parseMonCommsInterface(malformed), null);
});

test("MON-COMMS RX detection handles uint32 wraparound without choosing a new baseline", () => {
  const context = loadFunctions(["parseMonCommsInterface"], { receiverInterface: {}, interfaceRxState: { counters: new Map(), name: null } });
  const payload = new Uint8Array(48); payload[1] = 1;
  const data = new DataView(payload.buffer); data.setUint16(8, 0x0300, true);
  data.setUint32(20, 0xfffffffc, true);
  assert.equal(context.parseMonCommsInterface(payload), null);
  data.setUint32(20, 4, true);
  assert.equal(context.parseMonCommsInterface(payload), "USB");
  assert.match(context.receiverInterface.title, /RX 4 \(\+8\)/);
});

test("UBX dispatcher routes MON-COMMS responses to the pending interface poll", () => {
  const resolved = [];
  const context = loadFunctions(["handleUbx"], {
    pendingInterfacePoll: (name) => resolved.push(name),
    parseMonCommsTx() {},
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

test("MON-SYS is dispatched, indexed for replay and configured on the selected interfaces", () => {
  const received = [];
  const context = loadFunctions(["handleUbx", "replayFrameGroup", "indexReplayFrames", "checksum", "ubxFrame", "receiverMonitoringConfigurationRequests", "receiverInterfaceRequests"], {
    parseMonSys: (payload) => received.push(payload),
  });
  const payload = new Uint8Array(24);
  payload[0] = 1;
  context.handleUbx(0x0a, 0x39, payload);
  assert.deepEqual(received, [payload]);
  const frames = context.indexReplayFrames(context.ubxFrame(0x0a, 0x39, payload));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].group, "system");
  const requests = context.receiverInterfaceRequests(context.receiverMonitoringConfigurationRequests("x20"), true);
  assert.ok(requests.some(([name, key, rate, size]) => name === "MON-SYS USB" && key === 0x209106a0 && rate === 1 && size === 1));
  assert.ok(requests.some(([name, key]) => name === "MON-SYS UART1" && key === 0x2091069e));
  assert.ok(requests.some(([name, key]) => name === "MON-COMMS USB" && key === 0x20910352));
});

test("UBX dispatcher routes MON-VER responses", () => {
  const payload = new Uint8Array([1]);
  const received = [];
  const context = loadFunctions(["handleUbx"], { pendingInterfacePoll: null, parseMonVer: (value) => received.push(value) });
  context.handleUbx(0x0a, 0x04, payload);
  assert.deepEqual(received, [payload]);
});

test("GNSS integrity configuration is receiver-specific and follows settings", () => {
  const context = loadFunctions(["gnssFeatureConfigurationRequests"], {});
  const requests = (receiverName, enableOsnma, enableGalHas, strictOsnma) => JSON.parse(JSON.stringify(context.gnssFeatureConfigurationRequests(receiverName, enableOsnma, enableGalHas, strictOsnma)));
  assert.deepEqual(requests("x20", true, true), [
    ["Galileo OSNMA", 0x10350005, 1, 1],
    ["Galileo HAS", 0x100d0002, 1, 1],
    ["Authenticated navigation data only", 0x101100dd, 0, 1],
  ]);
  assert.deepEqual(requests("x20", false, false), [
    ["Galileo OSNMA", 0x10350005, 0, 1],
    ["Galileo HAS", 0x100d0002, 0, 1],
    ["Authenticated navigation data only", 0x101100dd, 0, 1],
  ]);
  assert.deepEqual(requests("x20", true, false, true), [
    ["Galileo OSNMA", 0x10350005, 1, 1],
    ["Galileo HAS", 0x100d0002, 0, 1],
    ["Authenticated navigation data only", 0x101100dd, 1, 1],
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
  assert.ok(allPorts.some(([name]) => name === "MON-SPAN UART2"));
  for (const configured of [uart1Only, allPorts]) {
    assert.ok(configured.some(([name, key, value]) => name === "I2C UBX output off" && key === 0x10720001 && value === 0));
    assert.ok(configured.some(([name, key, value]) => name === "SPI UBX output off" && key === 0x107a0001 && value === 0));
    assert.ok(!configured.some(([name, , value]) => /I2C|SPI/.test(name) && value !== 0));
    assert.ok(!configured.some(([name]) => /MON-SPAN (I2C|SPI)/.test(name)));
  }
});

test("satellite reports decode signed sky coordinates and usage without mixing entries", () => {
  const context = loadFunctions(["decodeSatelliteReport", "satelliteSkyPoint"], {});
  const bytes = new Uint8Array(52).subarray(4, 48); bytes[4] = 1; bytes[5] = 3;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  data.setUint32(0, 123000, true);
  for (const [index, elevation, azimuth, flags] of [[0, 45, 90, 8 | 4 | 16], [1, -5, 180, 3], [2, 91, -1, 0]]) {
    const offset = 8 + index * 12; bytes[offset] = 2; bytes[offset + 1] = index + 1; bytes[offset + 2] = 42;
    data.setInt8(offset + 3, elevation); data.setInt16(offset + 4, azimuth, true); data.setUint32(offset + 8, flags, true);
  }
  const report = context.decodeSatelliteReport(bytes);
  assert.equal(report.iTow, 123000);
  assert.equal(report.satellites.length, 3);
  assert.equal(report.satellites[0].used, true);
  assert.equal(report.satellites[0].quality, 4);
  assert.equal(report.satellites[0].health, 1);
  assert.equal(report.satellites[1].elevation, -5);
  assert.equal(report.satellites[2].elevation, null);
  assert.equal(context.satelliteSkyPoint(report.satellites[1], 100, 100, 90), null);
  assert.equal(context.satelliteSkyPoint(report.satellites[2], 100, 100, 90), null);
  const east = context.satelliteSkyPoint(report.satellites[0], 100, 100, 90);
  assert.equal(east.x, 145); assert.ok(Math.abs(east.y - 100) < 0.0001);
  const north = context.satelliteSkyPoint({ elevation: 0, azimuth: 0 }, 100, 100, 90);
  assert.equal(north.x, 100); assert.equal(north.y, 10);
  const zenith = context.satelliteSkyPoint({ elevation: 90, azimuth: 270 }, 100, 100, 90);
  assert.equal(zenith.x, 100); assert.equal(zenith.y, 100);
  assert.equal(context.decodeSatelliteReport(new Uint8Array(7)), null);
  bytes[4] = 2;
  assert.equal(context.decodeSatelliteReport(bytes), null);
});

test("NAV-SIG authentication is aggregated per satellite and preserves mixed signals", () => {
  const context = loadFunctions(["decodeSatelliteAuthReport", "satelliteAuthentication", "parseNavSig"], {
    satelliteAuthReports: { NAV: null, NAV2: null }, replayRebuilding: true,
  });
  const payload = new Uint8Array(72); payload[4] = 1; payload[5] = 4;
  const data = new DataView(payload.buffer); data.setUint32(0, 123000, true);
  for (const [index, svId, authenticated] of [[0, 12, true], [1, 12, false], [2, 24, true], [3, 36, false]]) {
    const offset = 8 + index * 16; payload[offset] = 2; payload[offset + 1] = svId;
    data.setUint16(offset + 10, authenticated ? 0x0200 : 0, true);
  }
  const report = context.decodeSatelliteAuthReport(payload);
  assert.deepEqual(Array.from(report.satellites, ({ svId, signalCount, authenticatedSignalCount }) => [svId, signalCount, authenticatedSignalCount]), [[12, 2, 1], [24, 1, 1], [36, 1, 0]]);
  assert.equal(context.satelliteAuthentication({ gnssId: 2, svId: 12 }, { iTow: 123000 }, report).label, "Mixed");
  assert.equal(context.satelliteAuthentication({ gnssId: 2, svId: 24 }, { iTow: 123000 }, report).label, "Authenticated");
  assert.equal(context.satelliteAuthentication({ gnssId: 2, svId: 36 }, { iTow: 123000 }, report).label, "Not authenticated");
  assert.equal(context.satelliteAuthentication({ gnssId: 2, svId: 24 }, { iTow: 123001 }, report).label, "Unknown");
  context.parseNavSig(payload, "NAV");
  const nav2Payload = payload.slice(); new DataView(nav2Payload.buffer).setUint32(0, 123001, true);
  context.parseNavSig(nav2Payload, "NAV2");
  assert.equal(context.satelliteAuthReports.NAV.iTow, 123000);
  assert.equal(context.satelliteAuthReports.NAV2.iTow, 123001);
  assert.equal(context.decodeSatelliteAuthReport(new Uint8Array(7)), null);
});

test("satellite correction flags distinguish used sources and types from availability", () => {
  const context = loadFunctions(["decodeSatelliteReport", "satelliteCorrectionText"], {});
  const bytes = new Uint8Array(20); bytes[4] = 1; bytes[5] = 1;
  const data = new DataView(bytes.buffer);
  const cases = [[16, "SBAS"], [17, "RTCM"], [18, "SLAS"], [19, "SPARTN"], [23, "CLAS"], [24, "LPP"], [25, "HAS"], [20, "Pseudorange"], [21, "Carrier range"], [22, "Doppler"]];
  for (const [bit, label] of cases) {
    data.setUint32(16, 1 << bit, true);
    const satellite = context.decodeSatelliteReport(bytes).satellites[0];
    assert.equal(satellite.correctionsUsed, true);
    assert.equal(context.satelliteCorrectionText(satellite), label);
    assert.equal(satellite.used, false);
  }
  data.setUint32(16, (1 << 25) | (1 << 20) | (1 << 21) | 8, true);
  const corrected = context.decodeSatelliteReport(bytes).satellites[0];
  assert.equal(context.satelliteCorrectionText(corrected), "HAS, Pseudorange, Carrier range");
  assert.equal(corrected.used, true);
  for (const flags of [0, 0x40, 0x80000000, 0x8000, 0x80, 8]) {
    data.setUint32(16, flags, true);
    const satellite = context.decodeSatelliteReport(bytes).satellites[0];
    assert.equal(satellite.correctionsUsed, false);
    assert.equal(context.satelliteCorrectionText(satellite), flags === 0x40 ? "None used; differential corrections available" : "None used");
  }
});

test("sky labels avoid elevation captions and omit below-horizon markers", () => {
  const labels = [];
  const drawing = new Proxy({ fillText(text, x, y) { labels.push({ text, x, y }); }, measureText: () => ({ width: 14 }) }, {
    get(target, property) { return target[property] ?? (() => {}); },
  });
  const context = loadFunctions(["drawSatelliteSky", "satelliteSkyPoint", "satellitePrn", "satelliteGnssIdFromPrn", "gnssColor"], {
    satelliteSky: { getContext: () => drawing }, sizeCanvas: () => ({ width: 600, height: 600 }), window: { devicePixelRatio: 1 }, satelliteSkyPoints: [], satelliteSelectedKey: null,
  });
  context.drawSatelliteSky([
    { gnssId: 0, svId: 1, elevation: 10, azimuth: 0, used: true },
    { gnssId: 2, svId: 2, elevation: -5, azimuth: 90, used: false },
  ]);
  assert.equal(context.satelliteSkyPoints.length, 1);
  assert.ok(labels.find((label) => label.text === "G1").x < 300);
  for (const cardinal of ["N", "E", "S", "W"]) assert.ok(labels.some((label) => label.text === cardinal));
  assert.ok(!labels.some((label) => label.text === "E2"));
});

test("sky uses square corrected markers independently of solution use", () => {
  const markers = [];
  const drawing = new Proxy({ rect() { markers.push("square"); }, arc(centerX, centerY, radius) { if (radius === 5) markers.push("circle"); }, measureText: () => ({ width: 14 }) }, {
    get(target, property) { return target[property] ?? (() => {}); },
  });
  const context = loadFunctions(["drawSatelliteSky", "satelliteSkyPoint", "satellitePrn", "satelliteGnssIdFromPrn", "gnssColor"], {
    satelliteSky: { getContext: () => drawing }, sizeCanvas: () => ({ width: 600, height: 600 }), window: { devicePixelRatio: 1 }, satelliteSkyPoints: [], satelliteSelectedKey: null,
  });
  context.drawSatelliteSky([
    { gnssId: 0, svId: 1, elevation: 45, azimuth: 0, used: true, correctionsUsed: false },
    { gnssId: 2, svId: 2, elevation: 45, azimuth: 90, used: true, correctionsUsed: true },
    { gnssId: 2, svId: 3, elevation: 45, azimuth: 180, used: false, correctionsUsed: true },
  ]);
  assert.deepEqual(markers, ["circle", "square", "square", "square", "square"]);
});

test("online TLE sky markers use distinct, enlarged crosshairs and PRN-matched connector lines", () => {
  const commands = [];
  const drawing = new Proxy({
    beginPath() { commands.push(["beginPath"]); },
    moveTo(x, y) { commands.push(["moveTo", x, y]); },
    lineTo(x, y) { commands.push(["lineTo", x, y]); },
    arc(x, y, radius) { commands.push(["arc", x, y, radius]); },
    stroke() { commands.push(["stroke", this.strokeStyle]); },
    measureText: () => ({ width: 14 }),
  }, {
    get(target, property) { return target[property] ?? (() => {}); },
  });
  const context = loadFunctions(["drawSatelliteSky", "satelliteSkyPoint", "satellitePrn", "satelliteGnssIdFromPrn", "gnssColor"], {
    satelliteSky: { getContext: () => drawing }, sizeCanvas: () => ({ width: 600, height: 600 }), window: { devicePixelRatio: 1 }, satelliteSkyPoints: [],
    satelliteSelectedKey: null,
    gnssColor(gnssId) { return ["#ffb347", "#00ffff", "#66ff88", "#ff7262", "#ffffff", "#ffff66", "#f27bfd", "#88aaff"][gnssId] || "#aaaaaa"; },
  });
  context.drawSatelliteSky([
    { gnssId: 0, svId: 5, elevation: 45, azimuth: 0, used: true },
    { gnssId: 2, svId: 12, elevation: 45, azimuth: 180, used: true },
  ], [
    { PRN: "G05", AZIMUTH: 90, ELEVATION: 45 },
    { PRN: "E13", AZIMUTH: 270, ELEVATION: 45 },
  ]);
  assert.equal(context.satelliteSkyPoints.filter(({ kind }) => kind === "orbit").length, 2);
  assert.equal(commands.filter(([command, color]) => command === "stroke" && color === "#ffb347").length, 3);
  assert.equal(commands.filter(([command, color]) => command === "stroke" && color === "#66ff88").length, 2);
  const predictedPoint = context.satelliteSkyPoints.find(({ kind }) => kind === "orbit");
  const crosshairMoves = commands.filter(([command, x]) => command === "moveTo" && (x === predictedPoint.x - 14 || x === predictedPoint.x + 7));
  assert.equal(crosshairMoves.length, 2);
  const firstCrosshairIndex = commands.findIndex(([command, x]) => command === "moveTo" && x === predictedPoint.x - 14);
  const firstLiveBorderIndex = commands.findIndex(([command, color]) => command === "stroke" && color === "#090c12");
  assert.ok(firstCrosshairIndex < firstLiveBorderIndex);
  assert.ok(commands.some(([command, , , radius]) => command === "arc" && radius === 6));
  assert.ok(!commands.some(([command, , , radius]) => command === "arc" && radius === 7));
  context.satelliteSelectedKey = "0:5";
  context.drawSatelliteSky([{ gnssId: 0, svId: 5, elevation: 45, azimuth: 0, used: true }]);
  assert.ok(commands.some(([command, , , radius]) => command === "arc" && radius === 9));
});

test("overlapping live and TLE sky points share one hover tooltip", () => {
  const context = loadFunctions(["satelliteSkyPointTooltip", "satelliteGnssName", "satelliteCorrectionText"], {});
  const tooltip = context.satelliteSkyPointTooltip([
    { kind: "receiver", satellite: { gnssId: 2, svId: 12, cno: 42, elevation: 45, azimuth: 90, used: true, correctionSources: ["HAS"], correctionTypes: ["Pseudorange"] } },
    { kind: "orbit", prediction: { PRN: "E12", ELEVATION: 46.5, AZIMUTH: 92.5 } },
  ]);
  assert.match(tooltip, /Live: Galileo 12, 42 dB-Hz.*corrections: HAS, Pseudorange/);
  assert.match(tooltip, /\nTLE: E12, elevation 46\.5°, azimuth 92\.5°/);
});

test("sky-map hit testing selects a live satellite and maps a TLE marker to its matching live satellite", () => {
  const satellite = { gnssId: 2, svId: 12 };
  const points = [
    { kind: "orbit", x: 100, y: 100, prediction: { PRN: "E12" } },
    { kind: "receiver", x: 101, y: 100, satellite },
    { kind: "receiver", x: 200, y: 200, satellite: { gnssId: 0, svId: 5 } },
  ];
  const context = loadFunctions(["satelliteSkyHitKey", "satellitePrn"], {});
  assert.equal(context.satelliteSkyHitKey(points, 100, 100, 14), "2:12");
  assert.equal(context.satelliteSkyHitKey(points, 200, 200, 14), "0:5");
  assert.equal(context.satelliteSkyHitKey(points, 300, 300, 14), null);
  assert.equal(context.satelliteSkyHitKey([{ kind: "orbit", x: 100, y: 100, prediction: { PRN: "E13" } }], 100, 100, 14), null);
});

test("clicking the selected satellite toggles its sky-view highlight off", () => {
  const context = loadFunctions(["toggleSatelliteSelection"], { satelliteSelectedKey: null });
  context.toggleSatelliteSelection("2:12");
  assert.equal(context.satelliteSelectedKey, "2:12");
  context.toggleSatelliteSelection("2:12");
  assert.equal(context.satelliteSelectedKey, null);
  context.toggleSatelliteSelection("2:12");
  context.toggleSatelliteSelection("0:5");
  assert.equal(context.satelliteSelectedKey, "0:5");
});

test("satellite pointer selection ignores scroll drags and stale or different rows", () => {
  const context = loadFunctions(["satellitePointerClickMatches"], {});
  const pointer = { key: "2:12", pointerId: 1, x: 100, y: 120 };
  const event = { isPrimary: true, pointerId: 1, clientX: 102, clientY: 121 };
  assert.equal(context.satellitePointerClickMatches(pointer, event, "2:12"), true);
  assert.equal(context.satellitePointerClickMatches(pointer, event, "0:5"), false);
  assert.equal(context.satellitePointerClickMatches(pointer, { ...event, clientY: 130 }, "2:12"), false);
  assert.equal(context.satellitePointerClickMatches(pointer, { ...event, pointerId: 2 }, "2:12"), false);
});

test("online sky-map constellation filters select matching predictions or hide all predictions", () => {
  const context = loadFunctions(["satelliteGnssIdFromPrn", "satellitePrn", "selectedSatellitePredictions"], {});
  const predictions = ["G05", "S20", "E12", "C03", "J02", "R08", "I01"].map((PRN) => ({ PRN }));
  const selected = context.selectedSatellitePredictions(predictions, new Set([0, 2, 6]));
  assert.deepEqual(Array.from(selected, ({ PRN }) => PRN), ["G05", "E12", "R08"]);
  assert.deepEqual(Array.from(context.selectedSatellitePredictions(predictions, new Set([0, 2, 6]), false)), []);
  assert.equal(context.satelliteGnssIdFromPrn("X01"), null);
});

test("used-only satellite filter hides predictions without a used live PRN match", () => {
  const context = loadFunctions(["satelliteGnssIdFromPrn", "satellitePrn", "selectedSatellitePredictions"], {});
  const predictions = [{ PRN: "G05" }, { PRN: "G06" }, { PRN: "E12" }, { PRN: "R08" }];
  const usedSatellites = [
    { gnssId: 0, svId: 5, used: true },
    { gnssId: 2, svId: 12, used: true },
  ];
  assert.deepEqual(
    Array.from(context.selectedSatellitePredictions(predictions, new Set([0, 2, 6]), true, usedSatellites), ({ PRN }) => PRN),
    ["G05", "E12"],
  );
  assert.deepEqual(
    Array.from(context.selectedSatellitePredictions(predictions, new Set([0, 2, 6])), ({ PRN }) => PRN),
    ["G05", "G06", "E12", "R08"],
  );
  assert.deepEqual(Array.from(context.selectedSatellitePredictions(predictions, new Set([0, 2, 6]), true, [])), []);
});

test("satellite filters and numeric sorting keep unknown positions last", () => {
  const context = loadFunctions(["selectedSatellites"], {});
  const report = { satellites: [
    { gnssId: 2, svId: 10, elevation: null, cno: 40 },
    { gnssId: 0, svId: 3, elevation: 15, cno: 20 },
    { gnssId: 2, svId: 2, elevation: 60, cno: 45 },
  ] };
  const all = new Set([0, 2]);
  assert.deepEqual(Array.from(context.selectedSatellites(report, all, { key: "id", direction: 1 }), (satellite) => satellite.svId), [3, 2, 10]);
  assert.deepEqual(Array.from(context.selectedSatellites(report, all, { key: "elevation", direction: -1 }), (satellite) => satellite.svId), [2, 3, 10]);
  assert.deepEqual(Array.from(context.selectedSatellites(report, all, { key: "elevation", direction: 1 }), (satellite) => satellite.svId), [3, 2, 10]);
  assert.equal(context.selectedSatellites(report, new Set([2]), { key: "cno", direction: -1 })[0].svId, 2);
  assert.equal(context.selectedSatellites(report, new Set(), { key: "id", direction: 1 }).length, 0);
  assert.equal(report.satellites[0].svId, 10);
  report.satellites[1].used = true;
  assert.deepEqual(Array.from(context.selectedSatellites(report, all, { key: "id", direction: 1 }, true), (satellite) => satellite.svId), [3]);
  assert.equal(context.selectedSatellites(report, new Set([2]), { key: "id", direction: 1 }, true).length, 0);
  assert.equal(context.selectedSatellites(report, all, { key: "id", direction: 1 }, false).length, 3);
});

test("satellite correction sorting follows displayed text in both directions with stable identity ties", () => {
  const context = loadFunctions(["selectedSatellites", "satelliteCorrectionText"], {});
  const report = { satellites: [
    { gnssId: 2, svId: 9, correctionSources: ["RTCM"], correctionTypes: ["Pseudorange"], used: true },
    { gnssId: 0, svId: 4 },
    { gnssId: 2, svId: 3, correctionSources: ["HAS"], correctionTypes: ["Pseudorange"], used: true },
    { gnssId: 0, svId: 2, correctionSources: ["HAS"], correctionTypes: ["Pseudorange"], used: true },
    { gnssId: 0, svId: 5, diffCorr: true },
  ] };
  const all = new Set([0, 2]);
  const ids = (direction, constellations = all, usedOnly = false) => Array.from(context.selectedSatellites(report, constellations, { key: "corrections", direction }, usedOnly), (satellite) => satellite.svId);
  assert.deepEqual(ids(1), [2, 3, 4, 5, 9]);
  assert.deepEqual(ids(-1), [9, 5, 4, 2, 3]);
  assert.deepEqual(ids(1, new Set([2])), [3, 9]);
  assert.deepEqual(ids(1, all, true), [2, 3, 9]);
  assert.deepEqual(report.satellites.map((satellite) => satellite.svId), [9, 4, 3, 2, 5]);
});

test("satellite authentication sorting follows authentication state and keeps unknown values last", () => {
  const context = loadFunctions(["selectedSatellites", "satelliteAuthentication"], {});
  const report = { iTow: 123000, satellites: [
    { gnssId: 2, svId: 4 },
    { gnssId: 2, svId: 3 },
    { gnssId: 2, svId: 2 },
    { gnssId: 2, svId: 1 },
  ] };
  const authReport = { iTow: 123000, satellites: [
    { gnssId: 2, svId: 1, authenticatedSignalCount: 1, signalCount: 1 },
    { gnssId: 2, svId: 2, authenticatedSignalCount: 0, signalCount: 1 },
    { gnssId: 2, svId: 3, authenticatedSignalCount: 1, signalCount: 2 },
  ] };
  const ids = (direction) => Array.from(
    context.selectedSatellites(report, new Set([2]), { key: "authentication", direction }, false, authReport),
    (satellite) => satellite.svId,
  );
  assert.deepEqual(ids(1), [1, 3, 2, 4]);
  assert.deepEqual(ids(-1), [2, 3, 1, 4]);
});

test("satellite PRNs map to GNSS Sky Map prefixes and azimuth deltas wrap at north", () => {
  const context = loadFunctions(["satellitePrn", "satelliteAzimuthDifference"], {});
  assert.equal(context.satellitePrn({ gnssId: 0, svId: 5 }), "G05");
  assert.equal(context.satellitePrn({ gnssId: 2, svId: 12 }), "E12");
  assert.equal(context.satellitePrn({ gnssId: 7, svId: 3 }), "I03");
  assert.equal(context.satellitePrn({ gnssId: 4, svId: 1 }), null);
  assert.equal(context.satelliteAzimuthDifference(1, 359), 2);
  assert.equal(context.satelliteAzimuthDifference(359, 1), -2);
});

test("sky-map location lock supports fresh receiver snapshots and independent manual coordinates", () => {
  const context = loadFunctions(["validSatelliteLocation", "satelliteObserverLocation"], {
    settings: { satelliteLocationLocked: false, satelliteLocationMode: "receiver", satelliteLockedLatitude: null, satelliteLockedLongitude: null },
    satelliteLocationLatitude: { value: "64.1" },
    satelliteLocationLongitude: { value: "-21.9" },
    positionComparisonState: { latest: { NAV: { positionValid: true, latitude: 52.52, longitude: 13.405, receivedAt: 1000 } } },
  });
  assert.deepEqual({ ...context.satelliteObserverLocation("NAV", 2000) }, { latitude: 52.52, longitude: 13.405, mode: "receiver-live" });
  context.settings.satelliteLocationLocked = true;
  assert.deepEqual({ ...context.satelliteObserverLocation("NAV", 2000) }, { error: "No NAV-PVT location is saved. Wait for a valid receiver fix, then enable the lock." });
  context.settings.satelliteLockedLatitude = 52.52;
  context.settings.satelliteLockedLongitude = 13.405;
  assert.deepEqual({ ...context.satelliteObserverLocation("NAV", 9000) }, { latitude: 52.52, longitude: 13.405, mode: "receiver-locked" });
  context.settings.satelliteLocationMode = "manual";
  assert.deepEqual({ ...context.satelliteObserverLocation("NAV", 9000) }, { latitude: 64.1, longitude: -21.9, mode: "manual" });
  context.satelliteLocationLatitude.value = "";
  assert.match(context.satelliteObserverLocation("NAV", 9000).error, /Enter a valid latitude/);
  assert.equal(context.validSatelliteLocation(90, 180), true);
  assert.equal(context.validSatelliteLocation(90.1, 0), false);
});

test("live receiver movement keeps nearby TLE positions visible until the refresh threshold", () => {
  const context = loadFunctions(["satelliteLocationDistanceMetres", "matchingSatellitePredictions"], {
    satelliteOrbitState: {
      source: "NAV", resultLocation: { latitude: 52.52, longitude: 13.405, mode: "receiver-live" },
      positions: [{ PRN: "G05", AZIMUTH: 20, ELEVATION: 30 }],
    },
  });
  const nearby = { latitude: 52.524, longitude: 13.405, mode: "receiver-live" };
  const movedFar = { latitude: 52.54, longitude: 13.405, mode: "receiver-live" };
  assert.ok(context.satelliteLocationDistanceMetres(context.satelliteOrbitState.resultLocation, nearby) < 1000);
  assert.equal(context.matchingSatellitePredictions("NAV", nearby).length, 1);
  assert.equal(context.matchingSatellitePredictions("NAV", movedFar).length, 0);
  assert.equal(context.matchingSatellitePredictions("NAV2", nearby).length, 0);
  assert.equal(context.matchingSatellitePredictions("NAV", { ...nearby, mode: "manual" }).length, 0);
});

test("online orbit predictions use the selected valid position and filter malformed results", async () => {
  const requests = [];
  let renders = 0;
  const context = loadFunctions(["restoreSatelliteManualFeeds", "requestSatelliteOrbitPredictions"], {
    SATELLITE_TLE_UPLOAD_CACHE_KEY: "tle-cache", SATELLITE_METADATA_UPLOAD_CACHE_KEY: "metadata-cache",
    satelliteManualFeeds: { loaded: false, tleText: null, tleName: null, tleSavedAt: null, metadataText: null, metadataName: null, metadataSavedAt: null, storageErrors: { tle: null, metadata: null } },
    localStorage: { getItem: () => null },
    satelliteObserverLocation: () => ({ latitude: 64.1, longitude: -21.9, mode: "manual" }),
    window: { GNSSSatelliteAPI: { calculate: async (request) => {
      requests.push(request);
      return [
        { PRN: "G05", AZIMUTH: 20, ELEVATION: 30 },
        { PRN: "bad", AZIMUTH: 10, ELEVATION: 20 },
        { PRN: "E12", AZIMUTH: NaN, ELEVATION: 40 },
      ];
    } } },
    positionComparisonState: { latest: { NAV: { positionValid: true, latitude: 52.52, longitude: 13.405, receivedAt: 1000 } } },
    satelliteOrbitState: { source: null, positions: [], location: null, updatedAt: 0, attemptedAt: 0, loading: false, error: null, requestId: 0 },
    satellitePredictionStatus: { textContent: "" }, satellitePredictionRefresh: { textContent: "" },
    renderSatellites() { renders += 1; },
  });
  const beforeRequest = Date.now();
  await context.requestSatelliteOrbitPredictions("NAV", 1000);
  const afterRequest = Date.now();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].LAT, 64.1);
  assert.equal(requests[0].LON, -21.9);
  assert.equal(typeof requests[0]["UTC-TIME"].getTime, "function");
  assert.ok(requests[0]["UTC-TIME"].getTime() >= beforeRequest);
  assert.ok(requests[0]["UTC-TIME"].getTime() <= afterRequest);
  assert.notEqual(requests[0]["UTC-TIME"].getTime(), 1000);
  assert.deepEqual(Array.from(context.satelliteOrbitState.positions, ({ PRN }) => PRN), ["G05"]);
  assert.equal(context.satelliteOrbitState.loading, false);
  assert.equal(renders, 1);
});

test("uploaded GNSS-Radar PRN maps parse NORAD mappings and normalize QZSS labels", () => {
  const context = loadFunctions(["parseUploadedPrnMap"], {});
  const mapping = 'const PRNMAP = {"12345":"E12","23456":"Q193","34567":"G05"};';
  const parsed = context.parseUploadedPrnMap(mapping);
  assert.equal(parsed.get(12345), "E12");
  assert.equal(parsed.get(23456), "J01");
  assert.equal(parsed.get(34567), "G05");
  assert.throws(() => context.parseUploadedPrnMap("not a PRN map"), /does not contain a GNSS-Radar PRNMAP/);
  assert.throws(() => context.parseUploadedPrnMap('const PRNMAP = {"12345":"unknown"};'), /Invalid PRN mapping/);
});

test("uploaded TLE imports calculate predictions and persist source files for later sessions", async () => {
  const storage = new Map();
  const library = {
    twoline2satrec: (line1, line2) => ({ line1, line2 }),
    degreesToRadians: (degrees) => degrees * Math.PI / 180,
    radiansToDegrees: (radians) => radians * 180 / Math.PI,
    propagate: () => ({ position: { x: 1 } }),
    gstime: () => 0,
    eciToEcf: (position) => position,
    ecfToLookAngles: () => ({ azimuth: Math.PI / 2, elevation: Math.PI / 6 }),
  };
  const context = loadFunctions([
    "restoreSatelliteManualFeeds", "saveSatelliteManualFeed", "parseUploadedPrnMap",
    "parseUploadedSatelliteTle", "calculateUploadedSatellitePredictions", "importSatelliteFeedFiles",
  ], {
    SATELLITE_TLE_UPLOAD_CACHE_KEY: "tle-cache",
    SATELLITE_METADATA_UPLOAD_CACHE_KEY: "metadata-cache",
    satelliteManualFeeds: { loaded: false, tleText: null, tleName: null, tleSavedAt: null, metadataText: null, metadataName: null, metadataSavedAt: null, storageErrors: { tle: null, metadata: null } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { satellite: library },
  });
  const tle = ["TEST SAT (G 05)", "1 12345U 20001A   26001.00000000  .00000000  00000-0  00000-0 0  9999", "2 12345  55.0000  10.0000 0001000  20.0000  30.0000 15.00000000123456"].join("\n");
  const metadata = 'const PRNMAP = {"12345":"E12"};';
  const imported = await context.importSatelliteFeedFiles([
    { name: "gnss.tle", text: async () => tle },
    { name: "prnmap.js", text: async () => metadata },
  ]);
  assert.equal(imported.persistent, true);
  assert.equal(imported.ready, true);
  assert.equal(imported.tleName, "gnss.tle");
  assert.equal(imported.metadataName, "prnmap.js");
  const records = context.parseUploadedSatelliteTle(tle, metadata);
  assert.equal(records[0].PRN, "E12");
  const calculated = context.calculateUploadedSatellitePredictions(records, 64.1, -21.9, new Date("2026-01-01T00:00:00Z"));
  assert.equal(calculated[0].PRN, "E12");
  assert.equal(calculated[0].AZIMUTH, 90);
  assert.ok(Math.abs(calculated[0].ELEVATION - 30) < 1e-10);
  const reloaded = loadFunctions(["restoreSatelliteManualFeeds"], {
    SATELLITE_TLE_UPLOAD_CACHE_KEY: "tle-cache",
    SATELLITE_METADATA_UPLOAD_CACHE_KEY: "metadata-cache",
    satelliteManualFeeds: { loaded: false, tleText: null, tleName: null, tleSavedAt: null, metadataText: null, metadataName: null, metadataSavedAt: null, storageErrors: { tle: null, metadata: null } },
    localStorage: { getItem: (key) => storage.get(key) ?? null },
  });
  reloaded.restoreSatelliteManualFeeds();
  assert.equal(reloaded.satelliteManualFeeds.tleText, tle);
  assert.equal(reloaded.satelliteManualFeeds.metadataText, metadata);
});

test("prediction status explains that imported PRN mapping requires an imported TLE", () => {
  const context = loadFunctions(["renderSatellitePredictionComparison"], {
    window: { GNSSSatelliteAPI: { calculate() {}, getStatus: () => ({ cache: {}, errors: { metadata: { message: "Failed to fetch" } } }) } },
    restoreSatelliteManualFeeds() {},
    satelliteManualFeeds: { metadataText: 'const PRNMAP = {"12345":"E12"};', tleText: null },
    satelliteOrbitState: { loading: false, source: "NAV", error: null, updatedAt: 1000, manual: false },
    satellitePredictionStatus: { textContent: "", title: "" },
    satelliteComparisonRows: { innerHTML: "" },
  });
  context.renderSatellitePredictionComparison([], null, [], "NAV", { latitude: 0, longitude: 0, mode: "manual" }, 2000);
  assert.match(context.satellitePredictionStatus.textContent, /imported mapping is saved, but import a TLE file to use it/);
});

test("online satellite comparison colors constellation names like the live satellite table", () => {
  const context = loadFunctions([
    "renderSatellitePredictionComparison", "satellitePrn", "satelliteGnssName", "satelliteAzimuthDifference", "gnssColor",
  ], {
    window: { GNSSSatelliteAPI: { calculate() {}, getStatus: () => ({ cache: {}, errors: {} }) } },
    restoreSatelliteManualFeeds() {},
    satelliteManualFeeds: { tleName: null, metadataName: null, tleSavedAt: null, storageErrors: {} },
    satelliteOrbitState: { loading: false, source: "NAV", error: null, updatedAt: 1000, manual: false },
    satellitePredictionStatus: { textContent: "", title: "" },
    satelliteComparisonRows: { innerHTML: "" },
    gnssColor: (gnssId) => ["#ffb347", "#00ffff", "#66ff88"][gnssId],
  });
  context.renderSatellitePredictionComparison(
    [{ gnssId: 2, svId: 12, azimuth: 90, elevation: 45 }],
    { satellites: [] },
    [{ PRN: "E12", AZIMUTH: 92, ELEVATION: 44 }],
    "NAV",
    { latitude: 64.1, longitude: -21.9, mode: "manual" },
    2000,
  );
  assert.match(context.satelliteComparisonRows.innerHTML, /style="color:#66ff88">Galileo 12/);
});

test("satellite C/N0 history accepts only NAV-SAT while preserving NAV2 reports", () => {
  const context = loadFunctions(["parseNavSat", "decodeSatelliteReport", "parseHasCorrectionCounts", "appendSeries", "appendHistory", "signalSampleEpoch"], {
    satelliteReports: { NAV: null, NAV2: null }, hasCorrectionReports: { NAV: null, NAV2: null },
    signalEpoch: { latest: null, tow: null }, signalHistory: { cno: new Map() }, replayRebuilding: false, HISTORY_LENGTH: 600,
    signalsEmpty: {}, renderSatellites() {}, renderHasDiagnostics() {}, drawSignals() {}, gnssColor() {},
  });
  const payload = new Uint8Array(20); payload[4] = 1; payload[5] = 1; payload[8] = 2; payload[9] = 12; payload[10] = 42;
  new DataView(payload.buffer).setUint32(16, 1 << 25, true);
  context.parseNavSat(payload, "NAV");
  payload[10] = 35;
  context.parseNavSat(payload, "NAV2");
  assert.equal(context.signalEpoch.latest, 1);
  assert.equal(context.signalHistory.cno.size, 1);
  assert.equal(context.signalHistory.cno.get("2:12").values.length, 1);
  assert.equal(context.signalHistory.cno.get("2:12").values[0].value, 42);
  assert.equal(context.satelliteReports.NAV2.satellites[0].cno, 35);
  assert.equal(context.hasCorrectionReports.NAV2.galileo, 1);
  payload[10] = 43;
  new DataView(payload.buffer).setUint32(0, 1000, true);
  context.parseNavSat(payload, "NAV");
  assert.equal(context.signalEpoch.latest, 2);
  assert.equal(context.signalHistory.cno.get("2:12").values[1].value, 43);
  payload[4] = 2;
  context.parseNavSat(payload, "NAV");
  assert.equal(context.signalEpoch.latest, 2);
  assert.match(source, /function parseNavSig\(/);
});

test("NAV-SAT snapshots remain separate for each solution and empty reports clear old satellites", () => {
  const context = loadFunctions(["parseNavSat", "decodeSatelliteReport", "parseHasCorrectionCounts", "resetSatelliteReports", "signalSampleEpoch"], {
    satelliteReports: { NAV: null, NAV2: null }, satelliteAuthReports: { NAV: null, NAV2: null }, hasCorrectionReports: { NAV: null, NAV2: null },
    satelliteOrbitState: { requestId: 0, source: null, positions: [], location: null, updatedAt: 0, attemptedAt: 0, loading: false, error: null },
    signalEpoch: { latest: null, tow: null }, signalHistory: { cno: new Map() }, replayRebuilding: false,
    signalsEmpty: {}, renderSatellites() {}, renderHasDiagnostics() {}, drawSignals() {}, appendSeries() {}, gnssColor() {},
  });
  const payload = new Uint8Array(20); payload[4] = 1; payload[5] = 1; payload[8] = 2; payload[9] = 12;
  context.parseNavSat(payload, "NAV");
  payload[9] = 24;
  context.parseNavSat(payload, "NAV2");
  assert.equal(context.satelliteReports.NAV.satellites[0].svId, 12);
  assert.equal(context.satelliteReports.NAV2.satellites[0].svId, 24);
  const empty = new Uint8Array(8); empty[4] = 1;
  context.parseNavSat(empty, "NAV");
  assert.equal(context.satelliteReports.NAV.satellites.length, 0);
  assert.equal(context.satelliteReports.NAV2.satellites.length, 1);
  context.resetSatelliteReports();
  assert.equal(context.satelliteReports.NAV, null);
  assert.equal(context.satelliteReports.NAV2, null);
  assert.equal(context.satelliteAuthReports.NAV, null);
  assert.equal(context.satelliteAuthReports.NAV2, null);
});

test("satellites view marks stale data and preserves recorded source selection", () => {
  const option = {};
  const source = { value: "NAV", querySelector: () => option };
  const context = loadFunctions(["renderSatellites", "matchingSatellitePredictions", "selectedSatellitePredictions", "satelliteGnssIdFromPrn", "satellitePrn", "selectedSatellites", "satelliteGnssName", "satelliteCorrectionText", "satelliteAuthentication", "validSatelliteLocation", "satelliteObserverLocation"], {
    satelliteSource: source, satellitesPanel: { hidden: false }, receiver: { value: "x20" },
    satelliteUsedOnly: { checked: false }, satelliteOnlineVisible: { checked: true },
    satelliteReports: { NAV: { iTow: 1000, receivedAt: 1000, satellites: [{ gnssId: 2, svId: 12, cno: 42, elevation: 45, azimuth: 90, used: true, quality: 4, health: 1 }] }, NAV2: null },
    satelliteAuthReports: { NAV: { iTow: 1000, satellites: [{ gnssId: 2, svId: 12, signalCount: 2, authenticatedSignalCount: 1 }] }, NAV2: null },
    satelliteConstellations: new Set([2]), satelliteSort: { key: "id", direction: 1 },
    positionComparisonState: { latest: { NAV: null, NAV2: null } },
    satelliteOrbitState: { source: null, positions: [], resultLocation: null },
    settings: { satelliteLocationLocked: false, satelliteLocationMode: "receiver" },
    satelliteLocationLatitude: { value: "" }, satelliteLocationLongitude: { value: "" },
    satelliteStatus: { dataset: {} }, satelliteCount: {}, satelliteRows: {}, satelliteTable: { querySelectorAll: () => [] },
    satellitePredictionStatus: {}, satelliteComparisonRows: {}, satelliteCorrectionPopup: { hidden: true },
    satelliteCorrectionPopupKey: null, satelliteSelectedKey: null,
    replayData: null, gnssColor: () => "#66ff88", drawSatelliteSky() {}, renderSatellitePredictionComparison() {}, requestSatelliteOrbitPredictions() {},
  });
  context.renderSatellites(1000);
  assert.match(context.satelliteRows.innerHTML, /Galileo 12.*42.*Used.*Healthy/);
  assert.match(context.satelliteRows.innerHTML, /None used/);
  assert.match(context.satelliteRows.innerHTML, /Mixed/);
  assert.match(context.satelliteRows.innerHTML, /1 of 2 signals authenticated/);
  context.satelliteReports.NAV.satellites[0].correctionsUsed = true;
  context.satelliteReports.NAV.satellites[0].correctionSources = ["HAS"];
  context.satelliteReports.NAV.satellites[0].correctionTypes = ["Pseudorange"];
  context.renderSatellites(1000);
  assert.match(context.satelliteRows.innerHTML, />YES<\/button>/);
  assert.match(context.satelliteRows.innerHTML, /--signal-strength:70%/);
  context.satelliteSelectedKey = "2:12";
  context.renderSatellites(1000);
  assert.match(context.satelliteRows.innerHTML, /aria-selected="true"/);
  assert.match(context.satelliteCount.textContent, /1 shown.*1 reported.*1 used/);
  context.satelliteReports.NAV.satellites.push({ gnssId: 2, svId: 24, cno: 30, elevation: 20, azimuth: 180, used: false, quality: 4, health: 1 });
  context.satelliteUsedOnly.checked = true;
  context.renderSatellites(1000);
  assert.match(context.satelliteCount.textContent, /1 shown.*2 reported.*1 used/);
  assert.doesNotMatch(context.satelliteRows.innerHTML, /Galileo 24/);
  context.satelliteUsedOnly.checked = false;
  context.renderSatellites(1000);
  assert.match(context.satelliteRows.innerHTML, /Galileo 24/);
  context.renderSatellites(7000);
  assert.equal(context.satelliteStatus.dataset.state, "stale");
  context.replayData = new Uint8Array(1);
  context.renderSatellites(7000);
  assert.equal(context.satelliteStatus.dataset.state, "current");
  assert.match(context.satelliteStatus.textContent, /recorded/);
  source.value = "NAV2";
  context.renderSatellites(7000);
  assert.match(context.satelliteStatus.textContent, /Waiting for NAV2-SAT/);
  context.receiver.value = "f9p";
  context.renderSatellites(7000);
  assert.equal(source.value, "NAV");
  assert.equal(option.disabled, true);
  context.satelliteConstellations.clear();
  context.renderSatellites(7000);
  assert.match(context.satelliteRows.innerHTML, /No satellites match/);
  context.satelliteUsedOnly.checked = true;
  context.renderSatellites(7000);
  assert.match(context.satelliteRows.innerHTML, /No used satellites match/);
});

test("satellite table has a fixed scroll area and correction popup host", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "insight.css"), "utf8");
  assert.match(html, /id="satellite-table-wrap"/);
  assert.match(html, /id="satellite-comparison-table-wrap"/);
  assert.match(html, /id="satellite-correction-popup" role="dialog"/);
  assert.match(css, /#satellite-comparison-table-wrap \{ height: 360px; overflow: auto; \}/);
  assert.match(css, /#satellite-live-data \{ display: flex; min-height: 0; flex-direction: column; \}/);
  assert.match(css, /#satellite-table-wrap \{ height: 0; min-height: 360px; flex: 1 1 auto; overflow: auto; \}/);
  assert.match(css, /\.satellite-name \{ color: var\(--satellite-color\); \}/);
  assert.match(css, /#satellite-correction-popup \{ position: fixed;/);
});

test("satellites tab activates between the existing views without leaving another panel visible", () => {
  const tab = () => ({ classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } });
  const context = loadFunctions(["activateTab"], {
    spectrumTab: tab(), positionTab: tab(), satellitesTab: tab(), signalsTab: tab(), osnmaTab: tab(),
    spectrumPanel: {}, positionPanel: {}, satellitesPanel: {}, signalsPanel: {}, osnmaPanel: {},
    renderSatellites() {}, drawSignals() {},
  });
  context.activateTab("satellites");
  assert.equal(context.satellitesPanel.hidden, false);
  assert.equal(context.satellitesTab["aria-selected"], "true");
  for (const panel of [context.spectrumPanel, context.positionPanel, context.signalsPanel, context.osnmaPanel]) assert.equal(panel.hidden, true);
  context.activateTab("signals");
  assert.equal(context.satellitesPanel.hidden, true);
  assert.equal(context.signalsPanel.hidden, false);
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

test("baud changes configure both UARTs and reopen the host at the same rate", async () => {
  const writes = []; const reconnects = [];
  const context = loadFunctions(["applyReceiverBaud"], {
    port: {}, writer: {}, settings: { baudByReceiver: {} }, receiver: { value: "x20" }, baud: {},
    configurationStatus: {}, configurationTooltip: {}, saveSettings() {}, setStatus() {}, showConfigResults() {},
    async sendValset(...args) { writes.push(args); return "ack"; },
    async reconnectAtBaud(rate) { reconnects.push(rate); },
  });
  assert.equal(await context.applyReceiverBaud(4000000), "ack");
  assert.deepEqual(writes, [["UART1 baud rate", 0x40520001, 4000000, 4], ["UART2 baud rate", 0x40530001, 4000000, 4]]);
  assert.deepEqual(reconnects, [4000000]);
  context.sendValset = async () => "nak";
  await assert.rejects(context.applyReceiverBaud(921600), /UART1 baud rate change nak/);
  assert.equal(reconnects.length, 1);
  context.port = null; context.writer = null;
  assert.equal(await context.applyReceiverBaud(115200), "saved");
  assert.equal(context.settings.baudByReceiver.x20, 115200);
});

test("interface detection polls MON-COMMS and displays its parsed result", async () => {
  let writtenFrame;
  const context = loadFunctions(["detectReceiverInterface", "ubxFrame", "checksum"], {
    receiverInterface: { textContent: "" }, pendingInterfacePoll: null, interfaceRxState: null,
    writer: { write(frame) { writtenFrame = frame; return Promise.resolve(); } },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  const detecting = context.detectReceiverInterface();
  assert.equal(writtenFrame[2], 0x0a);
  assert.equal(writtenFrame[3], 0x36);
  context.pendingInterfacePoll(null);
  assert.equal(typeof context.pendingInterfacePoll, "function");
  context.pendingInterfacePoll("USB");
  await detecting;
  assert.equal(context.receiverInterface.textContent, "Interface: USB");
});

test("interface polling collects an RX baseline and a second sample, then stops", async () => {
  let tick; let expire; let polls = 0; let intervalsCleared = 0;
  const payload = new Uint8Array(88); payload[1] = 2;
  const data = new DataView(payload.buffer);
  data.setUint16(8, 0x0100, true); data.setUint32(20, 9000000, true);
  data.setUint32(12, 9000000, true); data.setUint16(48, 0x0300, true);
  const context = loadFunctions(["detectReceiverInterface", "parseMonCommsInterface", "ubxFrame", "checksum"], {
    receiverInterface: {}, pendingInterfacePoll: null, interfaceRxState: null,
    setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {},
    setInterval(callback) { tick = callback; return 2; }, clearInterval() { intervalsCleared += 1; },
    writer: { write() {
      polls += 1; data.setUint32(60, polls * 8, true);
      context.pendingInterfacePoll?.(context.parseMonCommsInterface(payload));
      return Promise.resolve();
    } },
  });
  const detecting = context.detectReceiverInterface();
  assert.equal(polls, 1);
  assert.equal(context.interfaceRxState.name, null);
  tick();
  assert.equal(await detecting, "USB");
  assert.equal(polls, 2);
  assert.equal(intervalsCleared, 1);
  assert.equal(context.pendingInterfacePoll, null);
  assert.equal(context.receiverInterface.textContent, "Interface: USB");
  expire();
  assert.equal(intervalsCleared, 1);
  context.writer = { write: () => Promise.resolve() };
  const timingOut = context.detectReceiverInterface();
  expire();
  assert.equal(await timingOut, null);
  assert.match(context.receiverInterface.textContent, /no unique RX activity/);
  assert.equal(intervalsCleared, 2);
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

test("NAV/NAV2 separation requires matching valid epochs and uses ellipsoid height", () => {
  const context = loadFunctions(["positionSolutionDelta"], {});
  const nav = { iTow: 1000, latitude: 0, longitude: 0, height: 100, fixType: 3, positionValid: true };
  const nav2 = { ...nav, longitude: 0.00001, height: 102.5 };
  const delta = context.positionSolutionDelta(nav, nav2);
  assert.ok(Math.abs(delta.horizontal - 1.1131949) < 0.00001);
  assert.equal(delta.vertical, 2.5);
  assert.equal(context.positionSolutionDelta(nav, { ...nav2, iTow: 2000 }), null);
  assert.equal(context.positionSolutionDelta(nav, { ...nav2, positionValid: false }), null);
  assert.equal(context.positionSolutionDelta(nav, { ...nav2, fixType: 2 }).vertical, null);
  assert.equal(context.positionSolutionDelta(nav, nav).horizontal, 0);
  const dateline = context.positionSolutionDelta({ ...nav, longitude: 179.99999 }, { ...nav2, longitude: -179.99999 });
  assert.ok(dateline.horizontal < 2.23 && dateline.horizontal > 2.22);
  assert.ok(context.positionSolutionDelta(nav, { ...nav2, longitude: 180 }).horizontal > 20000000);
});

test("position comparison buffers delayed epochs and rejects invalid fixes without replacing newer pairs", () => {
  const state = { epochs: new Map(), latest: { NAV: null, NAV2: null }, pair: null };
  let skyMapRenders = 0;
  const context = loadFunctions(["recordPositionSolution", "positionSolutionDelta"], {
    positionComparisonState: state, replayRebuilding: false, renderPositionComparison() {}, renderSatellites() { skyMapRenders += 1; },
  });
  const payload = (epoch, flags = 1) => {
    const bytes = new Uint8Array(92); const data = new DataView(bytes.buffer);
    data.setUint32(0, epoch, true); bytes[20] = 3; bytes[21] = flags;
    data.setInt32(32, 100000, true); data.setUint32(40, 1500, true); data.setUint32(44, 2500, true);
    return bytes;
  };
  context.recordPositionSolution(payload(1000), "NAV");
  assert.equal(skyMapRenders, 1);
  context.recordPositionSolution(payload(2000), "NAV");
  assert.equal(skyMapRenders, 2);
  context.recordPositionSolution(payload(1000), "NAV2");
  assert.equal(state.pair.NAV.iTow, 1000);
  assert.equal(state.pair.NAV.hAcc, 1.5);
  context.recordPositionSolution(payload(2000), "NAV2");
  assert.equal(state.pair.NAV.iTow, 2000);
  context.recordPositionSolution(payload(1000), "NAV");
  assert.equal(state.pair.NAV.iTow, 2000);
  assert.equal(state.latest.NAV.iTow, 2000);
  const invalid = payload(2000); invalid[78] = 1;
  context.recordPositionSolution(invalid, "NAV2");
  assert.equal(context.positionSolutionDelta(state.pair.NAV, state.pair.NAV2), null);
  context.recordPositionSolution(payload(3000, 0), "NAV");
  assert.equal(state.latest.NAV.positionValid, false);
  const outsideEarth = payload(4000); new DataView(outsideEarth.buffer).setInt32(28, 910000000, true);
  context.recordPositionSolution(outsideEarth, "NAV");
  assert.equal(state.latest.NAV.positionValid, false);
  for (let index = 5; index < 100; index++) context.recordPositionSolution(payload(index * 1000), "NAV");
  assert.equal(state.epochs.size, 60);
  state.latest = { NAV: null, NAV2: null }; state.pair = null; state.epochs.clear();
  for (const epoch of [604799000, 0]) for (const source of ["NAV", "NAV2"]) context.recordPositionSolution(payload(epoch), source);
  assert.equal(state.pair.NAV.iTow, 0);
});

test("receiver configuration enables NAV-DOP and X20 NAV2-DOP at one epoch per report", async () => {
  const requests = [];
  const context = loadFunctions(["configureMonSpan", "receiverInterfaceRequests", "gnssFeatureConfigurationRequests", "receiverMonitoringConfigurationRequests"], {
    writer: {}, configureButton: {}, receiver: { value: "x20" },
    settings: { configureAllInterfaces: true, enableOsnma: false, enableGalHas: false, baudByReceiver: { x20: 38400, f9p: 115200 } },
    osnmaClockSettings: { useComputerClock: false }, configurationStatus: { setAttribute() {} }, configurationTooltip: {},
    trustedClockSample: null, osnmaTrustedTimeStatus: {}, showConfigResults() {}, startSecSigPolling() {}, refreshLocalClock() {},
    setStatus(message) { assert.doesNotMatch(message, /failed/i); },
    async sendValset(...request) { requests.push(request); return "ack"; },
  });
  await context.configureMonSpan();
  assert.ok(requests.some(([name, key, rate, size]) => name === "UART1 baud rate" && key === 0x40520001 && rate === 38400 && size === 4));
  assert.ok(requests.some(([name, key, rate, size]) => name === "UART2 baud rate" && key === 0x40530001 && rate === 38400 && size === 4));
  assert.ok(requests.some(([name, key, rate, size]) => name === "NAV-DOP UART1" && key === 0x20910039 && rate === 1 && size === 1));
  assert.ok(requests.some(([name, key, rate]) => name === "NAV-DOP USB" && key === 0x2091003b && rate === 1));
  assert.ok(requests.some(([name, key, rate]) => name === "NAV2-DOP USB" && key === 0x20910468 && rate === 1));
  assert.equal(requests.filter(([name]) => name.includes("-DOP ")).length, 6);
  requests.length = 0;
  context.receiver.value = "f9p";
  await context.configureMonSpan();
  assert.equal(requests.filter(([name]) => name.includes("NAV2-DOP")).length, 0);
  assert.equal(requests.filter(([name]) => name.startsWith("NAV-DOP ")).length, 3);
});

test("DOP values are scaled and paired by epoch and source regardless of arrival order", () => {
  const state = { epochs: new Map(), latest: { NAV: null, NAV2: null }, pair: null };
  const context = loadFunctions(["recordPositionSolution", "parseNavDop", "resetPositionComparison", "handleUbx", "replayFrameGroup", "signalSampleEpoch", "recordSignalComputerTime"], {
    positionComparisonState: state, replayRebuilding: false, renderPositionComparison() {}, renderSatellites() {},
    signalEpoch: { latest: null, tow: null }, drawSignals() {},
    replayData: null, HISTORY_LENGTH: 600,
  });
  const pvt = (tow, pDop) => {
    const payload = new Uint8Array(92); const data = new DataView(payload.buffer);
    data.setUint32(0, tow, true); payload[20] = 3; payload[21] = 1; data.setUint16(76, pDop, true);
    return payload;
  };
  const dop = (tow, hDop) => {
    const payload = new Uint8Array(18); const data = new DataView(payload.buffer);
    data.setUint32(0, tow, true); data.setUint16(12, hDop, true);
    return payload;
  };
  context.handleUbx(0x01, 0x04, dop(1000, 82));
  context.recordPositionSolution(pvt(1000, 156), "NAV");
  context.recordPositionSolution(pvt(1000, 234), "NAV2");
  assert.equal(state.pair.NAV.pDop, 1.56);
  assert.equal(state.pair.NAV.hDop, 0.82);
  assert.equal(state.pair.NAV2.pDop, 2.34);
  assert.equal(state.pair.NAV2.hDop, null);
  context.handleUbx(0x29, 0x04, dop(2000, 950));
  assert.equal(state.pair.NAV2.hDop, null);
  context.handleUbx(0x29, 0x04, dop(1000, 123));
  assert.equal(state.pair.NAV2.hDop, 1.23);
  assert.equal(state.pair.NAV.hDop, 0.82);
  context.recordPositionSolution(pvt(2000, 320), "NAV2");
  assert.equal(state.latest.NAV2.hDop, 9.5);
  context.parseNavDop(new Uint8Array(17), "NAV");
  context.parseNavDop(dop(604800000, 100), "NAV");
  assert.equal(state.epochs.size, 2);
  assert.equal(context.replayFrameGroup(0x01, 0x04), "dop");
  assert.equal(context.replayFrameGroup(0x29, 0x04), "dop");
  for (let epoch = 3; epoch < 100; epoch++) context.parseNavDop(dop(epoch * 1000, 100), "NAV");
  assert.equal(state.epochs.size, 60);
  context.resetPositionComparison();
  assert.equal(state.epochs.size, 0);
});

test("position comparison renders matching quality, stale and invalid states, and resets", () => {
  const sample = { iTow: 1000, latitude: 0, longitude: 0, height: 100, fixType: 3, positionValid: true, flags: 0x83, satellites: 22, hAcc: 0.02, vAcc: 0.03, receivedAt: 1000 };
  const state = { epochs: new Map(), latest: { NAV: null, NAV2: null }, pair: null };
  const context = loadFunctions(["renderPositionComparison", "positionSolutionDelta", "resetPositionComparison"], {
    positionComparisonState: state, receiver: { value: "x20" }, replayData: null,
    positionComparisonPanel: {}, positionComparisonStatus: { dataset: {} }, positionComparisonEpoch: {},
    positionComparisonHorizontal: {}, positionComparisonVertical: {}, positionComparisonQuality: {},
  });
  context.renderPositionComparison(1000);
  assert.match(context.positionComparisonStatus.textContent, /Waiting for NAV-PVT/);
  state.latest.NAV = sample;
  context.renderPositionComparison(1000);
  assert.match(context.positionComparisonStatus.textContent, /Waiting for NAV2-PVT/);
  state.latest.NAV2 = { ...sample, iTow: 2000 };
  context.renderPositionComparison(1000);
  assert.match(context.positionComparisonStatus.textContent, /matching iTOW/);
  state.latest.NAV2 = { ...sample, longitude: 0.00001, height: 102.5, flags: 1, pDop: 2.34, hDop: 1.23 };
  state.pair = { ...state.latest };
  context.renderPositionComparison(1000);
  assert.equal(context.positionComparisonHorizontal.textContent, "1.113 m");
  assert.equal(context.positionComparisonVertical.textContent, "+2.500 m");
  assert.match(context.positionComparisonQuality.innerHTML, /RTK fixed.*Standalone/);
  assert.match(context.positionComparisonQuality.innerHTML, /0.020 m/);
  assert.match(context.positionComparisonQuality.innerHTML, /PDOP<\/th><td>--<\/td><td>2.34<\/td>/);
  assert.match(context.positionComparisonQuality.innerHTML, /HDOP<\/th><td>--<\/td><td>1.23<\/td>/);
  state.latest.NAV = { ...sample, iTow: 2000, receivedAt: 1100 };
  context.renderPositionComparison(1100);
  assert.equal(context.positionComparisonStatus.textContent, "Matched epoch");
  assert.equal(context.positionComparisonStatus.dataset.state, "matched");
  context.renderPositionComparison(2099);
  assert.equal(context.positionComparisonStatus.textContent, "Matched epoch");
  state.latest.NAV = { ...sample, iTow: 3000, receivedAt: 2100 };
  context.renderPositionComparison(2100);
  assert.match(context.positionComparisonStatus.textContent, /awaiting next match/);
  assert.equal(context.positionComparisonStatus.dataset.state, "waiting");
  state.latest.NAV = sample;
  context.renderPositionComparison(2200);
  assert.equal(context.positionComparisonStatus.textContent, "Matched epoch");
  assert.equal(state.pendingSince, null);
  state.latest.NAV = { ...sample, iTow: 2000, receivedAt: 2300 };
  context.renderPositionComparison(2300);
  assert.equal(context.positionComparisonStatus.textContent, "Matched epoch");
  state.latest.NAV = sample;
  context.renderPositionComparison(2400);
  assert.equal(state.pendingSince, null);
  context.renderPositionComparison(7000);
  assert.equal(context.positionComparisonStatus.dataset.state, "stale");
  context.replayData = new Uint8Array(1);
  context.renderPositionComparison(7000);
  assert.equal(context.positionComparisonStatus.dataset.state, "matched");
  assert.match(context.positionComparisonStatus.textContent, /recorded/);
  state.pair.NAV2.fixType = 2;
  context.renderPositionComparison(7000);
  assert.equal(context.positionComparisonVertical.textContent, "--");
  assert.match(context.positionComparisonStatus.textContent, /height unavailable/);
  state.pair.NAV2.positionValid = false;
  context.renderPositionComparison(7000);
  assert.equal(context.positionComparisonStatus.dataset.state, "invalid");
  assert.equal(context.positionComparisonHorizontal.textContent, "--");
  context.receiver.value = "f9p";
  context.renderPositionComparison(7000);
  assert.equal(context.positionComparisonPanel.hidden, true);
  context.resetPositionComparison();
  assert.equal(state.pair, null);
  assert.equal(state.pendingSince, null);
  assert.equal(context.positionComparisonHorizontal.textContent, "--");
});

test("live map expansion reuses the map, resizes both engines and restores focus", () => {
  let leafletResizes = 0; let vectorResizes = 0; let focusCount = 0;
  const view = {};
  const dialog = { open: false, append(element) { element.parentElement = this; }, showModal() { this.open = true; }, close() { this.open = false; } };
  const home = { append(element) { element.parentElement = this; } };
  const icon = {};
  const button = { setAttribute(name, value) { this[name] = value; }, querySelector: () => icon, focus() { focusCount += 1; } };
  const context = loadFunctions(["setPositionMapExpanded"], {
    positionMapView: view, positionMapDialog: dialog, positionMapHome: home, positionMapExpand: button,
    positionMap: { invalidateSize() { leafletResizes += 1; } }, mapLibreMap: { resize() { vectorResizes += 1; } },
    requestAnimationFrame(callback) { callback(); },
  });
  context.setPositionMapExpanded(true);
  assert.equal(dialog.open, true);
  assert.equal(view.parentElement, dialog);
  assert.equal(button["aria-expanded"], "true");
  assert.equal(button["aria-label"], "Restore live map");
  assert.equal(icon.textContent, "close_fullscreen");
  context.setPositionMapExpanded(false);
  assert.equal(dialog.open, false);
  assert.equal(view.parentElement, home);
  assert.equal(button["aria-expanded"], "false");
  assert.equal(button["aria-label"], "Expand live map");
  assert.equal(icon.textContent, "open_in_full");
  assert.equal(leafletResizes, 2);
  assert.equal(vectorResizes, 2);
  assert.equal(focusCount, 2);
  context.positionMap = null; context.mapLibreMap = null;
  assert.doesNotThrow(() => context.setPositionMapExpanded(true));
});

test("map accepts only valid position fixes", () => {
  let trackDraws = 0;
  let mapUpdates = 0;
  const observedSources = [];
  const positionPanel = { hidden: true };
  const positionRecenter = { disabled: true };
  const positionZoomIn = { disabled: true };
  const positionZoomOut = { disabled: true };
  const context = loadFunctions(["parseNavPvt", "positionSourceForReceiver"], {
    receiver: { value: "x20" }, settings: { positionSource: "NAV" },
    recordPositionSolution(payload, source) { observedSources.push(source); },
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
  assert.equal(observedSources.at(-1), "NAV2");
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
  context.settings.positionSource = "NAV";
  const verifiedPvt = new Uint8Array(92); verifiedPvt[20] = 3; verifiedPvt[21] = 1;
  new DataView(verifiedPvt.buffer).setUint16(78, 0x4000, true);
  context.parseNavPvt(verifiedPvt, "NAV");
  assert.match(context.positionInfo.innerHTML, /Position verification:<\/strong> Verified/);
  assert.match(context.positionInfo.innerHTML, /mixed solution agrees with NMA-authenticated data/);
});

test("NAV-PVT clock parsing retains confirmation flags and time accuracy", () => {
  const context = loadFunctions(["parseNavPvt", "positionSourceForReceiver"], { DataView, receiver: { value: "x20" }, settings: { positionSource: "NAV" }, recordPositionSolution() {}, refreshOsnmaClock() {} });
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

test("NAV-PVT authTime and nmaFixStatus bits are exposed separately", () => {
  let observedFix;
  const context = loadFunctions(["parseNavPvt", "positionSourceForReceiver"], {
    DataView, receiver: { value: "x20" }, settings: { positionSource: "NAV" }, recordPositionSolution() {}, refreshOsnmaClock() {},
    updateReceiverStatus(fix) { observedFix = fix; },
  });
  const payload = new Uint8Array(92); payload[20] = 3;
  const data = new DataView(payload.buffer); data.setInt32(24, 10000000, true); data.setInt32(28, 20000000, true); data.setUint16(78, 0x6000, true);
  context.parseNavPvt(payload, "NAV");
  assert.equal(context.latestPvtClock.authTime, true);
  assert.equal(observedFix.authTime, true);
  assert.equal(observedFix.nmaFixStatus, true);
  context.receiver.value = "f9p";
  context.parseNavPvt(payload, "NAV");
  assert.equal(context.latestPvtClock.authTime, false);
  assert.equal(observedFix.authTime, false);
  assert.equal(observedFix.nmaFixStatus, false);
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
  const state = () => ({ textContent: "", innerHTML: "", dataset: {} });
  const context = loadFunctions(["refreshOsnmaClock"], {
    settings: { enableOsnma: true },
    latestPvtClock: { utcMs: Date.UTC(2026, 9, 19), receivedAt: now - 125, tAccNs: 80, validDate: true, validTime: true, fullyResolved: true, confirmedDate: true, confirmedTime: true, authTime: true, authFlagsAvailable: true },
    latestTimeUtcClock: null, osnmaClockSettings: { showLocalTime: false },
    osnmaClockValue: state(), osnmaClockAge: state(), osnmaClockPvt: state(), osnmaClockTimeUtc: state(), osnmaClockAuth: state(),
    latestOsnmaStatus: { ...workingStatus(), receivedAt: now, connectionId: 1 },
    latestOsnmaTimeCheck: { status: 3, authenticated: true }, liveConnectionId: 1,
  });
  context.refreshOsnmaClock(now);
  assert.match(context.osnmaClockValue.innerHTML, /<span class="osnma-clock-time">.*<\/span>.* UTC$/);
  assert.match(context.osnmaClockPvt.textContent, /output time authenticated \(validated against an external trusted time source\)/);
  assert.equal(context.osnmaClockAge.dataset.state, "good");
  assert.match(context.osnmaClockAuth.textContent, /check passed/);
  assert.equal(context.osnmaClockAuth.dataset.state, "good");
  context.osnmaClockSettings.showLocalTime = true;
  context.refreshOsnmaClock(now);
  assert.match(context.osnmaClockValue.innerHTML, /<span class="osnma-clock-time">.*<\/span>.* local$/);
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
  const passedCheck = { differenceMs: -513, status: 3, receivedAt: 99000, connectionId: 1, authenticated: true };
  const sent = [];
  const context = loadFunctions(["localClockCorrectionBlockers", "canCorrectLocalClock", "refreshLocalClock", "updateLocalClock", "resetLocalClock", "osnmaCodeState", "buildTrustedComputerUtcPayload", "sendTrustedClockTime"], {
    Date: Clock, Uint8Array, DataView, settings: { enableOsnma: true }, port: {}, writer: {}, reading: true, replayData: null,
    latestReceiverUtc: null, latestOsnmaStatus: workingStatus(), liveConnectionId: 1,
    trustedClockSample: sample, trustedClockUpdatePending: false,
    latestOsnmaTimeCheck: passedCheck, latestAuthenticatedTimeCheck: passedCheck, lastAppliedAuthenticatedTimeCheck: null,
    appClockOffsetMs: 0, osnmaUpdateLocalTime: {}, osnmaUpdateLocalTimeTooltip: { title: "", dataset: {}, tabIndex: -1 }, osnmaUpdateLocalTimeRequirements: { textContent: "" }, osnmaSendTrustedTime: {}, osnmaLocalTime: {}, clockOffset: {}, refreshOsnmaClock() {},
    configureButton: { disabled: false },
    osnmaClockSettings: { accuracySeconds: 1 }, setStatus() {},
    async sendMgaAssistance(payload, messageId) { sent.push({ payload, messageId }); return { accepted: true }; },
  });
  context.settings.enableOsnma = false;
  assert.equal(context.canCorrectLocalClock(), false);
  context.refreshLocalClock();
  assert.match(context.osnmaUpdateLocalTimeTooltip.title, /Enable Galileo OSNMA in Settings/);
  context.settings.enableOsnma = true;
  const assistanceBefore = Array.from(context.buildTrustedComputerUtcPayload());
  assert.equal(context.canCorrectLocalClock(), true);
  const correction = context.updateLocalClock();
  assert.equal(context.osnmaUpdateLocalTime.disabled, true);
  await context.updateLocalClock();
  await correction;
  assert.equal(context.appClockOffsetMs, -513);
  assert.equal(sent.length, 1);
  assert.equal(context.osnmaUpdateLocalTime.disabled, true);
  assert.match(context.osnmaUpdateLocalTimeTooltip.title, /already used/);
  assert.equal(sent[0].messageId, 0x40);
  assert.deepEqual(Array.from(sent[0].payload), Array.from(context.buildTrustedComputerUtcPayload(-513)));
  assert.equal(context.trustedClockSample.offsetMs, -513);
  assert.equal(context.trustedClockSample.awaitingCheck, true);
  await context.updateLocalClock();
  assert.equal(sent.length, 1);
  assert.deepEqual(Array.from(context.buildTrustedComputerUtcPayload()), assistanceBefore);
  context.latestOsnmaTimeCheck = { differenceMs: 20, status: 3, receivedAt: 100000, connectionId: 1, trustedClockSample: context.trustedClockSample, authenticated: true };
  context.latestAuthenticatedTimeCheck = { differenceMs: 20, status: 3, receivedAt: 100000, connectionId: 1, authenticated: true };
  context.trustedClockSample.awaitingCheck = false;
  assert.equal(context.canCorrectLocalClock(), true);
  for (const changes of [{ timingAuthResult: 2 }, { teslaKeyAuthStatus: 2 }, { timSyncEnabled: 0 }, { timSyncStatus: 4 }, { timSyncStatus: 7 }, { cpks: 3 }, { pubKeyValid: 0 }, { receivedAt: 59999 }, { connectionId: 0 }, { satellites: [{ authStatus: 0 }] }]) {
    context.latestOsnmaStatus = { ...workingStatus(), ...changes };
    assert.equal(context.canCorrectLocalClock(), true, JSON.stringify(changes));
  }
  context.latestOsnmaStatus = workingStatus();
  context.latestOsnmaTimeCheck.receivedAt = 59999;
  assert.equal(context.canCorrectLocalClock(), true);
  context.latestOsnmaStatus = { ...workingStatus(), timSyncStatus: 0, timingAuthResult: 0, teslaKeyAuthStatus: 0, headerAuthStatus: 0 };
  assert.equal(context.canCorrectLocalClock(), true);
  context.refreshLocalClock();
  assert.equal(context.osnmaUpdateLocalTime.disabled, false);
  context.latestOsnmaTimeCheck = { differenceMs: 20, status: 4, receivedAt: 100000, connectionId: 1, trustedClockSample: context.trustedClockSample, authenticated: false };
  assert.equal(context.canCorrectLocalClock(), true);
  context.latestAuthenticatedTimeCheck.authenticated = false;
  assert.equal(context.canCorrectLocalClock(), false);
  context.latestAuthenticatedTimeCheck.authenticated = true;
  context.liveConnectionId = 2;
  assert.equal(context.canCorrectLocalClock(), false);
  context.liveConnectionId = 1;
  context.latestOsnmaStatus = workingStatus();
  context.latestOsnmaTimeCheck.receivedAt = 100000;
  context.replayData = {};
  assert.equal(context.canCorrectLocalClock(), false);
  context.replayData = null;
  await context.updateLocalClock();
  assert.equal(context.appClockOffsetMs, -493);
  context.latestOsnmaTimeCheck = { differenceMs: 10, status: 3, receivedAt: 100000, connectionId: 1, trustedClockSample: context.trustedClockSample, authenticated: true };
  context.latestAuthenticatedTimeCheck = { differenceMs: 10, status: 3, receivedAt: 100000, connectionId: 1, authenticated: true };
  context.sendMgaAssistance = async () => ({ accepted: false, message: "receiver acknowledgement timed out" });
  await context.updateLocalClock();
  assert.equal(context.appClockOffsetMs, -493);
  assert.equal(context.trustedClockSample, null);
  context.resetLocalClock();
  assert.equal(context.appClockOffsetMs, 0);
  assert.equal(context.latestReceiverUtc, null);
  assert.equal(context.latestAuthenticatedTimeCheck, null);
  assert.equal(context.osnmaUpdateLocalTime.disabled, true);
});

test("Send trusted time enables the requirement, configures the receiver, then sends UTC", async () => {
  const events = [];
  const context = loadFunctions(["sendTrustedTimeNow"], {
    settings: { enableOsnma: true },
    osnmaClockSettings: { useComputerClock: false },
    osnmaTrustedTimeStatus: {}, configureButton: { disabled: false },
    writer: {}, reading: true, replayData: null, liveConnectionId: 1,
    syncOsnmaClockForm() {}, saveOsnmaClockSettings() {},
    async configureMonSpan() { events.push("configure"); return [{ name: "Require trusted computer time", result: "ack" }]; },
    async sendTrustedClockTime() { events.push("trusted UTC"); return { accepted: true }; },
  });
  await context.sendTrustedTimeNow();
  assert.equal(context.osnmaClockSettings.useComputerClock, true);
  assert.deepEqual(events, ["configure", "trusted UTC"]);
  assert.match(context.osnmaTrustedTimeStatus.textContent, /accepted/);
  context.configureMonSpan = async () => [{ name: "Require trusted computer time", result: "nak" }];
  events.length = 0;
  await context.sendTrustedTimeNow();
  assert.deepEqual(events, []);
  assert.match(context.osnmaTrustedTimeStatus.textContent, /not acknowledged/);
});

test("OSNMA correction waits for a new check cycle after each accepted trusted UTC sample", () => {
  const firstSample = { offsetMs: 0, connectionId: 1, awaitingCheck: true };
  const context = loadFunctions(["parseSecOsnma", "hasAuthenticatedOsnmaTiming", "osnmaCodeState"], {
    DataView, Date, latestOsnmaStatus: null, latestOsnmaTimeCheck: null, latestAuthenticatedTimeCheck: null,
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
  assert.equal(context.latestAuthenticatedTimeCheck.differenceMs, -513);
  assert.equal(context.latestAuthenticatedTimeCheck.connectionId, 1);
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
  assert.equal(context.latestAuthenticatedTimeCheck.differenceMs, -513);
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

test("status header highlights only authenticated time and verified position", () => {
  const element = () => ({ className: "status-item", textContent: "", title: "" });
  const context = loadFunctions(["updateReceiverStatus"], {
    fixStatus: element(), gpsTime: element(), clockOffset: element(), latitudeStatus: element(), longitudeStatus: element(),
    altitudeStatus: { ...element(), innerHTML: "" }, speedStatus: { ...element(), innerHTML: "" }, headingStatus: { ...element(), innerHTML: "" },
    port: null, reading: false, replayData: null, appClockOffsetMs: 0, latestReceiverUtc: null, liveConnectionId: 1,
  });
  const fix = {
    fixType: 3, satellites: 8, positionSource: "NAV", valid: 7, time: "2026-10-25 12:00:00", year: 2026, month: 10,
    day: 25, hour: 12, minute: 0, second: 0, nano: 0, positionValid: true, latitude: 59, longitude: 10,
    altitudeMetres: 100, groundSpeedMetresPerSecond: 1, headingDegrees: 90,
  };
  context.updateReceiverStatus({ ...fix, authTime: true, nmaFixStatus: true });
  assert.match(context.gpsTime.className, /status-authenticated/);
  assert.match(context.gpsTime.title, /external trusted time source/);
  assert.match(context.latitudeStatus.className, /status-authenticated/);
  assert.match(context.longitudeStatus.className, /status-authenticated/);
  assert.match(context.altitudeStatus.className, /status-authenticated/);
  assert.match(context.latitudeStatus.title, /mixed solution agrees/);
  context.updateReceiverStatus({ ...fix, authTime: false, nmaFixStatus: false });
  assert.equal(context.gpsTime.className, "status-item");
  assert.equal(context.latitudeStatus.className, "status-item");
  assert.equal(context.longitudeStatus.className, "status-item");
  assert.equal(context.altitudeStatus.className, "status-item status-metric");
  assert.match(context.latitudeStatus.title, /does not imply spoofing/);
  context.updateReceiverStatus({ ...fix, valid: 0, positionValid: false, authTime: true, nmaFixStatus: true });
  assert.equal(context.gpsTime.className, "status-item");
  assert.match(context.gpsTime.title, /UTC is invalid/);
  assert.equal(context.latitudeStatus.className, "status-item");
  assert.match(context.latitudeStatus.title, /position is invalid/);
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
  const context = loadFunctions(["updateSignalHover", "clearSignalHover", "renderSignalReadout"], {
    signalChartState: new Map([[canvas, { series, box: { x: 0, width: 100 }, firstEpoch: 0, lastEpoch: 10 }]]),
    signalHover, signalHoverPinned, window: { devicePixelRatio: 1 }, drawSignals() {},
    signalCharts: { secState: canvas }, signalEpochTime: () => "GPS TOW 5.000 s",
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