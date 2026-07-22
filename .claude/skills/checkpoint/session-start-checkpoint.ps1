# SessionStart(clear)hook:/clear 后检测是否存在"对应当前对话"的 checkpoint,
# 命中则注入一句提示,让模型询问用户是否读回。读回是旁路,任何异常都不阻断会话启动。
#
# 匹配优先级:
#   1) frontmatter 的 session_id == 当前 session_id(精确"对应当前对话")
#   2) 退回时效:最近 30 分钟内 mtime 最新的存档
$ErrorActionPreference = 'Stop'
try {
  $raw = [Console]::In.ReadToEnd()
  $data = if ($raw) { $raw | ConvertFrom-Json } else { $null }
  $sid = if ($data) { [string]$data.session_id } else { '' }
  $cwd = if ($data -and $data.cwd) { [string]$data.cwd } else { (Get-Location).Path }

  $dir = Join-Path $cwd '.claude/checkpoints'
  if (-not (Test-Path $dir)) { exit 0 }
  $files = @(Get-ChildItem -Path $dir -Filter *.md -File -ErrorAction SilentlyContinue)
  if ($files.Count -eq 0) { exit 0 }

  # 1) 按 session_id 精确匹配(读文件头部 frontmatter)
  $match = $null
  if ($sid) {
    foreach ($f in $files) {
      $head = Get-Content -Path $f.FullName -TotalCount 10 -ErrorAction SilentlyContinue
      if ($head -match ('session_id:\s*' + [regex]::Escape($sid))) {
        if ($null -eq $match -or $f.LastWriteTime -gt $match.LastWriteTime) { $match = $f }
      }
    }
  }

  # 2) 退回时效:最近 30 分钟内最新
  if ($null -eq $match) {
    $cutoff = (Get-Date).AddMinutes(-30)
    $match = $files | Where-Object { $_.LastWriteTime -ge $cutoff } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if ($null -eq $match) { exit 0 }

  $msg = "检测到会话 checkpoint:$($match.FullName)。在继续之前,请用 AskUserQuestion " +
         "询问用户是否读回这份存档以接续上一段工作;用户同意后再用 Read 读取其内容,拒绝则正常空白开始。"
  $out = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $msg } } |
    ConvertTo-Json -Compress -Depth 5
  Write-Output $out
  exit 0
} catch {
  exit 0
}
