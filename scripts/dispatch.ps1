# Asks GitHub to run the refresh-data workflow now. GitHub's own cron fires only a few times a day for this repo,
# so a Windows scheduled task (BKKFLOOD-trigger) calls this every 15 minutes. It deploys nothing itself:
# the code and the credentials stay on GitHub, so an old local build can never overwrite the live site.
# Log: dispatch.log (next to package.json)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'dispatch.log'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
function Log($m) { "$(Get-Date -Format 's') $m" | Add-Content -Path $log -Encoding utf8 }

if (-not (Test-Path $gh)) { Log 'gh.exe not found'; exit 1 }

# Refresh the two BMA sources that GitHub's servers cannot reach (only commits when the content changed)
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$env:GH_EXE = $gh
Push-Location $root
$sync = & $node scripts/sync-thai-sources.mjs 2>&1
Log ('sync-thai-sources -> exit ' + $LASTEXITCODE + ' ' + (($sync | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) -join ' | '))
Pop-Location

$out = & $gh workflow run refresh-data --repo realsuperman-hub/bkkflood 2>&1
$code = $LASTEXITCODE
Log ("gh workflow run -> exit $code " + (($out | ForEach-Object { "$_".Trim() } | Where-Object { $_ } | Select-Object -Last 1) -join ' '))

# keep the log small
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 100KB)) { Get-Content $log -Tail 200 | Set-Content $log -Encoding utf8 }
exit $code
