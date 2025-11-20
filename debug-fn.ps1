# debug-fn.ps1 — helper to prompt once for ADMIN password and reuse it for multiple calls
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\debug-fn.ps1
# The script NEVER writes the password to disk. It keeps the plain text in the session only.

Write-Host "This helper prompts once for your ADMIN password and lets you run actions repeatedly." -ForegroundColor Cyan

# Location to store encrypted password (Windows DPAPI, current user only)
$PwStore = Join-Path $env:USERPROFILE '.lf_admin_pw.enc'

function Load-AdminPasswordPlain {
  param()
  if (Test-Path $PwStore) {
    try {
      $enc = Get-Content -Path $PwStore -ErrorAction Stop
      $sec = ConvertTo-SecureString $enc
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
      try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    } catch {
      Write-Host "Saved admin password exists but couldn't be read. You'll be prompted again." -ForegroundColor Yellow
    }
  }
  return $null
}

function Save-AdminPassword {
  param([string]$plain)
  try {
    $sec = ConvertTo-SecureString -String $plain -AsPlainText -Force
    $enc = ConvertFrom-SecureString $sec
    $enc | Set-Content -Path $PwStore -Encoding ascii
    Write-Host "Saved admin password (encrypted to your Windows user) at $PwStore" -ForegroundColor DarkGreen
  } catch {
    Write-Host "Failed to save admin password: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# Try to load a saved password first
$ADMIN_PLAIN = Load-AdminPasswordPlain
if (-not $ADMIN_PLAIN) {
  Write-Host "Admin password input options:" -ForegroundColor Cyan
  Write-Host " - Press Enter to type it hidden" -ForegroundColor Cyan
  Write-Host " - Or type 'clip' to paste from clipboard" -ForegroundColor Cyan
  Write-Host " - Or type 'env' to read from LF_ADMIN_PASSWORD env var" -ForegroundColor Cyan
  $mode = Read-Host "Choose input (Enter/clip/env)"
  switch ($mode.ToLower()) {
    'clip' { $ADMIN_PLAIN = (Get-Clipboard | ForEach-Object { $_.ToString().Trim() }) }
    'env'  { $ADMIN_PLAIN = ($env:LF_ADMIN_PASSWORD | ForEach-Object { $_.ToString().Trim() }) }
    Default {
      $secure = Read-Host -AsSecureString "Enter ADMIN password (input hidden)"
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $ADMIN_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
  }
  if (-not $ADMIN_PLAIN) { throw "No admin password provided." }
  $save = Read-Host "Save this password for next time (encrypted to your Windows user)? [Y/n]"
  if (($save -eq '') -or ($save -match '^(y|yes)$')) { Save-AdminPassword -plain $ADMIN_PLAIN }
}

# Optional: prompt for ANON key (only needed if your function requires ANON for invocation)
$anon = Read-Host "(Optional) Paste ANON key or press Enter to skip"
$anonTrim = ($anon | ForEach-Object { $_.ToString().Trim() })
if ($anonTrim) { $ANON = $anonTrim } else { $ANON = $null }

# Default function URL — change if you need another
$defaultFn = "https://hbtjzniqvtxtdtejxusw.functions.supabase.co/admin-proxy"
$functionUrl = Read-Host "Function URL (press Enter to use default)" -DefaultValue $defaultFn
$functionUrl = ($functionUrl | ForEach-Object { $_.ToString().Trim() })

# Guard against mis-paste of ANON into the URL prompt
function IsLikelyJwt([string]$s) { return $s -match '^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$' }
if (-not ($functionUrl -match '^https?://')) {
  if (IsLikelyJwt $functionUrl) {
    Write-Host "It looks like you pasted your ANON key into the Function URL prompt. Using the default function URL." -ForegroundColor Yellow
  } else {
    Write-Host "The Function URL didn't start with http(s). Using the default function URL." -ForegroundColor Yellow
  }
  $functionUrl = $defaultFn
}

function Invoke-AdminFn {
  param(
    [string]$action,
    [object]$payload
  )
  if (-not $payload) { $payload = @{ action = $action } }
  else { $payload.action = $action }
  $json = $payload | ConvertTo-Json -Depth 10

  $headers = @{ 'x-admin-password' = $ADMIN_PLAIN }
  if ($ANON) { $headers.Add('Authorization', "Bearer $ANON"); $headers.Add('apikey', $ANON) }

  # Extra safety: if the Function URL is invalid or looks like a JWT, fallback to default
  $fn = $functionUrl
  if (-not ($fn -match '^https?://')) {
    if (IsLikelyJwt $fn) {
      Write-Host "Detected a JWT-like value in the Function URL; using the default Function URL." -ForegroundColor Yellow
    } else {
      Write-Host "Function URL missing http(s); using the default Function URL." -ForegroundColor Yellow
    }
    $fn = $defaultFn
  }
  Write-Host "Calling Function URL: $fn" -ForegroundColor DarkCyan

  try {
    $res = Invoke-RestMethod -Uri $fn -Method Post -Headers $headers -Body $json -ContentType 'application/json' -ErrorAction Stop
    Write-Host "Status: 200" -ForegroundColor Green
    $res | ConvertTo-Json -Depth 10
  } catch {
    if ($_.Exception -and $_.Exception.Response) {
      $status = $_.Exception.Response.StatusCode.Value__
      Write-Host "Status: $status" -ForegroundColor Yellow
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
      Write-Host "Body:`n$content"
    } else {
      Write-Host "Non-HTTP error:" -ForegroundColor Red
      $_ | Format-List * -Force
    }
  }
}

# Interactive loop
while ($true) {
  Write-Host "`nChoose an action: (d)ebug  (w)inner  (c)urrent  (s)tate  (q)uit" -ForegroundColor Cyan
  $key = Read-Host "Enter choice"
  switch ($key.ToLower()) {
    'd' {
      Invoke-AdminFn -action 'debug' -payload @{ }
    }
    'w' {
      $fight_id = Read-Host "Fight numeric id (example: 3)"
      $winnerRaw = Read-Host "Winner side (a | b | draw | null)"
      $winner = $winnerRaw.Trim().ToLower()
      if ($winner -eq 'null') { $winner = $null }
      elseif ($winner -in @('a','b','draw')) { } else { Write-Host "Invalid winner value; use a, b, draw or null." -ForegroundColor Yellow; continue }
      Invoke-AdminFn -action 'setWinner' -payload @{ id = $fight_id; winner = $winner }
    }
    'c' {
      $currentIdx = Read-Host "Set current fight index (0-based, example: 0)"
      Invoke-AdminFn -action 'setCurrent' -payload @{ current = $currentIdx }
    }
    's' {
      $cur = Read-Host "Current index (0-based)"
      $standby = Read-Host "Standby (true/false)"
      $infoVis = Read-Host "Info visible (true/false)"
      $payloadState = @{ current = [int]$cur; standby = ($standby -match '^(true|1)$'); infoVisible = ($infoVis -notmatch '^(false|0)$') }
      Invoke-AdminFn -action 'setState' -payload @{ state = $payloadState }
    }
    'q' {
      Write-Host "Exiting. Password remains only in this session memory until the process closes." -ForegroundColor Cyan
      break
    }
    Default {
      Write-Host "Unknown option." -ForegroundColor Yellow
    }
  }
}
