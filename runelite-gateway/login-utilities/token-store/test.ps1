$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$testProgram = Join-Path $PSScriptRoot 'TokenStoreTests.exe'
& $compiler /nologo /target:exe /main:TokenStoreTests /reference:System.Security.dll ("/out:" + $testProgram) (Join-Path $PSScriptRoot 'TokenStore.cs') (Join-Path $PSScriptRoot 'TokenStoreTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Token store tests did not compile.' }
& $testProgram
if ($LASTEXITCODE -ne 0) { throw 'Token store tests failed.' }
