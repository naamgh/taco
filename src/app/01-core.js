
  // Zone keys match library-gen.js so generated workouts drop straight in.
  var ZONES = {
    recovery: {label:'Recovery',   color:'var(--c-recovery)',  hex:'#454C60'},
    endurance:{label:'Endurance',  color:'var(--c-endurance)', hex:'#5B8DEF'},
    tempo:    {label:'Tempo',      color:'var(--c-tempo)',     hex:'#49B4B0'},
    sweetspot:{label:'Sweet Spot', color:'var(--c-sweetspot)', hex:'#E8B24D'},
    threshold:{label:'Threshold',  color:'var(--c-threshold)', hex:'#F2764A'},
    vo2:      {label:'VO2 Max',    color:'var(--c-vo2)',       hex:'#C77DFF'},
    anaerobic:{label:'Anaerobic',  color:'var(--c-anaerobic)', hex:'#FF5D75'},
    test:     {label:'Fitness test', color:'var(--c-test)',    hex:'#FF5D75'}
  };
  // Order used for the focus filter. Tests sit last and get a distinct chip.
  var FILTER_ZONES = ['endurance','tempo','sweetspot','threshold','vo2','anaerobic','test'];

  // Training Log page (log.html): the same app opened straight into Calendar +
  // Fitness, with no devices and no workout list. The build marks that copy's
  // <html> with data-mode="log" and data-app-url (where the full app lives).
  var LOG_MODE = document.documentElement.getAttribute('data-mode') === 'log';
  var APP_URL = document.documentElement.getAttribute('data-app-url') || './';
  var logDeskView = null;   // set by the desktop nav (10) so log mode (11) can open a view

  // Populated from library.json at startup.
  var WORKOUTS = [];
  var LIBRARY = null;

  // Block helpers ---------------------------------------------------
  // single: one segment held at a constant % of FTP.
  // ramp:   one segment sweeping linearly from pct to pctEnd (warm-ups,
  //         cool-downs and ramp tests — the shape most real workouts open with).
  // repeat: N reps of `work`, with `rest` between reps (and after the last rep
  //         too, if trailingRest is true).
  function single(zone, min, pct, label){ return {kind:'single', zone:zone, min:min, pct:pct, label:label}; }
  function ramp(zone, min, pct, pctEnd, label){
    return {kind:'single', zone:zone, min:min, pct:pct, pctEnd:pctEnd, label:label};
  }
  function repeat(reps, work, rest, trailingRest){
    return {kind:'repeat', reps:reps, work:work, rest:rest || null, trailingRest:!!trailingRest};
  }

  // A step ramps when it carries a pctEnd different from its starting pct.
  function isRamp(s){
    return s && s.pctEnd !== null && s.pctEnd !== undefined && s.pct !== null && s.pctEnd !== s.pct;
  }

  // The % of FTP a step asks for at a given fraction (0..1) through it.
  function pctAt(step, frac){
    if(!step || step.pct === null) return null;
    if(!isRamp(step)) return step.pct;
    var f = Math.max(0, Math.min(1, frac));
    return step.pct + (step.pctEnd - step.pct) * f;
  }

  // Expands blocks into a flat list of steps (used for the timeline graph
  // and total-time math) — identical shape to the old flat interval list.
  // `ri` is the index of the interval-table row this step came from. The
  // timeline expands every rep while the table collapses them, so all five
  // work bars of a 5x set point at the same row — which is what lets hovering
  // a bar light up its row. The counter mirrors renderIntervalTable's row
  // order exactly: single = 1 row, repeat = work [+ rest] + the "x N sets" note.
  function expandBlocks(blocks){
    var out = [], ri = 0;
    blocks.forEach(function(b){
      // `prep` (warm-up, primers, cool-down) and `work` (a repeat's on-leg)
      // are carried through so the ride analysis can tell the main set apart.
      // A leg's coaching cue is one string for every rep, or an array with
      // one entry per rep.
      function cueFor(leg, i){
        if(!leg || leg.cue === undefined) return undefined;
        return Array.isArray(leg.cue) ? leg.cue[i] : leg.cue;
      }
      if(b.kind === 'single'){
        out.push({type:b.zone, min:b.min, pct:b.pct, pctEnd:b.pctEnd, label:b.label, prep:!!b.prep, ri:ri, cue:b.cue});
        ri += 1;
        return;
      }
      var workRow = ri, restRow = b.rest ? ri + 1 : -1;
      for(var i=0; i<b.reps; i++){
        out.push({type:b.work.zone, min:b.work.min, pct:b.work.pct, pctEnd:b.work.pctEnd, label:b.work.label + ' ' + (i+1), prep:!!b.prep, work:true, ri:workRow, rep:i+1, reps:b.reps, cue:cueFor(b.work, i)});
        if(b.rest && (i < b.reps - 1 || b.trailingRest)){
          out.push({type:b.rest.zone, min:b.rest.min, pct:b.rest.pct, pctEnd:b.rest.pctEnd, label:b.rest.label, prep:!!b.prep, ri:restRow, rep:i+1, reps:b.reps, cue:cueFor(b.rest, i)});
        }
      }
      ri += b.rest ? 3 : 2;
    });
    return out;
  }

  var FTP_KEY = 'ftpPlan_ftp_v1';

  // null until the rider sets one. A made-up default would render plausible
  // watt targets nobody chose, which is worse than showing nothing: the
  // numbers look authoritative and are wrong by whatever their real FTP is.
  var ftp = null;
  try{
    var storedFtp = parseInt(localStorage.getItem(FTP_KEY), 10);
    if(storedFtp && storedFtp > 0) ftp = storedFtp;
  }catch(e){}
  function hasFtp(){ return ftp !== null && ftp > 0; }

  // Returns null when FTP is unknown; every caller renders that as an em dash.
  function watts(pct){ return hasFtp() ? Math.round(ftp * pct / 100) : null; }
  function wattsText(pct){ var w = watts(pct); return w === null ? '—' : w + ' W'; }
  // The workout structure line shows real watts once FTP is known ("2 x 16 min
  // @ 210w"), falling back to the stored "% FTP" string when it isn't.
  function shortLabel(wo){
    var s = (wo && wo.short) || '';
    if(!hasFtp()) return s;
    return s.replace(/(\d+)%/g, function(m, p){ var w = watts(+p); return w == null ? m : w + 'w'; });
  }

  // Max heart rate: optional, drives the HR-zone chart on the summary.
  var MAXHR_KEY = 'ftpPlan_maxhr_v1';
  var maxHr = null;
  try{
    var storedHr = parseInt(localStorage.getItem(MAXHR_KEY), 10);
    if(storedHr && storedHr >= 120 && storedHr <= 230) maxHr = storedHr;
  }catch(e){}

  // Body weight in kg: optional, kept to one decimal, drives the W/kg readout.
  var WEIGHT_KEY = 'ftpPlan_weight_v1';
  var weight = null;
  try{
    var storedWt = parseFloat(localStorage.getItem(WEIGHT_KEY));
    if(storedWt && storedWt >= 30 && storedWt <= 200) weight = Math.round(storedWt * 10) / 10;
  }catch(e){}
  function hasWeight(){ return weight !== null && weight > 0; }


  var els = {
    ftpInput: document.getElementById('ftpInput'),
    maxHrInput: document.getElementById('maxHrInput'),
    weightInput: document.getElementById('weightInput'),
    menuRider: document.querySelector('.menu-rider'),
    findModal: document.getElementById('findModal'),
    findDur: document.getElementById('findDur'),
    findZone: document.getElementById('findZone'),
    findSpice: document.getElementById('findSpice'),
    findClear: document.getElementById('findClear'),
    findApply: document.getElementById('findApply'),
    keypadOverlay: document.getElementById('keypadOverlay'),
    kpLabel: document.getElementById('kpLabel'),
    kpValue: document.getElementById('kpValue'),
    kpUnit: document.getElementById('kpUnit'),
    kpDot: document.getElementById('kpDot'),
    kpGrid: document.getElementById('kpGrid'),
    kpMinus: document.getElementById('kpMinus'),
    kpPlus: document.getElementById('kpPlus'),
    kpSet: document.getElementById('kpSet'),
    kpCancel: document.getElementById('kpCancel'),
    menuWkg: document.getElementById('menuWkg'),
    hrZoneTable: document.getElementById('hrZoneTable'),
    summaryPies: document.getElementById('summaryPies'),
    summaryStravaText: document.getElementById('summaryStravaText'),
    workoutCards: document.getElementById('workoutCards'),
    zoneTable: document.getElementById('zoneTable'),
    durFilter: document.getElementById('durFilter'),
    zoneFilter: document.getElementById('zoneFilter'),
    spiceFilter: document.getElementById('spiceFilter'),
    shapeFilter: document.getElementById('shapeFilter'),
    shapeAny: document.getElementById('shapeAny'),
    durVal: document.getElementById('durVal'),
    zoneVal: document.getElementById('zoneVal'),
    spiceVal: document.getElementById('spiceVal'),
    spiceLabel: document.getElementById('spiceLabel'),
    durSegLabels: document.getElementById('durSegLabels'),
    zoneSegLabels: document.getElementById('zoneSegLabels'),
    spiceSegLabels: document.getElementById('spiceSegLabels'),
    searchBox: document.getElementById('searchBox'),
    appShell: document.getElementById('appShell'),
    mTabs: document.getElementById('mTabs'),
    filterSheet: document.getElementById('filterSheet'),
    filterSheetBody: document.getElementById('filterSheetBody'),
    trainingSheet: document.getElementById('trainingSheet'),
    menuSheet: document.getElementById('menuSheet'),
    menuSheetBody: document.getElementById('menuSheetBody'),
    filtersFab: document.getElementById('filtersFab'),
    filtersFabBadge: document.getElementById('filtersFabBadge'),
    sidebar: document.getElementById('sidebar'),
    menuBtn: document.getElementById('menuBtn'),
    sideMenu: document.getElementById('sideMenu'),
    trendsBtn: document.getElementById('trendsBtn'),
    trendsModal: document.getElementById('trendsModal'),
    trendsRange: document.getElementById('trendsRange'),
    trendsBody: document.getElementById('trendsBody'),
    trendsCloseBtn: document.getElementById('trendsCloseBtn'),
    formPop: document.getElementById('formPop'),
    planPop: document.getElementById('planPop'),
    listPane: document.getElementById('listPane'),
    listZero: document.getElementById('listZero'),
    listZeroGo: document.getElementById('listZeroGo'),
    listZeroBrowse: document.getElementById('listZeroBrowse'),
    lzCount: document.getElementById('lzCount'),
    detailPane: document.getElementById('detailPane'),
    detailHead: document.getElementById('detailHead'),
    detailBody: document.getElementById('detailBody'),
    detailBack: document.getElementById('detailBack'),
    viewNav: document.getElementById('viewNav'),
    viewPrev: document.getElementById('viewPrev'),
    viewStart: document.getElementById('viewStart'),
    viewNext: document.getElementById('viewNext'),
    menuTabBadge: document.getElementById('menuTabBadge'),
    filtersToggle: document.getElementById('filtersToggle'),
    listFilters: document.getElementById('listFilters'),
    connStatus: document.getElementById('connStatus'),
    connTrainerDot: document.getElementById('connTrainerDot'),
    connHrDot: document.getElementById('connHrDot'),
    connStravaDot: document.getElementById('connStravaDot'),
    connTrainerName: document.getElementById('connTrainerName'),
    connHrName: document.getElementById('connHrName'),
    connStravaName: document.getElementById('connStravaName'),
    searchBtn: document.getElementById('searchBtn'),
    sortBtn: document.getElementById('sortBtn'),
    sortMenu: document.getElementById('sortMenu'),
    starFilterBtn: document.getElementById('starFilterBtn'),
    resetFilters: document.getElementById('resetFilters'),
    zonePopFtp: document.getElementById('zonePopFtp'),
    zonePop: document.getElementById('zonePop'),
    ftpHelp: document.getElementById('ftpHelp'),
    listActions: document.querySelector('.list-actions'),
    resultCount: document.getElementById('resultCount'),
    noResults: document.getElementById('noResults'),
    trainerBtn: document.getElementById('trainerBtn'),
    trainerAction: document.getElementById('trainerAction'),
    hrAction: document.getElementById('hrAction'),
    themeToggle: document.getElementById('themeToggle'),
    stravaLabel: document.getElementById('stravaLabel'),
    stravaAction: document.getElementById('stravaAction'),
    stravaBtn: document.getElementById('stravaBtn'),
    summaryStravaBtn: document.getElementById('summaryStravaBtn'),
    summaryStravaLink: document.getElementById('summaryStravaLink'),
    summaryStravaStatus: document.getElementById('summaryStravaStatus'),
    guideBtn: document.getElementById('guideBtn'),
    guidePop: document.getElementById('guidePop'),
    waitingDevices: document.getElementById('waitingDevices'),
    wdWarn: document.getElementById('wdWarn'),
    wdTrainerText: document.getElementById('wdTrainerText'),
    wdTrainerBtn: document.getElementById('wdTrainerBtn'),
    wdHrText: document.getElementById('wdHrText'),
    wdHrBtn: document.getElementById('wdHrBtn'),
    trainerLabel: document.getElementById('trainerLabel'),
    hrBtn: document.getElementById('hrBtn'),
    hrLabel: document.getElementById('hrLabel'),
    bleWarning: document.getElementById('bleWarning'),
    livePlayer: document.getElementById('livePlayer'),
    liveWorkoutName: document.getElementById('liveWorkoutName'),
    liveSegmentLabel: document.getElementById('liveSegmentLabel'),
    trPower: document.getElementById('trPower'),
    trPowerBar: document.getElementById('trPowerBar'),
    trIntervalTime: document.getElementById('trIntervalTime'),
    trHr: document.getElementById('trHr'),
    trTarget: document.getElementById('trTarget'),
    trIntensity: document.getElementById('trIntensity'),
    liveIntensity: document.getElementById('liveIntensity'),
    intMinus: document.getElementById('intMinus'),
    intPlus: document.getElementById('intPlus'),
    liveRest: document.getElementById('liveRest'),
    restMinus: document.getElementById('restMinus'),
    restPlus: document.getElementById('restPlus'),
    trRest: document.getElementById('trRest'),
    liveAvgRow: document.getElementById('liveAvgRow'),
    avgPower: document.getElementById('avgPower'),
    avgHr: document.getElementById('avgHr'),
    avgCad: document.getElementById('avgCad'),
    trGrid: document.getElementById('trGrid'),
    rcLanding: document.getElementById('rcLanding'),
    settingsBtn: document.getElementById('settingsBtn'),
    liveFullscreenBtn: document.getElementById('liveFullscreenBtn'),
    liveSettings: document.getElementById('liveSettings'),
    settingsClose: document.getElementById('settingsClose'),
    layoutOpts: document.getElementById('layoutOpts'),
    trTotalTime: document.getElementById('trTotalTime'),
    trCadence: document.getElementById('trCadence'),
    liveTestNote: document.getElementById('liveTestNote'),
    liveCue: document.getElementById('liveCue'),
    liveWaiting: document.getElementById('liveWaiting'),
    waitingWk: document.getElementById('waitingWk'),
    waitingMetaText: document.getElementById('waitingMetaText'),
    waitingSw: document.getElementById('waitingSw'),
    waitingIcon: document.getElementById('waitingIcon'),
    waitingTitle: document.getElementById('waitingTitle'),
    waitingSub: document.getElementById('waitingSub'),
    waitingCountdown: document.getElementById('waitingCountdown'),
    waitingReadouts: document.getElementById('waitingReadouts'),
    waitingCadence: document.getElementById('waitingCadence'),
    waitingCadenceChip: document.getElementById('waitingCadenceChip'),
    waitingPower: document.getElementById('waitingPower'),
    waitingPowerChip: document.getElementById('waitingPowerChip'),
    waitingStartBtn: document.getElementById('waitingStartBtn'),
    waitingCancelBtn: document.getElementById('waitingCancelBtn'),
    liveChartCanvas: document.getElementById('liveChartCanvas'),
    liveNext: document.getElementById('liveNext'),
    liveEndBtn: document.getElementById('liveEndBtn'),
    liveSkipBtn: document.getElementById('liveSkipBtn'),
    livePauseBtn: document.getElementById('livePauseBtn'),
    summaryModal: document.getElementById('summaryModal'),
    summaryWorkoutName: document.getElementById('summaryWorkoutName'),
    summaryGrid: document.getElementById('summaryGrid'),
    ftpEstimate: document.getElementById('ftpEstimate'),
    summaryFitBtn: document.getElementById('summaryFitBtn'),
    openShareBtn: document.getElementById('openShareBtn'),
    summaryCloseBtn: document.getElementById('summaryCloseBtn'),
    summaryDeleteBtn: document.getElementById('summaryDeleteBtn'),
    summaryTitle: document.getElementById('summaryTitle'),
    rpeRow: document.getElementById('rpeRow'),
    logBtn: document.getElementById('logBtn'),
    logModal: document.getElementById('logModal'),
    logMonth: document.getElementById('logMonth'),
    logGrid: document.getElementById('logGrid'),
    logDock: document.getElementById('logDock'),
    logAdd: document.getElementById('logAdd'),
    logPrev: document.getElementById('logPrev'),
    logNext: document.getElementById('logNext'),
    logImportStrava: document.getElementById('logImportStrava'),
    cloudStatus: document.getElementById('cloudStatus'),
    logCloseBtn: document.getElementById('logCloseBtn')
  };

  var selectedKey = null;    // workout shown in the detail pane
  var visibleKeys = [];      // keys currently in the list, for arrow navigation
