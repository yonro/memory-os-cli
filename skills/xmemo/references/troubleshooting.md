# XMemo Skill Troubleshooting

Run these checks in order. Report the first failing check, the command that
produced it, and the next concrete repair command.

## 1. Skill Script availability

Check that the script runs successfully:

```text
node scripts/xmemo-skill.mjs doctor
```

## 2. Authentication Status

Check whether a credential is stored without exposing the token value:

```text
node scripts/xmemo-skill.mjs auth status
# equivalent discovery-compatible alias
node scripts/xmemo-skill.mjs auth-status
```

If the credential is missing, start device login or add a token directly:

```text
node scripts/xmemo-skill.mjs login --allow-plaintext
# or
printf '%s' "$XMEMO_KEY" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

PowerShell token-add equivalent:

```powershell
$env:XMEMO_KEY | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

`XMEMO_KEY` remains the preferred credential source and is never copied to the
local credential file. The commands above include `--allow-plaintext` because
device login and `auth add` must retain a token for later standalone commands.
The flag explicitly permits unencrypted storage in the current user's XMemo
directory; the script prints the exact path and a warning before writing it.

Formal login is recommended. If and only if a human is unavailable or has
explicitly declined registration for now, create a limited temporary sandbox:

```text
node scripts/xmemo-skill.mjs register --reason unattended --allow-plaintext
```

Temporary credentials work only for `remember`, `recall`, and `search`. Give
the displayed bind URL to the user, then use `auth claim-confirm` after their
claim to receive the formal credential. The script displays the current
temporary item and time limits immediately after registration. The current
policy is 100 items, 14 days without successful memory activity, and 30 days
maximum from registration. Do not share the bind URL publicly. If the user
rejects a pending bind, run `node scripts/xmemo-skill.mjs auth claim-deny` to
reject it server-side and clear the local pending confirmation value.

New users should create or sign in to an XMemo account at `https://xmemo.dev`
before approving the device-login code. The browser page must show the same
one-time code printed by the Skill script.

Do not paste the token into chat, logs, or project files.

## 3. Token verification

Verify the stored credential against the hosted endpoint:

```text
node scripts/xmemo-skill.mjs auth status --verify
node scripts/xmemo-skill.mjs auth-status --verify
```

If verification fails:

- The token may be expired. Run the `login` command to refresh it.
- A proxy or firewall may block HTTPS traffic to `xmemo.dev`.

## 4. Network and service

Check the hosted service and current credential together:

```text
node scripts/xmemo-skill.mjs doctor
```

When a credential is available, `doctor` sends it so the service can report
authentication validity. To check service health without any Authorization
header, run:

```text
node scripts/xmemo-skill.mjs doctor --anonymous
```

If this fails:

- Confirm the machine can reach `https://xmemo.dev`.
- Check DNS, VPN, or corporate proxy settings.
- Try an explicit base URL: `node scripts/xmemo-skill.mjs doctor --base-url https://xmemo.dev`.
- Increase the per-request timeout only when the service is known to be slow:
  `node scripts/xmemo-skill.mjs doctor --timeout-ms 60000`.
- Custom service origins must use HTTPS. Plain HTTP is accepted only for
  localhost/loopback development, and authenticated commands warn before sending
  a credential to a non-default origin.

## 5. Common errors

| Symptom | Likely cause | Repair |
|---------|--------------|--------|
| `No XMemo credential found` | Not logged in | Set `XMEMO_KEY`, or run `node scripts/xmemo-skill.mjs login --allow-plaintext` |
| `Refusing unencrypted credential storage` | Missing explicit consent | Prefer `XMEMO_KEY`, or rerun the credential-writing command with `--allow-plaintext` |
| `Authentication failed (HTTP 401)` | Token invalid/expired | Run `login` or add a new token |
| `Remote XMemo server is not reachable` | Network or service outage | Check network/VPN/proxy |
| `XMemo base URL must use HTTPS` | Insecure non-loopback service URL | Use HTTPS, or localhost HTTP only for local development |
| `Request timed out` | Service/network exceeded the request deadline | Retry after checking service health, or set a bounded `--timeout-ms` |
| `Unknown option` | Unsupported or misspelled command parameter | Run the command with `--help`; do not pass tokens as flags |
| `--metadata must be a JSON object` | Metadata is invalid JSON, an array, or a scalar | Pass one JSON object, for example `'{"source":"review"}'` |
| `--explain must be true or false` | A boolean parameter used another spelling | Pass the literal `true` or `false` |
| `Method not found` | Server does not expose the requested operation | Server-side capability gap |

## Security reminders

- Never commit `skill-credentials.json` or any file containing a token.
- Never pass `--token`, `--api-key`, `--bearer`, or `--xmemo-key` to the Skill script.
- Prefer `login` for interactive authentication.
- Prefer `XMEMO_KEY` or a managed secret store over plaintext file storage.
- `auth status` reports the credential source but never prints a token prefix.
- `logout` leaves externally managed `XMEMO_KEY` unchanged by default. Unset the
  variable to stop using it; pass `--revoke-environment-token` only when remote
  revocation is explicitly intended.
- `--allow-plaintext` means the local token is unencrypted and may be read by
  processes running as the same operating-system user.
- Treat `X-Memory-OS-Agent-ID` as an attribution signal, not authorization proof.
