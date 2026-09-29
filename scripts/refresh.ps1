# Refreshes live data and publishes it to https://bkkflood.web.app (no rebuild of the app itself).
# Run by Windows Task Scheduler every 15 minutes (task name: BKKFLOOD-refresh). Log: refresh.log
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$log = Join-Path $root 'refresh.log'
$project = 'bkkflood-d54cc'

function Log($m) { "$(Get-Date -Format 's') $m" | Add-Content -Path $log -Encoding utf8 }

# cmd /c keeps native stderr from turning into PowerShell errors
function Run($cmd) {
  $o = cmd /c "$cmd 2>&1"
  $code = $LASTEXITCODE
  $tail = ($o | ForEach-Object { "$_".Trim() } | Where-Object { $_ } | Select-Object -Last 2) -join ' | '
  Log "$cmd -> exit $code $tail"
  return ($code -eq 0)
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) { Log 'dist missing — run npm run build once'; exit 1 }

$okS = Run 'node scripts\fetch-stations.mjs'
$okF = Run 'node scripts\fetch-floods.mjs'
if (-not ($okS -or $okF)) { Log 'both data fetches failed — not deploying'; exit 1 }

New-Item -ItemType Directory -Force -Path (Join-Path $root 'dist\data') | Out-Null
Copy-Item (Join-Path $root 'public\data\*.json') (Join-Path $root 'dist\data') -Force

if (Run "firebase deploy --only hosting --project $project") { Log 'deployed' } else { Log 'DEPLOY FAILED'; exit 1 }

# keep the log small
if ((Get-Item $log).Length -gt 200KB) { Get-Content $log -Tail 300 | Set-Content $log -Encoding utf8 }
