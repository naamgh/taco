  // ============================================================
  // FITNESS COACH — Today / Next 4 weeks advice + the FTP check
  // ============================================================
  // Turns the Fitness numbers into something to act on.
  //   Today        — today's Form, yesterday's load and today's calendar plan
  //                  (preferred when there is one) -> a verdict + 1–2 workouts.
  //   Next 4 weeks — the last 4–6 weeks: how fast Fitness is climbing, build
  //                  weeks since a lighter one, and the easy/moderate/hard mix
  //                  -> what the coming block should look like.
  //   FTP check    — weighs several independent signals from recent sweet spot
  //                  / threshold rides (intensity actually ridden, HR at that
  //                  power vs your own history, HR drift, effort ratings, best
  //                  20 min) and only suggests a small change when most agree.
  // Everything renders inside the Fitness tabs (08d); the FTP chip in the top
  // bar gets a quiet hint when the check suggests a change.

  var ZONE_RANK = {recovery:0, endurance:1, tempo:2, sweetspot:3, threshold:4, vo2:5, anaerobic:6};

  // ---- per-ride effort summary (light, syncs) ----
  // The FTP check needs to know how a ride's sweet spot / threshold work went,
  // but cloud sync strips raw samples. So, like pbCurve, a few numbers are
  // stamped on the ride at save (and backfilled for older rides that still
  // have samples locally), over the plan's steady 84–110% FTP work:
  //   ratio — measured ÷ planned watts (the intensity trim actually ridden;
  //           in ERG the trainer holds target × trim, so this recovers it)
  //   cov   — share of that planned work actually ridden (skips cut it)
  //   pw/hr — averages where both were recorded, for HR-at-power trends
  //   dec   — HR drift (aerobic decoupling, %) when power held steady
  // null when the ride had under 10 min of such work (stored as false).
  var EFFORT_BAND = {lo:84, hi:110, minSec:600};
  function effortSummary(samples, key, rideFtp){
    if(!samples || !samples.length || !key || !rideFtp) return null;
    var wo = byKey(key);
    if(!wo || wo.test) return null;
    var pctAtSec = [], planSec = 0;
    expandBlocks(wo.blocks).forEach(function(st){
      var band = !st.prep && !isRamp(st) && st.pct !== null && st.pct >= EFFORT_BAND.lo && st.pct <= EFFORT_BAND.hi;
      var sec = Math.round((st.min || 0) * 60);
      for(var s = 0; s < sec; s++) pctAtSec.push(band ? st.pct : 0);
      if(band) planSec += sec;
    });
    if(planSec < EFFORT_BAND.minSec) return null;
    var seen = {}, rode = 0, pwSum = 0, tgSum = 0, both = [];
    samples.forEach(function(sm, i){
      var idx = (sm.p || i + 1) - 1, pct = pctAtSec[idx];
      if(!pct || seen[idx]) return;
      seen[idx] = true; rode++;
      if(sm.power === null || sm.power === undefined) return;
      pwSum += sm.power; tgSum += rideFtp * pct / 100;
      if(sm.hr) both.push(sm);
    });
    if(rode < EFFORT_BAND.minSec || !tgSum) return null;
    var out = {ratio:Math.round(pwSum / tgSum * 1000) / 1000, cov:Math.round(rode / planSec * 100) / 100, sec:rode, pw:null, hr:null, dec:null};
    if(both.length >= 300){
      var avg = function(a, k){ var t = 0; a.forEach(function(x){ t += x[k]; }); return t / a.length; };
      out.pw = Math.round(avg(both, 'power')); out.hr = Math.round(avg(both, 'hr'));
      var h = Math.floor(both.length / 2), a = both.slice(0, h), b = both.slice(h);
      var p1 = avg(a, 'power'), h1 = avg(a, 'hr'), p2 = avg(b, 'power'), h2 = avg(b, 'hr');
      // A rising effort (ladders) prescribes its own HR climb — no drift read.
      if(p1 && h1 && h2 && Math.abs(p2 - p1) / p1 <= 0.05) out.dec = Math.round(((p1 / h1) - (p2 / h2)) / (p1 / h1) * 1000) / 10;
    }
    return out;
  }
  // One-time (per ride) backfill, same pattern as pbBackfill. `false` marks a
  // ride as checked-but-not-qualifying so it isn't revisited. Waits for the
  // library: a ride's plan is looked up by key, and an unloaded library would
  // wrongly mark everything false.
  var effortBackfilled = false;
  function effortBackfill(){
    if(effortBackfilled || !WORKOUTS.length) return Promise.resolve();
    effortBackfilled = true;
    return rideAllRaw().then(function(all){
      var todo = all.filter(function(r){ return !r.deleted && !r.pref && r.type === 'indoor' && r.samples && r.samples.length && r.effort === undefined; });
      if(!todo.length) return;
      return Promise.all(todo.map(function(r){ r.effort = effortSummary(r.samples, r.key, r.ftp) || false; return rideSave(r); }))
        .then(function(){ refreshReadiness(); });
    }).catch(function(e){ console.log('effort backfill skipped:', e && e.message); });
  }

  // ---- outdoor power backfills (Strava) ----
  // 1) NP + "real power meter" flags for rides imported before the import kept
  //    them: one activities-list read (90 days), once per device.
  // 2) Best 5 / 8 / 20 min from full-resolution power, for recent hard rides
  //    with a power meter: a few per app open, once per ride, stored as the
  //    light `outBest` (syncs, so other devices don't refetch). Strava's rate
  //    limit is shared by every user of the app, so this stays frugal and stops
  //    on a 429. Easy (IF < 0.7) or short (< 20 min) rides are marked without a
  //    fetch — they can't hold a useful best effort.
  var NP_BACKFILL_KEY = 'ftpPlan_npBackfill_v1', OUT_FETCH_PER_OPEN = 6, outdoorRan = false;
  function stravaReadable(){ return typeof stravaConnected === 'function' && stravaConnected() && typeof stravaCanRead === 'function' && stravaCanRead(); }
  function npBackfill(){
    try{ if(localStorage.getItem(NP_BACKFILL_KEY)) return Promise.resolve(false); }catch(e){}
    return Promise.all([stravaFetchActivities(Date.now() - 90 * DAY_MS), rideAllRaw()]).then(function(res){
      var byId = {}; res[0].forEach(function(a){ byId[a.id] = a; });
      var todo = res[1].filter(function(r){ return !r.deleted && r.type === 'ride' && r.stravaActivityId && r.devWatts === undefined && byId[r.stravaActivityId]; });
      return Promise.all(todo.map(function(r){
        var a = byId[r.stravaActivityId];
        r.fields = r.fields || {};
        if(a.weighted_average_watts) r.fields.np = Math.round(a.weighted_average_watts);
        r.devWatts = !!a.device_watts;
        r.virtual = (a.sport_type || a.type) === 'VirtualRide' || !!a.trainer;
        return rideSave(r);
      })).then(function(){ try{ localStorage.setItem(NP_BACKFILL_KEY, '1'); }catch(e){} return todo.length > 0; });
    });
  }
  function outdoorBestBackfill(){
    if(!hasFtp()) return Promise.resolve(false);   // can't tell easy from hard yet — save the calls
    return rideAllRaw().then(function(all){
      var now = Date.now();
      var cand = all.filter(function(r){ return !r.deleted && r.type === 'ride' && r.devWatts && r.stravaActivityId && r.outBest === undefined && now - r.startDateMs <= 42 * DAY_MS; })
                    .sort(function(a, b){ return b.startDateMs - a.startDateMs; });
      var skip = cand.filter(function(r){ return r.durationSec < 20 * 60 || (r.fields && r.fields.np && hasFtp() && r.fields.np / ftp < 0.7); });
      var fetchList = cand.filter(function(r){ return skip.indexOf(r) < 0; }).slice(0, OUT_FETCH_PER_OPEN);
      var changed = skip.length > 0;
      var chain = Promise.all(skip.map(function(r){ r.outBest = false; return rideSave(r); }));
      fetchList.forEach(function(r){
        chain = chain.then(function(stop){
          if(stop === 'stop') return 'stop';
          return stravaFetchPowerStream(r.stravaActivityId).then(function(pw){
            var b = false;
            if(pw && pw.length >= 300){
              b = {};
              [300, 480, 1200].forEach(function(d){ var v = bestForRide(pw, d); if(v) b[d] = Math.round(v); });
              if(!Object.keys(b).length) b = false;
            }
            r.outBest = b; changed = true;
            return rideSave(r);
          }).catch(function(e){ return 'stop'; });   // rate-limited or offline: try again next open
        });
      });
      return chain.then(function(){ return changed; });
    });
  }
  function outdoorBackfill(){
    if(outdoorRan || !stravaReadable() || typeof stravaFetchPowerStream !== 'function') return;
    outdoorRan = true;
    npBackfill().catch(function(){ return false; }).then(function(a){
      return outdoorBestBackfill().then(function(b){ return a || b; });
    }).then(function(changed){
      if(changed) rideAll().then(function(all){ paintFtpHint(ftpCheck(all.filter(function(x){ return !x.planned; }))); });
    }).catch(function(e){ console.log('outdoor power backfill skipped:', e && e.message); });
  }

  // ---- small helpers ----
  function cKey(ms){ return dayKey(ms); }
  function daysAgoKey(n){ var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return dayKey(d.getTime()); }
  function signed(n){ return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }
  function zLabel(z){ return (ZONES[z] || {}).label || z; }
  function zHex(z){ return (ZONES[z] || {}).hex || 'var(--text-dim)'; }
  function hashStr(s){ var h = 0; for(var i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) | 0; } return h >>> 0; }
  function roundTo(n, step){ return Math.round(n / step) * step; }

  // Library picks for a zone: within the week's TSS cap when there is one,
  // everyday lengths, not ridden in the last two
  // weeks, in a stable per-day order (so the card doesn't reshuffle on every
  // open, but changes day to day).
  function pickWorkouts(zone, n, avoidKeys, seed, maxTss){
    var pool = WORKOUTS.filter(function(w){ return w.zone === zone && !w.test; });
    if(maxTss != null){
      var fit = pool.filter(function(w){ return w.tss != null && w.tss <= maxTss; });
      if(fit.length >= n) pool = fit;
    }
    var mid = pool.filter(function(w){ return w.durationMin >= 40 && w.durationMin <= 80; });
    if(mid.length >= n) pool = mid;
    var fresh = pool.filter(function(w){ return avoidKeys.indexOf(w.key) < 0; });
    if(fresh.length >= n) pool = fresh;
    return pool.slice().sort(function(a, b){ return hashStr(seed + a.key) - hashStr(seed + b.key); }).slice(0, n);
  }
  function workoutRow(w){
    var meta = zLabel(w.zone) + ' · ' + w.durationMin + ' min' + (w.tss != null ? ' · TSS ' + w.tss : '');
    return '<button type="button" class="co-wk" data-coach-view="' + w.key + '">' +
      '<i style="background:' + zHex(w.zone) + '"></i>' +
      '<span class="co-wk-t"><b>' + w.name + '</b><span>' + meta + '</span></span>' +
      '<span class="co-go">View ›</span></button>';
  }
  function verdictHTML(colour, text){
    return '<div class="co-verdict"><span class="co-pip" style="--c:' + colour + '"></span>' + text + '</div>';
  }

  // ============================================================
  // TODAY
  // ============================================================
  function coachToday(all, acts, pmc){
    if(!pmc.today) return '';
    var tk = cKey(Date.now()), yk = daysAgoKey(1);
    var tsb = pmc.today.tsb;
    var yLoad = acts.filter(function(a){ return a.day === yk; }).reduce(function(s, a){ return s + effLoad(a); }, 0);
    var hardY = yLoad >= 80;
    var recent = acts.filter(function(a){ return a.key && a.day >= daysAgoKey(14); }).map(function(a){ return a.key; });
    var basis = 'Form ' + signed(tsb);
    // Verdict, then the readiness gauge as its evidence, then what to ride.
    function out(colour, verdict, why, picks, note){
      var noteHTML = note ? '<p class="co-note">' + note + '</p>' : '';
      return '<div class="co-head"><span class="co-lbl">Today</span><span class="co-basis">' + basis + '</span></div>' +
        verdictHTML(colour, verdict) + '<p class="co-why">' + why + '</p>' +
        readinessHTML(pmc.today) +
        (picks && picks.length
          ? '<div class="co-blk"><div class="co-head"><span class="co-lbl">Ride today</span></div><div class="co-list">' + picks.map(workoutRow).join('') + '</div>' + noteHTML + '</div>'
          : noteHTML);
    }

    // Already ridden today: nothing to suggest.
    var done = acts.filter(function(a){ return a.day === tk; });
    if(done.length){
      var d0 = done[done.length - 1], load = done.reduce(function(s, a){ return s + effLoad(a); }, 0);
      return out('var(--ok)', 'Done for today',
        '<b>' + (d0.name || 'Ride') + '</b>' + (load ? ' · TSS ' + Math.round(load) : '') + '. Recover well — tomorrow’s suggestion is here in the morning.');
    }

    var fTxt = '<b>' + signed(tsb) + '</b>', yTxt = hardY ? ' and yesterday was hard (<b>TSS ' + Math.round(yLoad) + '</b>)' : '';
    var band;
    if(tsb < -30){
      band = {c:'var(--c-anaerobic)', v:'Rest or spin easy', zones:['recovery'], max:0,
        why:'Form is ' + fTxt + '. Another hard day now digs a hole rather than building fitness.', rest:'Or take the day off — it counts as training too.'};
    } else if(tsb < -10){
      band = hardY
        ? {c:zHex('endurance'), v:'Steady day — endurance or tempo', zones:['endurance', 'tempo'], max:2, why:'Form is ' + fTxt + yTxt + '. Keep it aerobic today.'}
        : {c:zHex('sweetspot'), v:'Steady day — sweet spot or tempo', zones:['sweetspot', 'tempo'], max:3, why:'Form is ' + fTxt + ': normal mid-build tiredness. You can work — save VO₂ for fresher legs.'};
    } else if(tsb <= 5){
      band = hardY
        ? {c:zHex('endurance'), v:'Go steady after yesterday', zones:['endurance', 'tempo'], max:2, why:'Form is ' + fTxt + yTxt + '. An aerobic day sets up the next hard one.'}
        : {c:zHex('threshold'), v:'Ready for quality work', zones:['threshold', 'sweetspot'], max:4, why:'Form is ' + fTxt + ' — balanced. A good day for threshold or sweet spot.'};
    } else {
      band = {c:zHex('vo2'), v:'Go hard today', zones:['vo2', 'threshold'], max:5, why:'Form is ' + fTxt + ' — your legs are fresh. Make the most of it with real intensity.'};
    }
    // Recovery week (from the block card): Today works inside the same TSS
    // cap, whatever Form says. Very low Form already gets the rest band.
    var bs = blockState(acts, pmc);
    if(bs && bs.easy && tsb >= -30){
      var left = Math.max(0, bs.easyTss - bs.weekTss);
      var wkTxt = 'Recovery week: <b>' + bs.weekTss + ' of ~' + bs.easyTss + ' TSS</b> so far';
      band = left < 20
        ? {c:zHex('recovery'), v:'Easy week — cap reached', zones:['recovery'], max:0, cap:left, why:wkTxt + '. That’s the week’s riding done — rest, or spin very easy.', rest:'Or take the day off — it counts as training too.'}
        : {c:zHex('endurance'), v:'Easy week — keep it aerobic', zones:['endurance'], max:2, cap:left, why:wkTxt + ', about <b>' + left + '</b> left. Easy endurance; a few short openers are fine.'};
      basis = 'Recovery week';
    }
    var seed = tk, cap = band.cap;

    // The calendar wins when there's a plan for today.
    var plan = all.filter(function(a){ return a.planned && a.day === tk; })[0];
    if(plan){
      basis = 'From your calendar';
      var tgt = plan.plan && plan.plan.target;
      if(tgt === 'rest'){
        return out('var(--ok)', 'Rest day planned', 'Enjoy it — recovery is when the fitness actually lands. Form is ' + fTxt + '.');
      }
      if(plan.type === 'indoor' && plan.zone && ZONE_RANK[plan.zone] !== undefined){
        var pz = plan.zone;
        if(ZONE_RANK[pz] <= band.max){
          return out(zHex(pz), 'On the plan: ' + zLabel(pz), band.why + ' Your planned <b>' + zLabel(pz) + '</b> fits.',
            pickWorkouts(pz, 2, recent, seed, cap));
        }
        var alt = band.zones[0];
        return out('var(--warn)', 'Planned ' + zLabel(pz) + ' — consider easing off',
          'You planned <b>' + zLabel(pz) + '</b>, but ' + (cap != null
            ? 'this is your recovery week (<b>' + bs.weekTss + ' of ~' + bs.easyTss + ' TSS</b> so far). Swap to <b>' + zLabel(alt) + '</b> and save the ' + zLabel(pz) + ' for next week.'
            : 'form is ' + fTxt + yTxt + '. <b>' + zLabel(alt) + '</b> would build more today.'),
          pickWorkouts(alt, 1, recent, seed, cap).concat(pickWorkouts(pz, 1, recent, seed)));
      }
      // A run, gym session or outdoor ride: say so, and steer any extra riding.
      return out(band.c, 'On the plan: ' + (plan.name || 'Session'), band.why + (band.max <= 2 ? ' If you ride as well, keep it easy.' : ''));
    }

    var picks = [];
    var per = band.zones.length === 1 ? 2 : 1;   // one zone → two choices from it
    band.zones.forEach(function(z){ picks = picks.concat(pickWorkouts(z, per, recent, seed, cap)); });
    return out(band.c, band.v, band.why, picks, band.rest);
  }

  // Readiness: Form on the Overloaded → Fresh gauge, plus the three numbers.
  function readinessHTML(t){
    var pos = (Math.max(0, Math.min(1, (t.tsb + 45) / 75)) * 100).toFixed(1);
    return '<div class="co-blk co-ready"><div class="co-head"><span class="co-lbl">Readiness</span><span class="co-rword">' + formWord(t.tsb) + '</span></div>' +
      '<div class="rc-grad"><span class="rc-thumb" style="left:' + pos + '%"></span></div>' +
      '<div class="rc-ends"><span>Overloaded</span><span>Fresh</span></div>' +
      '<div class="co-nums">' +
        '<div><b>' + t.ctl + '</b><span>Fitness</span></div>' +
        '<div><b>' + signed(t.tsb) + '</b><span>Form</span></div>' +
        '<div><b>' + t.atl + '</b><span>Fatigue</span></div>' +
      '</div></div>';
  }

  // ============================================================
  // NEXT 4 WEEKS
  // ============================================================
  // A "lighter" week is under 70% of the average of the three before it (an
  // empty week counts). Build weeks in a row = completed weeks since the last
  // lighter one. Ramp = Fitness change per week over the last 28 days.
  function weekStartsBack(n){
    var out = [], mon = mondayOf(Date.now());
    for(var k = n; k >= 1; k--){ var d = new Date(mon); d.setDate(d.getDate() - 7 * k); out.push(d.getTime()); }
    return out;   // oldest first, completed weeks only
  }
  // The block numbers both cards need. `easy` = this week should be a
  // recovery week (building too fast, or 3+ build weeks in a row), so Today
  // works inside the same TSS cap the block card prints.
  function blockState(acts, pmc){
    var s = pmc.series;
    if(!pmc.today || s.length < 21) return null;
    var last = s[s.length - 1], bi = Math.max(0, s.length - 29), back = s[bi];
    var ramp = Math.round((last.ctl - back.ctl) / ((s.length - 1 - bi) / 7) * 10) / 10;
    var wk = weekStartsBack(7).map(function(t){ return weekStats(acts, t).tss; });
    var light = wk.map(function(v, i){
      if(i < 3) return null;
      var prev = (wk[i - 1] + wk[i - 2] + wk[i - 3]) / 3;
      return v <= 0 || (prev > 0 && v < prev * 0.7);
    });
    var streak = 0;
    for(var i = wk.length - 1; i >= 3 && light[i] === false; i--) streak++;
    var recentAvg = (wk[4] + wk[5] + wk[6]) / 3;
    var easyTss = roundTo(recentAvg * 0.6, 10);
    return {
      back:back, ramp:ramp, light:light, streak:streak, easyTss:easyTss,
      buildTss:roundTo(7 * (pmc.today.ctl + 18), 10),   // ≈ +3 Fitness a week
      easy:ramp > 7 || streak >= 3,
      weekTss:Math.round(weekStats(acts, mondayOf(Date.now())).tss)
    };
  }

  function coachBlock(acts, pmc){
    var s = pmc.series;
    var bs = blockState(acts, pmc);
    var head = '<div class="co-head"><span class="co-lbl">Next 4 weeks</span><span class="co-basis">' + (bs ? 'Ramp ' + signed(bs.ramp) + ' / wk' : '') + '</span></div>';
    if(!bs){
      return head + verdictHTML('var(--text-faint)', 'Building your picture') +
        '<p class="co-why">The block view needs about three weeks of rides. Keep logging — it fills in on its own.</p>' +
        weekBlocksHTML(acts, null);
    }
    var last = s[s.length - 1], back = bs.back;
    var ramp = bs.ramp, light = bs.light, streak = bs.streak;

    // Easy / moderate / hard from time in power zones over 28 days.
    var mix = [0, 0, 0], since = daysAgoKey(28);
    acts.forEach(function(a){
      if(a.day < since || !a.tiz || !a.tiz.power) return;
      var p = a.tiz.power;
      mix[0] += (p[0] || 0) + (p[1] || 0); mix[1] += (p[2] || 0) + (p[3] || 0); mix[2] += (p[4] || 0) + (p[5] || 0) + (p[6] || 0);
    });
    var mixTot = mix[0] + mix[1] + mix[2];
    var mixPct = mixTot >= 3 * 3600 ? mix.map(function(v){ return Math.round(v / mixTot * 100); }) : null;

    var rides28 = acts.filter(function(a){ return a.day >= since; }).length;
    var rides56 = acts.filter(function(a){ return a.day >= daysAgoKey(56) && a.day < since; }).length;
    var buildTss = bs.buildTss, easyTss = bs.easyTss;
    var c, v, why, plan;
    if(ramp > 7){
      c = 'var(--c-anaerobic)'; v = 'Building too fast — back off';
      why = 'Fitness has jumped <b>+' + ramp + '/week</b>, past the ~7/week most riders can absorb. The risk now is illness or burnout, not under-training.';
      plan = '<b>Take a recovery week now:</b> about <b>' + easyTss + ' TSS</b>, nothing above tempo. You’ll come out of it fitter.';
    } else if(streak >= 3){
      c = zHex('endurance'); v = 'Recovery week due';
      why = '<b>' + streak + ' build weeks</b> in a row without a lighter one. Fitness lands when you back off.';
      plan = '<b>Make this week easy:</b> about <b>' + easyTss + ' TSS</b> (~60% of usual) with a couple of short openers, then build again.';
    } else if(ramp < -1){
      var drop = back.ctl > 0 ? Math.round((back.ctl - last.ctl) / back.ctl * 100) : 0;
      c = 'var(--warn)'; v = 'Fitness is slipping';
      why = 'Fitness is down <b>' + drop + '%</b> over 4 weeks (<b>' + Math.round(back.ctl) + ' → ' + Math.round(last.ctl) + '</b>) — <b>' + rides28 + '</b> ride' + (rides28 === 1 ? '' : 's') + ' in that time vs ' + rides56 + ' the 4 weeks before.';
      plan = '<b>Rebuild gently:</b> 3 rides a week, mostly endurance, for 2 weeks before adding hard intervals back in.';
    } else if(ramp < 2){
      c = 'var(--text-dim)'; v = pmc.today.tsb > 5 ? 'Fresh — time to build' : 'Holding steady';
      why = 'Fitness is flat (<b>' + signed(ramp) + '/week</b>). Fine for maintaining; to improve, the weekly load has to rise.';
      plan = '<b>To build:</b> about <b>' + buildTss + ' TSS a week</b> — add a session or extend your longest ride.';
    } else {
      c = 'var(--ok)'; v = 'Productive build — keep going';
      why = 'Fitness is climbing <b>+' + ramp + '/week</b> — a healthy rate you’re absorbing.';
      plan = streak === 2
        ? '<b>One more build week</b> at about <b>' + buildTss + ' TSS</b>, then a recovery week.'
        : '<b>Keep about ' + buildTss + ' TSS a week.</b> Plan a lighter week after your third build week.';
    }
    if(mixPct && mixPct[0] < 50 && ramp <= 7) plan += ' Most of your time is moderate-to-hard — make one ride a week easy endurance.';

    // The plan reads straight on from the verdict; the ramp and intensity mix
    // sit under the 12-week bars (which show the build streak themselves).
    var rCls = ramp > 7 ? 'bad' : ramp >= 2 ? 'ok' : 'warn';
    var rNote = ramp > 7 ? 'too fast · healthy is 2–7' : ramp >= 2 ? 'healthy · 2–7' : ramp >= -1 ? 'flat · healthy is 2–7' : 'losing · healthy is 2–7';
    var extra = '<div class="co-line"><span>Fitness ramp <b class="' + rCls + '">' + signed(ramp) + ' / week</b></span><span class="q">' + rNote + '</span></div>' +
      (mixPct ? '<div class="co-line co-mixline"><span>Intensity · 4 wks</span><span class="co-mix"><span style="width:' + mixPct[0] + '%;background:' + zHex('endurance') + '"></span><span style="width:' + mixPct[1] + '%;background:' + zHex('tempo') + '"></span><span style="width:' + mixPct[2] + '%;background:' + zHex('anaerobic') + '"></span></span>' +
        '<div class="co-mixk"><span><i style="background:' + zHex('endurance') + '"></i>Easy ' + mixPct[0] + '%</span><span><i style="background:' + zHex('tempo') + '"></i>Moderate ' + mixPct[1] + '%</span><span><i style="background:' + zHex('anaerobic') + '"></i>Hard ' + mixPct[2] + '%</span></div></div>' : '');
    return head + verdictHTML(c, v) + '<p class="co-why">' + why + ' ' + plan + '</p>' + weekBlocksHTML(acts, bs, extra);
  }

  // This week (against the easy-week cap when a recovery week is due) and the
  // 12-week bars, drawn by drawWeeklyTrend once the pane is on screen.
  function weekBlocksHTML(acts, bs, extra){
    var wk = weekStats(acts, mondayOf(Date.now())), tss = Math.round(wk.tss), easy = !!(bs && bs.easy);
    var capHTML = '';
    if(easy){
      var left = bs.easyTss - tss, pct = bs.easyTss > 0 ? Math.min(100, tss / bs.easyTss * 100) : 100;
      capHTML = '<div class="co-cap"><div class="co-cap-t"><span><b>' + tss + '</b> of ~' + bs.easyTss + ' TSS easy-week cap</span><span>' + (left >= 20 ? left + ' left' : 'Cap reached') + '</span></div>' +
        '<div class="co-cap-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
    }
    return '<div class="co-blk"><div class="co-head"><span class="co-lbl">This week</span></div>' +
        '<div class="co-nums"><div><b>' + tss + '</b><span>Load · TSS</span></div><div><b>' + fmtHrs(wk.sec) + '</b><span>Time</span></div><div><b>' + wk.n + '</b><span>' + (wk.n === 1 ? 'Ride' : 'Rides') + '</span></div></div>' +
        capHTML + '</div>' +
      '<div class="co-blk"><div class="co-head"><span class="co-lbl">12 weeks</span>' + wkToggleHTML() + '</div>' +
        '<div class="wk-plot"><canvas class="tr-canvas wk-canvas" id="wkCanvas"></canvas><div class="wk-tip" id="wkTip" hidden></div></div>' +
        '<div class="co-key"><span><i class="b"></i>Build week</span><span><i class="l"></i>Lighter week</span><span><i class="' + (easy ? 'e' : 'n') + '"></i>This week' + (easy ? ' · cap' : '') + '</span></div>' +
        (extra || '') + '</div>';
  }

  // ============================================================
  // FTP CHECK
  // ============================================================
  var FTP_SNOOZE_KEY = 'ftpPlan_ftpCheckSnooze_v1';
  var SIG_W = {strong:2, medium:1, weak:0};
  function pctSpan(vals){
    var a = vals.map(function(r){ return Math.round(r * 100); }).sort(function(x, y){ return x - y; });
    return a[0] === a[a.length - 1] ? a[0] + '%' : a[0] + '–' + a[a.length - 1] + '%';
  }
  function median(a){ var s = a.slice().sort(function(x, y){ return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  // ---- outdoor (and virtual) rides from Strava ----
  // Free efforts, not ERG-capped — the evidence indoor riding can't give. Only
  // rides with a real power meter count (Strava estimates watts otherwise), and
  // outdoor power gets a small allowance: most riders put out a few % more
  // outdoors (cooling, momentum, motivation) and it's often a different power
  // source from the trainer. Virtual rides are indoor power, so no allowance.
  // Both signals only ever argue UP: not going all-out says nothing.
  var OUTDOOR_ALLOW = 0.97;
  function outPw(a, w){ return a.virtual ? w : w * OUTDOOR_ALLOW; }
  function outdoorSignals(acts, cur, nowMs, working){
    var outs = acts.filter(function(a){ return a.type === 'ride' && a.devWatts && nowMs - a.startDateMs <= 42 * DAY_MS; })
                   .sort(function(a, b){ return b.startDateMs - a.startDateMs; });
    working.outdoor = outs;
    var sig = [], where = function(a){ return a.virtual ? 'on a virtual ride' : 'outdoors'; };
    var label = function(a){ return (a.name || 'Ride') + ', ' + shortDate(a.startDateMs); };
    // 6 — normalised power held for 45 min+. An hour at or above FTP shouldn't be possible.
    var long = outs.filter(function(a){ return a.durationSec >= 45 * 60 && a.fields && a.fields.np; });
    if(long.length){
      var top = long.slice().sort(function(a, b){ return outPw(b, b.fields.np) - outPw(a, a.fields.np); })[0];
      var np = top.fields.np, adj = Math.round(outPw(top, np)), mins = Math.round(top.durationSec / 60), IF = Math.round(np / cur * 100) / 100;
      var allow = top.virtual ? '' : ' · counted as ' + adj + ' W after the outdoor allowance';
      if(adj >= cur) sig.push({dir:'up', w:'strong', text:'Held <b>NP ' + np + ' W for ' + mins + ' min</b> ' + where(top) + ' — above your FTP (IF ' + IF + ')', sub:label(top) + allow});
      else sig.push({dir:'na', w:'weak', text:'Hardest long ride: <b>NP ' + np + ' W for ' + mins + ' min</b> (IF ' + IF + ')', sub:label(top) + ' — not an FTP-level effort, so no signal'});
    }
    // 7 — best 5 and 20 min from full-resolution power. Two estimates, averaged:
    // 20 min × 95%, and critical power from the 5 + 20 min pair
    // (CP = (P20·1200 − P5·300) / 900).
    var bests = outs.filter(function(a){ return a.outBest; });
    if(bests.length){
      var b5 = null, b20 = null;
      bests.forEach(function(a){
        if(a.outBest[300] && (!b5 || outPw(a, a.outBest[300]) > b5.w)) b5 = {w:outPw(a, a.outBest[300]), raw:a.outBest[300], ride:a};
        if(a.outBest[1200] && (!b20 || outPw(a, a.outBest[1200]) > b20.w)) b20 = {w:outPw(a, a.outBest[1200]), raw:a.outBest[1200], ride:a};
      });
      if(b20){
        var e20 = b20.w * 0.95, cp = b5 ? (b20.w * 1200 - b5.w * 300) / 900 : null;
        var cpOk = cp !== null && cp > 0 && cp < b20.w;
        var est = Math.round(cpOk ? (e20 + cp) / 2 : e20);
        working.outEst = {b5:b5, b20:b20, e20:Math.round(e20), cp:cpOk ? Math.round(cp) : null, est:est};
        var src = function(b){ return ' (' + (b.ride.name || 'ride') + ')'; };
        var nums = (b5 ? '5 min ' + b5.raw + ' W' + src(b5) + ' · ' : '') + '20 min ' + b20.raw + ' W' + src(b20) +
          (cpOk ? ' → 20-min est ' + Math.round(e20) + ' W, critical power ' + Math.round(cp) + ' W' : '') +
          ((b20.ride.virtual && (!b5 || b5.ride.virtual)) ? '' : ' · after the outdoor allowance');
        if(est >= cur * 1.03) sig.push({dir:'up', w:cpOk ? 'strong' : 'medium', text:'Your best efforts on the road suggest <b>~' + est + ' W</b>', sub:nums});
        else sig.push({dir:'na', w:'weak', text:'Best efforts on the road → estimate <b>' + est + ' W</b>', sub:nums + ' — no higher than your FTP, so no signal'});
      }
    }
    return sig;
  }

  function ftpCheck(acts){
    if(!hasFtp()) return null;
    var cur = ftp, nowMs = Date.now();
    var eff = acts.filter(function(a){ return a.effort; }).sort(function(a, b){ return b.startDateMs - a.startDateMs; });
    var recent = eff.filter(function(a){ return nowMs - a.startDateMs <= 42 * DAY_MS; });
    var atCur = recent.filter(function(a){ return a.ftp === cur; }).slice(0, 6);
    var hist = ftpHistory(acts);
    var since = hist.changedAt ? Math.max(1, Math.round((nowMs - hist.changedAt) / (7 * DAY_MS))) : null;
    // HR-at-power groups: the last 3 weeks vs 5–12 weeks ago (any FTP — watts per beat doesn't depend on it).
    var rH = eff.filter(function(a){ return a.effort.hr && nowMs - a.startDateMs <= 21 * DAY_MS; });
    var bH = eff.filter(function(a){ var age = nowMs - a.startDateMs; return a.effort.hr && age >= 35 * DAY_MS && age <= 84 * DAY_MS; });
    var working = {rides:atCur, hrRecent:rH, hrBase:bH};
    var outSig = outdoorSignals(acts, cur, nowMs, working);

    if(atCur.length < 3){
      // Not enough indoor evidence for a verdict — but the outdoor rows still
      // show, so their estimates can be compared against a known FTP.
      var anyHr = atCur.some(function(a){ return a.effort.hr; }), anyRpe = atCur.some(function(a){ return a.rpe; });
      return {state:'thin', cur:cur, to:cur, since:since, working:working, signals:[
        {dir:'na', text:'<b>' + atCur.length + '</b> sweet spot / threshold ride' + (atCur.length === 1 ? '' : 's') + ' at ' + cur + ' W in the last 6 weeks', sub:'The check needs at least 3 to compare'},
        {dir:'na', text:anyHr ? 'Heart rate recorded' : 'No heart rate on those rides', sub:anyHr ? '' : 'Connect a heart-rate strap to unlock the HR signals'},
        {dir:'na', text:anyRpe ? 'Effort ratings saved' : 'No effort ratings saved', sub:anyRpe ? '' : 'Rate rides when you finish — it sharpens the check'}
      ].concat(outSig)};
    }

    var sig = [], es = atCur.map(function(a){ return a.effort; }), n = es.length, need = Math.ceil(n * 0.6);
    // 1 — intensity actually ridden vs the plan
    var hiN = es.filter(function(e){ return e.ratio >= 1.03 && e.cov >= 0.9; }).length;
    var loN = es.filter(function(e){ return e.ratio <= 0.97 || e.cov < 0.8; }).length;
    var span = pctSpan(es.map(function(e){ return e.ratio; }));
    if(hiN >= need) sig.push({dir:'up', w:'strong', text:'Rode your sweet spot / threshold work at <b>' + span + '</b> on ' + hiN + ' of your last ' + n + ' rides', sub:'Measured power vs the plan’s targets — you turned the intensity up and held it'});
    else if(loN >= need) sig.push({dir:'down', w:'strong', text:'Turned down or cut short on <b>' + loN + ' of your last ' + n + '</b> sweet spot / threshold rides (' + span + ')', sub:'Measured power vs the plan’s targets, and intervals skipped'});
    else sig.push({dir:'hold', w:'strong', text:'Sweet spot / threshold ridden at <b>' + span + '</b> — about as written', sub:'Measured power vs the plan’s targets'});

    // 2 — HR at that power vs your own history (efficiency: watts per beat)
    if(rH.length >= 2 && bH.length >= 2){
      var mean = function(list, k){ return list.reduce(function(t, a){ return t + a.effort[k]; }, 0) / list.length; };
      var rp = mean(rH, 'pw'), rh = mean(rH, 'hr'), bp = mean(bH, 'pw'), bh = mean(bH, 'hr');
      var dEf = ((rp / rh) - (bp / bh)) / (bp / bh);
      // Recent HR at the baseline's power: HR above a ~60 bpm resting floor
      // scales roughly with power, so the bpm figure isn't overstated.
      var hrAtSame = Math.round(60 + (rh - 60) * (bp / rp));
      var dBpm = Math.round(bh - hrAtSame);
      var nums = Math.round(bh) + ' bpm at ' + Math.round(bp) + ' W → ' + Math.round(rh) + ' bpm at ' + Math.round(rp) + ' W';
      if(dEf >= 0.04) sig.push({dir:'up', w:'strong', text:'HR at sweet spot is <b>~' + Math.abs(dBpm) + ' bpm lower</b> for the same power than 6 weeks ago', sub:nums + ' — the classic sign the number has moved'});
      else if(dEf <= -0.05) sig.push({dir:'down', w:'medium', text:'HR at sweet spot is <b>~' + Math.abs(dBpm) + ' bpm higher</b> for the same power than 6 weeks ago', sub:nums + ' — heat or tiredness can do this too'});
      else sig.push({dir:'hold', w:'strong', text:'HR at sweet spot <b>steady</b> vs 6 weeks ago', sub:nums});
    }
    // 3 — HR drift across the steady work
    var decs = es.filter(function(e){ return e.dec !== null && e.dec !== undefined; }).map(function(e){ return e.dec; });
    if(decs.length >= 2){
      var md = Math.round(median(decs));
      if(md <= 5) sig.push({dir:'up', w:'medium', text:'HR drift <b>' + md + '%</b> across your recent long intervals', sub:'HR held steady to the end — those efforts were well inside your limit'});
      // Medium either way: the <5% benchmark comes from long steady rides, and
      // interval sets with rests between are a looser fit.
      else if(md >= 9) sig.push({dir:'down', w:'medium', text:'HR drift <b>' + md + '%</b> on your recent sweet spot work', sub:'HR kept climbing — those efforts were near your limit'});
      else sig.push({dir:'hold', w:'medium', text:'HR drift <b>' + md + '%</b> — working, not struggling', sub:''});
    }
    // 4 — effort ratings
    var rpes = atCur.filter(function(a){ return a.rpe; }).map(function(a){ return a.rpe; });
    if(rpes.length >= 2){
      var ra = Math.round(rpes.reduce(function(t, x){ return t + x; }, 0) / rpes.length * 10) / 10;
      if(ra <= 5) sig.push({dir:'up', w:'medium', text:'You rated these rides <b>' + ra + ' / 10</b> — sweet spot should feel ~7', sub:'From your post-ride effort ratings'});
      else if(ra >= 9) sig.push({dir:'down', w:'medium', text:'You rated these rides <b>' + ra + ' / 10</b> — sweet spot should feel ~7', sub:'From your post-ride effort ratings'});
      else sig.push({dir:'hold', w:'medium', text:'Rated <b>' + ra + ' / 10</b> — right where it should be', sub:''});
    }
    // 5 — best 20 min. ERG holds you to target, so this can only ever argue up.
    var best = 0;
    acts.forEach(function(a){
      if(nowMs - a.startDateMs > 42 * DAY_MS) return;
      var pc = a.pbCurve || (a.samples && a.samples.length >= 1200 ? pbCurveFor(a.samples) : null);
      if(pc && pc[1200] > best){ best = pc[1200]; working.best20 = {w:best, ride:a}; }
    });
    if(best){
      var est = Math.round(best * 0.95);
      if(est >= cur * 1.03) sig.push({dir:'up', w:'medium', text:'20-min best <b>' + best + ' W</b> beats what your FTP predicts (→ ' + est + ' W)', sub:'Best 20 min × 95%'});
      else sig.push({dir:'na', w:'weak', text:'20-min best <b>' + best + ' W</b> → estimate ' + est + ' W', sub:'ERG holds you to the target, so this underestimates — supporting only'});
    }
    sig = sig.concat(outSig);   // 6 & 7 — outdoor / virtual rides

    var upW = 0, dnW = 0;
    sig.forEach(function(s){ if(s.dir === 'up') upW += SIG_W[s.w]; if(s.dir === 'down') dnW += SIG_W[s.w]; });
    var s1 = sig[0].dir, state = 'hold';
    if(upW >= 3 && dnW <= 1 && s1 !== 'down') state = 'up';
    else if(dnW >= 3 && upW <= 1 && s1 !== 'up') state = 'down';
    var to = cur;
    if(state === 'up') to = Math.max(cur + 3, Math.round(cur * 1.03));
    if(state === 'down') to = Math.min(cur - 3, Math.round(cur * 0.97));
    var avail = sig.filter(function(s){ return s.dir !== 'na'; }).length;
    var agree = sig.filter(function(s){ return s.dir === state; }).length;
    return {state:state, cur:cur, to:to, signals:sig, avail:avail, agree:agree, since:since, working:working};
  }

  // "Show working": the numbers behind each signal, ride by ride, so the check
  // can be sanity-read against how the rides actually felt. Beta until it has
  // been checked against real ramp tests.
  function shortDate(ms){ var d = new Date(ms); return WK_MONS[d.getMonth()] + ' ' + d.getDate(); }
  function workingHTML(chk){
    var w = chk.working; if(!w) return '';
    var cell = function(v){ return v === null || v === undefined || v === '' || v === false ? '<span class="nil">—</span>' : v; };
    var rows = w.rides.map(function(a){
      var e = a.effort;
      return '<tr><td>' + shortDate(a.startDateMs) + '</td><td class="nm">' + (a.name || '') + '</td>' +
        '<td>' + Math.round(e.ratio * 100) + '%</td><td>' + Math.round(e.cov * 100) + '%</td>' +
        '<td>' + cell(e.pw && e.pw + ' W') + '</td><td>' + cell(e.hr && e.hr + '') + '</td>' +
        '<td>' + cell(e.dec !== null && e.dec !== undefined ? e.dec + '%' : null) + '</td><td>' + cell(a.rpe) + '</td></tr>';
    }).join('');
    var grp = function(list){
      if(!list.length) return 'no rides with HR';
      var p = 0, h = 0; list.forEach(function(a){ p += a.effort.pw; h += a.effort.hr; });
      return list.length + ' ride' + (list.length === 1 ? '' : 's') + ' · ' + Math.round(p / list.length) + ' W at ' + Math.round(h / list.length) + ' bpm';
    };
    return '<details class="co-work"><summary>Show working</summary>' +
      '<p class="co-work-h">Rides used — the plan’s steady 84–110% FTP work, ridden at ' + chk.cur + ' W, last 6 weeks</p>' +
      (rows ? '<div class="co-work-scroll"><table class="co-work-tbl"><thead><tr><th>Date</th><th>Workout</th><th>Ridden</th><th>Done</th><th>Power</th><th>HR</th><th>Drift</th><th>RPE</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<p class="co-work-p">None yet.</p>') +
      '<p class="co-work-h">HR at power</p>' +
      '<p class="co-work-p">Last 3 weeks: ' + grp(w.hrRecent) + '<br>5–12 weeks ago: ' + grp(w.hrBase) + '</p>' +
      (w.best20 ? '<p class="co-work-h">Best 20 min</p><p class="co-work-p">' + w.best20.w + ' W — ' + (w.best20.ride.name || 'ride') + ', ' + shortDate(w.best20.ride.startDateMs) + '</p>' : '') +
      outdoorWorkingHTML(w, chk.cur, cell) +
      '<p class="co-work-h">Rules</p>' +
      '<p class="co-work-p">Ridden ≥103% with ≥90% done counts up; ≤97% or under 80% done counts down — 60% of rides must agree. ' +
        'Watts per heartbeat up ≥4% counts up, down ≥5% counts down. Drift ≤5% up, ≥9% down. RPE ≤5 up, ≥9 down. ' +
        'Best 20 min × 95% only counts up. ' +
        'Outdoor rides need a real power meter and are counted at 97% (the outdoor allowance; virtual rides at 100%): NP held for 45 min+ at or above FTP counts up (strong); ' +
        'road best efforts → the average of 20 min × 95% and critical power from 5 + 20 min, counting up when ≥3% over FTP. ' +
        'Strong signals weigh 2, medium 1; a change needs 3 on one side and at most 1 against, and moves FTP by ~3%.</p>' +
    '</details>';
  }
  // Outdoor / virtual rides in the last 6 weeks with a power meter: NP, IF and
  // the fetched best efforts, so the estimates can be checked against a known FTP.
  function outdoorWorkingHTML(w, cur, cell){
    var outs = w.outdoor || [];
    if(!outs.length) return '<p class="co-work-h">Outdoor &amp; virtual rides</p><p class="co-work-p">None with a power meter in the last 6 weeks (Strava-estimated power doesn’t count).</p>';
    var rows = outs.map(function(a){
      var np = a.fields && a.fields.np, b = a.outBest;
      return '<tr><td>' + shortDate(a.startDateMs) + '</td><td class="nm">' + (a.name || '') + (a.virtual ? ' <span class="nil">(virtual)</span>' : '') + '</td>' +
        '<td>' + Math.round(a.durationSec / 60) + ' min</td><td>' + cell(np && np + ' W') + '</td><td>' + cell(np && (Math.round(np / cur * 100) / 100)) + '</td>' +
        '<td>' + cell(b && b[300] && b[300] + ' W') + '</td><td>' + cell(b && b[1200] && b[1200] + ' W') + '</td></tr>';
    }).join('');
    var pending = outs.filter(function(a){ return a.outBest === undefined; }).length;
    var e = w.outEst;
    return '<p class="co-work-h">Outdoor &amp; virtual rides — real power meter, last 6 weeks</p>' +
      '<div class="co-work-scroll"><table class="co-work-tbl"><thead><tr><th>Date</th><th>Ride</th><th>Time</th><th>NP</th><th>IF</th><th>Best 5 min</th><th>Best 20 min</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (e ? '<p class="co-work-p" style="margin-top:8px">Estimate: 20 min × 95% = ' + e.e20 + ' W' + (e.cp ? ', critical power = ' + e.cp + ' W → average ' + e.est + ' W' : ' → ' + e.est + ' W') + ' (after the outdoor allowance where it applies).</p>' : '') +
      (pending ? '<p class="co-work-p">' + pending + ' ride' + (pending === 1 ? '' : 's') + ' still to fetch best efforts for — a few are fetched from Strava each time the app opens.</p>' : '');
  }

  function ftpSnoozed(chk){
    try{
      var s = JSON.parse(localStorage.getItem(FTP_SNOOZE_KEY) || 'null');
      return !!(s && s.ftp === chk.cur && s.to === chk.to && Date.now() - s.at < 21 * DAY_MS);
    }catch(e){ return false; }
  }
  function ftpHintOn(chk){ return !!(chk && (chk.state === 'up' || chk.state === 'down') && !ftpSnoozed(chk)); }

  var ftpUndo = null;   // {from, to} right after Update, for the Undo link
  function ftpCheckHTML(chk){
    if(!chk) return '';
    var head = '<div class="co-head"><span class="co-lbl">FTP check<span class="co-beta">Beta</span></span></div>';
    if(ftpUndo && ftpUndo.to === ftp){
      return '<div class="tr-card co-ftp">' + head + verdictHTML('var(--ok)', 'FTP updated to ' + ftp + ' W') +
        '<p class="co-why">Every workout’s targets now use ' + ftp + ' W. The check starts fresh from your next rides.</p>' +
        '<div class="co-acts"><button type="button" class="co-btn ghost" data-ftp-undo>Undo — back to ' + ftpUndo.from + ' W</button></div></div>';
    }
    var cfg = {
      up:{c:'var(--ok)', v:'Your FTP looks low', d:'up'},
      down:{c:'var(--c-anaerobic)', v:'Your FTP may be set too high', d:'down'},
      hold:{c:'var(--ok)', v:'Your FTP looks right', d:'hold'},
      thin:{c:'var(--text-faint)', v:'Not enough to go on yet', d:'hold'}
    }[chk.state];
    var change = chk.to - chk.cur, pct = Math.round(Math.abs(change) / chk.cur * 100);
    var big = chk.to !== chk.cur
      ? '<span class="from">' + chk.cur + '</span><span class="arr">→</span><span class="to">' + chk.to + '<small>W</small></span>'
      : '<span class="to">' + chk.cur + '<small>W</small></span>';
    var delta = chk.to !== chk.cur ? signed(change) + ' W · ' + (change > 0 ? '+' : '−') + pct + '%' : (chk.since ? 'Set ' + chk.since + ' wk' + (chk.since === 1 ? '' : 's') + ' ago' : 'No change');
    var conf = '';
    if(chk.state !== 'thin'){
      var nOn = chk.state === 'hold' ? chk.avail : chk.agree, bars = '';
      for(var i = 0; i < Math.max(5, chk.avail); i++) bars += '<i class="' + (i < nOn ? 'on' : '') + '"></i>';
      // "Evidence", not "confidence": the signals overlap (an easy ride lowers
      // HR, drift and RPE together), so the count says how much points one way,
      // not how sure the check is.
      var word = chk.state === 'hold' ? 'Based on ' + chk.avail + ' signal' + (chk.avail === 1 ? '' : 's')
        : chk.agree + ' of ' + chk.avail + ' signals agree';
      conf = '<div class="co-conf"><span class="co-lbl">Evidence</span><div class="bars" style="--c:' + cfg.c + '">' + bars + '</div><div class="ct">' + word + '</div></div>';
    }
    var rows = chk.signals.map(function(s){
      var ic = s.dir === 'up' ? '▲' : s.dir === 'down' ? '▼' : '–';
      var muted = s.dir === 'na' || (s.dir === 'hold' && chk.state !== 'hold');
      return '<div class="co-ev' + (muted ? ' muted' : '') + '"><span class="ic ' + s.dir + '">' + ic + '</span>' +
        '<span class="t">' + s.text + (s.sub ? '<small>' + s.sub + '</small>' : '') + '</span>' +
        '<span class="w">' + (s.w && s.dir !== 'na' && s.dir !== 'hold' ? s.w : '') + '</span></div>';
    }).join('');
    var acts = '';
    if(chk.state === 'up' || chk.state === 'down'){
      acts = '<button type="button" class="co-btn" data-ftp-apply="' + chk.to + '">' + (chk.state === 'up' ? 'Update' : 'Lower') + ' to ' + chk.to + ' W</button>' +
        '<button type="button" class="co-btn ghost" data-ftp-ramp>Confirm with a ramp test</button>' +
        (ftpSnoozed(chk) ? '' : '<button type="button" class="co-btn text" data-ftp-snooze>Not now</button>');
    } else {
      acts = '<button type="button" class="co-btn ghost" data-ftp-ramp>' + (chk.state === 'thin' ? 'Do a ramp test' : 'Ramp test anyway') + '</button>';
    }
    return '<div class="tr-card co-ftp">' + head +
      '<div class="co-ftp-top"><div>' + verdictHTML(cfg.c, cfg.v) +
        '<div class="co-ftp-big">' + big + '</div><span class="co-delta ' + cfg.d + '">' + delta + '</span></div>' + conf + '</div>' +
      '<div class="co-evs">' + rows + '</div>' +
      '<div class="co-acts">' + acts + '</div>' +
      workingHTML(chk) + '</div>';
  }

  // ---- FTP history: rebuilt from the FTP saved on every ride ----
  // Each indoor ride stores the FTP it was ridden at. A ramp test's result is
  // the value that follows it, so the step is drawn at the test.
  function ftpHistory(acts){
    var rides = acts.filter(function(a){ return a.type === 'indoor' && a.ftp; }).sort(function(a, b){ return a.startDateMs - b.startDateMs; });
    var pts = [];
    rides.forEach(function(r, i){
      var last = pts[pts.length - 1];
      if(!last || last.v !== r.ftp) pts.push({t:r.startDateMs, v:r.ftp, ramp:false});
      var wo = r.key ? byKey(r.key) : null;
      if(wo && wo.test === 'ramp'){
        var nxt = rides[i + 1] ? rides[i + 1].ftp : (hasFtp() ? ftp : null);
        if(nxt && nxt !== r.ftp) pts.push({t:r.startDateMs + 60000, v:nxt, ramp:true});
      }
    });
    if(hasFtp() && (!pts.length || pts[pts.length - 1].v !== ftp)) pts.push({t:Date.now() - 60000, v:ftp, ramp:false});
    // When it last changed — unknown (null) when there are no rides to date it by.
    var changedAt = pts.length > 1 ? pts[pts.length - 1].t : (rides.length ? pts[0].t : null);
    return {pts:pts, changedAt:changedAt};
  }
  function ftpHistoryHTML(){
    return '<div class="tr-card co-hist"><div class="co-head"><span class="co-lbl">FTP history</span><span class="co-basis" id="ftpHistNote"></span></div>' +
      '<canvas class="tr-canvas co-hist-cv" id="ftpHistCanvas"></canvas></div>';
  }
  function drawFtpHistory(cv, acts){
    if(!cv) return;
    var hst = ftpHistory(acts), pts = hst.pts;
    var W = cv.clientWidth || 600, H = 110, ctx = setupCanvas(cv, W, H);
    var faint = cssVar('--text-faint') || '#888', ink = cssVar('--text') || '#222', bg = cssVar('--bg-card') || '#fff';
    var note = document.getElementById('ftpHistNote');
    ctx.clearRect(0, 0, W, H);
    if(!pts.length){ ctx.fillStyle = faint; ctx.font = '12px ' + IMG_MONO; ctx.textAlign = 'center'; ctx.fillText('Builds as you ride — every ride saves its FTP', W / 2, H / 2); return; }
    var t0 = pts[0].t, t1 = Date.now();
    if(t1 - t0 < 14 * DAY_MS) t0 = t1 - 14 * DAY_MS;
    var vals = pts.map(function(p){ return p.v; }), vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
    var pad = Math.max(8, (vMax - vMin) * 0.25), lo = vMin - pad, hi = vMax + pad;
    var padL = 38, padR = 12, padT = 18, padB = 22;
    function x(t){ return padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
    function y(v){ return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); }
    ctx.font = '10px ' + IMG_MONO; ctx.textBaseline = 'middle';
    var grid = gridColor();
    [lo + (hi - lo) * 0.2, (lo + hi) / 2, hi - (hi - lo) * 0.2].forEach(function(v){
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
      ctx.fillStyle = faint; ctx.textAlign = 'right'; ctx.fillText(Math.round(v), padL - 6, y(v));
    });
    // step line
    ctx.beginPath();
    pts.forEach(function(p, i){
      var px = i ? x(Math.max(p.t, t0)) : padL, py = y(p.v);   // the first value runs from the left edge
      if(!i) ctx.moveTo(px, py); else { ctx.lineTo(px, y(pts[i - 1].v)); ctx.lineTo(px, py); }
    });
    ctx.lineTo(x(t1), y(pts[pts.length - 1].v));
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // ramp-test markers
    pts.forEach(function(p){
      if(!p.ramp) return;
      var px = x(p.t), py = y(p.v);
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = faint; ctx.textAlign = 'center'; ctx.fillText('Ramp ' + p.v, px, py - 10);
    });
    monthTicks(ctx, (function(){ var out = [], d = new Date(t0); d.setHours(0, 0, 0, 0); while(d.getTime() <= t1){ out.push({t:d.getTime()}); d.setDate(d.getDate() + 1); } return out; })(), x, H, faint);
    if(note){
      var last = pts[pts.length - 1], wks = Math.max(0, Math.round((Date.now() - last.t) / (7 * DAY_MS)));
      note.textContent = pts.length > 1 ? (last.v > pts[pts.length - 2].v ? '+' : '') + (last.v - pts[pts.length - 2].v) + ' W ' + (wks ? wks + ' wk' + (wks === 1 ? '' : 's') + ' ago' : 'this week') : 'Unchanged at ' + last.v + ' W';
    }
  }

  // ============================================================
  // SUMMARY BLOCK + HINTS
  // ============================================================
  function coachSummaryHTML(all, acts, pmc, chk){
    if(!pmc.today) return '';
    var hint = ftpHintOn(chk)
      ? '<button type="button" class="co-hint" data-goto-power><span class="co-pip" style="--c:' + (chk.state === 'up' ? 'var(--ok)' : 'var(--c-anaerobic)') + '"></span>' +
          '<span><b>FTP check</b> · your rides suggest <b>' + chk.to + ' W</b> (' + signed(chk.to - chk.cur) + ')</span><span class="co-go">Review ›</span></button>'
      : '';
    return '<div class="tr-card co-card co-sum">' + hint +
      '<div class="co-grid"><div class="co-col">' + coachToday(all, acts, pmc) + '</div><div class="co-col">' + coachBlock(acts, pmc) + '</div></div></div>';
  }

  // The top-bar FTP chip carries a quiet dot (and a tooltip) while the check
  // suggests a change.
  var lastChk = null;
  function paintFtpHint(chk){
    lastChk = chk;
    var chip = document.getElementById('tbFtpChip'); if(!chip) return;
    var on = ftpHintOn(chk);
    chip.classList.toggle('has-hint', on);
    chip.classList.toggle('hint-down', on && chk.state === 'down');
    chip.title = on ? 'FTP check: your rides suggest ' + chk.to + ' W — open Fitness › Power' : '';
  }
  // Background refresh (boot, Strava sync, saves): recompute the check for the chip.
  function refreshCoach(){
    if(typeof rideAll !== 'function') return;
    effortBackfill();   // no-op once done (or until the library has loaded)
    outdoorBackfill();  // once per open, when Strava can be read
    rideAll().then(function(all){ paintFtpHint(ftpCheck(all.filter(function(a){ return !a.planned; }))); }).catch(function(){});
  }

  // "View" on a suggestion: open it in the Workouts list so the rider sees the
  // intervals before starting. The list narrows to that zone (other filters
  // cleared, like the calendar's "Show me…") so the workout is sure to be in it.
  function viewWorkout(key){
    if(LOG_MODE){ location.href = APP_URL + '#workout=' + encodeURIComponent(key); return; }   // the list lives in the full app
    var wo = byKey(key); if(!wo) return;
    closeTrends();
    if(typeof closeLog === 'function') closeLog();
    filters.zone = wo.zone; filters.duration = null; filters.spice = null; filters.shape = null;
    filters.search = ''; filters.starredOnly = false;
    if(els.searchBox) els.searchBox.value = '';
    browseAll = true;
    closeFindModal();
    renderFilters(); renderWorkoutCards();
    updateStarFilterUI();
    if(mqMobile.matches){ selectWorkout(key, {scrollIntoView:true}); openDetailMobile(); return; }
    selectWorkout(key);
    var row = document.getElementById('workout-' + key);
    if(row && row.scrollIntoView) row.scrollIntoView({block:'start'});   // the opened card reads down from the top
  }

  // ---- actions (delegated on the Fitness body) ----
  els.trendsBody.addEventListener('click', function(e){
    var t;
    if((t = e.target.closest('[data-coach-view]'))){ viewWorkout(t.getAttribute('data-coach-view')); return; }
    if(e.target.closest('[data-goto-power]')){
      var tab = els.trendsBody.querySelector('.tr-subtab[data-pane="power"]'); if(tab) tab.click();
      return;
    }
    if((t = e.target.closest('[data-ftp-apply]'))){
      var to = +t.getAttribute('data-ftp-apply');
      ftpUndo = {from:ftp, to:to};
      setFtp(to); renderTrends(); refreshCoach();
      return;
    }
    if(e.target.closest('[data-ftp-undo]') && ftpUndo){
      var back = ftpUndo.from; ftpUndo = null;
      setFtp(back); renderTrends(); refreshCoach();
      return;
    }
    if(e.target.closest('[data-ftp-snooze]') && lastChk){
      try{ localStorage.setItem(FTP_SNOOZE_KEY, JSON.stringify({ftp:lastChk.cur, to:lastChk.to, at:Date.now()})); }catch(err){}
      renderTrends(); paintFtpHint(lastChk);
      return;
    }
    if(e.target.closest('[data-ftp-ramp]')){
      var ramp = WORKOUTS.filter(function(w){ return w.test === 'ramp'; })[0];
      if(!ramp) return;
      if(LOG_MODE){ viewWorkout(ramp.key); return; }
      closeTrends();
      if(typeof selectWorkout === 'function') selectWorkout(ramp.key, {scrollIntoView:true});
      startWorkout(ramp.key);
    }
  });
