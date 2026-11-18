  // ============================================================
  // DESKTOP SHELL — left-rail nav + top bar
  // ============================================================
  // Desktop-only wiring (the rail, top bar and these controls are hidden on
  // mobile, where the bottom tabs + sheets drive everything — untouched here).
  // The rail nav swaps the content area between the workout browser, the
  // calendar and the fitness charts; Calendar/Fitness reuse the existing modals,
  // docked into the content area via a body attribute. The top bar mirrors the
  // athlete numbers + connection status, still edited/managed through the same
  // keypad and menu as before.
  (function(){
    var railNav = document.getElementById('railNav');
    if(!railNav) return;
    var tbPage = document.getElementById('tbPage');
    var moveUnderline = null;   // set by the chrome setup below; slides the nav indicator
    var trendsModal = document.getElementById('trendsModal');
    var logModal = els.logModal;
    var isMobile = function(){ return window.matchMedia('(max-width:900px)').matches; };
    function shown(m){ return m && m.style.display !== 'none'; }

    var PAGE = {workouts:'Workouts', calendar:'Calendar', fitness:'Fitness'};
    var lastLogView = 'calendar';
    function setDeskView(v){
      if(!PAGE[v]) v = 'workouts';
      if(LOG_MODE && v === 'workouts'){ location.href = APP_URL; return; }   // the full app is its own page
      if(LOG_MODE) lastLogView = v;
      if(v !== 'calendar' && shown(logModal) && typeof closeLog === 'function') closeLog();
      if(v !== 'fitness' && shown(trendsModal)) trendsModal.style.display = 'none';
      document.body.setAttribute('data-deskview', v);
      if(tbPage) tbPage.textContent = PAGE[v];
      [].forEach.call(railNav.querySelectorAll('.rn-item'), function(b){ b.classList.toggle('on', b.getAttribute('data-view') === v); });
      if(moveUnderline) moveUnderline();
      if(v === 'calendar' && els.logBtn) els.logBtn.click();
      else if(v === 'fitness' && els.trendsBtn) els.trendsBtn.click();
    }
    logDeskView = setDeskView;
    railNav.addEventListener('click', function(e){
      var b = e.target.closest('.rn-item'); if(b) setDeskView(b.getAttribute('data-view'));
    });

    // The docked modals hide themselves on their own Close / Escape; watch their
    // display to snap the nav back to Workouts.
    function resync(){
      if(isMobile()) return;
      // Log page: there's nothing behind the modals, so a close (Esc) reopens the
      // last view. Deferred, because switching views closes one before opening the other.
      if(LOG_MODE){
        setTimeout(function(){ if(!isMobile() && !shown(logModal) && !shown(trendsModal)) setDeskView(lastLogView); }, 0);
        return;
      }
      if(!shown(logModal) && !shown(trendsModal) && document.body.getAttribute('data-deskview') !== 'workouts') setDeskView('workouts');
    }
    [logModal, trendsModal].forEach(function(m){
      if(m) new MutationObserver(resync).observe(m, {attributes:true, attributeFilter:['style']});
    });

    // Rail utilities proxy the existing menu controls.
    function proxy(id, targetId){ var b = document.getElementById(id), t = document.getElementById(targetId); if(b && t) b.addEventListener('click', function(){ t.click(); }); }
    proxy('railTheme', 'themeToggle');
    proxy('railGuide', 'guideBtn');
    proxy('railZones', 'ftpHelp');

    // Each top-bar chip opens the menu as a dropdown beneath it, showing only
    // its own section: the numbers chip -> Your numbers (which open the keypad),
    // the connections chip -> device pairing.
    var sideMenu = els.sideMenu;
    function openDeskMenu(mode, anchor){
      var want = sideMenu.hidden || sideMenu.getAttribute('data-menumode') !== mode;
      sideMenu.classList.remove('show-numbers', 'show-conns');
      if(!want){ sideMenu.hidden = true; sideMenu.removeAttribute('data-menumode'); return; }
      if(mode === 'numbers') sideMenu.classList.add('show-numbers');
      else if(mode === 'conns') sideMenu.classList.add('show-conns');
      // 'setup' adds neither class → both Numbers and Connections sections show
      sideMenu.setAttribute('data-menumode', mode);
      sideMenu.hidden = false;
      var r = anchor.getBoundingClientRect(), w = sideMenu.offsetWidth || 320;
      sideMenu.style.right = 'auto';
      sideMenu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
      sideMenu.style.top = (r.bottom + 8) + 'px';
    }
    var tbNumsChip = document.getElementById('tbNumsChip');
    var kpOverlay = document.getElementById('keypadOverlay');
    function anchorKeypad(anchor){
      var panel = kpOverlay && kpOverlay.querySelector('.keypad-panel'); if(!panel) return;
      var r = anchor.getBoundingClientRect(), pw = panel.offsetWidth || 260;
      panel.style.position = 'fixed'; panel.style.margin = '0';
      panel.style.top = (r.bottom + 8) + 'px';
      panel.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    }
    if(tbNumsChip && typeof openKeypad === 'function') tbNumsChip.addEventListener('click', function(e){
      var b = e.target.closest('.tbn[data-num]'); if(!b) return;
      openKeypad(b.getAttribute('data-num'));
      anchorKeypad(b);
    });
    // Clear the inline anchor when the keypad closes, so a centred (mobile) open
    // later isn't stuck under a stale position.
    if(kpOverlay) new MutationObserver(function(){
      if(kpOverlay.hidden){
        var p = kpOverlay.querySelector('.keypad-panel');
        if(p){ ['position','margin','top','left','right','bottom'].forEach(function(k){ p.style[k] = ''; }); }
      }
    }).observe(kpOverlay, {attributes:true, attributeFilter:['hidden']});
    var tbConns = document.getElementById('tbConns');
    if(tbConns && sideMenu) tbConns.addEventListener('click', function(e){ e.stopPropagation(); openDeskMenu('conns', tbConns); });

    // Keep the top bar in step without touching every update site: mirror the
    // connection dots (class changes) and the number fields.
    function syncTopbar(){
      function mirror(src, dst){ var s = document.getElementById(src), d = document.getElementById(dst); if(s && d) d.className = s.className; }
      mirror('connTrainerDot', 'tbTrainerDot');
      mirror('connHrDot', 'tbHrDot');
      mirror('connStravaDot', 'tbStravaDot');
      function num(inp, out){ var i = document.getElementById(inp), o = document.getElementById(out); if(!i || !o) return; var v = (i.value || '').trim(); o.textContent = v ? v : '—'; }
      num('ftpInput', 'tbFtp');
      num('maxHrInput', 'tbHr');
      num('weightInput', 'tbWt');
    }
    ['connTrainerDot','connHrDot','connStravaDot'].forEach(function(id){
      var el2 = document.getElementById(id); if(el2) new MutationObserver(syncTopbar).observe(el2, {attributes:true, attributeFilter:['class']});
    });
    ['ftpInput','maxHrInput','weightInput'].forEach(function(id){
      var el2 = document.getElementById(id); if(el2){ el2.addEventListener('input', syncTopbar); el2.addEventListener('change', syncTopbar); }
    });
    syncTopbar();

    var railCount = document.getElementById('railCount');
    if(railCount && typeof WORKOUTS !== 'undefined' && WORKOUTS) railCount.textContent = WORKOUTS.length || '';

    // ---- Full-width chrome: the sidebar is retired on the Workouts page, so the
    // section nav + utilities move into the top bar and the filters become a
    // compact bar in the list header. (All hidden on mobile, which keeps its
    // bottom tabs + sliders.) ----
    var topBar = document.getElementById('topBar');
    if(topBar){
      var tbRight = topBar.querySelector('.tb-right');
      var brand = document.createElement('span');
      brand.className = 'tb-brand'; brand.setAttribute('role', 'img'); brand.setAttribute('aria-label', 'FTP');
      topBar.insertBefore(brand, topBar.firstChild);
      if(tbPage) tbPage.style.display = 'none';
      topBar.insertBefore(railNav, brand.nextSibling);         // nav keeps its setDeskView handler

      // FTP chip → the numbers editor (FTP / Max HR / Weight). The connections
      // chip (#tbConns) opens the Connections panel, wired above.
      var tbFtpChip = document.getElementById('tbFtpChip');
      if(tbFtpChip && sideMenu) tbFtpChip.addEventListener('click', function(e){ e.stopPropagation(); if(typeof closeMore === 'function') closeMore(); openDeskMenu('numbers', tbFtpChip); });
      // Keypad opened from a menu number chip anchors under that chip (03 opens it).
      var menuRider = document.querySelector('.menu-rider');
      if(menuRider) menuRider.addEventListener('click', function(e){
        var chip = e.target.closest('.ftp-chip[data-num]'); if(chip) anchorKeypad(chip);
      });
      // Clicking outside the panel closes it (not its chips, which toggle, nor the keypad).
      document.addEventListener('click', function(e){
        if(sideMenu && !sideMenu.hidden && !e.target.closest('#sideMenu') && !e.target.closest('#tbConns') && !e.target.closest('#tbFtpChip') && !e.target.closest('#keypadOverlay')){
          sideMenu.hidden = true; sideMenu.removeAttribute('data-menumode');
        }
      });

      // Overflow: theme / guide / zones collapse into a '⋯' dropdown on <body>.
      var tbMore = document.getElementById('tbMore');
      if(tbMore) topBar.insertBefore(tbMore, railNav.nextSibling);   // sit next to the nav (after Fitness)
      var tbMoreMenu = document.createElement('div');
      tbMoreMenu.className = 'tb-more-menu'; tbMoreMenu.id = 'tbMoreMenu'; tbMoreMenu.hidden = true;
      document.body.appendChild(tbMoreMenu);
      ['railTheme','railGuide','railZones'].forEach(function(id){ var u = document.getElementById(id); if(u) tbMoreMenu.appendChild(u); });
      function closeMore(){ tbMoreMenu.hidden = true; if(tbMore) tbMore.setAttribute('aria-expanded', 'false'); }
      if(tbMore){
        tbMore.addEventListener('click', function(e){
          e.stopPropagation();
          if(sideMenu && !sideMenu.hidden){ sideMenu.hidden = true; sideMenu.removeAttribute('data-menumode'); }   // close the setup panel
          var show = tbMoreMenu.hidden;
          tbMoreMenu.hidden = !show;
          tbMore.setAttribute('aria-expanded', show ? 'true' : 'false');
          if(show){
            var r = tbMore.getBoundingClientRect(), w = tbMoreMenu.offsetWidth || 180;
            tbMoreMenu.style.left = Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))) + 'px';
            tbMoreMenu.style.top = (r.bottom + 8) + 'px';
          }
        });
        tbMoreMenu.addEventListener('click', function(){ setTimeout(closeMore, 0); });   // a util was chosen
        document.addEventListener('click', function(e){ if(!tbMoreMenu.hidden && !e.target.closest('#tbMoreMenu') && !e.target.closest('#tbMore')) closeMore(); });
      }

      // Sliding active-section indicator on the top bar's bottom border. One bar,
      // positioned under whichever nav item is active; CSS transitions the move.
      var tbUnderline = document.createElement('span');
      tbUnderline.className = 'tb-underline';
      topBar.appendChild(tbUnderline);
      moveUnderline = function(){
        var on = railNav.querySelector('.rn-item.on');
        if(!on){ tbUnderline.style.width = '0'; return; }
        var ir = on.getBoundingClientRect(), tr = topBar.getBoundingClientRect();
        if(!ir.width) return;   // hidden (mobile) — leave it be
        tbUnderline.style.left = (ir.left - tr.left) + 'px';
        tbUnderline.style.width = ir.width + 'px';
      };
      // Left-align the filter row (the pane-head) to the Workouts nav item above it.
      function alignFilterRow(){
        var nav = railNav.querySelector('.rn-item[data-view="workouts"]');
        if(!nav) return;
        var r = nav.getBoundingClientRect();
        if(!r.width) return;   // hidden (mobile)
        var left = Math.round(r.left) + 'px';
        // The top bar is centred in the page column (CSS max() padding); mirror
        // its right padding so the filter row + index end at the same column edge
        // (meta under FTP), instead of running to the viewport edge on wide screens.
        var topbar = document.querySelector('.topbar');
        var padR = topbar ? parseFloat(getComputedStyle(topbar).paddingRight) || 22 : 22;
        var ph = document.querySelector('.list-pane .list-top .pane-head');
        if(ph){ ph.style.paddingLeft = left; ph.style.paddingRight = padR + 'px'; }
        var idx = document.getElementById('workoutCards');   // line the index up too
        if(idx){
          idx.style.paddingLeft = left;
          // The list scrolls, so its scrollbar steals width the (non-scrolling)
          // top bar + filter row don't lose. Trim the index's right gutter by the
          // scrollbar width so the meta's right edge still meets FTP / sort.
          var listBody = document.querySelector('.list-body');
          var sb = listBody ? Math.max(0, listBody.offsetWidth - listBody.clientWidth) : 0;
          idx.style.paddingRight = Math.max(0, padR - sb) + 'px';
        }
      }
      function reflowChrome(){ moveUnderline(); alignFilterRow(); }
      requestAnimationFrame(function(){ requestAnimationFrame(reflowChrome); });
      window.addEventListener('load', reflowChrome);
      setTimeout(reflowChrome, 300);        // fallback once the mono font has laid out
      if(document.fonts && document.fonts.ready) document.fonts.ready.then(reflowChrome);
      window.addEventListener('resize', reflowChrome);

      // Compact filter bar in the list header, wired to the same filter state.
      var paneHead = document.querySelector('.list-pane .list-top .pane-head');
      var facets = null;
      if(paneHead){
        facets = document.createElement('div');
        facets.className = 'df-facets'; facets.id = 'deskFilters';
        paneHead.insertBefore(facets, paneHead.querySelector('.list-actions') || null);
        // Result count moves to the right of the facets (after Spice), not the left.
        var resultCount = document.getElementById('resultCount');
        if(resultCount) paneHead.insertBefore(resultCount, paneHead.querySelector('.list-actions') || null);
      }
      var pop = document.createElement('div');
      pop.className = 'df-pop'; pop.hidden = true; pop.id = 'dfPop';
      document.body.appendChild(pop);

      var FACETS = [['zone','Zone'],['duration','Time'],['shape','Shape'],['spice','Spice']];
      function facetText(key){
        if(key === 'zone')     return filters.zone ? (ZONES[filters.zone] ? ZONES[filters.zone].label : filters.zone) : 'All';
        if(key === 'duration') return filters.duration != null ? (filters.duration + ' min') : 'Any';
        if(key === 'shape')    return filters.shape ? shapeLabel(filters.shape) : 'Any';
        if(key === 'spice')    return filters.spice ? (SPICE_LABEL[filters.spice] || filters.spice) : 'Any';
        return '';
      }
      function facetSet(key){ return key === 'duration' ? filters.duration != null : !!filters[key]; }
      var built = false;
      function buildFacets(){
        if(!facets || !filterOpts) return;
        facets.innerHTML = FACETS.map(function(p){
          return '<button class="df" type="button" data-facet="' + p[0] + '"><span class="df-k">' + p[1] + '</span> <b class="df-v"></b></button>';
        }).join('') + '<button class="df-reset" type="button" hidden>Reset</button>';
        [].forEach.call(facets.querySelectorAll('.df'), function(b){
          b.addEventListener('click', function(e){ e.stopPropagation(); openFacet(b.getAttribute('data-facet'), b); });
        });
        var rb = facets.querySelector('.df-reset');
        if(rb) rb.addEventListener('click', function(e){
          e.stopPropagation(); closePop();
          filters.duration = filters.zone = filters.shape = filters.spice = null;   // clear facets, keep browse state
          renderFilters(); renderWorkoutCards();
        });
        built = true;
      }
      function updateFacets(){
        if(!facets) return;
        if(!built) buildFacets();
        var anySet = false;
        [].forEach.call(facets.querySelectorAll('.df'), function(b){
          var k = b.getAttribute('data-facet'), v = b.querySelector('.df-v');
          if(v) v.textContent = facetText(k);
          var on = facetSet(k); b.classList.toggle('on', on); if(on) anySet = true;
        });
        var rb = facets.querySelector('.df-reset'); if(rb) rb.hidden = !anySet;
      }
      function facetOptions(key){
        var opts = [{val:null, label:(key === 'zone' ? 'All' : 'Any')}];
        if(!filterOpts) return opts;
        if(key === 'zone')          filterOpts.zones.forEach(function(z){ opts.push({val:z, label:(ZONES[z] ? ZONES[z].label : z), dot:(ZONES[z] ? ZONES[z].color : null)}); });
        else if(key === 'duration') filterOpts.durations.forEach(function(d){ opts.push({val:d, label:d + ' min'}); });
        else if(key === 'shape')    filterOpts.shapes.forEach(function(k2){ opts.push({val:k2, label:shapeLabel(k2)}); });
        else if(key === 'spice')    SPICE_ORDER.forEach(function(g){ opts.push({val:g, label:SPICE_LABEL[g]}); });
        return opts;
      }
      var openKey = null;
      function closePop(){
        if(!pop) return;
        pop.hidden = true; openKey = null;
        if(facets) [].forEach.call(facets.querySelectorAll('.df.open'), function(b){ b.classList.remove('open'); });
      }
      function openFacet(key, anchor){
        if(openKey === key){ closePop(); return; }
        closePop(); openKey = key;
        var cur = key === 'duration' ? filters.duration : filters[key];
        pop.innerHTML = facetOptions(key).map(function(o){
          var on = (o.val === cur) || (o.val === null && (cur === null || cur === undefined));
          // Grey out a value that would empty the list (a dead end), holding the
          // other filters fixed. "Any/All" and the current pick are never dead.
          var dead = o.val !== null && !on && typeof anyMatch === 'function' && !anyMatch(probeFilters(key, o.val));
          return '<button class="dfo' + (on ? ' on' : '') + (dead ? ' dead' : '') + '" type="button"' + (dead ? ' disabled' : '') +
            ' data-val="' + (o.val === null ? '' : o.val) + '">' +
            (o.dot ? '<i class="dfo-dot" style="background:' + o.dot + '"></i>' : '') + o.label + '</button>';
        }).join('');
        [].forEach.call(pop.querySelectorAll('.dfo'), function(b){
          b.addEventListener('click', function(e){
            e.stopPropagation();
            var raw = b.getAttribute('data-val');
            var val = raw === '' ? null : (key === 'duration' ? +raw : raw);
            filters[key] = val;                 // explicit set (menu pick, not a toggle)
            renderFilters(); renderWorkoutCards();
            closePop();
          });
        });
        pop.hidden = false;
        var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth || 200;
        pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
        pop.style.top = (r.bottom + 7) + 'px';
        anchor.classList.add('open');
      }
      document.addEventListener('click', function(e){ if(openKey && !e.target.closest('#dfPop') && !e.target.closest('.df')) closePop(); });
      document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closePop(); });

      onFiltersRendered = updateFacets;   // every renderFilters refreshes the bar
      updateFacets();                     // once now, if the library is already in
    }
  })();
