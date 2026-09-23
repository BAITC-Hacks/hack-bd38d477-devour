#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Не найден $PYTHON_BIN. Установите Python 3.11 или новее." >&2
    exit 1
fi

if [ ! -d .venv ]; then
    echo "Создаём виртуальное окружение .venv"
    "$PYTHON_BIN" -m venv .venv
fi

VENV_PYTHON=".venv/bin/python"

echo "Устанавливаем зависимости из requirements.txt"
"$VENV_PYTHON" -m pip install --quiet --disable-pip-version-check -r requirements.txt

if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo "Создан .env из .env.example. Без ключа OPENAI_API_KEY анализ работает в режиме fallback."
fi

echo "Симулятор доступен на http://localhost:${PORT}"
exec "$VENV_PYTHON" -m uvicorn api.main:app --host "$HOST" --port "$PORT"
