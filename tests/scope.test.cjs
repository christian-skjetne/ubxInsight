const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

test("map accepts only valid position fixes", () => {
  let trackDraws = 0;
  let mapUpdates = 0;
  const positionPanel = { hidden: true };
  const context = loadFunctions(["parseNavPvt"], {
    DataView, positionFixes: [], positionEmpty: {}, positionInfo: {}, positionPanel,
    receiverThreat: { monRfJam: 0, navSpoof: 0, secJam: 0, secSpoof: 0 }, replayRebuilding: false,
    latLonToUtm33: () => ({}), drawPositionTrack() { trackDraws += 1; }, updatePositionMap() { mapUpdates += 1; }, updateReceiverStatus() {},
  });
  for (const [fixType, flags, pointCount] of [[0, 0, 0], [5, 1, 0], [3, 0, 0], [2, 1, 1], [3, 1, 2], [4, 1, 3]]) {
    const payload = new Uint8Array(92);
    payload[20] = fixType; payload[21] = flags;
    context.parseNavPvt(payload);
    assert.equal(context.positionFixes.length, pointCount);
  }
  assert.equal(trackDraws, 0);
  assert.equal(mapUpdates, 0);
  positionPanel.hidden = false;
  context.parseNavPvt(Object.assign(new Uint8Array(92), { 20: 3, 21: 1 }));
  assert.equal(trackDraws, 1);
  assert.equal(mapUpdates, 1);
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

test("OSNMA age boundaries and receiver state colors", () => {
  const names = ["osnmaLastUpdate", "osnmaServiceState", "osnmaTimeSyncState", "osnmaTimeDelta", "osnmaHeaderAuth", "osnmaDsmAuth", "osnmaTeslaAuth", "osnmaTimingAuth", "osnmaReceiverStatus"];
  const context = loadFunctions(["osnmaCodeState", "osnmaRetainedResultState", "refreshOsnmaIndicators"], {
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

test("periodic OSNMA indicators retain success until the expected update is overdue", () => {
  const names = ["osnmaLastUpdate", "osnmaServiceState", "osnmaTimeSyncState", "osnmaTimeDelta", "osnmaHeaderAuth", "osnmaDsmAuth", "osnmaTeslaAuth", "osnmaTimingAuth", "osnmaReceiverStatus"];
  const context = loadFunctions(["osnmaCodeState", "osnmaRetainedResultState", "refreshOsnmaIndicators"], {
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
    Date: Clock, Uint8Array, DataView, port: {}, writer: {}, reading: true, replayData: null,
    latestReceiverUtc: null, latestOsnmaStatus: workingStatus(), liveConnectionId: 1,
    trustedClockSample: sample, trustedClockUpdatePending: false,
    latestOsnmaTimeCheck: { differenceMs: -513, status: 3, receivedAt: 99000, trustedClockSample: sample, authenticated: true },
    appClockOffsetMs: 0, osnmaUpdateLocalTime: {}, osnmaLocalTime: {}, clockOffset: {},
    osnmaClockSettings: { accuracySeconds: 1 }, setStatus() {},
    async sendMgaAssistance(payload, messageId) { sent.push({ payload, messageId }); return { accepted: true }; },
  });
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
    fixStatus: {}, gpsTime: {}, clockOffset: {}, latestPosition: {}, altitudeStatus: {}, speedStatus: {}, headingStatus: {},
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