#!/usr/bin/env bash
# Reprocessa os CSV de dados/entrada e atualiza o site (não precisa reiniciar o serviço).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$DIR/.venv/bin/python"; [[ -x "$PY" ]] || PY=python3
"$PY" "$DIR/processar.py" "$@"
id monitor >/dev/null 2>&1 && chown -R monitor:monitor "$DIR/web/dados" 2>/dev/null || true
echo ">> Site atualizado. Recarregue a página no navegador."
