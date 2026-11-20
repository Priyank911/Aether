param([ValidateSet('protect', 'unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Mode -eq 'protect') {
        $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
    } else {
        $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
    [Console]::Error.Write('DPAPI operation failed')
    exit 1
}
