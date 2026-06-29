# XMemo Skill Troubleshooting

Run these checks in order. Report the first failing check, the command that
produced it, and the next concrete repair command.

## 1. Skill Script availability

Check that the script runs successfully:

```text
node skills/xmemo/scripts/xmemo-skill.mjs doctor
```

## 2. Authentication Status

Check whether a credential is stored without exposing the token value:

```text
node skills/xmemo/scripts/xmemo-skill.mjs auth status
```

If the credential is missing, start device login or add a token directly:

```text
node skills/xmemo/scripts/xmemo-skill.mjs login
# or
echo "$XMEMO_KEY" | node skills/xmemo/scripts/xmemo-skill.mjs auth add --from-stdin
```

Do not paste the token into chat, logs, or project files.

## 3. Token verification

Verify the stored credential against the hosted endpoint:

```text
node skills/xmemo/scripts/xmemo-skill.mjs auth status --verify
```

If verification fails:

- The token may be expired. Run the `login` command to refresh it.
- A proxy or firewall may block HTTPS traffic to `xmemo.dev`.

## 4. Network and service

Check the hosted service without sending a token:

```text
node skills/xmemo/scripts/xmemo-skill.mjs doctor
```

If this fails:

- Confirm the machine can reach `https://xmemo.dev`.
- Check DNS, VPN, or corporate proxy settings.
- Try an explicit base URL: `node skills/xmemo/scripts/xmemo-skill.mjs doctor --base-url https://xmemo.dev`.

## 5. Common errors

| Symptom | Likely cause | Repair |
|---------|--------------|--------|
| `No XMemo credential found` | Not logged in | Run the `login` command |
| `Authentication failed (HTTP 401)` | Token invalid/expired | Run `login` or add a new token |
| `Remote XMemo server is not reachable` | Network or service outage | Check network/VPN/proxy |
| `Method not found` | Server does not expose the requested operation | Server-side capability gap |

## Security reminders

- Never commit `skill-credentials.json` or any file containing a token.
- Never pass `--token`, `--api-key`, `--bearer`, or `--xmemo-key` to the Skill script.
- Prefer `login` for interactive authentication.
- Treat `X-Memory-OS-Agent-ID` as an attribution signal, not authorization proof.
