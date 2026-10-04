#!/bin/sh
# For each PR head 42-71 of the gateway repo, fetch the HUD Lua files from raw.githubusercontent.com
# and count case-insensitive "put back" matches. Prints one line per PR: number, sha, per-file counts.
R=jimjohnbeebe-jpg/lrc_autonomous_gateway
awk '{print $1, $2}' pr-heads.txt | sed 's#refs/pull/##;s#/head##' | while read sha n; do
  [ "$n" -ge 42 ] && [ "$n" -le 71 ] || continue
  line="#$n ${sha%${sha#???????}}"
  for f in HudView.lua HudText.lua Hud.lua HudState.lua Info.lua; do
    body=$(curl -sS -f "https://raw.githubusercontent.com/$R/$sha/plugin/LrC-AVG.lrplugin/$f" 2>/dev/null)
    if [ $? -ne 0 ]; then line="$line $f:absent"; else
      c=$(printf '%s' "$body" | grep -ci "put back"); line="$line $f:$c"; fi
  done
  echo "$line"
done
