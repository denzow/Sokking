#!/usr/bin/env bash
# Install a desktop entry + icon for repo-launched sokking.
#
# GNOME resolves the dock/taskbar icon from a .desktop file matched via
# WM_CLASS ("sokking") — the BrowserWindow icon option alone does not
# change it. This installs into ~/.local/share so the running-from-repo
# app gets a proper icon and can be launched/pinned from the dock.
# Idempotent: re-run after changing resources/icon.* or moving the repo.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apps_dir="$HOME/.local/share/applications"
icon_dir="$HOME/.local/share/icons/hicolor"

electron="$repo/node_modules/electron/dist/electron"
if [ ! -x "$electron" ]; then
  echo "error: $electron がありません。先に npm install を実行してください。" >&2
  exit 1
fi

mkdir -p "$apps_dir" "$icon_dir/512x512/apps" "$icon_dir/scalable/apps"
cp "$repo/resources/icon.png" "$icon_dir/512x512/apps/sokking.png"
cp "$repo/resources/icon.svg" "$icon_dir/scalable/apps/sokking.svg"

cat > "$apps_dir/sokking.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=sokking
Comment=Claude Code-friendly tabbed terminal
Exec=$electron --no-sandbox $repo
Icon=sokking
Terminal=false
Categories=Utility;TerminalEmulator;
StartupWMClass=sokking
EOF

update-desktop-database "$apps_dir" 2>/dev/null || true
gtk-update-icon-cache -f "$icon_dir" 2>/dev/null || true

echo "installed: $apps_dir/sokking.desktop"
echo "installed: $icon_dir/512x512/apps/sokking.png, $icon_dir/scalable/apps/sokking.svg"
