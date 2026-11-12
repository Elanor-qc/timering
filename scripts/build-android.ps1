param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$properties = @{}
$propertiesFile = Join-Path $androidRoot 'local.properties'
if (Test-Path -LiteralPath $propertiesFile) {
    foreach ($line in Get-Content -LiteralPath $propertiesFile) {
        if ($line -match '^([a-z.]+)=(.+)$') {
            $properties[$Matches[1]] = $Matches[2].Trim().Replace('\\', '\').Replace('\:', ':')
        }
    }
}
if (-not $env:JAVA_HOME) {
    $javaCandidates = @($properties['java.home'], 'C:/Program Files/Android/Android Studio/jbr')
    foreach ($candidate in $javaCandidates) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'bin/java.exe'))) {
            $env:JAVA_HOME = $candidate
            break
        }
    }
}
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 17, or add java.home to android/local.properties.' }

# Reuse a downloaded copy when available; the checked-in wrapper remains the
# portable fallback for another computer.
$gradleCache = if ($env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME } else { Join-Path $env:USERPROFILE '.gradle' }
$distribution = Join-Path $gradleCache 'wrapper/dists/gradle-8.11.1-bin'
$gradleCommand = Join-Path $androidRoot 'gradlew.bat'
if (Test-Path -LiteralPath $distribution) {
    foreach ($directory in Get-ChildItem -LiteralPath $distribution -Directory) {
        $cached = Join-Path $directory.FullName 'gradle-8.11.1/bin/gradle.bat'
        if (Test-Path -LiteralPath $cached) { $gradleCommand = $cached; break }
    }
}
$buildArguments = @('-p', $androidRoot, 'assembleDebug', 'testDebugUnitTest', 'lintDebug')
if ($Offline) { $buildArguments += '--offline' }
& $gradleCommand @buildArguments
if ($LASTEXITCODE -ne 0) { throw 'Android build or checks failed.' }

$outputDirectory = Join-Path $projectRoot 'dist-android'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$apkPath = Join-Path $outputDirectory 'timering-android-debug.apk'
Copy-Item -LiteralPath (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk') -Destination $apkPath -Force
Write-Output "APK ready: $apkPath"
