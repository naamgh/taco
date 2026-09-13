/* =====================================================================
   Workout library generator
   ---------------------------------------------------------------------
   Produces the workout library as data, so it stays reproducible: change
   a band or a rep range here and rebuild, rather than editing hundreds of
   entries by hand.

   Spice (1-5 chillies) is intensity position WITHIN a zone's band, not
   overall difficulty — low-end sweet spot is 1 chilli, top-end sweet spot
   is 5. Duration is a separate filter, so it is deliberately not folded
   into the spice rating; keeping the two axes independent makes filtering
   behave predictably.

   Open library-builder.html to run this and download library.json.
   ===================================================================== */

(function(global){
  'use strict';

  // ---------------------------------------------------------------
  // Zones. `band` is the %FTP range the work intervals sweep across as
  // spice goes 1 -> 5. `rank` orders them by intensity for classification.
  // ---------------------------------------------------------------
  var ZONES = {
    test:      {label:'Fitness test', rank:-1, band:[100, 100], lo:-1, hi:-1},
    recovery:  {label:'Recovery',   rank:0, band:[45, 55],   lo:0,   hi:56},
    endurance: {label:'Endurance',  rank:1, band:[62, 75],   lo:56,  hi:76},
    tempo:     {label:'Tempo',      rank:2, band:[78, 87],   lo:76,  hi:88},
    sweetspot: {label:'Sweet Spot', rank:3, band:[88, 94],   lo:88,  hi:95},
    threshold: {label:'Threshold',  rank:4, band:[96, 104],  lo:95,  hi:106},
    vo2:       {label:'VO₂max',     rank:5, band:[108, 120], lo:106, hi:126},
    anaerobic: {label:'Anaerobic',  rank:6, band:[135, 170], lo:126, hi:999}
  };

  var ZONE_ORDER = ['anaerobic','vo2','threshold','sweetspot','tempo','endurance','recovery'];

  // Target %FTP for a given spice level (1-5) in a zone.
  function spicePct(zoneKey, spice){
    var b = ZONES[zoneKey].band;
    var f = (spice - 1) / 4;
    return Math.round(b[0] + (b[1] - b[0]) * f);
  }

  // Which zone a given %FTP falls in.
  function zoneOf(pct){
    for(var i = 0; i < ZONE_ORDER.length; i++){
      var k = ZONE_ORDER[i], z = ZONES[k];
      if(pct >= z.lo && pct < z.hi) return k;
    }
    return 'recovery';
  }

  // ---------------------------------------------------------------
  // Block helpers — same shape the app consumes.
  // ---------------------------------------------------------------
  function single(zone, min, pct, label){ return {kind:'single', zone:zone, min:min, pct:pct, label:label}; }
  function ramp(zone, min, pct, pctEnd, label){
    return {kind:'single', zone:zone, min:min, pct:pct, pctEnd:pctEnd, label:label};
  }
  function repeat(reps, work, rest, trailingRest){
    return {kind:'repeat', reps:reps, work:work, rest:rest || null, trailingRest:!!trailingRest};
  }
  function leg(zone, min, pct, label){ return {zone:zone, min:min, pct:pct, label:label}; }

  function expandBlocks(blocks){
    var out = [];
    blocks.forEach(function(b){
      if(b.kind === 'single'){
        out.push({type:b.zone, min:b.min, pct:b.pct, pctEnd:b.pctEnd, label:b.label, prep:b.prep});
        return;
      }
      for(var i = 0; i < b.reps; i++){
        out.push({type:b.work.zone, min:b.work.min, pct:b.work.pct, pctEnd:b.work.pctEnd, label:b.work.label + ' ' + (i+1), prep:b.prep});
        if(b.rest && (i < b.reps - 1 || b.trailingRest)){
          out.push({type:b.rest.zone, min:b.rest.min, pct:b.rest.pct, pctEnd:b.rest.pctEnd, label:b.rest.label, prep:b.prep});
        }
      }
    });
    return out;
  }

  // ---------------------------------------------------------------
  // Warm-up / cool-down sized to the session. Longer sessions get a
  // longer, more gradual opener the way real workouts do.
  // ---------------------------------------------------------------
  // `prep:true` marks preparation rather than the session's actual work.
  // The classifier excludes it, which is what keeps a short anaerobic session
  // from being averaged down by its own primers.
  function prep(b){ b.prep = true; return b; }

  function cooldown(totalMin){
    var m = totalMin <= 35 ? 4 : totalMin <= 50 ? 7 : totalMin <= 70 ? 8 : 10;
    return {min:m, block:prep(ramp('recovery', m, 58, 40, 'Cool-down'))};
  }

  // ---------------------------------------------------------------
  // Openers: warm-up ramp, optional primers, and a settle.
  //
  // Follows the evidence-based shape (Bishop; Roadman's protocol guide):
  // a progressive ramp, then for hard sessions two or three short
  // supra-threshold efforts, then several minutes easy BEFORE the first
  // working interval. That settle is the part that's easy to forget — an
  // earlier version ran the last primer straight into the first rep.
  //
  // Several variants exist so the library doesn't open every session the
  // same way. The variant is chosen deterministically from a seed, so a
  // given workout always gets the same opener across regenerations.
  // ---------------------------------------------------------------
  function rampMin(totalMin){
    return totalMin <= 35 ? 6 : totalMin <= 50 ? 9 : totalMin <= 70 ? 11 : totalMin <= 95 ? 13 : 15;
  }

  // Ramp shapes.
  var RAMPS = [
    function(m, top){ return [prep(ramp('endurance', m, 45, top, 'Warm-up'))]; },
    // gentler first half, then hold near the top
    function(m, top){
      var a = Math.max(3, m - 3);
      return [prep(ramp('endurance', a, 45, top - 6, 'Warm-up')), prep(single('endurance', 3, top, 'Hold'))];
    },
    // stepped
    function(m, top){
      var s = Math.max(2, Math.round(m / 3));
      return [prep(single('recovery', s, 50, 'Easy')),
              prep(single('endurance', s, Math.round((50 + top) / 2), 'Building')),
              prep(single('endurance', m - 2 * s, top, 'Warm-up'))];
    }
  ];

  // Primer shapes for hard sessions. Each returns {min, blocks}; every one
  // ends with a settle so the first rep starts from easy spinning.
  var PRIMERS = [
    // classic: 3 x 30 s hard, easy between
    function(pct){ return {min:6, blocks:[
      prep(repeat(3, leg('vo2', 0.5, 118, 'Primer'), leg('recovery', 1, 50, 'Easy'), true)),
      prep(single('recovery', 1.5, 50, 'Settle'))]}; },
    // openers at the intensity of the first interval (20 s each)
    function(pct){ var p = Math.max(pct, 100); return {min:6, blocks:[
      prep(repeat(2, leg('threshold', 20/60, p, 'Opener'), leg('recovery', 1, 50, 'Easy'), true)),
      prep(single('recovery', 6 - 2 * (20/60 + 1), 50, 'Settle'))]}; },
    // two longer, gentler primers
    function(pct){ return {min:7, blocks:[
      prep(repeat(2, leg('vo2', 1, 106, 'Primer'), leg('recovery', 1.5, 50, 'Easy'), true)),
      prep(single('recovery', 2, 50, 'Settle'))]}; },
    // step-up touch: tempo then just under threshold, then settle
    function(pct){ return {min:7, blocks:[
      prep(single('tempo', 2, 85, 'Step up')), prep(single('threshold', 1, 96, 'Touch')),
      prep(single('recovery', 4, 50, 'Settle'))]}; },
    // single threshold touch (the 20-minute-test style)
    function(pct){ return {min:6, blocks:[
      prep(single('sweetspot', 3, 90, 'Threshold touch')),
      prep(single('recovery', 3, 50, 'Settle'))]}; }
  ];

  // Light primers for sweet spot: enough to open the legs, not enough to
  // dig in before sub-threshold work.
  var SS_PRIMERS = [
    function(){ return {min:4, blocks:[
      prep(single('tempo', 2, 84, 'Step up')), prep(single('recovery', 2, 50, 'Settle'))]}; },
    function(){ return {min:4, blocks:[
      prep(repeat(2, leg('sweetspot', 0.5, 92, 'Opener'), leg('recovery', 1, 50, 'Easy'), true)),
      prep(single('recovery', 1, 50, 'Settle'))]}; },
    function(){ return {min:0, blocks:[]}; }   // ramp only
  ];

  // Spin-ups for easy sessions: short high-cadence bursts at moderate power.
  var EASY_PRIMERS = [
    function(){ return {min:3, blocks:[
      prep(repeat(3, leg('tempo', 10/60, 80, 'Spin-up'), leg('endurance', 50/60, 62, 'Easy'), true))]}; },
    function(){ return {min:0, blocks:[]}; }
  ];

  function opener(totalMin, zoneKey, targetPct, seed){
    var rank = ZONES[zoneKey].rank;
    var m = rampMin(totalMin);
    var top = rank >= 4 ? 76 : rank === 3 ? 72 : 68;
    var blocks = RAMPS[seed % RAMPS.length](m, top).slice();
    var pr;
    if(totalMin <= 35){
      // Short slot: ramp plus a brief settle, no primers.
      pr = {min:1, blocks:[prep(single('recovery', 1, 50, 'Settle'))]};
    } else if(rank >= 4){
      pr = PRIMERS[(seed >> 2) % PRIMERS.length](targetPct);
    } else if(rank === 3){
      pr = SS_PRIMERS[(seed >> 2) % SS_PRIMERS.length]();
    } else {
      pr = EASY_PRIMERS[(seed >> 2) % EASY_PRIMERS.length]();
    }
    return {min: m + pr.min, blocks: blocks.concat(pr.blocks)};
  }

  // ---------------------------------------------------------------
  // Structures. Each takes a work-time budget in minutes and the target
  // %FTP, and returns {blocks, short, workMin, structure}.
  // ---------------------------------------------------------------

  // N x M minutes at target, with recovery between. Short reps paired with a
  // short recovery keep the density high rather than turning into a rest-heavy
  // session — that's the point of the 3-8 minute shapes.
  function classicReps(zoneKey, pct, budget, repMin, restMin){
    var reps = Math.max(2, Math.floor((budget + restMin) / (repMin + restMin)));
    var work = leg(zoneKey, repMin, pct, ZONES[zoneKey].label === 'VO₂max' ? 'VO₂' : ZONES[zoneKey].label);
    var rest = leg('recovery', restMin, 52, 'Recovery');
    var tight = restMin <= 2 && repMin <= 8;
    return {
      blocks: [repeat(reps, work, rest)],
      short: reps + ' × ' + repMin + ' min @ ' + pct + '%' + (tight ? " / " + restMin + "' rest" : ''),
      workMin: reps * repMin,
      structure: repMin <= 8 ? 'short reps' : 'reps'
    };
  }

  // One or two long continuous efforts.
  function longBlocks(zoneKey, pct, budget, restMin){
    var reps = budget >= 50 ? 3 : budget >= 32 ? 2 : 1;
    // Recoveries between reps come out of the same budget.
    var repMin = Math.round((budget - (reps - 1) * restMin) / reps);
    var work = leg(zoneKey, repMin, pct, 'Sustained');
    var rest = leg('recovery', restMin, 52, 'Recovery');
    return {
      blocks: reps === 1 ? [single(zoneKey, repMin, pct, 'Sustained')] : [repeat(reps, work, rest)],
      short: (reps === 1 ? repMin + ' min' : reps + ' × ' + repMin + ' min') + ' @ ' + pct + '%',
      workMin: reps * repMin,
      structure: 'long'
    };
  }

  // Alternating just under / just over the target — the over/under shape.
  function overUnder(zoneKey, pct, budget, blockMin, underMin, overMin){
    // Weight the swing so the time-average lands exactly on the target:
    // underMin * down === overMin * up. Otherwise the session drifts below
    // its nominal intensity and classifies a rating light.
    var down = 2 * overMin, up = 2 * underMin;
    var over = Math.min(pct + up, 115);
    var under = Math.max(pct - down, 75);
    var pairs = Math.max(2, Math.round(blockMin / (underMin + overMin)));
    var perBlock = pairs * (underMin + overMin);
    // Budget has to cover the 5-min recovery between blocks too, or the
    // session overshoots its slot and gets dropped at the duration snap.
    var blocksCount = Math.max(1, Math.floor((budget + 5) / (perBlock + 5)));
    var out = [];
    for(var i = 0; i < blocksCount; i++){
      out.push(repeat(pairs, leg(zoneKey, underMin, under, 'Under'), leg(zoneKey, overMin, over, 'Over'), true));
      if(i < blocksCount - 1) out.push(single('recovery', 5, 52, 'Recovery'));
    }
    return {
      blocks: out,
      short: blocksCount + ' × ' + perBlock + " min — " + underMin + "'@" + under + '% / ' + overMin + "'@" + over + '%',
      workMin: blocksCount * perBlock,
      structure: 'overunder'
    };
  }

  // Short, sharp on/off work. 30/30s and 40/20s.
  function microIntervals(zoneKey, pct, budget, onSec, offSec) {
    var pairSec = onSec + offSec;
    var setMin = 5;
    var perSet = Math.round((setMin * 60) / pairSec);
    var sets = Math.max(2, Math.floor(budget / (setMin + 5)));
    var out = [];
    for(var i = 0; i < sets; i++){
      out.push(repeat(perSet,
        leg(zoneKey, onSec / 60, pct, 'On'),
        leg('recovery', offSec / 60, 50, 'Off'), true));
      if(i < sets - 1) out.push(single('recovery', 5, 50, 'Recovery'));
    }
    return {
      blocks: out,
      short: sets + ' × ' + perSet + ' × ' + onSec + '/' + offSec + 's @ ' + pct + '%',
      workMin: Math.round(sets * perSet * onSec / 60),
      structure: 'micro'
    };
  }

  // Reps that grow then shrink.
  function pyramid(zoneKey, pct, budget, restMin){
    var ladder = budget >= 40 ? [4, 6, 8, 6, 4] : budget >= 28 ? [3, 5, 7, 5] : [3, 4, 5, 3];
    var out = [];
    ladder.forEach(function(m, i){
      out.push(single(zoneKey, m, pct, 'Rep ' + (i + 1)));
      if(i < ladder.length - 1) out.push(single('recovery', restMin, 52, 'Recovery'));
    });
    return {
      blocks: out,
      short: 'Pyramid ' + ladder.join('-') + ' min @ ' + pct + '%',
      workMin: ladder.reduce(function(a, b){ return a + b; }, 0),
      structure: 'pyramid'
    };
  }

  // Reps that shorten as fatigue builds, holding intensity.
  function descending(zoneKey, pct, budget, restMin){
    var ladder = budget >= 40 ? [12, 10, 8, 6] : budget >= 28 ? [10, 8, 6] : [8, 6, 4];
    var out = [];
    ladder.forEach(function(m, i){
      out.push(single(zoneKey, m, pct, 'Rep ' + (i + 1)));
      if(i < ladder.length - 1) out.push(single('recovery', restMin, 52, 'Recovery'));
    });
    return {
      blocks: out,
      short: 'Descending ' + ladder.join('-') + ' min @ ' + pct + '%',
      workMin: ladder.reduce(function(a, b){ return a + b; }, 0),
      structure: 'descending'
    };
  }

  // Steady endurance, optionally with surges or low-cadence work.
  function steadyRide(zoneKey, pct, budget, flavour){
    if(flavour === 'surges'){
      var blocks = Math.max(2, Math.floor(budget / 15));
      var out = [];
      for(var i = 0; i < blocks; i++){
        out.push(single(zoneKey, 12, pct, 'Endurance'));
        out.push(single('tempo', 3, 84, 'Surge'));
      }
      return {blocks: out, short: blocks + ' × (12 min @ ' + pct + '% + 3 min surge)',
              workMin: blocks * 15, structure: 'surges'};
    }
    if(flavour === 'progressive'){
      var seg = Math.round(budget / 3);
      return {
        blocks: [
          single(zoneKey, seg, pct - 6, 'Steady'),
          single(zoneKey, seg, pct, 'Building'),
          single(zoneKey, seg, Math.min(pct + 7, 82), 'Strong')
        ],
        short: 'Progressive ' + (pct - 6) + '% → ' + Math.min(pct + 7, 82) + '%',
        workMin: seg * 3, structure: 'progressive'
      };
    }
    return {blocks: [single(zoneKey, budget, pct, 'Endurance')],
            short: budget + ' min @ ' + pct + '%', workMin: budget, structure: 'steady'};
  }

  // ---------------------------------------------------------------
  // Names. Themed per zone so the library reads as intentional rather
  // than generated. Each is used once.
  // ---------------------------------------------------------------
  var NAMES = {
    endurance: ['Nullarbor','Slow Water','The Long Glass','Hayfield','Wideopen','Drover','Saltbush',
      'Low Country','Thousand Acres','Riverbend','Meridian','Longshore','Flatwater','Windrow',
      'Old Coach Road','Tidewater','Pastoral','Far Paddock','Grasslands','Stillwater','Harrow',
      'Broadmeadow','The Causeway','Quiet Mile','Barleyfield','Cloudbank','Fen','Sandbar',
      'Levee','Moorland','Backroad','Openwater','Longacre','Tallgrass','Dunes','Marshlight',
      'Reedbed','Foreshore','Hinterland','The Verge',
      'Longfield','Stillmoor','Broadwater','Farfield','Lowmeadow','Quietwater','Wideacre',
      'Sedgeland','Longmoor','Pale Morning','Openfield','Slowbend','Grassbank','Farwater',
      'Longbank','Stillfield','Broadacre','Lowwater','Quietfield','Wideshore','Sedgebank',
      'Longshore Way','Stillbank','Farmeadow','Lowbend'],
    tempo: ['Foundry','Millrace','Ironbark','Steady Hand','Bellows','Quarry','Workhorse',
      'Stonemason','Kiln','Anvil Light','Treadle','Loom','Cordage','Brickworks','Tannery',
      'Millstone','Forge Road','Cooperage','Sawtooth','Boiler','Windlass','Capstan','Drayman',
      'Journeyman','Grindstone','Bloomery','Slipway','Trestle','Ballast','Gantry','Dockside',
      'Pitwheel','Rollmill','Furnace Row','Hodcarrier','Scaffold','Keelson','Tramway',
      'Ropewalk','Claypit','Millwright','Ironworks','Steady Rope','Kilnyard','Anvilstone',
      'Wheelwright','Loomshed','Brickyard','Forgebank','Cooperline','Drayline','Grindworks',
      'Sawmill','Boilerhouse','Treadmill Row','Capstan Yard','Ballastline','Hammerworks',
      'Tannery Row','Quarry Bank','Foundry Lane','Millrace Yard','Kilnworks','Trestle Yard',
      'Dockworks','Anvil Row','Gantry Lane'],
    sweetspot: ['Simmer','Slow Burn','Ember','Long Coal','Smoulder','Hearthstone','Banked Fire',
      'Warm Front','Charcoal','Bellowsmoke','Firelight','Low Flame','Cinder','Kindling',
      'Glowworm','Tinderbox','Hotplate','Brazier','Coalface','Embercreek','Hazel Smoke',
      'Slowlight','Hearthside','Ashfield','Firebreak','Peatfire','Warm Stone','Sunstroke',
      'Kilnlight','Smokehouse','Chimneypot','Firetail','Ashgrove','Coalbrook','Emberfall',
      'Slow Match','Warmwater','Heatshimmer','Sunbaked','Longheat',
      'Bakestone','Emberlight','Slow Kiln','Coalsmoke','Warm Ash','Fireclay','Hotstone',
      'Cinderfall','Smokebush','Emberwood','Ashline','Glowstone','Slowfire','Heatwell',
      'Coalash','Warmglow','Firestone','Kilnstone','Smoulderfield','Emberbank','Tallow',
      'Hearthglow','Coalpit','Warmbank','Ashpit','Firepan','Slow Ember','Heathaze',
      'Coalglow','Emberstone','Warmfield','Firepit','Ashcreek','Smokedrift','Emberdrift',
      'Slowcoal','Heatstone','Warmcoal','Firehaze','Ashlight','Cinderline','Emberpath',
      'Kilnfield','Slowsmoke','Warmpath',
      'Coalfield','Emberhill','Warm Kiln','Ashstone','Firewell','Slowheat','Cinderbank',
      'Hearthfield','Coalline','Emberwell','Warmhaze','Firebank','Ashwell','Kilnpath',
      'Slowstone','Heatline','Coalhaze','Emberfield','Warmstone','Firelane','Ashbank',
      'Cinderwood','Slowbank','Heatpath','Coalwood','Emberlane','Warmlane','Firegrove',
      'Ashhaze','Kilnbank','Slowlane','Heatfield','Coalstone','Emberhaze','Warmwood',
      'Firefield','Ashlane','Emberglow','Coalbank','Warmhearth','Kilnglow','Slowglow',
      'Firewood','Ashglow','Heatbank','Cinderglow','Emberwarm','Coalwarm','Hearthlane',
      'Slowfield','Warmkiln','Fireash'],
    threshold: ['The Brink','Knife Edge','Redline','Cusp','Threshold Gate','Hard Border',
      'Watershed','Tipping Point','The Rub','Fault Line','Breakwall','Edgestone','Deadline',
      'High Water','Snapline','The Margin','Backstop','Limit Hold','Overhang','Scarp',
      'Pressure Point','Last Stand','Hairline','The Reckoning','Cutoff','Brinkwater',
      'Steep Ground','Endboard','Tightrope','Crux','Sheer','Headwall','The Narrows',
      'Breaking Strain','Hardpan','Sawline','Stresspoint','Spine','Ridgeback','Final Metre',
      'Edgewater','The Seam','Hardline','Breakpoint','Keen Edge','The Ledge','Cutbank',
      'Rimrock','Vergestone','Sharp Ground','Holdfast','The Limit','Bladeback','Steepwall',
      'Endline','Cragline','Splitline','Hard Water','Brinkstone','Edgefall','The Cut',
      'Narrowing','Pressline','Steepline','Boundstone','The Pinch','Hard Edge','Cliffline',
      'Tension','Snapback','The Barrier','Grindline','Steepbank','Edgemark','Hard Limit',
      'The Wall','Breakline','Ridgeline','Sharpstone','The Divide','Strainline','Crestline',
      'Final Hold','Steepgate','Edgeline',
      'Hardgate','The Sill','Breakstone','Keenline','Ledgestone','Cutline','Rimline',
      'Sharpline','Holdline','Limitstone','Bladeline','Steepstone','Endstone','Cragstone',
      'Splitstone','Waterline','Brinkline','Edgebank','The Notch','Narrowline','Pressstone',
      'Steepmark','Boundline','Pinchpoint','Hardstone','Cliffstone','Tensionline','Snapstone',
      'Barrierline','Grindstone Edge','Steepcrest','Edgecrest','Limitline','Wallstone',
      'Breakcrest','Ridgestone','Sharpbank','Divideline','Strainstone','Crestbank','Holdstone',
      'Gatestone','Markline'],
    vo2: ['Whiteout','Shiv','Hailstorm','Squall','Thunderhead','Cold Snap','Sleet',
      'Downburst','Gale Force','Icepick','Blizzard','Crosswind','Flashfrost','Stormfront',
      'Tempest','Hardrain','Windshear','Frostbite','Cloudburst','Northerly','Riptide',
      'Sirocco','Katabatic','Snowline','Hurricane Deck','Bitter Wind','Chillblast',
      'Rimefrost','Wintergale','Sharp Shower','Nor\'easter','Whipcrack','Glacier Wind',
      'Hailshot','Snowdrift','Bluster','Icefall','Stormlash','Cold Front','Windbite',
      'Sleetfall','Frostline','Galebreak','Snowsquall','Icewind','Stormbite','Coldsnap Ridge',
      'Hailline','Windfall','Frostgale','Sleetline','Snowbite','Icelash','Stormline',
      'Chillwind','Freezeline','Hailbite','Windlash','Frostbite Ridge','Snowlash','Icebite',
      'Stormchill','Coldlash','Gale Line','Sleetbite','Windchill','Frostlash','Snowgale',
      'Icechill','Stormbreak','Coldbite','Hailgale','Windfront','Frostwind','Sleetgale',
      'Snowfront','Icegale','Stormfrost','Coldgale','Hailfront','Windsquall','Frostfront',
      'Sleetfront','Snowchill','Icefront','Stormgale','Coldfront Ridge','Hailchill',
      'Windgale','Frostchill'],
    anaerobic: ['Flashpoint','Detonator','Powderkeg','Shortfuse','Firecracker','Snapshot',
      'Hammerfall','Live Wire','Kickdown','Bolt','Spark Gap','Blasting Cap','Quickfire',
      'Whiplash','Trigger','Dynamite','Hotwire','Backdraft','Muzzleflash','Overload',
      'Shockwave','Ignition','Percussion','Slam','Crackle','Jolt','Fulminate','Touchpaper',
      'Flintlock','Strike Anywhere','Blastwave','Sparkline','Hammerblow','Quicklight',
      'Touchfire','Firestrike']
  };

  // ---------------------------------------------------------------
  // Which structures suit which zone, and their rep geometry.
  // ---------------------------------------------------------------
  var RECIPES = {
    endurance: [
      {fn:function(p,b){ return steadyRide('endurance', p, b, 'steady'); }, durations:[30,45,60,75,90,120]},
      {fn:function(p,b){ return steadyRide('endurance', p, b, 'surges'); }, durations:[60,75,90,120]},
      {fn:function(p,b){ return steadyRide('endurance', p, b, 'progressive'); }, durations:[60,90,120]}
    ],
    tempo: [
      {fn:function(p,b){ return classicReps('tempo', p, b, 12, 4); }, durations:[45,60,75,90]},
      {fn:function(p,b){ return classicReps('tempo', p, b, 8, 3); }, durations:[30,45]},
      {fn:function(p,b){ return longBlocks('tempo', p, b, 6); }, durations:[60,75,90,120]},
      {fn:function(p,b){ return classicReps('tempo', p, b, 20, 5); }, durations:[75,90,120]}
    ],
    sweetspot: [
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 10, 5); }, durations:[45,60,75]},
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 15, 5); }, durations:[60,75,90]},
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 20, 6); }, durations:[75,90,120]},
      {fn:function(p,b){ return pyramid('sweetspot', p, b, 4); }, durations:[45,60,75]},
      {fn:function(p,b){ return descending('sweetspot', p, b, 5); }, durations:[60,75,90]},
      // Short reps, tight recoveries — sweet spot is sub-threshold, so you
      // clear it fast and don't need long rests to hold the numbers.
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 4, 1); }, durations:[45,60,75]},
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 6, 2); }, durations:[30,45,60,75]},
      {fn:function(p,b){ return classicReps('sweetspot', p, b, 8, 2); }, durations:[45,60,75]},
      // Sweet spot over/unders: 2' just under, 1' just over, averaging to target.
      {fn:function(p,b){ return overUnder('sweetspot', p, b, 9, 2, 1); }, durations:[45,60,75]}
    ],
    threshold: [
      {fn:function(p,b){ return classicReps('threshold', p, b, 8, 4); }, durations:[30,45,60,75]},
      {fn:function(p,b){ return classicReps('threshold', p, b, 12, 5); }, durations:[60,75,90]},
      {fn:function(p,b){ return longBlocks('threshold', p, b, 8); }, durations:[60,75,90]},
      {fn:function(p,b){ return overUnder('threshold', p, b, 15, 3, 2); }, durations:[60,75,90]},
      {fn:function(p,b){ return overUnder('threshold', p, b, 9, 2, 1); }, durations:[45,60]},
      {fn:function(p,b){ return descending('threshold', p, b, 5); }, durations:[60,75]},
      // Incomplete-recovery threshold: the rest is deliberately too short to
      // clear, so each rep starts a little deeper than the last.
      {fn:function(p,b){ return classicReps('threshold', p, b, 3, 1); }, durations:[45,60,75]},
      {fn:function(p,b){ return classicReps('threshold', p, b, 5, 2); }, durations:[45,60,75]},
      {fn:function(p,b){ return classicReps('threshold', p, b, 6, 2); }, durations:[45,60,75]}
    ],
    vo2: [
      {fn:function(p,b){ return classicReps('vo2', p, b, 3, 3); }, durations:[30,45,60,75]},
      {fn:function(p,b){ return classicReps('vo2', p, b, 4, 4); }, durations:[45,60,75]},
      {fn:function(p,b){ return classicReps('vo2', p, b, 5, 5); }, durations:[60,75,90]},
      {fn:function(p,b){ return microIntervals('vo2', p, b, 30, 30); }, durations:[30,45,60,75]},
      {fn:function(p,b){ return microIntervals('vo2', p, b, 40, 20); }, durations:[45,60]},
      {fn:function(p,b){ return pyramid('vo2', p, b, 4); }, durations:[60,75]}
    ],
    anaerobic: [
      {fn:function(p,b){ return microIntervals('anaerobic', p, b, 15, 45); }, durations:[30,45,60]},
      {fn:function(p,b){ return microIntervals('anaerobic', p, b, 20, 40); }, durations:[45,60]},
      {fn:function(p,b){ return classicReps('anaerobic', p, b, 1, 4); }, durations:[45,60]}
    ]
  };

  // ---------------------------------------------------------------
  // Fitness tests. Hand-authored rather than generated: their structure
  // is a protocol, not a recipe, and the app treats them specially — it
  // derives an FTP estimate from the recorded power at the end.
  // ---------------------------------------------------------------
  function zoneForPct(p){
    return p < 56 ? 'recovery' : p < 76 ? 'endurance' : p < 88 ? 'tempo'
         : p < 95 ? 'sweetspot' : p < 106 ? 'threshold' : p < 126 ? 'vo2' : 'anaerobic';
  }

  function rampTest(){
    // TrainerRoad-style: 1-min steps from 46% rising 6% each, until failure.
    // 22 steps reach 172% — enough headroom that a rider whose real FTP is up
    // to ~30% above the app's setting still fails before the top. The app
    // ends the ramp automatically when power collapses.
    var blocks = [prep(ramp('endurance', 5, 45, 46, 'Warm-up'))];
    for(var i = 0; i < 22; i++){
      var p = 46 + i * 6;
      blocks.push(single(zoneForPct(p), 1, p, 'Step ' + (i + 1)));
    }
    blocks.push(prep(ramp('recovery', 3, 55, 40, 'Cool-down')));
    return {
      key:'ramp-test', name:'Ramp Test', short:'1-min steps, +6% each, until you crack',
      purpose:'Ride each step in ERG until you can no longer hold it. The app ends the ramp when your power falls away and drops you into a cool-down. FTP is estimated as 75% of your best one-minute average. The steps scale from your current FTP, so if that number is badly out, set a rough guess first.',
      zone:'test', spice:0, structure:'test', shape:'test', test:'ramp',
      durationMin:30, targetPct:null, blocks:blocks
    };
  }

  function ftp20Test(){
    // The classic protocol: warm up, open the legs, a 5-min blow-out to clear
    // anaerobic contribution, recover, then 20 minutes at the hardest even
    // pace you can hold. The test segment runs in resistance mode, not ERG.
    var blocks = [
      prep(ramp('endurance', 10, 45, 70, 'Warm-up')),
      prep(repeat(3, leg('threshold', 1, 100, 'Opener'), leg('recovery', 1, 50, 'Easy'), true)),
      single('vo2', 5, 105, 'Blow-out'),
      single('recovery', 9, 55, 'Recover'),
      single('test', 20, null, '20-min test'),
      prep(ramp('recovery', 10, 55, 40, 'Cool-down'))
    ];
    return {
      key:'20-minute-ftp-test', name:'20-Minute FTP Test', short:'5-min blow-out, then 20 min all-out',
      purpose:'Start the 20 minutes just above your current FTP and settle into the hardest power you can hold evenly for the whole effort — no fading in the last five. FTP is estimated as 95% of your 20-minute average.',
      zone:'test', spice:0, structure:'test', shape:'test', test:'ftp20',
      durationMin:60, targetPct:null, blocks:blocks
    };
  }

  function buildTests(){
    return [rampTest(), ftp20Test()].map(function(t){
      var m = classify(t.blocks);
      t.tss = m.tss; t.if = m.if; t.primaryZone = 'test';
      t.primaryZoneMin = m.workMin; t.workMeanPct = m.workMeanPct; t.workMin = m.workMin;
      t.timeInZone = m.timeInZone; t.derivedSpice = 0;
      return t;
    });
  }

  // Rider-facing grouping of the structural shapes, for the Shape filter.
  // "long" vs "short" is about rep length — the thing a rider actually
  // chooses between — not total volume.
  function shapeOf(structure){
    switch(structure){
      case 'overunder':  return 'overunder';
      case 'micro':      return 'micro';
      case 'short reps': return 'short';
      case 'reps':
      case 'long':       return 'long';
      case 'pyramid':
      case 'descending': return 'ladder';
      default:           return 'steady';   // steady, surges, progressive
    }
  }
  var SHAPES = {
    short:    {label:'Short intervals', hint:'3–8 min reps'},
    long:     {label:'Long intervals',  hint:'10 min and up'},
    overunder:{label:'Over/unders',     hint:'alternating either side of a target'},
    micro:    {label:'Micro',           hint:'30/30s, 40/20s, 15/45s'},
    ladder:   {label:'Ladders',         hint:'pyramids and descending sets'},
    steady:   {label:'Steady',          hint:'continuous, surges, progressive'}
  };

  // How much time in the primary zone is sensible for a session of this
  // length — stops the generator writing 60 minutes of VO2max.
  function workBudget(zoneKey, totalMin, overhead){
    var avail = totalMin - overhead;
    var caps = {
      endurance: avail, tempo: avail, sweetspot: Math.min(avail, 60),
      threshold: Math.min(avail, 45), vo2: Math.min(avail, 32), anaerobic: Math.min(avail, 20)
    };
    return Math.max(8, Math.min(avail, caps[zoneKey]));
  }

  // ---------------------------------------------------------------
  // Classifier — derives metrics from structure alone, exactly as it
  // will have to for an imported .zwo.
  // ---------------------------------------------------------------
  // Every second of the session, flagged as work or not. Ramps are
  // transitions (warm-ups, cool-downs) and recovery legs are rest, so
  // neither counts as work — that distinction is what makes the primary
  // zone and the spice rating come out right.
  function profileSeconds(blocks){
    var out = [];
    expandBlocks(blocks).forEach(function(s){
      var secs = Math.round(s.min * 60);
      var ramping = s.pctEnd !== undefined && s.pctEnd !== null && s.pctEnd !== s.pct;
      // A generated library marks preparation explicitly. An imported .zwo
      // has no such marking, so the ramp/recovery test is the fallback.
      var isWork = !s.prep && !ramping && s.type !== 'recovery';
      // An all-out (pct null) segment is scored as threshold for TSS purposes.
      var basePct = s.pct === null ? 100 : s.pct;
      for(var i = 0; i < secs; i++){
        out.push({
          pct: ramping ? s.pct + (s.pctEnd - s.pct) * (i / secs) : basePct,
          work: isWork
        });
      }
    });
    return out;
  }

  function classify(blocks){
    var prof = profileSeconds(blocks);
    var n = prof.length;

    // Normalized power as a % of FTP: 30 s rolling average, 4th-power mean.
    var roll = [], sum = 0, q = [];
    for(var i = 0; i < n; i++){
      q.push(prof[i].pct); sum += prof[i].pct;
      if(q.length > 30) sum -= q.shift();
      roll.push(Math.pow(sum / q.length, 4));
    }
    var np = Math.pow(roll.reduce(function(a, b){ return a + b; }, 0) / roll.length, 0.25);
    var IF = np / 100;
    var tss = (n / 3600) * IF * IF * 100;

    // Time in zone is reported across the whole session — that's the useful
    // figure for a rider, warm-up included.
    var tiz = {};
    Object.keys(ZONES).forEach(function(k){ tiz[k] = 0; });
    prof.forEach(function(p){ tiz[zoneOf(p.pct)]++; });

    // Primary zone and spice come from the mean intensity of the WORK only.
    // Two earlier rules failed here: "most time in zone" called VO2 sessions
    // endurance rides (warm-up plus recoveries outweigh the reps), and
    // "hardest zone above an 8% share" called a Z2 ride with six minutes of
    // surges a tempo session. The mean of the work is what a rider would call
    // the session, and it handles over/unders correctly too — alternating
    // either side of threshold averages out to threshold.
    var work = prof.filter(function(p){ return p.work; });
    var workMean = work.length
      ? work.reduce(function(a, p){ return a + p.pct; }, 0) / work.length
      : 0;

    var primary = work.length ? zoneOf(workMean) : 'endurance';
    var band = ZONES[primary].band;
    var pos = (workMean - band[0]) / (band[1] - band[0]);
    var derivedSpice = Math.max(1, Math.min(5, Math.round(1 + pos * 4)));

    var tizMin = {};
    Object.keys(tiz).forEach(function(k){ if(tiz[k] > 0) tizMin[k] = Math.round(tiz[k] / 60); });

    return {
      durationMin: Math.round(n / 60),
      if: Math.round(IF * 1000) / 1000,
      tss: Math.round(tss),
      np: Math.round(np),
      primaryZone: primary,
      workMeanPct: Math.round(workMean * 10) / 10,
      workMin: Math.round(work.length / 60),
      timeInZone: tizMin,
      primaryZoneMin: Math.round(tiz[primary] / 60),
      derivedSpice: derivedSpice
    };
  }

  // ---------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------
  function generate(){
    var library = [], id = 1, mismatches = [], unsolved = [], nameShortfall = {}, snapDropped = [];
    var nameIdx = {};
    Object.keys(NAMES).forEach(function(k){ nameIdx[k] = 0; });

    Object.keys(RECIPES).forEach(function(zoneKey){
      RECIPES[zoneKey].forEach(function(recipe, recipeIdx){
        recipe.durations.forEach(function(totalMin){
          for(var spice = 1; spice <= 5; spice++){
            var nominal = spicePct(zoneKey, spice);
            // Seed drives the opener variant. Built from the workout's own
            // coordinates so the same workout gets the same opener every
            // regeneration, while neighbours differ.
            var seed = (ZONES[zoneKey].rank * 131 + recipeIdx * 37 + totalMin * 7 + spice * 11) | 0;
            var wu = opener(totalMin, zoneKey, nominal, seed);
            var cd = cooldown(totalMin);
            var overhead = wu.min + cd.min;
            var budget = workBudget(zoneKey, totalMin, overhead);
            if(budget < 8) continue;

            function attempt(pct){
              var body = recipe.fn(pct, budget);
              if(!body || !body.blocks.length) return null;
              var blocks = wu.blocks.slice();
              blocks = blocks.concat(body.blocks);
              blocks.push(cd.block);
              return {pct:pct, body:body, blocks:blocks, metrics:classify(blocks)};
            }

            // Structures that blend intensities (endurance with tempo surges,
            // progressive builds) don't average out to their nominal target,
            // so search nearby for the intensity that actually classifies as
            // the intended rating rather than shipping a mislabelled workout.
            var chosen = null, nominalTry = attempt(nominal);
            if(nominalTry && nominalTry.metrics.derivedSpice === spice &&
               nominalTry.metrics.primaryZone === zoneKey){
              chosen = nominalTry;
            } else {
              for(var d = 1; d <= 10 && !chosen; d++){
                [nominal - d, nominal + d].forEach(function(cand){
                  if(chosen) return;
                  var t = attempt(cand);
                  if(t && t.metrics.derivedSpice === spice && t.metrics.primaryZone === zoneKey) chosen = t;
                });
              }
            }
            // Unsolvable combinations are dropped rather than mislabelled.
            if(!chosen){
              unsolved.push({zone:zoneKey, spice:spice, duration:totalMin, structure:(nominalTry && nominalTry.body.structure) || '?'});
              continue;
            }

            var pct = chosen.pct;
            var body = chosen.body;
            var blocks = chosen.blocks;
            var metrics = chosen.metrics;

            // Snap to the nominal duration. Structures fill a work budget, so
            // the total drifts by a few minutes; a library where the 45-minute
            // bucket contains 38- and 43-minute sessions makes the duration
            // filter useless. Pad with easy spinning, or trim the cool-down.
            var delta = totalMin - metrics.durationMin;
            if(delta > 0){
              // prep-flagged so padding can't move the spice rating
              blocks.splice(blocks.length - 1, 0, prep(single('endurance', delta, 60, 'Easy spin')));
            } else if(delta < 0){
              // Overshoot: shorten the cool-down first (never below 4 min),
              // then the warm-up ramp (never below 5). Only if both are
              // exhausted is the workout dropped — and then it's counted.
              var need = -delta;
              var cdBlock = blocks[blocks.length - 1];
              var take = Math.min(need, Math.max(0, cdBlock.min - 4));
              cdBlock.min -= take; need -= take;
              if(need > 0){
                var wuBlock = blocks[0];
                take = Math.min(need, Math.max(0, wuBlock.min - 5));
                wuBlock.min -= take; need -= take;
              }
              if(need > 0){
                snapDropped.push({zone:zoneKey, spice:spice, duration:totalMin, structure:body.structure, over:need});
                continue;
              }
            }
            metrics = classify(blocks);
            if(metrics.durationMin !== totalMin){
              snapDropped.push({zone:zoneKey, spice:spice, duration:totalMin, structure:body.structure, got:metrics.durationMin});
              continue;
            }

            // Running out of names silently drops workouts, and because
            // recipes are processed in order it starves whichever ones were
            // added last. Count the shortfall so the builder can report it.
            var pool = NAMES[zoneKey];
            if(nameIdx[zoneKey] >= pool.length){
              nameShortfall[zoneKey] = (nameShortfall[zoneKey] || 0) + 1;
              continue;
            }
            var name = pool[nameIdx[zoneKey]++];

            if(metrics.derivedSpice !== spice){
              mismatches.push({name:name, zone:zoneKey, intended:spice, derived:metrics.derivedSpice, pct:pct});
            }

            library.push({
              id: id++,
              // Stable identity for completion history and favourites. Ids are
              // positional and shift whenever the library is regenerated, so
              // anything persisted must key off this instead.
              key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
              name: name,
              short: body.short,
              zone: zoneKey,
              spice: spice,
              structure: body.structure,
              shape: shapeOf(body.structure),
              durationMin: metrics.durationMin,
              targetPct: pct,
              tss: metrics.tss,
              if: metrics.if,
              primaryZone: metrics.primaryZone,
              primaryZoneMin: metrics.primaryZoneMin,
              workMeanPct: metrics.workMeanPct,
              workMin: metrics.workMin,
              timeInZone: metrics.timeInZone,
              derivedSpice: metrics.derivedSpice,
              blocks: blocks
            });
          }
        });
      });
    });

    // Tests go first so they're easy to find, with ids continuing the sequence.
    buildTests().forEach(function(t){ t.id = id++; library.unshift(t); });

    return {
      generated: new Date().toISOString(),
      zones: ZONES,
      shapes: SHAPES,
      count: library.length,
      mismatches: mismatches,
      unsolved: unsolved,
      nameShortfall: nameShortfall,
      snapDropped: snapDropped,
      workouts: library
    };
  }

  global.LibraryGen = {
    generate: generate,
    classify: classify,
    ZONES: ZONES,
    SHAPES: SHAPES,
    spicePct: spicePct,
    zoneOf: zoneOf,
    expandBlocks: expandBlocks,
    NAMES: NAMES
  };

})(typeof window !== 'undefined' ? window : this);
