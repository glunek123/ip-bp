@ECHO OFF
SETLOCAL
FOR /F "usebackq delims=" %%V IN ("%~dp0..\..\.node-version") DO SET "TASK_NODE_VERSION=%%V"
CALL "%LOCALAPPDATA%\dev-cor-runtime\node-v%TASK_NODE_VERSION%-win-x64\corepack.cmd" pnpm %*
