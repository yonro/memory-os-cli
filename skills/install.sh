#!/bin/sh
# Install the XMemo standalone Skill with only curl and tar available.
set -eu

fail() { printf '%s\n' "XMemo Skill installer: $1" >&2; exit 1; }

resolve_target() {
  target_agent=""
  target_warning=""
  home_dir="${HOME:-}"
  codex_home="${CODEX_HOME:-${home_dir}/.codex}"
  claude_home="${home_dir}/.claude"

  # Rule a: XMEMO_SKILL_DIR if set (unchanged behaviour)
  if [ -n "${XMEMO_SKILL_DIR:-}" ]; then
    install_dir="$XMEMO_SKILL_DIR"
    target_agent="custom"

  # Rule b: XMEMO_SKILL_AGENT=claude-code|codex (explicit)
  elif [ -n "${XMEMO_SKILL_AGENT:-}" ]; then
    case "$XMEMO_SKILL_AGENT" in
      claude-code|claude)
        target_agent="claude-code"
        install_dir="${claude_home}/skills/xmemo-memory"
        ;;
      codex)
        target_agent="codex"
        install_dir="${codex_home}/skills/xmemo-memory"
        ;;
      openclaw)
        printf '%s\n' "For OpenClaw run: openclaw skills install xmemo" >&2
        exit 1
        ;;
      *)
        fail "unknown XMEMO_SKILL_AGENT: $XMEMO_SKILL_AGENT (expected: claude-code, codex)"
        ;;
    esac

  # Rule c: Auto-detect the calling agent from its documented environment
  elif [ -n "${CLAUDECODE:-}" ]; then
    target_agent="claude-code"
    install_dir="${claude_home}/skills/xmemo-memory"
  elif [ -n "${CODEX_THREAD_ID:-}" ] || [ -n "${CODEX_SESSION_ID:-}" ] || [ -n "${CODEX_HOME:-}" ]; then
    target_agent="codex"
    install_dir="${codex_home}/skills/xmemo-memory"

  # Rule d: If exactly one of ~/.claude or ~/.codex exists, use that agent
  elif [ -n "$home_dir" ] && [ -d "$claude_home" ] && [ ! -d "$codex_home" ]; then
    target_agent="claude-code"
    install_dir="${claude_home}/skills/xmemo-memory"
  elif [ -n "$home_dir" ] && [ -d "$codex_home" ] && [ ! -d "$claude_home" ]; then
    target_agent="codex"
    install_dir="${codex_home}/skills/xmemo-memory"

  # Rule e: Otherwise keep ./xmemo-skill but print a clear warning
  else
    target_agent="standalone"
    install_dir="xmemo-skill"
    target_warning="Warning: Installing to ./xmemo-skill. AI agents will not automatically load the skill from this directory.
To install for a specific agent, set XMEMO_SKILL_AGENT=claude-code|codex or XMEMO_SKILL_DIR=<path>, or use:
  npx -y @xmemo/client skill install --client <id>"
  fi
}

resolve_target

if [ -n "$target_warning" ]; then
  printf '%s\n' "$target_warning" >&2
fi

if [ "${XMEMO_SKILL_RESOLVE_ONLY:-0}" = "1" ]; then
  printf '%s\n' "$install_dir"
  exit 0
fi

base_url="${XMEMO_BASE_URL:-https://xmemo.dev}"
case "$base_url" in https://*) ;; *) printf '%s\n' 'XMemo Skill installer requires an HTTPS XMEMO_BASE_URL.' >&2; exit 1 ;; esac
package_url="${base_url%/}/v1/skill/package"

if [ -e "$install_dir" ]; then
  if [ "${XMEMO_SKILL_FORCE:-0}" != "1" ]; then
    fail "destination already exists: $install_dir (set XMEMO_SKILL_FORCE=1 to replace and back up)"
  fi
fi

tmp_dir="${install_dir}.tmp.$$"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup 0 HUP INT TERM

mkdir -p "$tmp_dir" "$tmp_dir/extract" || fail "cannot create temporary directory"

if [ -n "${XMEMO_SKILL_TEST_ARCHIVE:-}" ]; then
  cp "$XMEMO_SKILL_TEST_ARCHIVE" "$tmp_dir/xmemo-skill.tar.gz" || fail "failed to copy test archive"
else
  curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' \
    "$package_url" -o "$tmp_dir/xmemo-skill.tar.gz" || fail "download failed"
fi

(cd "$tmp_dir" && tar -xzf xmemo-skill.tar.gz -C extract) || fail "archive extraction failed"
[ -f "$tmp_dir/extract/scripts/xmemo-skill.mjs" ] || fail "archive does not contain xmemo-skill"

if [ -e "$install_dir" ]; then
  backup_agent="${target_agent:-standalone}"
  backup_dir="${home_dir:-.}/.xmemo/backups/skills/${backup_agent}"
  backup_ts="$(date +%Y%m%d%H%M%S)"
  backup_name="$(basename "$install_dir")-${backup_ts}"
  backup_dest="${backup_dir}/${backup_name}"
  mkdir -p "$backup_dir" || fail "cannot create backup directory: $backup_dir"
  mv "$install_dir" "$backup_dest" || fail "failed to back up existing directory to $backup_dest"
  printf '%s\n' "Backed up existing installation to $backup_dest"
fi

parent_dir="$(dirname "$install_dir")"
if [ "$parent_dir" != "." ] && [ ! -d "$parent_dir" ]; then
  mkdir -p "$parent_dir" || fail "cannot create parent directory for $install_dir"
fi
mv "$tmp_dir/extract" "$install_dir" || fail "could not finalize installation"

abs_install_dir="$(cd "$install_dir" && pwd -P)"
doctor_script="$abs_install_dir/scripts/xmemo-skill.mjs"

printf '%s\n\n' "Installed XMemo Skill to $abs_install_dir"
printf '%s\n' "To verify the installation:"
printf '  node "%s" doctor --anonymous\n\n' "$doctor_script"
printf '%s\n' "Restart or reload your agent to pick up the skill."

