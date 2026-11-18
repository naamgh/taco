  // ============================================================
  // BLUETOOTH: trainer (FTMS) + heart rate monitor
  // ============================================================
  var FTMS_SERVICE = 0x1826;
  var INDOOR_BIKE_DATA_CHAR = 0x2ad2;
  var FTMS_CONTROL_POINT = 0x2ad9;
  var HR_SERVICE = 0x180d;
  var HR_MEASUREMENT_CHAR = 0x2a37;

  var trainerState = {connected:false, reconnecting:false, userDisconnected:false, device:null, controlChar:null, hasControl:false};
  var hrState = {connected:false, reconnecting:false, userDisconnected:false, device:null};
  var liveReadouts = {power:null, cadence:null, hr:null, trainerAtMs:0};

  // A file:// page reports isSecureContext === true, because the Secure
  // Contexts spec treats the file scheme as potentially trustworthy. Web
  // Bluetooth still refuses it: Chromium rejects Bluetooth calls from an
  // opaque origin, which is what a file:// document has. So the secure-context
  // check alone passes on file:// and leaves the Connect buttons live but
  // broken \u2014 the protocol has to be tested separately.
  function inFrame(){
    try{ return window.self !== window.top; }catch(e){ return true; }
  }

  // A cross-origin iframe (a hosted preview, for instance) is a secure context
  // with navigator.bluetooth present, but Chromium still refuses the call
  // unless the embedder sends Permissions-Policy: bluetooth=self. Ask the
  // permissions policy directly where the browser exposes it.
  function bluetoothPermitted(){
    try{
      var fp = document.featurePolicy || document.permissionsPolicy;
      if(fp && typeof fp.allowsFeature === 'function') return fp.allowsFeature('bluetooth');
    }catch(e){}
    return !inFrame();   // can't ask: assume an embedded page is blocked
  }

  function bleAvailable(){
    return !!(navigator.bluetooth) && window.isSecureContext &&
           location.protocol !== 'file:' && bluetoothPermitted();
  }

  function checkBleSupport(){
    if(bleAvailable()) return;
    els.bleWarning.style.display = 'block';
    els.trainerBtn.disabled = true;
    els.hrBtn.disabled = true;
    if(navigator.bluetooth && window.isSecureContext && !bluetoothPermitted()){
      els.bleWarning.textContent = 'This page is running inside an embedded frame, which blocks Bluetooth — open the app in its own Chrome or Edge tab to pair a trainer.';
    } else if(location.protocol === 'file:'){
      els.bleWarning.textContent = 'Opened as a local file, so the trainer and HR connections are disabled \u2014 Chrome blocks Bluetooth from file:// pages. Everything else works. Use the hosted address (or a local server) to pair a trainer.';
    } else if(navigator.bluetooth && !window.isSecureContext){
      els.bleWarning.textContent = 'This page isn\u2019t running in a secure context, so the trainer and HR connections are disabled. Serve it from http://localhost or an https:// address.';
    } else {
      els.bleWarning.textContent = 'Web Bluetooth isn\u2019t available in this browser \u2014 use Chrome or Edge on desktop or Android, served from http://localhost or an https:// address.';
    }
  }

  function parseIndoorBikeData(dataView){
    var flags = dataView.getUint16(0, true);
    var offset = 2;
    var out = {};
    if(!(flags & 0x1)){ offset += 2; } // instantaneous speed present, not needed
    if(flags & 0x2){ offset += 2; } // average speed
    if(flags & 0x4){ out.cadence = dataView.getUint16(offset, true) * 0.5; offset += 2; }
    if(flags & 0x8){ offset += 2; } // average cadence
    if(flags & 0x10){ offset += 3; } // total distance (uint24)
    if(flags & 0x20){ offset += 2; } // resistance level
    if(flags & 0x40){ out.power = dataView.getInt16(offset, true); offset += 2; }
    if(flags & 0x80){ offset += 2; } // average power
    if(flags & 0x100){ offset += 5; } // expended energy (total+perHour+perMin)
    if(flags & 0x200){ out.hr = dataView.getUint8(offset); offset += 1; }
    return out;
  }

  function handleBikeData(event){
    var data = parseIndoorBikeData(event.target.value);
    liveReadouts.trainerAtMs = now();   // freshness, for auto-pause
    if(data.power !== undefined){ liveReadouts.power = data.power; }
    if(data.cadence !== undefined){ liveReadouts.cadence = data.cadence; }
    if(data.hr !== undefined && !hrState.connected){ liveReadouts.hr = data.hr; }
    updateLiveReadoutsUI();
  }

  function handleHrData(event){
    var value = event.target.value;
    var flags = value.getUint8(0);
    var hr = (flags & 0x1) ? value.getUint16(1, true) : value.getUint8(1);
    liveReadouts.hr = hr;
    updateLiveReadoutsUI();
  }

  async function ftmsWrite(opcode, paramBytes){
    if(!trainerState.controlChar) return;
    var buf = new Uint8Array(1 + (paramBytes ? paramBytes.length : 0));
    buf[0] = opcode;
    if(paramBytes) buf.set(paramBytes, 1);
    await trainerState.controlChar.writeValue(buf);
  }
  async function requestControl(){ try{ await ftmsWrite(0x00); trainerState.hasControl = true; }catch(e){} }
  async function startTrainer(){ try{ await ftmsWrite(0x07); }catch(e){} }
  // FTMS opcode 0x08 takes a parameter: 0x01 = stop, 0x02 = pause.
  async function pauseTrainer(){ try{ await ftmsWrite(0x08, [0x02]); }catch(e){} }
  async function stopTrainer(){
    try{
      await ftmsWrite(0x08, [0x01]);
      // Hand resistance back to the rider so the trainer isn't left pinned
      // at the last ERG target after the session ends.
      await ftmsWrite(0x04, [0, 0]); // set target resistance level 0
    }catch(e){}
  }
  async function setErgTarget(w){
    var val = Math.round(w);
    var buf = new Uint8Array(2);
    new DataView(buf.buffer).setInt16(0, val, true);
    try{ await ftmsWrite(0x05, buf); }catch(e){}
  }

  // Not every trainer puts FTMS in its advertising packet, so if the filtered
  // picker turns up nothing, fall back to showing all devices and let the user
  // pick by name — the service lookup after connecting still verifies FTMS.
  async function requestTrainerDevice(){
    try{
      return await navigator.bluetooth.requestDevice({
        filters:[{services:[FTMS_SERVICE]}],
        optionalServices:[FTMS_SERVICE]
      });
    }catch(e){
      if(e && e.name === 'NotFoundError' && !/cancel/i.test(e.message || '')){
        return await navigator.bluetooth.requestDevice({
          acceptAllDevices:true,
          optionalServices:[FTMS_SERVICE]
        });
      }
      throw e;
    }
  }

  // ---- GATT attach: the part shared by first connect and every reconnect ----
  async function attachTrainer(device){
    var server = await device.gatt.connect();
    var service = await server.getPrimaryService(FTMS_SERVICE);
    var bikeChar = await service.getCharacteristic(INDOOR_BIKE_DATA_CHAR);
    await bikeChar.startNotifications();
    bikeChar.addEventListener('characteristicvaluechanged', handleBikeData);
    try{
      trainerState.controlChar = await service.getCharacteristic(FTMS_CONTROL_POINT);
      try{ await trainerState.controlChar.startNotifications(); }catch(e){}
    }catch(e){ trainerState.controlChar = null; }
    trainerState.connected = true;
    trainerState.reconnecting = false;
    trainerState.device = device;
    rememberDevice(TRAINER_DEV_KEY, device);
    if(!device._ftpHooked){
      device._ftpHooked = true;
      device.addEventListener('gattserverdisconnected', function(){ onTrainerDropped(device); });
    }
    // Player already open (mid-workout, or connected from the start screen):
    // take ERG and put the current target on. Not while paused — resuming
    // does that itself once the rider is pedalling again.
    if(liveState.active && !liveState.paused && trainerState.controlChar){
      requestControl().then(startTrainer).then(applyCurrentTarget);
    }
    updateDeviceUI();
  }

  async function attachHr(device){
    var server = await device.gatt.connect();
    var service = await server.getPrimaryService(HR_SERVICE);
    var ch = await service.getCharacteristic(HR_MEASUREMENT_CHAR);
    await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', handleHrData);
    hrState.connected = true;
    hrState.reconnecting = false;
    hrState.device = device;
    rememberDevice(HR_DEV_KEY, device);
    if(!device._ftpHooked){
      device._ftpHooked = true;
      device.addEventListener('gattserverdisconnected', function(){ onHrDropped(device); });
    }
    updateDeviceUI();
  }

  // ---- auto-reconnect after a drop ----
  // BLE drops are routine: interference, a phone notification, the trainer
  // hiccupping. We still hold the BluetoothDevice, and gatt.connect() on it
  // needs no picker, so retry quietly with backoff before giving up.
  var RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000];
  function sleepMs(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  async function reconnectLoop(state, device, attach, label){
    if(state.userDisconnected){ state.userDisconnected = false; return; }
    state.reconnecting = true;
    updateDeviceUI();
    for(var i = 0; i < RECONNECT_DELAYS_MS.length; i++){
      await sleepMs(RECONNECT_DELAYS_MS[i]);
      if(state.connected || state.device !== device) return;   // reconnected or replaced meanwhile
      try{
        await attach(device);
        console.log(label + ' reconnected on attempt ' + (i + 1));
        return;
      }catch(e){
        console.log(label + ' reconnect attempt ' + (i + 1) + ' failed:', e && e.message);
      }
    }
    state.reconnecting = false;
    updateDeviceUI();
    els.bleWarning.style.display = 'block';
    els.bleWarning.textContent = label + ' dropped and couldn’t be reached again — check it’s still powered and press Reconnect.';
  }

  function onTrainerDropped(device){
    trainerState.connected = false;
    trainerState.controlChar = null;
    updateDeviceUI();
    reconnectLoop(trainerState, device, attachTrainer, 'Trainer');
  }
  function onHrDropped(device){
    hrState.connected = false;
    updateDeviceUI();
    reconnectLoop(hrState, device, attachHr, 'HR monitor');
  }

  // ---- auto-connect on open ----
  // The first connection on a machine always goes through the browser's
  // picker — a page can't touch a Bluetooth device the rider hasn't chosen.
  // But Chrome can remember the choice: navigator.bluetooth.getDevices()
  // returns previously permitted devices without a prompt, and
  // watchAdvertisements() reports when one is powered on and in range, at
  // which point gatt.connect() needs no picker. So from the second session
  // on: open the app, switch the trainer on, it's connected.
  //
  // Both calls are still behind a flag (checked against Chrome 152):
  //   chrome://flags/#enable-web-bluetooth-new-permissions-backend
  // so this is feature-detected and silently absent where the flag is off —
  // the tiles then behave exactly as before. Confirmed on real hardware
  // (KICKR + TICKR, Windows, Chrome 152).
  var TRAINER_DEV_KEY = 'ftpPlan_trainerDev_v1';
  var HR_DEV_KEY = 'ftpPlan_hrDev_v1';
  var AUTO_LOOK_MS = 90000;   // how long to listen for a remembered device

  function rememberDevice(key, device){
    try{ if(device && device.id) localStorage.setItem(key, device.id); }catch(e){}
  }
  function rememberedId(key){
    try{ return localStorage.getItem(key) || null; }catch(e){ return null; }
  }
  function autoConnectSupported(){
    return bleAvailable() && typeof navigator.bluetooth.getDevices === 'function' &&
           !!(window.BluetoothDevice && BluetoothDevice.prototype.watchAdvertisements);
  }

  async function autoConnectRemembered(){
    if(!autoConnectSupported()) return;
    var wantTrainer = rememberedId(TRAINER_DEV_KEY), wantHr = rememberedId(HR_DEV_KEY);
    if(!wantTrainer && !wantHr) return;
    var devices;
    try{ devices = await navigator.bluetooth.getDevices(); }
    catch(e){ console.log('getDevices failed:', e && e.message); return; }
    devices.forEach(function(d){
      if(d.id === wantTrainer) listenAndAttach(d, trainerState, attachTrainer, 'Trainer');
      if(d.id === wantHr)      listenAndAttach(d, hrState, attachHr, 'HR monitor');
    });
  }

  // Listen for the device's advertisements, connect on the first one, give
  // up quietly after AUTO_LOOK_MS. Clicking the tile meanwhile cancels the
  // listen and opens the picker as usual.
  //
  // The watch is re-armed rather than trusted: Windows stops scanning while
  // a GATT connection is being made, so the moment the trainer connects the
  // watch listening for the strap is killed underneath it (Chrome either
  // rejects it or just goes quiet). Treating that as final meant only one
  // device ever auto-connected per open. So every couple of seconds, if the
  // watch isn't running, start it again, until something is seen or the
  // deadline passes.
  var WATCH_POLL_MS = 2000;
  async function listenAndAttach(device, state, attach, label){
    if(state.connected || state.busy || state.looking) return;
    var done = false, current = null, armed = false;
    var deadline = Date.now() + AUTO_LOOK_MS;
    function finish(){
      if(done) return;
      done = true;
      if(current && !current.signal.aborted) current.abort();
      if(state.looking === job) state.looking = null;
      updateDeviceUI();
    }
    var job = {cancel:finish};
    state.looking = job;
    updateDeviceUI();
    device.addEventListener('advertisementreceived', async function(){
      if(done) return;
      finish();
      setChipBusy(state, true);
      try{ await attach(device); console.log(label + ' auto-connected'); }
      catch(e){ console.log(label + ' auto-connect failed (' + ((e && e.name) || '?') + '): ' + (e && e.message)); }
      setChipBusy(state, false);
    });
    while(!done && Date.now() < deadline){
      // Chrome reports whether the watch is live; fall back to our own flag
      // where it doesn't.
      var live = typeof device.watchingAdvertisements === 'boolean' ? device.watchingAdvertisements : armed;
      if(!live){
        current = new AbortController();
        try{
          await device.watchAdvertisements({signal:current.signal});
          armed = true;
          console.log(label + ': listening');
        }catch(e){
          armed = false;
          if(!done) console.log(label + ': watch failed (' + ((e && e.name) || '?') + '): ' + (e && e.message) + ' — will retry');
        }
      }
      await sleepMs(WATCH_POLL_MS);
    }
    if(!done){
      console.log(label + ' not seen within ' + Math.round(AUTO_LOOK_MS / 1000) + ' s; stopped listening');
      finish();
    }
  }
  function stopLooking(state){
    if(state.looking) state.looking.cancel();
  }

  // ---- connect buttons ----
  // One button per device does both jobs: "Connect trainer" when there's
  // nothing attached, the device's name once there is (hover: Disconnect).
  // Within a session the BluetoothDevice is kept, so reconnecting after a
  // deliberate disconnect skips the picker; a fresh page load always picks.
  async function connectTrainer(){
    if(!bleAvailable()) return;
    stopLooking(trainerState);   // the rider is choosing; stop waiting for the remembered one
    try{
      setChipBusy(trainerState, true);
      if(trainerState.device){
        try{ await attachTrainer(trainerState.device); setChipBusy(trainerState, false); return; }
        catch(e){ console.log('Held trainer not reachable, opening picker:', e && e.message); }
      }
      var device = await requestTrainerDevice();
      await attachTrainer(device);
      setChipBusy(trainerState, false);
    }catch(e){
      setChipBusy(trainerState, false);
      reportBleError('Trainer', e);
    }
  }

  async function connectHr(){
    if(!bleAvailable()) return;
    stopLooking(hrState);
    try{
      setChipBusy(hrState, true);
      if(hrState.device){
        try{ await attachHr(hrState.device); setChipBusy(hrState, false); return; }
        catch(e){ console.log('Held HR monitor not reachable, opening picker:', e && e.message); }
      }
      var device = await navigator.bluetooth.requestDevice({ filters:[{services:[HR_SERVICE]}] });
      await attachHr(device);
      setChipBusy(hrState, false);
    }catch(e){
      setChipBusy(hrState, false);
      reportBleError('HR monitor', e);
    }
  }

  function setChipBusy(state, busy){
    state.busy = busy;
    updateDeviceUI();
  }

  // A cancelled picker is a normal outcome, not an error worth shouting about;
  // anything else should be visible rather than buried in the console.
  function reportBleError(what, e){
    console.log(what + ' connection failed:', e);
    if(e && e.name === 'NotFoundError') return;
    els.bleWarning.style.display = 'block';
    els.bleWarning.textContent = what + ' didn’t connect: ' + ((e && e.message) || 'unknown error') +
      ' — check the device is awake, not paired to another app, and in range.';
  }

  // One device row: `name` is the left identity (device name once paired, else
  // the type), `action` is the right status/action, `dotClass` still feeds the
  // desktop head indicator.
  function deviceChipState(state, fallback){
    var name = (state.device && state.device.name) || fallback;
    if(state.connected)    return {name:name,     action:'Disconnect',    dotClass:'on', on:true};
    if(state.busy)         return {name:fallback, action:'Connecting…',   dotClass:'retry', busy:true};
    if(state.reconnecting) return {name:fallback, action:'Reconnecting…', dotClass:'retry', reconnecting:true};
    if(state.looking)      return {name:fallback, action:'Looking…',      dotClass:'retry', looking:true};
    return {name:fallback, action:'Connect', dotClass:'off', idle:true};
  }

  function paintDeviceButton(btn, nameEl, actionEl, s, longName){
    btn.classList.toggle('on', !!s.on);
    btn.classList.toggle('idle', !!s.idle);
    btn.classList.toggle('busy', !!s.busy || !!s.reconnecting || !!s.looking);
    btn.disabled = !!s.busy;
    btn.title = s.on ? (longName + ' connected — tap to disconnect')
              : s.looking ? ('Listening for your ' + (longName === 'Trainer' ? 'trainer' : longName) + ' — tap to pick a different one')
              : ('Connect ' + (longName === 'Trainer' ? 'trainer' : longName));
    btn.setAttribute('aria-label', btn.title);
    nameEl.textContent = s.name;
    actionEl.textContent = s.action;
  }

  // Keep the mobile connection bar's labels short: a device name past ~13
  // chars is trimmed with an ellipsis so three fit across a phone.
  function connShort(name){
    name = (name || '').trim();
    return name.length > 13 ? name.slice(0, 12).trim() + '…' : name;
  }

  function updateDeviceUI(){
    var t = deviceChipState(trainerState, 'Trainer');
    var h = deviceChipState(hrState, 'Heart Rate');
    paintDeviceButton(els.trainerBtn, els.trainerLabel, els.trainerAction, t, 'Trainer');
    paintDeviceButton(els.hrBtn, els.hrLabel, els.hrAction, h, 'HR monitor');
    // The desktop head connection indicator mirrors the trainer + HR dots
    // (Strava's dot is painted by updateStravaUI).
    if(els.connTrainerDot) els.connTrainerDot.className = 'device-dot ' + t.dotClass;
    if(els.connHrDot) els.connHrDot.className = 'device-dot ' + h.dotClass;
    if(els.connTrainerName) els.connTrainerName.textContent = connShort(t.name || 'Trainer');
    if(els.connHrName) els.connHrName.textContent = connShort(h.name || 'Heart rate');
    if(els.connStatus){
      els.connStatus.title = 'Trainer ' + (trainerState.connected ? 'on' : 'off') +
        ', heart rate ' + (hrState.connected ? 'on' : 'off') + ' - open menu';
    }
    // Mobile: the Menu tab wears a red dot when a ride device (trainer or HR)
    // isn't paired, so "not connected" is loud without a status bar.
    if(els.menuTabBadge) els.menuTabBadge.hidden = trainerState.connected && hrState.connected;
    refreshWaitingOverlay();
  }

  els.trainerBtn.addEventListener('click', function(){
    if(trainerState.connected && trainerState.device){
      trainerState.userDisconnected = true;   // don't auto-retry a deliberate disconnect
      trainerState.device.gatt.disconnect();
    } else {
      connectTrainer();
    }
  });
  els.hrBtn.addEventListener('click', function(){
    if(hrState.connected && hrState.device){
      hrState.userDisconnected = true;
      hrState.device.gatt.disconnect();
    } else {
      connectHr();
    }
  });
