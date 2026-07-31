# One-click XAMPP Apache/MySQL port repair for Windows.
# Run this script from an elevated PowerShell session.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

$XamppRoot = 'C:\xampp'
$ApacheStart = Join-Path $XamppRoot 'apache_start.bat'
$MySqlStart = Join-Path $XamppRoot 'mysql_start.bat'
$Ports = @(80, 443, 3306)

function Write-Step {
    param([string]$Message)
    Write-Host "[Fix-XAMPP] $Message"
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListeningPortOwner {
    param([int[]]$Port)

    $owners = @()

    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        foreach ($p in $Port) {
            try {
                $owners += Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
                    Select-Object @{Name='Port';Expression={$_.LocalPort}},
                                  @{Name='Pid';Expression={$_.OwningProcess}},
                                  @{Name='Address';Expression={$_.LocalAddress}}
            } catch {
                Write-Step "Could not inspect port $p with Get-NetTCPConnection: $($_.Exception.Message)"
            }
        }
    } else {
        $netstat = & netstat.exe -ano -p tcp 2>$null
        foreach ($line in $netstat) {
            foreach ($p in $Port) {
                if ($line -match "^\s*TCP\s+\S+:$p\s+\S+\s+LISTENING\s+(\d+)\s*$") {
                    $owners += [pscustomobject]@{
                        Port = $p
                        Pid = [int]$Matches[1]
                        Address = $null
                    }
                }
            }
        }
    }

    $owners | Where-Object { $_.Pid -and $_.Pid -gt 0 } | Sort-Object Port,Pid -Unique
}

function Get-ProcessDetails {
    param([int]$ProcessId)

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $cim = $null

    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    } catch {
        $cim = $null
    }

    $path = $null
    $name = $null
    $parentPid = $null
    $commandLine = $null

    if ($cim) {
        $path = $cim.ExecutablePath
        $name = $cim.Name
        $parentPid = $cim.ParentProcessId
        $commandLine = $cim.CommandLine
    }

    if (-not $name -and $proc) {
        $name = "$($proc.ProcessName).exe"
    }

    if (-not $path -and $proc) {
        try { $path = $proc.Path } catch { $path = $null }
    }

    [pscustomobject]@{
        Pid = $ProcessId
        Name = $name
        Path = $path
        ParentPid = $parentPid
        CommandLine = $commandLine
        Process = $proc
    }
}

function Get-ServicesForPid {
    param([int]$ProcessId)

    try {
        Get-CimInstance Win32_Service -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    } catch {
        @()
    }
}

function Stop-ServicesForPid {
    param([int]$ProcessId)

    $services = @(Get-ServicesForPid -ProcessId $ProcessId)
    if ($services.Count -eq 0) {
        return $false
    }

    foreach ($service in $services) {
        Write-Step "Stopping service '$($service.Name)' ($($service.DisplayName)) for PID $ProcessId."
        try {
            Stop-Service -Name $service.Name -Force -ErrorAction Stop
            $svc = Get-Service -Name $service.Name -ErrorAction SilentlyContinue
            if ($svc) {
                $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
            }
        } catch {
            Write-Step "Service stop failed for '$($service.Name)': $($_.Exception.Message)"
            try {
                & sc.exe stop $service.Name | Out-Null
                Start-Sleep -Seconds 5
            } catch {
                Write-Step "sc.exe stop also failed for '$($service.Name)': $($_.Exception.Message)"
            }
        }
    }

    Start-Sleep -Seconds 2
    return -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-HttpSysServices {
    param([int[]]$PortsUsed)

    $httpPorts = @($PortsUsed | Where-Object { $_ -in @(80, 443) })
    if ($httpPorts.Count -eq 0) {
        return $false
    }

    Write-Step "PID 4/System is holding HTTP port(s) $(($httpPorts | Sort-Object -Unique) -join ', '). Checking common HTTP.sys/IIS services."

    $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
        $_.Status -eq 'Running' -and (
            $_.Name -in @('W3SVC', 'WAS', 'WMSVC', 'MsDepSvc', 'IISADMIN') -or
            $_.DisplayName -match 'World Wide Web Publishing|Windows Process Activation|Web Management|Web Deployment|IIS Admin|SQL Server Reporting'
        )
    })

    $services = @($services | Sort-Object Name -Unique)

    if ($services.Count -eq 0) {
        Write-Step "No common running HTTP.sys/IIS services were found."
        return $false
    }

    foreach ($service in $services) {
        Write-Step "Stopping HTTP-related service '$($service.Name)' ($($service.DisplayName))."
        try {
            Stop-Service -Name $service.Name -Force -ErrorAction Stop
            $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
        } catch {
            Write-Step "Could not stop service '$($service.Name)': $($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds 3
    $remainingHttpOwners = @(Get-ListeningPortOwner -Port $httpPorts)
    return ($remainingHttpOwners.Count -eq 0)
}

function Stop-ParentIfRelevant {
    param(
        [int]$ProcessId,
        [int]$ParentPid
    )

    if (-not $ParentPid -or $ParentPid -le 4) {
        return $false
    }

    $parent = Get-ProcessDetails -ProcessId $ParentPid
    if (-not $parent.Process) {
        return $false
    }

    $parentName = if ($parent.Name) { $parent.Name.ToLowerInvariant() } else { '' }
    $isRelevantParent = $parentName -in @('httpd.exe', 'mysqld.exe', 'mysqld-nt.exe', 'mariadbd.exe', 'xampp-control.exe')

    if (-not $isRelevantParent) {
        Write-Step "Parent PID $ParentPid is '$($parent.Name)', so it will not be stopped automatically."
        return $false
    }

    Write-Step "Stopping relevant parent process '$($parent.Name)' PID $ParentPid for child PID $ProcessId."
    try {
        Stop-Process -Id $ParentPid -ErrorAction Stop
        Start-Sleep -Seconds 5
    } catch {
        Write-Step "Normal parent termination failed: $($_.Exception.Message)"
        try {
            Stop-Process -Id $ParentPid -Force -ErrorAction Stop
            Start-Sleep -Seconds 3
        } catch {
            Write-Step "Forced parent termination failed: $($_.Exception.Message)"
        }
    }

    return -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-PortOwner {
    param(
        [int]$ProcessId,
        [int[]]$PortsUsed
    )

    $details = Get-ProcessDetails -ProcessId $ProcessId

    if (-not $details.Process) {
        Write-Step "PID $ProcessId is no longer running."
        return $true
    }

    $name = if ($details.Name) { $details.Name } else { $details.Process.ProcessName }
    $path = if ($details.Path) { $details.Path } else { '(path unavailable)' }
    $portText = ($PortsUsed | Sort-Object -Unique) -join ', '

    Write-Step "Port(s) $portText are held by PID ${ProcessId}: $name at $path"

    if ($ProcessId -eq 4 -or $name -eq 'System') {
        if (Stop-HttpSysServices -PortsUsed $PortsUsed) {
            Write-Step "HTTP.sys/System port conflict was cleared."
            return $true
        }

        Write-Step "System PID 4 still owns at least one required port."
        return $false
    }

    $lowerName = $name.ToLowerInvariant()
    $isApacheOrMySql = $lowerName -in @('httpd.exe', 'mysqld.exe', 'mysqld-nt.exe', 'mariadbd.exe')

    if ($isApacheOrMySql) {
        if ($lowerName -eq 'httpd.exe') {
            Write-Step "Detected Apache/httpd conflict on port(s) $portText."
        } else {
            Write-Step "Detected MySQL/MariaDB conflict on port(s) $portText."
        }
    } else {
        Write-Step "Detected non-XAMPP port conflict on port(s) $portText. The owning process will be stopped to free the required XAMPP port(s)."
    }

    if (Stop-ServicesForPid -ProcessId $ProcessId) {
        Write-Step "PID $ProcessId stopped through its owning service."
        return $true
    }

    try {
        Write-Step "Trying normal termination for PID $ProcessId."
        Stop-Process -Id $ProcessId -ErrorAction Stop
        Start-Sleep -Seconds 5
    } catch {
        Write-Step "Normal termination failed for PID ${ProcessId}: $($_.Exception.Message)"

        if (Stop-ServicesForPid -ProcessId $ProcessId) {
            Write-Step "PID $ProcessId stopped after service fallback."
            return $true
        }

        if (Stop-ParentIfRelevant -ProcessId $ProcessId -ParentPid $details.ParentPid) {
            Write-Step "PID $ProcessId stopped after parent-process fallback."
            return $true
        }
    }

    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        Write-Step "PID $ProcessId stopped."
        return $true
    }

    try {
        Write-Step "Trying forced termination for PID $ProcessId."
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Start-Sleep -Seconds 3
    } catch {
        Write-Step "Forced termination failed for PID ${ProcessId}: $($_.Exception.Message)"

        if (Stop-ServicesForPid -ProcessId $ProcessId) {
            Write-Step "PID $ProcessId stopped after final service fallback."
            return $true
        }

        if (Stop-ParentIfRelevant -ProcessId $ProcessId -ParentPid $details.ParentPid) {
            Write-Step "PID $ProcessId stopped after final parent-process fallback."
            return $true
        }
    }

    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        Write-Step "PID $ProcessId is still running."
        return $false
    }

    Write-Step "PID $ProcessId stopped."
    return $true
}

function Clear-XamppPorts {
    $owners = @(Get-ListeningPortOwner -Port $Ports)

    if ($owners.Count -eq 0) {
        Write-Step "Ports 80, 443, and 3306 are already free."
        return
    }

    $groups = $owners | Group-Object Pid
    foreach ($group in $groups) {
        $pidValue = [int]$group.Name
        $portsUsed = @($group.Group | Select-Object -ExpandProperty Port -Unique)
        [void](Stop-PortOwner -ProcessId $pidValue -PortsUsed $portsUsed)
    }
}

function Test-PortsFree {
    $owners = @(Get-ListeningPortOwner -Port $Ports)
    if ($owners.Count -eq 0) {
        return $true
    }

    foreach ($owner in $owners) {
        $details = Get-ProcessDetails -ProcessId $owner.Pid
        $name = if ($details.Name) { $details.Name } else { '(unknown)' }
        Write-Step "Port $($owner.Port) is still held by PID $($owner.Pid): $name"
    }

    return $false
}

function Start-XamppComponent {
    param(
        [string]$Name,
        [string]$ScriptPath
    )

    if (-not (Test-Path -LiteralPath $ScriptPath)) {
        Write-Step "$Name start script not found: $ScriptPath"
        return
    }

    Write-Step "Starting XAMPP $Name with $ScriptPath"
    try {
        $process = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList @('/c', "`"$ScriptPath`"") `
            -WorkingDirectory $XamppRoot `
            -WindowStyle Hidden `
            -PassThru `
            -ErrorAction Stop

        $process.WaitForExit(30000)
    } catch {
        Write-Step "Failed to start XAMPP ${Name}: $($_.Exception.Message)"
    }
}

function Test-PortRunning {
    param([int[]]$Port)
    $owners = @(Get-ListeningPortOwner -Port $Port)
    return ($owners.Count -gt 0)
}

function Test-XamppProcessOnPorts {
    param(
        [int[]]$Port,
        [string[]]$ProcessNames
    )

    $owners = @(Get-ListeningPortOwner -Port $Port)
    if ($owners.Count -eq 0) {
        return $false
    }

    foreach ($owner in $owners) {
        $details = Get-ProcessDetails -ProcessId $owner.Pid
        $name = if ($details.Name) { $details.Name.ToLowerInvariant() } else { '' }
        $path = if ($details.Path) { $details.Path.ToLowerInvariant() } else { '' }
        $isExpectedName = $ProcessNames -contains $name
        $isXamppPath = $path.StartsWith($XamppRoot.ToLowerInvariant())

        if (-not ($isExpectedName -and $isXamppPath)) {
            return $false
        }
    }

    return $true
}

Write-Step "Starting automatic XAMPP repair."

if (-not (Test-Administrator)) {
    Write-Host ""
    Write-Host "ERROR: This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell and choose 'Run as administrator', then run this script again."
    exit 1
}

if (-not (Test-Path -LiteralPath $XamppRoot)) {
    Write-Host ""
    Write-Host "ERROR: XAMPP was not found at $XamppRoot" -ForegroundColor Red
    exit 1
}

Write-Step "Cleaning up listeners on ports 80, 443, and 3306."
Clear-XamppPorts

Write-Step "Verifying required ports are free before starting XAMPP."
$portsFree = Test-PortsFree

if (-not $portsFree) {
    Write-Host ""
    Write-Host "ERROR: One or more required ports could not be freed. XAMPP will not be started." -ForegroundColor Red
    Write-Host ""
    Write-Host "Final status:"
    Write-Host "Apache: Failed"
    Write-Host "MySQL: Failed"
    exit 2
}

Write-Step "Ports are free."

Start-XamppComponent -Name 'Apache' -ScriptPath $ApacheStart
Start-Sleep -Seconds 5

Start-XamppComponent -Name 'MySQL' -ScriptPath $MySqlStart
Start-Sleep -Seconds 8

$apacheRunning = Test-XamppProcessOnPorts -Port @(80, 443) -ProcessNames @('httpd.exe')
$mysqlRunning = Test-XamppProcessOnPorts -Port @(3306) -ProcessNames @('mysqld.exe', 'mysqld-nt.exe', 'mariadbd.exe')

Write-Host ""
Write-Host "Final status:"
if ($apacheRunning) {
    Write-Host "Apache: Running" -ForegroundColor Green
} else {
    Write-Host "Apache: Failed" -ForegroundColor Red
}

if ($mysqlRunning) {
    Write-Host "MySQL: Running" -ForegroundColor Green
} else {
    Write-Host "MySQL: Failed" -ForegroundColor Red
}

if ($apacheRunning -and $mysqlRunning) {
    exit 0
}

exit 3
