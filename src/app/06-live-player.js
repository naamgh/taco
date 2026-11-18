  // ============================================================
  // LIVE WORKOUT PLAYER
  // ============================================================
  // Derived from ZONES rather than duplicated. A hand-kept second copy drifted
  // out of sync when the zone keys changed, and because the chart draw is
  // wrapped in a try/catch the whole thing just silently stopped rendering.
  // Canvas can't read CSS variables, so the chart's colours are resolved from
  // the current theme here and refreshed whenever it changes.
  var ZONE_HEX = {};
  var CHART = {ink:'255,255,255', power:'#FFF04D', cadence:'#B79CFF'};
  function refreshChartColors(){
    var cs = getComputedStyle(document.documentElement);
    function hex(name, fallback){
      var v = cs.getPropertyValue(name).trim();
      return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
    }
    Object.keys(ZONES).forEach(function(k){ ZONE_HEX[k] = hex('--c-' + k, ZONES[k].hex); });
    var ink = cs.getPropertyValue('--ink-rgb').trim();
    if(/^\d+,\s*\d+,\s*\d+$/.test(ink)) CHART.ink = ink;
    CHART.power = hex('--line-power', '#FFF04D');
    CHART.cadence = hex('--line-cadence', '#B79CFF');
    var bg = hex('--bg', '#121213');   // paper colour for the watt-tag chips
    CHART.paper = parseInt(bg.slice(1, 3), 16) + ',' + parseInt(bg.slice(3, 5), 16) + ',' + parseInt(bg.slice(5, 7), 16);
  }
  var HR_LINE_COLOR = '#FF453A';
  var CADENCE_LINE_ALPHA = 0.6;
  // The export image is always drawn on the dark ground, whatever the app
  // is showing: it's a Strava graphic, not a screenshot.
  var EXPORT_COLORS = {power:'#FFF04D', cadence:'#B79CFF', hr:'#FF453A'};
  // Trailing-average windows (seconds). Power and cadence get a light touch
  // so a 1 Hz trace reads as a line rather than fuzz, without hiding a surge.
  var SMOOTH_POWER = 5, SMOOTH_CADENCE = 15, SMOOTH_HR = 9;

  var liveState = {
    active:false, workout:null, flat:[], idx:0, remaining:0, paused:false, timerId:null,
    elapsedTotal:0, totalSeconds:0, samples:[], startDateMs:null,
    // Wall-clock anchors so the session clock can't drift the way a plain
    // 1000 ms setInterval does over a 75-minute workout.
    clockOriginMs:0, pausedAccumMs:0, pausedAtMs:0,
    // 'waiting' (armed, watching for pedalling) -> 'countdown' -> 'running'
    phase:'running', pedalHoldMs:0, waitTimerId:null, countdownId:null,
    // Actual segment boundaries as ridden, in elapsed seconds. Recorded live
    // rather than derived from the plan, because skipping a segment moves them.
    laps:[], lapStartSec:0,
    // Rider-adjustable workout intensity, 1.0 = as written. Two independent
    // trims: workFactor scales the whole ride (Overall), restFactor is an
    // extra multiplier applied only to the recovery legs between work sets, so
    // you can lift the recoveries without touching the efforts. Targets only —
    // recorded power is untouched, so TSS/.fit stay true to what was ridden.
    workFactor:1, restFactor:1, hasRest:false,
    chartMaxPct:0, ranges:null, lastErgWatts:null
  };

  var INTENSITY_MIN = 50, INTENSITY_MAX = 150;
  // Rest trim is deliberately wide — a recovery can be lifted past the efforts
  // if that's what the rider wants — with just a sane floor, not a tight cap.
  var REST_MIN = 50, REST_MAX = 250;

  // The FTP and max HR a ride is judged against are the ones it was ridden
  // at, snapshotted onto liveState at the start and restored with a saved
  // ride — so a ride from before a retest keeps its zones and TSS.
  function rideFtp(){ return liveState.ftp || ftp; }
  function rideMaxHr(){ return liveState.maxHr || maxHr; }

  // The workout arms itself when the window opens and only starts the clock
  // once the rider is actually turning the cranks.
  // holdMs 0: the count-in begins the moment both readouts are above threshold
  // (both sensor boxes "green"), rather than after a sustained hold.
  var PEDAL_START = {cadence:20, power:20, holdMs:0, countdownSec:3};
  var RESUME_ARM_MS = 2000;      // manual pause: how long stopped before pedal-to-resume arms
  var COUNTDOWN_ABORT_MS = 750;  // resume countdown: how long stopped before it's called off

  // ---- audio cues ----
  // Synthesised rather than loaded, so the file stays self-contained. The
  // context has to be created from a user gesture or browsers keep it
  // suspended, so it's initialised when a workout is started.
  var audioCtx = null;
  function initAudio(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      if(!audioCtx) audioCtx = new AC();
      if(audioCtx.state === 'suspended') audioCtx.resume();
    }catch(e){ audioCtx = null; }
  }
  function beep(freq, ms, level){
    try{
      if(!audioCtx || audioCtx.state !== 'running') return;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      var t = audioCtx.currentTime, dur = ms / 1000;
      // Ramp in and out: a square-edged gain change clicks audibly.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
      gain.gain.setValueAtTime(level, t + dur - 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }catch(e){}
  }
  function beepTick(){ beep(660, 150, 0.16); }   // 3 - 2 - 1
  function beepGo(){ beep(990, 340, 0.20); }     // go, and each new segment
  // A short celebratory arpeggio when a workout finishes — a C major chord
  // climbing to its octave, over a soft root pad. Reuses the ride's audio
  // context (already unlocked by the Start tap), so it plays without a gesture.
  function playFinishChime(){
    try{
      if(!audioCtx || audioCtx.state !== 'running') return;
      var t0 = audioCtx.currentTime, notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function(freq, i){
        var t = t0 + i * 0.085, osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        osc.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.17, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc.start(t); osc.stop(t + 0.6);
      });
      var pad = audioCtx.createOscillator(), pg = audioCtx.createGain();
      pad.type = 'sine'; pad.frequency.value = 261.63;
      pad.connect(pg); pg.connect(audioCtx.destination);
      pg.gain.setValueAtTime(0.0001, t0);
      pg.gain.exponentialRampToValueAtTime(0.08, t0 + 0.03);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
      pad.start(t0); pad.stop(t0 + 0.9);
    }catch(e){}
  }

  // Keep the screen awake for the length of the session where supported.
  var wakeLock = null;
  function acquireWakeLock(){
    try{
      if(!navigator.wakeLock) return;
      navigator.wakeLock.request('screen').then(function(lock){ wakeLock = lock; }, function(){});
    }catch(e){}
  }
  function releaseWakeLock(){
    try{ if(wakeLock){ wakeLock.release(); wakeLock = null; } }catch(e){}
  }
  document.addEventListener('visibilitychange', function(){
    // A wake lock is dropped when the tab is hidden, so re-take it on return.
    if(document.visibilityState === 'visible' && liveState.active && !wakeLock) acquireWakeLock();
  });

  function mmss(sec){
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Tag the recovery legs for the Rest trim. Rule: any leg sitting between the
  // first and last work leg that isn't itself a work leg is a recovery — even
  // a steady or endurance block dropped between intervals counts, whatever its
  // own zone. Warm-up (before the first work leg) and cool-down (after the
  // last) are never rest, so lifting recoveries never stiffens them.
  function tagRestLegs(flat){
    var first = -1, last = -1, i;
    for(i = 0; i < flat.length; i++){ if(flat[i].work){ if(first < 0) first = i; last = i; } }
    for(i = 0; i < flat.length; i++){
      flat[i].rest = (first >= 0 && i > first && i < last && !flat[i].work);
    }
  }

  function startWorkout(key){
    var wo = byKey(key);
    if(!wo) return;
    var flat = expandBlocks(wo.blocks).map(function(s){
      // Rounded: a 20 s leg is stored as 1/3 min and 1/3 * 60 isn't exact.
      return {type:s.type, min:s.min, pct:s.pct, pctEnd:s.pctEnd, label:s.label, seconds:Math.round(s.min * 60), prep:s.prep, work:s.work, cue:s.cue};
    });
    tagRestLegs(flat);
    liveState.hasRest = flat.some(function(s){ return s.rest; });
    liveState.workout = wo;
    liveState.flat = flat;
    liveState.idx = 0;
    liveState.shownCue = null;
    liveState.remaining = flat[0].seconds;
    liveState.elapsedTotal = 0;
    liveState.totalSeconds = flat.reduce(function(s, x){ return s + x.seconds; }, 0);
    liveState.active = true;
    liveState.paused = false;
    liveState.samples = [];
    liveState.startDateMs = Date.now();
    liveState.ftp = hasFtp() ? ftp : null;
    liveState.maxHr = maxHr || null;
    liveState.savedId = null;
    liveState.rpe = null;
    liveState.stravaActivityId = null;
    liveState.clockOriginMs = now();
    liveState.pausedAccumMs = 0;
    liveState.pausedAtMs = 0;
    liveState.phase = 'waiting';
    liveState.pedalHoldMs = 0;
    liveState.laps = [];
    liveState.lapStartSec = 0;
    liveState.workFactor = 1;
    liveState.restFactor = 1;
    liveState.ranges = null;
    liveState.rampBelow = 0;
    liveState.rampFailedAtStep = null;
    liveState.idleSec = 0;

    // Ceiling comes from this workout's own plan rather than a fixed 122%.
    // A fixed ceiling clamped anaerobic blocks — a 170% and a 130% effort drew
    // the same height — and left gentler sessions using half the frame.
    var planPeak = 0;
    flat.forEach(function(s){
      if(s.pct !== null) planPeak = Math.max(planPeak, s.pct, s.pctEnd || 0);
    });
    liveState.chartMaxPct = Math.max(105, Math.ceil((planPeak + 8) / 5) * 5);

    // Don't carry the last session's readouts into the new one.
    liveReadouts.power = null;
    liveReadouts.cadence = null;
    liveReadouts.hr = null;

    els.livePlayer.style.display = 'flex';
    els.liveWorkoutName.textContent = wo.name;

    // Set the trainer up front so the resistance is already correct for the
    // first segment the moment the rider starts turning the cranks. ERG writes
    // are rejected until the control point grants control, so this has to wait
    // on the request/start handshake.
    if(trainerState.connected && trainerState.controlChar){
      requestControl().then(startTrainer).then(applyCurrentTarget);
    }
    initAudio();          // this call is inside the button's gesture
    setupLiveChartCanvas();
    renderLivePlayer();
    drawLiveChart();
    armPedalStart('start');
  }

  // ---- armed start: wait for pedalling before the clock runs ----
  // Used for the initial start and for coming back from a pause, so the rider
  // is never dropped straight back into a running interval.
  function armPedalStart(mode, reason, armed){
    liveState.armMode = mode;                  // 'start' | 'resume'
    liveState.phase = 'waiting';
    liveState.pedalHoldMs = 0;
    // A manual pause is often pressed with the legs still turning (pausing
    // drops the ERG load, so spinning on is easy) — so pedal-to-resume only
    // arms once the rider has actually stopped. Otherwise the pause would
    // undo itself a second later. Auto-pause has already seen them stop.
    liveState.resumeArmed = armed || !(mode === 'resume' && reason === 'manual');
    liveState.stoppedMs = 0;
    showWaitingOverlay(mode, reason);
    if(liveState.waitTimerId) clearInterval(liveState.waitTimerId);
    liveState.waitTimerId = setInterval(pollPedalStart, 250);
  }

  function showWaitingOverlay(mode, reason){
    var resuming = mode === 'resume';
    liveState.armReason = reason;
    els.liveWaiting.style.display = 'flex';
    els.liveWaiting.style.opacity = '';            // belt and braces after a dissolve
    els.liveWaiting.classList.remove('dissolving');
    els.waitingReadouts.style.visibility = '';
    els.waitingIcon.style.display = '';
    els.waitingIcon.classList.add('pulsing');
    els.waitingIcon.textContent = resuming ? '\u23f8' : '\ud83d\udeb4';
    els.waitingCountdown.style.display = 'none';
    els.waitingDevices.style.display = 'flex';
    if(resuming){
      els.waitingTitle.textContent = reason === 'auto' ? 'Auto-paused' : 'Paused';
    } else {
      els.waitingTitle.textContent = 'Pedal to begin';
    }
    els.waitingStartBtn.textContent = resuming ? 'Resume now' : 'Start now';
    els.waitingCancelBtn.textContent = resuming ? 'End workout' : 'Cancel';
    paintWaitingHead();
    refreshWaitingOverlay();
    els.waitingCadence.textContent = '\u2014';
    els.waitingPower.textContent = '\u2014';
    els.waitingCadenceChip.classList.remove('met');
    els.waitingPowerChip.classList.remove('met');
  }

  // The parts of the overlay that depend on what's connected. Re-run whenever
  // a device comes or goes, so connecting from the overlay itself swaps the
  // "nothing to detect" message for the live readouts without reopening it.
  function refreshWaitingOverlay(){
    if(liveState.phase !== 'waiting') return;
    var hasTrainer = trainerState.connected;
    els.waitingReadouts.style.display = hasTrainer ? 'flex' : 'none';
    // The chips go green on their own, so the thresholds don't need spelling
    // out; the missing-device block below says what isn't connected.
    els.waitingSub.textContent = waitingSubText();

    // Only the missing devices get a tile; both connected, the block goes.
    var noTrainer = !trainerState.connected, noHr = !hrState.connected;
    els.waitingDevices.style.display = (noTrainer || noHr) ? 'flex' : 'none';
    els.wdWarn.textContent = noTrainer && noHr ? 'Trainer and HR not connected:'
                           : noTrainer ? 'Trainer not connected:' : 'HR not connected:';
    paintWaitingDevice(trainerState, els.wdTrainerBtn, els.wdTrainerText, 'Connect trainer');
    paintWaitingDevice(hrState, els.wdHrBtn, els.wdHrText, 'Connect HR');
    paintWaitingFtp();
  }

  function waitingSubText(){
    if(liveState.armMode !== 'resume') return 'Or press Start now.';
    if(!liveState.resumeArmed) return 'Stop pedaling or press Resume now.';
    return (liveState.armReason === 'auto' ? 'No pedalling detected. ' : '') + 'Pedal to resume, or press Resume now.';
  }

  // Stopped = the same test auto-pause uses (≤5 W, or cadence exactly 0). With
  // no readings at all there's nothing turning to wait out.
  function riderStopped(){
    var pw = liveReadouts.power, cad = liveReadouts.cadence;
    if(pw === null && cad === null) return true;
    return (pw !== null && pw <= AUTO_PAUSE.power) || (cad !== null && cad === 0);
  }

  // Design-B header (desktop): the workout name + a zone · duration · TSS line
  // with the zone's colour swatch. Hidden on mobile via CSS.
  function paintWaitingHead(){
    if(!els.waitingWk) return;
    var wo = liveState.workout;
    if(!wo){ els.waitingWk.textContent = ''; if(els.waitingMetaText) els.waitingMetaText.textContent = ''; return; }
    els.waitingWk.textContent = wo.name;
    var z = ZONES[wo.zone];
    if(els.waitingSw) els.waitingSw.style.background = (z && z.hex) || 'var(--text-dim)';
    var bits = [];
    if(z) bits.push(z.label);
    if(wo.durationMin != null) bits.push(wo.durationMin + ' min');
    if(wo.tss != null) bits.push('TSS ' + wo.tss);
    if(els.waitingMetaText) els.waitingMetaText.textContent = bits.join('  ·  ');
  }

  // The FTP row on the waiting screen. Reads as a warning until it's set,
  // because without it the player has no watt targets to hold.
  function paintWaitingFtp(){
    var row = document.getElementById('wdFtp');
    if(!row) return;
    var dot = document.getElementById('wdFtpDot');
    var text = document.getElementById('wdFtpText');
    var input = document.getElementById('wdFtpInput');
    var set = hasFtp();
    row.classList.toggle('unset', !set);
    row.classList.toggle('on', set);
    dot.className = 'device-dot' + (set ? ' on' : '');
    text.textContent = set ? 'FTP' : 'FTP not set — targets unavailable';
    if(document.activeElement !== input) input.value = set ? ftp : '';
  }

  function paintWaitingDevice(state, btn, text, label){
    btn.style.display = state.connected ? 'none' : '';
    text.textContent = state.busy ? 'Connecting\u2026' : state.reconnecting ? 'Reconnecting\u2026' : state.looking ? 'Looking\u2026' : label;
    btn.disabled = !!state.busy;
  }

  els.wdTrainerBtn.addEventListener('click', function(){ connectTrainer(); });
  els.wdHrBtn.addEventListener('click', function(){ connectHr(); });

  function pollPedalStart(){
    if(liveState.phase !== 'waiting') return;
    var cad = liveReadouts.cadence;
    var pw = liveReadouts.power;

    els.waitingCadence.textContent = cad !== null ? Math.round(cad) : '\u2014';
    els.waitingPower.textContent = pw !== null ? pw + ' W' : '\u2014';

    // Manual pause, legs still turning: wait for a real stop (~2 s) before
    // pedalling can bring the clock back. The chips stay unlit meanwhile —
    // green would promise a resume that isn't armed yet.
    if(!liveState.resumeArmed){
      liveState.stoppedMs = riderStopped() ? (liveState.stoppedMs || 0) + 250 : 0;
      if(liveState.stoppedMs < RESUME_ARM_MS){
        els.waitingCadenceChip.classList.remove('met');
        els.waitingPowerChip.classList.remove('met');
        return;
      }
      liveState.resumeArmed = true;
      els.waitingSub.textContent = waitingSubText();
    }

    var cadOk = cad !== null && cad > PEDAL_START.cadence;
    var pwOk = pw !== null && pw > PEDAL_START.power;
    els.waitingCadenceChip.classList.toggle('met', cadOk);
    els.waitingPowerChip.classList.toggle('met', pwOk);

    // Require both signals when the trainer sends both, but fall back to
    // whichever one it actually reports \u2014 plenty of trainers publish power
    // without cadence, and requiring both would leave those riders stuck here.
    var moving;
    if(cad !== null && pw !== null) moving = cadOk && pwOk;
    else if(cad !== null) moving = cadOk;
    else if(pw !== null) moving = pwOk;
    else moving = false;

    // Hold the threshold briefly so one stray packet can't trip the start.
    if(moving){
      liveState.pedalHoldMs += 250;
      if(liveState.pedalHoldMs >= PEDAL_START.holdMs) beginCountdown();
    } else {
      liveState.pedalHoldMs = 0;
    }
  }

  function beginCountdown(){
    if(liveState.phase !== 'waiting') return;
    liveState.phase = 'countdown';
    if(liveState.waitTimerId){ clearInterval(liveState.waitTimerId); liveState.waitTimerId = null; }

    var step = liveState.flat[liveState.idx] || liveState.flat[0];
    els.waitingIcon.style.display = 'none';
    // The readouts stay through the countdown: they're the rider's own live
    // numbers, and they're what flies into the player when it starts.
    els.waitingDevices.style.display = 'none';
    els.waitingTitle.textContent = liveState.armMode === 'resume' ? 'Picking up where you left off' : 'Here we go';
    els.waitingSub.textContent = (liveState.armMode === 'resume' ? 'Back to: ' : 'First up: ') + step.label +
      (step.pct !== null ? ' \u2014 ' + targetWatts(step) + ' W' : '');
    els.waitingCountdown.style.display = 'block';

    var n = PEDAL_START.countdownSec;
    els.waitingCountdown.textContent = n;
    beepTick();
    // Resuming: stop pedalling mid-count and it's called off, back to the
    // paused screen (already armed, since the rider has just stopped).
    if(liveState.armMode === 'resume'){
      var stoppedMs = 0;
      liveState.waitTimerId = setInterval(function(){
        if(liveState.phase !== 'countdown') return;
        stoppedMs = riderStopped() ? stoppedMs + 250 : 0;
        if(stoppedMs >= COUNTDOWN_ABORT_MS){
          clearArmTimers();
          armPedalStart('resume', liveState.armReason, true);
        }
      }, 250);
    }
    liveState.countdownId = setInterval(function(){
      n--;
      if(n <= 0){
        clearInterval(liveState.countdownId);
        liveState.countdownId = null;
        beepGo();
        if(liveState.armMode === 'resume') resumeWorkout(); else beginWorkout();
        return;
      }
      els.waitingCountdown.textContent = n;
      beepTick();
    }, 1000);
  }

  function clearArmTimers(){
    if(liveState.waitTimerId){ clearInterval(liveState.waitTimerId); liveState.waitTimerId = null; }
    if(liveState.countdownId){ clearInterval(liveState.countdownId); liveState.countdownId = null; }
  }

  // The handover from the waiting screen to the player. The cadence and power
  // numbers the rider has been watching fly to their cells in the live grid
  // while the overlay fades out underneath, so the two screens read as one
  // thing rather than a cut. Purely cosmetic: the clock and the player start
  // immediately; this just decorates the reveal.
  function dissolveWaiting(){
    var ov = els.liveWaiting;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var chipsShowing = els.waitingReadouts.style.display !== 'none';
    if(!chipsShowing || reduce){ ov.style.display = 'none'; return; }

    var pairs = [[els.waitingCadence, els.trCadence], [els.waitingPower, els.trPower]];
    var clones = [];
    pairs.forEach(function(p){
      var from = p[0].getBoundingClientRect(), to = p[1].getBoundingClientRect();
      if(!from.width || !to.width) return;
      var c = document.createElement('div');
      c.className = 'fly-num';
      c.textContent = p[0].textContent.replace(/\s*W$/, '');   // the cell shows the unit itself
      c.style.left = from.left + 'px'; c.style.top = from.top + 'px';
      c.style.width = from.width + 'px'; c.style.height = from.height + 'px';
      c.style.fontSize = getComputedStyle(p[0]).fontSize;
      c.style.color = getComputedStyle(p[0]).color;
      document.body.appendChild(c);
      var sx = to.height / from.height;   // text scales by height; width follows the glyphs
      var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      c.__to = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ')';
      clones.push(c);
    });
    // Source chips vanish the instant the clones exist, so nothing doubles up.
    els.waitingReadouts.style.visibility = 'hidden';
    ov.classList.add('dissolving');
    // rAF doesn't fire in a background tab, so if the page is hidden at this
    // moment the frame callback could run *after* the cleanup and leave the
    // overlay stuck transparent. The flag makes it a no-op once cleaned up.
    var done = false;
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      if(done) return;
      clones.forEach(function(c){ c.style.transform = c.__to; });
      ov.style.opacity = '0';
    }); });
    setTimeout(function(){
      done = true;
      clones.forEach(function(c){ if(c.parentNode) c.parentNode.removeChild(c); });
      ov.style.display = 'none';
      ov.style.opacity = '';
      ov.classList.remove('dissolving');
      els.waitingReadouts.style.visibility = '';
    }, 620);
  }

  function beginWorkout(){
    clearArmTimers();
    liveState.phase = 'running';
    liveState.paused = false;
    renderLivePlayer();          // the grid must be laid out before the numbers fly to it
    dissolveWaiting();

    // Anchor the session clock here, not when the window opened.
    liveState.clockOriginMs = now();
    liveState.pausedAccumMs = 0;
    liveState.pausedAtMs = 0;

    acquireWakeLock();
    renderLivePlayer();
    drawLiveChart();
    if(liveState.timerId) clearInterval(liveState.timerId);
    liveState.timerId = setInterval(tickLive, 250);
  }

  // Coming back from a pause: the clock must continue where it stopped, so the
  // whole paused stretch \u2014 including this re-arm and countdown \u2014 is discounted.
  function resumeWorkout(){
    clearArmTimers();
    liveState.phase = 'running';
    liveState.paused = false;
    liveState.pausedAccumMs += now() - liveState.pausedAtMs;
    renderLivePlayer();
    dissolveWaiting();

    if(trainerState.connected && trainerState.controlChar){
      startTrainer().then(applyCurrentTarget);
    }
    acquireWakeLock();
    renderLivePlayer();
    drawLiveChart();
  }

  els.waitingStartBtn.addEventListener('click', function(){
    initAudio();
    if(liveState.armMode === 'resume') resumeWorkout(); else beginWorkout();
  });
  // Cancel before the start throws the session away (no samples, no summary);
  // End from the paused overlay finishes it and shows the summary.
  els.waitingCancelBtn.addEventListener('click', function(){
    endWorkout(false);
  });

  function now(){
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  // How far through the current step we are, 0..1.
  function stepFraction(){
    var step = liveState.flat[liveState.idx];
    if(!step || !step.seconds) return 0;
    return (step.seconds - liveState.remaining) / step.seconds;
  }

  // The intensity multiplier for a given leg: Overall everywhere, times the
  // Rest trim on the recovery legs only.
  function factorFor(step){
    var f = liveState.workFactor;
    if(step && step.rest) f *= liveState.restFactor;
    return f;
  }

  // The training zone a %FTP target falls in — bands follow the app's own zone
  // palette (sweet spot included), not the Coggan power pies. Monotonic so a
  // single cutoff decides each zone.
  function zoneForPct(pct){
    if(pct === null || pct === undefined) return null;
    if(pct <= 55) return 'recovery';
    if(pct <= 75) return 'endurance';
    if(pct <= 87) return 'tempo';
    if(pct <= 94) return 'sweetspot';
    if(pct <= 105) return 'threshold';
    if(pct <= 120) return 'vo2';
    return 'anaerobic';
  }
  // Which zone colour a live block should use. Keeps the planned colour at 100%,
  // but when the Overall/Rest trims push the leg into a different zone it recolours
  // to match — a rest lifted from recovery into endurance turns blue, a sweet-spot
  // block pushed past threshold turns red, and so on.
  function blockZone(step, sf){
    if(!step || step.pct === null) return step && step.type;   // all-out legs keep their colour
    var ref = isRamp(step) ? Math.max(step.pct, step.pctEnd || step.pct) : step.pct;
    var base = zoneForPct(ref);
    var adj = zoneForPct(ref * sf);
    return (adj && adj !== base) ? adj : step.type;
  }

  // The watts actually being asked for right now, after the intensity
  // adjustment. On a ramp this moves continuously through the step.
  function targetWatts(step, frac){
    if(!step || step.pct === null) return null;
    var pct = isRamp(step) ? pctAt(step, frac === undefined ? stepFraction() : frac) : step.pct;
    return Math.round(watts(pct) * factorFor(step));
  }

  function applyCurrentTarget(){
    var step = liveState.flat[liveState.idx];
    if(!step) return;
    if(trainerState.connected && trainerState.controlChar && step.type !== 'test'){
      var w = targetWatts(step);
      setErgTarget(w);
      liveState.lastErgWatts = w;
    }
  }

  // Ramps need the ERG target rewritten as they climb. Only write when the
  // number actually moves, to avoid spamming the trainer's control point.
  var ERG_RAMP_STEP_W = 2;
  function updateRampTarget(){
    var step = liveState.flat[liveState.idx];
    if(!step || !isRamp(step)) return;
    if(!(trainerState.connected && trainerState.controlChar) || step.type === 'test') return;
    var w = targetWatts(step);
    if(w === null) return;
    if(liveState.lastErgWatts === null || Math.abs(w - liveState.lastErgWatts) >= ERG_RAMP_STEP_W){
      setErgTarget(w);
      liveState.lastErgWatts = w;
    }
  }

  // The ramp test's steps ARE the measurement: adjusting them mid-test would
  // move the failure point and invalidate the estimate.
  function intensityLocked(){
    return !!(liveState.workout && liveState.workout.test === 'ramp');
  }

  // Overall trim — scales every leg (the old single intensity control).
  function adjustOverall(deltaPct){
    if(!liveState.active || liveState.phase !== 'running') return;
    if(intensityLocked()) return;
    var next = Math.round(liveState.workFactor * 100) + deltaPct;
    next = Math.max(INTENSITY_MIN, Math.min(INTENSITY_MAX, next));
    if(next === Math.round(liveState.workFactor * 100)) return;
    liveState.workFactor = next / 100;
    applyCurrentTarget();
    renderLivePlayer();
    flashBlockWatts('all');
  }

  // Rest trim — an extra multiplier on the recovery legs only. If the current
  // leg is a recovery the ERG target moves right away; otherwise it lands on
  // the next recovery.
  function adjustRest(deltaPct){
    if(!liveState.active || liveState.phase !== 'running') return;
    if(intensityLocked()) return;
    var next = Math.round(liveState.restFactor * 100) + deltaPct;
    next = Math.max(REST_MIN, Math.min(REST_MAX, next));
    if(next === Math.round(liveState.restFactor * 100)) return;
    liveState.restFactor = next / 100;
    applyCurrentTarget();
    renderLivePlayer();
    flashBlockWatts('rest');
  }

  document.addEventListener('keydown', function(e){
    if(!liveState.active || liveState.phase !== 'running') return;
    if(e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      e.preventDefault();  // otherwise the page scrolls behind the player
      adjustOverall(e.key === 'ArrowUp' ? 1 : -1);
    }
  });
  // Touch-first trims: the +/- buttons nudge 1% at a time (arrows match for the
  // Overall control).
  if(els.intMinus) els.intMinus.addEventListener('click', function(){ adjustOverall(-1); });
  if(els.intPlus) els.intPlus.addEventListener('click', function(){ adjustOverall(1); });
  if(els.restMinus) els.restMinus.addEventListener('click', function(){ adjustRest(-1); });
  if(els.restPlus) els.restPlus.addEventListener('click', function(){ adjustRest(1); });

  // ---- readout layout (choosable via the display cog, remembered) ----
  var RAIL_LAYOUT_KEY = 'ftpPlan_railLayout_v1';
  // Each preset names its two hero cells plus the full left-to-right cell order
  // (heroes first on the top row, then the four quiet cells on the second row).
  var RAIL_LAYOUTS = {
    ic:   {heroes:['interval','cadence'], order:['interval','cadence','total','hr','target','power']},
    hc:   {heroes:['hr','cadence'],       order:['hr','cadence','interval','total','target','power']},
    ih:   {heroes:['interval','hr'],      order:['interval','hr','total','cadence','target','power']},
    even: {even:true}
  };
  function currentRailLayout(){
    var k; try{ k = localStorage.getItem(RAIL_LAYOUT_KEY); }catch(e){}
    return RAIL_LAYOUTS[k] ? k : 'ic';
  }
  function applyRailLayout(key){
    var cfg = RAIL_LAYOUTS[key] || RAIL_LAYOUTS.ic;
    if(els.trGrid){
      els.trGrid.classList.toggle('even', !!cfg.even);
      [].forEach.call(els.trGrid.querySelectorAll('.tr-cell'), function(c){
        var m = c.getAttribute('data-m');
        if(cfg.even){
          c.classList.remove('hero');
          c.style.removeProperty('--cell-order');
        } else {
          var idx = cfg.order.indexOf(m);
          // Set the order as a CSS var (not the order property) so the mobile
          // even-grid media query can still flatten it back to DOM order.
          if(idx >= 0){ c.style.setProperty('--cell-order', idx); }
          else { c.style.removeProperty('--cell-order'); }
          c.classList.toggle('hero', cfg.heroes.indexOf(m) >= 0);
        }
      });
    }
    if(els.layoutOpts){
      [].forEach.call(els.layoutOpts.querySelectorAll('.ls-opt'), function(b){
        b.classList.toggle('on', b.getAttribute('data-layout') === key);
      });
    }
    if(liveState.active){ setupLiveChartCanvas(); drawLiveChart(); }
  }
  function setRailLayout(key){
    if(!RAIL_LAYOUTS[key]) return;
    try{ localStorage.setItem(RAIL_LAYOUT_KEY, key); }catch(e){}
    applyRailLayout(key);
  }
  applyRailLayout(currentRailLayout());
  if(els.settingsBtn) els.settingsBtn.addEventListener('click', function(){ els.liveSettings.hidden = false; });

  // Full-screen toggle for the ride screen (the player element itself, so the
  // chart + readouts fill the display). Falls back silently if unsupported.
  function fsElement(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function syncFsBtn(){
    if(!els.liveFullscreenBtn) return;
    var on = fsElement() === els.livePlayer;
    els.liveFullscreenBtn.classList.toggle('is-fs', on);
    els.liveFullscreenBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  }
  if(els.liveFullscreenBtn){
    els.liveFullscreenBtn.addEventListener('click', function(){
      var el = els.livePlayer;
      try{
        var p;
        if(fsElement()){
          p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          var req = el.requestFullscreen || el.webkitRequestFullscreen;
          if(req) p = req.call(el);
        }
        if(p && p.catch) p.catch(function(){});   // rejected (blocked) — ignore
      }catch(e){ /* unsupported / blocked — leave the modal as-is */ }
    });
    document.addEventListener('fullscreenchange', syncFsBtn);
    document.addEventListener('webkitfullscreenchange', syncFsBtn);
  }
  if(els.settingsClose) els.settingsClose.addEventListener('click', function(){ els.liveSettings.hidden = true; });
  if(els.liveSettings) els.liveSettings.addEventListener('click', function(e){ if(e.target === els.liveSettings) els.liveSettings.hidden = true; });
  if(els.layoutOpts) els.layoutOpts.addEventListener('click', function(e){
    var b = e.target.closest('.ls-opt'); if(b) setRailLayout(b.getAttribute('data-layout'));
  });

  function tickLive(){
    if(!liveState.active || liveState.paused || liveState.phase !== 'running') return;
    // Catch the session clock up to wall time rather than assuming each tick
    // is exactly one second — one sample per elapsed second, no drift.
    var target = Math.floor((now() - liveState.clockOriginMs - liveState.pausedAccumMs) / 1000);
    var stepped = false;
    while(liveState.active && liveState.elapsedTotal < target){
      liveState.remaining--;
      liveState.elapsedTotal++;
      liveState.samples.push({
        // Recorded-seconds, not plan position: skipping a segment jumps
        // elapsedTotal so the chart playhead stays aligned with the planned
        // profile, but the recording itself must stay contiguous at 1 Hz or
        // the exported laps end up describing time that has no samples.
        t: (liveState.samples.length + 1) * 1000,
        // Plan position drives the chart's x-axis. It differs from `t` once a
        // segment is skipped, and using `t` there left the traces drifting
        // behind the playhead.
        p: liveState.elapsedTotal,
        power: liveReadouts.power,
        cadence: liveReadouts.cadence !== null ? Math.round(liveReadouts.cadence) : null,
        hr: liveReadouts.hr
      });
      stepped = true;
      if(liveState.remaining <= 0){
        advanceLiveStep();
      } else {
        // 3-2-1 into the next segment, then the "go" from advanceLiveStep.
        // Not on the final segment: nothing follows it.
        if(liveState.remaining <= 3 && liveState.idx < liveState.flat.length - 1) beepTick();
        if(liveState.workout && liveState.workout.test === 'ramp') checkRampFailure();
      }
      if(liveState.active && !liveState.paused && checkAutoPause()){
        pauseWorkout('auto');
        break;
      }
    }
    if(stepped && liveState.active){
      updateRampTarget();
      renderLivePlayer();
      drawLiveChart();
    }
  }

  // Auto-pause: the rider has stopped. Power at or under a few watts, or a
  // cadence of exactly zero, held for a few consecutive seconds — one stray
  // packet or a gear change shouldn't stop the clock. "Or" rather than "and"
  // because many trainers never report cadence at all.
  var AUTO_PAUSE = {power:5, holdSec:5, staleMs:3000};
  function checkAutoPause(){
    // Only trust readings that are actually arriving. A drop-out leaves the
    // last values frozen, and that's the reconnect loop's problem, not this.
    if(!trainerState.connected || now() - liveReadouts.trainerAtMs > AUTO_PAUSE.staleMs){
      liveState.idleSec = 0;
      return false;
    }
    // Stopping mid-ramp is a failed test, which checkRampFailure handles by
    // moving to the cool-down. Pausing there would let the rider rest and
    // carry on, which makes the result meaningless.
    var step = liveState.flat[liveState.idx];
    if(liveState.workout && liveState.workout.test === 'ramp' && step && /^Step /.test(step.label)){
      liveState.idleSec = 0;
      return false;
    }
    var pw = liveReadouts.power, cad = liveReadouts.cadence;
    var idle = (pw !== null && pw <= AUTO_PAUSE.power) || (cad !== null && cad === 0);
    if(pw === null && cad === null) idle = false;
    liveState.idleSec = idle ? (liveState.idleSec || 0) + 1 : 0;
    return liveState.idleSec >= AUTO_PAUSE.holdSec;
  }

  // Shared by the Pause button and auto-pause. The overlay is the paused
  // state: pedalling (or Resume now) brings the clock back, End finishes.
  function pauseWorkout(reason){
    if(!liveState.active || liveState.paused) return;
    liveState.paused = true;
    liveState.pausedAtMs = now();
    liveState.idleSec = 0;
    if(trainerState.connected && trainerState.controlChar) pauseTrainer();
    renderLivePlayer();
    armPedalStart('resume', reason);
  }

  // Ramp test: the rider "fails" when they can no longer hold the step. In
  // ERG the trainer keeps demanding the target, so failure shows as measured
  // power collapsing beneath it. Once the 5-second average has sat under
  // ~88% of target for several consecutive seconds, the ramp is over and the
  // session jumps straight to its cool-down. Same rule TrainerRoad and Zwift
  // use; End remains the manual fallback.
  var RAMP_FAIL = {ratio:0.88, holdSec:4, graceSec:8};
  function checkRampFailure(){
    var step = liveState.flat[liveState.idx];
    if(!step || !/^Step /.test(step.label)) { liveState.rampBelow = 0; return; }
    var into = step.seconds - liveState.remaining;
    if(into < RAMP_FAIL.graceSec) return;        // ERG takes a moment to settle at a new step
    var s = liveState.samples, n = s.length;
    var sum = 0, cnt = 0;
    for(var i = Math.max(0, n - 5); i < n; i++){
      if(s[i].power !== null){ sum += s[i].power; cnt++; }
    }
    if(cnt < 3) return;                           // no device data: can't judge
    var avg = sum / cnt;
    var target = targetWatts(step);
    if(avg < target * RAMP_FAIL.ratio) liveState.rampBelow = (liveState.rampBelow || 0) + 1;
    else liveState.rampBelow = 0;
    if(liveState.rampBelow >= RAMP_FAIL.holdSec){
      liveState.rampBelow = 0;
      liveState.rampFailedAtStep = step.label;
      // Jump to the cool-down (last step) rather than ending: the rider still
      // needs to spin down, and the summary then arrives the normal way.
      closeLap();
      var last = liveState.flat.length - 1;
      var cdStart = 0;
      for(var k = 0; k < last; k++) cdStart += liveState.flat[k].seconds;
      // Move the plan clock to the cool-down's start so the chart playhead
      // lands there; recorded samples are unaffected.
      liveState.clockOriginMs -= (cdStart - liveState.elapsedTotal) * 1000;
      liveState.elapsedTotal = cdStart;
      liveState.idx = last;
      liveState.remaining = liveState.flat[last].seconds;
      beepGo();
      applyCurrentTarget();
    }
  }

  // Close the segment that just finished as a lap. Zero-length laps are
  // dropped so cancelling from the waiting overlay doesn't record one.
  function closeLap(){
    var step = liveState.flat[liveState.idx];
    if(!step) return;
    // Boundaries are sample indices, so they always line up with the records
    // in the exported file even when segments are skipped.
    var start = liveState.lapStartSec;
    var end = liveState.samples.length;
    if(end > start){
      liveState.laps.push({start:start, end:end, label:step.label, type:step.type, pct:step.pct, prep:!!step.prep, work:!!step.work});
    }
    liveState.lapStartSec = end;
  }

  function advanceLiveStep(){
    closeLap();
    liveState.idx++;
    if(liveState.idx >= liveState.flat.length){
      endWorkout(true);
      return;
    }
    liveState.remaining = liveState.flat[liveState.idx].seconds;
    applyCurrentTarget();
    beepGo();          // new segment
  }

  function endWorkout(completed){
    // Ending early leaves the current segment open; a natural finish already
    // closed it in advanceLiveStep, where flat[idx] is now past the end.
    closeLap();
    if(liveState.timerId){ clearInterval(liveState.timerId); liveState.timerId = null; }
    if(liveState.waitTimerId){ clearInterval(liveState.waitTimerId); liveState.waitTimerId = null; }
    if(liveState.countdownId){ clearInterval(liveState.countdownId); liveState.countdownId = null; }
    liveState.phase = 'running';
    els.liveWaiting.style.display = 'none';
    releaseWakeLock();
    if(trainerState.connected && trainerState.controlChar){
      stopTrainer();
    }
    liveState.active = false;
    els.livePlayer.style.display = 'none';
    if(liveState.samples.length > 0){
      showSummary();
    }
  }

  function updateLiveReadoutsUI(){
    if(!liveState.active) return;
    els.trPower.textContent = liveReadouts.power !== null ? liveReadouts.power : '\u2014';
    els.trHr.textContent = liveReadouts.hr !== null ? liveReadouts.hr : '\u2014';
    els.trCadence.textContent = liveReadouts.cadence !== null ? Math.round(liveReadouts.cadence) : '\u2014';
    var step = liveState.flat[liveState.idx];
    if(step && step.pct !== null && liveReadouts.power !== null){
      var target = targetWatts(step);
      if(!target) target = 1;
      var frac = Math.max(0, Math.min(1.2, liveReadouts.power / target)) / 1.2;
      els.trPowerBar.style.transform = 'scaleX(' + frac.toFixed(3) + ')';
      els.trPowerBar.style.background = liveReadouts.power >= target * 0.95 && liveReadouts.power <= target * 1.05 ? 'var(--ok)' : 'var(--warn)';
    } else {
      els.trPowerBar.style.transform = 'scaleX(0)';
    }
  }

  function renderLivePlayer(){
    if(!liveState.active) return;
    var step = liveState.flat[liveState.idx];
    var next = liveState.flat[liveState.idx + 1];
    els.liveSegmentLabel.textContent = step.label;
    els.trIntervalTime.textContent = mmss(liveState.remaining);
    els.trTotalTime.textContent = mmss(liveState.elapsedTotal);

    var pctShown = Math.round(liveState.workFactor * 100);
    var intLocked = intensityLocked();
    if(step.pct === null){
      els.trTarget.textContent = 'All-out';
      els.liveTestNote.style.display = 'block';
    } else {
      // On a ramp, show where the target is heading as well as where it is.
      els.trTarget.textContent = isRamp(step)
        ? targetWatts(step) + ' → ' + Math.round(watts(step.pctEnd) * factorFor(step))
        : '' + targetWatts(step);
      els.liveTestNote.style.display = 'none';
    }
    // Overall stepper: the value sits between the +/- buttons; locked on tests
    // and on free-ride/all-out segments where a target multiplier is meaningless.
    els.trIntensity.textContent = intLocked ? 'Locked' : pctShown + '%';
    els.trIntensity.classList.toggle('adj', pctShown !== 100 && !intLocked);
    els.liveIntensity.classList.toggle('locked', intLocked || step.pct === null);
    // Rest stepper: only shown when the workout actually has recovery legs to
    // trim; locked alongside the Overall control on tests.
    if(els.liveRest){
      els.liveRest.style.display = liveState.hasRest ? '' : 'none';
      var restPct = Math.round(liveState.restFactor * 100);
      els.trRest.textContent = intLocked ? 'Locked' : restPct + '%';
      els.trRest.classList.toggle('adj', restPct !== 100 && !intLocked);
      els.liveRest.classList.toggle('locked', intLocked);
    }

    // Coaching cue for this segment. Re-inserting the node restarts the
    // fade-in, so a new cue is noticed even when the text is similar.
    var cue = step.cue || '';
    if(cue !== liveState.shownCue){
      liveState.shownCue = cue;
      els.liveCue.style.display = cue ? 'block' : 'none';
      els.liveCue.textContent = cue;
      if(cue){ var parent = els.liveCue.parentNode; parent.insertBefore(els.liveCue, els.liveCue.nextSibling); }
    }

    updateLiveReadoutsUI();
    updateLiveAverages();

    els.liveNext.textContent = next ? ('Next: ' + next.label + ' \u2014 ' + fmtMin(next.seconds / 60)) : 'Last segment \u2014 nice work';
    els.livePauseBtn.textContent = liveState.paused ? 'Resume' : 'Pause';
  }

  // Ride-so-far averages for the line beside the steppers. Power is the plain
  // mean of every recorded second; cadence drops coasting zeros (they'd drag
  // it down); HR is a straight mean. Built from the recorded samples, which
  // the target trims never touch, so they read true to what was ridden.
  function updateLiveAverages(){
    if(!els.avgPower) return;
    var s = liveState.samples, pS = 0, pC = 0, hS = 0, hC = 0, cS = 0, cC = 0;
    for(var i = 0; i < s.length; i++){
      var x = s[i];
      if(x.power != null){ pS += x.power; pC++; }
      if(x.hr != null){ hS += x.hr; hC++; }
      if(x.cadence != null && x.cadence > 0){ cS += x.cadence; cC++; }
    }
    els.avgPower.textContent = pC ? Math.round(pS / pC) + ' W' : '\u2014';
    els.avgHr.textContent    = hC ? Math.round(hS / hC) + ' bpm' : '\u2014';
    els.avgCad.textContent   = cC ? Math.round(cS / cC) + ' rpm' : '\u2014';
  }

  els.livePauseBtn.addEventListener('click', function(){
    if(!liveState.paused){
      pauseWorkout('manual');
    } else {
      // Only reachable if the overlay was somehow dismissed: re-arm it.
      armPedalStart('resume', 'manual');
    }
  });
  els.liveSkipBtn.addEventListener('click', function(){
    // Skipping shortens the session, so pull the clock origin forward by the
    // remaining seconds instead of letting tickLive replay them.
    if(liveState.remaining > 0){
      liveState.clockOriginMs -= liveState.remaining * 1000;
      liveState.elapsedTotal += liveState.remaining;
      liveState.remaining = 0;
    }
    advanceLiveStep();
    if(liveState.active){
      renderLivePlayer();
      drawLiveChart();
    }
  });
  els.liveEndBtn.addEventListener('click', function(){
    if(confirm('End this workout early? Progress won\u2019t be marked complete, but you can still export what you recorded.')){
      endWorkout(false);
    }
  });

  // ---- live chart (planned profile + live power/HR/cadence overlay) ----
  function setupLiveChartCanvas(){
    try{
      var canvas = els.liveChartCanvas;
      var ctx = canvas.getContext('2d');
      if(!ctx) return;
      var dpr = window.devicePixelRatio || 1;
      var wrap = canvas.parentElement;
      var cs = getComputedStyle(wrap);
      var cssW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // The chart takes whatever vertical space is left once the readouts and
      // controls have theirs, so the player always fits without scrolling.
      var cssH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if(!(cssW > 0)) cssW = 600;
      if(!(cssH > 0)) cssH = 160;
      cssH = Math.max(90, cssH);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._cssWidth = cssW;
      canvas._cssHeight = cssH;
    }catch(e){ console.log('Chart canvas setup skipped:', e.message); }
  }

  // Blocks on canvas match the CSS ones: 4 px rounded shoulders on flat
  // steps (ramps stay sharp — a sloped top with round corners looks melted)
  // and a light-to-dark fill. `alpha` dims ridden blocks on the live chart.
  function lightenHex(hex, mixWhite){
    if(typeof hex !== 'string' || hex.charAt(0) !== '#') hex = '#454C60';
    var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    r = Math.round(r + (255 - r) * mixWhite); g = Math.round(g + (255 - g) * mixWhite); b = Math.round(b + (255 - b) * mixWhite);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  // Minimal look: a soft zone tint (low-alpha fill composited over the chart
  // background, so it reads as a pale tint in light and a dark tint in dark)
  // with a stronger same-hue top edge naming the zone. `alpha` dims ridden blocks.
  function paintBlock(ctx, hex, x, w, yTopL, yTopR, H, alpha, radius){
    var top = Math.min(yTopL, yTopR), r = Math.min(radius, w / 2);
    function path(){
      ctx.beginPath();
      if(yTopL === yTopR && r > 0){
        ctx.moveTo(x, H); ctx.lineTo(x, top + r); ctx.arcTo(x, top, x + r, top, r);
        ctx.lineTo(x + w - r, top); ctx.arcTo(x + w, top, x + w, top + r, r); ctx.lineTo(x + w, H);
      } else {
        ctx.moveTo(x, H); ctx.lineTo(x, yTopL); ctx.lineTo(x + w, yTopR); ctx.lineTo(x + w, H);
      }
      ctx.closePath();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hexToRgba(hex, 0.34);
    path(); ctx.fill();
    ctx.strokeStyle = hexToRgba(hex, 0.88);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + (r ? r * 0.4 : 0), yTopL); ctx.lineTo(x + w - (r ? r * 0.4 : 0), yTopR); ctx.stroke();
    ctx.restore();
  }

  function hexToRgba(hex, alpha){
    // An unrecognised zone should draw a grey block, not abort the whole chart.
    if(typeof hex !== 'string' || hex.charAt(0) !== '#'){
      console.warn('No colour for zone, falling back to grey:', hex);
      hex = '#454C60';
    }
    var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Shared by the planned blocks and the live power line so the two use one
  // vertical scale — a power reading on target sits exactly on top of its block.
  // The hardest block in a workout fills this much of the frame; everything
  // else scales in proportion beneath it.
  var CHART_TOP_FRAC = 0.85;
  var CHART_BASE_PX = 14;

  function pctToBarH(pct, H){
    var maxPct = liveState.chartMaxPct || SCALE_MAX_PCT;
    var hFrac = pct === null ? 1 : Math.max(0, Math.min(1, (pct - SCALE_MIN_PCT) / (maxPct - SCALE_MIN_PCT)));
    return CHART_BASE_PX + hFrac * (H * CHART_TOP_FRAC - CHART_BASE_PX);
  }

  // Trailing moving average. Nulls stay null so gaps in the data stay gaps in
  // the line rather than being bridged with a straight segment.
  function smoothSeries(samples, key, win){
    var out = [], q = [], sum = 0;
    for(var i = 0; i < samples.length; i++){
      var v = samples[i][key];
      if(v === null || v === undefined){ out.push(null); continue; }
      q.push(v); sum += v;
      if(q.length > win) sum -= q.shift();
      out.push(sum / q.length);
    }
    return out;
  }

  // Sticky ranges: they widen to fit the data but never narrow, so the line
  // doesn't rescale and jump around every time a new min or max arrives.
  function stickyRange(store, key, values, floorLo, floorHi, pad){
    var r = store[key];
    if(!r) r = store[key] = {lo:floorLo, hi:floorHi};
    for(var i = 0; i < values.length; i++){
      var v = values[i];
      if(v === null) continue;
      if(v - pad < r.lo) r.lo = Math.floor((v - pad) / 5) * 5;
      if(v + pad > r.hi) r.hi = Math.ceil((v + pad) / 5) * 5;
    }
    return r;
  }

  // Draws through midpoints with quadratic curves — takes the hard corners off
  // a 1 Hz trace without meaningfully moving the data.
  function strokeSeries(ctx, samples, vals, W, H, total, color, width, alpha, mapY){
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    var pts = [];
    for(var i = 0; i < vals.length; i++){
      if(vals[i] === null){ continue; }
      pts.push({x:(samples[i].p / total) * W, y:mapY(vals[i])});
    }
    if(pts.length < 2){ ctx.restore(); return; }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(var j = 1; j < pts.length - 1; j++){
      var mx = (pts[j].x + pts[j + 1].x) / 2;
      var my = (pts[j].y + pts[j + 1].y) / 2;
      ctx.quadraticCurveTo(pts[j].x, pts[j].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawLiveChart(){
    if(!liveState.active) return;
    try{
      var canvas = els.liveChartCanvas;
      if(!canvas._cssWidth) setupLiveChartCanvas();
      if(!canvas._cssWidth) return;
      var ctx = canvas.getContext('2d');
      if(!ctx) return;
      var W = canvas._cssWidth, H = canvas._cssHeight;
      ctx.clearRect(0, 0, W, H);

      var total = liveState.totalSeconds;
      var samples = liveState.samples;

      // Let the shared power scale grow if the rider goes above the planned
      // ceiling, so spikes aren't clipped flat. Blocks and line move together,
      // so they stay aligned. Never shrinks mid-workout.
      // 99th percentile rather than the outright max: a short sprint shouldn't
      // rescale the whole chart and squash every block: it clips a little
      // instead. Capped so a bad reading can't flatten everything either.
      var pw99 = 0;
      var pwr = [];
      for(var i = 0; i < samples.length; i++){
        if(samples[i].power !== null) pwr.push(samples[i].power);
      }
      if(pwr.length){
        pwr.sort(function(a, b){ return a - b; });
        pw99 = pwr[Math.min(pwr.length - 1, Math.floor(pwr.length * 0.99))];
      }
      var pkPct = ftp > 0 ? (pw99 / ftp) * 100 : 0;
      var needed = Math.min(160, Math.ceil((pkPct + 6) / 5) * 5);
      if(!liveState.chartMaxPct) liveState.chartMaxPct = SCALE_MAX_PCT;
      if(needed > liveState.chartMaxPct) liveState.chartMaxPct = needed;

      var wattTags = [];
      var cum = 0;
      liveState.flat.forEach(function(step){
        var segStart = cum, segEnd = cum + step.seconds;
        cum = segEnd;
        var x0 = (segStart / total) * W, x1 = (segEnd / total) * W;
        var w = Math.max(1, x1 - x0 - 1);
        // Blocks reflect the intensity the rider is actually holding, so the
        // power line still lines up after an intensity adjustment.
        // Solid ahead of the playhead, faded once ridden — so what's still to
        // come is the bright part of the chart.
        var isPast = segEnd <= liveState.elapsedTotal;
        var alpha = isPast ? 0.22 : 1;
        var sf = factorFor(step);
        // Colour by the zone the (trimmed) target actually lands in, so the
        // intensity adjusters recolour the blocks, not just resize them.
        var zHex = ZONE_HEX[blockZone(step, sf)] || ZONE_HEX[step.type];
        var topY;
        if(isRamp(step)){
          // Trapezoid: the top edge slopes from the start power to the end.
          var yA = H - pctToBarH(step.pct * sf, H);
          var yB = H - pctToBarH(step.pctEnd * sf, H);
          paintBlock(ctx, zHex, x0, w, yA, yB, H, alpha, 4);
          topY = Math.min(yA, yB);
        } else {
          var shown = step.pct === null ? null : step.pct * sf;
          var yT = H - pctToBarH(shown, H);
          paintBlock(ctx, zHex, x0, w, yT, yT, H, alpha, 4);
          topY = yT;
        }
        // Collected for the transient watt tags (drawn on top, below).
        if(step.pct !== null){
          var pctForW = isRamp(step) ? Math.max(step.pct, step.pctEnd || step.pct) : step.pct;
          wattTags.push({cx:(x0 + x1) / 2, bw:x1 - x0, y:topY, w:Math.round(watts(pctForW) * sf), past:isPast, rest:!!step.rest});
        }
      });

      // FTP reference line, so the power trace can be read against 100%.
      var ftpY = H - pctToBarH(100, H);
      ctx.save();
      ctx.strokeStyle = 'rgba(' + CHART.ink + ',0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, ftpY);
      ctx.lineTo(W, ftpY);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = 'rgba(' + CHART.ink + ',0.34)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'right';
      // Right-aligned: the left edge is where the first block starts, and the
      // label sat on top of the trace there.
      if(hasFtp()) ctx.fillText('FTP ' + ftp + 'W', W - 4, ftpY - 4);
      ctx.restore();

      var px = (liveState.elapsedTotal / total) * W;
      ctx.strokeStyle = 'rgba(' + CHART.ink + ',0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();

      if(!liveState.ranges) liveState.ranges = {};

      // Cadence and HR get their own sticky ranges; power shares the block scale.
      // Cadence is the least important of the three, so it's smoothed hardest
      // and drawn faintest — it should read as context, not compete with power.
      // Cadence rides in a compressed band low in the chart rather than
      // spanning the full height — so it reads as quiet context at the foot of
      // the plot instead of crossing the HR trace and the interval block tops.
      var CAD_BAND = 0.30, CAD_FLOOR = 8;   // band height as a fraction of H; px off the bottom
      var cadVals = smoothSeries(samples, 'cadence', SMOOTH_CADENCE);
      var cadR = stickyRange(liveState.ranges, 'cad', cadVals, 50, 110, 3);
      strokeSeries(ctx, samples, cadVals, W, H, total, CHART.cadence, 1.3, CADENCE_LINE_ALPHA, function(v){
        return H - CAD_FLOOR - ((v - cadR.lo) / (cadR.hi - cadR.lo)) * (H * CAD_BAND);
      });

      var pwrVals = smoothSeries(samples, 'power', SMOOTH_POWER);
      strokeSeries(ctx, samples, pwrVals, W, H, total, CHART.power, 1.9, 0.95, function(v){
        return H - pctToBarH(ftp > 0 ? (v / ftp) * 100 : 0, H);
      });

      var hrVals = smoothSeries(samples, 'hr', SMOOTH_HR);
      var hrR = stickyRange(liveState.ranges, 'hr', hrVals, 100, 170, 4);
      strokeSeries(ctx, samples, hrVals, W, H, total, HR_LINE_COLOR, 1.8, 0.95, function(v){
        return H - 6 - ((v - hrR.lo) / (hrR.hi - hrR.lo)) * (H - 12);
      });

      // Transient watt tags above each block while the intensity trims are being
      // used — they show the wattage each leg is now asking for, then fade out.
      var flashMs = (liveState.wattsFlashUntil || 0) - Date.now();
      if(flashMs > 0 && hasFtp() && wattTags.length){
        var fade = Math.min(1, flashMs / 300);     // ease out over the final 300ms
        ctx.save();
        ctx.font = '600 10px ui-monospace, "SF Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        var restOnly = liveState.wattsFlashScope === 'rest';
        wattTags.forEach(function(t){
          if(restOnly && !t.rest) return;          // Rest trim: label only the recovery legs
          // Width guard stops neighbouring tags colliding; rest legs are narrow
          // but sparse (work legs carry no tag in this mode), so relax it there.
          if(t.bw < (restOnly ? 6 : 24)) return;
          var label = t.w + 'W';
          var tw = ctx.measureText(label).width;
          var ty = Math.max(12, t.y - 5);
          var a = fade * (t.past ? 0.4 : 1);       // ridden legs dimmer
          ctx.globalAlpha = a * 0.9;               // paper chip for legibility
          ctx.fillStyle = 'rgba(' + (CHART.paper || '255,255,255') + ',0.9)';
          roundRect(ctx, t.cx - tw / 2 - 5, ty - 11, tw + 10, 14, 4);
          ctx.fill();
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(' + CHART.ink + ',0.92)';
          ctx.fillText(label, t.cx, ty);
        });
        ctx.restore();
      }
    }catch(e){ console.error('Chart draw failed:', e); }
  }

  // Keeps the watt tags visible (and animating their fade) for a beat after the
  // last intensity tap, then does one clean redraw to clear them.
  var wattsFlashRaf = null;
  function flashBlockWatts(scope){
    liveState.wattsFlashScope = scope || 'all';   // 'rest' labels only the recovery legs
    liveState.wattsFlashUntil = Date.now() + 1600;
    if(wattsFlashRaf) return;
    var step = function(){
      drawLiveChart();
      if(liveState.active && Date.now() < liveState.wattsFlashUntil){
        wattsFlashRaf = requestAnimationFrame(step);
      } else {
        wattsFlashRaf = null;
        if(liveState.active) drawLiveChart();
      }
    };
    wattsFlashRaf = requestAnimationFrame(step);
  }

  window.addEventListener('resize', function(){
    if(liveState.active){ setupLiveChartCanvas(); drawLiveChart(); }
  });
  // The chart wrap can change size without a window resize — the modal height
  // settling, the readout rail rewrapping — which left the canvas taller than
  // its box, so blocks overflowed the chart and spilled onto the "next" line.
  // Lock the canvas to the wrap so it always fits exactly.
  if(window.ResizeObserver && els.liveChartCanvas && els.liveChartCanvas.parentElement){
    new ResizeObserver(function(){
      if(liveState.active){ setupLiveChartCanvas(); drawLiveChart(); }
    }).observe(els.liveChartCanvas.parentElement);
  }

  // ---- workout summary ----
  function computeSummary(samples){
    var powers = samples.map(function(s){ return s.power; }).filter(function(v){ return v !== null && v !== undefined; });
    var hrs = samples.map(function(s){ return s.hr; }).filter(function(v){ return v !== null && v !== undefined; });
    var cads = samples.map(function(s){ return s.cadence; }).filter(function(v){ return v !== null && v !== undefined; });
    function avg(arr){ return arr.length ? Math.round(arr.reduce(function(a,b){ return a+b; }, 0) / arr.length) : null; }
    function mx(arr){ return arr.length ? Math.round(Math.max.apply(null, arr)) : null; }
    var np = null;
    if(powers.length >= 30){
      var rolling = [];
      for(var i = 0; i < powers.length; i++){
        var start = Math.max(0, i - 29);
        var win = powers.slice(start, i + 1);
        var wAvg = win.reduce(function(a,b){ return a+b; }, 0) / win.length;
        rolling.push(Math.pow(wAvg, 4));
      }
      var meanQuad = rolling.reduce(function(a,b){ return a+b; }, 0) / rolling.length;
      np = Math.round(Math.pow(meanQuad, 0.25));
    }
    var avgP = avg(powers);
    var kj = avgP !== null ? Math.round(avgP * samples.length / 1000) : null;
    // Training stress from normalised power against the FTP ridden at.
    var f = rideFtp(), IF = (np !== null && f) ? np / f : null;
    var tss = IF !== null ? Math.round(samples.length / 3600 * IF * IF * 100) : null;
    return {duration:samples.length, avgPower:avgP, maxPower:mx(powers), np:np,
            avgHr:avg(hrs), maxHr:mx(hrs), avgCadence:avg(cads), maxCadence:mx(cads), kj:kj,
            IF:IF !== null ? Math.round(IF * 100) / 100 : null, tss:tss};
  }

  // ---- time-in-zone pies ----
  // Power against the Coggan seven at the FTP ridden; HR against % of max.
  // Solid slices with percentages, and one slice pushed out: the workout's
  // focus zone for power, the zone with the most time for HR.
  var POWER_PIE_ZONES = [
    {z:'Z1', label:'Recovery',      hi:55,  key:'recovery'},
    {z:'Z2', label:'Endurance',     hi:75,  key:'endurance'},
    {z:'Z3', label:'Tempo',         hi:90,  key:'tempo'},
    {z:'Z4', label:'Threshold',     hi:105, key:'threshold'},
    {z:'Z5', label:'VO\u2082max',        hi:120, key:'vo2'},
    {z:'Z6', label:'Anaerobic',     hi:150, key:'anaerobic'},
    {z:'Z7', label:'Neuromuscular', hi:null, key:'anaerobic', color:'#FF3B30'}
  ];
  function powerZoneIndex(w){
    var f = rideFtp();
    if(w === null || w === undefined || !f) return -1;
    var pct = w / f * 100;
    for(var i = 0; i < POWER_PIE_ZONES.length; i++){ if(POWER_PIE_ZONES[i].hi === null || pct <= POWER_PIE_ZONES[i].hi + 0.5) return i; }
    return POWER_PIE_ZONES.length - 1;
  }
  // Which Coggan zone a workout's focus maps to. Sweet spot straddles Z3/Z4,
  // so it takes whichever of the two got more time.
  function focusZoneIndex(wo, secs){
    if(!wo || wo.test) return -1;
    var map = {recovery:0, endurance:1, tempo:2, threshold:3, vo2:4, anaerobic:5};
    if(wo.zone === 'sweetspot') return secs[2] >= secs[3] ? 2 : 3;
    return map[wo.zone] !== undefined ? map[wo.zone] : -1;
  }

  // The summary pies are canvases painted by the same drawPie3d the exported
  // image uses, so the two always agree and there's only one pie renderer.
  // Specs are collected while the cards are built, then painted once the HTML
  // is in the document.
  var summaryPieSpecs = [];
  var PIE_CV_W = 200, PIE_CV_H = 128;
  function paintSummaryPies(){
    var cvs = els.summaryPies.querySelectorAll('canvas.pie-cv');
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    summaryPieSpecs.forEach(function(spec, i){
      var cv = cvs[i];
      if(!cv) return;
      cv.width = Math.round(PIE_CV_W * dpr);
      cv.height = Math.round(PIE_CV_H * dpr);
      cv.style.width = PIE_CV_W + 'px';
      cv.style.height = PIE_CV_H + 'px';
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPie3d(ctx, PIE_CV_W / 2, 54, 82, 45, 16, spec.slices, spec.total, spec.focus);
    });
  }
  function pieKey(slices, popIdx){
    return '<div class="pie-key">' + slices.map(function(s, i){
      if(!s.sec) return '';
      var name = s.z + ' ' + s.label;
      return '<span><i style="background:' + s.color + '"></i>' + (i === popIdx ? '<b>' + name + '</b>' : name) + '</span>';
    }).join('') + '</div>';
  }

  // Time-in-zone as the typographic bar list (same style as the calendar's HR
  // chart): swatch · code · name · ink bar sized to share · %, with the dominant
  // (focus) zone picked out in its own colour.
  function zoneBarsHtml(slices, total, popIdx){
    if(total <= 0) return '';
    var rows = slices.map(function(s, i){
      var frac = s.sec / total, pct = Math.round(frac * 100);
      var w = frac > 0 ? Math.max(2, frac * 100) : 0;
      return '<div class="hz-row' + (i === popIdx ? ' is-avg' : '') + (frac > 0 ? '' : ' zero') + '">' +
        '<span class="hz-lab"><i class="hz-sq" style="background:' + s.color + '"></i><b>' + s.z + '</b> <span class="hz-nm">' + s.label + '</span></span>' +
        '<span class="hz-bar"><span class="hz-fill" style="width:' + w + '%;--zc:' + s.color + '"></span></span>' +
        '<b class="hz-pct">' + pct + '%</b>' +
      '</div>';
    }).join('');
    return '<div class="dv-hrz"><div class="dv-hrz-rows">' + rows + '</div></div>';
  }

  function renderZonePies(){
    var samples = liveState.samples, wo = liveState.workout;
    if(!samples.length) return '';
    var pSecs = POWER_PIE_ZONES.map(function(){ return 0; }), hSecs = HR_ZONES.map(function(){ return 0; });
    var pTotal = 0, hTotal = 0;
    samples.forEach(function(s){
      var pi = powerZoneIndex(s.power); if(pi >= 0){ pSecs[pi]++; pTotal++; }
      var hi = hrZoneIndex(s.hr);       if(hi >= 0){ hSecs[hi]++; hTotal++; }
    });
    var cards = '';
    summaryPieSpecs = [];   // no canvases on-screen now (the export still uses drawPie3d)
    if(pTotal >= 60){
      var pSlices = POWER_PIE_ZONES.map(function(z, i){ return {z:z.z, label:z.label, sec:pSecs[i], color:z.color || ZONES[z.key].hex}; });
      var pPop = focusZoneIndex(wo, pSecs);
      if(pPop < 0 || !pSecs[pPop]) pPop = pSecs.indexOf(Math.max.apply(null, pSecs));
      var pTitle = 'Power zones' + (pPop >= 0 && wo && !wo.test ? ' \u00b7 focus ' + POWER_PIE_ZONES[pPop].label : '');
      cards += '<div class="pie-card"><h4>' + pTitle + '</h4>' + zoneBarsHtml(pSlices, pTotal, pPop) + '</div>';
    }
    if(hTotal >= 60 && rideMaxHr()){
      var hSlices = HR_ZONES.map(function(z, i){ return {z:z.z, label:z.label, sec:hSecs[i], color:z.color}; });
      var hPop = hSecs.indexOf(Math.max.apply(null, hSecs));
      cards += '<div class="pie-card"><h4>Heart rate zones \u00b7 max ' + rideMaxHr() + '</h4>' + zoneBarsHtml(hSlices, hTotal, hPop) + '</div>';
    }
    return cards;
  }
  function fmtRideDate(ms){
    var d = new Date(ms);
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours(), mm = d.getMinutes();
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear() + ', ' +
      ((h % 12) || 12) + ':' + (mm < 10 ? '0' : '') + mm + (h < 12 ? ' am' : ' pm');
  }

  // The same screen serves a ride that just finished and one reopened from
  // the log; `opts.fromLog` only changes the framing and which buttons show.
  function showSummary(opts){
    opts = opts || {};
    var stats = computeSummary(liveState.samples);
    els.summaryTitle.textContent = opts.fromLog ? 'Saved ride' : 'Workout complete';
    els.summaryWorkoutName.textContent = (liveState.workout ? liveState.workout.name : 'Live ride') +
      (liveState.startDateMs ? ' \u00b7 ' + fmtRideDate(liveState.startDateMs) : '');
    var chips = [
      {lab:'Duration', val: mmss(stats.duration)},
      {lab:'TSS', val: stats.tss !== null ? stats.tss : '\u2014'},
      {lab:'Avg Power', val: stats.avgPower !== null ? stats.avgPower + ' W' : '\u2014'},
      {lab:'Normalized Power', val: stats.np !== null ? stats.np + ' W' : '\u2014'},
      {lab:'Max Power', val: stats.maxPower !== null ? stats.maxPower + ' W' : '\u2014'},
      {lab:'Avg Heart Rate', val: stats.avgHr !== null ? stats.avgHr + ' bpm' : '\u2014'},
      {lab:'Max Heart Rate', val: stats.maxHr !== null ? stats.maxHr + ' bpm' : '\u2014'},
      {lab:'Avg Cadence', val: stats.avgCadence !== null ? stats.avgCadence + ' rpm' : '\u2014'},
      {lab:'Work', val: stats.kj !== null ? stats.kj + ' kJ' : '\u2014'}
    ];
    els.summaryGrid.innerHTML = chips.map(function(c){
      return '<div class="summary-chip"><span>' + c.lab + '</span><b>' + c.val + '</b></div>';
    }).join('');
    els.summaryPies.innerHTML = renderZonePies();
    paintSummaryPies();
    renderFtpEstimate();
    paintRpe();
    // Strava state for this ride: already synced (from the log, or earlier in
    // this session) shows the link; otherwise offer the sync. Not connected
    // yet? Connect and sync in one go — the ride is parked first, since the
    // consent round-trip reloads the page.
    var synced = !!liveState.stravaActivityId;
    els.summaryStravaBtn.style.display = synced ? 'none' : '';
    els.summaryStravaBtn.disabled = false;
    els.summaryStravaBtn.classList.remove('busy');
    els.summaryStravaText.textContent = stravaConnected() ? 'Sync to' : 'Connect & sync to';
    els.summaryStravaLink.style.display = synced ? '' : 'none';
    if(synced) els.summaryStravaLink.href = 'https://www.strava.com/activities/' + liveState.stravaActivityId;
    els.summaryStravaStatus.style.display = 'none';
    // Both cases can drop the ride: from the log it's a Delete, fresh off a ride
    // it's a Discard (the ride auto-saves on this screen, so discard removes it).
    els.summaryDeleteBtn.style.display = '';
    els.summaryDeleteBtn.textContent = opts.fromLog ? 'Delete ride' : 'Discard ride';
    els.summaryCloseBtn.textContent = opts.fromLog ? 'Close' : 'Save & close';
    liveState.summaryFromLog = !!opts.fromLog;
    els.summaryModal.style.display = 'flex';
    if(!opts.fromLog){ playFinishChime(); saveCurrentRide(); }   // celebrate a fresh finish, not a reopened ride
  }

  // ---- parked ride: survives the Strava consent round-trip ----
  var PENDING_RIDE_KEY = 'ftpPlan_pendingRide_v1';
  function stashRide(uploadIntent){
    try{
      localStorage.setItem(PENDING_RIDE_KEY, JSON.stringify({
        key: liveState.workout ? liveState.workout.key : null,
        startDateMs: liveState.startDateMs,
        samples: liveState.samples,
        laps: liveState.laps,
        ftp: liveState.ftp || null,
        maxHr: liveState.maxHr || null,
        rpe: liveState.rpe || null,
        savedId: liveState.savedId || null,
        upload: !!uploadIntent
      }));
    }catch(e){ console.log('Could not park the ride:', e && e.message); }
  }
  function clearStashedRide(){ try{ localStorage.removeItem(PENDING_RIDE_KEY); }catch(e){} }

  // Rebuild enough of liveState for the summary, exports and the image.
  function restoreStashedRide(){
    var s = null;
    try{ s = JSON.parse(localStorage.getItem(PENDING_RIDE_KEY)); }catch(e){}
    if(!s || !s.samples || !s.samples.length) return false;
    var wo = s.key ? byKey(s.key) : null;
    var flat = wo ? expandBlocks(wo.blocks).map(function(x){
      return {type:x.type, min:x.min, pct:x.pct, pctEnd:x.pctEnd, label:x.label, seconds:Math.round(x.min * 60)};
    }) : [];
    var peak = 0;
    flat.forEach(function(x){ if(x.pct !== null) peak = Math.max(peak, x.pct, x.pctEnd || 0); });
    liveState.workout = wo;
    liveState.flat = flat;
    liveState.totalSeconds = flat.reduce(function(a, x){ return a + x.seconds; }, 0) || s.samples.length;
    liveState.samples = s.samples;
    liveState.laps = s.laps || [];
    liveState.startDateMs = s.startDateMs;
    liveState.ftp = s.ftp || null;
    liveState.maxHr = s.maxHr || null;
    liveState.rpe = s.rpe || null;
    liveState.savedId = s.savedId || null;   // already in the log; don't save it twice
    liveState.stravaActivityId = null;
    liveState.workFactor = 1;
    liveState.restFactor = 1;
    liveState.hasRest = false;
    liveState.chartMaxPct = Math.max(105, Math.ceil((peak + 8) / 5) * 5);
    liveState.elapsedTotal = liveState.totalSeconds;
    liveState.active = false;
    showSummary();
    if(s.upload && stravaConnected()) stravaUpload();
    return true;
  }

  // ---- FTP estimate from a fitness test ----
  // Both formulas are the ones the mainstream platforms use: 95% of the
  // 20-minute average, or 75% of the best rolling minute on a ramp.
  function estimateFtp(){
    var wo = liveState.workout;
    if(!wo || !wo.test) return null;
    var s = liveState.samples, laps = liveState.laps;

    if(wo.test === 'ftp20'){
      var lap = laps.filter(function(l){ return l.type === 'test'; })[0];
      if(!lap) return {ok:false, why:'The 20-minute segment wasn’t reached.'};
      var vals = s.slice(lap.start, lap.end).map(function(x){ return x.power; }).filter(function(v){ return v !== null; });
      if(vals.length < 60) return {ok:false, why:'No power data was recorded during the test.'};
      var mins = (lap.end - lap.start) / 60;
      if(mins < 18) return {ok:false, why:'The test was cut short at ' + Math.round(mins) + ' minutes — it needs the full 20 for a reliable number.'};
      var avg = vals.reduce(function(a, b){ return a + b; }, 0) / vals.length;
      return {ok:true, ftp:Math.round(avg * 0.95), basis:'20-min average ' + Math.round(avg) + ' W × 0.95'};
    }

    if(wo.test === 'ramp'){
      // Best rolling 60 s across the ramp steps only (not warm-up or cool-down).
      var steps = laps.filter(function(l){ return /^Step /.test(l.label); });
      if(!steps.length) return {ok:false, why:'No ramp steps were completed.'};
      var from = steps[0].start, to = steps[steps.length - 1].end;
      var pw = s.slice(from, to).map(function(x){ return x.power; });
      var best = 0, sum = 0, cnt = 0, q = [];
      for(var i = 0; i < pw.length; i++){
        var v = pw[i] === null ? 0 : pw[i];
        q.push(v); sum += v; cnt++;
        if(q.length > 60){ sum -= q.shift(); cnt--; }
        if(q.length === 60) best = Math.max(best, sum / 60);
      }
      if(pw.filter(function(v){ return v !== null; }).length < 60) return {ok:false, why:'No power data was recorded during the ramp.'};
      if(best === 0) return {ok:false, why:'Not enough of the ramp was ridden to estimate.'};
      var reached = liveState.rampFailedAtStep || steps[steps.length - 1].label;
      return {ok:true, ftp:Math.round(best * 0.75), basis:'best 1-min ' + Math.round(best) + ' W × 0.75, reached ' + reached};
    }
    return null;
  }

  function renderFtpEstimate(){
    var est = estimateFtp();
    els.ftpEstimate.style.display = est ? 'block' : 'none';
    if(!est) return;
    if(!est.ok){
      els.ftpEstimate.innerHTML = '<div class="ftp-est-title">FTP estimate</div>' +
        '<p class="ftp-est-why">' + est.why + '</p>';
      return;
    }
    // No previous FTP to compare against on a first-ever test.
    var deltaStr;
    if(!hasFtp()){
      deltaStr = 'your first result';
    } else {
      var delta = est.ftp - ftp;
      deltaStr = delta === 0 ? 'unchanged' : (delta > 0 ? '+' : '') + delta + ' W from ' + ftp;
    }
    els.ftpEstimate.innerHTML =
      '<div class="ftp-est-title">Estimated FTP</div>' +
      '<div class="ftp-est-value">' + est.ftp + ' <span>W</span></div>' +
      '<p class="ftp-est-why">' + est.basis + ' · ' + deltaStr + '</p>' +
      '<button class="action-btn primary" id="applyFtpBtn">Set FTP to ' + est.ftp + ' W</button>';
    document.getElementById('applyFtpBtn').addEventListener('click', function(){
      ftp = est.ftp;
      try{ localStorage.setItem(FTP_KEY, String(ftp)); }catch(e){}
      els.ftpInput.value = ftp;
      render();
      this.textContent = 'FTP set to ' + ftp + ' W';
      this.disabled = true;
    });
  }

  // ---- first-run FTP prompt ----
  // Triggered by "we don't know your FTP", not by "first visit": the former is
  // a condition that self-heals across devices and stops the moment it's
  // answered, the latter is a flag that's wrong on every second browser.
  var INTRO_KEY = 'ftpPlan_introDone_v1';
  function introDismissed(){
    try{ return localStorage.getItem(INTRO_KEY) === '1'; }catch(e){ return false; }
  }
  function closeIntro(remember){
    document.getElementById('introModal').style.display = 'none';
    if(remember){ try{ localStorage.setItem(INTRO_KEY, '1'); }catch(e){} }
  }
  function maybeShowIntro(){
    if(hasFtp() || introDismissed()) return;
    var m = document.getElementById('introModal');
    if(!m || m.style.display === 'flex') return;
    // Name the actual ramp test so the button can't promise one that isn't there.
    var ramp = WORKOUTS.filter(function(w){ return w.test === 'ramp'; })[0];
    document.getElementById('introTestBtn').style.display = ramp ? '' : 'none';
    if(ramp) document.getElementById('introTestLen').textContent = ramp.durationMin + ' min';
    m.style.display = 'flex';
    setTimeout(function(){ document.getElementById('introFtp').focus(); }, 60);
  }
  document.getElementById('introSaveBtn').addEventListener('click', function(){
    var f = parseInt(document.getElementById('introFtp').value, 10);
    if(!(f >= 80 && f <= 500)){
      document.getElementById('introFtp').focus();
      return;
    }
    setFtp(f);
    var h = parseInt(document.getElementById('introHr').value, 10);
    if(h >= 120 && h <= 230) setMaxHr(h);
    closeIntro(true);
  });
  document.getElementById('introTestBtn').addEventListener('click', function(){
    var ramp = WORKOUTS.filter(function(w){ return w.test === 'ramp'; })[0];
    if(!ramp) return;
    closeIntro(true);
    selectWorkout(ramp.key, {scrollIntoView:true});
    startWorkout(ramp.key);
  });
  document.getElementById('introSkipBtn').addEventListener('click', function(){ closeIntro(true); });

  // FTP editable from the waiting screen, so a missing number doesn't mean
  // backing out of the player.
  document.getElementById('wdFtpInput').addEventListener('input', function(){
    var v = parseInt(this.value, 10);
    if(!(v >= 80 && v <= 500)) return;
    setFtp(v);
    paintWaitingFtp();
  });

  // Closing a ride opened from the log goes back to the log.
  function closeSummary(){
    els.summaryModal.style.display = 'none';
    clearStashedRide();   // the rider is done with it
    if(liveState.summaryFromLog){ liveState.summaryFromLog = false; reopenLog(); }
  }
  els.summaryCloseBtn.addEventListener('click', closeSummary);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && els.summaryModal.style.display !== 'none') closeSummary();
  });
  els.summaryDeleteBtn.addEventListener('click', function(){
    var msg = liveState.summaryFromLog
      ? 'Delete this ride from the log? This can’t be undone.'
      : 'Discard this ride? It won’t be saved.';
    if(!liveState.savedId || !confirm(msg)) return;
    rideDelete(liveState.savedId).then(function(){
      liveState.savedId = null;
      refreshDoneMarks();
      closeSummary();
    });
  });
  function exportBasename(){
    var nameSlug = (liveState.workout ? liveState.workout.name : 'ride').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var dateSlug = new Date(liveState.startDateMs).toISOString().slice(0, 10);
    return nameSlug + '-' + dateSlug;
  }

  els.summaryFitBtn.addEventListener('click', function(){
    var bytes = buildFitActivity(liveState.samples, liveState.startDateMs, liveState.laps);
    downloadBinary(bytes, exportBasename() + '.fit', 'application/octet-stream');
  });

  // ---- summary image ----
  // A 4:3 landscape PNG for Strava's timeline: hero name, the focus zone, the
  // effort ribbon, and two chunky time-in-zone pies. It gets shown around a
  // fifth of this size in the feed, so every type size here is set to survive
  // that rather than to look balanced at full resolution.
  var IMG_W = 2000, IMG_H = 1500;
  var IMG_SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
  var IMG_MONO = '"Cascadia Mono", "SF Mono", "Roboto Mono", Consolas, monospace';

  // Cuts a string down with an ellipsis until it fits the given width.
  function fitText(ctx, text, maxW){
    if(ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while(t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '…';
  }

  // A smoothed line through a series, x = plan position, plus an optional
  // gradient area beneath. Nulls break the line so gaps stay gaps.
  function ribbonPoints(samples, key, win, W, total, mapY){
    var sm = smoothSeries(samples, key, win), pts = [];
    for(var i = 0; i < sm.length; i++){
      if(sm[i] === null) continue;
      pts.push({x: (samples[i].p / total) * W, y: mapY(sm[i])});
    }
    return pts;
  }
  function ribbonPath(ctx, pts){
    ctx.moveTo(pts[0].x, pts[0].y);
    for(var j = 1; j < pts.length - 1; j++){
      var mx = (pts[j].x + pts[j + 1].x) / 2, my = (pts[j].y + pts[j + 1].y) / 2;
      ctx.quadraticCurveTo(pts[j].x, pts[j].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  // Brand blue, everywhere on the poster.
  var IMG_ACCENT = '#6E8BFF';        // focus slices, focus zone tag
  var IMG_BLOCK = '#6479E6';         // the power blocks: a tad darker than the accent
  var IMG_HR = '#FF453A';
  function imgMix(h1, h2, t){
    var a = h1.replace('#', ''), b = h2.replace('#', '');
    function ch(s, i){ return parseInt(s.slice(i, i + 2), 16); }
    var r = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
    var g = Math.round(ch(a, 2) + (ch(b, 2) - ch(a, 2)) * t);
    var bl = Math.round(ch(a, 4) + (ch(b, 4) - ch(a, 4)) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }

  // The effort plot: solid power blocks in the brand blue, on a floor, with
  // the Coggan zone bands behind for a y-axis, and the HR line over the top.
  // One colour, one shape — the pie below it is the same blue, so the big
  // slice reads as these blocks summed.
  function drawRibbon(ctx, ox, oy, W, H, focusZone){
    var total = liveState.totalSeconds, samples = liveState.samples;
    ctx.save();
    ctx.translate(ox, oy);

    // Power scale: 40% at the floor up to whatever the ride (or plan) peaked.
    var peak = 100;
    var f = rideFtp();
    samples.forEach(function(s){ if(s.power !== null) peak = Math.max(peak, s.power / f * 100); });
    liveState.flat.forEach(function(s){ if(s.pct !== null) peak = Math.max(peak, s.pct, s.pctEnd || 0); });
    var pmin = 40, pmax = Math.max(120, Math.ceil((peak + 8) / 5) * 5);
    function yPct(pct){ return H - Math.max(0, Math.min(1, (pct - pmin) / (pmax - pmin))) * H; }
    function pMap(w){ return yPct(f > 0 ? w / f * 100 : 0); }

    // Zone bands: hairlines at the boundaries, a tag at the left edge, the
    // focus zone's tag in the accent so axis, blocks and slice agree.
    ctx.font = '700 24px ' + IMG_SANS;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var lo = pmin;
    POWER_PIE_ZONES.forEach(function(z, i){
      var hi = z.hi === null ? pmax : Math.min(z.hi, pmax);
      if(hi <= lo) return;
      var y1 = yPct(hi), y0 = yPct(lo);
      if(i > 0){
        ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
      }
      if(y0 - y1 > 26){
        ctx.fillStyle = i === focusZone ? IMG_ACCENT : 'rgba(255,255,255,0.55)';
        ctx.fillText(z.z, -14, (y0 + y1) / 2);
      }
      lo = hi;
    });

    // The blocks, as a single shape so there are no seams at the edges.
    var pwr = ribbonPoints(samples, 'power', 25, W, total, pMap);
    if(pwr.length > 1){
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, imgMix(IMG_BLOCK, '#FFFFFF', 0.12));
      g.addColorStop(0.5, IMG_BLOCK);
      g.addColorStop(1, shadeHex(IMG_BLOCK, 0.68));
      ctx.beginPath(); ribbonPath(ctx, pwr);
      ctx.lineTo(pwr[pwr.length - 1].x, H); ctx.lineTo(pwr[0].x, H); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      // a light top edge, so the blocks read as lit solids like the pie faces
      ctx.beginPath(); ribbonPath(ctx, pwr);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    }

    // Floor: a baseline and a soft plinth, so the plot sits on the same ground
    // as the pies rather than dissolving into the background.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, H); ctx.stroke();
    var fl = ctx.createLinearGradient(0, H, 0, H + 56);
    fl.addColorStop(0, 'rgba(255,255,255,0.07)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fl; ctx.fillRect(0, H, W, 56);

    // HR on its own range, sitting in the upper band — the one signal colour.
    var hrs = samples.map(function(s){ return s.hr; }).filter(function(v){ return v !== null; });
    if(hrs.length > 30){
      var hlo = Math.min.apply(null, hrs) - 4, hhi = Math.max.apply(null, hrs) + 4;
      var hr = ribbonPoints(samples, 'hr', 15, W, total, function(v){ return H - 10 - ((v - hlo) / (hhi - hlo)) * (H - 20); });
      if(hr.length > 1){
        ctx.beginPath(); ribbonPath(ctx, hr);
        ctx.strokeStyle = IMG_HR; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      }
    }
    ctx.restore();
  }

  // The headline is the workout's structure with the percentages turned into
  // the rider's actual watts — "5 × 6 min @ 207 W" says more on a feed than
  // "@ 94%" does, and the name is on the Strava post already.
  function structureHeadline(wo){
    if(!wo) return '';
    var f = rideFtp();
    if(wo.test || !f) return wo.short || '';
    return String(wo.short || '').replace(/(\d+)%/g, function(m, p){ return Math.round(f * p / 100) + ' W'; });
  }

  // Letter-spaced centred text. Canvas has no tracking of its own, and the
  // subtitle needs it to read as a label rather than a word.
  function trackedText(ctx, text, cx, y, track){
    var chars = text.split('');
    var widths = chars.map(function(ch){ return ctx.measureText(ch).width; });
    var total = widths.reduce(function(a, b){ return a + b; }, 0) + track * (chars.length - 1);
    var x = cx - total / 2, prev = ctx.textAlign;
    ctx.textAlign = 'left';
    chars.forEach(function(ch, i){ ctx.fillText(ch, x, y); x += widths[i] + track; });
    ctx.textAlign = prev;
  }

  // Multiply a hex colour towards black (f<1) for the extruded pie wall.
  function shadeHex(hex, f){
    var c = String(hex).replace('#', '');
    if(c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = Math.round(parseInt(c.slice(0, 2), 16) * f);
    var g = Math.round(parseInt(c.slice(2, 4), 16) * f);
    var b = Math.round(parseInt(c.slice(4, 6), 16) * f);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // One elliptical disc of wedges. Used for both the extrusion and the top.
  function pieWedges(ctx, cx, cy, rx, ry, slices, total, colorFn){
    var a = -Math.PI / 2;
    slices.forEach(function(s, i){
      if(!s.sec) return;
      var frac = s.sec / total, a2 = a + frac * 2 * Math.PI;
      ctx.beginPath();
      if(frac >= 0.999){
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(cx, cy);
        ctx.ellipse(cx, cy, rx, ry, 0, a, a2);
        ctx.closePath();
      }
      ctx.fillStyle = colorFn(s, i);
      ctx.fill();
      a = a2;
    });
  }

  // A chunky 3D pie: the disc redrawn downwards in a darker shade builds the
  // side wall, then the lit top face goes over it. Drawing bottom-up means the
  // back of the extrusion is covered without any depth sorting.
  // `opts.tint` darkens the lit top face and `opts.gloss` sets the highlight
  // strength. The exported image dials both down so the pies don't outshout
  // the effort ribbon; the summary keeps them at full strength, where there's
  // no ribbon to compete with.
  function drawPie3d(ctx, cx, cy, rx, ry, depth, slices, total, focusIdx, opts){
    opts = opts || {};
    var tint = opts.tint != null ? opts.tint : 1;
    var gloss = opts.gloss != null ? opts.gloss : 0.22;
    for(var d = depth; d >= 1; d--){
      var f = (0.42 + 0.12 * (1 - d / depth)) * tint;
      pieWedges(ctx, cx, cy + d, rx, ry, slices, total, function(s){ return shadeHex(s.color, f); });
    }
    pieWedges(ctx, cx, cy, rx, ry, slices, total, function(s){
      return tint === 1 ? s.color : shadeHex(s.color, tint);
    });

    // Hairline between wedges, so neighbouring zones stay distinct.
    var a = -Math.PI / 2;
    ctx.strokeStyle = 'rgba(10,12,17,0.55)';
    ctx.lineWidth = Math.max(1, rx * 0.011);
    slices.forEach(function(s){
      if(!s.sec) return;
      var frac = s.sec / total, a2 = a + frac * 2 * Math.PI;
      if(frac < 0.999){
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
        ctx.stroke();
      }
      a = a2;
    });

    // Gloss: a soft highlight across the upper-left of the top face.
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
    var gl = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.4, cy + ry);
    gl.addColorStop(0, 'rgba(255,255,255,' + gloss + ')');
    gl.addColorStop(0.55, 'rgba(255,255,255,' + (gloss * 0.18).toFixed(3) + ')');
    gl.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = gl;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();

    // Labels are sized from the radius, so the same renderer serves the big
    // exported pie and the small one in the summary.
    var fPct = rx * 0.223, fZone = rx * 0.158, fOther = rx * 0.187;
    var a3 = -Math.PI / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Ink on the zone-coloured summary pies; white with a soft shadow on the
    // exported poster, where the slices are blue and slate.
    if(opts.whiteLabels){
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    } else {
      ctx.fillStyle = '#0A0C11';
    }
    slices.forEach(function(s, i){
      if(!s.sec){ return; }
      var frac = s.sec / total, a2 = a3 + frac * 2 * Math.PI, mid = (a3 + a2) / 2;
      var pct = Math.round(frac * 100);
      var lx = cx + rx * 0.58 * Math.cos(mid), ly = cy + ry * 0.58 * Math.sin(mid);
      if(i === focusIdx && pct >= 12){
        // The zone that matters gets the full readout.
        ctx.font = '800 ' + fPct.toFixed(1) + 'px ' + IMG_SANS;
        ctx.fillText(pct + '%', lx, ly - rx * 0.079);
        ctx.font = '800 ' + fZone.toFixed(1) + 'px ' + IMG_SANS;
        ctx.fillText(s.z, lx, ly + rx * 0.10);
      } else if(pct >= 6){
        // The rest name their zone rather than their share: the zone is the
        // useful fact, and "Z2" fits where a percentage would be tight.
        ctx.font = '800 ' + fOther.toFixed(1) + 'px ' + IMG_SANS;
        ctx.fillText(s.z, lx, ly);
      }
      a3 = a2;
    });
    ctx.restore();
  }

  // Heading, pie and a caption naming the dominant zone. `caption` is the
  // rider's own name for the effort (the workout's zone for power, the HR
  // zone's name for heart rate); the line under it says which Coggan zone
  // that landed in, so the two vocabularies meet instead of competing.
  function drawPieBlock(ctx, cx, cy, rx, ry, depth, heading, slices, total, focusIdx, opts, caption){
    // Ground shadow, so the pie sits the way the plot does.
    var gy = cy + depth + 12;
    var sh = ctx.createRadialGradient(cx, gy, 10, cx, gy, rx * 1.15);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(0, gy); ctx.scale(1, 0.32); ctx.translate(0, -gy);
    ctx.fillStyle = sh; ctx.fillRect(cx - rx * 1.3, gy - rx * 1.3, rx * 2.6, rx * 2.6);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7E869E';
    ctx.font = '700 38px ' + IMG_SANS;
    // Sits just above the top face. `depth` extrudes downwards, so it must not
    // be subtracted here — doing so pushed the heading up into the ribbon.
    trackedText(ctx, heading, cx, cy - ry - 48, 6);

    drawPie3d(ctx, cx, cy, rx, ry, depth, slices, total, focusIdx, opts);

    var f = slices[focusIdx];
    if(f && f.sec){
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#8FA6FF';
      ctx.font = '800 46px ' + IMG_SANS;
      trackedText(ctx, (caption || f.label).toUpperCase(), cx, cy + ry + depth + 90, 3);
      ctx.fillStyle = '#7E869E';
      ctx.font = '600 36px ' + IMG_SANS;
      trackedText(ctx, Math.round(f.sec / 60) + ' MIN IN ' + f.z, cx, cy + ry + depth + 140, 2);
    }
  }

  // ---- share image (the "Monolith" poster): chunky title, one effort plot,
  // big AVG/MAX HR + ride stats. The plot style is the rider's choice. ----
  var IMG_STYLE_KEY = 'ftpPlan_imgStyle_v1';
  var IMG_STYLES = ['bars', 'blocks', 'skyline', 'matrix'];
  function imgStyle(){ try{ var v = localStorage.getItem(IMG_STYLE_KEY); return IMG_STYLES.indexOf(v) >= 0 ? v : 'blocks'; }catch(e){ return 'blocks'; } }

  // Downsample the ride to N columns of normalised power (0..1 against an FTP
  // ceiling) and HR (0..1 against its own min/max). `work` flags the hard bins.
  function imgBins(samples, N, f){
    var n = samples.length, i, k, peak = 100;
    for(i = 0; i < n; i++){ if(samples[i].power != null) peak = Math.max(peak, samples[i].power / f * 100); }
    var pmax = Math.max(125, Math.ceil((peak + 8) / 5) * 5);
    var hrs = []; for(i = 0; i < n; i++){ if(samples[i].hr != null) hrs.push(samples[i].hr); }
    var hlo = hrs.length ? Math.min.apply(null, hrs) - 4 : 0, hhi = hrs.length ? Math.max.apply(null, hrs) + 4 : 1;
    var bins = [];
    for(i = 0; i < N; i++){
      var a = Math.floor(i / N * n), b = Math.max(a + 1, Math.floor((i + 1) / N * n)), ps = 0, pc = 0, hs = 0, hc = 0;
      for(k = a; k < b; k++){ var s = samples[k]; if(s){ if(s.power != null){ ps += s.power; pc++; } if(s.hr != null){ hs += s.hr; hc++; } } }
      var pctF = pc ? (ps / pc) / f * 100 : 0;
      bins.push({ p: Math.max(0, Math.min(1, (pctF - 18) / (pmax - 18))), hr: hc ? (hs / hc - hlo) / (hhi - hlo) : null, work: pctF >= 74 });
    }
    return bins;
  }

  function imgPlot(ctx, style, px, py, pw, ph, bins, accent){
    var N = bins.length, base = py + ph, A = accent, LINE = '#EFEDE6', DIM = '#2A2D36', i, k, c, r;
    function baseline(){ ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px + pw, base); ctx.stroke(); }
    function hrLine(){
      var any = false; for(i = 0; i < N; i++) if(bins[i].hr != null){ any = true; break; }
      if(!any) return;
      ctx.beginPath(); var started = false;
      for(i = 0; i < N; i++){ if(bins[i].hr == null) continue; var x = px + (i + 0.5) / N * pw, y = base - bins[i].hr * (ph - 26) - 14; if(!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      ctx.strokeStyle = LINE; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    }
    if(style === 'bars'){
      var bw = pw / N;
      for(i = 0; i < N; i++){ var bh = bins[i].p * ph; ctx.fillStyle = bins[i].work ? A : DIM; ctx.fillRect(px + i * bw, base - bh, Math.max(1, bw - 2), bh); }
      baseline(); hrLine();
    } else if(style === 'blocks'){
      ctx.fillStyle = '#15171F'; ctx.fillRect(px, base - ph * 0.5, pw, ph * 0.5);
      i = 0;
      while(i < N){ var j = i; while(j < N && bins[j].work === bins[i].work) j++; if(bins[i].work){ var mx = 0; for(k = i; k < j; k++) mx = Math.max(mx, bins[k].p); var bx = px + i / N * pw, bwn = (j - i) / N * pw, bhn = mx * ph; roundRect(ctx, bx + 6, base - bhn, Math.max(4, bwn - 12), bhn, 12); ctx.fillStyle = A; ctx.fill(); } i = j; }
      baseline(); hrLine();
    } else if(style === 'skyline'){
      ctx.beginPath(); ctx.moveTo(px, base);
      for(i = 0; i < N; i++) ctx.lineTo(px + i / (N - 1) * pw, base - bins[i].p * ph);
      ctx.lineTo(px + pw, base); ctx.closePath(); ctx.globalAlpha = 0.92; ctx.fillStyle = A; ctx.fill(); ctx.globalAlpha = 1;
      baseline(); hrLine();
    } else {   // matrix — an LED meter, HR as a bright dotted trace
      var cols = 58, rows = 15, cw = pw / cols, rh = ph / rows, rad = Math.min(cw, rh) * 0.3;
      for(c = 0; c < cols; c++){
        var bn = bins[Math.min(N - 1, Math.floor(c / cols * N))], fill = Math.round(bn.p * rows);
        for(r = 0; r < rows; r++){ var cy = base - rh * (r + 0.5), cx = px + cw * (c + 0.5); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fillStyle = r < fill ? (bn.work ? A : '#3A3F55') : '#181A22'; ctx.fill(); }
        if(bn.hr != null){ var hy = base - bn.hr * (ph - 26) - 14; ctx.beginPath(); ctx.arc(px + cw * (c + 0.5), hy, 9, 0, 6.2832); ctx.fillStyle = LINE; ctx.fill(); }
      }
    }
  }

  function buildSummaryImage(style){
    style = IMG_STYLES.indexOf(style) >= 0 ? style : imgStyle();
    var c = document.createElement('canvas'); c.width = IMG_W; c.height = IMG_H;
    var ctx = c.getContext('2d');
    var pad = 110, W = IMG_W - pad * 2;
    var samples = liveState.samples, wo = liveState.workout, f = rideFtp() || 250;
    var S = computeSummary(samples);
    var zone = (wo && wo.zone) || liveState.zone;
    var accent = (zone && !(wo && wo.test) && ZONES[zone] && ZONES[zone].hex) || IMG_ACCENT;

    ctx.fillStyle = '#0C0D10'; ctx.fillRect(0, 0, IMG_W, IMG_H);

    // Title — the ride's name, chunky; shrinks to fit the frame.
    ctx.fillStyle = '#F2F1EC'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var name = (wo ? wo.name : 'Indoor ride').toUpperCase();
    var ts = 196; ctx.font = '900 ' + ts + 'px "Arial Black", ' + IMG_SANS;
    while(ts > 92 && ctx.measureText(name).width > W){ ts -= 6; ctx.font = '900 ' + ts + 'px "Arial Black", ' + IMG_SANS; }
    ctx.fillText(fitText(ctx, name, W), pad, 332);

    // Effort plot (the rider's chosen style) with the HR line over it.
    imgPlot(ctx, style, pad, 452, W, 560, imgBins(samples, 150, f), accent);

    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pad, 1116); ctx.lineTo(IMG_W - pad, 1116); ctx.stroke();

    // Big AVG / MAX heart rate.
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var avgT = S.avgHr != null ? '' + S.avgHr : '—', maxT = S.maxHr != null ? '' + S.maxHr : '—';
    ctx.font = '900 184px "Arial Black", ' + IMG_SANS;
    ctx.fillStyle = accent; ctx.fillText(avgT, pad, 1322);
    var aw = ctx.measureText(avgT).width;
    ctx.fillStyle = '#F2F1EC'; ctx.fillText(maxT, pad + aw + 100, 1322);
    ctx.font = '700 32px ' + IMG_MONO; ctx.fillStyle = '#6B7180';
    ctx.fillText('AVG BPM', pad + 8, 1376);
    ctx.fillText('MAX BPM', pad + aw + 108, 1376);

    // Ride stats, right.
    ctx.textAlign = 'right'; ctx.font = '800 52px ' + IMG_MONO; ctx.fillStyle = '#F2F1EC';
    ctx.fillText(mmss(S.duration) + '  ·  ' + (S.np != null ? S.np : '—') + 'W  ·  TSS ' + (S.tss != null ? S.tss : '—'), IMG_W - pad, 1300);
    return c;
  }

  // Share image: one tap exports the Bars-style 4:3 PNG — no style picker, so social posts stay uniform.
  if(els.openShareBtn) els.openShareBtn.addEventListener('click', function(){
    var label = this.querySelector('.open-share-label');
    try{
      var canvas = buildSummaryImage('bars');
      var name = exportBasename() + '.png';
      if(canvas.toBlob){
        canvas.toBlob(function(blob){ downloadBinary(blob, name, 'image/png'); }, 'image/png');
      } else {
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png'); a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
    }catch(e){
      console.error('Image export failed:', e);
      if(label) label.textContent = 'Image export failed';
    }
  });