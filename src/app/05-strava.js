  // ============================================================
  // STRAVA (OAuth + upload, all from the page)
  // ============================================================
  // Strava's token and upload endpoints answer cross-origin requests, so no
  // server is needed. The client id/secret are entered once and live in this
  // browser's storage — never in the file, so a public repo stays clean.
  var STRAVA_KEY = 'ftpPlan_strava_v1';
  // activity:read lets the ride log import the athlete's own activities.
  // activity:write stays for uploading rides done here.
  var STRAVA_SCOPE = 'read,activity:read,activity:write';
  // The app's id is public; its secret lives in the Worker, which does the
  // code/token exchange on the page's behalf. So Connect is one click.
  var STRAVA_APP_ID = '248261';
  var STRAVA_PROXY = 'https://strava-proxy.nomtron.workers.dev';
  var strava = loadStrava();
  function loadStrava(){ try{ return JSON.parse(localStorage.getItem(STRAVA_KEY)) || {}; }catch(e){ return {}; } }
  function saveStrava(){ try{ localStorage.setItem(STRAVA_KEY, JSON.stringify(strava)); }catch(e){} }
  function stravaConnected(){ return !!strava.refreshToken; }
  // Same page, minus any query string: works on localhost and on the hosted site.
  function stravaRedirectUri(){ return location.origin + location.pathname; }

  async function stravaTokenRequest(params){
    var route = params.grant_type === 'refresh_token' ? '/refresh' : '/exchange';
    var res = await fetch(STRAVA_PROXY + route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(params)});
    var json = await res.json().catch(function(){ return {}; });
    if(!res.ok){ var err = new Error(json.message || ('HTTP ' + res.status)); err.status = res.status; throw err; }
    strava.accessToken = json.access_token;
    strava.refreshToken = json.refresh_token;
    strava.expiresAt = json.expires_at;             // unix seconds
    if(json.athlete) strava.athlete = {id:json.athlete.id, name:(json.athlete.firstname || '') + ' ' + (json.athlete.lastname || '')};
    saveStrava();
  }
  // Whether the athlete granted a given scope. Recorded from the OAuth
  // callback, since the token endpoints don't echo it back.
  function stravaHasScope(s){ return (strava.scope || '').split(',').indexOf(s) >= 0; }
  function stravaCanRead(){ return stravaHasScope('activity:read') || stravaHasScope('activity:read_all'); }

  // The athlete's own activities since `sinceMs`, newest first. One request per
  // 100; capped so a very active athlete can't spend the whole rate budget.
  async function stravaFetchActivities(sinceMs){
    var token = await stravaAccessToken();
    var perPage = 100, after = Math.floor(sinceMs / 1000), out = [];
    for(var page = 1; page <= 5; page++){
      var url = 'https://www.strava.com/api/v3/athlete/activities?per_page=' + perPage + '&page=' + page + '&after=' + after;
      var res = await fetch(url, {headers:{Authorization:'Bearer ' + token}});
      if(res.status === 401 || res.status === 403){
        throw new Error('Strava didn’t allow reading your activities — reconnect and keep "View data about your activities" ticked.');
      }
      if(!res.ok){ var j = await res.json().catch(function(){ return {}; }); throw new Error(j.message || ('HTTP ' + res.status)); }
      var arr = await res.json();
      if(!Array.isArray(arr)) break;
      out = out.concat(arr);
      if(arr.length < perPage) break;
    }
    return out;
  }

  // Time-series for one activity, normalised and downsampled (~300 points) for
  // the detail-pane graph: heart rate, watts and pace (from velocity). Returns
  // null when the activity has no streams (e.g. a manual entry on Strava).
  // Full-resolution power for one activity, as a 1-second array, for the FTP
  // check's outdoor best efforts. (stravaFetchStreams below downsamples to ~300
  // points for charts, which would blur 5–20 min bests.) Short recording gaps
  // (smart recording, ≤5 s) hold the last value; longer gaps — stops — count as
  // zero, so a best effort can't straddle a café stop. Errors carry .status
  // (429 = Strava's app-wide rate limit) so callers can back off.
  async function stravaFetchPowerStream(id){
    var token = await stravaAccessToken();
    var res = await fetch('https://www.strava.com/api/v3/activities/' + id + '/streams?keys=time,watts&key_by_type=true', {headers:{Authorization:'Bearer ' + token}});
    if(res.status === 404) return null;
    if(!res.ok){ var e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    var d = await res.json();
    var t = (d.time && d.time.data) || [], w = (d.watts && d.watts.data) || [];
    if(!t.length || !w.length) return null;
    var out = [];
    for(var i = 0; i < t.length; i++){
      var gap = Math.max(1, Math.min(3600, (i + 1 < t.length ? t[i + 1] : t[i] + 1) - t[i])), v = w[i] || 0;
      for(var k = 0; k < gap; k++) out.push(k < 5 ? v : 0);
    }
    return out;
  }

  async function stravaFetchStreams(id){
    var token = await stravaAccessToken();
    var url = 'https://www.strava.com/api/v3/activities/' + id + '/streams?keys=time,heartrate,watts,velocity_smooth&key_by_type=true';
    var res = await fetch(url, {headers:{Authorization:'Bearer ' + token}});
    if(res.status === 404) return null;
    if(!res.ok){ var j = await res.json().catch(function(){ return {}; }); throw new Error(j.message || ('HTTP ' + res.status)); }
    var d = await res.json();
    var t = (d.time && d.time.data) || [];
    if(!t.length) return null;
    var hr = (d.heartrate && d.heartrate.data) || [], w = (d.watts && d.watts.data) || [], v = (d.velocity_smooth && d.velocity_smooth.data) || [];
    var n = t.length, step = Math.max(1, Math.ceil(n / 300));
    function bucket(arr, i){ if(!arr.length) return null; var s = 0, c = 0; for(var k = i; k < i + step && k < n; k++){ if(arr[k] != null){ s += arr[k]; c++; } } return c ? s / c : null; }
    var T = [], H = [], P = [], PA = [];
    for(var i = 0; i < n; i += step){
      T.push(t[i]);
      var hv = bucket(hr, i); H.push(hv != null ? Math.round(hv) : null);
      var wv = bucket(w, i); P.push(wv != null ? Math.round(wv) : null);
      var vv = bucket(v, i); PA.push(vv && vv > 0.5 ? Math.round(1000 / vv) : null);   // m/s → sec/km
    }
    return {t:T, hr:H, watts:P, pace:PA};
  }

  // Access tokens last six hours; refresh a minute early.
  async function stravaAccessToken(){
    if(!stravaConnected()) throw new Error('Strava is not connected');
    if(!strava.accessToken || !strava.expiresAt || strava.expiresAt - Date.now() / 1000 < 60){
      try{
        await stravaTokenRequest({grant_type:'refresh_token', refresh_token:strava.refreshToken});
      }catch(e){
        // Only a token Strava *rejects* (400/401) is dead — drop the stale
        // "connected" state so the UI stops lying and the rider is asked to
        // reconnect, instead of every sync failing silently against a ghost
        // session. A network blip or 5xx is transient: keep the session.
        if(e && (e.status === 400 || e.status === 401)){
          stravaForget();
          throw new Error('Strava session expired — please reconnect.');
        }
        throw e;
      }
    }
    return strava.accessToken;
  }
  // Checked on every load: if a remembered session's token is due (or missing),
  // refresh it now to confirm it's really live. If the refresh token has been
  // revoked or expired, drop the connection — so the app never shows a
  // signed-out athlete as "connected", the exact stale state that was silently
  // breaking indoor-ride sync.
  async function stravaValidateSession(){
    if(!stravaConnected()) return;
    // Always confirm with Strava on load — a token that still looks valid by its
    // local expiry can have been revoked on Strava's side (or the whole app
    // de-authorised). A refresh proves it's really live, or drops it. This is the
    // fix for "shows connected but it isn't": the status can no longer lie.
    try{ await stravaTokenRequest({grant_type:'refresh_token', refresh_token:strava.refreshToken}); }
    catch(e){ if(e && (e.status === 400 || e.status === 401)) stravaForget(); }   // only drop a token Strava rejects, not a network blip
    updateStravaUI();
  }

  function stravaConnect(){
    location.href = 'https://www.strava.com/oauth/authorize?client_id=' + encodeURIComponent(STRAVA_APP_ID) +
      '&response_type=code&redirect_uri=' + encodeURIComponent(stravaRedirectUri()) +
      '&approval_prompt=auto&scope=' + encodeURIComponent(STRAVA_SCOPE);
  }

  // Back from the consent screen: ?code=…&scope=… (or ?error=access_denied).
  async function stravaHandleCallback(){
    var q = new URLSearchParams(location.search);
    if(!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', location.pathname);   // tidy the URL either way
    if(q.get('error')){
      els.bleWarning.style.display = 'block';
      els.bleWarning.textContent = 'Strava access was declined (' + q.get('error') + ').';
      return;
    }
    var granted = q.get('scope') || '';
    if(granted.indexOf('activity:write') < 0){
      els.bleWarning.style.display = 'block';
      els.bleWarning.textContent = 'Strava connected without upload permission — reconnect and tick "Upload your activities".';
    }
    try{
      await stravaTokenRequest({grant_type:'authorization_code', code:q.get('code')});
      strava.scope = granted;   // remember what was granted, for the import feature
      saveStrava();
    }catch(e){
      els.bleWarning.style.display = 'block';
      els.bleWarning.textContent = 'Strava sign-in failed: ' + e.message + ' — try Connect again in a moment.';
    }
    updateStravaUI();
    // Just connected: pull recent activity straight away so the charts and the
    // readiness card are current without the rider opening the calendar.
    if(stravaConnected() && typeof maybeAutoSync === 'function') maybeAutoSync();
  }

  function stravaDisconnect(){
    // Best effort: tell Strava to revoke, then forget the tokens.
    var tok = strava.accessToken;
    if(tok) fetch('https://www.strava.com/oauth/deauthorize', {method:'POST', body:new URLSearchParams({access_token:tok})}).catch(function(){});
    stravaForget();
  }
  // Forget a dead session without the network deauthorize call (the token is
  // already invalid). Shared by stravaDisconnect and the self-heal paths.
  function stravaForget(){ strava = {}; saveStrava(); updateStravaUI(); }

  function updateStravaUI(){
    var on = stravaConnected();
    var first = on ? (((strava.athlete && strava.athlete.name) || '').trim().split(/\s+/)[0]) : '';
    // The Strava row: athlete's first name + "Log Out" when connected, else
    // "Strava" + "Log In".
    els.stravaLabel.textContent = on ? (first || 'Strava') : 'Strava';
    if(els.stravaAction) els.stravaAction.textContent = on ? 'Log Out' : 'Log In';
    els.stravaBtn.classList.toggle('on', on);
    els.stravaBtn.title = on ? 'Logged in to Strava — tap to log out' : 'Log in with Strava';
    // The summary's Strava button stays visible whether or not we're connected —
    // when disconnected it reads "Connect & sync to" and runs the connect-then-post
    // flow. Only an already-synced ride hides it. (Gating it on connection here
    // used to race showSummary and hide the connect button.)
    if(!els.summaryStravaBtn.classList.contains('busy')){
      els.summaryStravaBtn.style.display = (typeof liveState !== 'undefined' && liveState.stravaActivityId) ? 'none' : '';
      els.summaryStravaText.textContent = on ? 'Sync to' : 'Connect & sync to';
    }
    if(els.connStravaDot) els.connStravaDot.className = 'device-dot ' + (on ? 'on' : 'off');
    if(els.connStravaName) els.connStravaName.textContent = first || 'Strava';
    // The readiness card is gated on a Strava connection — repaint it so the
    // connect prompt and the scores swap as the session comes and goes.
    if(typeof refreshReadiness === 'function') refreshReadiness();
  }

  // One row now: tap to log in when out, to log out when in.
  els.stravaBtn.addEventListener('click', function(){
    if(stravaConnected()) stravaDisconnect(); else stravaConnect();
  });

  // One plain-English line of heart-rate drift for the activity description.
  // Method (shape-agnostic): keep the WORKING samples only — a step that isn't a
  // warm-up/cool-down ramp or a recovery (below `CUT`% FTP), so steady bodies,
  // interval on-legs and over/unders stay, warmups/cooldowns/rests drop. Split
  // that into first vs second half by work-time and compare power:HR (aerobic
  // decoupling). Samples carry their plan-second as `p`, so skipped segments map
  // correctly. Returns '' (no line) when it can't be read cleanly: no HR, too
  // little work, or the two halves sit at different powers (a ladder/ramp, where
  // HR simply follows the prescribed step-up rather than drifting).
  function hrDriftLine(samples, flat){
    if(!samples || !flat || !flat.length || samples.length < 600) return '';
    var CUT = 60, mask = [], i, s;
    for(i = 0; i < flat.length; i++){
      var st = flat[i];
      var ramp = (typeof isRamp === 'function') && isRamp(st);
      var work = !st.prep && !ramp && st.pct != null && st.pct >= CUT;
      var sec = Math.round((st.min || 0) * 60);
      for(s = 0; s < sec; s++) mask.push(work);
    }
    var work = [];
    for(i = 0; i < samples.length; i++){
      var sm = samples[i], idx = (sm.p || i + 1) - 1;
      if(mask[idx] && sm.hr != null && sm.power != null) work.push(sm);
    }
    if(work.length < 300) return '';                 // under ~5 min of usable work
    var half = Math.floor(work.length / 2);
    function avg(arr, key){ var t = 0; for(var k = 0; k < arr.length; k++) t += arr[k][key]; return t / arr.length; }
    var a = work.slice(0, half), b = work.slice(half);
    var p1 = avg(a, 'power'), h1 = avg(a, 'hr'), p2 = avg(b, 'power'), h2 = avg(b, 'hr');
    if(!h1 || !h2 || !p1) return '';
    if(Math.abs(p2 - p1) / p1 > 0.05) return '';     // ramping effort — drift is prescribed, skip
    var dec = Math.round(((p1 / h1) - (p2 / h2)) / (p1 / h1) * 100);
    var word = dec <= 5 ? 'Held Strong' : (dec <= 8 ? 'Faded a Little' : 'Faded Hard');
    return 'HR drift ' + Math.round(h1) + ' → ' + Math.round(h2) + ' bpm (' + word + ': ' + (dec >= 0 ? '+' : '−') + Math.abs(dec) + '%)';
  }

  // Upload the ride just finished. Strava processes uploads asynchronously,
  // so poll until it hands back an activity id (or an error, e.g. duplicate).
  async function stravaUpload(){
    var btn = els.summaryStravaBtn, status = els.summaryStravaStatus, link = els.summaryStravaLink;
    var wo = liveState.workout;
    function say(msg, err){ status.style.display = 'block'; status.textContent = msg; status.classList.toggle('err', !!err); }
    btn.disabled = true; btn.classList.add('busy'); els.summaryStravaText.textContent = 'Syncing…'; link.style.display = 'none';
    say('Sending the ride to Strava…');
    try{
      var token = await stravaAccessToken();
      var bytes = buildFitActivity(liveState.samples, liveState.startDateMs, liveState.laps);
      var fd = new FormData();
      fd.append('file', new Blob([bytes], {type:'application/octet-stream'}), exportBasename() + '.fit');
      fd.append('data_type', 'fit');
      fd.append('name', wo ? wo.name : 'Indoor ride');
      if(wo){
        // Same figures as the detail pane: the plan's zone, time in zone,
        // TSS and normalised power at the FTP it was ridden with.
        var zl = (ZONES[wo.zone] || ZONES.endurance).label;
        var desc = wo.test
          ? zl + ' · ' + wo.durationMin + ' min'
          : zl + ' · ' + wo.workMin + ' min in zone · TSS ' + wo.tss + ' · Normalised ' + planPower(wo).np + ' W';
        // Heart-rate drift of the working sets on its own line (plain-English
        // verdict + the numbers). Omitted for tests, ramps/ladders, and rides
        // without enough clean HR.
        if(!wo.test){ var drift = hrDriftLine(liveState.samples, liveState.flat); if(drift) desc += '\n' + drift; }
        fd.append('description', desc);
      }
      fd.append('trainer', '1');
      var res = await fetch('https://www.strava.com/api/v3/uploads', {method:'POST', headers:{Authorization:'Bearer ' + token}, body:fd});
      var up = await res.json().catch(function(){ return {}; });
      if(!res.ok) throw new Error(up.message || ('HTTP ' + res.status));
      if(up.error) throw new Error(up.error);
      els.summaryStravaText.textContent = 'Processing…';
      say('Strava is processing the file…');
      var id = up.id, activityId = null, err = null;
      for(var i = 0; i < 30 && !activityId && !err; i++){
        await sleepMs(2000);
        var r = await fetch('https://www.strava.com/api/v3/uploads/' + id, {headers:{Authorization:'Bearer ' + token}});
        var st = await r.json().catch(function(){ return {}; });
        if(st.error) err = st.error;
        else if(st.activity_id) activityId = st.activity_id;
      }
      if(err) throw new Error(err);
      if(!activityId) throw new Error('Strava is still processing — check your feed in a minute.');
      // The FIT file already says virtual_activity, which is how Strava files
      // a Virtual Ride. This is the belt to that's braces: set the sport type
      // explicitly on the created activity, and shrug if it doesn't take —
      // the ride is uploaded either way.
      try{
        await fetch('https://www.strava.com/api/v3/activities/' + activityId, {
          method:'PUT',
          headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
          body:JSON.stringify({sport_type:'VirtualRide'})
        });
      }catch(e){ console.log('sport_type update skipped:', e && e.message); }
      btn.style.display = 'none';
      link.href = 'https://www.strava.com/activities/' + activityId;
      link.style.display = '';
      say('Synced. Attach the timeline image as a photo on the activity if you want it there.');
      liveState.stravaActivityId = activityId;
      patchCurrentRide({stravaActivityId:activityId});
    }catch(e){
      btn.disabled = false; btn.classList.remove('busy'); els.summaryStravaText.textContent = 'Sync to';
      say('Upload failed: ' + e.message, true);
    }
  }
  els.summaryStravaBtn.addEventListener('click', function(){
    if(stravaConnected()){ stravaUpload(); return; }
    // Park the ride, then connect. The consent step reloads the page, so reassure
    // the rider first: the ride is saved and they'll land back on this screen to
    // finish posting. A short beat so the message is read before we leave.
    stashRide(true);
    els.summaryStravaBtn.disabled = true;
    els.summaryStravaText.textContent = 'Opening Strava…';
    els.summaryStravaStatus.classList.remove('err');
    els.summaryStravaStatus.style.display = 'block';
    els.summaryStravaStatus.textContent = 'Your ride is saved ✓  Taking you to Strava to connect — you’ll come straight back to this screen to post it.';
    setTimeout(stravaConnect, 1600);
  });
