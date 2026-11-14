# Кадр в shots/<размер>/<имя>.jpg. Снимок статического макета без Electron (лёгкий Edge headless), 1280×720 и 2560×1080.
# powershell -File docs/design/identity/shoot.ps1 achievements-a.html ach-a [query] [профиль Edge]
param([string]$Page, [string]$Name, [string]$Query = '', [string]$Profile = "$env:TEMP\asterion-mockup-edge")
$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'file:///' + ($root -replace '\\', '/') + "/mockups/$Page$Query"
foreach ($size in @(@(1280, 720), @(2560, 1080))) {
  $w = $size[0]; $h = $size[1]
  $dir = Join-Path $root "shots\${w}x$h"; New-Item -ItemType Directory -Force $dir | Out-Null
  $out = Join-Path $dir "$Name.png"
  # окно больше на 24×93 (рамка окна Edge), потом обрезка до точного размера
  Start-Process -FilePath $edge -Wait -NoNewWindow -RedirectStandardError "$env:TEMP\asterion-edge.err" -ArgumentList @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', "--user-data-dir=$Profile",
    "--window-size=$($w + 24),$($h + 93)", '--virtual-time-budget=6000', "--screenshot=$out", $url)
  python -c "from PIL import Image; import sys; p=sys.argv[1]; import os; Image.open(p).convert('RGB').crop((0,0,$w,$h)).save(p[:-4]+'.jpg', 'JPEG', quality=88, optimize=True); os.remove(p)" $out
}
