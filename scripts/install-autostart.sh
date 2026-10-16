#!/usr/bin/env bash
# Install an XDG autostart entry so sokking launches at login.
# Idempotent: re-run after moving the repo. Remove with:
#   rm ~/.config/autostart/sokking.desktop
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
autostart_dir="$HOME/.config/autostart"

electron="$repo/node_modules/electron/dist/electron"
if [ ! -x "$electron" ]; then
  echo "error: $electron がありません。先に npm install を実行してください。" >&2
  exit 1
fi

mkdir -p "$autostart_dir"
cat > "$autostart_dir/sokking.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=sokking
Comment=Claude Code-friendly tabbed terminal
Exec=$electron --no-sandbox $repo
Icon=sokking
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo "installed: $autostart_dir/sokking.desktop (次回ログインから自動起動)"
