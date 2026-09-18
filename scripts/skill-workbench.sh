#!/usr/bin/env bash
# skill-workbench.sh — Skill 工作台一站式操作封装
# 用法: bash scripts/skill-workbench.sh <start|stop|scan|rescan|sync-status>
# 本脚本随仓库分发，自动定位项目根（脚本位于 <项目根>/scripts/ 下）。
set -u
WB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

get_pid() {
  netstat -ano 2>/dev/null | grep ':8788' | grep LISTENING | awk '{print $5}' | head -1
}

case "${1:-}" in
  start)
    PID=$(get_pid)
    if [ -n "$PID" ]; then
      echo "已在运行 (PID $PID)，先停止旧进程..."
      taskkill //PID "$PID" //F >/dev/null 2>&1
      sleep 1
    fi
    (cd "$WB" && node server.cjs >/dev/null 2>&1 &)
    sleep 2
    NEWPID=$(get_pid)
    if [ -n "$NEWPID" ]; then
      echo "工作台已启动: http://localhost:8788 (PID $NEWPID)"
    else
      echo "启动失败，请手动检查: cd $WB && node server.cjs" >&2
      exit 1
    fi
    ;;
  stop)
    PID=$(get_pid)
    if [ -n "$PID" ]; then
      taskkill //PID "$PID" //F >/dev/null 2>&1
      echo "已停止 (PID $PID)"
    else
      echo "未在运行"
    fi
    ;;
  scan|rescan)
    node "$WB/tools/scan.cjs"
    ;;
  sync-status)
    node "$WB/tools/sync.cjs" status
    ;;
  *)
    echo "用法: bash scripts/skill-workbench.sh <start|stop|scan|rescan|sync-status>" >&2
    exit 1
    ;;
esac
