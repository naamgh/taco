param(
  [string]$Root = ".",
  [int]$Port = 8777
)

$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "serving $Root on http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".webmanifest" = "application/manifest+json"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch {
    break
  }
  $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "ftp-plan.html" }
  $path = Join-Path $Root $rel

  # keep requests inside the served root
  $full = [System.IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
    $ctx.Response.StatusCode = 404
    $ctx.Response.Close()
    continue
  }

  $ext = [System.IO.Path]::GetExtension($full).ToLower()
  if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
  # No caching: this file gets edited constantly and a stale copy is confusing.
  $ctx.Response.Headers.Add("Cache-Control", "no-store, must-revalidate")
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
  Write-Host "$($ctx.Request.HttpMethod) /$rel -> 200"
}
