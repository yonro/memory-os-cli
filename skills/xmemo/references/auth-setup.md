# XMemo Authentication & Credential Setup

This reference describes credential resolution order, secret store integrations (Meta Muse Vault, OpenClaw Secret Egress), device login, token storage, temporary sandbox access, and credential lifecycle management for the bundled `xmemo` Skill.

For other operations and guides, see:
- [memory-operations.md](memory-operations.md) for core memory, knowledge, and continuity workflows.
- [ledger-operations.md](ledger-operations.md) for expense tracking, ledger audits, and account diagnostics.
- [runtime-operations.md](runtime-operations.md) for the command matrix, execution details, output safety, and exit codes.
- [troubleshooting.md](troubleshooting.md) for step-by-step diagnosis and repair.

## Hosted Discovery Boundary

The public `agent-discovery` field `standalone_skill.operations` describes the
generic commands accepted by `POST /v1/skill/operations`; it is not the full
standalone command catalogue. `restart-snapshot` and `restart-restore` use the
separate direct endpoints `/v1/restart/snapshot` and `/v1/restart/restore`, so
they are deliberately absent from that operations list.

Do not infer that a restart command is available merely because a discovery
document mentions a memory scope. It requires a formal account credential and
the service must authorize the specific request. The temporary-agent manifest
intentionally omits restart continuity: temporary access stays limited to
`remember`, `recall`, and `search` in its isolated sandbox.

## Credential Lookup Priority

Credential lookup follows a strict priority order:

1. **`XMEMO_KEY` environment variable**: Always highest priority. When set, credential resolution trims leading and trailing whitespace and returns the token. If the trimmed value is non-empty, resolution short-circuits with no daemon socket or file access, and the token is never copied to disk. If the trimmed value is empty, `XMEMO_KEY` is treated as unset and resolution continues to Meta Muse Vault or the local user credential file.
   - **OpenClaw Secret Egress (`openclaw-secret`)**: When `XMEMO_KEY` contains an OpenClaw egress sentinel (`oc-sent-v2.<name>.end`), OpenClaw's egress proxy manages the plaintext key in its Gateway shared store and injects it outbound strictly for `https://xmemo.dev`. The skill requires `secrets.egressProxy.enabled: true` and Gateway-hosted execution (`HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1`). Neither scripts, agents, nor logs ever see the real key. In OpenClaw, configure the secret:
     - Secret entry name: `XMEMO_KEY`
     - Allowed hosts: `xmemo.dev`
     - Egress proxy: enable `secrets.egressProxy.enabled`
     - Execution target: Gateway-hosted exec only (sandboxed or remote `node` exec environments do not receive egress proxy sentinels).
     `auth status` reports `Credential Source: openclaw-secret`. Sentinels are rejected by `saveToken` / `auth add`, redacted in responses, and never stored on disk. `logout` preserves OpenClaw secrets, refuses `--revoke-environment-token`, and instructs the user to manage them via `openclaw secrets delete` or the OpenClaw Control UI.
2. **Meta Muse Secure Vault (`muse-vault`)**: When running inside Meta Muse, the runtime requests an ephemeral surrogate token (`hsurr:...`) from Muse's auth daemon over `$JARVIS_AUTHD_SOCK` (default `/run/hatch/auth/authd.sock`). The plaintext key remains stored in Secure Vault and is substituted outbound by Muse's egress proxy strictly for requests to `https://xmemo.dev`. Neither scripts, agents, nor logs ever see the real key. Generate access in Muse via:

   ```python
   credentials.request_api_access(
       provider="xmemo",
       api_hosts=["xmemo.dev"],
       auth_scheme="api_key",
       placement="bearer_header",
   )
   ```

   When connected, `node scripts/xmemo-skill.mjs auth status` reports `Credential Source: muse-vault`. Surrogates are rejected by `saveToken` / `auth add`, redacted in responses, and never stored on disk. `logout` preserves vault credentials and instructs the user to disconnect in Meta Muse.
3. **Local user credential file**: Used when neither `XMEMO_KEY` nor a Muse Vault surrogate is present.

## Device Login & Plaintext Storage

If no credential is available, formal account login is the recommended path. When an XMemo command fails with "No XMemo credential found" (exit code 2) and no `XMEMO_KEY` or secret store is configured, the agent runs `node scripts/xmemo-skill.mjs login --allow-plaintext` immediately without waiting for a separate chat confirmation, and presents the verification URL and one-time code to the user. In the same message, the agent must inform the user, in one sentence, that approving the code in the browser issues a token stored unencrypted in `~/.xmemo` (permissions 0600 on POSIX), and that they can instead provide `XMEMO_KEY` from a secret store; browser approval constitutes the user's consent.

```text
node scripts/xmemo-skill.mjs login --allow-plaintext
```

New users should create or sign in to an XMemo account at `https://xmemo.dev`.
The `login` command opens the hosted device-login page and shows a one-time
code; approve that code in the browser account session to issue the Skill's
scoped `skill_token`.

The standalone zero-dependency script has no cross-platform operating-system
keychain integration. `--allow-plaintext` stores the issued token unencrypted in the current user's XMemo directory (`~/.xmemo/skill-credentials.json`) so
later commands can use it. The script prints the exact path, restricts POSIX
permissions where supported (0600), never prints the token, and never writes it into
the project. Prefer `XMEMO_KEY` or a managed secret store when plaintext local
storage is not acceptable. Never run `register` (temporary sandbox) unless no human can complete login (`unattended`) or the user explicitly declined registration; never ask the user to paste a token into chat.

## Token Expiry & Revocation Symptoms

Formal account tokens issued by the service can expire or be revoked remotely.
The local user credential file stores no access-token expiry information (the
`expires_in` value returned during the interactive device-login flow applies
strictly to the device-code authorization window, not to the issued token). When
a formal token expires or is revoked, normal commands fail with exit code 2, an
`Invalid or expired token` error (or HTTP 401), and a hint indicating the
credential source. To restore access, run
`node scripts/xmemo-skill.mjs login --allow-plaintext` again (or refresh
`XMEMO_KEY` if using environment credentials). Verify the active credential with
`node scripts/xmemo-skill.mjs auth status --verify`.

## Temporary Sandbox & Registration Fallback

Formal registration/login is the default and recommended path. It gives the
user account-backed memory and the full command set.

Only when no human can complete login (`unattended`) or the human explicitly
declines registration for now (`declined`), use the explicit temporary fallback:

```text
node scripts/xmemo-skill.mjs register --reason unattended --allow-plaintext
```

Temporary access is an isolated, limited memory sandbox. It only supports
`remember`, `recall`, and `search`. The script reads the current public policy
before registration and immediately discloses its item cap, inactivity expiry,
and maximum lifetime (currently 100 items, 14 days of inactivity, and 30 days
from registration). Show the returned bind URL to the user and do not share
that URL publicly. Run
`node scripts/xmemo-skill.mjs auth claim-confirm` after they claim it. Temporary
and pending-confirmation values inherit the same explicit plaintext-storage
consent and are replaced or cleared during formal-token handoff.

If the user does not approve the pending bind, run:

```text
node scripts/xmemo-skill.mjs auth claim-deny
```

This rejects the pending bind server-side and retains the temporary sandbox.

## Importing Existing Tokens via Standard Input

If you already have a token from a secret store or external source, pipe it
without putting the value in the command line or shell history.

POSIX shell:

```text
printf '%s' "$XMEMO_KEY" | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

PowerShell:

```powershell
$env:XMEMO_KEY | node scripts/xmemo-skill.mjs auth add --from-stdin --allow-plaintext
```

Standard input for `auth add --from-stdin` is bounded to a maximum of 64 KiB.
Collect credentials only through `XMEMO_KEY` or the device login flow; do not
request raw tokens in chat, logs, or project files.

## Session & Credential Lifecycle

- `auth status`: Displays the current local credential status without revealing
  token values. Append `--verify` to validate credentials against the server.
  The `auth-status` spelling remains supported as an alias.
- `auth add`: Imports an existing token piped from standard input
  (`--from-stdin --allow-plaintext`, capped at 64 KiB) without exposing token strings on the
  command line or in shell history.
- `auth claim-*`: Completes or cancels temporary-to-formal token transition
  (`auth claim-status`, `auth claim-confirm`, `auth claim-deny`).
- `logout`: Revokes and removes a user credential file. When `XMEMO_KEY` supplies
  the active credential, logout leaves that externally managed token unchanged
  unless `--revoke-environment-token` is explicitly passed; unset the
  environment variable in the launching environment to stop using it. OpenClaw
  secrets and Muse vault credentials are preserved by logout; manage them via
  their respective platform controls.
