[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$bootstrapPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$desktopEnvironment = Join-Path $projectRoot ".desktop-venv"
$python = Join-Path $desktopEnvironment "Scripts\python.exe"

if (-not (Test-Path $bootstrapPython)) {
    throw "Python virtual environment not found: $bootstrapPython"
}

Push-Location $projectRoot
try {
    if (-not $SkipInstall) {
        if (-not (Test-Path $python)) {
            & $bootstrapPython -m venv $desktopEnvironment
            if ($LASTEXITCODE -ne 0) { throw "Desktop build environment creation failed" }
        }
        & $python -m pip install -r requirements-desktop.txt
        if ($LASTEXITCODE -ne 0) { throw "Desktop dependency installation failed" }
    } elseif (-not (Test-Path $python)) {
        throw "Desktop build environment not found: $desktopEnvironment"
    }

    npm --prefix web run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

    & $python -m PyInstaller --clean --noconfirm LoraLoom.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }

    $executable = Join-Path $projectRoot "dist\LoraLoom\LoraLoom.exe"
    if (-not (Test-Path $executable)) {
        throw "Desktop executable was not created: $executable"
    }

    $healthData = Join-Path $projectRoot "tmp\desktop-build-health"
    $previousDataDirectory = $env:LORALOOM_DATA_DIR
    try {
        $env:LORALOOM_DATA_DIR = $healthData
        $healthCheck = Start-Process -FilePath $executable -ArgumentList "--health-check" -Wait -PassThru
        if ($healthCheck.ExitCode -ne 0) {
            throw "Packaged desktop health check failed with exit code $($healthCheck.ExitCode)"
        }
    }
    finally {
        $env:LORALOOM_DATA_DIR = $previousDataDirectory
    }
    Write-Host "Desktop package created: $executable"
    Write-Host "Packaged desktop health check passed"
}
finally {
    Pop-Location
}