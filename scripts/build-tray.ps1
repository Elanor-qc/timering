$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler is required to build the tray helper.' }
$outputDirectory = Join-Path $projectRoot 'resources/native'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$trayOutput = Join-Path $outputDirectory 'tray-helper.exe'
$traySource = Join-Path $projectRoot 'native/TrayHelper.cs'
& $compiler /nologo /target:winexe "/out:$trayOutput" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $traySource
if ($LASTEXITCODE -ne 0) { throw 'Tray helper compilation failed.' }
$check = Start-Process -FilePath $trayOutput -ArgumentList '--self-test' -WindowStyle Hidden -Wait -PassThru
if ($check.ExitCode -ne 0) { throw "Tray helper checks failed: $($check.ExitCode)" }
Write-Output 'Tray helper built; left/right click and menu signal checks passed.'
