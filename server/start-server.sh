#!/usr/bin/env sh
# Starts the local model server on Linux or macOS. Leave it running while using Pi.
# Settings: server.json (and server.local.json); tuning notes: README.md here.
exec node "$(dirname "$0")/start-server.mjs" "$@"
