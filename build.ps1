# Builds ftp-plan.html (and the GitHub Pages copy) from the parts in src/.
#
#   .\build.ps1            build both files
#   .\build.ps1 -Check     build to memory and report whether the output would change
#
# The deliverable stays a single self-contained HTML file; this just keeps the
# source in pieces that are safe to edit. Everything is read and written as
# UTF-8 explicitly — PowerShell 5.1's defaults read UTF-8 as ANSI and that has
# already corrupted this file once.
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $root 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)   # read without needing a BOM

function Part($name){
  $p = Join-Path $src $name
  if(-not (Test-Path $p)){ throw "missing part: $name" }
  [System.IO.File]::ReadAllText($p, $utf8)
}

$nl = "`r`n"
$modules = Get-ChildItem (Join-Path $src 'app') -Filter '*.js' | Sort-Object Name | ForEach-Object {
  [System.IO.File]::ReadAllText($_.FullName, $utf8)
}

$html = (Part 'head.html') + $nl +
  '<style>' + $nl + (Part 'styles.css') + $nl + '</style>' + $nl +
  '<script>' + $nl + (Part 'theme-boot.js') + $nl + '</script>' + $nl +
  '</head>' + $nl +
  (Part 'shell.html') + $nl +
  '<script id="libraryData" type="application/json">' + (Part 'library.json').Trim() + '</script>' + $nl +
  $nl +
  '<script>' + $nl + '(function(){' + $nl + '  "use strict";' + $nl +
  ($modules -join $nl) + $nl +
  '})();' + $nl + '</script>' + $nl + '</body>' + $nl + '</html>' + $nl

# The Training Log page is the same app opened straight into Calendar + Fitness
# (src/app/11-log-mode.js). It differs only in the <html> marker, the title and
# its home-screen manifest; data-app-url is where its "Workouts" links go.
function LogPage($appUrl){
  $html.Replace('<html lang="en">', '<html lang="en" data-mode="log" data-app-url="' + $appUrl + '">').
        Replace('<title>Indoor Training Console</title>', '<title>Training Log</title>').
        Replace('href="manifest.webmanifest"', 'href="log.webmanifest"')
}

$outs = @(
  @{ path = (Join-Path $root 'ftp-plan.html');     html = $html },
  @{ path = (Join-Path $root 'github\index.html'); html = $html },
  @{ path = (Join-Path $root 'ftp-log.html');      html = (LogPage 'ftp-plan.html') },
  @{ path = (Join-Path $root 'github\log.html');   html = (LogPage './') }
)
$bom  = New-Object System.Text.UTF8Encoding($true)

foreach($out in $outs){
  $o = $out.path
  $newBytes = $bom.GetPreamble() + $utf8.GetBytes($out.html)
  $newHash = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($newBytes)).Replace('-','')
  $cur = if(Test-Path $o){ (Get-FileHash $o -Algorithm SHA256).Hash } else { '(none)' }
  $same = $cur -eq $newHash
  if($Check){
    "{0,-22} {1}" -f (Split-Path $o -Leaf), $(if($same){'unchanged'}else{'WOULD CHANGE'})
  } else {
    [System.IO.File]::WriteAllBytes($o, $newBytes)
    "{0,-22} {1}  {2:N0} bytes" -f (Split-Path $o -Leaf), $(if($same){'unchanged'}else{'written'}), $newBytes.Length
  }
}
if(-not $Check){
  # The generator and builder travel with the site so the library can be rebuilt from the repo.
  Copy-Item (Join-Path $root 'library-gen.js') (Join-Path $root 'github\library-gen.js') -Force
  Copy-Item (Join-Path $root 'library-builder.html') (Join-Path $root 'github\library-builder.html') -Force
}
