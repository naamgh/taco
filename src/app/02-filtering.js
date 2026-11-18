  // ============================================================
  // LIBRARY FILTERING
  // ============================================================
  // Sort is a remembered preference (not a filter): default Name (A–Z), then
  // whatever the rider last chose.
  var SORT_KEY = 'ftpPlan_sort_v1';
  var savedSort = 'name';
  try{ var _s = localStorage.getItem(SORT_KEY); if(_s) savedSort = _s; }catch(e){}
  var filters = {duration:null, zone:null, shape:null, spice:null, search:'', sort:savedSort, starredOnly:false};
  // Set by the desktop chrome (10-desktop-nav) so the compact top filter bar can
  // mirror slider state every time the filters re-render. Null on mobile.
  var onFiltersRendered = null;

  // Whether the recommended badges are shown at all. A preference, not a
  // filter: on, the badged rides wear the pill and lead the list; off, the
  // library is just the library and the rider picks their own way through.
  // On by default, so a newcomer gets the guidance; remembered once changed.
  // Recommended rides always wear their badge and lead the list. (The toggle
  // that could hide them was removed 2026-09-24.)
  var showRec = true;

  // Display order for the Shape filter. Labels come from the library so the
  // app and generator can't disagree about what a shape is called.
  var SHAPE_ORDER = ['short','long','overunder','micro','ladder','steady'];
  var SHAPE_FALLBACK = {
    short:{label:'Short intervals'}, long:{label:'Long intervals'}, overunder:{label:'Over/unders'},
    micro:{label:'Micro'}, ladder:{label:'Ladders'}, steady:{label:'Steady'}
  };
  function shapeLabel(k){
    var s = (LIBRARY && LIBRARY.shapes && LIBRARY.shapes[k]) || SHAPE_FALLBACK[k];
    return s ? s.label : k;
  }

  var SORT_OPTIONS = [
    {v:'starred',  label:'Starred first'},
    {v:'tss',      label:'Hardest first'},
    {v:'tss-asc',  label:'Easiest first'},
    {v:'dur',      label:'Longest first'},
    {v:'dur-asc',  label:'Shortest first'},
    {v:'name',     label:'Name (A–Z)'}
  ];

  // ---- favourites ----
  var FAVS_KEY = 'ftpPlan_favs_v1';
  function loadFavs(){
    try{ return JSON.parse(localStorage.getItem(FAVS_KEY)) || {}; }catch(e){ return {}; }
  }
  function saveFavs(){
    try{ localStorage.setItem(FAVS_KEY, JSON.stringify(favs)); }catch(e){}
  }
  var favs = loadFavs();
  function isFav(k){ return !!favs[k]; }
  function toggleFav(k){
    if(favs[k]) delete favs[k]; else favs[k] = true;
    saveFavs();
  }
  function starSvg(){
    return '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
      '<path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.6z" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  }

  // Broad at the stem, tapering to a point \u2014 a constant-width curve reads
  // as a crescent, not a chilli.
  var CHILLI_HEAT = ['#8FD14F','#D7D14F','#F2B84A','#F2764A','#FF3B30'];
  function chilliSvg(colour, stem){
    return '<svg class="chilli" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M11.4 6.4C10.7 4.5 11.8 2.6 13.9 2.4" stroke="' + (stem || '#5FE39A') +
        '" stroke-width="1.9" stroke-linecap="round"/>' +
      '<path d="M11.2 6C15.8 4.6 19.6 7.2 20.2 11.6C20.9 16.8 15.6 21.6 9 22.6' +
        'C7.6 22.8 7 21.3 8.1 20.6C11.4 18.4 12.8 14.8 12.4 11C12.2 8.8 12 7 11.2 6Z" ' +
        'fill="' + colour + '"/></svg>';
  }
  function chillies(n){
    var out = '<span class="chillies" title="Spice ' + n + ' of 5">';
    for(var i = 1; i <= n; i++){
      out += chilliSvg(CHILLI_HEAT[n-1]);
    }
    return out + '</span>';
  }

  // "How hard should it feel" filters on three groups, not the exact 1-5 chilli
  // rating (picking a 3 vs a 4 just reads as false precision). Cards still show
  // the exact rating; only the filter groups. Easy = 1-2, Medium = 3-4, Hard = 5.
  var SPICE_ORDER = ['easy', 'medium', 'hard'];
  var SPICE_GROUPS = {easy:[1,2], medium:[3,4], hard:[5]};
  var SPICE_LABEL = {easy:'Easy', medium:'Medium', hard:'Hard'};
  var SPICE_HEAT = {easy:CHILLI_HEAT[0], medium:CHILLI_HEAT[2], hard:CHILLI_HEAT[4]};
  function spiceGroupOf(n){ return n <= 2 ? 'easy' : (n <= 4 ? 'medium' : 'hard'); }


  // ---- filter sliders ----
  // A segmented single-pick slider. `segs` are the track colours (index 0 is
  // the neutral "Any"); the knob snaps to the centre of the chosen segment.
  // While dragging the knob tracks the cursor 1:1 (clamped to the first/last
  // segment centres) — without that it only ever jumps between segment
  // centres and small movements give no feedback, which reads as a dead drag.
  function segSlider(el, segs, cb){
    var N = segs.length;
    el.innerHTML = '<div class="fbar">' +
      segs.map(function(c){ return '<span style="background:' + c + '"></span>'; }).join('') +
      '</div><div class="fknob"></div>';
    el.setAttribute('aria-valuemax', N - 1);
    var knob = el.querySelector('.fknob'), val = 0;
    function place(){ knob.style.left = ((val + 0.5) / N * 100) + '%'; }
    function set(v, quiet){
      v = Math.max(0, Math.min(N - 1, v));
      if(v === val) return;
      val = v;
      el.setAttribute('aria-valuenow', val);
      if(!quiet) cb(val);
    }
    function segAt(x){
      var r = el.getBoundingClientRect();
      return Math.max(0, Math.min(N - 1, Math.floor((x - r.left) / r.width * N)));
    }
    function follow(x){
      var r = el.getBoundingClientRect(), half = r.width / (2 * N);
      var px = Math.max(half, Math.min(r.width - half, x - r.left));
      knob.style.left = (px / r.width * 100) + '%';
    }
    var drag = false;
    function end(){ if(!drag) return; drag = false; el.classList.remove('dragging'); place(); }
    el.addEventListener('pointerdown', function(e){
      e.preventDefault();                                  // don't fight text selection
      drag = true; el.classList.add('dragging');
      try{ el.setPointerCapture(e.pointerId); }catch(_){}   // never let this abort the click
      set(segAt(e.clientX)); follow(e.clientX);
    });
    el.addEventListener('pointermove', function(e){ if(!drag) return; set(segAt(e.clientX)); follow(e.clientX); });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    window.addEventListener('pointerup', end);             // safety net if capture is lost
    // Wheel over the bar nudges one segment. Deltas accumulate so a trackpad
    // flick steps once rather than flying across the range.
    var acc = 0;
    el.addEventListener('wheel', function(e){
      e.preventDefault();
      var dy = e.deltaY || 0, dx = e.deltaX || 0;
      acc += Math.abs(dx) > Math.abs(dy) ? dx : -dy;       // positive = move right
      if(Math.abs(acc) < 30) return;
      var dir = acc > 0 ? 1 : -1; acc = 0;
      set(val + dir); place();
    }, {passive:false});
    // Used by renderFilters to push state in without firing the callback back.
    el.__sync = function(v){ set(v, true); place(); };
    place();
  }

  // data-txt keeps the original text so a segment marked unavailable (its
  // label swapped for a ×) can be restored when the combination opens up again.
  function segLabels(el, labels){
    var n = labels.length;
    el.innerHTML = labels.map(function(t, i){
      return '<span data-txt="' + t + '" style="left:' + ((i + 0.5) / n * 100) + '%">' + t + '</span>';
    }).join('');
  }
  function markSegLabel(el, v){
    [].forEach.call(el.children, function(s, i){ s.classList.toggle('on', i === v); });
  }

  // Each shape drawn as its own power-profile silhouette: bars on a baseline,
  // given as [x, width, height] in a 60x30 box.
  var SHAPE_GLYPHS = {
    short:     [[6,7,22],[20,7,22],[34,7,22],[48,7,22]],
    long:      [[6,20,18],[34,20,18]],
    overunder: [[5,12,22],[17,12,13],[29,12,22],[41,12,13]],
    micro:     [[5,3,19],[11,3,19],[17,3,19],[23,3,19],[29,3,19],[35,3,19],[41,3,19],[47,3,19]],
    ladder:    [[5,11,8],[18,11,14],[31,11,20],[44,11,25]],
    steady:    [[6,48,13]]
  };
  function glyphSvg(bars){
    if(!bars) return '';
    var base = 27;
    return '<svg class="glyph" viewBox="0 0 60 30" aria-hidden="true">' + bars.map(function(b){
      return '<rect x="' + b[0] + '" y="' + (base - b[2]) + '" width="' + b[1] + '" height="' + b[2] + '" rx="1.5"/>';
    }).join('') + '</svg>';
  }

  // Coggan numbering, not 1-6 positions. The library has no Z1 recovery rides,
  // so Endurance is Z2. Sweet Spot isn't a zone of its own — it's the 88-94%
  // band across the top of Z3 and the bottom of Z4 — so it gets "SS", and a
  // fitness test isn't a training zone at all, so it gets "T".
  var ZONE_SEG_LABEL = {
    endurance:'2', tempo:'3', sweetspot:'SS', threshold:'4',
    vo2:'5', anaerobic:'6', test:'T'
  };

  // The slider options, rebuilt only when the library's contents change.
  var filterOpts = null, filterSig = '';

  function buildFilterControls(){
    var durations = [];
    WORKOUTS.forEach(function(w){ if(durations.indexOf(w.durationMin) < 0) durations.push(w.durationMin); });
    durations.sort(function(a, b){ return a - b; });

    var zones = FILTER_ZONES.filter(function(z){
      return ZONES[z] && WORKOUTS.some(function(w){ return w.zone === z; });
    });
    var shapes = SHAPE_ORDER.filter(function(k){
      // Only offer shapes the library actually contains. ('test' is
      // deliberately absent from SHAPE_ORDER: tests are a focus, not a shape.)
      return WORKOUTS.some(function(w){ return w.shape === k; });
    });

    var sig = durations.join(',') + '|' + zones.join(',') + '|' + shapes.join(',');
    if(sig === filterSig) return;
    filterSig = sig;
    filterOpts = {durations:durations, zones:zones, shapes:shapes};

    // Time — a single flat grey bar; the labels and knob carry the meaning.
    var durCols = [];
    for(var i = 0; i <= durations.length; i++) durCols.push('var(--seg-any)');
    segSlider(els.durFilter, durCols,
      function(v){ setFilter('duration', v === 0 ? null : durations[v - 1]); });
    segLabels(els.durSegLabels, ['Any'].concat(durations.map(String)));

    // Zone — the colour bar is the zone legend. Tests get a "T" rather than a
    // number, since a fitness test isn't one of the numbered training zones.
    // Tests share the anaerobic red, so they'd melt into the segment next door.
    // Striping them keeps the "different kind of thing" signal the old dashed
    // test chip had.
    segSlider(els.zoneFilter, ['var(--seg-any)'].concat(zones.map(function(z){
      return z === 'test'
        ? 'repeating-linear-gradient(45deg,' + ZONES[z].color + ' 0 4px,rgba(10,12,17,.42) 4px 8px)'
        : ZONES[z].color;
    })), function(v){ setFilter('zone', v === 0 ? null : zones[v - 1]); });
    segLabels(els.zoneSegLabels, ['Any'].concat(zones.map(function(z){
      return ZONE_SEG_LABEL[z] || '?';
    })));

    // Spice — grouped Easy / Medium / Hard, each a heat swatch from the ramp.
    segSlider(els.spiceFilter, ['var(--seg-any)', SPICE_HEAT.easy, SPICE_HEAT.medium, SPICE_HEAT.hard],
      function(v){ setFilter('spice', v === 0 ? null : SPICE_ORDER[v - 1]); });
    segLabels(els.spiceSegLabels, ['Any', 'Easy', 'Medium', 'Hard']);

    els.shapeFilter.innerHTML = shapes.map(function(k){
      return '<button type="button" class="shape-tile" data-shape="' + k + '">' +
        glyphSvg(SHAPE_GLYPHS[k]) + '<span class="name">' + shapeLabel(k) + '</span></button>';
    }).join('');
    [].forEach.call(els.shapeFilter.querySelectorAll('[data-shape]'), function(b){
      b.addEventListener('click', function(){ setFilter('shape', b.getAttribute('data-shape')); });
    });
  }

  // html, because the spice value is rendered as chilli SVGs.
  function setFilterVal(el, html, any){
    el.innerHTML = html;
    el.className = 'filter-val' + (any ? ' any' : '');
  }

  // Syncs the controls to `filters`. The sliders are built once and then only
  // repositioned, so a rebuild never interrupts a drag.
  function renderFilters(){
    buildFilterControls();
    if(!filterOpts) return;
    var o = filterOpts;

    var di = filters.duration === null ? 0 : o.durations.indexOf(filters.duration) + 1;
    els.durFilter.__sync(di);
    markSegLabel(els.durSegLabels, di);
    setFilterVal(els.durVal, di === 0 ? 'Any' : o.durations[di - 1] + ' min', di === 0);

    var zi = filters.zone === null ? 0 : o.zones.indexOf(filters.zone) + 1;
    els.zoneFilter.__sync(zi);
    markSegLabel(els.zoneSegLabels, zi);
    setFilterVal(els.zoneVal, zi === 0 ? 'Any' : ZONES[o.zones[zi - 1]].label, zi === 0);

    var si = filters.spice === null ? 0 : (SPICE_ORDER.indexOf(filters.spice) + 1);
    els.spiceFilter.__sync(si);
    markSegLabel(els.spiceSegLabels, si);
    setFilterVal(els.spiceVal, si === 0 ? 'Any' : SPICE_LABEL[filters.spice], si === 0);
    els.spiceLabel.classList.toggle('hot', filters.spice === 'hard');

    [].forEach.call(els.shapeFilter.querySelectorAll('[data-shape]'), function(b){
      b.classList.toggle('on', filters.shape === b.getAttribute('data-shape'));
    });
    paintShapeAny();

    // Mark the options that lead nowhere, so a dead end is visible before it's
    // reached rather than after.
    paintAvail(els.durFilter,   els.durSegLabels,   'duration', o.durations, di);
    paintAvail(els.zoneFilter,  els.zoneSegLabels,  'zone',     o.zones,     zi);
    paintAvail(els.spiceFilter, els.spiceSegLabels, 'spice',    SPICE_ORDER, si);
    paintShapeAvail();

    // Time, Spice and Shape don't apply while the tests are selected (see
    // filteredWorkouts), so show them standing down rather than leaving them
    // looking active but inert.
    var testsOnly = filters.zone === 'test';
    [els.durFilter, els.spiceFilter, els.shapeFilter].forEach(function(el){
      var g = el.closest('.side-group');
      if(!g) return;
      g.classList.toggle('filter-off', testsOnly);
      g.title = testsOnly ? 'Not applied while Fitness test is selected' : '';
    });
    if(onFiltersRendered) onFiltersRendered();   // mirror into the desktop top bar
  }

  // The readout is also the clear control: "Any" while nothing is picked, the
  // shape's name plus a circled red × once one is.
  function paintShapeAny(){
    var a = els.shapeAny, on = filters.shape !== null;
    a.classList.toggle('is-any', !on);
    a.classList.toggle('can-clear', on);
    if(!on){
      a.textContent = 'Any';
      a.removeAttribute('title');
      a.setAttribute('aria-label', 'Shape: any');
    } else {
      var label = shapeLabel(filters.shape);
      a.innerHTML = '<span class="sa-name">' + label + '</span><span class="sa-x">×</span>';
      a.title = 'Clear shape filter';
      a.setAttribute('aria-label', 'Clear shape filter: ' + label);
    }
  }
  els.shapeAny.addEventListener('click', function(){
    if(filters.shape === null) return;
    filters.shape = null;
    renderFilters();
    renderWorkoutCards();
  });

  // ---- availability ----
  // Whether a segment still leads somewhere, holding the *other* filters
  // fixed. A facet must never constrain itself — otherwise picking one zone
  // greys out every other zone and the control appears to lock.
  function probeFilters(key, value){
    var p = {
      duration:filters.duration, zone:filters.zone, shape:filters.shape,
      spice:filters.spice, search:filters.search, starredOnly:filters.starredOnly
    };
    p[key] = value;
    return p;
  }
  function anyMatch(f){
    for(var i = 0; i < WORKOUTS.length; i++) if(passesFilters(WORKOUTS[i], f)) return true;
    return false;
  }
  function countMatching(f){
    var n = 0;
    for(var i = 0; i < WORKOUTS.length; i++) if(passesFilters(WORKOUTS[i], f)) n++;
    return n;
  }
  // `values[i]` is the filter value behind segment i+1; segment 0 is "Any",
  // which is the way out and so is never marked. `cur` is where the knob sits.
  function paintAvail(el, labelsEl, key, values, cur){
    var segs = el.querySelectorAll('.fbar span'), labs = labelsEl.children, i;
    // The tests bypass the other filters, so their segment is always live.
    function isTest(i){ return key === 'zone' && values[i-1] === 'test'; }
    var live = [];
    for(i = 0; i < segs.length; i++){
      live[i] = i === 0 || isTest(i) || anyMatch(probeFilters(key, values[i-1]));
    }
    // Parked on a × and the control offers no way out on its own, so every
    // segment that still leads somewhere lights up. The fitness test is left
    // out: it's live whatever else is set, so it would glow every single time
    // the top of the bar empties, and a test isn't the workout they came for.
    var stuck = !live[cur];
    for(i = 0; i < segs.length; i++){
      segs[i].classList.toggle('dead', !live[i]);
      segs[i].classList.toggle('lure', stuck && live[i] && !isTest(i));
      if(labs[i]){
        labs[i].classList.toggle('dead', !live[i]);
        labs[i].textContent = live[i] ? labs[i].getAttribute('data-txt') : '×';
      }
    }
  }
  function paintShapeAvail(){
    [].forEach.call(els.shapeFilter.querySelectorAll('[data-shape]'), function(b){
      var k = b.getAttribute('data-shape');
      var dead = !anyMatch(probeFilters('shape', k));
      b.classList.toggle('dead', dead);
      // The selected tile is never disabled, even if a later filter change
      // emptied it — it has to stay clickable so it can be deselected.
      b.disabled = dead && filters.shape !== k;
      b.title = dead ? 'No ' + shapeLabel(k).toLowerCase() + ' workouts match the current time, zone and spice' : '';
    });
  }

  function setFilter(key, value){
    // Clicking the active chip clears it, so a filter can be undone without
    // hunting for "Any".
    filters[key] = (filters[key] === value) ? null : value;
    renderFilters();
    renderWorkoutCards();
  }

  // ---- find a workout (quick-pick modal) ----
  // Big-button chooser for the three questions a rider can answer up front:
  // duration, effort (zone) and intensity (spice). Each is optional; the count
  // updates live and Show applies them to the list. Rows are data-driven from
  // the library so they never drift from the sliders. (Replaced the guided
  // walkthrough.)
  var findSel = {duration:null, zone:null, spice:null};
  function findVal(key, s){ return s === '' ? null : ((key === 'zone' || key === 'spice') ? s : +s); }
  function findProbe(){
    return {duration:findSel.duration, zone:findSel.zone, spice:findSel.spice,
            shape:null, search:'', starredOnly:false};
  }
  function findOptHtml(val, label, colorDot){
    var dot = colorDot ? '<span class="find-dot" style="background:' + colorDot + '"></span>' : '';
    return '<button type="button" class="find-opt" data-val="' + (val === null ? '' : val) + '">' + dot + label + '</button>';
  }
  function buildFindRows(){
    if(!filterOpts || !els.findDur) return;
    // No "Any" chip: nothing selected already means any, and re-tapping the
    // active chip clears it. The unit lives in the section header now.
    els.findDur.innerHTML = filterOpts.durations.map(function(d){ return findOptHtml(d, String(d)); }).join('');
    els.findZone.innerHTML = filterOpts.zones.filter(function(z){ return z !== 'test'; }).map(function(z){
      return findOptHtml(z, ZONES[z].label, ZONES[z].hex);
    }).join('');
    els.findSpice.innerHTML = SPICE_ORDER.map(function(g){
      return '<button type="button" class="find-opt find-spice" data-val="' + g + '">' +
             chilliSvg(SPICE_HEAT[g]) + '<i>' + SPICE_LABEL[g] + '</i></button>';
    }).join('');
    markFindRow(els.findDur, 'duration');
    markFindRow(els.findZone, 'zone');
    markFindRow(els.findSpice, 'spice');
  }
  function markFindRow(host, key){
    [].forEach.call(host.querySelectorAll('.find-opt'), function(b){
      b.classList.toggle('on', findVal(key, b.getAttribute('data-val')) === findSel[key]);
    });
  }
  function updateFindClear(){
    if(!els.findClear) return;
    var any = findSel.duration !== null || findSel.zone !== null || findSel.spice !== null;
    els.findClear.hidden = !any;
  }
  function updateFindCount(){
    if(!els.findApply) return;
    var n = countMatching(findProbe());
    els.findApply.disabled = n === 0;
    els.findApply.textContent = n === 0 ? 'No workouts match' : ('Show ' + n + ' workout' + (n === 1 ? '' : 's'));
    updateFindClear();
  }
  function openFindModal(){
    if(!els.findModal) return;
    findSel.duration = filters.duration;
    findSel.zone = filters.zone === 'test' ? null : filters.zone;   // tests aren't an "effort"
    findSel.spice = filters.spice;
    buildFindRows();
    updateFindCount();
    els.findModal.hidden = false;
    void els.findModal.offsetHeight;   // reflow so the open transition runs
    els.findModal.classList.add('open');
  }
  function closeFindModal(){
    if(!els.findModal) return;
    els.findModal.classList.remove('open');
    var m = els.findModal;
    setTimeout(function(){ if(!m.classList.contains('open')) m.hidden = true; }, 220);
  }
  // Dismissing Quick Pick (X, scrim, Esc, or "Close & browse all") reveals the
  // full list — it's the landing, so there's always a way through to browsing.
  function closeFindAndBrowse(){
    browseAll = true;
    closeFindModal();
    renderWorkoutCards();
  }
  function applyFind(){
    // A fresh query: the three picks are the whole of it, so shape/search/star
    // stand down (the sidebar sliders are still there to fine-tune afterwards).
    filters.duration = findSel.duration;
    filters.zone = findSel.zone;
    filters.spice = findSel.spice;
    filters.shape = null; filters.search = ''; filters.starredOnly = false;
    if(els.searchBox) els.searchBox.value = '';
    browseAll = true;                        // engaged — the zero-state stands down
    if(mqMobile.matches) setMobileTab('workouts');
    renderFilters(); renderWorkoutCards();   // reveals the (filtered) list + Filters FAB
    if(typeof updateStarFilterUI === 'function') updateStarFilterUI();
    animateFindClose();
  }
  // On mobile the modal flies into the Filters button, teaching where to refine;
  // on desktop (no Filters button) it just fades closed. Falls back cleanly.
  function animateFindClose(){
    var panel = els.findModal && els.findModal.querySelector('.find-panel');
    var reduce = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(mqMobile.matches && els.filtersFab && panel && !reduce && panel.animate){
      var fr = els.filtersFab.getBoundingClientRect();
      if(fr.width){
        var pr = panel.getBoundingClientRect();
        var dx = (fr.left + fr.width / 2) - (pr.left + pr.width / 2);
        var dy = (fr.top + fr.height / 2) - (pr.top + pr.height / 2);
        els.findModal.classList.add('to-filters');
        var anim = panel.animate(
          [{transform:'none', opacity:1},
           {transform:'translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px) scale(0.1)', opacity:0}],
          {duration:340, easing:'cubic-bezier(.4,0,.2,1)'});
        anim.onfinish = anim.oncancel = function(){
          els.findModal.classList.remove('open', 'to-filters');
          els.findModal.hidden = true;
          if(els.filtersFab){ els.filtersFab.classList.add('fab-land'); setTimeout(function(){ els.filtersFab.classList.remove('fab-land'); }, 480); }
        };
        return;
      }
    }
    closeFindModal();
  }
  if(els.findModal){
    [[els.findDur, 'duration'], [els.findZone, 'zone'], [els.findSpice, 'spice']].forEach(function(pair){
      pair[0].addEventListener('click', function(e){
        var b = e.target.closest('.find-opt'); if(!b) return;
        var val = findVal(pair[1], b.getAttribute('data-val'));
        findSel[pair[1]] = (findSel[pair[1]] === val) ? null : val;   // re-tap deselects to Any
        markFindRow(pair[0], pair[1]);
        updateFindCount();
      });
    });
    els.findApply.addEventListener('click', applyFind);
    if(els.findClear) els.findClear.addEventListener('click', function(){
      findSel.duration = findSel.zone = findSel.spice = null;
      markFindRow(els.findDur, 'duration');
      markFindRow(els.findZone, 'zone');
      markFindRow(els.findSpice, 'spice');
      updateFindCount();
    });
    [].forEach.call(els.findModal.querySelectorAll('[data-findclose]'), function(x){ x.addEventListener('click', closeFindAndBrowse); });
    var findBrowse = document.getElementById('findBrowseAll');
    if(findBrowse) findBrowse.addEventListener('click', closeFindAndBrowse);
    document.addEventListener('keydown', function(e){ if(!els.findModal.hidden && e.key === 'Escape') closeFindAndBrowse(); });
  }

  // ---- list zero-state ----
  // Until the rider searches or filters, the whole list sits blurred behind a
  // single "Find a workout" call, so the library isn't a wall on open. Engaging
  // (a pick, or "browse all") clears it for the session; Reset brings it back.
  var browseAll = false, findLandingDone = LOG_MODE;   // the log page never lands on Quick Pick
  function isZeroQuery(){
    return filters.duration === null && filters.zone === null && filters.spice === null &&
           filters.shape === null && !filters.starredOnly && !(filters.search && filters.search.trim());
  }
  // The opening screen is now Quick Pick itself: on a fresh zero-state the Find
  // modal opens over the list (its own scrim dims it), instead of a blurred veil
  // with a prompt card. Dismissing it (any way) reveals the full list.
  function updateListZero(){
    if(!els.listZero || !els.listPane) return;
    var show = isZeroQuery() && !browseAll && WORKOUTS.length > 0;
    els.listPane.classList.remove('zero-on');   // no blurred veil any more
    els.listZero.hidden = true;
    if(show && !findLandingDone && els.findModal){
      var intro = document.getElementById('introModal');
      if(!(intro && intro.style.display !== 'none')){   // let the first-run FTP intro go first
        findLandingDone = true;
        openFindModal();
      }
    }
  }
  if(els.listZeroGo) els.listZeroGo.addEventListener('click', openFindModal);
  // The Quick Pick button in the filter row (the old result-count slot). Opens
  // the Find modal, which pre-fills from the current filters. Ignored until the
  // library has loaded so it can't open an empty picker during boot.
  if(els.resultCount) els.resultCount.addEventListener('click', function(){ if(filterOpts) openFindModal(); });
  // Drop a soft shadow under the sticky filter row once the list scrolls beneath
  // it, so the header reads as its own layer. .list-body is the scroller on both
  // desktop and mobile.
  (function(){
    var body = document.querySelector('.list-body');
    var top = document.getElementById('listTop');
    if(!body || !top) return;
    var sync = function(){ top.classList.toggle('is-stuck', body.scrollTop > 2); };
    body.addEventListener('scroll', sync, {passive:true});
    sync();
  })();
  if(els.listZeroBrowse) els.listZeroBrowse.addEventListener('click', function(){
    // Engaging "browse all" re-renders so the detail pane opens the first
    // workout (the fresh zero-state deliberately left it blank).
    browseAll = true; renderWorkoutCards();
  });

  // Asking for the tests is an explicit "show me the tests": there are only
  // two of them and they have fixed durations and structures, so leaving a
  // stale time/shape/spice filter in place would strand the rider on an empty
  // list. Those three stand down while the test zone is picked.
  function passesFilters(w, f){
    var testsOnly = f.zone === 'test';
    if(f.starredOnly && !isFav(w.key)) return false;
    if(f.zone !== null && w.zone !== f.zone) return false;
    if(!testsOnly){
      if(f.duration !== null && w.durationMin !== f.duration) return false;
      if(f.shape !== null && w.shape !== f.shape) return false;
      if(f.spice !== null && (!SPICE_GROUPS[f.spice] || SPICE_GROUPS[f.spice].indexOf(w.spice) < 0)) return false;
    }
    var q = (f.search || '').trim().toLowerCase();
    if(q && (w.name + ' ' + w.short).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }

  function filteredWorkouts(){
    var out = WORKOUTS.filter(function(w){ return passesFilters(w, filters); });
    var s = filters.sort;
    out.sort(function(a, b){
      // Fitness tests are an all-out special case, not a workout for "today" —
      // they always sink to the bottom, whatever the sort (unless the rider has
      // asked for the test zone, where everything is a test so this is a no-op).
      var ta = a.zone === 'test' ? 1 : 0, tb = b.zone === 'test' ? 1 : 0;
      if(ta !== tb) return ta - tb;
      // Recommended rides carry their gold badge but sort in naturally with
      // everything else, so the badge stands out against plain neighbours
      // rather than forming a wall at the top of the list.
      if(s === 'starred'){
        var fa = isFav(a.key) ? 0 : 1, fb = isFav(b.key) ? 0 : 1;
        if(fa !== fb) return fa - fb;
        return b.tss - a.tss;
      }
      if(s === 'tss') return b.tss - a.tss;
      if(s === 'tss-asc') return a.tss - b.tss;
      if(s === 'dur') return b.durationMin - a.durationMin || b.tss - a.tss;
      if(s === 'dur-asc') return a.durationMin - b.durationMin || a.tss - b.tss;
      return a.name.localeCompare(b.name);
    });
    return out;
  }


  function totalMinutes(wo){
    return expandBlocks(wo.blocks).reduce(function(s, iv){ return s + iv.min; }, 0);
  }

  function segWatts(iv){
    if(iv.pct === null) return null;
    return watts(iv.pct);
  }

  // Power-graph scale: maps % FTP onto a bar-height range, Strava-style.
  var SCALE_MIN_PCT = 45;
  var SCALE_MAX_PCT = 122;
  var BAR_MIN_PX = 10;
  var BAR_MAX_PX = 78;

  // maxPx lets the same profile render small in a card and large in the
  // detail pane without duplicating the drawing logic.
  function barHeightPx(pct, maxPx, maxPct){
    var top = maxPx || BAR_MAX_PX;
    var ceil = maxPct || SCALE_MAX_PCT;
    var min = Math.max(4, Math.round(top * (BAR_MIN_PX / BAR_MAX_PX)));
    if(pct === null) return top;
    var frac = (pct - SCALE_MIN_PCT) / (ceil - SCALE_MIN_PCT);
    frac = Math.max(0, Math.min(1, frac));
    return Math.round(min + frac * (top - min));
  }

  function renderTimeline(wo, heightPx){
    var flat = expandBlocks(wo.blocks);
    var total = totalMinutes(wo);
    var box = heightPx ? Math.round(heightPx * 0.85) : BAR_MAX_PX;
    // Same rule as the live chart: this workout's hardest block sets the
    // ceiling, so a sweet-spot session fills the frame as well as a VO2 one.
    var peak = 0;
    flat.forEach(function(iv){
      if(iv.pct !== null) peak = Math.max(peak, iv.pct, iv.pctEnd || 0);
    });
    var ceil = Math.max(105, Math.ceil((peak + 8) / 5) * 5);
    var bars = flat.map(function(iv){
      var w = segWatts(iv);
      var tip, style = '';
      if(isRamp(iv)){
        var hA = barHeightPx(iv.pct, box, ceil), hB = barHeightPx(iv.pctEnd, box, ceil);
        // Not `box`: a var of that name here would hoist over the outer one
        // for the whole callback, and every bar would fall back to card size.
        var tall = Math.max(hA, hB);
        // Clip the taller box down to a trapezoid: the top edge slopes from
        // the start power to the end power.
        var topL = Math.round((1 - hA / tall) * 100);
        var topR = Math.round((1 - hB / tall) * 100);
        style = 'height:' + tall + 'px;-webkit-clip-path:polygon(0 ' + topL + '%,100% ' + topR + '%,100% 100%,0 100%);' +
                'clip-path:polygon(0 ' + topL + '%,100% ' + topR + '%,100% 100%,0 100%);';
        tip = iv.label + ' \u2014 ' + fmtMin(iv.min) + ' @ ' + iv.pct + '\u2192' + iv.pctEnd + '% (' +
              watts(iv.pct) + '\u2192' + watts(iv.pctEnd) + ' W)';
      } else {
        style = 'height:' + barHeightPx(iv.pct, box, ceil) + 'px;';
        tip = iv.label + ' \u2014 ' + fmtMin(iv.min) + (w !== null ? ' @ ' + iv.pct + '% (' + w + ' W)' : ' @ max sustainable effort');
      }
      var barClass = 'tl-seg' + (iv.type === 'test' ? ' zone-test' : '');
      // No `title`: the native tooltip takes about a second to appear and is
      // the reason hovering felt slow. The readout above the chart uses these
      // data attributes instead and updates on the same frame as the hover.
      var esc = function(v){ return String(v).replace(/"/g, ''); };
      return '<div class="' + barClass + '" data-ri="' + iv.ri + '"' +
        ' data-lab="' + esc(iv.label) + '"' +
        ' data-dur="' + esc(fmtMin(iv.min)) + '"' +
        ' data-w="' + esc(!hasFtp() ? '—'
                        : isRamp(iv) ? watts(iv.pct) + '→' + watts(iv.pctEnd) + ' W'
                        : (w === null ? 'max effort' : w + ' W')) + '"' +
        (iv.reps ? ' data-rep="' + iv.rep + ' of ' + iv.reps + '"' : '') +
        ' style="flex-grow:' + iv.min + ';' + style + '--seg:' + ZONES[iv.type].color + ';"></div>';
    }).join('');
    var html = '<div class="timeline-graph"' + (heightPx ? ' style="height:' + heightPx + 'px"' : '') + '>';
    html += '<div class="timeline-grid"><span style="top:25%"></span><span style="top:50%"></span><span style="top:75%"></span></div>';
    html += '<div class="timeline" data-total="' + total + '">' + bars + '</div>';
    html += '<div class="tl-scrub"><span class="tl-scrub-t"></span></div>';
    html += '<div class="timeline-axis"><span>0 min</span><span>' + total + ' min</span></div>';
    html += '</div>';
    return html;
  }

  // "30 s" rather than "0.5 min" for the short openers and micro-intervals.
  function fmtMin(min){
    var sec = Math.round(min * 60);
    if(sec < 60) return sec + ' s';
    if(sec % 60 === 0) return (sec / 60) + ' min';
    return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60) + ' min';
  }

  function intervalRow(zone, label, min, pct, pctEnd, cls, ri){
    var w = pct === null ? null : watts(pct);
    var ramping = pctEnd !== null && pctEnd !== undefined && pct !== null && pctEnd !== pct;
    // `pct === null` means an all-out effort; `w === null` with a pct means we
    // simply don't know the rider's FTP yet. They read differently.
    var pctCell = pct === null ? 'All-out' : (ramping ? pct + '\u2192' + pctEnd + '%' : pct + '%');
    var wattCell;
    if(pct === null){
      wattCell = hasFtp() ? ('\u2248 ' + watts(105) + '+ W target') : '\u2014';
    } else if(!hasFtp()){
      wattCell = '\u2014';
    } else {
      wattCell = ramping ? w + '\u2192' + watts(pctEnd) + ' W' : w + ' W';
    }
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + (ri != null ? ' data-ri="' + ri + '"' : '') + '>' +
      '<td><span class="zone-swatch" style="background:' + ZONES[zone].color + '"></span>' + label + '</td>' +
      '<td>' + fmtMin(min) + '</td>' +
      '<td class="pct-cell">' + pctCell + '</td>' +
      '<td class="watt-cell">' + wattCell + '</td>' +
    '</tr>';
  }

  // The "main set" is the repeat group; in a workout with no repeats it's
  // the single blocks in the primary zone that aren't warm-up primers.
  function renderIntervalTable(wo){
    var rows = '', ri = 0;   // must advance exactly as expandBlocks does
    // Warm-up primers are repeats too, but flagged prep \u2014 they don't count.
    var hasRepeat = wo.blocks.some(function(b){ return b.kind === 'repeat' && !b.prep; });
    wo.blocks.forEach(function(b){
      if(b.kind === 'single'){
        var isMain = !hasRepeat && !b.prep && b.zone === wo.zone && b.pct !== null;
        rows += intervalRow(b.zone, b.label, b.min, b.pct, b.pctEnd, isMain ? 'set-row set-first set-last' : '', ri);
        ri += 1;
        return;
      }
      var main = !b.prep;
      rows += intervalRow(b.work.zone, b.work.label, b.work.min, b.work.pct, b.work.pctEnd, main ? 'set-row set-first' : '', ri);
      if(b.rest){
        rows += intervalRow(b.rest.zone, b.rest.label, b.rest.min, b.rest.pct, b.rest.pctEnd, main ? 'set-row' : '', ri + 1);
      }
      rows += '<tr class="group-note-row' + (main ? ' set-row set-last' : '') + '"><td colspan="4"><span class="group-note">\u00d7 ' + b.reps + ' sets</span></td></tr>';
      ri += b.rest ? 3 : 2;
    });
    var z = ZONES[wo.zone] || ZONES.endurance;
    return '<table class="interval-table" style="--seg:' + z.color + '"><thead><tr><th>Segment</th><th>Duration</th><th>% FTP</th><th>Target</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // What the plan asks for at the current FTP: time-weighted mean target
  // (ramps averaged) and NP from the stored IF. Estimates of the plan, not
  // predictions of the ride.
  function planPower(wo){
    var flat = expandBlocks(wo.blocks);
    var sum = 0, mins = 0;
    flat.forEach(function(s){
      if(s.pct === null) return;
      var p = (s.pctEnd !== undefined && s.pctEnd !== null) ? (s.pct + s.pctEnd) / 2 : s.pct;
      sum += p * s.min; mins += s.min;
    });
    if(!hasFtp()) return {avg: null, np: null};
    return {avg: mins ? watts(sum / mins) : null, np: Math.round(wo.if * ftp)};
  }

  function planStat(label, value, unit){
    return '<div class="cell"><span class="k">' + label + '</span><span class="v">' + value + (unit ? '<i>' + unit + '</i>' : '') + '</span></div>';
  }

  // Card thumbnail: the workout's power profile as a filled silhouette,
  // coloured by its focus zone. Computed from the blocks rather than stored,
  // because it's two SVG elements per card and the maths is trivial — no
  // reason to inflate the library with precomputed points.
  var THUMB_W = 74, THUMB_H = 38;
  function thumbSvg(wo){
    var flat = expandBlocks(wo.blocks);
    var total = flat.reduce(function(s, x){ return s + x.min; }, 0);
    if(!total) return '';
    var z = ZONES[wo.zone] || ZONES.endurance;

    // Share the ceiling with the big graph, but lift it if this workout goes
    // above it, so an anaerobic session isn't clipped flat.
    var peak = 0;
    flat.forEach(function(s){
      if(s.pct !== null) peak = Math.max(peak, s.pct, s.pctEnd || 0);
    });
    var top = Math.max(SCALE_MAX_PCT, Math.ceil(peak / 5) * 5);

    var base = THUMB_H - 1;
    function y(pct){
      var f = (((pct === null ? top : pct) - SCALE_MIN_PCT) / (top - SCALE_MIN_PCT));
      f = Math.max(0, Math.min(1, f));
      return +(base - f * (base - 2)).toFixed(1);
    }

    var pts = [], cum = 0;
    flat.forEach(function(s){
      var x0 = +((cum / total) * THUMB_W).toFixed(1);
      cum += s.min;
      var x1 = +((cum / total) * THUMB_W).toFixed(1);
      var ramping = s.pctEnd !== undefined && s.pctEnd !== null && s.pctEnd !== s.pct;
      pts.push(x0 + ',' + y(s.pct));
      pts.push(x1 + ',' + y(ramping ? s.pctEnd : s.pct));
    });

    var line = pts.join(' ');
    var area = '0,' + base + ' ' + line + ' ' + THUMB_W + ',' + base;
    return '<svg viewBox="0 0 ' + THUMB_W + ' ' + THUMB_H + '" aria-hidden="true">' +
      '<polygon points="' + area + '" style="fill:' + z.color + '" fill-opacity="0.34"/>' +
      '<polyline points="' + line + '" fill="none" style="stroke:' + z.color +
        '" stroke-width="1.3" stroke-linejoin="round" stroke-opacity="0.95"/>' +
    '</svg>';
  }

  // The gold "Recommended" pill. Empty string for anything not on the list,
  // so callers can concatenate it blind.
  var REC_STAR = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0C5.4 3 7 4.6 10 5C7 5.4 5.4 7 5 10C4.6 7 3 5.4 0 5C3 4.6 4.6 3 5 0Z"/></svg>';
  function recPill(wo){
    if(!showRec || !wo.recommended) return '';
    return '<span class="rec" title="Recommended">Recommended' +
      '<i class="tw a">' + REC_STAR + '</i><i class="tw b">' + REC_STAR + '</i><i class="tw c">' + REC_STAR + '</i></span>';
  }

  function renderWorkoutCard(wo, idx){
    var z = ZONES[wo.zone] || ZONES.endurance;

    // Desktop: the typographic index row. Mobile keeps the card below.
    if(!mqMobile.matches) return renderIndexRow(wo, idx || 0, z);

    var card = document.createElement('div');
    // `doneByKey` is filled from the ride log once it has been read.
    card.className = 'workout-card' + (selectedKey === wo.key ? ' selected' : '') +
      ((typeof doneByKey !== 'undefined' && doneByKey && doneByKey[wo.key]) ? ' done' : '');
    card.id = 'workout-' + wo.key;
    card.setAttribute('data-card', wo.key);

    card.innerHTML =
      // Left: thumbnail centred over its (small) zone tag or TEST marker.
      '<div class="card-kind">' +
        '<div class="card-thumb">' + thumbSvg(wo) + '</div>' +
        (wo.test
          ? '<span class="test-tag">TEST</span>'
          : '<span class="zone-tag" style="--zc:' + z.color + '">' + z.label + '</span>') +
      '</div>' +
      // Middle: name, then structure (in watts), then a TSS + spice meta row.
      '<div class="wc-body">' +
        '<h3 class="wc-name">' + wo.name + recPill(wo) + '</h3>' +
        '<span class="wc-struct">' + shortLabel(wo) + '</span>' +
        (wo.test ? '' :
          '<div class="wc-meta">' +
            '<span class="tss-tag">TSS ' + wo.tss + '</span>' +
            chillies(wo.spice) +
          '</div>') +
      '</div>' +
      // Right: duration + favourite, aligned to the title row.
      '<div class="wc-side">' +
        '<span class="card-dur">' + wo.durationMin + ' min</span>' +
        '<button class="star-btn' + (isFav(wo.key) ? ' on' : '') + '" data-star="' + wo.key + '" ' +
          'title="' + (isFav(wo.key) ? 'Remove from favourites' : 'Add to favourites') + '" ' +
          'aria-label="Toggle favourite">' + starSvg() + '</button>' +
      '</div>';

    card.addEventListener('click', function(e){
      selectWorkout(wo.key);
      // A real tap on a card opens the detail (mobile slide-over); tapping the
      // star just favourites without pushing the panel over the list.
      if(!e.target.closest('.star-btn')) openDetailMobile();
    });
    return card;
  }

  // Desktop index row: number · name · structure · monotone shape · zone/meta.
  // A row click toggles the inline expand (openDesktopExpand); the shape thumb
  // is drawn by thumbSvg and recoloured to ink by CSS.
  function renderIndexRow(wo, idx, z){
    var row = document.createElement('div');
    row.className = 'wk-row' + (selectedKey === wo.key ? ' sel' : '');
    row.id = 'workout-' + wo.key;
    row.setAttribute('data-card', wo.key);
    row.innerHTML =
      '<span class="wk-name">' + wo.name + recPill(wo) + '</span>' +
      '<span class="wk-thumbwrap">' +
        '<span class="wk-thumb">' + thumbSvg(wo) + '</span>' +
        '<span class="wk-struct">' + shortLabel(wo) + '</span>' +
      '</span>' +
      '<span class="wk-meta"><span class="wk-zone"><i style="background:' + z.color + '"></i>' +
        (wo.test ? 'Test' : z.label) + '</span>' +
        '<span class="wk-big">' + wo.durationMin + ' min</span>' + (wo.test ? '' : ' · TSS ' + wo.tss) +
      '</span>';
    row.addEventListener('click', function(e){
      if(e.target.closest('a,button')) return;   // let the expand's own controls act
      if(selectedKey === wo.key && row.classList.contains('sel')){ selectedKey = null; openDesktopExpand(null); }
      else selectWorkout(wo.key);
    });
    return row;
  }

  // The inline expand's content — the same pieces as the detail pane, minus the
  // name (the row already shows it). Reuses the real builders so it can't drift.
  // Factual one-liners describing what each focus zone trains — used as the
  // opened card's lead line when a workout carries no prose of its own.
  var ZONE_BLURB = {
    recovery:  'Easy recovery spin — keep it genuinely light and let the legs clear.',
    endurance: 'Aerobic base — steady, conversational riding that builds the engine.',
    tempo:     'Sustained tempo — aerobic strength held at a hard-but-steady pace.',
    sweetspot: 'Sweet spot — the most fitness per minute, sitting just under threshold.',
    threshold: 'Threshold work — hold the effort and lift the ceiling you can sustain.',
    vo2:       'VO2 max — short, sharp efforts at the ceiling of your aerobic power.',
    anaerobic: 'Anaerobic — all-out neuromuscular bursts with full recoveries.',
    test:      'A fitness test to measure your FTP — pace it evenly and push.'
  };
  function desktopExpandInner(wo){
    var z = ZONES[wo.zone] || ZONES.endurance, pp = planPower(wo);
    var stats = wo.test
      ? '<div class="plan-stats">' + planStat('Duration', wo.durationMin, 'min') + '</div>' +
        '<p class="plan-note">' + (wo.test === 'ramp' ? 'FTP = 75% of your best 1-minute power.' : 'FTP = 95% of your 20-minute average.') + '</p>'
      : '<div class="plan-stats">' +
          planStat('Duration', wo.durationMin, 'min') +
          planStat('Time in zone', wo.workMin, 'min') +
          planStat('TSS', wo.tss) +
          planStat('Est. avg power', pp.avg !== null ? pp.avg : '—', pp.avg !== null ? 'W' : '') +
          planStat('Normalised', pp.np !== null ? pp.np : '—', pp.np !== null ? 'W' : '') +
        '</div>';
    // Editorial voice: the curator's note if there is one, else a factual line
    // about what this focus zone trains (the library carries no per-workout prose).
    var cueText = wo.purpose || (showRec && typeof wo.recommended === 'string' ? wo.recommended : '') || ZONE_BLURB[wo.zone] || '';
    var cue = cueText ? '<p class="wk-exp-cue">' + cueText + '</p>' : '';
    // Profile-forward: the chart is the hero (full width), with the spice on the
    // Profile line and the stats as a bordered grid beneath — the same grid
    // language as the live ride screen. The name + structure + zone·TSS already
    // sit in the selected row above, so they're not repeated here.
    var spice = wo.test ? '' : '<span class="wk-exp-spice">' + chillies(wo.spice) + '</span>';
    return '<div class="wk-exp-in">' +
      cue +
      // Structure label above the chart (replaces the generic "Profile" eyebrow),
      // with the spice rating below it.
      '<div class="wk-exp-phrow"><span class="wk-exp-struct">' + shortLabel(wo) + '</span>' + spice + '</div>' +
      '<div class="detail-graph">' + renderTimeline(wo, 230) + '</div>' +
      '<p class="wk-exp-hint">Hover for each block’s target.</p>' +
      stats +
      '<div class="wk-exp-act">' +
        '<button class="action-btn start-btn" data-live="' + wo.key + '">▶ Start Workout</button>' +
        '<button class="star-btn' + (isFav(wo.key) ? ' on' : '') + '" data-star="' + wo.key + '" aria-label="Toggle favourite">' + starSvg() + '</button>' +
      '</div>' +
    '</div>';
  }

  // Place (or clear) the inline expand under the selected row. Desktop only.
  function openDesktopExpand(key, opts){
    var host = els.workoutCards;
    var old = host.querySelector('.wk-exp'); if(old) old.parentNode.removeChild(old);
    Array.prototype.forEach.call(host.querySelectorAll('.wk-row'), function(r){
      r.classList.toggle('sel', r.getAttribute('data-card') === key);
    });
    if(!key) return;
    var wo = byKey(key); if(!wo) return;
    var row = document.getElementById('workout-' + key); if(!row) return;
    var exp = document.createElement('div');
    exp.className = 'wk-exp';
    exp.innerHTML = desktopExpandInner(wo);
    row.insertAdjacentElement('afterend', exp);
    wireWorkoutButtons(exp);
    if(opts && opts.scrollIntoView && row.scrollIntoView) row.scrollIntoView({block:'nearest'});
  }

  function byKey(k){
    return WORKOUTS.filter(function(w){ return w.key === k; })[0];
  }

  // ---- detail pane ----
  function selectWorkout(key, opts){
    selectedKey = key;
    // Desktop: open the inline expand in the index (no separate detail pane).
    if(!mqMobile.matches){ openDesktopExpand(key, opts); updateViewNav(); return; }
    Array.prototype.forEach.call(els.workoutCards.querySelectorAll('.workout-card'), function(c){
      c.classList.toggle('selected', c.getAttribute('data-card') === key);
    });
    renderDetail();
    if(opts && opts.scrollIntoView){
      var el = document.getElementById('workout-' + key);
      if(el) el.scrollIntoView({block:'nearest'});
    }
  }

  // ---- mobile: detail as a slide-over, filters as a collapsible sheet ----
  // On a phone the three desktop columns can't coexist. The detail rides in
  // over the list only on an explicit card tap (never on the default/guided
  // selection, which would re-bury the list on load), and the filter sliders
  // collapse behind a toggle so the list sits right under the devices.
  var mqMobile = window.matchMedia('(max-width:900px)');
  // On mobile the desktop columns become bottom tabs (Workouts / View / Menu),
  // one pane at a time via #appShell[data-tab]. Tapping a card jumps to View;
  // the detail back-arrow (and Esc) returns to Workouts. Training and Filters
  // are animated bottom sheets that pop up over the tabs instead of being panes.
  var MOBILE_TABS = {workouts:1, view:1};
  function markActiveTab(name){
    if(!els.mTabs) return;
    Array.prototype.forEach.call(els.mTabs.querySelectorAll('.mtab'), function(b){
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  // The pill highlights whatever the rider is looking at: an open Training or
  // Menu sheet, else the current pane (Workouts / View). A Filters sheet leaves
  // the underlying pane highlighted.
  function syncMTabHighlight(){
    var open = document.querySelector('.sheet.open');
    var name = open === els.trainingSheet ? 'training'
             : open === els.menuSheet ? 'menu'
             : (els.appShell.getAttribute('data-tab') || 'workouts');
    markActiveTab(name);
  }
  function setMobileTab(name){
    if(!MOBILE_TABS[name]) name = 'workouts';
    els.appShell.setAttribute('data-tab', name);
    markActiveTab(name);
  }
  function openDetailMobile(){ if(mqMobile.matches) setMobileTab('view'); }
  function closeDetailMobile(){ if(mqMobile.matches) setMobileTab('workouts'); }
  if(els.detailBack) els.detailBack.addEventListener('click', closeDetailMobile);

  // Mobile View-tab action pills: flick prev/next through the visible list
  // (staying on the detail) and start the current workout. Reuses the same
  // visibleKeys/selectWorkout path as the desktop arrow keys.
  function viewNavGo(dir){
    if(!visibleKeys.length) return;
    var i = visibleKeys.indexOf(selectedKey);
    i = i < 0 ? 0 : Math.max(0, Math.min(visibleKeys.length - 1, i + dir));
    selectWorkout(visibleKeys[i], {scrollIntoView:true});
  }
  function updateViewNav(){
    if(!els.viewPrev) return;
    var i = visibleKeys.indexOf(selectedKey);
    els.viewPrev.disabled = i <= 0;
    els.viewNext.disabled = i < 0 || i >= visibleKeys.length - 1;
    if(els.viewStart) els.viewStart.disabled = !selectedKey;
  }
  if(els.viewPrev) els.viewPrev.addEventListener('click', function(){ viewNavGo(-1); });
  if(els.viewNext) els.viewNext.addEventListener('click', function(){ viewNavGo(1); });
  if(els.viewStart) els.viewStart.addEventListener('click', function(){
    if(selectedKey && typeof startWorkout === 'function') startWorkout(selectedKey);
  });

  // ---- bottom sheets (Filters, Training) ----
  function openSheet(sheet){ if(!sheet) return; sheet.hidden = false; void sheet.offsetHeight; sheet.classList.add('open'); syncMTabHighlight(); }
  function closeSheet(sheet){
    if(!sheet || !sheet.classList.contains('open')) return;
    sheet.classList.remove('open');
    var done = function(){ sheet.hidden = true; sheet.removeEventListener('transitionend', done); clearTimeout(t); };
    var t = setTimeout(done, 360);
    sheet.addEventListener('transitionend', done);
    syncMTabHighlight();   // highlight reverts to the underlying pane as it closes
  }
  [els.filterSheet, els.trainingSheet, els.menuSheet].forEach(function(sheet){
    if(sheet) sheet.addEventListener('click', function(e){ if(e.target.closest('[data-close]')) closeSheet(sheet); });
  });

  // Training and Menu are sheet-launchers, not panes. The tab bar stays live
  // while a sheet is open: tapping another tab closes it and switches (or opens
  // that tab's sheet); tapping the same sheet-tab again closes it (toggle).
  var TAB_SHEETS = {training: els.trainingSheet, menu: els.menuSheet};
  if(els.mTabs) els.mTabs.addEventListener('click', function(e){
    var b = e.target.closest('.mtab'); if(!b) return;
    var t = b.getAttribute('data-tab');
    var open = document.querySelector('.sheet.open');
    var target = TAB_SHEETS[t] || null;
    if(open) closeSheet(open);
    if(target){ if(target !== open) openSheet(target); return; }
    setMobileTab(t);
  });
  if(els.filtersFab) els.filtersFab.addEventListener('click', function(){ openSheet(els.filterSheet); });

  // The header connection indicator is a shortcut into the Menu: the menu sheet
  // on mobile, the hamburger dropdown (via its button) on desktop.
  if(els.connStatus) els.connStatus.addEventListener('click', function(e){
    e.stopPropagation();
    if(mqMobile.matches){
      var open = document.querySelector('.sheet.open');
      if(open) closeSheet(open);
      if(!open || open !== els.menuSheet) openSheet(els.menuSheet);
    } else if(els.menuBtn){
      els.menuBtn.click();
    }
  });

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var open = document.querySelector('.sheet.open');
    if(open){ closeSheet(open); return; }
    if(mqMobile.matches && els.appShell.getAttribute('data-tab') === 'view') setMobileTab('workouts');
  });

  // Training sheet buttons open the existing Calendar / Charts modals.
  var hubCal = document.getElementById('hubCalendarBtn'), hubCharts = document.getElementById('hubChartsBtn');
  if(hubCal && els.logBtn) hubCal.addEventListener('click', function(){ closeSheet(els.trainingSheet); els.logBtn.click(); });
  if(hubCharts && els.trendsBtn) hubCharts.addEventListener('click', function(){ closeSheet(els.trainingSheet); els.trendsBtn.click(); });

  // The Filters button shows a badge with how many sliders are off "Any".
  function activeFilterCount(){
    var n = 0;
    if(filters.duration !== null) n++;
    if(filters.zone !== null) n++;
    if(filters.shape !== null) n++;
    if(filters.spice !== null) n++;
    return n;
  }
  function updateFiltersFab(){
    if(!els.filtersFabBadge) return;
    var n = activeFilterCount();
    els.filtersFabBadge.hidden = n === 0;
    els.filtersFabBadge.textContent = n ? String(n) : '';
    if(els.filtersFab) els.filtersFab.classList.toggle('active', n > 0);
  }
  setMobileTab(els.appShell.getAttribute('data-tab') || 'workouts');

  // The filter controls live in the sidebar on desktop; on mobile they relocate
  // into the Filters bottom sheet. appendChild moves the built sliders (with
  // their handlers and state) rather than cloning, so nothing is rebuilt.
  var sideScroll = document.querySelector('.side-scroll');
  var filterIds = ['gTime','gZone','gSpice','gShape','resetFilters'];
  function syncFilterLocation(){
    var host = mqMobile.matches ? els.filterSheetBody : sideScroll;
    if(!host) return;
    filterIds.forEach(function(id){
      var el = document.getElementById(id);
      if(el && el.parentNode !== host) host.appendChild(el);
    });
  }
  syncFilterLocation();

  // Same relocation for the Menu: the whole #sideMenu block (Your numbers /
  // Devices / About) moves into the Menu sheet on mobile, and back to its
  // sidebar home on desktop.
  var sideMenuEl = els.sideMenu;
  var sideMenuHome = sideMenuEl ? {p: sideMenuEl.parentNode, n: sideMenuEl.nextElementSibling} : null;
  function syncMenuLocation(){
    if(!els.menuSheetBody || !sideMenuEl) return;
    if(mqMobile.matches){
      if(sideMenuEl.parentNode !== els.menuSheetBody) els.menuSheetBody.appendChild(sideMenuEl);
    } else {
      // Desktop: the sidebar is retired on the Workouts page, so the menu
      // dropdown lives on <body> (it's position:fixed anyway) rather than inside
      // the hidden sidebar, which would hide it too.
      if(sideMenuEl.parentNode !== document.body) document.body.appendChild(sideMenuEl);
    }
  }
  void sideMenuHome;   // retained for reference; desktop home is now <body>
  syncMenuLocation();

  // The connection indicator lives in the sidebar head on desktop/tablet only;
  // on mobile the sidebar is hidden, so it simply doesn't show — mobile reads
  // device state from the Menu's Connections section + the Menu-tab red dot.

  // Returning to a wide viewport puts the filters back in the sidebar and drops
  // any open sheet, so desktop is clean.
  var mqHandler = function(e){
    if(!e.matches){ closeDetailMobile(); var s = document.querySelector('.sheet.open'); if(s) closeSheet(s); }
    syncFilterLocation();
    syncMenuLocation();
    // The card list and the index are different markup, so rebuild for the
    // viewport we've crossed into.
    if(typeof renderWorkoutCards === 'function') renderWorkoutCards();
  };
  if(mqMobile.addEventListener) mqMobile.addEventListener('change', mqHandler);
  else if(mqMobile.addListener) mqMobile.addListener(mqHandler);

  if(els.filtersToggle) els.filtersToggle.addEventListener('click', function(){
    var open = els.listFilters.classList.toggle('filters-open');
    els.filtersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // ---- timeline scrubbing ----
  // Moving across the chart drags a hairline with the elapsed time above it,
  // fills the readout from the block under the cursor, and lights that block's
  // row in the table. The blocks are never restyled — the line does the work.
  // Delegated from the pane so it survives every re-render.
  var segFocusRi = false;
  // Fills the line above the chart from a hovered block's data attributes.
  // `bar` is null when nothing is hovered, which restores the idle summary.
  // Builds the pill: the timestamp, then the segment under the cursor.
  function pillHtml(timeText, bar){
    var html = '<span class="tl-sc-time">' + timeText + '</span>';
    if(!bar) return html;
    var d = bar.dataset;
    // The expanded label already ends in the rep number ("Sustained 2"), which
    // the rep counter then repeats — drop it there.
    var name = d.rep ? d.lab.replace(/\s+\d+$/, '') : d.lab;
    return html +
      '<span class="tl-sc-name">' + name + '</span>' +
      '<span class="tl-sc-meta"><b>' + d.dur + '</b> &nbsp;·&nbsp; <b>' + d.w + '</b></span>' +
      (d.rep ? '<span class="tl-sc-rep">rep ' + d.rep + '</span>' : '');
  }
  function setSegFocus(graph, ri){
    if(ri === segFocusRi) return;
    segFocusRi = ri;
    // Highlight the matching row only if a table shares the chart's container
    // (the mobile detail pane). The desktop expand has no table — pill only.
    var container = (graph && (graph.closest('.wk-exp') || graph.closest('.detail-body'))) || els.detailBody;
    var tbody = container && container.querySelector('.interval-table tbody');
    if(tbody){
      [].forEach.call(tbody.children, function(tr){
        tr.classList.toggle('tr-hot', ri !== null && tr.getAttribute('data-ri') === ri);
      });
    }
  }

  function fmtClock(min){
    var s = Math.max(0, Math.round(min * 60));
    var m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  // One rAF-throttled update per frame: mousemove can fire far faster than the
  // screen refreshes, and every update reads layout.
  var scrubPending = null, scrubRaf = 0, scrubGraph = null;
  function scrubTo(graph, clientX){
    var tl = graph.querySelector('.timeline');
    var line = graph.querySelector('.tl-scrub');
    if(!tl || !line) return;
    var gr = graph.getBoundingClientRect(), tr = tl.getBoundingClientRect();
    var x = Math.max(tr.left, Math.min(tr.right, clientX));

    graph.classList.add('scrubbing');
    var lineX = x - gr.left;
    line.style.left = lineX + 'px';
    var total = parseFloat(tl.getAttribute('data-total')) || 0;

    // Which block sits under the cursor. Bars are separated by a 1px gap, so
    // fall back to the nearest by centre rather than dropping the readout.
    var bars = tl.querySelectorAll('.tl-seg'), hit = null, best = Infinity;
    for(var i = 0; i < bars.length; i++){
      var br = bars[i].getBoundingClientRect();
      if(x >= br.left && x <= br.right){ hit = bars[i]; break; }
      var d = Math.abs(x - (br.left + br.width / 2));
      if(d < best){ best = d; hit = bars[i]; }
    }

    var t = line.querySelector('.tl-scrub-t');
    if(t){
      t.innerHTML = pillHtml(fmtClock(total * (x - tr.left) / (tr.width || 1)), hit);
      // The pill is centred on a 1px line, so near either end it would hang off
      // the chart. Nudge it back by the overflow, measured after the content is in.
      t.style.left = '';
      var pw = t.offsetWidth, half = pw / 2, pad = 6;
      var want = Math.max(half + pad, Math.min(gr.width - half - pad, lineX));
      t.style.left = (want - lineX) + 'px';
    }
    setSegFocus(graph, hit ? hit.getAttribute('data-ri') : null);
  }
  function scrubEnd(graph){
    if(!graph) return;
    graph.classList.remove('scrubbing');
    setSegFocus(graph, null);
  }
  // Delegated on the document so the scrubber works both in the desktop inline
  // expand and the mobile detail pane. It only acts over a chart.
  document.addEventListener('mousemove', function(e){
    var graph = e.target.closest && e.target.closest('.timeline-graph');
    if(!graph){ if(scrubGraph){ scrubEnd(scrubGraph); scrubGraph = null; } return; }
    scrubGraph = graph; scrubPending = e.clientX;
    if(scrubRaf) return;
    scrubRaf = requestAnimationFrame(function(){
      scrubRaf = 0;
      if(scrubPending !== null && scrubGraph) scrubTo(scrubGraph, scrubPending);
    });
  });

  function renderDetail(){
    segFocusRi = false;   // the DOM below is about to be replaced
    var wo = selectedKey ? byKey(selectedKey) : null;
    updateViewNav();      // keep the mobile prev/next/start pills in sync
    if(!wo){
      els.detailHead.innerHTML = '<span class="pane-label">Workout</span>';
      els.detailBody.innerHTML = '<p class="detail-empty">Pick a workout from the list.</p>';
      return;
    }
    var z = ZONES[wo.zone] || ZONES.endurance;

    // Header is the action bar, left-aligned with the body's content edge;
    // the title itself leads the body.
    els.detailHead.innerHTML =
      '<button class="action-btn start-btn" data-live="' + wo.key + '">\u25b6 Start Workout</button>';

    var pp = planPower(wo);
    els.detailBody.innerHTML =
      '<div class="detail-title">' +
        '<button class="star-btn' + (isFav(wo.key) ? ' on' : '') + '" data-star="' + wo.key + '" ' +
          'aria-label="Toggle favourite">' + starSvg() + '</button>' +
        '<h1>' + wo.name + '</h1>' + recPill(wo) +
      '</div>' +
      '<div class="detail-line">' +
        '<span class="structure-chip' + (wo.test ? ' is-test' : '') + '" style="--seg:' + z.color + '">' + shortLabel(wo) + '</span>' +
        (wo.test ? '' : chillies(wo.spice)) +
      '</div>' +
      // The pill says *that*; this says *why*, in the curator's words.
      (showRec && typeof wo.recommended === 'string' ? '<p class="rec-why">' + wo.recommended + '</p>' : '') +
      (wo.test
        ? '<div class="plan-stats">' + planStat('Duration', wo.durationMin, 'min') + '</div>' +
          '<p class="plan-note">' + (wo.test === 'ramp' ? 'FTP = 75% of your best 1-minute power.' : 'FTP = 95% of your 20-minute average.') + '</p>'
        : '<div class="plan-stats">' +
            planStat('Duration', wo.durationMin, 'min') +
            planStat('Time in zone', wo.workMin, 'min') +
            planStat('TSS', wo.tss) +
            planStat('Est. avg power', pp.avg !== null ? pp.avg : '\u2014', pp.avg !== null ? 'W' : '') +
            planStat('Normalised', pp.np !== null ? pp.np : '\u2014', pp.np !== null ? 'W' : '') +
          '</div>') +
      (wo.purpose ? '<p class="purpose">' + wo.purpose + '</p>' : '') +
      '<div class="detail-graph">' + renderTimeline(wo, 230) + '</div>' +
      renderIntervalTable(wo);

    wireWorkoutButtons(els.detailHead);
    wireWorkoutButtons(els.detailBody);
  }

  // Star / start / export behave the same wherever they appear.
  function wireWorkoutButtons(root){
    Array.prototype.forEach.call(root.querySelectorAll('[data-star]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var k = this.getAttribute('data-star');
        toggleFav(k);
        updateStarFilterUI();
        // Repaint stars in place rather than rebuilding the list, which would
        // lose the scroll position mid-browse.
        Array.prototype.forEach.call(document.querySelectorAll('[data-star="' + k + '"]'), function(b){
          if(b.classList.contains('star-btn')){
            b.classList.toggle('on', isFav(k));
            b.title = isFav(k) ? 'Remove from favourites' : 'Add to favourites';
          } else {
            b.textContent = isFav(k) ? '\u2605 Starred' : '\u2606 Star';
          }
        });
        if(filters.starredOnly || filters.sort === 'starred') renderWorkoutCards();
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-live]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        startWorkout(this.getAttribute('data-live'));
      });
    });
  }

  // The empty state names the combination that came up empty and offers one
  // button per filter whose removal would actually bring workouts back — so
  // "Micro, then 120 min" is as clear a dead end as "120 min, then Micro",
  // where the tile is already greyed out. Nothing is cleared for the rider;
  // they choose which pick to let go.
  var EMPTY_CLEARS = [
    ['shape',       'Clear shape'],
    ['zone',        'Clear zone'],
    ['duration',    'Clear time'],
    ['spice',       'Clear spice'],
    ['search',      'Clear search'],
    ['starredOnly', 'Show all, not just starred']
  ];
  function clearOneFilter(key){
    if(key === 'search'){
      filters.search = ''; els.searchBox.value = '';
      els.listActions.classList.remove('searching');
    } else if(key === 'starredOnly'){
      filters.starredOnly = false; updateStarFilterUI();
    } else {
      filters[key] = null;
    }
    render();
  }
  function paintEmptyState(){
    var f = filters, adj = [], tail = [];
    if(f.shape !== null) adj.push(shapeLabel(f.shape));
    if(f.zone !== null && ZONES[f.zone]) adj.push(ZONES[f.zone].label);
    if(f.duration !== null) tail.push('at ' + f.duration + ' min');
    if(f.spice !== null) tail.push((SPICE_LABEL[f.spice] || f.spice).toLowerCase() + ' intensity');
    var q = f.search.trim();
    if(q) tail.push('matching “' + q + '”');
    var sentence = 'No ' + (f.starredOnly ? 'starred ' : '') + (adj.length ? adj.join(' ') + ' ' : '') + 'workouts' +
                   (tail.length ? ' ' + tail.join(', ') : '') + '.';

    // Offer only the clears that work on their own.
    var offers = EMPTY_CLEARS.filter(function(c){
      var k = c[0];
      var set = k === 'search' ? !!q : k === 'starredOnly' ? f.starredOnly : f[k] !== null;
      if(!set) return false;
      var probe = probeFilters(k, k === 'search' ? '' : k === 'starredOnly' ? false : null);
      return anyMatch(probe);
    });
    var btns = offers.length
      ? offers.map(function(c){ return '<button type="button" class="nr-btn" data-clear="' + c[0] + '">' + c[1] + '</button>'; }).join('')
      : '<button type="button" class="nr-btn" data-clear="all">Reset filters</button>';
    els.noResults.innerHTML = '<b>' + sentence + '</b>' +
      (offers.length ? '' : ' No single filter is the cause.') +
      '<div class="nr-btns">' + btns + '</div>';
    [].forEach.call(els.noResults.querySelectorAll('[data-clear]'), function(b){
      b.addEventListener('click', function(){
        var k = b.getAttribute('data-clear');
        if(k === 'all') clearAllFilters(); else clearOneFilter(k);
      });
    });
  }

  function renderWorkoutCards(){
    var list = filteredWorkouts();
    updateFiltersFab();
    visibleKeys = list.map(function(w){ return w.key; });
    els.workoutCards.innerHTML = '';
    els.noResults.style.display = list.length ? 'none' : 'block';
    if(!list.length) paintEmptyState();
    els.resultCount.textContent = 'Quick Pick';   // the slot is the Quick Pick button now

    // Desktop renders the typographic index (wk-idx); mobile the card list.
    var desktop = !mqMobile.matches;
    els.workoutCards.classList.toggle('wk-idx', desktop);
    list.forEach(function(wo, i){
      els.workoutCards.appendChild(renderWorkoutCard(wo, i));
    });
    wireWorkoutButtons(els.workoutCards);
    updateListZero();   // blur-and-prompt when nothing's been searched yet

    // In the fresh zero-state (nothing searched yet) the list is blurred behind
    // the Quick Pick prompt, so nothing is opened. Once the rider engages (Quick
    // Pick or browse all): on mobile the detail pane falls back to the first
    // result; on desktop the index keeps whatever row was open but never auto-
    // opens one (the index reads as a table of contents, all closed).
    if(list.length && isZeroQuery() && !browseAll){
      selectedKey = null;
      if(desktop) openDesktopExpand(null); else renderDetail();
    } else if(list.length){
      if(desktop){
        if(visibleKeys.indexOf(selectedKey) >= 0) openDesktopExpand(selectedKey);
        else { selectedKey = null; openDesktopExpand(null); }
      } else if(visibleKeys.indexOf(selectedKey) < 0){
        selectWorkout(list[0].key);
      } else {
        renderDetail();
      }
    } else {
      selectedKey = null;
      if(desktop) openDesktopExpand(null); else renderDetail();
    }
  }
