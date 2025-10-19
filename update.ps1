# update.ps1
# Kör detta script för att automatiskt pusha nya fightresultat till GitHub Pages

Write-Host "🔄 Uppdaterar GitHub Pages med senaste ändringarna..." -ForegroundColor Cyan

# Gå till projektmappen (ändra om din sökväg skiljer sig)
Set-Location "C:\Users\alexa\Desktop\thai_gala_mobile_site"

# Lägg till alla ändrade filer (du kan byta ut * till specifika filer om du vill)
git add index.html
git add fights.json
git add fightcard.js

# Skapa en commit med dagens datum/tid
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
ngit commit -m "Automatisk uppdatering av fightcard $timestamp"

# Push till GitHub (första gången behöver du ev. logga in)
git push --set-upstream origin main

Write-Host "✅ Klart! Kolla GitHub Pages efter 1–2 minuter." -ForegroundColor Green
