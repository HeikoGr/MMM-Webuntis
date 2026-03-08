#!/usr/bin/env bash
set -euo pipefail

# Toggle network reachability for a specific WebUntis host.
# Default mode uses /etc/hosts (simple, deterministic, easy rollback).

HOST="${WEBUNTIS_HOST:-}"
MODE="hosts"
ACTION=""
MARKER="# MMM-Webuntis network test"
PM2_LOG=0
PM2_LINES=200

usage() {
  cat <<'EOF'
Usage:
  webuntis-network-toggle.sh <action> [--mode hosts|iptables] [--host fqdn] [--pm2-log] [--pm2-lines N]

Actions:
  block     Block access to host
  unblock   Remove block
  status    Show current block status
  test      Curl test against host

Options:
  --mode hosts|iptables  Blocking method (default: hosts)
  --host fqdn            Target hostname (required unless WEBUNTIS_HOST is set)
  --pm2-log              Print a recent PM2 log snapshot after action
  --pm2-lines N          Number of PM2 log lines for snapshot (default: 200)

Examples:
  sudo bash scripts/webuntis-network-toggle.sh block
  sudo bash scripts/webuntis-network-toggle.sh unblock
  sudo bash scripts/webuntis-network-toggle.sh status
  sudo bash scripts/webuntis-network-toggle.sh block --mode iptables --host school.example.webuntis.com
  sudo bash scripts/webuntis-network-toggle.sh block --pm2-log --pm2-lines 300
EOF
}

show_pm2_logs_snapshot() {
  if [[ "${PM2_LOG}" -ne 1 ]]; then
    return
  fi

  echo ""
  echo "[PM2 log snapshot]"

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 not found on PATH."
    return
  fi

  local snapshot_file="/tmp/mmm-webuntis-pm2-${HOST//[^a-zA-Z0-9._-]/_}-$(date +%s).log"

  # --nostream avoids follow mode so the script never blocks indefinitely.
  if pm2 logs magicmirror --nostream --lines "${PM2_LINES}" >"${snapshot_file}" 2>&1; then
    cat "${snapshot_file}"
  else
    echo "pm2 logs magicmirror failed, trying all processes..."
    if pm2 logs --nostream --lines "${PM2_LINES}" >"${snapshot_file}" 2>&1; then
      cat "${snapshot_file}"
    else
      cat "${snapshot_file}"
      return
    fi
  fi

  echo ""
  echo "Snapshot file: ${snapshot_file}"
  echo ""
  echo "[Suggested filters]"
  echo "grep -Ei 'MMM-Webuntis|Authentication failed|Cannot reach WebUntis|REAUTH|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND' \"${snapshot_file}\""
}

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This action requires root. Re-run with sudo." >&2
    exit 1
  fi
}

resolve_ipv4() {
  getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u
}

resolve_ipv6() {
  getent ahostsv6 "$HOST" | awk '{print $1}' | sort -u
}

hosts_block() {
  need_root

  if grep -Eq "^[[:space:]]*127\.0\.0\.1[[:space:]]+${HOST}([[:space:]]+|$)" /etc/hosts; then
    echo "hosts block already present for ${HOST}"
    return
  fi

  {
    echo "127.0.0.1 ${HOST} ${MARKER}"
    echo "::1 ${HOST} ${MARKER}"
  } >>/etc/hosts

  echo "Blocked via /etc/hosts: ${HOST} -> 127.0.0.1, ::1"
}

hosts_unblock() {
  need_root

  if ! grep -Fq "${MARKER}" /etc/hosts; then
    echo "No hosts block marker found in /etc/hosts"
    return
  fi

  cp /etc/hosts /etc/hosts.bak.mmm-webuntis
  grep -Fv "${MARKER}" /etc/hosts.bak.mmm-webuntis >/etc/hosts
  echo "Removed hosts block marker entries for ${HOST}"
}

iptables_block() {
  need_root

  local added_any=0
  local ip

  while read -r ip; do
    [[ -z "${ip}" ]] && continue
    if ! iptables -C OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT 2>/dev/null; then
      iptables -I OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT
      echo "Added iptables block: ${ip}:443"
      added_any=1
    fi
  done < <(resolve_ipv4)

  while read -r ip; do
    [[ -z "${ip}" ]] && continue
    if ! ip6tables -C OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT 2>/dev/null; then
      ip6tables -I OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT
      echo "Added ip6tables block: [${ip}]:443"
      added_any=1
    fi
  done < <(resolve_ipv6)

  if [[ "${added_any}" -eq 0 ]]; then
    echo "No new firewall rules added (already present or no IPs resolved)."
  fi
}

iptables_unblock() {
  need_root

  local removed_any=0
  local ip

  while read -r ip; do
    [[ -z "${ip}" ]] && continue
    while iptables -C OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT 2>/dev/null; do
      iptables -D OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT
      echo "Removed iptables block: ${ip}:443"
      removed_any=1
    done
  done < <(resolve_ipv4)

  while read -r ip; do
    [[ -z "${ip}" ]] && continue
    while ip6tables -C OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT 2>/dev/null; do
      ip6tables -D OUTPUT -p tcp -d "${ip}" --dport 443 -m comment --comment "MMM-Webuntis:${HOST}" -j REJECT
      echo "Removed ip6tables block: [${ip}]:443"
      removed_any=1
    done
  done < <(resolve_ipv6)

  if [[ "${removed_any}" -eq 0 ]]; then
    echo "No matching firewall rules found for ${HOST}."
  fi
}

show_status() {
  echo "Host: ${HOST}"
  echo ""
  echo "[Hosts entries]"
  if grep -En "${HOST}|${MARKER}" /etc/hosts; then
    true
  else
    echo "(none)"
  fi

  echo ""
  echo "[Firewall rules ipv4]"
  if iptables -S OUTPUT 2>/dev/null | grep -F "MMM-Webuntis:${HOST}"; then
    true
  else
    echo "(none)"
  fi

  echo ""
  echo "[Firewall rules ipv6]"
  if ip6tables -S OUTPUT 2>/dev/null | grep -F "MMM-Webuntis:${HOST}"; then
    true
  else
    echo "(none)"
  fi
}

run_test() {
  echo "Testing HTTPS reachability for ${HOST} ..."
  if curl -I --max-time 8 "https://${HOST}/" >/tmp/mmm-webuntis-net-test.out 2>&1; then
    echo "Reachable (curl succeeded)"
  else
    echo "Not reachable or blocked (curl failed)"
  fi
  cat /tmp/mmm-webuntis-net-test.out
  rm -f /tmp/mmm-webuntis-net-test.out
}

parse_args() {
  if [[ "$#" -lt 1 ]]; then
    usage
    exit 1
  fi

  if [[ "${1}" == "-h" || "${1}" == "--help" ]]; then
    usage
    exit 0
  fi

  ACTION="$1"
  shift

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --mode)
        MODE="${2:-}"
        shift 2
        ;;
      --host)
        HOST="${2:-}"
        shift 2
        ;;
      --pm2-log)
        PM2_LOG=1
        shift
        ;;
      --pm2-lines)
        PM2_LINES="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  case "$MODE" in
    hosts|iptables)
      ;;
    *)
      echo "Invalid mode: ${MODE}" >&2
      exit 1
      ;;
  esac

  case "$ACTION" in
    block|unblock|status|test)
      ;;
    *)
      echo "Invalid action: ${ACTION}" >&2
      usage
      exit 1
      ;;
  esac

  if ! [[ "${PM2_LINES}" =~ ^[0-9]+$ ]] || [[ "${PM2_LINES}" -le 0 ]]; then
    echo "Invalid --pm2-lines value: ${PM2_LINES}" >&2
    exit 1
  fi

  if [[ -z "${HOST}" ]]; then
    echo "Missing host. Provide --host <fqdn> or set WEBUNTIS_HOST." >&2
    exit 1
  fi
}

main() {
  parse_args "$@"

  case "$ACTION" in
    block)
      if [[ "$MODE" == "hosts" ]]; then
        hosts_block
      else
        iptables_block
      fi
      show_pm2_logs_snapshot
      ;;
    unblock)
      if [[ "$MODE" == "hosts" ]]; then
        hosts_unblock
      else
        iptables_unblock
      fi
      show_pm2_logs_snapshot
      ;;
    status)
      show_status
      show_pm2_logs_snapshot
      ;;
    test)
      run_test
      show_pm2_logs_snapshot
      ;;
  esac
}

main "$@"
