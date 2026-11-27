# Opens the game's ports (TCP 3000-3010) so phones on the same Wi-Fi / hotspot can connect.
# - Works on ALL network types: a new Wi-Fi or a phone hotspot is usually marked "Public"
#   by Windows, and a Private-only rule silently blocks every phone there.
# - Removes inbound BLOCK rules that Windows creates for node.exe when someone pressed
#   "Cancel" on the firewall prompt (a block rule beats any allow rule).
# Must run as administrator.  -Check only reports: exit 0 = all good, exit 1 = needs fixing.
param([switch]$Check, [string]$NodeExe = '')

$rule  = 'HoroofMaaHussein-Ports'
$ports = '3000-3010'

function Get-NodeBlockRules {
  $paths = @()
  if ($NodeExe) { $paths += $NodeExe }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $paths += $cmd.Source }
  $paths = $paths | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique
  if (-not $paths) { return @() }
  Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue | Where-Object {
    $p = ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program
    $p -and ($paths -contains $p.ToLowerInvariant())
  }
}

function Test-Good {
  $r = Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
  if (-not $r) { return $false }
  if (@($r | Where-Object { $_.Enabled -eq 'True' -and $_.Profile -eq 'Any' }).Count -eq 0) { return $false }
  if (@(Get-NodeBlockRules).Count -gt 0) { return $false }
  return $true
}

if ($Check) { if (Test-Good) { exit 0 } else { exit 1 } }

Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
$out = & netsh advfirewall firewall add rule name=$rule dir=in action=allow protocol=TCP localport=$ports profile=any 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host ('  [!] Could not add the firewall rule: ' + ($out | Out-String).Trim())
  exit 1
}
Write-Host ('  [ok] Firewall rule added (TCP ' + $ports + ', all networks incl. hotspots).')

$blocks = @(Get-NodeBlockRules)
if ($blocks.Count -gt 0) {
  $blocks | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  Write-Host ('  [ok] Removed ' + $blocks.Count + ' Windows rule(s) that were blocking Node.')
}
exit 0
