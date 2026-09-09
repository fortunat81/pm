Set-Location (Join-Path $PSScriptRoot "..")
docker compose up -d --build
Write-Host "Server running at http://localhost:8000"
