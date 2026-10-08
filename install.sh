#!/bin/sh
# writing-flow installer shim. All logic lives in install.mjs so it is not maintained twice.
set -e
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$here/install.mjs" "$@"
