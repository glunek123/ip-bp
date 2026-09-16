# Dot-source before project commands: . .\Use-ProjectRuntime.ps1
$taskNodeVersion = (Get-Content (Join-Path $PSScriptRoot '.node-version') -Raw).Trim()
$taskNodeDirectory = Join-Path $env:LOCALAPPDATA "dev-cor-runtime/node-v$taskNodeVersion-win-x64"
$taskNodeExecutable = Join-Path $taskNodeDirectory 'node.exe'
if (-not (Test-Path -LiteralPath $taskNodeExecutable)) {
    throw "Project Node runtime missing: $taskNodeExecutable. See docs/environment.md."
}
$taskActualVersion = & $taskNodeExecutable --version
if ($taskActualVersion -ne "v$taskNodeVersion") {
    throw "Unexpected Node version: $taskActualVersion"
}
$taskPnpmShimDirectory = Join-Path $PSScriptRoot 'tools/project-runtime'
$env:Path = "$taskPnpmShimDirectory;$taskNodeDirectory;$env:Path"
Write-Host "Project Node: $taskActualVersion ($taskNodeExecutable)"
