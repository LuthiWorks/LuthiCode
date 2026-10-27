#!/usr/bin/env sh
# Installs LuthiCode's Pi setup into ~/.pi/agent on Linux or macOS. See install.mjs.
exec node "$(dirname "$0")/install.mjs" "$@"
