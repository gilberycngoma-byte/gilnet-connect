$ErrorActionPreference = "Stop"

$keyDirectory = Join-Path $env:USERPROFILE ".gilnet\android"
$keystorePath = Join-Path $keyDirectory "gpm-connect-release.p12"
$passwordPath = Join-Path $keyDirectory "release-password.dpapi"

if (Test-Path $keystorePath) {
  throw "A keystore already exists at $keystorePath. Do not overwrite an existing signing key."
}
if (Test-Path $passwordPath) {
  throw "An encrypted signing password already exists at $passwordPath. Resolve the existing key setup before creating another."
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

$keytoolPath = Join-Path $javaHome "bin\keytool.exe"
if (-not (Test-Path $keytoolPath)) {
  throw "keytool.exe was not found in the selected Java installation."
}

New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$randomBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $random.GetBytes($randomBytes)
} finally {
  $random.Dispose()
}
$password = [Convert]::ToBase64String($randomBytes)
[Array]::Clear($randomBytes, 0, $randomBytes.Length)

$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
$protectedPassword = ConvertFrom-SecureString -SecureString $securePassword
Set-Content -LiteralPath $passwordPath -Value $protectedPassword -Encoding Ascii -NoNewline

$env:JAVA_HOME = $javaHome
$env:PATH = "$(Join-Path $javaHome 'bin');$env:PATH"
$env:ANDROID_KEYSTORE_PASSWORD = $password
$env:ANDROID_KEY_PASSWORD = $password
try {
  & $keytoolPath -genkeypair -v `
    -keystore $keystorePath `
    -storetype PKCS12 `
    -storepass:env ANDROID_KEYSTORE_PASSWORD `
    -keypass:env ANDROID_KEY_PASSWORD `
    -keyalg RSA `
    -keysize 3072 `
    -validity 10000 `
    -alias gilnet-gpm-connect `
    -dname "CN=GILNET GPM, O=GILNET, C=ZM"

  if ($LASTEXITCODE -ne 0) {
    throw "Keystore creation failed."
  }
} finally {
  Remove-Item Env:ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Output "Keystore created outside the project at $keystorePath"
Write-Output "Its generated password is DPAPI-encrypted for this Windows account at $passwordPath."
Write-Output "Back up the keystore and maintain access to this Windows account for future releases. Never commit or email either file."
