$ErrorActionPreference = "Stop"

$keystorePath = Join-Path $env:USERPROFILE ".gilnet\android\gpm-connect-release.p12"
$passwordPath = Join-Path $env:USERPROFILE ".gilnet\android\release-password.dpapi"
if (-not (Test-Path $keystorePath)) {
  throw "Create the release keystore first with .\scripts\create-android-keystore.ps1."
}

function Get-SecretText([securestring]$secure) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-SecretText([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  return Get-SecretText $secure
}

function Test-Java21([string]$javaHome) {
  $javaPath = Join-Path $javaHome "bin\java.exe"
  if (-not (Test-Path $javaPath)) {
    return $false
  }

  $version = [regex]::Match((Split-Path $javaHome -Leaf), '^jdk-(\d+)')
  return $version.Success -and [int]$version.Groups[1].Value -ge 21
}

$javaHome = $env:JAVA_HOME
if (-not $javaHome -or -not (Test-Java21 $javaHome)) {
  $adoptiumDirectory = Join-Path $env:ProgramFiles "Eclipse Adoptium"
  $installedJdks = Get-ChildItem $adoptiumDirectory -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^jdk-(\d+)' -and [int]$Matches[1] -ge 21 } |
    Sort-Object { [int]([regex]::Match($_.Name, '^jdk-(\d+)').Groups[1].Value) } -Descending
  $javaHome = $installedJdks |
    Where-Object { Test-Java21 $_.FullName } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $javaHome) {
  throw "Java 21 or newer is required. Install it or set JAVA_HOME, then retry."
}
$env:JAVA_HOME = $javaHome
$env:PATH = "$(Join-Path $javaHome 'bin');$env:PATH"

$sdkPath = $env:ANDROID_HOME
if (-not $sdkPath) {
  $sdkPath = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not (Test-Path (Join-Path $sdkPath "platforms"))) {
  throw "Android SDK was not found. Set ANDROID_HOME to the SDK location."
}
$env:ANDROID_HOME = $sdkPath
$env:ANDROID_SDK_ROOT = $sdkPath
$env:PATH = "$(Join-Path $sdkPath 'platform-tools');$env:PATH"

$env:ANDROID_KEYSTORE_PATH = $keystorePath
$env:ANDROID_KEY_ALIAS = "gilnet-gpm-connect"
if (Test-Path $passwordPath) {
  $protectedPassword = Get-Content -LiteralPath $passwordPath -Raw
  $securePassword = ConvertTo-SecureString -String $protectedPassword
  $password = Get-SecretText $securePassword
  $env:ANDROID_KEYSTORE_PASSWORD = $password
  $env:ANDROID_KEY_PASSWORD = $password
} else {
  $env:ANDROID_KEYSTORE_PASSWORD = Read-SecretText "Keystore password"
  $env:ANDROID_KEY_PASSWORD = Read-SecretText "Key password"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  npm.cmd run android:build
  if ($LASTEXITCODE -ne 0) {
    throw "Android release build failed."
  }
} finally {
  Pop-Location
  Remove-Item Env:ANDROID_KEYSTORE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:ANDROID_KEY_ALIAS -ErrorAction SilentlyContinue
  Remove-Item Env:ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
