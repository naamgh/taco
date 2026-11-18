INDOOR TRAINING CONSOLE
=======================

WHAT THIS IS
------------
A workout library and live trainer player. 225 structured workouts filtered by
duration, focus (endurance / tempo / sweet spot / threshold / VO2max /
anaerobic) and spice level, with watt targets scaled to your FTP. The player
talks to a smart trainer and heart rate strap over Bluetooth, and exports to
.zwo (Zwift) and .fit (Strava / Garmin Connect).

Spice is shown as chillies, 1 to 5, and means intensity WITHIN that focus
area - low-end sweet spot is 1 chilli, top-end sweet spot is 5. Duration is a
separate filter, so the two don't overlap.


HOW TO RUN IT
-------------
There are two ways, and which you want depends on whether you're riding.

1. JUST BROWSING - double-click ftp-plan.html
   The whole library, filters, workout profiles, .zwo export and printing all
   work. No server, no setup. The trainer and HR Connect buttons are disabled
   and an amber bar explains why.

2. RIDING - double-click start.bat
   Starts a small local web server and opens the app in Chrome or Edge. This
   is the only way the Bluetooth connections work. A console window appears
   and stays open - that IS the server. Leave it running while you ride and
   close it when you're done.

   Then go to:  http://localhost:8777/ftp-plan.html


WHY RIDING NEEDS THE SERVER
---------------------------
Web Bluetooth needs a "secure context with a real origin". Offline, that
leaves exactly one option: http://localhost.

A file:// page does count as a secure context - that part is a common
misconception - but Chromium separately refuses Bluetooth from what it calls
an opaque origin, which is what a file:// page has. So navigator.bluetooth
exists and looks available, and requestDevice() then throws a SecurityError.
Apps that only check "does navigator.bluetooth exist" report this as
"connection failed", which looks identical to a cancelled pairing or a
sleeping trainer.

This app checks the protocol directly, so opened as a file it tells you
plainly that Bluetooth is unavailable rather than giving you a dead button.

Everything else works offline either way - the workout library is embedded
in ftp-plan.html, not loaded from a separate file.


REQUIREMENTS
------------
- Windows with PowerShell (built in - nothing to install)
- Chrome or Edge. Firefox and Safari do NOT support Web Bluetooth at all.
- Bluetooth switched on in Windows settings


BEFORE A RIDE
-------------
1. Turn Bluetooth on in Windows.
2. Make sure the trainer isn't already connected to something else. Zwift,
   TrainerRoad, or your phone will hold the connection and it won't show up.
3. Spin the cranks to wake the trainer before pairing - most don't advertise
   until they're awake.
4. Hit Connect on the trainer chip BEFORE starting a workout. ERG mode only
   engages if the trainer is connected when the player opens.
5. Pick a workout, press "Start on Trainer".

The workout window opens and waits - it does not start counting immediately.
Start pedalling (over 20 rpm and 20 W) and after a short countdown the
workout begins. There's also a "Start now" button if you want to skip the
detection, and it's used automatically if no trainer is connected.

Keys during a ride: Space pauses (and resumes from the paused screen),
Up/Down nudge intensity by 1%. In the library: Left/Right collapse the
filter panel, Up/Down move through the list, Enter starts the workout.
At the bottom of the filter panel: a moon/sun button flips between dark and
light mode (remembered), and "Guide" shows a one-screen summary of all of
this - hover to peek, click to pin it open.

Pausing: press Pause (or Space), or just stop pedalling - once power is at or under
5 W (or cadence is 0) for 5 seconds the clock stops on its own. The paused
screen says "Pedal to resume": start turning the cranks and a 3-2-1 brings
the workout back with the trainer target re-applied. "Resume now" skips the
detection; "End workout" finishes the ride and shows the summary. Auto-pause
is off during the ramp test steps (stopping there counts as the end of the
test) and never fires because of a Bluetooth drop-out.

If your trainer doesn't appear in the Bluetooth picker, the app retries with
an unfiltered list so you can pick it by name.


AFTER A RIDE
------------
A summary appears with duration, average/max power, normalised power,
average/max heart rate, average cadence and total work, plus two pies:
time in power zones (Coggan seven, the workout's focus zone pushed out) and
time in heart-rate zones (needs your max HR, set in the Rider box).

"Sync to Strava" (once Strava is connected from the sidebar - press
Connect to Strava, approve on Strava's page) sends the ride straight to
Strava and links the new activity. Laps line up exactly with the workout
intervals. Tokens stay in the browser.

"Download .fit" gives you the same file to upload by hand to Strava or
Garmin Connect.

"Download Timeline Image" downloads a 4:3 PNG (2000x1500) with the workout name and
structure, the summary stats, and your power / heart rate / cadence traces
drawn over the planned intervals. Attach it to the Strava activity as a photo
after uploading the .fit — Strava won't pick it up automatically.

You can also export any workout as .zwo from its card to run it in Zwift.


YOUR FTP
--------
FTP and max HR live in the Rider box at the bottom of the filter panel.
Every watt target recalculates instantly and both values are remembered in
that browser. The (?) next to FTP shows the power zones and, once max HR is
set, the heart-rate zones in bpm.

Note: completion ticks and your FTP are stored in the browser's local storage.
They are per-browser and per-machine, so moving to a different PC starts that
tracking fresh. Completions are keyed by workout name, so they survive the
library being regenerated.


FILES
-----
ftp-plan.html         the app, with all 225 workouts embedded (~305 KB)
library-gen.js        the generator that produces the workout library
library-builder.html  open this to regenerate or review the library
serve.ps1             the small local web server
start.bat             starts the server and opens the browser
README.txt            this file

ftp-plan.html is self-contained. You can copy just that one file to another
machine and it will work for everything except Bluetooth.


CHANGING THE LIBRARY
--------------------
The library is generated, not hand-written, so it stays reproducible. To
change it - different intensity bands, new interval structures, more names -
edit library-gen.js, then:

  1. Run start.bat  (the builder needs the server for this step)
  2. Go to http://localhost:8777/library-builder.html
  3. Press "Generate library"
  4. Review the table, then press "Download ftp-plan.html (library embedded)"
  5. Save the downloaded file over the existing ftp-plan.html

That produces a complete app file with the new library baked in - no
copy-pasting into a 300 KB document.

The builder also cross-checks itself: it independently re-derives each
workout's chilli rating from the interval structure and flags any that
disagree with what the generator intended. A green bar means all agree.

There is also a "Download library.json" button. The app doesn't need that
file - it's only useful if you want the library as data for something else.


TROUBLESHOOTING
---------------
Connect buttons greyed out
  You've opened the file directly instead of through start.bat, or you're in
  a browser without Web Bluetooth. Use start.bat with Chrome or Edge.

Page looks out of date after an edit
  The server sends no-cache headers, so a refresh should be enough. If not,
  check whether an older server is still running on port 8777 and close its
  console window.

"Port already in use" or the app won't load
  A previous server console window is probably still open. Close it and run
  start.bat again.

Trainer connects but power stays at zero
  Some trainers need a few pedal strokes before they broadcast. Spin up and
  give it a few seconds.
