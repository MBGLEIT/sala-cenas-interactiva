$ErrorActionPreference = "Stop"

try {
  $workers = Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -eq "node.exe" -or $_.Name -eq "cmd.exe") -and
      $_.CommandLine -like "*plan-import-worker.ts*"
    }
} catch {
  Write-Host ("Aviso: Windows no permitio revisar procesos activos: " + $_.Exception.Message)
  exit 0
}

if (-not $workers) {
  Write-Host "No se encontraron workers activos."
  exit 0
}

foreach ($worker in $workers) {
  try {
    Stop-Process -Id $worker.ProcessId -Force -ErrorAction Stop
    Write-Host ("Worker cerrado PID " + $worker.ProcessId)
  } catch {
    Write-Host ("Aviso: no se pudo cerrar PID " + $worker.ProcessId + ": " + $_.Exception.Message)
  }
}
