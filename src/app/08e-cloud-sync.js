  // ============================================================
  // CLOUD SYNC (Phase 0)
  // ============================================================
  // The ride log and planner follow the rider across devices. IndexedDB stays
  // the local, offline-first copy; this pushes local changes and pulls remote
  // ones to a small Cloudflare Worker, keyed by the Strava athlete id (Strava is
  // the identity — the Worker verifies the token). Records merge per-id by
  // `updatedAt`, last write wins; deletes travel as tombstones.
  //
  // The heavy per-second data (samples / streams / laps) stays on the device
  // that recorded it — only the light metadata syncs, so the cloud blob stays
  // small and a second device still gets the calendar, plans, stats and pies.
  //
  // Off until a sync URL is set. To enable, once the Worker is deployed:
  //   localStorage.setItem('ftpPlan_syncUrl', 'https://your-worker.workers.dev')
  var SYNC_PULLED_KEY = 'ftpPlan_syncPulledAt_v1';
  var HEAVY = ['samples', 'streams', 'laps'];
  // The deployed sync Worker. A localStorage override wins (set '' to disable).
  var SYNC_DEFAULT = 'https://ftp-sync.nomtron.workers.dev';
  function syncUrl(){
    try{ var u = localStorage.getItem('ftpPlan_syncUrl'); return ((u === null ? SYNC_DEFAULT : u) || '').replace(/\/+$/, ''); }
    catch(e){ return SYNC_DEFAULT; }
  }
  function cloudEnabled(){ return !!syncUrl() && typeof stravaConnected === 'function' && stravaConnected() && stravaCanRead(); }
  function lightRec(r){ var o = {}; Object.keys(r).forEach(function(k){ if(HEAVY.indexOf(k) < 0) o[k] = r[k]; }); return o; }

  // ---- the little cloud indicator in the calendar header ----
  var CS_TEXT = {syncing: 'Syncing…', synced: 'Synced', error: 'Offline'};
  var csFlashTimer = null;
  function cloudRest(){ return cloudEnabled() ? 'synced' : 'hidden'; }
  function setCloudStatus(state, text){
    var el = els.cloudStatus; if(!el) return;
    if(state === 'hidden'){ el.hidden = true; return; }
    el.hidden = false;
    el.className = 'cloud-status ' + state;
    var t = el.querySelector('.cs-text'); if(t) t.textContent = text || CS_TEXT[state] || '';
  }
  // A brief message (e.g. "3 new from Strava") that reverts to the resting state.
  function flashCloud(msg){
    if(!msg) return;
    clearTimeout(csFlashTimer);
    setCloudStatus('synced', msg);
    csFlashTimer = setTimeout(function(){ setCloudStatus(cloudRest()); }, 4000);
  }

  // ---- rider preferences (FTP / max HR / weight) ----
  // Kept as one special record (id 'prefs') in the same cloud blob, so the rider
  // numbers follow across devices. `applyPrefs` updates the app from a pulled copy
  // without looping back into a save.
  var applyingPrefs = false;
  function prefRecord(){
    return {id: 'prefs', pref: true,
      ftp: (typeof hasFtp === 'function' && hasFtp()) ? ftp : null,
      maxHr: maxHr || null,
      weight: (typeof hasWeight === 'function' && hasWeight()) ? weight : null};
  }
  function havePrefValues(){ return (typeof hasFtp === 'function' && hasFtp()) || maxHr || (typeof hasWeight === 'function' && hasWeight()); }
  function savePrefs(){ if(cloudEnabled()) rideSave(prefRecord()); }   // stamps updatedAt + nudges sync
  function applyPrefs(rec){
    applyingPrefs = true;
    try{
      if(rec.ftp != null && typeof setFtp === 'function') setFtp(rec.ftp);
      if(rec.maxHr != null && typeof setMaxHr === 'function') setMaxHr(rec.maxHr);
      if(rec.weight != null && typeof setWeight === 'function') setWeight(rec.weight);
    } finally { applyingPrefs = false; }
  }

  var syncing = false, syncQueued = false, syncTimer = null;
  // Debounced push-after-change: a burst of edits (e.g. a Strava import) becomes
  // one sync.
  function cloudSyncSoon(){ if(!cloudEnabled()) return; clearTimeout(syncTimer); syncTimer = setTimeout(cloudSync, 1500); }

  function cloudSync(){
    if(!cloudEnabled()){ setCloudStatus('hidden'); return Promise.resolve(); }
    if(syncing){ syncQueued = true; return Promise.resolve(); }
    syncing = true;
    clearTimeout(csFlashTimer); setCloudStatus('syncing');
    var url = syncUrl();
    var since = 0; try{ since = +localStorage.getItem(SYNC_PULLED_KEY) || 0; }catch(e){}
    return stravaAccessToken().then(function(token){
      return rideAllRaw().then(function(all){
        // First device to enable cloud: seed a prefs record from current values.
        if(!all.some(function(r){ return r.id === 'prefs'; }) && havePrefValues()){
          var pref = prefRecord(); pref.updatedAt = Date.now();
          rideApply(pref); all = all.concat([pref]);
        }
        // Push whatever changed since we last pulled (a little overlap for safety).
        var outgoing = all.map(function(r){ if(!r.updatedAt) r.updatedAt = r.savedAt || Date.now(); return r; })
                          .filter(function(r){ return (r.updatedAt || 0) > since - 5000; })
                          .map(lightRec);
        return fetch(url + '/sync', {
          method: 'POST',
          headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
          body: JSON.stringify({records: outgoing, since: since})
        });
      });
    }).then(function(res){
      if(!res.ok) throw new Error('sync HTTP ' + res.status);
      return res.json();
    }).then(function(data){
      var remote = (data && data.records) || [];
      return rideAllRaw().then(function(all){
        var byId = {}, maxSeen = since;
        all.forEach(function(r){ byId[r.id] = r; if((r.updatedAt || 0) > maxSeen) maxSeen = r.updatedAt; });
        var applied = 0;
        return remote.reduce(function(p, r){
          if((r.updatedAt || 0) > maxSeen) maxSeen = r.updatedAt;
          var local = byId[r.id];
          if(local && (local.updatedAt || 0) >= (r.updatedAt || 0)) return p;   // local is same-or-newer
          // Keep any heavy fields this device already holds — the remote copy is light.
          var merged = r;
          if(local) HEAVY.forEach(function(k){ if(local[k] !== undefined) merged[k] = local[k]; });
          applied++;
          return p.then(function(){ return rideApply(merged).then(function(){ if(merged.pref) applyPrefs(merged); }); });
        }, Promise.resolve()).then(function(){
          try{ localStorage.setItem(SYNC_PULLED_KEY, String(maxSeen)); }catch(e){}
          if(applied){ renderLog(); refreshDoneMarks(); }
          setCloudStatus('synced');
        });
      });
    }).catch(function(){ setCloudStatus('error'); /* Worker down / offline — retry next open */ })
      .then(function(){
        syncing = false;
        if(syncQueued){ syncQueued = false; return cloudSync(); }
      });
  }

  // Sweep tombstones once they've had ample time to reach every device.
  function rideGcTombstones(){
    var cut = Date.now() - 60 * 86400000;
    return rideAllRaw().then(function(all){
      var dead = all.filter(function(r){ return r.deleted && (r.updatedAt || 0) < cut; });
      if(!dead.length) return;
      return rideTx('readwrite', function(st){ dead.forEach(function(r){ st.delete(r.id); }); });
    }).catch(function(){});
  }
