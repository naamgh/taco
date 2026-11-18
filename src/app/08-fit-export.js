  // ============================================================
  // .FIT EXPORT (for Strava / Garmin Connect / TrainingPeaks, etc.)
  // ============================================================
  var FIT_EPOCH_OFFSET = 631065600; // seconds between Unix epoch and FIT epoch (1989-12-31 00:00:00 UTC)

  function fitTimestamp(dateMs){
    return Math.floor(dateMs / 1000) - FIT_EPOCH_OFFSET;
  }

  function fitU8(v){ return [v & 0xFF]; }
  function fitU16le(v){ return [v & 0xFF, (v >> 8) & 0xFF]; }
  function fitU32le(v){ return [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]; }

  var FIT_BASE = {
    enum:   {id:0x00, size:1, write:fitU8,    invalid:0xFF},
    uint8:  {id:0x02, size:1, write:fitU8,    invalid:0xFF},
    uint16: {id:0x84, size:2, write:fitU16le, invalid:0xFFFF},
    uint32: {id:0x86, size:4, write:fitU32le, invalid:0xFFFFFFFF}
  };

  function fitDefMessage(localNum, globalNum, fields){
    var bytes = [];
    bytes.push(0x40 | (localNum & 0x0F));
    bytes.push(0); // reserved
    bytes.push(0); // architecture: 0 = little endian
    bytes.push(globalNum & 0xFF, (globalNum >> 8) & 0xFF);
    bytes.push(fields.length);
    fields.forEach(function(f){
      bytes.push(f.num, FIT_BASE[f.base].size, FIT_BASE[f.base].id);
    });
    return bytes;
  }

  function fitDataMessage(localNum, fields, values){
    var bytes = [localNum & 0x0F];
    fields.forEach(function(f, i){
      var v = values[i];
      if(v === null || v === undefined) v = FIT_BASE[f.base].invalid;
      bytes = bytes.concat(FIT_BASE[f.base].write(v));
    });
    return bytes;
  }

  function fitCrc16(bytes, seed){
    var crcTable = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,
                    0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
    var crc = seed || 0;
    for(var i = 0; i < bytes.length; i++){
      var b = bytes[i];
      var tmp = crcTable[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ crcTable[b & 0xF];
      tmp = crcTable[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ crcTable[(b >> 4) & 0xF];
    }
    return crc;
  }

  var FIT_FILE_ID_FIELDS = [
    {num:0, base:'enum'}, {num:1, base:'uint16'}, {num:2, base:'uint16'},
    {num:3, base:'uint32'}, {num:4, base:'uint32'}
  ];
  var FIT_RECORD_FIELDS = [
    {num:253, base:'uint32'}, // timestamp
    {num:3,   base:'uint8'},  // heart_rate
    {num:4,   base:'uint8'},  // cadence
    {num:7,   base:'uint16'}, // power
    {num:5,   base:'uint32'}, // distance (cm)
    {num:6,   base:'uint16'}  // speed (mm/s)
  ];

  // Virtual speed from power, the way TrainerRoad and Wahoo fill in a
  // trainer ride: a flat road, 85 kg rider+bike, Crr 0.004, CdA 0.32.
  // Strava's web analysis keys its charts off the distance stream and shows
  // nothing without one, even when power and HR are all there — the phone
  // app copes, the website doesn't. The numbers are a plausible flat-road
  // equivalent, not a measurement.
  var VSPEED = {mass:85, crr:0.004, cda:0.32, rho:1.226, g:9.81};
  function virtualSpeed(watts){
    if(!(watts > 0)) return 0;
    var roll = VSPEED.crr * VSPEED.mass * VSPEED.g, aero = 0.5 * VSPEED.rho * VSPEED.cda;
    var v = 5;
    for(var i = 0; i < 12; i++){            // Newton on P = roll*v + aero*v^3
      var f = roll * v + aero * v * v * v - watts;
      var d = roll + 3 * aero * v * v;
      v -= f / d;
      if(v < 0.1) v = 0.1;
    }
    return v;                                // m/s
  }
  // Cumulative distance per sample (m), one second per sample.
  function virtualDistances(samples){
    var out = [], dist = 0;
    for(var i = 0; i < samples.length; i++){
      var p = samples[i].power;
      var v = p === null || p === undefined ? 0 : virtualSpeed(p);
      dist += v;
      out.push({v:v, d:dist});
    }
    return out;
  }
  // Lap field numbers are NOT the same as the session's: lap avg_heart_rate is
  // 15 and avg_power 19, where the session uses 16 and 20. Getting these wrong
  // produces a file that parses cleanly and shows nonsense.
  var FIT_LAP_FIELDS = [
    {num:254, base:'uint16'}, // message_index (must increment from 0)
    {num:253, base:'uint32'}, // timestamp (lap end)
    {num:0,   base:'enum'},   // event = 9 (lap)
    {num:1,   base:'enum'},   // event_type = 1 (stop)
    {num:2,   base:'uint32'}, // start_time
    {num:7,   base:'uint32'}, // total_elapsed_time (ms)
    {num:8,   base:'uint32'}, // total_timer_time (ms)
    {num:15,  base:'uint8'},  // avg_heart_rate
    {num:16,  base:'uint8'},  // max_heart_rate
    {num:17,  base:'uint8'},  // avg_cadence
    {num:18,  base:'uint8'},  // max_cadence
    {num:19,  base:'uint16'}, // avg_power
    {num:20,  base:'uint16'}, // max_power
    {num:9,   base:'uint32'}  // total_distance (cm)
  ];
  var FIT_SESSION_FIELDS = [
    {num:253, base:'uint32'}, {num:0, base:'enum'}, {num:1, base:'enum'}, {num:2, base:'uint32'},
    {num:5, base:'enum'}, {num:6, base:'enum'}, {num:7, base:'uint32'}, {num:8, base:'uint32'},
    {num:25, base:'uint16'},  // first_lap_index
    {num:26, base:'uint16'},  // num_laps
    {num:9,  base:'uint32'}   // total_distance (cm)
  ];
  // 58 = virtual_activity. This is the byte Strava reads to file a ride as a
  // Virtual Ride (it's what Zwift and Rouvy write); indoor_cycling (6) lands
  // as a plain Ride with the trainer flag. Applies to hand-uploaded .fit
  // downloads as well as the direct sync.
  var FIT_SUB_SPORT_VIRTUAL_ACTIVITY = 58;
  var FIT_ACTIVITY_FIELDS = [
    {num:253, base:'uint32'}, {num:0, base:'uint32'}, {num:1, base:'uint16'},
    {num:2, base:'enum'}, {num:3, base:'enum'}, {num:4, base:'enum'}
  ];

  function buildFitActivity(samples, startDateMs, laps){
    var startFit = fitTimestamp(startDateMs);
    var durationSec = samples.length;
    var endFit = startFit + durationSec;

    // A ride ended before the first segment boundary has no recorded laps;
    // FIT still wants at least one, so fall back to a single whole-ride lap.
    if(!laps || !laps.length) laps = [{start:0, end:durationSec}];

    var recs = [];
    recs = recs.concat(fitDefMessage(0, 0, FIT_FILE_ID_FIELDS));
    recs = recs.concat(fitDataMessage(0, FIT_FILE_ID_FIELDS, [4, 255, 0, 1, startFit]));

    var vd = virtualDistances(samples);
    var totalCm = vd.length ? Math.round(vd[vd.length - 1].d * 100) : 0;

    recs = recs.concat(fitDefMessage(1, 20, FIT_RECORD_FIELDS));
    // Sample i holds the reading at the end of second i+1, so the first
    // record naturally lands at start+1. Strava takes elapsed time from the
    // record span rather than the session field, which left every ride one
    // second short. Head units write a record the instant the timer starts,
    // so do the same: stamp the first reading at the start time as well.
    if(samples.length){
      var s0 = samples[0];
      recs = recs.concat(fitDataMessage(1, FIT_RECORD_FIELDS, [startFit, s0.hr, s0.cadence, s0.power, 0, Math.round(vd[0].v * 1000)]));
    }
    samples.forEach(function(s, i){
      var ts = startFit + Math.round(s.t / 1000);
      recs = recs.concat(fitDataMessage(1, FIT_RECORD_FIELDS, [
        ts, s.hr, s.cadence, s.power, Math.round(vd[i].d * 100), Math.round(vd[i].v * 1000)
      ]));
    });

    // One lap per interval as actually ridden. Samples are 1 Hz with sample i
    // covering second i+1, so seconds start+1..end map to indices start..end-1.
    recs = recs.concat(fitDefMessage(2, 19, FIT_LAP_FIELDS));
    laps.forEach(function(lap, i){
      var st = computeSummary(samples.slice(lap.start, lap.end));
      var durMs = (lap.end - lap.start) * 1000;
      var dFrom = lap.start > 0 ? vd[lap.start - 1].d : 0;
      var dTo = lap.end > 0 ? vd[lap.end - 1].d : 0;
      recs = recs.concat(fitDataMessage(2, FIT_LAP_FIELDS, [
        i, startFit + lap.end, 9, 1, startFit + lap.start, durMs, durMs,
        st.avgHr, st.maxHr, st.avgCadence, st.maxCadence, st.avgPower, st.maxPower,
        Math.round((dTo - dFrom) * 100)
      ]));
    });

    recs = recs.concat(fitDefMessage(3, 18, FIT_SESSION_FIELDS));
    recs = recs.concat(fitDataMessage(3, FIT_SESSION_FIELDS, [
      endFit, 8, 1, startFit, 2, FIT_SUB_SPORT_VIRTUAL_ACTIVITY, durationSec * 1000, durationSec * 1000, 0, laps.length, totalCm
    ]));

    recs = recs.concat(fitDefMessage(4, 34, FIT_ACTIVITY_FIELDS));
    recs = recs.concat(fitDataMessage(4, FIT_ACTIVITY_FIELDS, [endFit, durationSec * 1000, 1, 0, 26, 1]));

    var header = [14, 0x10, 0x64, 0x00, 0, 0, 0, 0, 0x2E, 0x46, 0x49, 0x54];
    var dataSize = recs.length;
    header[4] = dataSize & 0xFF;
    header[5] = (dataSize >> 8) & 0xFF;
    header[6] = (dataSize >> 16) & 0xFF;
    header[7] = (dataSize >> 24) & 0xFF;
    var headerCrc = fitCrc16(header, 0);
    header = header.concat([headerCrc & 0xFF, (headerCrc >> 8) & 0xFF]);

    var fileBytes = header.concat(recs);
    var finalCrc = fitCrc16(fileBytes, 0);
    fileBytes = fileBytes.concat([finalCrc & 0xFF, (finalCrc >> 8) & 0xFF]);

    return new Uint8Array(fileBytes);
  }

  // ---- theme ----
  // The <head> script already set data-theme before first paint; this just
  // keeps the toggle, the chart colours and storage in step with it.
  var THEME_KEY = 'ftpPlan_theme_v1';
  function currentTheme(){ return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function applyTheme(theme){
    if(theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
    els.themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    els.themeToggle.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    refreshChartColors();
    if(liveState.active){ setupLiveChartCanvas(); drawLiveChart(); }
  }
  els.themeToggle.addEventListener('click', function(){
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });
  applyTheme(currentTheme());

  // ---- quick guide ----
  // Click toggles it open (was hover); Esc or clicking elsewhere closes.
  // Positioned beside the button and clamped so it never opens off-screen.
  // On desktop the guide is triggered from the rail util button, so anchor the
  // popover to whichever trigger is actually visible (the menu's guideBtn is
  // hidden on desktop and would give a zero rect at 0,0).
  function guideAnchor(){
    var rg = document.getElementById('railGuide');
    return (rg && rg.offsetParent !== null) ? rg : els.guideBtn;
  }
  function placeGuide(){
    var pop = els.guidePop, r = guideAnchor().getBoundingClientRect();
    pop.style.display = 'block';
    var pw = pop.offsetWidth, ph = pop.offsetHeight, m = 12;
    // Prefer to the right of the button, bottom-aligned with it; fall back
    // to above/anywhere that fits.
    var left = r.right + 10;
    if(left + pw > window.innerWidth - m) left = Math.max(m, window.innerWidth - m - pw);
    var top = r.bottom - ph;
    if(top < m) top = m;
    if(top + ph > window.innerHeight - m) top = Math.max(m, window.innerHeight - m - ph);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function guideOpen(){ return els.guidePop.style.display !== 'none' && els.guidePop.style.display !== ''; }
  function showGuide(){ placeGuide(); els.guideBtn.classList.add('on'); }
  function hideGuide(){ els.guidePop.style.display = 'none'; els.guideBtn.classList.remove('on'); }
  els.guideBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if(guideOpen()) hideGuide(); else showGuide();
  });
  document.addEventListener('click', function(e){
    var rg = document.getElementById('railGuide');
    if(guideOpen() && !els.guidePop.contains(e.target) && !els.guideBtn.contains(e.target) && !(rg && rg.contains(e.target))) hideGuide();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && guideOpen()) hideGuide();
  });
  window.addEventListener('resize', function(){ if(guideOpen()) placeGuide(); });

  // Spacebar: pause while riding, "Resume now" while paused. Ignored when
  // typing in a field, and the default is swallowed so a focused button
  // doesn't also get "clicked" by the same press.
  document.addEventListener('keydown', function(e){
    if(e.code !== 'Space' || !liveState.active) return;
    var tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if(liveState.phase === 'running' && !liveState.paused){
      e.preventDefault();
      pauseWorkout('manual');
    } else if(liveState.phase === 'waiting' && liveState.armMode === 'resume'){
      e.preventDefault();
      initAudio();
      resumeWorkout();
    }
  });

  // Offline fallback for the hosted copy. Network-first, so a push to the
  // repo is picked up on the next open rather than a stale cache winning.
  // Skipped on localhost: the local dev server has no sw.js and doesn't need one.
  if('serviceWorker' in navigator && location.protocol === 'https:'){
    navigator.serviceWorker.register('sw.js').catch(function(e){ console.log('Service worker not registered:', e && e.message); });
  }

  checkBleSupport();
  updateDeviceUI();   // shows "Reconnect" if a device is remembered
  updateStravaUI();
  // Verify a remembered Strava session is still live (token due → refresh now;
  // revoked/expired → sign out), so "connected" always reflects reality.
  if(typeof stravaValidateSession === 'function') stravaValidateSession();
  // Coming back from Strava's consent page (or reopening after a ride that
  // never got closed): finish the sign-in, then bring the parked ride back.
  stravaHandleCallback().then(function(){ restoreStashedRide(); });
  renderSortMenu();
  updateStarFilterUI();
  els.ftpInput.value = hasFtp() ? ftp : '';
  els.maxHrInput.value = maxHr || '';
  els.zonePopFtp.textContent = hasFtp() ? ftp : '—';
  renderZoneTable();
