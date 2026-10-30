

<img src="logo.png?res=123" alt="UBX Insight" width="640">

Plot lots of data from your Ublox receiver in-browser.  
Requires an F9 or X20-series Ublox receiver.

## Browser app:
- Try it out here: https://christian-skjetne.github.io/ubxInsight/
- or just clone and open the index.html file in the browser. No server needed.
## useful info:
- This web app gets a lot of data from your receiver, you need to set the baudrate very high (I suggest 1M or 2M minimum)
- The baudrate should be set on both uart1 and uart2. If one of them is bogged down it effect the other for some reason.
- You can set the baudrate in RAM from the settings button. If you unplug the unit you need to do it again.


### Ai generated description of app features:
- Settings are grouped into Display and power, GNSS integrity features, Position
  display, Spectrum traces, Receiver connection, and Waterfall sections.
- Serve this directory over localhost, for example: `python -m http.server 8765`
- Open `index.html` in Chrome or Edge.
- The page can also be opened directly. In `file://` mode the map automatically
	uses OpenFreeMap because OpenStreetMap's public tile server requires an HTTP referrer.
- Connect the receiver and select `Start recording` to begin capturing raw bytes.
- In Settings, check `Keep screen awake` to request a Screen Wake Lock for this page.
  The status row confirms when it is active or reports a denied request.
  When returning to a visible tab, an enabled lock is requested again automatically.
  Uncheck `Keep screen awake` to release it immediately. This opt-in resets on page reload.
  Support requires a compatible browser and secure context (typically HTTPS or
  localhost); unavailable browsers disable the checkbox. Browsers may release the
  lock when hidden or due to power policy. It does not prevent all system sleep,
  browser suspension, or receiver disconnections.
- In Settings, enable `Configure UART1, UART2 and USB` and select Apply to
	configure UBX message output on those three interfaces. This also
	disables NMEA output on those interfaces; baud rates and input protocols are
	unchanged. The default remains UART1 only. The selection is saved locally
	and is applied on connection, on `Send config`, or when changed while connected.
	Every configuration disables UBX/NMEA output on I2C and SPI, including output
	enabled by older versions. Input protocols on those buses are not changed.
	Unsupported interfaces/messages may be rejected individually; inspect the
	configuration indicator for ACK/NAK results. Configuration is RAM-only.
- In Settings, enable `Use authenticated navigation data only (strict mode)` to
	configure `CFG-NAVSPG-ONLY_AUTHDATA` on supported X20 receivers. The saved
	preference is applied on connection, on `Send config`, or when changed while
	connected. F9P does not receive this setting.

- The status bar identifies the receiver-side interface using UBX-MON-COMMS
  RX byte-counter changes between samples, not historical RX/TX totals. Startup
	briefly polls for a baseline and new incoming bytes. A single serial port with
	RX growth confirms UART1, UART2 or USB; idle reports retain the last confirmed
	port. Multiple receiving ports are ambiguous, so this assumes the app is the
	only host sending commands. Counter resets require a new baseline. Linux
	`/dev/ttyACM0` commonly represents native receiver USB, not UART1; USB-to-UART
	adapters instead reach whichever receiver UART they are wired to. The host
	device name alone does not establish the receiver-side interface.
- Select `Stop recording` to download the completed `.ubx` file.
- The status bar's system-stats icon opens CPU, memory and serial TX readings.
	It is yellow when any current percentage exceeds 90%, red above 95%, and
	green otherwise once telemetry is available. Historical peaks do not trigger
	the indicator. Click outside or press Escape to close the popover.
- X20 configuration enables UBX-MON-SYS at 1 Hz. System stats shows receiver
	CPU load and dynamic memory use.
	Hover each value for its peak since restart. Live readings become stale after
	three seconds without an update; replay values describe recorded telemetry.
	Standard F9P firmware does not expose these MON-SYS metrics; values remain `--`.
- UBX-MON-COMMS is enabled at 1 Hz on the configured serial interfaces. System
	stats shows separate UART1, UART2 and USB TX buffer percentages and pending bytes.
	These are queue occupancy, not line bandwidth percentages. Tooltips include peak
	occupancy, total transmitted bytes and available RX error counters. I2C and SPI
	are excluded. Missing ports show `--`; stale and replay labels follow MON-SYS.
- RAWX is requested every measurement epoch with a 1 Hz measurement rate.
	Slow arrival alone does not establish CPU overload: UART bandwidth can be the
	bottleneck. For 8N1, 38,400 baud carries at most 3,840 bytes/s. A RAWX frame
	with 100 measurements needs 3,224 bytes before adding MON-SPAN, navigation,
	security and other output. Native USB does not have this UART baud limit.
- Settings stores one baud rate for the host connection and both receiver UARTs.
	Changing it while connected configures UART1 and UART2, waits for ACKs, then
	reopens the host connection at that rate. On connection, the saved rate is applied
	to both UARTs. The interface-status estimate is not used to choose a UART. Native
	USB has no UART baud limit. UART1/2 TX queue occupancy above 90% displays a
	persistent status-bar tip to raise the rate in Settings.
- Select `Replay .ubx` to open the playback controls for play/pause, speed and seeking.
	The `1x` rate is estimated from the selected receiver baud rate.

The `.ubx` capture contains the raw bytes received from the serial port. It preserves
message order and content, but not the original host-side timing between serial reads.

### OSNMA display:
- Receiver status uses green for working, yellow for waiting and red for errors.
- Last update becomes yellow after 40 seconds without SEC-OSNMA and red after 60.
- Time-sync requirement, its time difference, TESLA key, and timing-parameter results
	stay green across idle reports for 60 seconds after a successful result. TESLA
	authentication-in-progress reports also retain the last result. DSM results
	stay green for 240 seconds. These expected intervals match the observed receiver
	cadence; overdue results turn yellow. Explicit failures turn red immediately and
	remain red until replaced by a new result. Missing SEC-OSNMA telemetry for more
	than 40 seconds also turns otherwise-green periodic indicators yellow.
- `Send trusted time` enables the receiver's trusted-time requirement, applies the
	receiver configuration, and then sends computer UTC and its stated uncertainty.
	The checkbox is a saved preference; selecting it alone does not change receiver
	configuration. Use `Send config` to apply the disabled state when turning the
	requirement off. `Apply OSNMA offset & resend trusted UTC` adds the last passed receiver-reported
	OSNMA time difference to the offset used for the accepted trusted UTC input,
	sends the adjusted UTC as new trusted-time assistance, and updates app UTC only
	if the receiver acknowledges it. Windows time is unchanged; app correction
	resets on disconnect or replay. The trusted-time action requires acknowledged
	receiver configuration and accepted UTC assistance before correction is available.
- Each accepted assistance message requires an observed non-completed time-sync
	status followed by an authenticated passed check before correction is available.
	That result remains usable between authentication epochs, without a check-age
	timeout, while the receiver continues reporting healthy live status. Explicit
	errors, a later failed check, telemetry older than 40 seconds, replay or disconnect
	block correction. Sending consumes the baseline until another check completes;
	a failed send invalidates it and requires configuration again.
- The signed difference is added as requested; its sign convention is not specified
	in the supplied documentation. Verify that the next completed check moves toward
	zero before repeating. Latency, trusted-time uncertainty and propagation can
	affect the result, and an older offset cannot account for later computer-clock
	drift or clock steps; this is not a precision clock guarantee.
- Normal receiver configuration still sends raw computer UTC, not adjusted app UTC.
	The displayed receiver time difference remains unchanged until a check is reported.

Browser regression checks (Node.js): `node --test tests/scope.test.cjs`

### Satellite sky view:
- The Satellites tab, between Position and GNSS Signals, uses the already enabled
	NAV-SAT/NAV2-SAT messages; no additional receiver traffic is requested.
- Select NAV or NAV2 (X20 only) and filter constellations. Each source retains its
	own latest snapshot. The sky plot places north at the top, east on the right,
	the horizon at the outer ring, and zenith at the center. Filled markers are used
	in the selected solution; outlined markers are not. Hover markers for details.
- The sortable table includes C/N0, elevation, azimuth, tracking/use and health.
	Unknown positions and below-horizon satellites remain in the table but are not
	plotted. Live reports become stale after five seconds; replay is labelled recorded.
	Connection, receiver and replay resets clear snapshots. NAV/NAV2 are never merged.
- The sky plot can overlay online orbit estimates from the
	[GNSS Sky Map API](https://github.com/christian-skjetne/PRN-to-skymap) and lists
	matched receiver/TLE azimuth and elevation, including signed angular differences.
	The browser script is pinned to a specific upstream commit to avoid stale CDN
	`@main` responses; update that commit deliberately when adopting upstream changes.
	The page tries CDN copies of Leaflet, MapLibre GL, `satellite.js`, and the GNSS
	API, then falls back to local copies in the same folder as `index.html`.
	Run `python download_offline_libs.py` once while online to download those
	libraries and stylesheets. If neither copy of `satellite.js` loads, only TLE
	predictions and their controls are disabled; the rest of the app starts normally.
	Map tiles, online TLE feeds, and Google-hosted icon fonts still require a network
	connection.
	The calculation uses the selected solution's latest valid position and the
	computer's current UTC, never receiver-reported UTC (which may be untrusted);
	it refreshes on first use, every minute, after moving about 1 km, or on demand.
	Live PVT updates immediately update the observer location; the last TLE positions
	remain visible while the receiver moves less than the refresh threshold.
	Predictions use the same constellation colors as live satellites, with PRN-matched
	live and predicted positions connected by a line. Constellation filters apply to
	both live and predicted markers. `Show online sky-map satellites` hides or shows
	prediction markers and connector lines without disabling the comparison table.
	If online feed requests are blocked by CORS, import the
	[GNSS TLE file](https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/gnss.tle)
	and optionally the
	[GNSS-Radar PRN mapping file](https://raw.githubusercontent.com/taroz/GNSS-Radar/master/js/prnmap.js)
	using `Import TLE / PRN mapping`. Import both when TLE names do not identify their
	PRNs; the mapping file is a JavaScript `PRNMAP` object, not an IGS SINEX file.
	Imported files are cached by the browser and used for subsequent predictions; a
	newer TLE or mapping file can be imported at any time. If browser storage is
	unavailable or full, the import still works for the current page session and the
	status reports that it was not cached.
	Enable `Lock sky-map location` to keep a fixed observer location. Choose to freeze
	the latest valid receiver position or enter independent coordinates; receiver
	coordinates are not independently verified. The lock and coordinates are saved.
	TLE positions are approximate predictions, not receiver observations or precision
	ephemerides. A network connection is needed to load feeds initially; the API
	caches TLEs and metadata locally and reports when it falls back to stale data.

### NAV/NAV2 position comparison:
- On X20, the Position tab compares NAV-PVT and NAV2-PVT at identical `iTOW`
	epochs, independently of the selected track/map source. Up to 60 epochs are
	buffered to accommodate delayed output; older arrivals do not replace newer pairs.
- Horizontal separation uses local WGS84 geometry (a spherical surface-distance
	approximation for separations over 100 km). Signed vertical difference is NAV2
	minus NAV ellipsoid height, and requires valid 3D fixes from both streams.
- The paired solutions show fix type, correction state, satellites, and reported
	horizontal/vertical accuracy. Missing, invalid, unmatched, and stale data are
	labelled; live matched samples become stale after five seconds. Replay is labelled
	recorded, not live. Connection changes and replay resets clear the comparison.
- Solution quality also shows dimensionless PDOP from each PVT report and HDOP
	from NAV-DOP/NAV2-DOP at the identical `iTOW`. DOP reports are enabled at 1 Hz
	on configured interfaces (NAV2-DOP on X20 only). Either arrival order is supported;
	unavailable or zero-valued DOP reads `--`. DOP describes satellite geometry,
	not measured position error or signal authenticity.
- NAV2 is GNSS standalone and can legitimately differ from the primary solution.
	No spoofing threshold is inferred: differing correction/filter/authentication
	policies can cause separation, while shared signal attacks may move both solutions
	together. Position agreement does not prove signal authenticity.
