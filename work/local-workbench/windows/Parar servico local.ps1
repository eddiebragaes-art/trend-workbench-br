# Modificado para trend-workbench-br: mensagens traduzidas para o português.
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$nodePath = Join-Path $appDirectory 'runtime\node.exe'
$serverPath = Join-Path $appDirectory 'server.mjs'
$response = $null
$reader = $null
try {
    $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:43127/health')
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    $response = $request.GetResponse()
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    $buffer = New-Object char[] 4096
    $length = $reader.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -eq $buffer.Length) { throw 'O serviço respondeu com uma identidade inesperada. Nenhum processo foi encerrado.' }
    $body = New-Object string($buffer, 0, $length)
    $health = $body | ConvertFrom-Json
    if ($health.app -ne 'trend-workbench' -or $health.version -ne '1.3-local') { throw 'A porta está sendo usada por outro serviço. Nenhum processo foi encerrado.' }
    $serverPid = 0
    if (![int]::TryParse([string]$health.pid, [ref]$serverPid) -or $serverPid -le 0) { throw 'Informações do processo do serviço inválidas.' }
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $serverPid)
    if ($null -eq $process -or [string]::IsNullOrWhiteSpace($process.ExecutablePath) -or [string]::IsNullOrWhiteSpace($process.CommandLine)) { throw 'Não foi possível verificar o processo do serviço. Nenhum processo foi encerrado.' }
    if (![string]::Equals([IO.Path]::GetFullPath($process.ExecutablePath), $nodePath, [StringComparison]::OrdinalIgnoreCase)) { throw 'O processo não pertence a esta estação. Nenhum processo foi encerrado.' }
    if (!('TrendWorkbenchStopArgs' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrendWorkbenchStopArgs {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CommandLineToArgvW(string text, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    public static string[] Split(string text) {
        int count; IntPtr values=CommandLineToArgvW(text,out count);
        if(values==IntPtr.Zero) throw new InvalidOperationException("Cannot parse process arguments.");
        try { string[] args=new string[count]; for(int i=0;i<count;i++) args[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(values,i*IntPtr.Size)); return args; }
        finally { LocalFree(values); }
    }
}
'@
    }
    $arguments = [TrendWorkbenchStopArgs]::Split($process.CommandLine)
    if ($arguments.Length -ne 4 -or $arguments[2] -ne '--port' -or $arguments[3] -ne '43127' -or ![IO.Path]::IsPathRooted($arguments[1])) { throw 'Os parâmetros de inicialização do processo não conferem. Nenhum processo foi encerrado.' }
    if (![string]::Equals([IO.Path]::GetFullPath($arguments[1]), $serverPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'O processo não está executando o serviço desta estação. Nenhum processo foi encerrado.' }
    Stop-Process -Id $serverPid -ErrorAction Stop
    Write-Output 'O serviço local da Estação de Tendências foi encerrado. Ele inicia de novo automaticamente na próxima vez que você abrir o programa.'
    if (!$Quiet) { Read-Host 'Pressione Enter para fechar' | Out-Null }
}
catch [Net.WebException] {
    Write-Output 'O serviço local não está em execução ou não respondeu. Nenhum processo foi encerrado.'
    if (!$Quiet) { Read-Host 'Pressione Enter para fechar' | Out-Null }
}
catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    if (!$Quiet) { Read-Host 'Pressione Enter para fechar' | Out-Null }
    exit 1
}
finally {
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $response) { $response.Dispose() }
}
