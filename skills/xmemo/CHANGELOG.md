# XMemo Skill Change Log

## 1.1.0

- `scripts/xmemo-skill.mjs`: align the advertised and runtime version at `1.1.0` while preserving the `XMemo Memory` package identity and formal-account-first login policy.
- `scripts/xmemo-skill.mjs`: add the discovery-compatible `auth-status` alias and `auth claim-deny` for the server's two-phase temporary-account bind flow.
- `scripts/xmemo-skill.mjs`: read temporary item/expiry limits from `/.well-known/xmemo-agent.json`, disclose them immediately after registration, and use the documented production limits as a non-blocking fallback when discovery is unavailable.
- `scripts/xmemo-skill.mjs`: route temporary `search` to `/v1/memories/search`, keep `recall` on `/v1/recall`, and retain temporary access only for `remember`, `recall`, and `search`.
- `scripts/xmemo-skill.mjs`: parse `--metadata` as a JSON object, parse `--explain` and `--prefer_working` as strict booleans, and validate state `--ttl_seconds` against the hosted `0..604800` contract.
- `scripts/xmemo-skill.mjs`: retain the established formal device-login scopes, including `ledger:read`; no server API contract or destructive memory command was added.
- `SKILL.md` and references: document the formal-account default, temporary limits, status alias, bind-denial flow, and typed argument examples without exposing credential values.
- Tests: cover dynamic temporary limits, temporary search routing, bind denial and pending-token cleanup, typed arguments, the `auth-status` alias, version output, and documentation invariants.

## 1.0.9

- Removed the non-runtime `skill-card.md` file. No user-facing, documentation, or runtime behavior changed in this marketplace release.

## 1.0.8

- `scripts/xmemo-skill.mjs`: advance the standalone runtime to `1.0.8` while preserving the existing REST operations, formal-login flow, temporary sandbox, and explicit plaintext fallback.
- `scripts/xmemo-skill.mjs`: stop displaying token prefixes and prevent `logout` from revoking an externally managed `XMEMO_KEY` unless `--revoke-environment-token` is explicitly supplied.
- `scripts/xmemo-skill.mjs`: add `doctor --anonymous`, command-specific login/register/logout help, `--version`, strict command parameter allowlists, required-argument validation, and sensitive command-line option rejection.
- `scripts/xmemo-skill.mjs`: require HTTPS for remote custom origins while retaining loopback HTTP for local development, warn before authenticated custom-origin requests, and add bounded request timeouts plus an 8 MiB response limit.
- `scripts/xmemo-skill.mjs`: honor device-login expiry, preserve the established formal-account memory and ledger scope set, redact sensitive fields from every JSON operation response, and sanitize human-readable server content for terminal safety.
- `SKILL.md` and references: document the compatible logout/anonymous-doctor behavior, timeout and origin boundaries, Node.js requirement, and copyable POSIX/PowerShell token-input examples.
- Tests: cover anonymous diagnostics, external environment-token logout, token-prefix suppression, unsafe origin and secret-option rejection, timeout/response limits, JSON redaction, the established formal-login scope set, device-login expiry, command help, and version output.

- `scripts/xmemo-skill.mjs`: keep `XMEMO_KEY` as the highest-priority credential source and never copy an environment token into local storage.
- `scripts/xmemo-skill.mjs`: require explicit `--allow-plaintext` consent before `login`, `auth add`, or temporary registration writes any bearer credential; replace the inaccurate “stored securely” claim with the exact storage path and an unencrypted-storage warning.
- `scripts/xmemo-skill.mjs`: restrict the XMemo credential directory/file to `0700`/`0600` where POSIX permissions are supported, record consent metadata, and warn when reading a legacy unmarked plaintext credential.
- `scripts/xmemo-skill.mjs`: minimize temporary credential metadata, redact token-shaped fields from JSON claim/error output, and clear pending confirmation data after handoff.
- `SKILL.md` and references: document credential precedence, explicit plaintext consent, temporary bind-URL handling, and migration guidance while keeping formal account login recommended.

- `scripts/xmemo-skill.mjs`: add an explicit, policy-gated `register --reason unattended|declined` fallback for the server's unauthenticated agent registration. Formal `login` remains the primary path.
- `scripts/xmemo-skill.mjs`: persist temporary credentials locally, route their allowed `remember`/`recall`/`search` requests to the temporary REST sandbox, reject unsupported commands clearly, and support claim-status/claim-confirm formal-token handoff.
- `SKILL.md` and references: document the temporary sandbox limits, required user disclosure, bind URL, and formal-account upgrade path.

- `scripts/xmemo-skill.mjs`: normalize successful list payloads (`result.results`, `result.todos`, or a bare array), so `recall`, `search`, and `todo-list` never call `forEach` on an API wrapper object.
- `scripts/xmemo-skill.mjs`: extract IDs from object or string results for `remember` and `expense-add`, preventing `[object Object]` output.
- `scripts/xmemo-skill.mjs`: parse every REST response through one guarded JSON helper. Empty or non-JSON gateway responses now include the HTTP status and a bounded server-response preview.
- `scripts/xmemo-skill.mjs`: add global and command-level `--help`, clear unknown-command errors, and `--compact` rendering for recall/search.
- `SKILL.md` and `references/*.md`: make every command relative to the Skill root (`node scripts/xmemo-skill.mjs ...`) and document compact output and help.
- `test/xmemo-standalone-skill.test.js`: add regression coverage for wrapped list payloads, object IDs, help output, and non-JSON responses.
