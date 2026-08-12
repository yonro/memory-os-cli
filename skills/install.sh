#!/bin/sh
# Install the XMemo standalone Skill with only curl and tar available.
set -eu

base_url="${XMEMO_BASE_URL:-https://xmemo.dev}"
case "$base_url" in https://*) ;; *) printf '%s\n' 'XMemo Skill installer requires an HTTPS XMEMO_BASE_URL.' >&2; exit 1 ;; esac
package_url="${base_url%/}/v1/skill/package"
install_dir="${XMEMO_SKILL_DIR:-xmemo-skill}"
tmp_dir="${install_dir}.tmp.$$"

fail() { printf '%s\n' "XMemo Skill installer: $1" >&2; exit 1; }
[ ! -e "$install_dir" ] || fail "destination already exists: $install_dir"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup 0 HUP INT TERM

mkdir "$tmp_dir" "$tmp_dir/extract" || fail "cannot create temporary directory"
curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' \
  "$package_url" -o "$tmp_dir/xmemo-skill.tar.gz" || fail "download failed"
tar -xzf "$tmp_dir/xmemo-skill.tar.gz" -C "$tmp_dir/extract" || fail "archive extraction failed"
[ -f "$tmp_dir/extract/scripts/xmemo-skill.mjs" ] || fail "archive does not contain xmemo-skill"
mv "$tmp_dir/extract" "$install_dir" || fail "could not finalize installation"
printf '%s\n' "Installed XMemo Skill to $install_dir"
