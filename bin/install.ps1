# writing-flow installer shim. All logic lives in install.mjs so it is not maintained twice.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $here 'install.mjs') @args
exit $LASTEXITCODE
