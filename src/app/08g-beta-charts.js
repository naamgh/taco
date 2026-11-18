  // ============================================================
  // FITNESS › BETA — charts on trial (from mockups/typographic-fitness-new-charts.html)
  // ============================================================
  // Three charts built only from light per-ride summaries that already sync:
  //   Aerobic efficiency — watts per heartbeat on steady work (ride.effort)
  //   Power change       — best efforts, last 6 weeks vs before (ride.pbCurve)
  //   Consistency        — a year of days shaded by load (effLoad)
  // Kept apart from the main tabs so they can be judged, changed or dropped.

  var BT_DAY = 86400000;
  var btCmp = 'prev';      // power change: 'prev' (6 wks before) | 'all' (all-time)
  var btView = 'change';   // power change: 'change' bars | 'curve' lines
  var btActs = null;       // kept so the power toggles redraw without a re-render
  var BT_TABLE = [15, 60, 300, 1200, 3600];
  var BT_LBL = {15:'15 s', 30:'30 s', 60:'1 min', 120:'2 min', 300:'5 min', 480:'8 min', 1200:'20 min', 3600:'60 min'};

  function btShortDate(ms){ var d = new Date(ms); return d.getDate() + ' ' + WK_MONS[d.getMonth()]; }
  function btPct(n){ return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n * 10) / 10) + '%'; }
  function btEmpty(msg){ return '<p class="bt-empty">' + msg + '</p>'; }

  // ---- 1 · aerobic efficiency ----
  // Steady sweet-spot/threshold blocks with heart rate: average power ÷
  // average HR. A least-squares line through 12 weeks gives the trend.
  function btEffPoints(acts){
    var since = Date.now() - 84 * BT_DAY;
    return acts.filter(function(a){ return a.startDateMs >= since && a.effort && a.effort.pw && a.effort.hr; })
      .map(function(a){ return {t:a.startDateMs, v:a.effort.pw / a.effort.hr, drift:a.effort.dec}; });
  }
  function btFit(pts){
    var n = pts.length, sx = 0, sy = 0, sxy = 0, sxx = 0, t0 = pts[0].t;
    pts.forEach(function(p){ var x = (p.t - t0) / BT_DAY; sx += x; sy += p.v; sxy += x * p.v; sxx += x * x; });
    var den = n * sxx - sx * sx, m = den ? (n * sxy - sx * sy) / den : 0, b = (sy - m * sx) / n;
    return function(t){ return b + m * (t - t0) / BT_DAY; };
  }
  function btEffHTML(acts){
    var pts = btEffPoints(acts);
    var head = '<div class="co-head"><span class="co-lbl">Aerobic efficiency</span><span class="co-basis">Steady efforts · last 12 weeks</span></div>';
    var spanDays = pts.length ? (pts[pts.length - 1].t - pts[0].t) / BT_DAY : 0;
    if(pts.length < 4 || spanDays < 21){
      return head + btEmpty('Needs a few more steady rides with a heart-rate strap — sweet spot or threshold blocks of 10+ minutes. ' +
        pts.length + ' so far' + (pts.length ? ', over ' + Math.round(spanDays) + ' days' : '') + '; it draws from 4 rides across 3 weeks.');
    }
    var fit = btFit(pts), a = fit(pts[0].t), z = fit(pts[pts.length - 1].t), ch = (z - a) / a * 100;
    var cls = ch >= 2 ? 'up' : ch <= -2 ? 'down' : 'hold';
    var why = ch >= 2 ? 'At the same heart rate you’re making <b>' + btPct(ch).slice(1) + ' more power</b> than in ' + btShortDate(pts[0].t).split(' ')[1] + ' — your aerobic engine is growing, even between FTP tests.'
            : ch <= -2 ? 'You’re making <b>' + btPct(ch).slice(1) + ' less power</b> per heartbeat than in ' + btShortDate(pts[0].t).split(' ')[1] + '. Fatigue, heat or a cold can all do this — worth watching, not worrying about.'
            : 'Holding steady — power per heartbeat hasn’t moved much in 12 weeks.';
    var drifts = pts.filter(function(p){ return p.drift !== null && p.drift !== undefined; });
    var last = drifts.slice(-10).map(function(p){ return p.drift; }).sort(function(x, y){ return x - y; });
    var med = last.length ? last[Math.floor(last.length / 2)] : null;
    return head +
      '<div class="bt-big"><span class="v">' + (Math.round(z * 100) / 100).toFixed(2) + '<small>W per heartbeat</small></span>' +
        '<span class="bt-delta ' + cls + '">' + btPct(ch) + ' since ' + btShortDate(pts[0].t) + '</span></div>' +
      '<p class="bt-why">' + why + '</p>' +
      '<canvas class="tr-canvas bt-cv" id="btEffCv" style="height:190px"></canvas>' +
      '<div class="bt-key"><span><i class="dot"></i>A steady effort</span><span><i class="ln"></i>Trend</span></div>' +
      (drifts.length >= 3
        ? '<div class="bt-sub"><div class="co-head"><span class="co-lbl">Heart-rate drift</span><span class="co-basis">' +
            (med !== null ? 'Last ' + last.length + ' · median ' + med.toFixed(1) + '% · under 5% is well-paced' : '') + '</span></div>' +
            '<canvas class="tr-canvas bt-cv" id="btDriftCv" style="height:74px"></canvas></div>'
        : '') +
      '<p class="bt-note">From rides with 10+ minutes at sweet spot or threshold and a heart-rate strap. Interval sessions are left out — they’d swamp the signal.</p>';
  }
  function btDrawEff(acts){
    var cv = document.getElementById('btEffCv'); if(!cv) return;
    var pts = btEffPoints(acts), fit = btFit(pts);
    var W = cv.clientWidth || 600, H = 190, ctx = setupCanvas(cv, W, H);
    var faint = cssVar('--text-faint'), strong = cssVar('--text-strong'), dot = tint('--text-dim', 0.45);
    var t1 = Date.now(), t0 = t1 - 84 * BT_DAY, pl = 38, pr = 8, pt = 10, pb = 22;
    var vals = pts.map(function(p){ return p.v; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = Math.max(0.03, (hi - lo) * 0.2);
    lo -= pad; hi += pad;
    function x(t){ return pl + (t - t0) / (t1 - t0) * (W - pl - pr); }
    function y(v){ return pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb); }
    ctx.font = '9.5px ' + IMG_MONO; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    [0.2, 0.5, 0.8].forEach(function(f){
      var v = lo + (hi - lo) * f;
      ctx.strokeStyle = gridColor(); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pl, y(v)); ctx.lineTo(W - pr, y(v)); ctx.stroke();
      ctx.fillStyle = faint; ctx.fillText(v.toFixed(2), pl - 7, y(v));
    });
    pts.forEach(function(p){ ctx.beginPath(); ctx.arc(x(p.t), y(p.v), 3.2, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill(); });
    var a = pts[0].t, b = pts[pts.length - 1].t;
    ctx.beginPath(); ctx.moveTo(x(a), y(fit(a))); ctx.lineTo(x(b), y(fit(b))); ctx.strokeStyle = strong; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x(b), y(fit(b)), 4.5, 0, Math.PI * 2); ctx.fillStyle = strong; ctx.fill();
    ctx.fillStyle = faint; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText(btShortDate(t0), pl, H - 5);
    ctx.textAlign = 'center'; ctx.fillText(btShortDate((t0 + t1) / 2), (pl + W - pr) / 2, H - 5);
    ctx.textAlign = 'right'; ctx.fillText('Today', W - pr, H - 5);

    var dv = document.getElementById('btDriftCv'); if(!dv) return;
    var dW = dv.clientWidth || W, dH = 74, dctx = setupCanvas(dv, dW, dH), max = 10;
    function dx(t){ return pl + (t - t0) / (t1 - t0) * (dW - pl - pr); }
    function dy(v){ return (1 - v / max) * (dH - 4); }
    dctx.strokeStyle = faint; dctx.lineWidth = 1; dctx.setLineDash([3, 3]);
    dctx.beginPath(); dctx.moveTo(pl, dy(5) + .5); dctx.lineTo(dW - pr, dy(5) + .5); dctx.stroke(); dctx.setLineDash([]);
    dctx.font = '9.5px ' + IMG_MONO; dctx.fillStyle = faint; dctx.textAlign = 'right'; dctx.textBaseline = 'middle'; dctx.fillText('5%', pl - 7, dy(5));
    var bw = Math.max(2, Math.min(6, (dW - pl - pr) / 84 * 0.7));   // narrower than a day, so back-to-back rides don't overlap
    pts.forEach(function(p){
      if(p.drift === null || p.drift === undefined) return;
      var v = Math.max(0, Math.min(max, p.drift)), h = Math.max(1.5, dy(0) - dy(v));
      dctx.fillStyle = p.drift > 5 ? tint('--text', 0.55) : tint('--text', 0.16);
      roundRect(dctx, dx(p.t) - bw / 2, dy(0) - h, bw, h, 1.5); dctx.fill();
    });
  }

  // ---- 2 · power change ----
  function btBests(acts, from, to){
    var out = {};
    acts.forEach(function(a){
      if(a.startDateMs < from || a.startDateMs >= to) return;
      var pc = a.pbCurve || (a.samples && a.samples.length ? pbCurveFor(a.samples) : null);
      if(!pc) return;
      PC_TARGETS.forEach(function(tg){ var b = pc[tg[0]]; if(b && (!out[tg[0]] || b > out[tg[0]])) out[tg[0]] = b; });
    });
    return out;
  }
  function btPower(acts){
    var now = Date.now(), cut = now - 42 * BT_DAY;
    var cur = btBests(acts, cut, now + BT_DAY);
    var ref = btCmp === 'prev' ? btBests(acts, now - 84 * BT_DAY, cut) : btBests(acts, 0, now + BT_DAY);
    var all = btCmp === 'prev' ? btBests(acts, 0, now + BT_DAY) : ref;
    var rows = PC_TARGETS.map(function(tg){
      var d = tg[0], c = cur[d], r = ref[d];
      return {d:d, cur:c ? Math.round(c) : null, ref:r ? Math.round(r) : null, pct:(c && r) ? (c - r) / r * 100 : null, best:!!(c && all[d] && c >= all[d] - 0.5)};
    });
    return {rows:rows, both:rows.filter(function(r){ return r.pct !== null; })};
  }
  function btPowerInner(acts){
    var pw = btPower(acts), refName = btCmp === 'prev' ? '6 weeks before' : 'your all-time best';
    var tgl = '<span class="trends-range bt-tgl">' +
      '<button type="button" class="tr-range-btn' + (btCmp === 'prev' ? ' on' : '') + '" data-bt-cmp="prev">vs 6 wks before</button>' +
      '<button type="button" class="tr-range-btn' + (btCmp === 'all' ? ' on' : '') + '" data-bt-cmp="all">vs all-time</button></span>';
    var head = '<div class="co-head"><span class="co-lbl">Power change</span>' + tgl + '</div>';
    if(pw.both.length < 3){
      return head + btEmpty(btCmp === 'prev'
        ? 'Needs indoor rides with power in both the last 6 weeks and the 6 weeks before. Try “vs all-time”, or check back after a few more rides.'
        : 'Needs a few indoor rides with power in the last 6 weeks.');
    }
    var up = pw.both.filter(function(r){ return r.pct > 0.4; }), dn = pw.both.filter(function(r){ return r.pct < -0.4; });
    var bests = pw.rows.filter(function(r){ return r.best && r.cur; }).length;
    var headline, why;
    if(btCmp === 'prev'){
      headline = !dn.length ? 'Up across the board' : !up.length ? 'Down across the board' : 'Up at ' + up.length + ' of ' + pw.both.length + ' durations';
      var hiR = pw.both.slice().sort(function(a, b){ return b.pct - a.pct; })[0], loR = pw.both.slice().sort(function(a, b){ return a.pct - b.pct; })[0];
      why = (hiR.pct > 0.4 ? 'Biggest gain: <b>+' + (hiR.cur - hiR.ref) + ' W at ' + BT_LBL[hiR.d] + '</b>. ' : '') +
            (loR.pct < -0.4 ? 'Biggest drop: <b>−' + (loR.ref - loR.cur) + ' W at ' + BT_LBL[loR.d] + '</b>' + (loR.d <= 60 ? ' — normal in a block without sprints.' : '.') : 'Nothing has slipped.');
    } else {
      headline = bests ? bests + ' all-time best' + (bests === 1 ? '' : 's') + ' in the last 6 weeks' : 'No new bests this block';
      var close = pw.both.slice().sort(function(a, b){ return b.pct - a.pct; })[0];
      why = bests ? 'You’re at your peak at <b>' + pw.rows.filter(function(r){ return r.best && r.cur; }).map(function(r){ return BT_LBL[r.d]; }).join(', ') + '</b>.'
                  : 'Closest to your best at <b>' + BT_LBL[close.d] + '</b> (' + btPct(close.pct) + ').';
    }
    var view = '<div class="bt-viewrow"><span class="trends-range bt-tgl">' +
      '<button type="button" class="tr-range-btn' + (btView === 'change' ? ' on' : '') + '" data-bt-view="change">Change</button>' +
      '<button type="button" class="tr-range-btn' + (btView === 'curve' ? ' on' : '') + '" data-bt-view="curve">Curve</button></span></div>';
    var key = btView === 'change'
      ? '<span><i class="sq up"></i>Higher than ' + refName + '</span><span><i class="sq down"></i>Lower</span>'
      : '<span><i class="ln"></i>Last 6 weeks</span><span><i class="ln dash"></i>' + (btCmp === 'prev' ? '6 weeks before' : 'All-time best') + '</span>';
    var trs = '<tr><th>Duration</th><th>Now</th><th>' + (btCmp === 'prev' ? 'Before' : 'Best') + '</th><th>Change</th></tr>' +
      BT_TABLE.map(function(d){
        var r = pw.rows.filter(function(x){ return x.d === d; })[0];
        if(!r || (!r.cur && !r.ref)) return '';
        var dv = (r.cur && r.ref) ? r.cur - r.ref : null, cls = dv > 0 ? 'up' : dv < 0 ? 'down' : 'flat';
        return '<tr><td>' + BT_LBL[d] + '</td><td class="now">' + (r.cur ? r.cur + ' W' + (r.best ? ' ★' : '') : '—') + '</td><td class="was">' + (r.ref ? r.ref + ' W' : '—') + '</td>' +
          '<td>' + (dv === null ? '<span class="flat">—</span>' : '<span class="' + cls + '"><span class="w">' + (dv > 0 ? '+' : dv < 0 ? '−' : '±') + Math.abs(dv) + ' W · </span>' + btPct(r.pct) + '</span>') + '</td></tr>';
      }).join('');
    return head +
      '<div class="bt-big"><span class="v txt">' + headline + '</span></div>' +
      '<p class="bt-why">' + why + '</p>' + view +
      '<canvas class="tr-canvas bt-cv" id="btPcCv" style="height:' + (btView === 'change' ? 200 : 230) + 'px"></canvas>' +
      '<div class="bt-key">' + key + '</div>' +
      '<div class="bt-tbl-wrap"><table class="bt-tbl">' + trs + '</table></div>' +
      '<p class="bt-note">Best efforts from indoor rides with power. ★ is an all-time best set in the last 6 weeks.</p>';
  }
  function btDrawPower(acts){
    var cv = document.getElementById('btPcCv'); if(!cv) return;
    var pw = btPower(acts), faint = cssVar('--text-faint'), strong = cssVar('--text-strong');
    var okC = cssVar('--ok'), badC = cssVar('--c-anaerobic');
    if(btView === 'change'){
      var W = cv.clientWidth || 600, H = 200, ctx = setupCanvas(cv, W, H), pt = 20, pb = 22, rows = pw.rows, n = rows.length;
      var ps = pw.both.map(function(r){ return r.pct; });
      var upM = Math.max(3, Math.max.apply(null, ps.concat([0])) + 1.5), dnM = Math.max(2, -Math.min.apply(null, ps.concat([0])) + 1.5);
      var gap = Math.max(6, W / 50), bw = (W - gap * (n - 1)) / n, span = H - pt - pb, mid = pt + span * upM / (upM + dnM);
      var y = function(v){ return mid - v / (upM + dnM) * span; };
      ctx.strokeStyle = faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid + .5); ctx.lineTo(W, mid + .5); ctx.stroke();
      ctx.font = '9.5px ' + IMG_MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      rows.forEach(function(r, i){
        var bx = i * (bw + gap), cx = bx + bw / 2;
        ctx.fillStyle = faint; ctx.fillText(PC_TARGETS[i][1], cx, H - 5);
        if(r.pct === null){ ctx.fillText('—', cx, mid - 6); return; }
        var top = Math.min(y(r.pct), mid), h = Math.max(1.5, Math.abs(y(r.pct) - mid));
        var col = r.pct > 0.4 ? okC : r.pct < -0.4 ? badC : faint;
        ctx.globalAlpha = Math.abs(r.pct) > 0.4 ? 0.85 : 0.5; ctx.fillStyle = col;
        roundRect(ctx, bx, top, bw, h, 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillText(btPct(r.pct), cx, r.pct >= 0 ? top - 6 : top + h + 12);
      });
      return;
    }
    var W2 = cv.clientWidth || 600, H2 = 230, c2 = setupCanvas(cv, W2, H2), pl = 40, pr = 8, pt2 = 10, pb2 = 22;
    var durs = PC_TARGETS.map(function(t){ return t[0]; }), lx0 = Math.log(durs[0]), lx1 = Math.log(durs[durs.length - 1]);
    var vals = [];
    pw.rows.forEach(function(r){ if(r.cur) vals.push(r.cur); if(r.ref) vals.push(r.ref); });
    var lo = Math.min.apply(null, vals) * 0.9, hi = Math.max.apply(null, vals) * 1.05;
    function x(d){ return pl + (Math.log(d) - lx0) / (lx1 - lx0) * (W2 - pl - pr); }
    function y2(v){ return pt2 + (1 - (v - lo) / (hi - lo)) * (H2 - pt2 - pb2); }
    c2.font = '9.5px ' + IMG_MONO; c2.textAlign = 'right'; c2.textBaseline = 'middle';
    var step = hi - lo > 500 ? 200 : hi - lo > 200 ? 100 : 50, ticks = [];
    for(var tv = Math.ceil(lo / step) * step; tv <= hi; tv += step) ticks.push(tv);
    ticks.forEach(function(v){
      c2.strokeStyle = gridColor(); c2.lineWidth = 1; c2.beginPath(); c2.moveTo(pl, y2(v)); c2.lineTo(W2 - pr, y2(v)); c2.stroke();
      c2.fillStyle = faint; c2.fillText(Math.round(v), pl - 7, y2(v));
    });
    function line(key, col, w, dash){
      c2.beginPath(); var started = false;
      pw.rows.forEach(function(r){ if(!r[key]) return; var px = x(r.d), py = y2(r[key]); if(!started){ c2.moveTo(px, py); started = true; } else c2.lineTo(px, py); });
      c2.strokeStyle = col; c2.lineWidth = w; c2.setLineDash(dash ? [4, 4] : []); c2.lineJoin = 'round'; c2.stroke(); c2.setLineDash([]);
    }
    line('ref', faint, 1.6, true); line('cur', strong, 2.2, false);
    pw.rows.forEach(function(r){ if(!r.cur) return; c2.beginPath(); c2.arc(x(r.d), y2(r.cur), 2.6, 0, Math.PI * 2); c2.fillStyle = strong; c2.fill(); });
    c2.fillStyle = faint; c2.textBaseline = 'alphabetic';
    PC_TARGETS.forEach(function(t, i){
      if([0, 2, 4, 6, 7].indexOf(i) < 0) return;
      c2.textAlign = i === 0 ? 'left' : i === PC_TARGETS.length - 1 ? 'right' : 'center';
      c2.fillText(t[1], x(t[0]), H2 - 5);
    });
  }

  // ---- 3 · consistency ----
  function btDays(acts){
    var byDay = {};
    acts.forEach(function(a){ byDay[a.day] = (byDay[a.day] || 0) + (effLoad(a) || 0) + 0.001; });   // +ε: a logged session with no load still shows
    return byDay;
  }
  function btConsHTML(acts){
    var byDay = btDays(acts), since = dayKey(Date.now() - 364 * BT_DAY);
    var sessions = acts.filter(function(a){ return a.day >= since; }).length;
    // Weeks with any session, counting back from this week; the run stops at the first empty one.
    var mon = new Date(mondayOf(Date.now())), weeks = [];
    for(var w = 0; w < 52; w++){
      var any = false, d = new Date(mon); d.setDate(d.getDate() - 7 * w);
      for(var k = 0; k < 7; k++){ var dd = new Date(d); dd.setDate(dd.getDate() + k); if(byDay[dayKey(dd.getTime())]) any = true; }
      weeks.push(any);
    }
    var run = 0, i0 = weeks[0] ? 0 : 1;   // an empty current week doesn't break the run yet
    for(var q = i0; q < weeks.length && weeks[q]; q++) run++;
    var key = [0, 1, 2, 3, 4].map(function(l){ return '<i class="l' + l + '"></i>'; }).join('');
    return '<div class="co-head"><span class="co-lbl">Consistency</span><span class="bt-heatkey">Less ' + key + ' More</span></div>' +
      '<div class="co-nums bt-stats">' +
        '<div><b>' + sessions + '</b><span>Sessions · 12 mo</span></div>' +
        '<div><b>' + weeks.filter(Boolean).length + '<small> / 52</small></b><span>Weeks with a session</span></div>' +
        '<div><b>' + run + '<small> wk' + (run === 1 ? '' : 's') + '</small></b><span>Current run</span></div>' +
      '</div>' +
      '<div class="bt-heat-wrap"><canvas class="tr-canvas bt-cv" id="btHeatCv"></canvas><div class="wk-tip" id="btHeatTip" hidden></div></div>' +
      '<p class="bt-note">A square per day, shaded by that day’s load. Any week with a session keeps the run going — a recovery week counts.</p>';
  }
  function btLevel(l){ return !l ? 0 : l < 50 ? 1 : l < 80 ? 2 : l < 110 ? 3 : 4; }
  function btLevelCol(n){ return n === 0 ? tint('--text', 0.06) : tint('--text', [0, 0.22, 0.42, 0.65, 0.9][n]); }
  function btDrawCons(acts){
    var cv = document.getElementById('btHeatCv'); if(!cv) return;
    var byDay = btDays(acts), W = cv.clientWidth || 600, gap = 3, labelW = 28;
    var cell = Math.max(8, Math.min(14, Math.floor((W - labelW + gap) / 53) - gap));
    var nWeeks = Math.min(53, Math.floor((W - labelW + gap) / (cell + gap)));
    var top = 16, H = top + 7 * (cell + gap), ctx = setupCanvas(cv, W, H), faint = cssVar('--text-faint');
    var today = new Date(); today.setHours(12, 0, 0, 0);
    var mon0 = new Date(mondayOf(Date.now())); mon0.setDate(mon0.getDate() - 7 * (nWeeks - 1)); mon0.setHours(12, 0, 0, 0);
    ctx.font = '9px ' + IMG_MONO; ctx.fillStyle = faint; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    [['Mon', 0], ['Wed', 2], ['Fri', 4]].forEach(function(r){ ctx.fillText(r[0], 0, top + r[1] * (cell + gap) + cell / 2); });
    var cells = [], prevMonth = -1;
    for(var c = 0; c < nWeeks; c++){
      for(var r = 0; r < 7; r++){
        var d = new Date(mon0); d.setDate(d.getDate() + c * 7 + r);
        if(d > today) continue;
        var k = dayKey(d.getTime()), load = byDay[k] || 0, cx = labelW + c * (cell + gap), cy = top + r * (cell + gap);
        ctx.fillStyle = btLevelCol(btLevel(load)); roundRect(ctx, cx, cy, cell, cell, 2); ctx.fill();
        cells.push({x:cx, y:cy, s:cell, t:d.getTime(), load:load});
        if(r === 0 && d.getDate() <= 7 && d.getMonth() !== prevMonth){
          prevMonth = d.getMonth(); ctx.fillStyle = faint; ctx.textBaseline = 'alphabetic'; ctx.fillText(WK_MONS[prevMonth], cx, 10); ctx.textBaseline = 'middle';
        }
      }
    }
    document.querySelectorAll('.bt-heatkey i').forEach(function(el, i){ el.style.background = btLevelCol(i); });
    cv._cells = cells;
    if(cv._wired) return; cv._wired = true;
    var tip = document.getElementById('btHeatTip');
    cv.addEventListener('mousemove', function(e){
      var rect = cv.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var hit = (cv._cells || []).filter(function(q){ return mx >= q.x && mx < q.x + q.s && my >= q.y && my < q.y + q.s; })[0];
      if(!hit || !tip){ if(tip) tip.hidden = true; return; }
      tip.innerHTML = '<b>' + btShortDate(hit.t) + '</b><span>' + (hit.load >= 1 ? 'TSS ' + Math.round(hit.load) : hit.load ? 'Session' : 'Rest') + '</span>';
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, hit.x + hit.s / 2 - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, hit.y - tip.offsetHeight - 6) + 'px';
    });
    cv.addEventListener('mouseleave', function(){ if(tip) tip.hidden = true; });
  }

  // ---- the pane ----
  function betaPaneHTML(acts, on){
    btActs = acts;
    return '<section class="tr-tab' + (on ? ' on' : '') + '" data-pane="beta">' +
      '<p class="bt-intro"><span class="co-beta">Beta</span>Charts on trial — they may change or go. Numbers come from rides already logged.</p>' +
      '<div class="tr-card bt-card">' + btEffHTML(acts) + '</div>' +
      '<div class="tr-card bt-card" id="btPowerCard">' + btPowerInner(acts) + '</div>' +
      '<div class="tr-card bt-card">' + btConsHTML(acts) + '</div>' +
    '</section>';
  }
  function drawBeta(){
    if(!btActs) return;
    btDrawEff(btActs); btDrawPower(btActs); btDrawCons(btActs);
  }
  els.trendsBody.addEventListener('click', function(e){
    var b = e.target.closest('[data-bt-cmp],[data-bt-view]'); if(!b || !btActs) return;
    if(b.hasAttribute('data-bt-cmp')) btCmp = b.getAttribute('data-bt-cmp'); else btView = b.getAttribute('data-bt-view');
    var card = document.getElementById('btPowerCard'); if(!card) return;
    card.innerHTML = btPowerInner(btActs);
    btDrawPower(btActs);
  });
