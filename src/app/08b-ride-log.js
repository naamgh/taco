  // ============================================================
  // RIDE LOG
  // ============================================================
  // Every finished ride is kept, in this browser, in IndexedDB — binary-safe
  // and hundreds of MB, where localStorage is ~5 MB of strings. A record
  // holds the ingredients (samples, laps, the FTP and max HR ridden at), not
  // the outputs: the .fit and the timeline image are regenerated on demand,
  // identical to the day's, and pick up any later redesign for free.
  //
  // Manual entries (an outdoor ride, a run, the gym) share the store so the
  // calendar shows the whole week, not just what happened on the trainer.
  var RIDE_DB = 'ftpPlanRides', RIDE_STORE = 'rides';
  var rideDbPromise = null;
  function rideDb(){
    if(rideDbPromise) return rideDbPromise;
    rideDbPromise = new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(RIDE_DB, 1);
      req.onupgradeneeded = function(){
        var db = req.result;
        var st = db.createObjectStore(RIDE_STORE, {keyPath:'id'});
        st.createIndex('day', 'day', {unique:false});
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
    return rideDbPromise;
  }
  function rideTx(mode, fn){
    return rideDb().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(RIDE_STORE, mode), st = tx.objectStore(RIDE_STORE);
        var out = fn(st);
        tx.oncomplete = function(){ resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function(){ reject(tx.error); };
        tx.onabort = function(){ reject(tx.error); };
      });
    });
  }
  // A local edit stamps `updatedAt` (drives the cloud last-write-wins merge) and
  // nudges a sync. A delete leaves a tombstone ({id,deleted,updatedAt}) so the
  // removal itself travels to other devices. `rideApply` writes a record straight
  // from the cloud without re-stamping or re-syncing. `rideAll` hides tombstones;
  // `rideAllRaw` keeps them (for sync and garbage collection).
  function rideSave(rec){ rec.updatedAt = Date.now(); if(typeof cloudSyncSoon === 'function') cloudSyncSoon(); return rideTx('readwrite', function(st){ st.put(rec); return rec; }); }
  function rideApply(rec){ return rideTx('readwrite', function(st){ st.put(rec); return rec; }); }
  function rideDelete(id){ if(typeof cloudSyncSoon === 'function') cloudSyncSoon(); return rideTx('readwrite', function(st){ st.put({id:id, deleted:true, updatedAt:Date.now()}); return id; }); }
  function rideGet(id){ return rideTx('readonly', function(st){ return st.get(id); }); }
  function rideAllRaw(){ return rideTx('readonly', function(st){ return st.getAll(); }).then(function(all){ return all || []; }); }
  function rideAll(){
    return rideAllRaw().then(function(all){
      return all.filter(function(r){ return !r.deleted && !r.pref; }).sort(function(a, b){ return a.startDateMs - b.startDateMs; });
    });
  }
  function ridePatch(id, patch){
    return rideGet(id).then(function(rec){
      if(!rec) return null;
      Object.keys(patch).forEach(function(k){ rec[k] = patch[k]; });
      return rideSave(rec);
    });
  }

  // Local calendar day, "YYYY-MM-DD".
  function dayKey(ms){
    var d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  // ---- saving the ride that just finished ----
  // Zone seconds are computed once here so the calendar and the week totals
  // never have to walk the samples again.
  function zoneSeconds(samples){
    var p = POWER_PIE_ZONES.map(function(){ return 0; }), h = HR_ZONES.map(function(){ return 0; });
    samples.forEach(function(s){
      var pi = powerZoneIndex(s.power); if(pi >= 0) p[pi]++;
      var hi = hrZoneIndex(s.hr);       if(hi >= 0) h[hi]++;
    });
    return {power:p, hr:h};
  }
  function rideRecordFromLive(){
    var wo = liveState.workout, stats = computeSummary(liveState.samples);
    return {
      id: liveState.startDateMs,
      type: 'indoor',
      day: dayKey(liveState.startDateMs),
      startDateMs: liveState.startDateMs,
      durationSec: liveState.samples.length,
      key: wo ? wo.key : null,
      name: wo ? wo.name : 'Live ride',
      zone: wo ? wo.zone : null,
      ftp: liveState.ftp || null,
      maxHr: liveState.maxHr || null,
      samples: liveState.samples,
      pbCurve: (typeof pbCurveFor === 'function') ? pbCurveFor(liveState.samples) : null,
      laps: liveState.laps,
      stats: stats,
      tss: stats.tss,
      tiz: zoneSeconds(liveState.samples),
      // Light sweet spot / threshold summary for the FTP check (syncs; see 08f).
      effort: (typeof effortSummary === 'function') ? (effortSummary(liveState.samples, wo ? wo.key : null, liveState.ftp) || false) : undefined,
      rpe: liveState.rpe || null,
      stravaActivityId: liveState.stravaActivityId || null,
      savedAt: Date.now()
    };
  }
  function saveCurrentRide(){
    if(!liveState.samples.length || liveState.savedId) return Promise.resolve(null);
    var rec = rideRecordFromLive();
    liveState.savedId = rec.id;
    return rideSave(rec).then(function(){
      refreshDoneMarks();
      if(typeof refreshReadiness === 'function') refreshReadiness();
      return rec;
    }).catch(function(e){
      liveState.savedId = null;
      console.log('Ride not saved:', e && e.message);
      return null;
    });
  }
  function patchCurrentRide(patch){
    if(!liveState.savedId) return Promise.resolve(null);
    return ridePatch(liveState.savedId, patch).catch(function(e){ console.log('Ride not updated:', e && e.message); });
  }

  // ---- reopening a saved ride ----
  // Rebuilds liveState the way the Strava round-trip does, with the ride's
  // own FTP and max HR, then shows the same summary — so the pies, the
  // exports and the sync all work unchanged.
  function openSavedRide(id){
    rideGet(id).then(function(r){
      if(!r || r.type !== 'indoor') return;
      var wo = r.key ? byKey(r.key) : null;
      var flat = wo ? expandBlocks(wo.blocks).map(function(x){
        return {type:x.type, min:x.min, pct:x.pct, pctEnd:x.pctEnd, label:x.label, seconds:Math.round(x.min * 60)};
      }) : [];
      var peak = 0;
      flat.forEach(function(x){ if(x.pct !== null) peak = Math.max(peak, x.pct, x.pctEnd || 0); });
      liveState.workout = wo;
      liveState.flat = flat;
      liveState.totalSeconds = flat.reduce(function(a, x){ return a + x.seconds; }, 0) || r.samples.length;
      liveState.samples = r.samples;
      liveState.laps = r.laps || [];
      liveState.startDateMs = r.startDateMs;
      liveState.ftp = r.ftp || null;
      liveState.maxHr = r.maxHr || null;
      liveState.savedId = r.id;
      liveState.rpe = r.rpe || null;
      liveState.zone = r.zone || (wo && wo.zone) || null;   // share-image accent fallback when the workout's gone
      liveState.stravaActivityId = r.stravaActivityId || null;
      liveState.workFactor = 1;
      liveState.restFactor = 1;
      liveState.hasRest = false;
      liveState.chartMaxPct = Math.max(105, Math.ceil((peak + 8) / 5) * 5);
      liveState.elapsedTotal = liveState.totalSeconds;
      liveState.active = false;
      els.logModal.style.display = 'none';
      showSummary({fromLog:true});
    });
  }

  // ---- RPE on the summary ----
  function paintRpe(){
    [].forEach.call(els.rpeRow.querySelectorAll('button'), function(b){
      b.classList.toggle('on', +b.getAttribute('data-rpe') === liveState.rpe);
    });
  }
  els.rpeRow.innerHTML = '<span class="rpe-label">How hard was that? <em>RPE 1–10</em></span><span class="rpe-btns">' +
    [1,2,3,4,5,6,7,8,9,10].map(function(n){ return '<button type="button" data-rpe="' + n + '">' + n + '</button>'; }).join('') + '</span>';
  els.rpeRow.addEventListener('click', function(e){
    var b = e.target.closest('button[data-rpe]');
    if(!b) return;
    var v = +b.getAttribute('data-rpe');
    liveState.rpe = liveState.rpe === v ? null : v;   // tap again to clear
    paintRpe();
    patchCurrentRide({rpe:liveState.rpe});
  });

  // ---- "done" marks on the workout cards ----
  var doneByKey = {};
  function refreshDoneMarks(){
    rideAll().then(function(all){
      doneByKey = {};
      all.forEach(function(r){ if(r.type === 'indoor' && r.key) doneByKey[r.key] = r.startDateMs; });
      [].forEach.call(els.workoutCards.querySelectorAll('.workout-card'), function(c){
        var k = c.getAttribute('data-card');
        c.classList.toggle('done', !!doneByKey[k]);
      });
    }).catch(function(){});
  }

  // ---- calendar ----
  // Each type asks for what suits it. `fields` drives the form and what's
  // stored; the trio distance/rate/time reconciles so entering any two fills
  // the third (a run's time from distance and pace, a ride's speed from
  // distance and duration). Metric throughout — this is an Australian app.
  var MANUAL_TYPES = {
    ride:{label:'Ride', color:'var(--accent)', fields:[
      {key:'distanceKm', kind:'num',  label:'Distance', unit:'km', step:0.1, trio:'dist'},
      {key:'durationSec',kind:'time', label:'Duration', trio:'time'},
      {key:'avgSpeedKmh',kind:'num',  label:'Avg speed', unit:'km/h', step:0.1, trio:'rate', rate:'speed'},
      {key:'avgPower',   kind:'num',  label:'Avg power', unit:'W', step:1},
      {key:'elevationM', kind:'num',  label:'Elevation', unit:'m', step:1}
    ]},
    run:{label:'Run', color:'var(--ok)', fields:[
      {key:'distanceKm', kind:'num',  label:'Distance', unit:'km', step:0.1, trio:'dist'},
      {key:'paceSec',    kind:'pace', label:'Avg pace', unit:'/km', trio:'rate', rate:'pace'},
      {key:'durationSec',kind:'time', label:'Time', trio:'time'}
    ]},
    gym:{label:'Gym', color:'var(--warn)', fields:[
      {key:'durationSec',kind:'time', label:'Time'},
      {key:'groups', kind:'multi', label:'Focus', options:[
        ['full','Full body'],['lower','Lower'],['upper','Upper'],['core','Core'],['mobility','Mobility']
      ]}
    ]}
  };
  // Old records were saved as type 'outdoor'; treat them as rides.
  function typeSpec(t){ return MANUAL_TYPES[t] || MANUAL_TYPES.ride; }
  var logMonth = null;   // {y, m} being shown
  var selectedId = null; // the entry whose detail is open, highlighted on the grid
  function markSelected(){
    [].forEach.call(els.logGrid.querySelectorAll('.log-entry'), function(el){
      el.classList.toggle('selected', +el.getAttribute('data-id') === selectedId);
    });
  }
  function openLog(){
    var d = new Date();
    logMonth = {y:d.getFullYear(), m:d.getMonth()};
    els.logAdd.style.display = 'none';
    els.logModal.style.display = 'flex';
    renderLog();
    dedupeIndoorTwins().then(function(n){ if(n) renderLog(); });
    pbBackfill();
    if(typeof effortBackfill === 'function') effortBackfill();
    maybeAutoSync();
    if(typeof cloudSync === 'function') cloudSync();
    if(typeof rideGcTombstones === 'function') rideGcTombstones();
  }
  // One-time (per ride) backfill: rides saved before pbCurve existed still have
  // their samples locally — compute the light summary and save it so it syncs to
  // other devices. Idempotent: once a ride has a pbCurve it's skipped. rideSave
  // restamps updatedAt + triggers cloud push so the summary propagates.
  function pbBackfill(){
    if(typeof pbCurveFor !== 'function') return Promise.resolve();
    return rideAllRaw().then(function(all){
      var todo = all.filter(function(r){ return !r.deleted && !r.pref && r.samples && r.samples.length && !r.pbCurve; });
      return Promise.all(todo.map(function(r){
        var pc = pbCurveFor(r.samples);
        if(!pc) return null;
        r.pbCurve = pc;
        return rideSave(r);
      }));
    }).catch(function(e){ console.log('pbCurve backfill skipped:', e && e.message); });
  }
  function closeLog(){ els.logModal.style.display = 'none'; }

  // ---- de-duplicating indoor rides against their Strava twin ----
  // A trainer ride saved here and the same ride on Strava (synced in, or posted
  // by a head unit / Zwift as a second activity) end up as two calendar entries.
  // The LOCAL indoor copy is the richer one — it holds the power samples and can
  // regenerate its .fit and timeline image — so we keep it and drop the imported
  // Strava summary, copying the Strava link (and any route) onto the local ride
  // so it stays shareable. The imported activity's id is recorded on the kept
  // ride (as its own stravaActivityId, or in stravaTwinIds when it already has
  // one) so a later sync won't re-import the twin we just removed. A "same
  // session" is an imported 'ride' whose start (within 15 min) and duration
  // (within 10 min or 40%) line up with a local indoor ride. Only 'ride'
  // activities are considered, so a run or gym session nearby is never mistaken
  // for the trainer ride. This also catches the case where the indoor ride
  // already carries its own Strava id (posted from here) but a *second* Strava
  // activity for the same ride got imported as a twin.
  function sameSession(indoor, strava){
    if(Math.abs((indoor.startDateMs || 0) - (strava.startDateMs || 0)) > 15 * 60 * 1000) return false;
    var a = indoor.durationSec || 0, b = strava.durationSec || 0;
    if(!a || !b) return true;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return (hi - lo) <= Math.max(600, hi * 0.4);
  }
  function indoorTwinActions(rides){
    var imports = rides.filter(function(r){ return r.imported && r.stravaActivityId && r.type === 'ride'; });
    var indoors = rides.filter(function(r){ return r.type === 'indoor'; });
    var claimed = {}, actions = [];
    imports.forEach(function(s){
      var match = null;
      for(var i = 0; i < indoors.length; i++){
        var r = indoors[i];
        if(!claimed[r.id] && sameSession(r, s)){ match = r; break; }
      }
      if(!match) return;
      claimed[match.id] = true;
      actions.push({
        deleteId: s.id,
        keepId: match.id,
        importSid: s.stravaActivityId,
        setLink: !match.stravaActivityId,                 // adopt the link if it has none
        route: (!match.route && s.route) ? s.route : null
      });
    });
    return actions;
  }
  function dedupeIndoorTwins(){
    return rideAll().then(function(all){
      var actions = indoorTwinActions(all);
      return actions.reduce(function(p, a){
        return p.then(function(){
          return rideGet(a.keepId).then(function(rec){
            if(!rec) return;
            if(a.setLink){ rec.stravaActivityId = a.importSid; }
            else {
              rec.stravaTwinIds = rec.stravaTwinIds || [];
              if(rec.stravaTwinIds.indexOf(a.importSid) < 0) rec.stravaTwinIds.push(a.importSid);
            }
            if(a.route) rec.route = a.route;
            return rideSave(rec);   // persist the link merge + sync it
          }).then(function(){ return rideDelete(a.deleteId); });
        });
      }, Promise.resolve()).then(function(){ return actions.length; });
    }).catch(function(e){ console.log('Indoor/Strava de-dupe skipped:', e && e.message); return 0; });
  }
  // Every Strava id a record already accounts for — its own, plus any twin ids
  // absorbed by the indoor/Strava de-dupe — so a sync never re-imports a removed
  // twin.
  function markStravaHave(have, r){
    if(r.stravaActivityId) have[r.stravaActivityId] = true;
    if(r.stravaTwinIds) r.stravaTwinIds.forEach(function(id){ have[id] = true; });
  }

  // ---- auto-sync from Strava on calendar open ----
  // New activities land on the calendar without a click. It's throttled so
  // opening the calendar can't spam Strava, only *adds* (never overwrites edits
  // or deletes), and advances a cursor past everything it fetched so a deleted
  // import isn't quietly re-added. The manual "Import" button stays for
  // choosing older activities. Nothing happens unless Strava is connected.
  var AUTOSYNC_AT = 'ftpPlan_autoSyncAt_v1', AUTOSYNC_SINCE = 'ftpPlan_autoSyncSince_v1';
  var AUTOSYNC_GAP = 20 * 60 * 1000;   // at most ~3 checks an hour
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  // Strava-import status rides the same cloud indicator (defined in 08e).
  function syncNote(msg, fade){ if(typeof flashCloud === 'function' && msg) flashCloud(msg); }
  function maybeAutoSync(){
    if(typeof stravaConnected !== 'function' || !stravaConnected() || !stravaCanRead()) return;
    var now = Date.now(), last = +lsGet(AUTOSYNC_AT) || 0;
    if(now - last < AUTOSYNC_GAP) return;
    lsSet(AUTOSYNC_AT, String(now));
    var since = +lsGet(AUTOSYNC_SINCE) || 0;
    if(!since){ since = now - 3 * 86400000; lsSet(AUTOSYNC_SINCE, String(since)); }
    syncNote('Syncing Strava…');
    Promise.all([stravaFetchActivities(since), rideAll()]).then(function(res){
      var acts = res[0] || [], have = {};
      res[1].forEach(function(r){ markStravaHave(have, r); });
      var newest = since;
      acts.forEach(function(a){ var t = Date.parse(a.start_date); if(t > newest) newest = t; });
      if(newest > since) lsSet(AUTOSYNC_SINCE, String(newest + 1000));
      var news = acts.map(stravaToRecord).filter(function(rec){ return rec.stravaActivityId && !have[rec.stravaActivityId]; });
      if(!news.length){ syncNote(''); return; }
      news.reduce(function(p, rec){ return p.then(function(){ return rideSave(rec); }); }, Promise.resolve())
        .then(dedupeIndoorTwins)
        .then(function(){ renderLog(); refreshDoneMarks(); if(typeof refreshReadiness === 'function') refreshReadiness(); syncNote(news.length + ' new from Strava', true); });
    }).catch(function(){ syncNote(''); });
  }
  // Back from a saved ride: same month, fresh data.
  function reopenLog(){
    if(!logMonth){ openLog(); return; }
    els.logModal.style.display = 'flex';
    renderLog();
  }
  function shiftLogMonth(n){
    var d = new Date(logMonth.y, logMonth.m + n, 1);
    logMonth = {y:d.getFullYear(), m:d.getMonth()};
    renderLog();
  }
  function fmtHours(sec){
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + 'm';
  }
  // Indoor (trainer) rides get their own identity colour so they read distinctly
  // from outdoor rides (which stay accent blue, close to the endurance zone).
  function entryColor(r){
    if(r.type === 'indoor') return 'var(--lav)';
    if(r.type === 'other') return 'var(--text-faint)';
    return typeSpec(r.type).color;
  }
  function entryName(r){
    return r.type === 'indoor' ? r.name : (r.name || typeSpec(r.type).label);
  }
  // A one-line summary of a manual entry's own fields, for the chip's tooltip.
  function entryDetail(r){
    if(r.type === 'indoor') return '';
    var f = r.fields || {}, bits = [];
    if(f.distanceKm) bits.push(f.distanceKm + ' km');
    if(r.type === 'run' && f.paceSec) bits.push(secToClock(f.paceSec) + '/km');
    if(r.type === 'ride' && f.avgSpeedKmh) bits.push(f.avgSpeedKmh + ' km/h');
    if(f.avgPower) bits.push(f.avgPower + ' W');
    if(f.elevationM) bits.push(f.elevationM + ' m');
    if(f.groups && f.groups.length) bits.push(f.groups.map(function(g){
      var o = (typeSpec('gym').fields[1].options.filter(function(x){ return x[0] === g; })[0]); return o ? o[1] : g;
    }).join(', '));
    return bits.join(' · ');
  }

  // ---- time / pace helpers ----
  // "1:45:30" or "5:30" -> seconds; a bare number is minutes (a 5 pace = 5:00).
  function clockToSec(str){
    str = String(str || '').trim();
    if(!str) return null;
    if(str.indexOf(':') < 0){ var m = parseFloat(str); return isNaN(m) ? null : Math.round(m * 60); }
    var p = str.split(':').map(Number);
    if(p.some(isNaN)) return null;
    return p.length === 3 ? p[0]*3600 + p[1]*60 + p[2] : p[0]*60 + p[1];
  }
  function secToClock(sec){
    if(sec === null || sec === undefined || isNaN(sec)) return '';
    sec = Math.round(sec);
    var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    var mm = (h && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h ? h + ':' : '') + mm + ':' + ss;
  }
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Mobile calendar: tapping a day docks its detail into the space below the
  // grid (phones only; desktop keeps the side panel). 720px matches the
  // calendar's existing mobile CSS so the two layouts never half-apply.
  var mqCal = window.matchMedia('(max-width:720px)');
  var dockDay = null, logByDay = {}, logTodayKey = '', dockAdding = false;
  function monthKey(y, m){ return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function defaultDockDay(y, m, todayKey){
    return todayKey.slice(0, 7) === monthKey(y, m) ? todayKey : monthKey(y, m) + '-01';
  }
  function dotsFor(list){
    if(!list.length) return '';
    var max = 3, out = list.slice(0, max).map(function(r){
      return '<span class="log-dot' + (r.planned ? ' ring' : '') + '" style="--c:' + entryColor(r) + '"></span>';
    }).join('');
    if(list.length > max) out += '<span class="log-dot-more">+' + (list.length - max) + '</span>';
    return out;
  }

  function renderLog(){
    rideAll().then(function(all){
      var byDay = {};
      all.forEach(function(r){ (byDay[r.day] = byDay[r.day] || []).push(r); });

      var mobile = mqCal.matches;
      var y = logMonth.y, m = logMonth.m;
      els.logMonth.textContent = MONTHS[m] + ' ' + y;
      var first = new Date(y, m, 1);
      // Monday starts the week: shift Sunday (0) to the end.
      var lead = (first.getDay() + 6) % 7;
      var start = new Date(y, m, 1 - lead);
      var todayKey = dayKey(Date.now());

      var html = '<div class="log-dow">' + DOW.map(function(d){ return '<span>' + d + '</span>'; }).join('') + '<span class="log-dow-week">Week</span></div>';
      for(var w = 0; w < 6; w++){
        var rowStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7);
        if(w === 5 && rowStart.getMonth() !== m) break;   // a 5-row month
        var cells = '', wkTss = 0, wkSec = 0, wkN = 0;
        for(var i = 0; i < 7; i++){
          var d = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + i);
          var k = dayKey(d.getTime()), list = byDay[k] || [];
          var out = d.getMonth() !== m;
          // Planned workouts don't count toward the week's done totals.
          list.forEach(function(r){ if(r.planned) return; wkTss += r.tss || 0; wkSec += r.durationSec || 0; wkN++; });
          var future = k >= todayKey;   // today and later get the plan +
          var sel = mobile && k === dockDay;
          cells += '<div class="log-day' + (out ? ' out' : '') + (i >= 5 ? ' weekend' : '') + (k === todayKey ? ' today' : '') + (sel ? ' sel' : '') + '" data-day="' + k + '">' +
            '<span class="log-date">' + d.getDate() + '</span>' +
            // Mobile: just colour dots — the day's detail lives in the dock below.
            (mobile ? '<span class="log-dots">' + dotsFor(list) + '</span>' :
            list.map(function(r){
              var det = entryDetail(r);
              // An activity feeds Fitness/Fatigue/Form only through TSS, or failing
              // that an RPE. With neither it's invisible to those charts — flag it.
              var needsRpe = !r.planned && !r.tss && !r.rpe;
              var tip = (r.planned ? 'Planned · ' : '') + entryName(r) + (det ? ' · ' + det : '') + (r.tss ? ' · TSS ' + r.tss : needsRpe ? ' · needs an RPE to count toward Fitness/Form' : '');
              return '<button type="button" class="log-entry' + (r.planned ? ' planned' : '') + (needsRpe ? ' needs-rpe' : '') + (r.id === selectedId ? ' selected' : '') + '" data-id="' + r.id + '" style="--c:' + entryColor(r) + '" title="' + tip.replace(/"/g, '&quot;') + '">' +
                '<i></i><span>' + entryName(r) + '</span>' + (r.tss ? '<b>' + r.tss + '</b>' : needsRpe ? '<em class="rpe-flag">RPE</em>' : '') +
                (r.planned ? '<span class="plan-del" data-del="' + r.id + '" title="Delete plan" aria-label="Delete plan">×</span>' : '') + '</button>';
            }).join('') +
            (future ? '<button type="button" class="log-day-add" data-plan="' + k + '" title="Plan a workout on this day" aria-label="Plan a workout">+</button>' : '')) +
          '</div>';
        }
        html += '<div class="log-row">' + cells +
          '<div class="log-week">' + (wkN ? '<b>' + wkTss + '</b><span>TSS</span><b>' + fmtHours(wkSec) + '</b><span>' + wkN + (wkN === 1 ? ' activity' : ' activities') + '</span>' : '<span class="log-week-empty">—</span>') + '</div>' +
        '</div>';
      }
      els.logGrid.innerHTML = html;
      logByDay = byDay; logTodayKey = todayKey;
      if(mobile){
        els.logDock.hidden = false;
        if(!dockDay || dockDay.slice(0, 7) !== monthKey(y, m)) dockDay = defaultDockDay(y, m, todayKey);
        markDockSel();
        renderDock(dockDay);
      } else if(els.logDock){
        els.logDock.hidden = true;
      }
    }).catch(function(e){
      els.logGrid.innerHTML = '<p class="log-error">The log couldn’t be opened: ' + (e && e.message) + '</p>';
    });
  }

  // ---- mobile day dock ----
  function markDockSel(){
    [].forEach.call(els.logGrid.querySelectorAll('.log-day'), function(el){
      el.classList.toggle('sel', el.getAttribute('data-day') === dockDay);
    });
  }
  function selectDockDay(k){ dockDay = k; dockAdding = false; markDockSel(); renderDock(k); }
  function zoneLabel(r){
    if(r.type === 'indoor') return (r.zone && ZONES[r.zone]) ? ZONES[r.zone].label : 'Indoor';
    return typeSpec(r.type).label;
  }
  function dockThumb(r){
    if(r.type === 'indoor' && r.key && typeof byKey === 'function'){ var wo = byKey(r.key); if(wo && typeof thumbSvg === 'function') return thumbSvg(wo); }
    if(r.route && typeof routeSvg === 'function') return routeSvg(decodePolyline(r.route), 64, 42);
    return '';
  }
  function dockDoneCard(r){
    var thumb = dockThumb(r);
    var bits = [];
    if(r.durationSec) bits.push('<span class="dock-stat">' + Math.round(r.durationSec / 60) + ' min</span>');
    if(r.tss) bits.push('<span class="dock-stat">TSS ' + r.tss + '</span>');
    else if(r.rpe) bits.push('<span class="dock-stat">RPE ' + r.rpe + '</span>');
    var struct = r.type === 'indoor'
      ? (r.key && typeof byKey === 'function' && byKey(r.key) && typeof shortLabel === 'function' ? shortLabel(byKey(r.key)) : '')
      : entryDetail(r);
    return '<button type="button" class="dock-card" data-id="' + r.id + '">' +
      (thumb ? '<span class="dock-thumb">' + thumb + '</span>' : '') +
      '<span class="dock-cbody">' +
        '<span class="dock-crow"><span class="dock-cname">' + entryName(r) + '</span><span class="dock-chev">&#8250;</span></span>' +
        '<span class="dock-cmeta"><span class="dock-ztag" style="--c:' + entryColor(r) + '">' + zoneLabel(r) + '</span>' +
          bits.map(function(b){ return '<span class="dock-sep">&middot;</span>' + b; }).join('') + '</span>' +
        (struct ? '<span class="dock-cstruct">' + struct + '</span>' : '') +
      '</span></button>';
  }
  function dockPlannedCard(r){
    return '<button type="button" class="dock-card planned" data-id="' + r.id + '">' +
      '<span class="dock-pl-dot" style="--c:' + entryColor(r) + '"></span>' +
      '<span class="dock-cbody">' +
        '<span class="dock-crow"><span class="dock-cname">' + entryName(r) + '</span><span class="dock-chev">&#8250;</span></span>' +
        '<span class="dock-cmeta"><span class="dock-sub">Planned &middot; ' + zoneLabel(r) + '</span></span>' +
      '</span></button>';
  }
  function dockPlanPrompt(another){
    return '<div class="dock-plan"><p class="dock-plan-lead">' + (another ? 'Add another &mdash; pick a type' : 'Nothing planned.') + '</p>' +
      '<div class="dock-chips">' + PLAN_CATS.map(function(c){
        return '<button type="button" class="dock-chip" data-dock-cat="' + c.key + '"><i style="background:' + entryColor({type:c.type}) + '"></i>' + c.label + '</button>';
      }).join('') + '</div></div>';
  }
  // When a day already has entries, offer to stack another plan onto it.
  function dockAddMore(){ return '<button type="button" class="dock-addmore" data-dock-add>&#43; Add another workout</button>'; }
  function dockHead(k, tag){ return '<div class="dock-date"><b>' + prettyDate(k) + '</b><span>' + tag + '</span></div>'; }
  function renderDock(k){
    if(!els.logDock) return;
    var all = logByDay[k] || [], done = all.filter(function(r){ return !r.planned; }),
        planned = all.filter(function(r){ return r.planned; }), future = k >= logTodayKey;
    var body;
    if(done.length || planned.length){
      body = done.map(dockDoneCard).join('') + planned.map(dockPlannedCard).join('');
      // A day with entries can still take more while it's today or ahead.
      if(future) body += dockAdding ? dockPlanPrompt(true) : dockAddMore();
    } else if(future){
      body = dockPlanPrompt();
    } else {
      body = '<div class="dock-rest"><b>Rest day</b><span>Nothing logged.</span></div>';
    }
    els.logDock.innerHTML = dockHead(k, k === logTodayKey ? 'Today' : (future ? 'Upcoming' : 'Done')) + body;
  }
  // Chip → that type's targets, in the dock; target → create the plan.
  function dockPlanStep2(catKey){
    var c = PLAN_CATS.filter(function(x){ return x.key === catKey; })[0];
    els.logDock.innerHTML = dockHead(dockDay, 'Plan &middot; ' + c.label) +
      '<div class="dock-targets">' + c.targets.map(function(t){
        return '<button type="button" class="dock-target" data-dock-cat="' + catKey + '" data-dock-t="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="dock-back" data-dock-back>&#8249; Types</button>';
  }
  els.logDock.addEventListener('click', function(e){
    var card = e.target.closest('.dock-card');
    if(card){ var id = +card.getAttribute('data-id'); rideGet(id).then(function(r){ if(r) showDetail(r); }); return; }
    if(e.target.closest('[data-dock-add]')){ dockAdding = true; renderDock(dockDay); return; }
    var tgt = e.target.closest('[data-dock-cat][data-dock-t]');
    if(tgt){
      dockAdding = false;                 // created — fall back to cards + "Add another"
      planDay = dockDay;
      createPlan(PLAN_CATS.filter(function(x){ return x.key === tgt.getAttribute('data-dock-cat'); })[0], tgt.getAttribute('data-dock-t'));
      return;
    }
    var chip = e.target.closest('[data-dock-cat]');
    if(chip){ dockPlanStep2(chip.getAttribute('data-dock-cat')); return; }
    if(e.target.closest('[data-dock-back]')){ renderDock(dockDay); }
  });
  // Re-render when crossing the mobile breakpoint so the right layout shows.
  mqCal.addEventListener('change', function(){ if(els.logModal.style.display !== 'none') renderLog(); });

  els.logGrid.addEventListener('click', function(e){
    // Mobile: a tap anywhere on a day docks that day's detail below.
    if(mqCal.matches){
      var dayEl = e.target.closest('.log-day');
      if(dayEl){ selectDockDay(dayEl.getAttribute('data-day')); return; }
    }
    // Quick-delete a plan from its chip — no confirm; a plan is 3 clicks to remake.
    var del = e.target.closest('[data-del]');
    if(del){
      e.stopPropagation();
      var did = +del.getAttribute('data-del');
      rideDelete(did).then(function(){ if(selectedId === did) hideSide(); renderLog(); });
      return;
    }
    var plan = e.target.closest('[data-plan]');
    if(plan){ openPlanPop(plan.getAttribute('data-plan'), plan); return; }
    var en = e.target.closest('.log-entry');
    if(!en) return;
    var id = +en.getAttribute('data-id');
    rideGet(id).then(function(r){ if(r) showDetail(r); });
  });

  // ---- plan a workout ----
  // The + on a future day opens this: pick a category, then one quick target,
  // and a planned entry lands on the calendar (3 clicks). Planned entries carry
  // planned:true and no actuals; they're kept out of the charts and totals.
  var PLAN_CATS = [
    {key:'indoor', label:'Indoor Trainer', type:'indoor', noun:'ride', targets:[
      ['recovery','Recovery'],['endurance','Endurance'],['sweetspot','Sweet Spot'],['threshold','Threshold'],['vo2','VO₂']]},
    {key:'ride', label:'Outdoor Ride', type:'ride', noun:'ride', targets:[
      ['easy','Easy'],['endurance','Endurance'],['tempo','Tempo'],['long','Long']]},
    {key:'run', label:'Run', type:'run', noun:'run', targets:[
      ['easy','Easy'],['long','Long'],['tempo','Tempo'],['intervals','Intervals']]},
    {key:'gym', label:'Gym', type:'gym', noun:'', targets:[
      ['full','Full body'],['lower','Lower body'],['upper','Upper body'],['core','Core'],['mobility','Mobility']]},
    {key:'other', label:'Other', type:'other', noun:'', targets:[
      ['swim','Swim'],['yoga','Yoga'],['walk','Walk'],['hike','Hike'],['rest','Rest day']]}
  ];
  var planDay = null, planCat = null;
  function placePlanPop(anchor){
    var pop = els.planPop; pop.classList.add('open');
    var r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = r.right + 8; if(left + w > window.innerWidth - 10) left = Math.max(10, r.left - w - 8);
    var top = r.top - 4; if(top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - 10 - h);
    pop.style.left = Math.round(left) + 'px'; pop.style.top = Math.round(top) + 'px';
  }
  function openPlanPop(day, anchor){
    planDay = day;
    renderPlanStep1();
    placePlanPop(anchor);
  }
  function closePlanPop(){ els.planPop.classList.remove('open'); els.planPop.innerHTML = ''; planDay = null; }
  function planHead(sub){
    return '<div class="plan-head"><span class="plan-title">Add a planned workout</span>' +
      '<span class="plan-sub">' + (sub || prettyDate(planDay)) + '</span></div>';
  }
  function renderPlanStep1(){
    planCat = null;
    els.planPop.innerHTML = planHead() +
      '<div class="plan-cats">' + PLAN_CATS.map(function(c){
        return '<button type="button" class="plan-cat" data-cat="' + c.key + '"><i style="background:' + entryColor({type:c.type}) + '"></i>' + c.label + '<span class="plan-chev">›</span></button>';
      }).join('') + '</div>';
  }
  function renderPlanStep2(catKey){
    planCat = catKey;
    var c = PLAN_CATS.filter(function(x){ return x.key === catKey; })[0];
    els.planPop.innerHTML = planHead(c.label) +
      '<div class="plan-targets">' + c.targets.map(function(t){
        return '<button type="button" class="plan-target" data-t="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="plan-back" data-back>‹ Categories</button>';
  }
  // One delegated listener; stopPropagation keeps the outside-click closer from
  // firing when a click re-renders the popover (detaching the clicked node).
  els.planPop.addEventListener('click', function(e){
    e.stopPropagation();
    var cat = e.target.closest('[data-cat]'); if(cat){ renderPlanStep2(cat.getAttribute('data-cat')); return; }
    if(e.target.closest('[data-back]')){ renderPlanStep1(); return; }
    var t = e.target.closest('[data-t]');
    if(t && planCat){ createPlan(PLAN_CATS.filter(function(x){ return x.key === planCat; })[0], t.getAttribute('data-t')); }
  });
  function createPlan(cat, targetKey){
    var t = cat.targets.filter(function(x){ return x[0] === targetKey; })[0], label = t[1];
    var name = cat.noun ? label + ' ' + cat.noun : label;
    var parts = planDay.split('-').map(Number);
    var noon = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0).getTime();
    var rec = {
      id: noon + (Date.now() % 1000), type: cat.type, day: planDay, startDateMs: noon,
      planned: true, name: name, plan: {cat: cat.key, target: targetKey, label: label}, savedAt: Date.now()
    };
    if(cat.type === 'indoor') rec.zone = targetKey;
    if(cat.type === 'gym') rec.fields = {groups: [targetKey]};
    rideSave(rec).then(function(){ closePlanPop(); renderLog(); });
  }
  document.addEventListener('click', function(e){
    if(els.planPop.classList.contains('open') && !els.planPop.contains(e.target) && !e.target.closest('[data-plan]')) closePlanPop();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && els.planPop.classList.contains('open')) closePlanPop(); });

  var PENCIL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.3 6.7l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var TRASH_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0110.7 4h2.6a1.2 1.2 0 011.2 1.2V7M6.5 7l.8 11.2A1.6 1.6 0 008.9 20h6.2a1.6 1.6 0 001.6-1.8L17.5 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var EXPAND_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 5h5v5M19 5l-6 6M10 19H5v-5M5 19l6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var BACK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Strava brand mark (orange, keeps its own colour) + an open-in-new-window glyph.
  var STRAVA_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066M12.825 10.2l1.46 2.874h-2.92l1.46-2.874" fill="#FC4C02"/></svg>';
  var EXTLINK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var UPLOAD_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function prettyDate(day){
    var p = String(day).split('-').map(Number), d = new Date(p[0], p[1]-1, p[2]);
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ---- route map ----
  // Strava's summary_polyline is a Google-encoded polyline; decode to [lat,lng]
  // pairs, then draw the shape so a rider recognises the route at a glance.
  function decodePolyline(str){
    if(!str) return [];
    var index = 0, lat = 0, lng = 0, out = [], len = str.length;
    while(index < len){
      var b, shift = 0, result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while(b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while(b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lat * 1e-5, lng * 1e-5]);
    }
    return out;
  }
  // Projects lat/lng (equirectangular, longitude squeezed by cos(lat)) into a
  // w×h box, aspect preserved and centred, with start (green) and end (red) dots.
  function routeSvg(pts, w, h){
    if(!pts || pts.length < 2) return '';
    var pad = 8, k = Math.cos(pts[Math.floor(pts.length/2)][0] * Math.PI / 180);
    var xs = pts.map(function(p){ return p[1] * k; }), ys = pts.map(function(p){ return -p[0]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var sw = (maxX - minX) || 1e-6, sh = (maxY - minY) || 1e-6;
    var scale = Math.min((w - 2*pad) / sw, (h - 2*pad) / sh);
    var ox = (w - sw*scale) / 2, oy = (h - sh*scale) / 2;
    function X(i){ return ox + (xs[i] - minX) * scale; }
    function Y(i){ return oy + (ys[i] - minY) * scale; }
    var d = pts.map(function(p, i){ return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(i).toFixed(1); }).join('');
    var last = pts.length - 1;
    return '<svg class="route-map" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-label="Route map">' +
      '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + X(0).toFixed(1) + '" cy="' + Y(0).toFixed(1) + '" r="3.2" fill="var(--ok)"/>' +
      '<circle cx="' + X(last).toFixed(1) + '" cy="' + Y(last).toFixed(1) + '" r="3.2" fill="var(--c-anaerobic)"/>' +
      '</svg>';
  }

  // ---- read-only detail view ----
  // Clicking any entry opens this in the side panel: the ride at a glance, with
  // nothing editable until the pencil is pressed. Indoor rides also get their
  // zone pies here and a button through to the full summary (exports, sync).
  function gymLabel(g){ var o = MANUAL_TYPES.gym.fields[1].options.filter(function(x){ return x[0] === g; })[0]; return o ? o[1] : g; }
  function statChip(lab, val){ return '<div class="dv-row"><span>' + lab + '</span><b>' + val + '</b></div>'; }
  function detailStats(rec){
    function w(v, u){ return (v !== null && v !== undefined) ? v + (u || '') : '—'; }
    if(rec.type === 'indoor'){
      var s = rec.stats || {};
      return [
        statChip('Duration', secToClock(rec.durationSec)),
        statChip('TSS', rec.tss != null ? rec.tss : '—'),
        statChip('IF', s.IF != null ? s.IF : '—'),
        statChip('Norm power', w(s.np, ' W')),
        statChip('Avg power', w(s.avgPower, ' W')),
        statChip('Max power', w(s.maxPower, ' W')),
        statChip('Avg HR', w(s.avgHr, ' bpm')),
        statChip('Max HR', w(s.maxHr, ' bpm')),
        statChip('Avg cad', w(s.avgCadence, ' rpm')),
        statChip('Work', w(s.kj, ' kJ'))
      ].join('');
    }
    var f = rec.fields || {}, out = [statChip('Duration', secToClock(rec.durationSec))];
    if(f.distanceKm) out.push(statChip('Distance', f.distanceKm + ' km'));
    if(rec.type === 'run' && f.paceSec) out.push(statChip('Pace', secToClock(f.paceSec) + '/km'));
    if(rec.type === 'ride' && f.avgSpeedKmh) out.push(statChip('Avg speed', f.avgSpeedKmh + ' km/h'));
    if(f.avgPower) out.push(statChip('Avg power', f.avgPower + ' W'));
    if(rec.avgHr) out.push(statChip('Avg HR', rec.avgHr + ' bpm'));
    if(rec.maxHr) out.push(statChip('Max HR', rec.maxHr + ' bpm'));
    if(f.elevationM) out.push(statChip('Elevation', f.elevationM + ' m'));
    if(rec.tss != null) out.push(statChip('TSS', rec.tss));
    if(f.groups && f.groups.length) out.push(statChip('Focus', f.groups.map(gymLabel).join(', ')));
    return out.join('');
  }

  // ---- heart-rate zone distribution ----
  // Time in each HR zone (Strava-style), as vertical bars, using the app's max
  // HR setting for the boundaries and marking the ride's average. The HR series
  // is the indoor samples or a Strava import's streams (fetched once, cached).
  function hrSeriesFor(rec){
    if(rec.type === 'indoor' && rec.samples && rec.samples.length){
      return rec.samples.map(function(s){ return s.hr; }).filter(function(v){ return v != null; });
    }
    if(rec.streams && rec.streams.hr){ return rec.streams.hr.filter(function(v){ return v != null; }); }
    return null;
  }
  // bpm bounds for each zone at a given max HR (Z5 is open-ended).
  function hrZoneBpm(m){
    return HR_ZONES.map(function(z){ return {z:z.z, label:z.label, color:z.color,
      lo: Math.round(m * z.lo / 100), hi: z.hi === null ? null : Math.round(m * z.hi / 100) - 1 }; });
  }
  function hrZoneOf(bpm, m){
    var pct = bpm / m * 100;
    for(var i = 0; i < HR_ZONES.length; i++){ if(HR_ZONES[i].hi === null || pct < HR_ZONES[i].hi) return i; }
    return HR_ZONES.length - 1;
  }
  // Time-in-zone as a funnel: one centred segment per HR zone, Z1 at the top to
  // Z5 at the foot, each segment's width proportional to its share of the ride.
  // Zone name sits in the left gutter, the share on the right, and the ride's
  // average HR is a dashed line drawn across the zone it falls in.
  function drawHrZones(cv, dist, total, avg, m){
    var W = cv.clientWidth || 300, H = 200, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var faintC = getComputedStyle(document.documentElement).getPropertyValue('--text-faint').trim();
    var dimC = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
    var strongC = getComputedStyle(document.documentElement).getPropertyValue('--text-strong').trim();
    var trackC = getComputedStyle(document.documentElement).getPropertyValue('--bg-elev').trim();
    var bgC = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff';
    var bpm = hrZoneBpm(m), n = HR_ZONES.length;
    ctx.clearRect(0, 0, W, H);
    var padT = 20, padB = 12, leftW = 84, rightW = 42;
    var fx0 = leftW, fx1 = Math.max(fx0 + 24, W - rightW), fcx = (fx0 + fx1) / 2, funnelW = fx1 - fx0;
    var bandH = (H - padT - padB) / n;
    var maxFrac = Math.max.apply(null, dist.map(function(c){ return total ? c / total : 0; })) || 1;
    for(var i = 0; i < n; i++){
      var frac = total ? dist[i] / total : 0;
      var segW = frac > 0 ? Math.max(6, frac / maxFrac * funnelW) : 0;
      var bandY = padT + i * bandH, segH = Math.min(26, bandH * 0.66), segY = bandY + (bandH - segH) / 2, midY = bandY + bandH / 2;
      if(segW > 0){ ctx.fillStyle = bpm[i].color; roundRect(ctx, fcx - segW / 2, segY, segW, segH, 5); ctx.fill(); }
      else { ctx.fillStyle = trackC; roundRect(ctx, fcx - 3, midY - 1.5, 6, 3, 1.5); ctx.fill(); }   // 0% nub keeps the row on the centreline
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillStyle = bpm[i].color; ctx.font = '700 11px ' + IMG_MONO; ctx.fillText(bpm[i].z, 6, midY);
      ctx.fillStyle = dimC; ctx.font = '600 10.5px ' + IMG_SANS; ctx.fillText(bpm[i].label, 26, midY);
      ctx.textAlign = 'right'; ctx.fillStyle = frac > 0 ? strongC : faintC; ctx.font = '700 12px ' + IMG_MONO;
      ctx.fillText(Math.round(frac * 100) + '%', W - 6, midY);
    }
    // average-HR reference: a dashed line across the funnel at the avg's zone.
    if(avg && m){
      var zi = hrZoneOf(avg, m), ly = padT + zi * bandH + bandH / 2;
      ctx.strokeStyle = strongC; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(fx0, ly); ctx.lineTo(fx1, ly); ctx.stroke(); ctx.setLineDash([]);
      var lbl = 'Avg ' + Math.round(avg) + ' bpm'; ctx.font = '700 9.5px ' + IMG_MONO;
      var tw = ctx.measureText(lbl).width + 12, pillY = Math.max(2, ly - 19);
      ctx.fillStyle = strongC; roundRect(ctx, fx0, pillY, tw, 15, 4); ctx.fill();
      ctx.fillStyle = bgC; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lbl, fx0 + tw / 2, pillY + 7.5);
    }
  }
  // Heart-rate time-in-zone as a typographic bar list: a zone-colour swatch +
  // code + name, an ink bar (length = share of the ride), the %, and the zone
  // the ride averaged in picked out in its own colour. Replaces the canvas
  // funnel so it matches the DM-Mono theme and themes with light/dark for free.
  function hrZonesHtml(dist, total, avg, ref){
    var bpm = hrZoneBpm(ref);
    var avgZi = (avg && ref) ? hrZoneOf(avg, ref) : -1;
    var rows = bpm.map(function(b, i){
      var frac = total ? dist[i] / total : 0, pct = Math.round(frac * 100);
      var w = frac > 0 ? Math.max(2, frac * 100) : 0;
      var rng = b.hi === null ? (b.lo + '+') : (b.lo + '–' + b.hi);
      return '<div class="hz-row' + (i === avgZi ? ' is-avg' : '') + (frac > 0 ? '' : ' zero') + '" title="' + b.label + ' · ' + rng + ' bpm">' +
        '<span class="hz-lab"><i class="hz-sq" style="background:' + b.color + '"></i><b>' + b.z + '</b> <span class="hz-nm">' + b.label + '</span></span>' +
        '<span class="hz-bar"><span class="hz-fill" style="width:' + w + '%;--zc:' + b.color + '"></span></span>' +
        '<b class="hz-pct">' + pct + '%</b>' +
      '</div>';
    }).join('');
    var cap = (avg && avgZi >= 0)
      ? '<p class="dv-hrz-cap">Average <b>' + Math.round(avg) + ' bpm</b> · ' + bpm[avgZi].z + ' ' + bpm[avgZi].label + '</p>' : '';
    return '<div class="dv-hrz">' +
      '<div class="dv-ghead"><h4>Heart-rate zones</h4><span class="dv-gsub">max ' + ref + ' bpm</span></div>' +
      '<div class="dv-hrz-rows">' + rows + '</div>' + cap +
    '</div>';
  }
  function renderDetailGraph(rec){
    var box = els.logAdd.querySelector('#dvGraph'); if(!box) return;
    function paint(hr){
      var ref = maxHr || rec.maxHr;   // prefer the app's max-HR setting
      if(!ref){ box.innerHTML = '<p class="dv-nodata">Set your max HR in the menu to see heart-rate zones.</p>'; return; }
      var dist = HR_ZONES.map(function(){ return 0; }), sum = 0;
      hr.forEach(function(v){ dist[hrZoneOf(v, ref)]++; sum += v; });
      var total = hr.length, avg = total ? sum / total : 0;
      box.innerHTML = hrZonesHtml(dist, total, avg, ref);
    }
    var hr = hrSeriesFor(rec);
    if(hr && hr.length){ paint(hr); return; }
    // No local samples to read HR from — but any ride linked to Strava (an
    // import, OR a local indoor ride we kept over its Strava twin / that synced
    // from another device without its heavy samples) can fetch the streams once
    // and cache them. The recording device still reads its own samples above.
    if(rec.stravaActivityId && typeof stravaCanRead === 'function' && stravaCanRead()){
      box.innerHTML = '<p class="dv-nodata">Loading heart rate from Strava…</p>';
      stravaFetchStreams(rec.stravaActivityId).then(function(sr){
        if(sr){ rec.streams = sr; ridePatch(rec.id, {streams:sr}); }
        var h = hrSeriesFor(rec);
        if(h && h.length) paint(h);
        else box.innerHTML = '<p class="dv-nodata">No heart-rate recorded for this activity.</p>';
      }).catch(function(e){
        box.innerHTML = '<p class="dv-nodata">Couldn’t load heart rate: ' + (e && e.message || 'Strava error') + '</p>';
      });
      return;
    }
    box.innerHTML = '<p class="dv-nodata">No heart-rate data for this activity.</p>';
  }
  // A planned workout: no actuals yet — show the plan, let the rider move the
  // day or delete it. (Editing / completing a plan is a later step.)
  function showPlanDetail(rec){
    els.logAdd.style.display = '';
    var typeLabel = rec.type === 'indoor' ? 'Indoor ride' : rec.type === 'other' ? (rec.plan && rec.plan.label || 'Other') : typeSpec(rec.type).label;
    els.logAdd.innerHTML =
      '<div class="log-detail">' +
        '<div class="log-side-head">' +
          '<div class="dv-title">' +
            '<span class="dv-name">' + esc(entryName(rec)) + '</span>' +
            '<span class="dv-sub"><i style="background:' + entryColor(rec) + '"></i>Planned · ' + typeLabel + '</span>' +
          '</div>' +
          '<div class="lf-head-btns">' +
            '<button type="button" class="lf-hbtn del" id="dvDelete" title="Delete" aria-label="Delete">' + TRASH_SVG + '</button>' +
            '<button type="button" class="lf-hbtn cancel" id="dvClose" title="Close" aria-label="Close">' + CLOSE_SVG + '</button>' +
          '</div>' +
        '</div>' +
        '<p class="dv-plan-note">A planned session — a reminder on the calendar. Reschedule it or remove it below; once you’ve done it, log the actual with the <b>+ Log an activity</b> button.</p>' +
        planBrowseHtml(rec) +
        '<label class="lf-date dv-plan-date">Move to <input type="date" id="dvPlanDate" value="' + rec.day + '"></label>' +
      '</div>';
    selectedId = rec.id; markSelected();
    var durBox = els.logAdd.querySelector('.dv-plan-durs');
    if(durBox) durBox.addEventListener('click', function(e){
      var b = e.target.closest('[data-dur]'); if(!b) return;
      browsePlanZone(planBase(rec), +b.getAttribute('data-dur') || null);
    });
    els.logAdd.querySelector('#dvClose').addEventListener('click', hideSide);
    els.logAdd.querySelector('#dvDelete').addEventListener('click', function(){
      rideDelete(rec.id).then(function(){ hideSide(); renderLog(); });   // plans delete without a prompt
    });
    els.logAdd.querySelector('#dvPlanDate').addEventListener('change', function(){
      var day = this.value; if(!day) return;
      var p = day.split('-').map(Number), noon = new Date(p[0], p[1] - 1, p[2], 12, 0, 0).getTime();
      ridePatch(rec.id, {day: day, startDateMs: noon}).then(function(){ rec.day = day; rec.startDateMs = noon; renderLog(); });
    });
  }
  // The library filter an indoor plan maps to. Recovery has no library zone →
  // easiest endurance (endurance zone, 1 chilli only). Endurance itself is
  // normal Z2 across all intensities.
  function planBase(rec){
    var z = rec.zone, fz = FILTER_ZONES.indexOf(z) >= 0 ? z : (z === 'recovery' ? 'endurance' : null);
    return {zone: fz, spice: (z === 'recovery') ? 1 : null};
  }
  // Durations that actually have a workout for this zone (+ spice), so every
  // quick-link lands on results.
  function planDurations(base){
    var set = {};
    WORKOUTS.forEach(function(w){
      if(w.zone === 'test') return;
      if(base.zone !== null && w.zone !== base.zone) return;
      if(base.spice !== null && SPICE_GROUPS[spiceGroupOf(base.spice)].indexOf(w.spice) < 0) return;
      set[w.durationMin] = true;
    });
    return Object.keys(set).map(Number).sort(function(a, b){ return a - b; });
  }
  function planBrowseHtml(rec){
    if(rec.type !== 'indoor') return '';
    var durs = planDurations(planBase(rec));
    return '<div class="dv-plan-browse-box"><span class="dv-plan-browse-label">Show me ' + esc((rec.plan && rec.plan.label) || '') + ' workouts</span>' +
      '<div class="dv-plan-durs">' +
        '<button type="button" class="dv-dur" data-dur="0">Any length</button>' +
        durs.map(function(d){ return '<button type="button" class="dv-dur" data-dur="' + d + '">' + d + ' min</button>'; }).join('') +
      '</div></div>';
  }
  // Apply the filter and jump back to the library; clears the rest so the list
  // isn't accidentally empty.
  function browsePlanZone(base, duration){
    if(LOG_MODE){   // hand the same filter to the full app
      location.href = APP_URL + '#browse=' + encodeURIComponent([base.zone || '', base.spice != null ? base.spice : '', duration || ''].join(','));
      return;
    }
    filters.zone = base.zone; filters.spice = base.spice != null ? spiceGroupOf(base.spice) : null; filters.duration = duration || null; filters.shape = null;
    filters.search = ''; filters.starredOnly = false;
    if(els.searchBox) els.searchBox.value = '';
    renderFilters(); renderWorkoutCards();
    hideSide(); closeLog();
  }
  function showDetail(rec){
    if(rec.planned){ showPlanDetail(rec); return; }
    els.logAdd.style.display = '';
    var indoor = rec.type === 'indoor';
    var typeLabel = indoor ? 'Indoor ride' : typeSpec(rec.type).label;
    var editBtn = indoor
      ? '<button type="button" class="lf-hbtn edit" id="dvFull" title="Open full view — export, Strava sync" aria-label="Full view">' + EXPAND_SVG + '</button>'
      : '<button type="button" class="lf-hbtn edit" id="dvEdit" title="Edit this activity" aria-label="Edit">' + PENCIL_SVG + '</button>';
    var routeHtml = rec.route ? '<div class="lf-route">' + routeSvg(decodePolyline(rec.route), 246, 120) + '</div>' : '';
    var rpeHtml = rec.rpe
      ? '<div class="dv-rpe">RPE <b>' + rec.rpe + '</b> / 10</div>'
      : '<div class="rpe-row dv-rpe-set" id="dvRpe"><span class="rpe-label">Rate this session <em>RPE 1–10</em></span><span class="rpe-btns">' +
          [1,2,3,4,5,6,7,8,9,10].map(function(n){ return '<button type="button" data-rpe="' + n + '">' + n + '</button>'; }).join('') +
        '</span></div>';
    var noteHtml = rec.note ? '<p class="dv-note">' + esc(rec.note) + '</p>' : '';
    // When the ride is on Strava, a link straight to it (brand mark keeps its
    // orange, open-in-new-window glyph so it reads as external). When it's a
    // local indoor ride not yet on Strava, the same spot offers to Sync it.
    var stravaLink = rec.stravaActivityId
      ? '<a class="dv-strava" href="https://www.strava.com/activities/' + rec.stravaActivityId + '" ' +
          'target="_blank" rel="noopener noreferrer" title="Open this activity on Strava">' +
          STRAVA_SVG + '<span>View on Strava</span>' + EXTLINK_SVG +
        '</a>'
      : (rec.type === 'indoor' && rec.samples && rec.samples.length
          ? '<button type="button" class="dv-strava dv-strava-sync" id="dvStravaSync" title="Open this ride and sync it to Strava">' +
              STRAVA_SVG + '<span>Sync to Strava</span>' + UPLOAD_SVG +
            '</button>'
          : '');
    var titleBlock =
      '<div class="dv-title">' +
        '<span class="dv-name">' + esc(entryName(rec)) + '</span>' +
        '<span class="dv-sub"><i style="background:' + entryColor(rec) + '"></i>' + typeLabel + ' · ' + prettyDate(rec.day) + '</span>' +
        stravaLink +
      '</div>';
    // Delete now lives inside the edit flow (edit → form → trash), so the detail
    // header is just edit + close.
    var btns = '<div class="lf-head-btns">' + editBtn +
      '<button type="button" class="lf-hbtn cancel" id="dvClose" title="Close" aria-label="Close">' + CLOSE_SVG + '</button>' +
      '</div>';
    // With a route, the title / type / date sit on one line beside the map,
    // bottom-aligned; the map is bare (no frame). Otherwise the usual header.
    var head = rec.route
      ? '<div class="dv-head has-route">' + btns +
          '<div class="dv-title-route">' + titleBlock +
            '<div class="lf-route bare">' + routeSvg(decodePolyline(rec.route), 168, 108) + '</div>' +
          '</div>' +
        '</div>'
      : '<div class="log-side-head">' + titleBlock + btns + '</div>';
    els.logAdd.innerHTML =
      '<div class="log-detail">' + head +
        '<div class="dv-stats">' + detailStats(rec) + '</div>' +
        '<div class="dv-graph-wrap" id="dvGraph"></div>' +
        rpeHtml + noteHtml +
      '</div>';
    selectedId = rec.id; markSelected();
    renderDetailGraph(rec);
    var full = els.logAdd.querySelector('#dvFull'); if(full) full.addEventListener('click', function(){ openSavedRide(rec.id); });
    var edit = els.logAdd.querySelector('#dvEdit'); if(edit) edit.addEventListener('click', function(){ showLogForm(rec); });
    // Sync to Strava opens the ride's full view, where the upload (and the
    // connect-first flow when signed out) already lives.
    var sync = els.logAdd.querySelector('#dvStravaSync'); if(sync) sync.addEventListener('click', function(){ openSavedRide(rec.id); });
    // One-click RPE: set, auto-save, and re-render as "RPE X/10". To change it
    // later, use the normal edit flow.
    var rpeBox = els.logAdd.querySelector('#dvRpe');
    if(rpeBox) rpeBox.addEventListener('click', function(e){
      var b = e.target.closest('[data-rpe]'); if(!b) return;
      rec.rpe = +b.getAttribute('data-rpe');
      showDetail(rec);
      ridePatch(rec.id, {rpe:rec.rpe}).then(function(){ renderLog(); refreshDoneMarks(); });
    });
    els.logAdd.querySelector('#dvClose').addEventListener('click', hideSide);
  }
  function hideSide(){ els.logAdd.style.display = 'none'; selectedId = null; markSelected(); }

  // ---- quick-log form (ride / run / gym) ----
  // The type picker rebuilds the fields; new and existing entries share the
  // form, and an existing one also gets Delete. On an existing entry the
  // identity (name / date / type) is shown read-only until the pencil is
  // pressed — those rarely change, and locking them stops a stray edit.
  function showLogForm(seed){
    var editing = !!seed.id;
    var type = seed.type === 'outdoor' ? 'ride' : (seed.type && MANUAL_TYPES[seed.type] ? seed.type : 'ride');
    var rpe = seed.rpe || null;
    var name = seed.name || '';
    var idLocked = false;   // in edit mode everything is editable

    els.logAdd.style.display = '';
    els.logAdd.innerHTML =
      '<div class="log-form">' +
        '<div class="log-side-head">' +
          '<h3>' + (editing ? 'Edit activity' : 'Log an activity') + '</h3>' +
          '<div class="lf-head-btns">' +
            '<button type="button" class="lf-hbtn save" id="lfSave" title="Save" aria-label="Save" style="display:none;">' + CHECK_SVG + '</button>' +
            '<button type="button" class="lf-hbtn del" id="lfDelete" title="Delete" aria-label="Delete"' + (editing ? '' : ' style="display:none;"') + '>' + TRASH_SVG + '</button>' +
            '<button type="button" class="lf-hbtn cancel" id="lfCancel" title="' + (editing ? 'Back to details' : 'Close') + '" aria-label="' + (editing ? 'Back to details' : 'Close') + '">' + (editing ? BACK_SVG : CLOSE_SVG) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="lf-identity" id="lfIdentity"></div>' +
        (seed.route ? '<div class="lf-route">' + routeSvg(decodePolyline(seed.route), 246, 120) + '</div>' : '') +
        '<div class="lf-fields" id="lfFields"></div>' +
        '<label>TSS <span class="lf-unit"><input type="number" id="lfTss" min="0" max="999" placeholder="optional" value="' + (seed.tss || '') + '"></span></label>' +
        '<label class="lf-note">Note <input type="text" id="lfNote" maxlength="80" placeholder="optional" value="' + (seed.note ? String(seed.note).replace(/"/g, '&quot;') : '') + '"></label>' +
        '<div class="rpe-row" id="lfRpe"><span class="rpe-label">RPE <em>1–10</em></span><span class="rpe-btns">' +
          [1,2,3,4,5,6,7,8,9,10].map(function(n){ return '<button type="button" data-rpe="' + n + '">' + n + '</button>'; }).join('') + '</span></div>' +
      '</div>';

    var groups = (seed.fields && seed.fields.groups) ? seed.fields.groups.slice() : [];
    var trioTouched = [];   // recency order of the distance/rate/time fields
    // Null until first saved; then re-saves update this id rather than adding.
    var currentId = editing ? seed.id : null;

    // One input per field, from the type's spec.
    function fieldInput(f){
      var seedF = seed.fields || {};
      if(f.kind === 'multi'){
        return '<div class="lf-field lf-multi"><span class="lf-flabel">' + f.label + '</span><div class="lf-multi-btns" id="lf_' + f.key + '">' +
          f.options.map(function(o){ return '<button type="button" data-g="' + o[0] + '" class="' + (groups.indexOf(o[0]) >= 0 ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') +
          '</div></div>';
      }
      var val = '';
      if(f.kind === 'time'){ val = seed.durationSec ? secToClock(seed.durationSec) : ''; }
      else if(f.kind === 'pace'){ val = seedF.paceSec ? secToClock(seedF.paceSec) : ''; }
      else { val = (seedF[f.key] !== undefined && seedF[f.key] !== null) ? seedF[f.key] : ''; }
      var isNum = f.kind === 'num';
      var ph = f.kind === 'time' ? 'h:mm:ss' : f.kind === 'pace' ? 'm:ss' : 'optional';
      return '<label class="lf-field"><span class="lf-flabel">' + f.label + '</span><span class="lf-unit">' +
        '<input ' + (isNum ? 'type="number" inputmode="decimal"' + (f.step ? ' step="' + f.step + '"' : '') + ' min="0"' : 'type="text"') +
        ' id="lf_' + f.key + '" data-kind="' + f.kind + (f.trio ? '" data-trio="' + f.trio : '') + (f.rate ? '" data-rate="' + f.rate : '') +
        '" placeholder="' + ph + '" value="' + val + '">' + (f.unit ? '<em>' + f.unit + '</em>' : '') + '</span></label>';
    }

    function renderFields(){
      els.logAdd.querySelector('#lfFields').innerHTML = typeSpec(type).fields.map(fieldInput).join('');
      wireTrio();
      var mb = els.logAdd.querySelector('.lf-multi-btns');
      if(mb) mb.addEventListener('click', function(e){
        var b = e.target.closest('[data-g]'); if(!b) return;
        var g = b.getAttribute('data-g'), i = groups.indexOf(g);
        if(i >= 0) groups.splice(i, 1); else groups.push(g);
        b.classList.toggle('on', groups.indexOf(g) >= 0);
        markDirty();
      });
    }

    // distance / rate / time reconcile: fill whichever the rider omitted.
    function wireTrio(){
      var box = els.logAdd.querySelector('#lfFields');
      var dEl = box.querySelector('[data-trio="dist"]'), rEl = box.querySelector('[data-trio="rate"]'), tEl = box.querySelector('[data-trio="time"]');
      if(!dEl || !tEl || !rEl) return;   // gym has no trio
      function num(el){ var v = parseFloat(el.value); return isNaN(v) ? null : v; }
      function recompute(changed){
        // Newest first. The two most-recently-touched fields are authoritative;
        // the third is the one we fill.
        trioTouched = [changed].concat(trioTouched.filter(function(x){ return x !== changed; }));
        var dist = num(dEl), time = clockToSec(tEl.value), rate = rEl.value.trim();
        var rateKind = rEl.getAttribute('data-rate');
        var rateVal = rateKind === 'pace' ? clockToSec(rate) : (rate === '' ? null : parseFloat(rate));
        var recent = trioTouched.slice(0, 2);
        var fill = ['dist','rate','time'].filter(function(x){ return recent.indexOf(x) < 0; })[0];
        if(fill === 'time' && dist && rateVal){
          tEl.value = secToClock(rateKind === 'pace' ? rateVal * dist : dist / rateVal * 3600);
        } else if(fill === 'rate' && dist && time){
          rEl.value = rateKind === 'pace' ? secToClock(time / dist) : Math.round(dist / (time / 3600) * 10) / 10;
        } else if(fill === 'dist' && rateVal && time){
          dEl.value = Math.round((rateKind === 'pace' ? time / rateVal : rateVal * (time / 3600)) * 100) / 100;
        }
      }
      dEl.addEventListener('input', function(){ recompute('dist'); });
      rEl.addEventListener('input', function(){ recompute('rate'); });
      tEl.addEventListener('input', function(){ recompute('time'); });
    }

    // Name and date are always editable in edit mode. The type can be chosen
    // when logging something new, but not changed on an existing entry — the
    // fields and any imported data belong to that type, so it stays fixed.
    function renderIdentity(){
      var box = els.logAdd.querySelector('#lfIdentity');
      var typeCtrl = editing
        ? '<div class="lf-static-type"><i style="background:' + typeSpec(type).color + '"></i>' + typeSpec(type).label + '</div>'
        : '<div class="log-types">' + Object.keys(MANUAL_TYPES).map(function(k){
            return '<button type="button" data-type="' + k + '" class="' + (type === k ? 'on' : '') + '" style="--c:' + MANUAL_TYPES[k].color + '"><i></i>' + MANUAL_TYPES[k].label + '</button>';
          }).join('') + '</div>';
      box.innerHTML =
        '<label class="lf-name">Name <input type="text" id="lfName" maxlength="60" placeholder="' + typeSpec(type).label + '" value="' + esc(name) + '"></label>' +
        typeCtrl +
        '<label class="lf-date">Date <input type="date" id="lfDate" value="' + (seed.day || dayKey(Date.now())) + '"></label>';
      var picker = box.querySelector('.log-types');
      if(picker) picker.addEventListener('click', function(e){
        var b = e.target.closest('[data-type]'); if(!b) return;
        type = b.getAttribute('data-type'); groups = []; trioTouched = [];
        [].forEach.call(box.querySelectorAll('[data-type]'), function(x){ x.classList.toggle('on', x === b); });
        renderFields();
        markDirty();
      });
      var nm = box.querySelector('#lfName');
      if(nm) nm.addEventListener('input', function(){ name = this.value; });
    }

    renderIdentity();
    renderFields();
    paintRpeBtns(els.logAdd.querySelector('#lfRpe'), rpe);

    // Save only appears once something's been changed. Any field input, or a
    // type / focus / RPE tap, marks the form dirty.
    function markDirty(){ var sb = els.logAdd.querySelector('#lfSave'); if(sb) sb.style.display = ''; }
    var formEl = els.logAdd.querySelector('.log-form');
    formEl.addEventListener('input', markDirty);
    formEl.addEventListener('change', markDirty);
    els.logAdd.querySelector('#lfRpe').addEventListener('click', function(e){
      var b = e.target.closest('[data-rpe]'); if(!b) return;
      var v = +b.getAttribute('data-rpe'); rpe = rpe === v ? null : v;
      paintRpeBtns(this, rpe); markDirty();
    });
    // Close: back to the read-only detail for an existing entry (discarding any
    // unsaved edits), or shut the panel for a brand-new one.
    els.logAdd.querySelector('#lfCancel').addEventListener('click', function(){
      if(currentId != null) showDetail(seed); else hideSide();
    });
    els.logAdd.querySelector('#lfSave').addEventListener('click', function(){
      // Date comes from the field when the identity is unlocked, else it's
      // unchanged from the existing entry.
      var dateEl = document.getElementById('lfDate');
      var day = dateEl ? dateEl.value : seed.day;
      if(!day) return;
      var spec = typeSpec(type), fields = {}, durationSec = null;
      spec.fields.forEach(function(f){
        var el = document.getElementById('lf_' + f.key);
        if(f.kind === 'multi'){ if(groups.length) fields.groups = groups.slice(); return; }
        if(f.kind === 'time'){ durationSec = clockToSec(el.value); return; }
        if(f.kind === 'pace'){ var pv = clockToSec(el.value); if(pv) fields.paceSec = pv; return; }
        var v = parseFloat(el.value); if(!isNaN(v)) fields[f.key] = v;
      });
      if(!(durationSec > 0)){ alert('Add a ' + (type === 'gym' || type === 'run' ? 'time' : 'duration') + ' so it counts toward the week.'); return; }
      var tss = parseInt(document.getElementById('lfTss').value, 10);
      var parts = day.split('-').map(Number);
      var noon = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0).getTime();
      // A record that's been saved keeps its timestamp unless the date was
      // actually changed (so an imported ride's real start time survives).
      var startMs = (currentId != null) ? (day !== seed.day ? noon : seed.startDateMs) : noon + (Date.now() % 1000);
      var id = (currentId != null) ? currentId : startMs;
      var nameEl = document.getElementById('lfName');
      var finalName = (nameEl ? nameEl.value : name || '').trim() || spec.label;
      var rec = {
        id: id, type:type, day:day, startDateMs:startMs,
        durationSec: durationSec, tss: isNaN(tss) ? null : tss, rpe:rpe,
        note: document.getElementById('lfNote').value.trim() || null,
        name: finalName, fields: fields, savedAt: Date.now()
      };
      // Preserve the Strava link, route, HR and cached streams on an edit.
      if(seed.stravaActivityId) rec.stravaActivityId = seed.stravaActivityId;
      if(seed.imported) rec.imported = true;
      if(seed.route) rec.route = seed.route;
      if(seed.avgHr != null) rec.avgHr = seed.avgHr;
      if(seed.maxHr != null) rec.maxHr = seed.maxHr;
      if(seed.streams) rec.streams = seed.streams;
      rideSave(rec).then(function(){
        // Save only — the panel stays open; the rider clicks X to close.
        // Track this record so a second save updates it instead of duplicating,
        // and reveal Delete now that there's something to delete.
        currentId = id; seed = rec;
        renderLog(); refreshDoneMarks();
        var delBtn = els.logAdd.querySelector('#lfDelete');
        if(delBtn) delBtn.style.display = '';
        // Flash the tick, then hide Save again — nothing to save until the next edit.
        var saveBtn = els.logAdd.querySelector('#lfSave');
        saveBtn.classList.remove('saved'); void saveBtn.offsetWidth; saveBtn.classList.add('saved');
        setTimeout(function(){ var sb = els.logAdd.querySelector('#lfSave'); if(sb){ sb.classList.remove('saved'); sb.style.display = 'none'; } }, 850);
      });
    });
    els.logAdd.querySelector('#lfDelete').addEventListener('click', function(){
      if(currentId == null) return;
      if(!confirm('Delete this activity?')) return;
      rideDelete(currentId).then(function(){ hideSide(); renderLog(); refreshDoneMarks(); });
    });
  }
  function paintRpeBtns(row, rpe){
    [].forEach.call(row.querySelectorAll('[data-rpe]'), function(x){ x.classList.toggle('on', +x.getAttribute('data-rpe') === rpe); });
  }

  // ---- import from Strava ----
  // The athlete's activities done elsewhere (outdoor rides, runs, gym) come
  // in as log entries, mapped onto the same fields as a manual entry. Rides
  // we synced here — and anything imported before — are skipped by id.
  var SPORT_MAP = {
    Ride:'ride', VirtualRide:'ride', MountainBikeRide:'ride', GravelRide:'ride', EBikeRide:'ride', Velomobile:'ride', Handcycle:'ride',
    Run:'run', TrailRun:'run', VirtualRun:'run', Walk:'run', Hike:'run',
    WeightTraining:'gym', Workout:'gym', Crossfit:'gym', HighIntensityIntervalTraining:'gym', Yoga:'gym', Pilates:'gym', Elliptical:'gym', StairStepper:'gym',
    // Everything else with no natural home lands in Gym (time kept, name kept)
    // rather than being mislabelled a bike ride.
    Swim:'gym', Rowing:'gym', Kayaking:'gym', Canoeing:'gym', StandUpPaddling:'gym', Rock:'gym', Golf:'gym', Skateboard:'gym', Soccer:'gym'
  };
  function mapSport(a){
    var t = SPORT_MAP[a.sport_type || a.type];
    return t || 'gym';   // unknown → Gym (editable after); never a false bike ride
  }
  function stravaToRecord(a){
    var type = mapSport(a), startMs = Date.parse(a.start_date), sec = a.moving_time || a.elapsed_time || 0;
    var fields = {};
    var km = a.distance ? Math.round(a.distance / 1000 * 100) / 100 : null;
    if(km) fields.distanceKm = km;
    if(a.total_elevation_gain) fields.elevationM = Math.round(a.total_elevation_gain);
    if(a.average_watts) fields.avgPower = Math.round(a.average_watts);
    if(type === 'ride' && sec > 0 && km) fields.avgSpeedKmh = Math.round(km / (sec / 3600) * 10) / 10;
    if(type === 'run' && km && sec > 0) fields.paceSec = Math.round(sec / km);
    // TSS from Strava's normalised power (weighted_average_watts) at our FTP.
    var np = a.weighted_average_watts, tss = null;
    if(np && hasFtp() && sec > 0){ var IF = np / ftp; tss = Math.round(sec / 3600 * IF * IF * 100); }
    var rec = {
      id: startMs, type:type, day:dayKey(startMs), startDateMs:startMs,
      durationSec: sec, tss:tss, name: a.name || typeSpec(type).label, fields:fields,
      stravaActivityId: a.id, imported:true, savedAt: Date.now()
    };
    // The route shape, so the rider recognises the ride. Only GPS activities
    // carry one; the list endpoint returns it as map.summary_polyline.
    if(a.map && a.map.summary_polyline) rec.route = a.map.summary_polyline;
    // Summary heart rate, so the detail pane isn't missing HR entirely.
    if(a.average_heartrate) rec.avgHr = Math.round(a.average_heartrate);
    if(a.max_heartrate) rec.maxHr = Math.round(a.max_heartrate);
    // For the FTP check (08f): normalised power, and whether it came from a real
    // power meter — without one Strava *estimates* watts, which mustn't count.
    // Virtual rides (Zwift etc.) are indoor power, so they skip the outdoor allowance.
    if(type === 'ride'){
      if(np) fields.np = Math.round(np);
      rec.devWatts = !!a.device_watts;
      rec.virtual = (a.sport_type || a.type) === 'VirtualRide' || !!a.trainer;
    }
    return rec;
  }
  function showImportPanel(){
    if(!stravaConnected()){
      if(confirm('Connect to Strava to import your activities? You’ll come back here after.')) stravaConnect();
      return;
    }
    if(!stravaCanRead()){
      alert('This Strava connection can’t read your activities. Disconnect and reconnect, keeping "View data about your activities" ticked.');
      return;
    }
    els.logAdd.style.display = '';
    els.logAdd.innerHTML = '<div class="log-import"><h3>Import from Strava</h3><p class="log-import-msg">Fetching your recent activities…</p></div>';
    var days = 90;
    Promise.all([stravaFetchActivities(Date.now() - days * 86400000), rideAll()]).then(function(res){
      var acts = res[0], have = {};
      res[1].forEach(function(r){ markStravaHave(have, r); });
      var rows = acts.map(function(a){ return {a:a, rec:stravaToRecord(a), inLog: !!have[a.id]}; })
                     .sort(function(x, y){ return y.rec.startDateMs - x.rec.startDateMs; });
      renderImportRows(rows, days);
    }).catch(function(e){
      els.logAdd.querySelector('.log-import').innerHTML = '<h3>Import from Strava</h3><p class="log-error">' + (e && e.message || 'Couldn’t reach Strava.') + '</p>' +
        '<div class="log-form-actions"><button type="button" class="action-btn" id="impClose">Close</button></div>';
      els.logAdd.querySelector('#impClose').addEventListener('click', hideSide);
    });
  }
  function fmtDayShort(ms){
    var d = new Date(ms), mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + mons[d.getMonth()];
  }
  function renderImportRows(rows, days){
    var newCount = rows.filter(function(r){ return !r.inLog; }).length;
    var body = rows.length ? rows.map(function(r, i){
      return '<label class="imp-row' + (r.inLog ? ' in-log' : '') + '">' +
        '<input type="checkbox" data-i="' + i + '"' + (r.inLog ? ' disabled' : ' checked') + '>' +
        '<span class="imp-date">' + fmtDayShort(r.rec.startDateMs) + '</span>' +
        '<span class="imp-dot" style="--c:' + typeSpec(r.rec.type).color + '"></span>' +
        '<span class="imp-type">' + typeSpec(r.rec.type).label + '</span>' +
        '<span class="imp-name">' + esc(r.a.name || typeSpec(r.rec.type).label) + '</span>' +
        (r.inLog ? '<span class="imp-tag">in log</span>' : '') +
      '</label>';
    }).join('') : '<p class="log-import-msg">No activities in the last ' + days + ' days.</p>';
    els.logAdd.querySelector('.log-import').innerHTML =
      '<h3>Import from Strava <span class="imp-count">' + newCount + ' new · last ' + days + ' days</span></h3>' +
      (newCount ? '<div class="imp-bulk"><button type="button" class="imp-link" id="impAll">Select all</button><button type="button" class="imp-link" id="impNone">Clear selection</button></div>' : '') +
      '<div class="imp-list">' + body + '</div>' +
      '<div class="log-form-actions">' +
        (newCount ? '<button type="button" class="action-btn primary" id="impSave">Import selected</button>' : '') +
        '<button type="button" class="action-btn" id="impClose">Close</button>' +
      '</div>';
    var listEl = els.logAdd.querySelector('.imp-list');
    function boxes(){ return [].slice.call(listEl.querySelectorAll('input[type=checkbox]:not([disabled])')); }
    var all = els.logAdd.querySelector('#impAll'); if(all) all.addEventListener('click', function(){ boxes().forEach(function(b){ b.checked = true; }); });
    var none = els.logAdd.querySelector('#impNone'); if(none) none.addEventListener('click', function(){ boxes().forEach(function(b){ b.checked = false; }); });
    els.logAdd.querySelector('#impClose').addEventListener('click', hideSide);
    var save = els.logAdd.querySelector('#impSave');
    if(save) save.addEventListener('click', function(){
      var picked = boxes().filter(function(b){ return b.checked; }).map(function(b){ return rows[+b.getAttribute('data-i')].rec; });
      if(!picked.length){ hideSide(); return; }
      save.disabled = true; save.textContent = 'Importing…';
      picked.reduce(function(p, rec){ return p.then(function(){ return rideSave(rec); }); }, Promise.resolve())
        .then(dedupeIndoorTwins)
        .then(function(){ hideSide(); renderLog(); refreshDoneMarks(); });
    });
  }
  els.logImportStrava.addEventListener('click', showImportPanel);

  els.logBtn.addEventListener('click', openLog);
  els.logCloseBtn.addEventListener('click', closeLog);
  els.logPrev.addEventListener('click', function(){ shiftLogMonth(-1); });
  els.logNext.addEventListener('click', function(){ shiftLogMonth(1); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && els.logModal.style.display !== 'none') closeLog();
  });
