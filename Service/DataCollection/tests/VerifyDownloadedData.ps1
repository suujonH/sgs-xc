param(
    [string]$RepoDir = 'E:\ds-sgs\work\sgs-resource',
    [int]$MinManifestResources = 1000,
    [int]$MinVersionResources = 10000,
    [switch]$WriteResultFile
)

$ErrorActionPreference = 'Stop'

$failures = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Message) {
    $script:failures.Add($Message)
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        Add-Failure $Message
    }
}

function Read-JsonFile([string]$Path) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Add-Failure "JSON parse failed: $Path :: $($_.Exception.Message)"
        return $null
    }
}

function Assert-File([string]$Path) {
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    Assert-True $exists "Missing file: $Path"
    return $exists
}

function Assert-Directory([string]$Path) {
    $exists = Test-Path -LiteralPath $Path -PathType Container
    Assert-True $exists "Missing directory: $Path"
    return $exists
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$dataDir = Join-Path $RepoDir 'data'
$manifestPath = Join-Path $dataDir '.collector\outputs.json'

Assert-Directory $dataDir | Out-Null
Assert-File $manifestPath | Out-Null

$manifest = Read-JsonFile $manifestPath
if ($manifest) {
    Assert-True ($manifest.resources.Count -ge $MinManifestResources) "Manifest resources too few: $($manifest.resources.Count), expected >= $MinManifestResources"

    $checkedOutputs = 0
    foreach ($resource in $manifest.resources) {
        foreach ($output in $resource.outputs) {
            $path = Join-Path $RepoDir $output.path
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                Add-Failure "Manifest output missing: $($output.path)"
                continue
            }

            $item = Get-Item -LiteralPath $path
            if ($item.Length -ne [int64]$output.length) {
                Add-Failure "Manifest length mismatch: $($output.path) actual=$($item.Length) expected=$($output.length)"
            }

            $hash = Get-Sha256 $path
            if ($hash -ne $output.sha256) {
                Add-Failure "Manifest sha256 mismatch: $($output.path) actual=$hash expected=$($output.sha256)"
            }

            $checkedOutputs++
        }
    }
}

$h5Root = Join-Path $dataDir 'web.sanguosha.com\220\h5_2'
$requiredFiles = @(
    (Join-Path $h5Root 'index_210000.php'),
    (Join-Path $h5Root 'versionConf.js'),
    (Join-Path $h5Root 'version.json'),
    (Join-Path $h5Root 'res\default.res.json'),
    (Join-Path $h5Root 'res\config\Config_w.sgs\cha_spell.json'),
    (Join-Path $h5Root 'res\config\Config_w.sgs\sys_playcard.json'),
    (Join-Path $h5Root 'res\config\h5_global_conf_w.sgs\h5_global_conf_w.json'),
    (Join-Path $h5Root 'res\proto\Proto_w.sgs\client.proto'),
    (Join-Path $h5Root 'libs\min\laya_a.sgs\laya.core.min.js'),
    (Join-Path $h5Root 'sgsGame_a.sgs\sgsGame_a.js')
)

foreach ($file in $requiredFiles) {
    Assert-File $file | Out-Null
}

$versionJsonPath = Join-Path $h5Root 'version.json'
$versionJson = Read-JsonFile $versionJsonPath
if ($versionJson) {
    $versionCount = ($versionJson.PSObject.Properties | Measure-Object).Count
    Assert-True ($versionCount -ge $MinVersionResources) "version.json resources too few: $versionCount, expected >= $MinVersionResources"
}

$defaultRes = Read-JsonFile (Join-Path $h5Root 'res\default.res.json')
if ($defaultRes) {
    Assert-True ($defaultRes.resources.Count -gt 0) 'default.res.json has no resources'
}

Read-JsonFile (Join-Path $h5Root 'res\config\Config_w.sgs\cha_spell.json') | Out-Null
Read-JsonFile (Join-Path $h5Root 'res\config\Config_w.sgs\sys_playcard.json') | Out-Null
Read-JsonFile (Join-Path $h5Root 'res\config\h5_global_conf_w.sgs\h5_global_conf_w.json') | Out-Null

$protoPath = Join-Path $h5Root 'res\proto\Proto_w.sgs\client.proto'
if (Assert-File $protoPath) {
    $protoHead = Get-Content -LiteralPath $protoPath -TotalCount 1 -Encoding UTF8
    Assert-True ($protoHead -eq 'syntax = "proto3";') "Unexpected proto header: $protoHead"
}

$layaCorePath = Join-Path $h5Root 'libs\min\laya_a.sgs\laya.core.min.js'
if (Assert-File $layaCorePath) {
    $layaText = Get-Content -LiteralPath $layaCorePath -Raw -Encoding UTF8
    Assert-True ($layaText.Contains('CtrUtil')) 'laya.core.min.js does not contain CtrUtil'
}

$sgsGamePath = Join-Path $h5Root 'sgsGame_a.sgs\sgsGame_a.js'
if (Assert-File $sgsGamePath) {
    $sgsGameItem = Get-Item -LiteralPath $sgsGamePath
    Assert-True ($sgsGameItem.Length -gt 1000000) "sgsGame_a.js is unexpectedly small: $($sgsGameItem.Length)"
}

foreach ($packageDir in @(
    (Join-Path $h5Root 'res\config\Config_w.sgs'),
    (Join-Path $h5Root 'res\config\Config.sgs'),
    (Join-Path $h5Root 'res\proto\Proto_w.sgs'),
    (Join-Path $h5Root 'libs\min\laya_a.sgs'),
    (Join-Path $h5Root 'sgsGame_a.sgs')
)) {
    Assert-Directory $packageDir | Out-Null
}

$result = [pscustomobject]@{
    ok = $failures.Count -eq 0
    repoDir = $RepoDir
    manifestResources = if ($manifest) { $manifest.resources.Count } else { 0 }
    checkedManifestOutputs = if ($manifest) { $checkedOutputs } else { 0 }
    versionResources = if ($versionJson) { ($versionJson.PSObject.Properties | Measure-Object).Count } else { 0 }
    failures = $failures.ToArray()
}

if ($WriteResultFile) {
    $resultPath = Join-Path $PSScriptRoot 'last-verify-result.json'
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

$result | ConvertTo-Json -Depth 5

if ($failures.Count -gt 0) {
    exit 1
}
