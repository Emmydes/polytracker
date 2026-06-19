# Auto-commit and push PolyTracker changes to GitHub after agent sessions.
$ErrorActionPreference = 'SilentlyContinue'

try {
  $null = [Console]::In.ReadToEnd()
} catch {}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..') -ErrorAction SilentlyContinue
if (-not $repoRoot -or -not (Test-Path (Join-Path $repoRoot '.git'))) {
  exit 0
}

Set-Location $repoRoot

$changes = git status --porcelain 2>$null
if (-not $changes) { exit 0 }

$secretPatterns = @('\.env$', '\.env\.', 'credentials', '\.pem$', '\.key$')
foreach ($line in ($changes -split "`n")) {
  if (-not $line) { continue }
  $file = ($line.Substring(3) -replace '"', '').Trim()
  foreach ($pat in $secretPatterns) {
    if ($file -match $pat) { exit 0 }
  }
}

git add -A 2>$null
if (-not $?) { exit 0 }

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
git commit -m "Auto-sync: workspace updates $timestamp" 2>$null
if (-not $?) { exit 0 }

$branch = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branch) { $branch = 'main' }

git push origin $branch 2>$null
exit 0
