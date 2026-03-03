# Force remove directory
$dir = "D:\gravityclaw"
if (Test-Path $dir) {
    # Use cmd to force delete
    cmd /c "rd /s /q $dir"
    Start-Sleep -Seconds 2
}

# Clone from GitHub
Set-Location "D:\"
git clone https://github.com/rfammon/gravity-claw gravityclaw

# Install dependencies
Set-Location "D:\gravityclaw"
npm install

Write-Host "Done!"
