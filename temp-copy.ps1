# Copy project to D drive
$source = "C:\gravityclaw"
$dest = "D:\gravityclaw"

# Create destination if not exists
if (!(Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest -Force
}

# Copy all files
Copy-Item -Path "$source\*" -Destination $dest -Recurse -Force

Write-Host "Copy complete!"
Write-Host "Total files in destination:"
(Get-ChildItem -Path $dest -Recurse -File).Count
