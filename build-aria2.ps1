<#
.SYNOPSIS
    aria2c.exe のスタティックビルドスクリプト（MSYS2使用）
    
.DESCRIPTION
    MSYS2 環境を使って aria2 を Windows 向けにスタティックビルドし、
    resources/bin/aria2c.exe に配置する。
    CI/CD (GitHub Actions) でも使用可能。
    
.PARAMETER Version
    ビルドする aria2 のバージョン（デフォルト: 1.37.0）

.PARAMETER OutputDir
    出力先ディレクトリ（デフォルト: resources/bin）

.PARAMETER UsePrebuilt
    ソースビルドの代わりにGitHubリリースのプリビルトバイナリを使用
#>

param(
    [string]$Version = "1.37.0",
    [string]$OutputDir = "$PSScriptRoot\resources\bin",
    [switch]$UsePrebuilt
)

$ErrorActionPreference = "Stop"

# 出力ディレクトリ作成
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$aria2cPath = Join-Path $OutputDir "aria2c.exe"

# --- プリビルト版を使用 ---
if ($UsePrebuilt) {
    Write-Host "[aria2] Downloading pre-built aria2c.exe v$Version ..." -ForegroundColor Cyan
    $zipUrl = "https://github.com/aria2/aria2/releases/download/release-$Version/aria2-$Version-win-64bit-build1.zip"
    $tempZip = Join-Path $env:TEMP "aria2-$Version.zip"
    $tempExtract = Join-Path $env:TEMP "aria2-extract"

    Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip
    
    if (Test-Path $tempExtract) {
        Remove-Item $tempExtract -Recurse -Force
    }
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

    # aria2c.exe を探す
    $exeFile = Get-ChildItem -Path $tempExtract -Recurse -Filter "aria2c.exe" | Select-Object -First 1
    if (-not $exeFile) {
        throw "aria2c.exe not found in archive"
    }
    Copy-Item $exeFile.FullName -Destination $aria2cPath -Force

    # クリーンアップ
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

    $size = (Get-Item $aria2cPath).Length / 1MB
    Write-Host "[aria2] Done! $aria2cPath ($([math]::Round($size, 1)) MB)" -ForegroundColor Green
    exit 0
}

# --- MSYS2 ソースビルド ---
Write-Host "[aria2] Building aria2 v$Version from source (static) ..." -ForegroundColor Cyan

$msys2 = "C:\msys64\usr\bin\bash.exe"
if (-not (Test-Path $msys2)) {
    throw "MSYS2 not found at C:\msys64. Install MSYS2 first."
}

$buildScript = @"
set -e
pacman -Syu --noconfirm
pacman -S --noconfirm --needed \
  mingw-w64-x86_64-toolchain \
  mingw-w64-x86_64-cmake \
  mingw-w64-x86_64-c-ares \
  mingw-w64-x86_64-openssl \
  mingw-w64-x86_64-libssh2 \
  mingw-w64-x86_64-libxml2 \
  mingw-w64-x86_64-zlib \
  mingw-w64-x86_64-sqlite3 \
  autoconf automake libtool pkg-config gettext-devel

cd /tmp
if [ ! -d "aria2-$Version" ]; then
  curl -LO https://github.com/aria2/aria2/releases/download/release-$Version/aria2-$Version.tar.xz
  tar xf aria2-$Version.tar.xz
fi
cd aria2-$Version

autoreconf -i 2>/dev/null || true

ARIA2_STATIC=yes \
CXXFLAGS="-Os -s" \
LDFLAGS="-static -static-libgcc -static-libstdc++" \
./configure \
  --host=x86_64-w64-mingw32 \
  --prefix=/tmp/aria2-install \
  --without-included-gettext \
  --disable-nls \
  --with-libcares \
  --with-openssl \
  --with-libssh2 \
  --with-sqlite3 \
  --with-libxml2 \
  --with-zlib \
  --enable-static \
  --disable-shared \
  ARIA2_STATIC=yes

make -j\$(nproc)
make install-strip
"@

$buildScript | & $msys2 --login -c "cat | bash"

$msys2InstallPath = "C:\msys64\tmp\aria2-install\bin\aria2c.exe"
if (-not (Test-Path $msys2InstallPath)) {
    throw "Build failed: $msys2InstallPath not found"
}

Copy-Item $msys2InstallPath -Destination $aria2cPath -Force

Write-Host "[aria2] Checking dependencies..." -ForegroundColor Yellow
& "C:\msys64\usr\bin\bash.exe" --login -c "ldd /tmp/aria2-install/bin/aria2c.exe 2>&1 || true"

$size = (Get-Item $aria2cPath).Length / 1MB
Write-Host "[aria2] Static build done! $aria2cPath ($([math]::Round($size, 1)) MB)" -ForegroundColor Green
