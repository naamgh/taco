  // ============================================================
  // TRAINING LOG PAGE (log.html) + hand-offs from it
  // ============================================================
  // The log page is this same app built with <html data-mode="log">: it opens
  // straight into Calendar, keeps Calendar or Fitness on screen, and sends
  // anything to do with the workout list to the full app (APP_URL) via the
  // URL hash. The full app picks those hashes up here once it has booted.
  (function(){
    if(!LOG_MODE){
      // #workout=<key> → open that workout's card; #browse=zone,spice,duration → the
      // calendar's "Show me … workouts" filter.
      var m = location.hash.match(/^#(workout|browse)=(.*)$/);
      if(!m) return;
      history.replaceState(null, '', location.pathname + location.search);
      var arg = decodeURIComponent(m[2]);
      if(m[1] === 'workout'){ viewWorkout(arg); return; }
      var p = arg.split(','), spice = p[1] === '' || p[1] === undefined ? null : (isNaN(+p[1]) ? p[1] : +p[1]);
      browseAll = true;
      closeFindModal();
      browsePlanZone({zone:p[0] || null, spice:spice}, +p[2] || null);
      return;
    }

    document.title = 'Training Log';
    var mq = window.matchMedia('(max-width:900px)');
    function shown(m){ return m && m.style.display !== 'none'; }
    var last = 'calendar';

    // Phone: no top bar, so each modal gets a small section switch at its top.
    function switchHTML(on){
      return '<nav class="lm-switch" aria-label="Sections">' +
        '<button type="button" data-lm="calendar"' + (on === 'calendar' ? ' class="on" aria-current="page"' : '') + '>Calendar</button>' +
        '<button type="button" data-lm="fitness"' + (on === 'fitness' ? ' class="on" aria-current="page"' : '') + '>Fitness</button>' +
        '<a href="' + APP_URL + '" class="lm-app">Workouts ↗</a></nav>';
    }
    [[els.logModal, 'calendar'], [els.trendsModal, 'fitness']].forEach(function(p){
      var inner = p[0] && p[0].querySelector('.live-inner');
      if(inner) inner.insertAdjacentHTML('afterbegin', switchHTML(p[1]));
    });
    function open(v){
      last = v;
      if(!mq.matches && logDeskView){ logDeskView(v); return; }
      if(v === 'calendar'){ if(shown(els.trendsModal)) closeTrends(); if(!shown(els.logModal)) els.logBtn.click(); }
      else { if(shown(els.logModal)) closeLog(); if(!shown(els.trendsModal)) els.trendsBtn.click(); }
    }
    document.addEventListener('click', function(e){
      var b = e.target.closest('.lm-switch [data-lm]'); if(b) open(b.getAttribute('data-lm'));
    });
    // Phone: nothing sits behind the modals, so a close (Esc, back gesture)
    // reopens the last view. Desktop does the same in the desktop nav (10).
    [els.logModal, els.trendsModal].forEach(function(m){
      if(m) new MutationObserver(function(){
        if(shown(els.trendsModal)) last = 'fitness'; else if(shown(els.logModal)) last = 'calendar';
        setTimeout(function(){ if(mq.matches && !shown(els.logModal) && !shown(els.trendsModal)) open(last); }, 0);
      }).observe(m, {attributes:true, attributeFilter:['style']});
    });
    open('calendar');
  })();
