#!/usr/bin/env sh
# Inicia la app en macOS o Linux: ./iniciar.sh
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install || exit 1
exec npm start
