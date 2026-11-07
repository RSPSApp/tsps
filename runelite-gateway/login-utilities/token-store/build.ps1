param([string]$Output = (Join-Path $PSScriptRoot 'LoginUtilities.TokenStore.exe'))
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Security.dll ("/out:" + $Output) (Join-Path $PSScriptRoot 'TokenStore.cs')
if ($LASTEXITCODE -ne 0) { throw 'Token store build failed.' }
