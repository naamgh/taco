  function adoptLibrary(data){
    LIBRARY = data;
    WORKOUTS = data.workouts || [];
    // Derive a stable key if the library predates the field, or came from an
    // import that never had one.
    WORKOUTS.forEach(function(w){
      if(!w.key) w.key = String(w.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    });
    render();
    refreshDoneMarks();   // ticks on the cards come from the ride log
    if(typeof refreshReadiness === 'function') refreshReadiness();   // opening-screen card, from local data
    // Pull new Strava activity in the background so the charts and readiness
    // are current without visiting the calendar. No-op unless connected;
    // deferred so the on-load Strava token validation settles first.
    if(typeof maybeAutoSync === 'function') setTimeout(maybeAutoSync, 1500);
    dismissLoadScreen();
    // The log page has no rides to start: no FTP prompt, no trainer pairing.
    if(LOG_MODE) return;
    // After the library exists, so the prompt can name the real ramp test.
    maybeShowIntro();
    // Needs no click, so it can start as soon as the page is up.
    autoConnectRemembered();
  }

  // Fill the bar and fade the load screen out once the list is on screen.
  function dismissLoadScreen(){
    var ls = document.getElementById('loadScreen');
    if(!ls) return;
    ls.classList.add('done');
    setTimeout(function(){ if(ls.parentNode) ls.parentNode.removeChild(ls); }, 450);
  }

  // The library is embedded in this file so the app works when it's opened
  // directly — fetch() can't read a sibling file from a file:// page. The
  // external library.json is kept as a fallback for a split setup.
  function loadLibrary(){
    var inline = document.getElementById('libraryData');
    if(inline && inline.textContent.trim().length > 2){
      try{
        adoptLibrary(JSON.parse(inline.textContent));
        return;
      }catch(e){
        console.log('Embedded library unreadable, falling back to fetch:', e);
      }
    }

    els.resultCount.textContent = 'Loading library…';
    fetch('library.json', {cache:'no-store'})
      .then(function(r){
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(adoptLibrary)
      .catch(function(e){
        console.log('Library load failed:', e);
        els.resultCount.textContent = 'Library unavailable';
        els.noResults.style.display = 'block';
        els.noResults.textContent = 'No workout library found — this file has no embedded library and library.json could not be loaded (' + e.message + ').';
        dismissLoadScreen();
      });
  }
  loadLibrary();
