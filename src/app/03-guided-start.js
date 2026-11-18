  // ============================================================
  // FIND A WORKOUT
  // The workout list opens on a blurred zero-state ("Find a workout") that
  // opens the quick-pick modal; openFindModal / the zero-state live in the
  // filtering module. The old leading start-card + guided walkthrough are gone.
  // ============================================================

  function clearAllFilters(){
    filters.duration = null; filters.zone = null; filters.shape = null; filters.spice = null;
    filters.search = ''; filters.starredOnly = false;   // sort is a preference; it survives a reset
    els.searchBox.value = '';
    els.sortMenu.style.display = 'none';
    browseAll = false;   // Reset returns to the guided zero-state
    renderSortMenu();
    updateStarFilterUI();
    render();   // recommendations on/off is a preference, not a filter — it stays
  }
  els.resetFilters.addEventListener('click', clearAllFilters);


  // The reference table shows the standard Coggan seven, which is what Strava
  // reports against. The library's own categories differ in two deliberate
  // ways (Sweet Spot as a focus, Z6+Z7 merged as Anaerobic); the table notes
  // Sweet Spot as a band rather than pretending it's a zone.
  var ZONE_BANDS = [
    {key:'recovery',  z:'Z1', label:'Active recovery', lo:0,   hi:55},
    {key:'endurance', z:'Z2', label:'Endurance',       lo:56,  hi:75},
    {key:'tempo',     z:'Z3', label:'Tempo',           lo:76,  hi:90},
    {key:'threshold', z:'Z4', label:'Threshold',       lo:91,  hi:105},
    {key:'vo2',       z:'Z5', label:'VO\u2082max',          lo:106, hi:120},
    {key:'anaerobic', z:'Z6', label:'Anaerobic',       lo:121, hi:150},
    {key:'anaerobic', z:'Z7', label:'Neuromuscular',   lo:151, hi:null}
  ];
  var SWEET_SPOT_BAND = {lo:88, hi:94};

  function renderZoneTable(){
    function wattsRange(lo, hi){
      if(!hasFtp()) return '\u2014';
      return hi === null ? watts(lo) + '+ W' : watts(lo) + '\u2013' + watts(hi) + ' W';
    }
    var rows = ZONE_BANDS.map(function(b){
      return '<tr>' +
        '<td class="zone-name"><span class="zone-swatch" style="background:' + ZONES[b.key].color + '"></span>' +
          '<span class="zone-z">' + b.z + '</span>' + b.label + '</td>' +
        '<td class="zone-watts">' + wattsRange(b.lo, b.hi) + '</td>' +
      '</tr>';
    }).join('');
    rows += '<tr class="zone-band-row">' +
      '<td class="zone-name"><span class="zone-swatch" style="background:' + ZONES.sweetspot.color + '"></span>' +
        '<span class="zone-z">Z3\u20134</span>Sweet Spot <i>band</i></td>' +
      '<td class="zone-watts">' + wattsRange(SWEET_SPOT_BAND.lo, SWEET_SPOT_BAND.hi) + '</td>' +
    '</tr>';
    els.zoneTable.innerHTML = '<thead><tr><th>Zone</th><th>Watts</th></tr></thead><tbody>' + rows + '</tbody>';
    renderHrZoneTable();
  }

  // HR zones as % of max, matched to Strava's default names and boundaries.
  // Strava doesn't publish exact figures, so these are reverse-engineered from
  // a real Strava HR-zone display (192 bpm max → 0-113 / 114-150 / 151-168 /
  // 169-186 / 187+), which they reproduce to the beat. The odd decimals are
  // what make the bpm land exactly; the % column rounds them for display.
  var HR_ZONES = [
    {z:'Z1', label:'Endurance',  lo:0,    hi:59.4, color:'#5B8DEF'},
    {z:'Z2', label:'Moderate',   lo:59.4, hi:78.6, color:'#49B4B0'},
    {z:'Z3', label:'Tempo',      lo:78.6, hi:88,   color:'#E8B24D'},
    {z:'Z4', label:'Threshold',  lo:88,   hi:97.4, color:'#F2764A'},
    {z:'Z5', label:'Anaerobic',  lo:97.4, hi:null, color:'#FF5D75'}
  ];
  function hrZoneIndex(bpm){
    var m = rideMaxHr();
    if(!m || bpm === null || bpm === undefined) return -1;
    var pct = bpm / m * 100;
    for(var i = 0; i < HR_ZONES.length; i++){ if(HR_ZONES[i].hi === null || pct < HR_ZONES[i].hi) return i; }
    return HR_ZONES.length - 1;
  }
  function renderHrZoneTable(){
    document.getElementById('zonePopMaxHr').textContent = maxHr || '—';
    if(!maxHr){
      els.hrZoneTable.innerHTML = '<tbody><tr><td class="zone-pct" style="white-space:normal">Set your max HR in the Rider box to see bpm ranges.</td></tr></tbody>';
      return;
    }
    var rows = HR_ZONES.map(function(z){
      var lo = Math.round(maxHr * z.lo / 100), hi = z.hi === null ? null : Math.round(maxHr * z.hi / 100) - 1;
      return '<tr>' +
        '<td class="zone-name"><span class="zone-swatch" style="background:' + z.color + '"></span><span class="zone-z">' + z.z + '</span>' + z.label + '</td>' +
        '<td class="zone-pct">' + (z.hi === null ? Math.round(z.lo) + '%+' : Math.round(z.lo) + '–' + Math.round(z.hi) + '%') + '</td>' +
        '<td class="zone-watts">' + (hi === null ? lo + '+ bpm' : lo + '–' + hi + ' bpm') + '</td>' +
      '</tr>';
    }).join('');
    els.hrZoneTable.innerHTML = '<thead><tr><th>Zone</th><th>% max</th><th>bpm</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  function render(){
    renderFilters();
    renderWorkoutCards();
    renderZoneTable();
    els.zonePopFtp.textContent = hasFtp() ? ftp : '\u2014';
    updateStarFilterUI();
  }

  function setFtp(v){
    v = Math.round(v);
    if(!(v >= 80 && v <= 500)) return;
    ftp = v;
    try{ localStorage.setItem(FTP_KEY, String(ftp)); }catch(e){}
    if(parseInt(els.ftpInput.value, 10) !== ftp){
      els.ftpInput.value = ftp;
      els.ftpInput.dispatchEvent(new Event('change'));   // mirrors (top-bar chip) listen for it; set in code, no input event fires
    }
    render();
    renderWkg();
    if(typeof refreshReadiness === 'function') refreshReadiness();   // the FTP chip's check hint
    if(typeof savePrefs === 'function' && !applyingPrefs) savePrefs();   // sync to cloud
  }
  els.ftpInput.addEventListener('input', function(){
    var v = parseInt(this.value, 10);
    if(!v || v < 80) return;
    setFtp(v);
  });

  function setMaxHr(v){
    v = Math.round(v);
    if(!(v >= 120 && v <= 230)) return;
    maxHr = v;
    try{ localStorage.setItem(MAXHR_KEY, String(maxHr)); }catch(e){}
    if(parseInt(els.maxHrInput.value, 10) !== maxHr) els.maxHrInput.value = maxHr;
    renderZoneTable();
    if(typeof savePrefs === 'function' && !applyingPrefs) savePrefs();   // sync to cloud
  }
  els.maxHrInput.addEventListener('input', function(){
    var v = parseInt(this.value, 10);
    if(!v || v < 120) return;
    setMaxHr(v);
  });

  // Body weight, to one decimal. Feeds the W/kg line under the rider numbers.
  function renderWkg(){
    if(hasFtp() && hasWeight()){
      els.menuWkg.hidden = false;
      els.menuWkg.innerHTML = '<b>' + (ftp / weight).toFixed(2) + '</b> W/kg at FTP';
    } else {
      els.menuWkg.hidden = true;
    }
  }
  function setWeight(v){
    v = Math.round(v * 10) / 10;
    if(!(v >= 30 && v <= 200)) return;
    weight = v;
    try{ localStorage.setItem(WEIGHT_KEY, String(weight)); }catch(e){}
    if(parseFloat(els.weightInput.value) !== weight) els.weightInput.value = weight;
    renderWkg();
    if(typeof savePrefs === 'function' && !applyingPrefs) savePrefs();   // sync to cloud
  }
  els.weightInput.value = hasWeight() ? weight : '';
  els.weightInput.addEventListener('input', function(){
    var v = parseFloat(this.value);
    if(!v || v < 30) return;
    setWeight(v);
  });

  // ---- number keypad ----
  // The three rider numbers are read-only chips; tapping one opens a large
  // keypad instead of fighting a 30px field. Each field routes through its own
  // existing setter (which clamps, persists and syncs the chip display).
  var KP_FIELDS = {
    ftp:    {label:'FTP',    unit:'W',   step:5,   decimal:false, def:200, min:80,  max:500, get:function(){ return hasFtp() ? ftp : null; },       set:setFtp},
    maxhr:  {label:'Max HR', unit:'bpm', step:1,   decimal:false, def:180, min:120, max:230, get:function(){ return maxHr || null; },              set:setMaxHr},
    weight: {label:'Weight', unit:'kg',  step:0.5, decimal:true,  def:70,  min:30,  max:200, get:function(){ return hasWeight() ? weight : null; }, set:setWeight}
  };
  var kpField = null, kpStr = '', kpFresh = true;
  function kpFmt(n){ return (kpField && kpField.decimal) ? String(Math.round(n * 10) / 10) : String(Math.round(n)); }
  function kpRender(){
    els.kpValue.textContent = kpStr === '' ? '—' : kpStr;
    els.kpUnit.textContent = kpField ? kpField.unit : '';
  }
  function openKeypad(key){
    kpField = KP_FIELDS[key]; if(!kpField) return;
    var cur = kpField.get();
    kpStr = cur === null ? '' : kpFmt(cur);
    kpFresh = true;   // the first digit typed replaces the seeded value
    els.kpLabel.textContent = kpField.label;
    els.kpMinus.textContent = '−' + kpField.step;
    els.kpPlus.textContent = '+' + kpField.step;
    els.kpDot.style.visibility = kpField.decimal ? '' : 'hidden';
    kpRender();
    els.keypadOverlay.hidden = false;
    void els.keypadOverlay.offsetHeight;   // reflow so the open transition runs
    els.keypadOverlay.classList.add('open');
    els.kpSet.focus();
  }
  function closeKeypad(){
    els.keypadOverlay.classList.remove('open');
    var ov = els.keypadOverlay;
    setTimeout(function(){ if(!ov.classList.contains('open')) ov.hidden = true; }, 220);
    kpField = null;
  }
  function kpPress(k){
    if(!kpField) return;
    if(k === 'back'){ kpStr = kpStr.slice(0, -1); kpFresh = false; kpRender(); return; }
    if(k === '.'){
      if(!kpField.decimal) return;
      if(kpFresh){ kpStr = '0.'; kpFresh = false; }
      else if(kpStr.indexOf('.') === -1){ kpStr = (kpStr === '' ? '0' : kpStr) + '.'; }
      kpRender(); return;
    }
    if(kpFresh){ kpStr = (k === '0') ? '' : k; kpFresh = false; }   // no leading zero
    else {
      if(kpField.decimal && kpStr.indexOf('.') !== -1 && kpStr.split('.')[1].length >= 1) return;  // one decimal place
      if(kpStr.replace('.', '').length >= 4) return;   // keep it sane
      kpStr += k;
    }
    kpRender();
  }
  function kpClamp(v){ return Math.min(kpField.max, Math.max(kpField.min, v)); }
  function kpNudge(dir){
    if(!kpField) return;
    var base = kpStr === '' ? kpField.get() : parseFloat(kpStr);
    if(base === null || isNaN(base)) base = kpField.def;
    kpStr = kpFmt(kpClamp(base + dir * kpField.step));
    kpFresh = false;
    kpRender();
  }
  function kpCommit(){
    if(!kpField) return;
    var v = parseFloat(kpStr);
    // A wild entry snaps to range rather than being silently ignored.
    if(!isNaN(v)) kpField.set(kpClamp(v));
    closeKeypad();
  }
  if(els.keypadOverlay){
    els.menuRider.addEventListener('click', function(e){
      var chip = e.target.closest('.ftp-chip[data-num]'); if(chip) openKeypad(chip.getAttribute('data-num'));
    });
    els.menuRider.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' && e.key !== ' ') return;
      var chip = e.target.closest('.ftp-chip[data-num]'); if(!chip) return;
      e.preventDefault(); openKeypad(chip.getAttribute('data-num'));
    });
    els.kpGrid.addEventListener('click', function(e){
      var b = e.target.closest('button[data-k]'); if(b) kpPress(b.getAttribute('data-k'));
    });
    els.kpMinus.addEventListener('click', function(){ kpNudge(-1); });
    els.kpPlus.addEventListener('click', function(){ kpNudge(1); });
    els.kpSet.addEventListener('click', kpCommit);
    els.kpCancel.addEventListener('click', closeKeypad);
    els.keypadOverlay.querySelector('[data-kpclose]').addEventListener('click', closeKeypad);
    // A physical keyboard drives it too, so desktop can just type and Enter.
    document.addEventListener('keydown', function(e){
      if(els.keypadOverlay.hidden) return;
      if(e.key === 'Escape'){ closeKeypad(); return; }
      if(e.key === 'Enter'){ kpCommit(); return; }
      if(e.key === 'Backspace'){ e.preventDefault(); kpPress('back'); return; }
      if(e.key >= '0' && e.key <= '9'){ kpPress(e.key); return; }
      if(e.key === '.'){ kpPress('.'); return; }
    });
  }
  renderWkg();

  var searchTimer = null;
  els.searchBox.addEventListener('input', function(){
    var v = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function(){
      filters.search = v;
      renderWorkoutCards();
    }, 120);
  });

  // ---- hamburger menu (theme / guide / zones / rider numbers) ----
  function setMenu(open){
    els.sideMenu.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  els.menuBtn.addEventListener('click', function(e){ e.stopPropagation(); setMenu(els.sideMenu.hidden); });
  // A pick inside the menu (theme, guide, zones) closes it; the rider inputs
  // don't, so FTP can be nudged without it snapping shut.
  els.sideMenu.addEventListener('click', function(e){
    if(e.target.closest('.menu-item')) setMenu(false);
  });
  document.addEventListener('click', function(e){
    if(!els.sideMenu.hidden && !els.sideMenu.contains(e.target) && e.target !== els.menuBtn && !els.menuBtn.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !els.sideMenu.hidden) setMenu(false); });

  // Hovering the magnifier opens the box ready to type, so a search is one
  // motion rather than click-then-click. A short dwell keeps a cursor that's
  // merely passing through from popping it open; the existing blur rule
  // closes it again if nothing was typed.
  var searchHoverTimer = null;
  els.searchBtn.addEventListener('mouseenter', function(){
    if(els.listActions.classList.contains('searching')) return;
    searchHoverTimer = setTimeout(function(){
      els.listActions.classList.add('searching');
      els.searchBox.focus();
    }, 120);
  });
  els.searchBtn.addEventListener('mouseleave', function(){ clearTimeout(searchHoverTimer); });

  els.searchBtn.addEventListener('click', function(){
    clearTimeout(searchHoverTimer);
    var open = els.listActions.classList.contains('searching');
    if(open && els.searchBox.value){
      // Clear rather than hide: a hidden box that's still filtering is confusing.
      els.searchBox.value = ''; filters.search = ''; renderWorkoutCards();
      els.searchBox.focus();
      return;
    }
    // Hover has usually opened it already by the time the click lands; a
    // click on an open, empty box is "I want to type", not "close it".
    if(open && document.activeElement === els.searchBox) return;
    els.listActions.classList.toggle('searching', !open);
    if(!open) els.searchBox.focus();
  });
  els.searchBox.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      this.value = ''; filters.search = ''; renderWorkoutCards();
      els.listActions.classList.remove('searching');
      this.blur();
    }
    e.stopPropagation();   // arrows move the cursor, not the sidebar or list
  });
  els.searchBox.addEventListener('blur', function(){
    if(!this.value) els.listActions.classList.remove('searching');
  });

  // ---- power zone popover ----
  // Sits on <body> and is positioned here, because the sidebar clips its
  // children and the panel is wider than the sidebar.
  function placeZonePop(){
    var r = els.ftpHelp.getBoundingClientRect();
    var pop = els.zonePop;
    pop.classList.add('open');
    var w = pop.offsetWidth, h = pop.offsetHeight;
    // Clear the sidebar rather than sitting on top of it.
    var sideRight = els.sidebar.getBoundingClientRect().right;
    var left = Math.max(r.right + 12, sideRight + 12);
    if(left + w > window.innerWidth - 10) left = Math.max(10, r.left - w - 12);
    var top = Math.min(Math.max(10, r.top - 10), window.innerHeight - h - 10);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }
  function hideZonePop(){ els.zonePop.classList.remove('open'); }
  // Click to open / close (was hover). stopPropagation keeps the menu open
  // behind it; an outside click or Escape dismisses.
  els.ftpHelp.addEventListener('click', function(e){
    e.stopPropagation();
    if(els.zonePop.classList.contains('open')) hideZonePop(); else placeZonePop();
  });
  document.addEventListener('click', function(e){
    if(els.zonePop.classList.contains('open') && !els.zonePop.contains(e.target) && !els.ftpHelp.contains(e.target)) hideZonePop();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') hideZonePop(); });
  window.addEventListener('resize', function(){ if(els.zonePop.classList.contains('open')) placeZonePop(); });

  function renderSortMenu(){
    els.sortMenu.innerHTML = '';
    SORT_OPTIONS.forEach(function(o){
      var b = document.createElement('button');
      b.textContent = o.label;
      b.className = filters.sort === o.v ? 'on' : '';
      b.addEventListener('click', function(){
        filters.sort = o.v;
        try{ localStorage.setItem(SORT_KEY, o.v); }catch(e){}   // remembered next time
        els.sortMenu.style.display = 'none';
        renderSortMenu();
        renderWorkoutCards();
      });
      els.sortMenu.appendChild(b);
    });
  }
  els.sortBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var showing = els.sortMenu.style.display !== 'none';
    els.sortMenu.style.display = showing ? 'none' : 'block';
  });
  document.addEventListener('click', function(e){
    if(els.sortMenu.style.display !== 'none' && !els.sortMenu.contains(e.target)){
      els.sortMenu.style.display = 'none';
    }
  });

  function updateStarFilterUI(){
    var n = Object.keys(favs).length;
    els.starFilterBtn.classList.toggle('on', filters.starredOnly);
    els.starFilterBtn.title = filters.starredOnly
      ? 'Showing starred only — click to show all'
      : (n ? 'Show starred only (' + n + ')' : 'Star a workout to build a shortlist');
  }
  els.starFilterBtn.addEventListener('click', function(){
    filters.starredOnly = !filters.starredOnly;
    updateStarFilterUI();
    renderWorkoutCards();
  });

  // ---- keyboard ----
  // Left/right work the sidebar, up/down move through the list, Enter starts.
  // All of it stands down while typing, and while a workout is running (where
  // up/down are the intensity control).
  function typingInField(){
    var a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }
  document.addEventListener('keydown', function(e){
    if(liveState.active || typingInField()) return;
    if(e.metaKey || e.ctrlKey || e.altKey) return;

    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!visibleKeys.length) return;
      e.preventDefault();
      var i = visibleKeys.indexOf(selectedKey);
      if(i < 0) i = 0;
      else i = e.key === 'ArrowDown' ? Math.min(visibleKeys.length - 1, i + 1) : Math.max(0, i - 1);
      selectWorkout(visibleKeys[i], {scrollIntoView:true});
      return;
    }
    if(e.key === 'Enter' && selectedKey){ e.preventDefault(); startWorkout(selectedKey); }
  });
