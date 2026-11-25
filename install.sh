#!/bin/sh
# Builds the impact viewer, installs its toggle into Rex's config directory, and reloads Rex.
set -eu

plugin_dir=$(cd -- "$(dirname -- "$0")" && pwd)
init_file=${REX_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/rex/init.lua}
config_dir=$(dirname -- "$init_file")
settings_file=$config_dir/rexystele.lua
toggle_file=$config_dir/rexystele_toggle.lua
require_line='require("rexystele")'

rexystele_bin=${REXYSTELE_BIN:-$plugin_dir/bin/rexystele}
if [ -z "${REXYSTELE_BIN:-}" ]; then
  if command -v bun >/dev/null 2>&1; then
    (cd "$plugin_dir" && bun build src/main.ts --compile --outfile bin/rexystele >/dev/null)
    echo "built $rexystele_bin"
  elif [ ! -x "$rexystele_bin" ]; then
    echo "bun is not on PATH, so the viewer cannot be built. Install it (brew install bun)." >&2
    exit 1
  fi
fi

stele_bin=${STELE_BIN:-$(command -v stele || true)}
git_bin=${GIT_BIN:-$(command -v git || echo git)}
if [ -z "$stele_bin" ]; then
  echo "stele is not on PATH, so there is nothing to show. Install Stele and run this again." >&2
  exit 1
fi

lua_quoted() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

mkdir -p "$config_dir"

{
  echo "-- install.sh of RexyStele writes this file. Do not edit it. Your settings are in rexystele.lua."
  echo "local REXYSTELE_BIN = \"$(lua_quoted "$rexystele_bin")\""
  echo "local STELE_BIN = \"$(lua_quoted "$stele_bin")\""
  echo "local GIT_BIN = \"$(lua_quoted "$git_bin")\""
  echo
  cat "$plugin_dir/lua/rexystele_toggle.lua"
} > "$toggle_file"
echo "wrote $toggle_file"

if [ -e "$settings_file" ]; then
  echo "kept your settings in $settings_file"
else
  cp "$plugin_dir/lua/rexystele.lua" "$settings_file"
  echo "wrote $settings_file with your settings"
fi

if ! grep -qF "$require_line" "$init_file" 2>/dev/null; then
  if [ -s "$init_file" ] && [ -n "$(tail -c 1 "$init_file")" ]; then
    echo >> "$init_file"
  fi
  echo "$require_line" >> "$init_file"
  echo "added $require_line to $init_file"
fi

if rex config reload >/dev/null 2>&1; then
  echo "reloaded Rex's config"
else
  echo "reload Rex's config yourself: rex config reload" >&2
fi
echo "press shift+cmd+e, or run \"Toggle Stele intent impact\" from the command palette"
