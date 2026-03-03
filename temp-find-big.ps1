Get-ChildItem -Path "C:\gravityclaw" -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.Length -gt 1MB } | 
    Sort-Object Length -Descending | 
    Select-Object -First 20 FullName, Length
