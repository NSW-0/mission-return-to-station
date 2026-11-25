# Creates "Mission Return to Station" shortcuts with the black hole icon.
# Double-clicking the shortcut does the same as start.bat.
# Shortcuts store full paths, so run this again on each laptop (or after moving the folder):
#
#   powershell -ExecutionPolicy Bypass -File launcher\make_shortcut.ps1
#
# It makes one shortcut in the project folder and one on the Desktop.

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'start.bat'
$icon = Join-Path $PSScriptRoot 'mission.ico'
$name = 'Mission Return to Station.lnk'
$places = @($root, [Environment]::GetFolderPath('Desktop'))

$shell = New-Object -ComObject WScript.Shell
foreach ($place in $places) {
    $path = Join-Path $place $name
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $target
    $link.WorkingDirectory = $root
    $link.IconLocation = "$icon,0"
    $link.Description = 'Start Mission: Return to Station (game server, Connect tab and display tab)'
    $link.Save()
    Write-Host "Created $path"
}
