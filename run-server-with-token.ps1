# Secure helper to start the server with a GitHub token without saving it to disk.
# Usage: .\run-server-with-token.ps1
# It will prompt for the token (hidden), the repo slug, and optional admin token, then start server.js in this session.

Write-Host "Starting Loyalty-Fights server helper..." -ForegroundColor Cyan

# Prompt for token securely
$secretToken = Read-Host -AsSecureString "Enter GitHub token (will not be shown)"
if (-not $secretToken){ Write-Host "No token entered; aborting." -ForegroundColor Red; exit 1 }

# Convert SecureString to plain text in-memory (only for setting environment variable in this session)
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretToken)
$plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)

# Prompt for repo slug and admin token
$repo = Read-Host "Enter GitHub repo slug (owner/repo)" -Default "AlexandraHopstadius/Loyalty-Fights"
$adminToken = Read-Host "Enter ADMIN_TOKEN (press Enter to use default 'letmein')" -Default "letmein"

# Set environment variables in this session
$env:GITHUB_TOKEN = $plainToken
$env:GITHUB_REPO  = $repo
$env:ADMIN_TOKEN  = $adminToken

Write-Host "Environment set for this session. Starting server.js..." -ForegroundColor Green

# Start the node server in the foreground so you can see logs; Ctrl+C to stop
node .\server.js

# When server exits, clear the variable values in memory
Remove-Item Env:\GITHUB_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:\GITHUB_REPO -ErrorAction SilentlyContinue
Remove-Item Env:\ADMIN_TOKEN -ErrorAction SilentlyContinue

Write-Host "Server stopped. In-memory environment cleared." -ForegroundColor Yellow
