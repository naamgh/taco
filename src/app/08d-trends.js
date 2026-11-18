  // ============================================================
  // TRAINING CHARTS
  // ============================================================
  // Everything is computed from the ride log. Load is TSS where a power ride
  // recorded it, otherwise estimated from RPE and duration — so runs and gym
  // sessions still count toward the picture. The three sections are the
  // performance-management chart (Fitness / Fatigue / Form), a this-week
  // summary, and the all-time power curve with any new personal bests.
  var DAY_MS = 86400000;

  // A single load number, on the TSS scale, for any activity.
  //   power ride  → its TSS
  //   otherwise   → RPE-based estimate: hours × (RPE/10)² × 100
  // (RPE/10 stands in for intensity factor; an hour at RPE 7 ≈ 49.)
  function effLoad(a){
    if(a.tss !== null && a.tss !== undefined) return a.tss;
    if(a.rpe && a.durationSec){ var IF = a.rpe / 10; return Math.round(a.durationSec / 3600 * IF * IF * 100); }
    return 0;
  }

  // CTL/ATL/TSB day by day from the first activity to today.
  //   CTL (Fitness) — 42-day exponential average of daily load
  //   ATL (Fatigue) — 7-day
  //   TSB (Form)    — yesterday's Fitness minus yesterday's Fatigue
  function computePMC(acts){
    if(!acts.length) return {series:[], today:null};
    var byDay = {};
    acts.forEach(function(a){ byDay[a.day] = (byDay[a.day] || 0) + effLoad(a); });
    var first = new Date(acts[0].startDateMs); first.setHours(0,0,0,0);
    var today = new Date(); today.setHours(0,0,0,0);
    var series = [], ctl = 0, atl = 0;
    // Step by calendar day with setDate rather than a fixed 24h: a daylight-
    // saving day is 23/25h, and adding DAY_MS across it would skip or double a
    // local day in the running averages.
    var d = new Date(first.getTime()), endMs = today.getTime();
    while(d.getTime() <= endMs){
      var prevCtl = ctl, prevAtl = atl;
      var load = byDay[dayKey(d.getTime())] || 0;
      ctl = ctl + (load - ctl) / 42;
      atl = atl + (load - atl) / 7;
      series.push({t:d.getTime(), load:load, ctl:ctl, atl:atl, tsb:prevCtl - prevAtl});
      d.setDate(d.getDate() + 1);
    }
    var last = series[series.length - 1];
    return {series:series, today:{ctl:Math.round(last.ctl), atl:Math.round(last.atl), tsb:Math.round(last.tsb)}};
  }

  function mondayOf(ms){ var d = new Date(ms); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  function weekStats(acts, weekStartMs){
    // Week end via setDate (DST-safe): + 7 * DAY_MS would land an hour off
    // across a daylight-saving change and mis-bin a ride near the boundary.
    var endD = new Date(weekStartMs); endD.setDate(endD.getDate() + 7);
    var end = endD.getTime(), tss = 0, sec = 0, n = 0;
    acts.forEach(function(a){
      if(a.startDateMs >= weekStartMs && a.startDateMs < end){ tss += effLoad(a); sec += a.durationSec || 0; n++; }
    });
    return {tss:tss, sec:sec, n:n};
  }

  // Best average power for each target duration, across every ride with
  // samples. Also flags a target where the most recent ride beat all before it.
  var PC_TARGETS = [[15,'15s'],[30,'30s'],[60,'1m'],[120,'2m'],[300,'5m'],[480,'8m'],[1200,'20m'],[3600,'60m']];
  function bestForRide(powers, d){
    if(powers.length < d) return null;
    var sum = 0, i;
    for(i = 0; i < d; i++) sum += powers[i] || 0;
    var best = sum;
    for(i = d; i < powers.length; i++){ sum += (powers[i] || 0) - (powers[i - d] || 0); if(sum > best) best = sum; }
    return best / d;
  }
  // Best average power at each PB duration, keyed by seconds — a *light* per-ride
  // summary (~8 numbers) that SYNCS, unlike the raw `samples` array which cloud
  // sync strips out. Stamped on save (rideRecordFromLive) and backfilled for old
  // rides (pbBackfill), so the power curve is identical on every device.
  function pbCurveFor(samples){
    if(!samples || !samples.length) return null;
    var powers = samples.map(function(s){ return s.power || 0; }), out = {}, any = false;
    PC_TARGETS.forEach(function(tg){
      var b = bestForRide(powers, tg[0]);
      if(b !== null && b > 0){ out[tg[0]] = Math.round(b); any = true; }
    });
    return any ? out : null;
  }
  function powerCurve(acts){
    // Prefer the stored pbCurve (light, synced); fall back to computing from raw
    // samples for any ride that predates the summary and still has them locally.
    var rides = acts.filter(function(a){ return a.pbCurve || (a.samples && a.samples.length); })
                    .sort(function(a, b){ return a.startDateMs - b.startDateMs; });
    var overall = PC_TARGETS.map(function(){ return null; });
    var prs = [];
    rides.forEach(function(r, ri){
      var pc = r.pbCurve || pbCurveFor(r.samples) || {};
      PC_TARGETS.forEach(function(tg, i){
        var b = pc[tg[0]];
        if(b === undefined || b === null) return;
        // A new best from the newest ride is a PR (only when there was prior data to beat).
        if(ri === rides.length - 1 && overall[i] !== null && b > overall[i].w + 0.5){
          prs.push({label:tg[1], w:Math.round(b), prev:Math.round(overall[i].w)});
        }
        if(overall[i] === null || b > overall[i].w){ overall[i] = {w:b, t:r.startDateMs}; }
      });
    });
    return {points:overall, prs:prs, rides:rides.length};
  }

  // ---- drawing ----
  function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  // Theme-aware gridline colour (ink at low alpha — visible in both themes,
  // unlike the old hardcoded white which vanished on the light default).
  function gridColor(){ return 'rgba(' + (cssVar('--ink-rgb') || '128,128,128') + ',0.09)'; }
  // A soft tint from a design token, so chart fills read as the app's zone/ink
  // tints rather than one-off rgba literals.
  function tint(name, a){
    var c = cssVar(name);
    if(c && c.charAt(0) === '#'){
      var h = c.slice(1); if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      var n = parseInt(h, 16);
      return 'rgba(' + ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255) + ',' + a + ')';
    }
    return c || 'rgba(128,128,128,' + a + ')';
  }
  function setupCanvas(cv, w, h){
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function niceMax(v){ if(v <= 0) return 10; var p = Math.pow(10, Math.floor(Math.log10(v))); var f = v / p; return (f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * p; }
  function roundRect(ctx, x, y, w, h, r){ r = Math.min(r, h/2, w/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  function rangeView(series, rangeDays){ return rangeDays ? series.slice(Math.max(0, series.length - rangeDays)) : series; }
  function monthTicks(ctx, view, x, H, faint){
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], lastM = -1;
    view.forEach(function(d){ var dt = new Date(d.t); if(dt.getMonth() !== lastM && dt.getDate() <= 7){ lastM = dt.getMonth(); ctx.fillStyle = faint; ctx.fillText(mons[dt.getMonth()], x(d.t), H - 8); } });
  }

  // Fitness (CTL) and Fatigue (ATL) share one axis, scaled to just those two so
  // the lines fill the chart. The vertical gap between them is Form — shaded
  // green where fitness leads (fresh), red where fatigue leads (buried).
  // The Fitness/Fatigue chart paints itself in on appearance: the axes hold
  // still while the Form shading, both lines, and month ticks are revealed
  // left-to-right by a growing clip, on an ease-out — so the data looks drawn
  // on rather than snapped in. Honours prefers-reduced-motion.
  var fitAnim = null;
  function drawFitness(cv, series, rangeDays, noAnim){
    var W = cv.clientWidth || 720, H = 210, ctx = setupCanvas(cv, W, H);
    var padL = 38, padR = 14, padT = 12, padB = 24;
    var accent = cssVar('--accent') || '#6E8BFF';
    var faint = cssVar('--text-faint') || '#7E869E', grid = gridColor();
    var freshFill = tint('--ok', 0.34), fatigFill = tint('--c-anaerobic', 0.30);
    if(fitAnim){ cancelAnimationFrame(fitAnim); fitAnim = null; }
    if(series.length < 2){ ctx.clearRect(0, 0, W, H); ctx.fillStyle = faint; ctx.font = '13px ' + IMG_SANS; ctx.textAlign = 'center'; ctx.fillText('Not enough history yet', W/2, H/2); return; }
    var view = rangeView(series, rangeDays);
    var t0 = view[0].t, t1 = view[view.length - 1].t, span = Math.max(1, t1 - t0);
    var vMax = niceMax(Math.max.apply(null, view.map(function(d){ return Math.max(d.ctl, d.atl); })) || 10);
    function x(t){ return padL + (t - t0) / span * (W - padL - padR); }
    function y(v){ return H - padB - v / vMax * (H - padT - padB); }
    function line(key, colour, width){
      ctx.beginPath();
      view.forEach(function(d, i){ var px = x(d.t), py = y(d[key]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
    }
    // Draw one frame at reveal fraction p (0..1): axes full, data clipped in.
    function frame(p){
      ctx.clearRect(0, 0, W, H);
      ctx.font = '10px ' + IMG_MONO; ctx.textBaseline = 'middle';
      for(var g = 0; g <= 4; g++){
        var lv = vMax * g / 4, gy = y(lv);
        ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
        ctx.fillStyle = faint; ctx.textAlign = 'right'; ctx.fillText(Math.round(lv), padL - 6, gy);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(padL, 0, Math.max(0, (W - padL - padR) * p), H); ctx.clip();
      // the gap = Form, filled per segment by which line is on top
      for(var i = 1; i < view.length; i++){
        var a = view[i-1], b = view[i];
        ctx.beginPath();
        ctx.moveTo(x(a.t), y(a.ctl)); ctx.lineTo(x(b.t), y(b.ctl));
        ctx.lineTo(x(b.t), y(b.atl)); ctx.lineTo(x(a.t), y(a.atl)); ctx.closePath();
        ctx.fillStyle = ((a.ctl + b.ctl) >= (a.atl + b.atl)) ? freshFill : fatigFill;
        ctx.fill();
      }
      // no Fatigue line: the band's outer edge is Fatigue, its colour says which leads
      line('ctl', accent, 2.6);                                               // fitness, solid ink
      monthTicks(ctx, view, x, H, faint);
      ctx.restore();
    }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce || noAnim){ frame(1); return; }   // static when drawn on a tab switch (the reveal can stall if the pane isn't painting)
    var start = null, DUR = 620;
    function stepFrame(ts){
      if(start === null) start = ts;
      var p = Math.min(1, (ts - start) / DUR), e = 1 - Math.pow(1 - p, 3);   // ease-out cubic
      frame(e);
      fitAnim = (p < 1) ? requestAnimationFrame(stepFrame) : null;
    }
    fitAnim = requestAnimationFrame(stepFrame);
  }

  // Form (TSB = Fitness − Fatigue) on its own zero-centred axis, coloured by
  // sign: green above the line (fresh), red below (fatigued).
  function drawForm(cv, series, rangeDays){
    var W = cv.clientWidth || 720, H = cv.clientHeight || 168, ctx = setupCanvas(cv, W, H);
    var padL = 34, padR = 62, padT = 12, padB = 24;
    var accent = cssVar('--accent') || '#444';
    var faint = cssVar('--text-faint') || '#7E869E', grid = gridColor();
    ctx.clearRect(0, 0, W, H);
    if(series.length < 2){ ctx.fillStyle = faint; ctx.font = '13px ' + IMG_SANS; ctx.textAlign = 'center'; ctx.fillText('Not enough history yet', W/2, H/2); return; }
    var view = rangeView(series, rangeDays);
    var t0 = view[0].t, t1 = view[view.length - 1].t, span = Math.max(1, t1 - t0);
    // Floor at 35 so the productive (−10 to −30) and overreach bands stay on chart.
    var tsbAbs = Math.max(35, Math.max.apply(null, view.map(function(d){ return Math.abs(d.tsb); })) || 35);
    function x(t){ return padL + (t - t0) / span * (W - padL - padR); }
    function y(v){ return padT + (tsbAbs - v) / (2 * tsbAbs) * (H - padT - padB); }
    // target-zone bands (clamped to the visible range)
    function band(lo, hi, fill){
      var yt = y(Math.min(hi, tsbAbs)), yb = y(Math.max(lo, -tsbAbs));
      ctx.fillStyle = fill; ctx.fillRect(padL, yt, W - padL - padR, yb - yt);
    }
    // Monotone: no loud zone bands — the right-margin labels and the zero line
    // carry the meaning, in keeping with the typographic style.
    ctx.font = '9px ' + IMG_MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = faint;
    ctx.fillText('Fresh', W - padR + 6, y(15));
    ctx.fillText('Maintain', W - padR + 6, y(-2.5));
    ctx.fillText('Productive', W - padR + 6, y(-20));
    ctx.fillText('Overreach', W - padR + 6, y(Math.min(-38, (-30 - tsbAbs) / 2)));
    ctx.font = '10px ' + IMG_MONO; ctx.textBaseline = 'middle';
    var zeroLine = 'rgba(' + (cssVar('--ink-rgb') || '128,128,128') + ',0.22)';
    [tsbAbs, 0, -tsbAbs].forEach(function(lv){
      var gy = y(lv);
      ctx.strokeStyle = (lv === 0) ? zeroLine : grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
      ctx.fillStyle = faint; ctx.textAlign = 'right'; ctx.fillText((lv > 0 ? '+' : '') + Math.round(lv), padL - 6, gy);
    });
    // fill each segment down to the zero line, coloured by sign
    for(var i = 1; i < view.length; i++){
      var a = view[i-1], b = view[i], pos = b.tsb >= 0;
      ctx.beginPath();
      ctx.moveTo(x(a.t), y(a.tsb)); ctx.lineTo(x(b.t), y(b.tsb));
      ctx.lineTo(x(b.t), y(0)); ctx.lineTo(x(a.t), y(0)); ctx.closePath();
      ctx.fillStyle = tint('--accent', 0.07);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(x(a.t), y(a.tsb)); ctx.lineTo(x(b.t), y(b.tsb));
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    }
    monthTicks(ctx, view, x, H, faint);
  }

  // Tall, narrow bar chart: one horizontal bar per duration, shortest (15s) at
  // the top to longest (60m) at the bottom, power along the x-axis. Fills the
  // right column's height. unit: 'w' or 'wkg' (falls back to watts, no weight).
  function drawPowerCurve(cv, curve, unit){
    var W = cv.clientWidth || 240, H = cv.clientHeight || 320, ctx = setupCanvas(cv, W, H);
    var padL = 42, padR = 46, padT = 8, padB = 24;
    var accent = cssVar('--accent') || '#6E8BFF', gold = cssVar('--star') || '#D99A00', faint = cssVar('--text-faint') || '#7E869E';
    var strong = cssVar('--text-strong') || '#FFFFFF', grid = gridColor();
    var wkg = unit === 'wkg' && hasWeight();
    function val(w){ return wkg ? w / weight : w; }
    function axisLabel(v){ return wkg ? v.toFixed(0) : Math.round(v); }
    function barLabel(w){ return wkg ? (w / weight).toFixed(1) : w; }
    ctx.clearRect(0, 0, W, H);
    var pts = curve.points.map(function(p, i){ return p ? {label:PC_TARGETS[i][1], w:Math.round(p.w)} : null; }).filter(Boolean);
    if(pts.length < 1){ ctx.fillStyle = faint; ctx.font = '12px ' + IMG_SANS; ctx.textAlign = 'center'; ctx.fillText('Ride indoors with power', W/2, H/2); return; }
    var n = pts.length, rowH = (H - padT - padB) / n;
    var vMax = niceMax(Math.max.apply(null, pts.map(function(p){ return val(p.w); })));
    function xf(v){ return padL + v / vMax * (W - padL - padR); }
    // vertical gridlines + x-axis labels
    ctx.font = '10px ' + IMG_MONO; ctx.textAlign = 'center';
    for(var g = 0; g <= 2; g++){
      var lv = vMax * g / 2, gx = xf(lv);
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, H - padB); ctx.stroke();
      ctx.fillStyle = faint; ctx.textBaseline = 'alphabetic'; ctx.fillText(axisLabel(lv), gx, H - 9);
    }
    var prLabels = {}; curve.prs.forEach(function(p){ prLabels[p.label] = true; });
    pts.forEach(function(p, i){
      var mid = padT + rowH * i + rowH / 2, barH = Math.min(18, rowH * 0.52), by = mid - barH / 2;
      var isPr = prLabels[p.label], bw = Math.max(2, xf(val(p.w)) - padL);
      ctx.fillStyle = faint; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = '10px ' + IMG_MONO;
      ctx.fillText(p.label, padL - 8, mid);
      ctx.fillStyle = isPr ? gold : accent; roundRect(ctx, padL, by, bw, barH, 4); ctx.fill();
      ctx.fillStyle = isPr ? gold : strong; ctx.textAlign = 'left'; ctx.font = '600 11px ' + IMG_MONO;
      ctx.fillText(barLabel(p.w), padL + bw + 6, mid);
    });
  }

  // ---- the view ----
  var trendsRange = 90;   // days; 0 = all
  var RANGES = [[42,'6w'],[90,'3m'],[180,'6m'],[365,'1y'],[0,'All']];
  var pcUnit = 'w';       // power-curve unit: 'w' or 'wkg'
  var lastCurve = null;   // kept so the unit toggle can redraw without recomputing
  var WEEKMETRIC_KEY = 'ftpPlan_weekMetric_v1';
  var weekMetric = 'tss'; // 12-week trend metric: 'tss' or 'hours' — remembered
  try{ var _wm = localStorage.getItem(WEEKMETRIC_KEY); if(_wm === 'hours' || _wm === 'tss') weekMetric = _wm; }catch(e){}
  var lastActs = null;    // kept so the trend toggle can redraw without recomputing
  var lastPmc = null;     // kept so a sub-tab switch can redraw its charts
  var trendsTab = 'summary';   // Fitness sub-tab: 'summary' | 'performance' | 'power'
  function fmtHrs(sec){ var h = Math.floor(sec/3600), m = Math.round((sec%3600)/60); return h ? h + 'h ' + (m<10?'0':'') + m + 'm' : m + 'm'; }

  // ---- 12-week trend (weekly TSS or hours) — a line chart ----
  function computeWeeks(acts){
    // Build each week-start with setDate rather than fixed-ms subtraction, so
    // every one is a true local-midnight Monday. With fixed ms a daylight-saving
    // change makes a 23/25-hour week land an hour off, and its rides (hashed
    // with mondayOf) never match the exact === — so whole weeks bucketed as zero.
    var weeks = [], base = new Date(mondayOf(Date.now()));
    for(var i = 11; i >= 0; i--){ var d = new Date(base); d.setDate(d.getDate() - i * 7); weeks.push({start: d.getTime(), tss: 0, sec: 0}); }
    acts.forEach(function(a){
      var ws = mondayOf(a.startDateMs);
      for(var j = 0; j < 12; j++){ if(weeks[j].start === ws){ weeks[j].tss += effLoad(a) || 0; weeks[j].sec += a.durationSec || 0; break; } }
    });
    return weeks;
  }
  // Bar shading: lighter weeks by the coach's rule (under 70% of the three
  // before, or empty) over the 11 completed weeks, plus the build streak and —
  // in a recovery week — the easy-week cap, both from blockState.
  function weekChartInfo(acts){
    var base = new Date(mondayOf(Date.now())), wk = [], light = [];
    for(var i = 14; i >= 1; i--){ var d = new Date(base); d.setDate(d.getDate() - i * 7); wk.push(weekStats(acts, d.getTime()).tss); }
    for(var j = 3; j < 14; j++){ var prev = (wk[j - 1] + wk[j - 2] + wk[j - 3]) / 3; light.push(wk[j] <= 0 || (prev > 0 && wk[j] < prev * 0.7)); }
    light.push(false);   // this week, in progress
    var bs = lastPmc ? blockState(acts, lastPmc) : null;
    return {light:light, streak:bs ? bs.streak : 0, cap:bs && bs.easy ? bs.easyTss : null};
  }
  function drawWeeklyBars(cv, weeks, metric, info, hoverIdx){
    var W = cv.clientWidth || 280, H = cv.clientHeight > 40 ? cv.clientHeight : 150, dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var faint = cssVar('--text-faint') || '#7E869E', strong = cssVar('--text-strong') || '#111';
    var buildC = tint('--text-dim', 0.85), lightC = tint('--text', 0.16), easyC = cssVar('--c-endurance') || '#3F79E8';
    var vals = weeks.map(function(w){ return metric === 'tss' ? w.tss : w.sec / 3600; }), n = vals.length;
    var cap = metric === 'tss' ? info.cap : null, nowC = info.cap ? easyC : strong;
    var top = Math.max.apply(null, vals.concat([cap || 0]));
    var max = top > 0 ? top * 1.1 : (metric === 'tss' ? 100 : 1);
    var padT = 26, padB = 20, gap = Math.max(3, Math.round(W / 70)), bw = (W - gap * (n - 1)) / n;
    function bx(i){ return i * (bw + gap); }
    function y(v){ return padT + (1 - v / max) * (H - padT - padB); }
    function fmt(v){ return metric === 'tss' ? Math.round(v) : (Math.round(v * 10) / 10) + 'h'; }
    ctx.strokeStyle = gridColor(); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y(0) + .5); ctx.lineTo(W, y(0) + .5); ctx.stroke();
    vals.forEach(function(v, i){
      var h = v > 0 ? Math.max(2, y(0) - y(v)) : 0; if(!h) return;
      ctx.globalAlpha = (hoverIdx != null && hoverIdx !== i) ? 0.5 : 1;
      ctx.fillStyle = i === n - 1 ? nowC : info.light[i] ? lightC : buildC;
      roundRect(ctx, bx(i), y(0) - h, bw, h, 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if(cap){   // this week's ceiling, dashed
      ctx.strokeStyle = easyC; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.strokeRect(bx(n - 1) + .5, y(cap) + .5, bw - 1, y(0) - y(cap) - 1); ctx.setLineDash([]);
    }
    ctx.font = '9.5px ' + IMG_MONO; ctx.textBaseline = 'alphabetic';
    if(info.streak >= 2){   // bracket over the build streak (the completed weeks before this one)
      var a = bx(n - 1 - info.streak), b = bx(n - 2) + bw;
      ctx.strokeStyle = faint; ctx.beginPath(); ctx.moveTo(a + .5, padT - 6); ctx.lineTo(a + .5, padT - 10.5); ctx.lineTo(b - .5, padT - 10.5); ctx.lineTo(b - .5, padT - 6); ctx.stroke();
      ctx.fillStyle = faint; ctx.textAlign = 'center'; ctx.fillText(info.streak + ' build weeks', (a + b) / 2, padT - 14);
    }
    var lv = vals[n - 1];
    ctx.fillStyle = strong; ctx.textAlign = 'center';
    ctx.fillText(fmt(lv), bx(n - 1) + bw / 2, y(Math.max(lv, cap || 0)) - 5);
    var d0 = new Date(weeks[0].start);
    ctx.fillStyle = faint; ctx.textAlign = 'left'; ctx.fillText(d0.getDate() + ' ' + WK_MONS[d0.getMonth()], 0, H - 5);
    ctx.textAlign = 'right'; ctx.fillText('This week', W, H - 5);
    cv._trend = {W:W, n:n, bw:bw, gap:gap, padT:padT};
  }
  function wkToggleHTML(){
    return '<div class="trends-range wk-toggle">' +
      '<button type="button" class="tr-range-btn wk-btn' + (weekMetric === 'tss' ? ' on' : '') + '" data-wk="tss">TSS</button>' +
      '<button type="button" class="tr-range-btn wk-btn' + (weekMetric === 'hours' ? ' on' : '') + '" data-wk="hours">Hours</button></div>';
  }
  function drawWeeklyTrend(acts){
    var cv = document.getElementById('wkCanvas'); if(!cv) return;
    cv._info = weekChartInfo(acts);
    drawWeeklyBars(cv, computeWeeks(acts), weekMetric, cv._info);
    wireWkHover(cv);
  }
  // Desktop scrub: hover a bar to read the week's date + TSS/hours.
  var WK_MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function wireWkHover(cv){
    if(!cv || cv._wired) return; cv._wired = true;
    var tip = document.getElementById('wkTip');
    cv.addEventListener('mousemove', function(e){
      var g = cv._trend; if(!g || !lastActs || !tip) return;
      var rect = cv.getBoundingClientRect();
      var idx = Math.max(0, Math.min(g.n - 1, Math.floor((e.clientX - rect.left) / (g.bw + g.gap))));
      var weeks = computeWeeks(lastActs);
      drawWeeklyBars(cv, weeks, weekMetric, cv._info, idx);
      var w = weeks[idx], d = new Date(w.start);
      var val = weekMetric === 'tss' ? Math.round(w.tss) + ' TSS' : (Math.round(w.sec / 3600 * 10) / 10) + ' h';
      tip.innerHTML = '<b>Wk of ' + d.getDate() + ' ' + WK_MONS[d.getMonth()] + '</b><span>' + val + '</span>';
      tip.hidden = false;
      var hx = idx * (g.bw + g.gap) + g.bw / 2;
      tip.style.left = Math.max(0, Math.min(g.W - tip.offsetWidth, hx - tip.offsetWidth / 2)) + 'px';
      tip.style.top = '0px';
    });
    cv.addEventListener('mouseleave', function(){
      if(tip) tip.hidden = true;
      if(lastActs) drawWeeklyBars(cv, computeWeeks(lastActs), weekMetric, cv._info);
    });
  }
  function formWord(tsb){
    if(tsb > 15) return 'Fresh'; if(tsb > 5) return 'Rested'; if(tsb >= -10) return 'Maintaining';
    if(tsb >= -30) return 'Building'; return 'Overreaching';
  }

  // ============================================================
  // TODAY'S READINESS CARD
  // ============================================================
  // A glanceable summary of the same PMC the charts show — Fitness / Form /
  // Fatigue plus a Form-driven meter — surfaced on the opening screen so the
  // numbers are seen without opening Charts. Renders instantly from whatever
  // the ride log already holds; the background Strava sync re-paints it when
  // new activity lands, so it's never blocked on the network.
  var readinessData = null;   // cached {ctl, atl, tsb, word, trend}
  var RC_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14l4-5 4 4 5-7 5 6"/></svg>';
  var RC_CHEV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // Direction of each metric vs ~7 days ago, for the little trend arrow.
  function pmcTrend(series){
    if(!series || series.length < 2) return {ctl:0, atl:0, tsb:0};
    var last = series[series.length - 1], back = series[Math.max(0, series.length - 1 - 7)];
    function sign(a, b){ return a > b + 0.5 ? 1 : (a < b - 0.5 ? -1 : 0); }
    return {ctl:sign(last.ctl, back.ctl), atl:sign(last.atl, back.atl), tsb:sign(last.tsb, back.tsb)};
  }
  function rcArrow(dir){ return dir > 0 ? '↑' : (dir < 0 ? '↓' : ''); }
  function rcTile(label, unit, val, dir, cls){
    return '<div class="rc-tile ' + cls + '"><span class="u">' + unit + '</span>' +
      '<div class="v">' + val + (dir ? ' <span class="ar">' + rcArrow(dir) + '</span>' : '') + '</div>' +
      '<span class="l">' + label + '</span></div>';
  }
  function stravaOn(){ return typeof stravaConnected === 'function' && stravaConnected(); }
  // Shown in place of the scores when Strava isn't connected: the fitness
  // picture leans on the full activity history, so prompt to connect rather
  // than show a partial number.
  function readinessConnectHTML(variant){
    return '<div class="rc-card rc-' + variant + ' rc-connect">' +
      '<div class="rc-head">' + RC_ICON + 'Today’s Readiness</div>' +
      '<p class="rc-connect-msg">Connect Strava to track your Fitness, Form and Fatigue from every ride.</p>' +
      '<button class="rc-connect-btn" type="button">' + (typeof STRAVA_SVG === 'string' ? STRAVA_SVG : '') + 'Log in to Strava</button>' +
    '</div>';
  }
  // Connect prompt when signed out; '' when connected but there's no history
  // yet (the card hides until a ride is logged); otherwise the scores.
  function readinessCardHTML(variant){
    if(!stravaOn()) return readinessConnectHTML(variant);
    var d = readinessData;
    if(!d) return '';
    var lo = -45, hi = 30, frac = Math.max(0, Math.min(1, (d.tsb - lo) / (hi - lo)));
    return '<div class="rc-card rc-' + variant + '" role="button" tabindex="0" aria-label="Open training charts">' +
      '<div class="rc-head">' + RC_ICON + 'Today’s Readiness</div>' +
      '<div class="rc-tiles">' +
        rcTile('Fitness', 'CTL', d.ctl, d.trend.ctl, '') +
        rcTile('Form', 'TSB', (d.tsb > 0 ? '+' : '') + d.tsb, d.trend.tsb, 'form') +
        rcTile('Fatigue', 'ATL', d.atl, d.trend.atl, 'fatigue') +
      '</div>' +
      '<div class="rc-meter">' +
        '<div class="rc-meter-top"><span>Training Readiness</span>' + RC_CHEV + '</div>' +
        '<div class="rc-word">' + d.word + '</div>' +
        '<div class="rc-grad"><span class="rc-thumb" style="left:' + (frac * 100).toFixed(1) + '%"></span></div>' +
        '<div class="rc-ends"><span>Overloaded</span><span>Fresh</span></div>' +
      '</div>' +
    '</div>';
  }
  // Paint the landing copy, and refresh the desktop empty-detail copy if that's
  // what's on screen.
  function paintReadiness(){
    if(els.rcLanding) els.rcLanding.innerHTML = readinessCardHTML('landing');
    if(typeof renderDetail === 'function' && typeof selectedKey !== 'undefined' && !selectedKey) renderDetail();
  }
  // Readiness now lives in the Fitness tab (Summary), not the main screen; its
  // existing callers (boot / Strava / auto-sync / saves) now use this hook to
  // refresh the FTP check behind the top-bar chip's hint.
  var lastHistActs = null;
  function refreshReadiness(){ if(typeof refreshCoach === 'function') refreshCoach(); }
  // The connect prompt's button logs in to Strava; tapping a populated card
  // opens the full charts. (The connect card isn't itself a tap target.)
  document.addEventListener('click', function(e){
    if(!e.target.closest) return;
    if(e.target.closest('.rc-connect-btn')){ if(typeof stravaConnect === 'function') stravaConnect(); return; }
    if(e.target.closest('.rc-card:not(.rc-connect)') && typeof openTrends === 'function') openTrends();
  });
  document.addEventListener('keydown', function(e){
    if((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('rc-card') && !e.target.classList.contains('rc-connect')){
      e.preventDefault(); if(typeof openTrends === 'function') openTrends();
    }
  });

  // Slide the sub-tab indicator under the active tab (relative to the list).
  function moveSubUnderline(){
    if(!els.trendsBody) return;
    var list = els.trendsBody.querySelector('.tr-subtab-list'); if(!list) return;
    var on = list.querySelector('.tr-subtab.on'), u = list.querySelector('.tr-subunderline');
    if(!on || !u) return;
    u.style.left = on.offsetLeft + 'px';
    u.style.width = on.offsetWidth + 'px';
  }

  function renderTrends(){
    rideAll().then(function(acts){
      var all = acts;                                            // plans included, for the coach's "today"
      acts = acts.filter(function(a){ return !a.planned; });   // plans aren't done yet
      var pmc = computePMC(acts), curve = powerCurve(acts);
      var chk = ftpCheck(acts);
      paintFtpHint(chk);
      lastHistActs = acts;
      lastCurve = curve;
      if(!hasWeight()) pcUnit = 'w';   // W/kg needs a weight
      var today = pmc.today;

      var unitToggle = hasWeight()
        ? '<div class="trends-range pc-unit">' +
            '<button type="button" class="tr-range-btn pc-unit-btn' + (pcUnit==='w'?' on':'') + '" data-unit="w">W</button>' +
            '<button type="button" class="tr-range-btn pc-unit-btn' + (pcUnit==='wkg'?' on':'') + '" data-unit="wkg">W/kg</button></div>'
        : '';
      var prHtml = curve.prs.length
        ? '<div class="tr-prs">' + curve.prs.map(function(p){ return '<span class="tr-pr">★ New ' + p.label + ' best · ' + p.w + ' W</span>'; }).join('') + '</div>'
        : '';

      lastPmc = pmc;
      lastActs = acts;

      // Split into sub-tabs so each view breathes (Form was getting squished and
      // the page scrolled too far): Summary (today + this week), Performance
      // (fitness/fatigue + form), Power (records), Beta (charts on trial, 08g).
      var subNav = '<div class="tr-subtabs"><div class="tr-subtab-list">' +
        [['summary','Summary'],['performance','Performance'],['power','Power'],['beta','Beta']].map(function(t){
          return '<button type="button" class="tr-subtab' + (trendsTab===t[0]?' on':'') + '" data-pane="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '<span class="tr-subunderline"></span></div></div>';

      // Summary: two columns, two timescales — Today (verdict, readiness, what
      // to ride) and the weeks (block verdict, this week, 12-week bars). The
      // week is shown plain — no "vs last week": beating last week every week
      // isn't the goal; in a recovery week it's measured against a ceiling.
      var summaryPane = '<section class="tr-tab' + (trendsTab==='summary'?' on':'') + '" data-pane="summary">' +
        (today ? coachSummaryHTML(all, acts, pmc, chk) : '<div class="tr-status tr-status-empty"><p>Log a ride to see your fitness.</p></div>') +
      '</section>';

      var perfPane = '<section class="tr-tab' + (trendsTab==='performance'?' on':'') + '" data-pane="performance">' +
        '<div class="tr-card tr-perf">' +
          '<div class="tr-card-head"><h3>Fitness &amp; Fatigue' +
            '<span class="tr-help"><button class="help-dot" type="button" aria-label="About Fitness and Fatigue">?</button>' +
              '<span class="tr-help-tip">Fitness (the line) is a 42-day load average, Fatigue a 7-day. The shaded band runs from Fitness to Fatigue: green when you&#39;re fresh, red when fatigue leads.</span></span></h3>' +
            '<div class="tr-legend"><span class="k ctl">Fitness</span><span class="k fresh fill">Fresh</span><span class="k fatig fill">Fatigued</span></div></div>' +
          '<canvas class="tr-canvas" id="fitCanvas"></canvas>' +
          '<div class="tr-form-strip"><div class="tr-card-head"><h3>Form</h3>' +
            '<button class="help-dot" id="formHelp" type="button" aria-label="What the Form zones mean">?</button></div>' +
            '<canvas class="tr-canvas tr-form-canvas" id="formCanvas"></canvas></div>' +
        '</div>' +
      '</section>';

      var powerPane = '<section class="tr-tab' + (trendsTab==='power'?' on':'') + '" data-pane="power">' +
        ftpCheckHTML(chk) +
        ftpHistoryHTML() +
        '<div class="tr-card tr-power">' +
          '<div class="tr-card-head"><div class="tr-head-titles"><h3>Power Records</h3><span class="tr-subtitle">Best average from indoor rides</span></div>' + unitToggle + '</div>' +
          prHtml +
          '<canvas class="tr-canvas" id="pcCanvas"></canvas>' +
          '<p class="tr-note">' + curve.rides + (curve.rides===1?' ride':' rides') + ' with power · ★ a new best</p>' +
        '</div>' +
      '</section>';

      els.trendsBody.innerHTML = subNav + summaryPane + perfPane + powerPane + betaPaneHTML(acts, trendsTab === 'beta');
      // Range selector moves inline with the sub-tabs (right side).
      var subtabsRow = els.trendsBody.querySelector('.tr-subtabs');
      if(subtabsRow && els.trendsRange) subtabsRow.appendChild(els.trendsRange);
      drawTab(trendsTab);
      wireFormHelp();
      updateRangeVisibility();
      moveSubUnderline();
      requestAnimationFrame(moveSubUnderline);   // settle after layout/font
    }).catch(function(e){
      els.trendsBody.innerHTML = '<p class="log-error">Charts couldn’t be built: ' + (e && e.message) + '</p>';
    });
  }
  // Draw only the charts in the active sub-tab — hidden canvases size to 0, so
  // each is (re)drawn when its tab becomes visible.
  function drawTab(t){
    if(t === 'summary'){ if(lastActs) drawWeeklyTrend(lastActs); }
    else if(t === 'performance'){ if(lastPmc){ drawFitness(document.getElementById('fitCanvas'), lastPmc.series, trendsRange, true); drawForm(document.getElementById('formCanvas'), lastPmc.series, trendsRange); } }
    else if(t === 'power'){
      if(lastCurve) drawPowerCurve(document.getElementById('pcCanvas'), lastCurve, pcUnit);
      if(lastHistActs) drawFtpHistory(document.getElementById('ftpHistCanvas'), lastHistActs);
    }
    else if(t === 'beta') drawBeta();
  }

  // Form-zones popover, on hover — the same pattern as the sidebar Zones help.
  // The (?) is re-created on every render, so re-bind it each time.
  var formHelpHideT = null;
  function placeFormPop(trigger){
    var pop = els.formPop; pop.classList.add('open');
    var r = trigger.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = r.left; if(left + w > window.innerWidth - 10) left = window.innerWidth - 10 - w;
    var top = r.bottom + 8; if(top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    pop.style.left = Math.round(Math.max(10, left)) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }
  function hideFormPop(){ els.formPop.classList.remove('open'); }
  function scheduleFormHide(){ clearTimeout(formHelpHideT); formHelpHideT = setTimeout(hideFormPop, 120); }
  function wireFormHelp(){
    var t = document.getElementById('formHelp'); if(!t) return;
    t.addEventListener('mouseenter', function(){ clearTimeout(formHelpHideT); placeFormPop(t); });
    t.addEventListener('focus', function(){ clearTimeout(formHelpHideT); placeFormPop(t); });
    t.addEventListener('mouseleave', scheduleFormHide);
    t.addEventListener('blur', scheduleFormHide);
  }
  els.formPop.addEventListener('mouseenter', function(){ clearTimeout(formHelpHideT); });
  els.formPop.addEventListener('mouseleave', scheduleFormHide);

  function openTrends(){ els.trendsModal.style.display = 'flex'; paintRangeButtons(); renderTrends(); }
  function closeTrends(){ hideFormPop(); els.trendsModal.style.display = 'none'; }
  function paintRangeButtons(){
    els.trendsRange.innerHTML = RANGES.map(function(r){ return '<button type="button" class="tr-range-btn' + (r[0] === trendsRange ? ' on' : '') + '" data-days="' + r[0] + '">' + r[1] + '</button>'; }).join('');
  }
  // The range only scales the Fitness/Fatigue + Form charts, so it lives with
  // the Performance tab and hides on Summary and Power.
  function updateRangeVisibility(){
    if(els.trendsRange) els.trendsRange.style.display = (trendsTab === 'performance') ? '' : 'none';
  }
  els.trendsRange.addEventListener('click', function(e){
    var b = e.target.closest('[data-days]'); if(!b) return;
    trendsRange = +b.getAttribute('data-days'); paintRangeButtons(); renderTrends();
  });
  // Sub-tab switch: show the chosen pane and draw its (previously hidden) charts.
  els.trendsBody.addEventListener('click', function(e){
    var b = e.target.closest('.tr-subtab'); if(!b) return;
    var t = b.getAttribute('data-pane'); if(t === trendsTab) return;
    trendsTab = t;
    [].forEach.call(els.trendsBody.querySelectorAll('.tr-subtab'), function(x){ x.classList.toggle('on', x.getAttribute('data-pane') === t); });
    [].forEach.call(els.trendsBody.querySelectorAll('.tr-tab'), function(x){ x.classList.toggle('on', x.getAttribute('data-pane') === t); });
    els.trendsBody.scrollTop = 0;   // a new pane starts at its top, not mid-scroll under the sticky tabs
    drawTab(t);
    updateRangeVisibility();
    moveSubUnderline();
  });
  // Sticky sub-tabs (mobile) lift off the charts with a shadow once scrolled.
  els.trendsBody.addEventListener('scroll', function(){
    var row = els.trendsBody.querySelector('.tr-subtabs');
    if(row) row.classList.toggle('is-stuck', els.trendsBody.scrollTop > 2);
  }, {passive:true});
  // Watts vs W/kg: a two-state switch — clicking either side flips it. Only the
  // power curve redraws, no recompute.
  els.trendsBody.addEventListener('click', function(e){
    if(!e.target.closest('.pc-unit-btn')) return;
    pcUnit = (pcUnit === 'wkg') ? 'w' : 'wkg';
    els.trendsBody.querySelectorAll('.pc-unit-btn').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-unit') === pcUnit); });
    if(lastCurve) drawPowerCurve(document.getElementById('pcCanvas'), lastCurve, pcUnit);
  });
  // TSS vs Hours on the 12-week trend: a two-state flick switch, same as watts/W·kg.
  // Only the trend card redraws; the preference is remembered.
  els.trendsBody.addEventListener('click', function(e){
    if(!e.target.closest('.wk-btn')) return;
    weekMetric = (weekMetric === 'tss') ? 'hours' : 'tss';
    try{ localStorage.setItem(WEEKMETRIC_KEY, weekMetric); }catch(err){}
    els.trendsBody.querySelectorAll('.wk-btn').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-wk') === weekMetric); });
    if(lastActs) drawWeeklyTrend(lastActs);
  });
  els.trendsBtn.addEventListener('click', openTrends);
  els.trendsCloseBtn.addEventListener('click', closeTrends);
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && els.trendsModal.style.display !== 'none') closeTrends(); });
  window.addEventListener('resize', function(){ if(els.trendsModal.style.display !== 'none') renderTrends(); });
