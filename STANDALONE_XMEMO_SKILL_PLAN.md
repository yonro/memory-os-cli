# Commercial Standalone XMemo Skill Plan

## Goal

Build `skills/xmemo` as a complete commercial-grade XMemo access path.

The XMemo Skill is a first-class product entry point. It is not a fallback for
MCP, not a helper for host-specific plugins, and not a wrapper around the npm
CLI. Users who install the Skill should be able to authenticate and operate
XMemo through the Skill itself.

Target release: `0.4.177` or later for the Skill package, after the required
`memory-os` service changes are implemented and deployed.

Do not mix this feature into the `0.4.176` LobeHub hotfix unless the release
owner explicitly reopens that scope.

## Product Positioning

XMemo has parallel access paths:

```text
1. Hosted MCP server
2. Host-specific plugins
3. npm CLI
4. Standalone Skill runtime
5. REST / SDK
```

This plan covers access path 4. The Skill runtime must operate independently
from MCP config, host plugins, and npm CLI installation.

## Current memory-os Support Audit

Checked repository: `D:\repos\memory-os`.

Already present:

- Device login foundation:
  - `/v1/auth/device/start`
  - `/v1/auth/device/token`
  - browser approval page `/device-login`
  - tests in `tests/web/test_me_portal.py`
- Token validation:
  - `/v1/auth/token/validate`
  - tested by `tests/web/test_auth_token_validate.py`
- Existing REST operation surfaces:
  - `POST /v1/remember`
  - `GET /v1/recall` / `GET /v1/memories/search`
  - `PATCH /v1/memories/{memory_id}`
  - `POST /v1/memories/{memory_id}/forget`
  - `POST /v1/update_state`
  - `POST /v1/reminders`
  - `GET /v1/reminders`
  - `POST /v1/reminders/{reminder_id}/complete`
  - `POST /v1/restart/snapshot`
  - `POST /v1/restart/restore`
- State content is supported by REST `MemoryStateUpdateRequest.content` and
  `POST /v1/update_state`.

Commercial gaps to close in `memory-os`:

- Device login is currently CLI-shaped:
  - metadata uses `surface: cli_login`
  - test client_id is `@xmemo/client`
  - approval copy says "CLI"
- Device login allowed scopes currently appear limited to
  `memory:read` and `memory:write`.
- There is no dedicated Skill operation endpoint such as
  `POST /v1/skill/operations`.
- Public product/discovery text currently contains old "Skill cannot call cloud
  memory by itself" positioning. This must be updated for the new standalone
  Skill product.
- Ledger write exists as an MCP tool and memory write adapter behavior, but
  there is no obvious first-class REST `POST /v1/ledger/expenses` endpoint.

## Commercial User Experience

The target user flow:

```powershell
node skills\xmemo\scripts\xmemo-skill.mjs login
```

The script should:

1. Call XMemo device-login start.
2. Print a verification URL and user code.
3. Poll the token endpoint.
4. Store the returned token in a user-scoped Skill credential file.
5. Run future XMemo operations without MCP config, plugin install, or npm CLI.

User-facing auth commands:

```text
node skills/xmemo/scripts/xmemo-skill.mjs login
node skills/xmemo/scripts/xmemo-skill.mjs auth status
node skills/xmemo/scripts/xmemo-skill.mjs auth status --verify
node skills/xmemo/scripts/xmemo-skill.mjs auth add --from-stdin
node skills/xmemo/scripts/xmemo-skill.mjs logout
```

`auth add --from-stdin` remains a secure fallback, not the primary commercial
path.

## Hard Requirements

- The Skill folder must be operational when copied outside the npm package.
- `skills/xmemo/scripts/xmemo-skill.mjs` must be self-contained and use only
  Node.js built-ins.
- The Skill script must not import from `src/*`.
- The Skill script must not spawn or call `xmemo`, `memory-os`, `client`,
  `xmemo-mcp`, `npm`, or `npx`.
- The Skill must not require MCP client configuration.
- The Skill must not require any host plugin.
- The Skill must not require npm package installation after the Skill folder is
  installed.
- Token values must never be printed to stdout/stderr, stored in project files,
  stored in the Skill folder, or placed in prompts/logs.
- The Skill must never simulate a successful memory read or write.

## Required memory-os Service Changes

### 1. Productize Device Login For Skills

Keep existing device login endpoints, but make them Skill-aware.

Required request fields:

```json
{
  "client_id": "xmemo-skill",
  "client_version": "0.4.177",
  "surface": "standalone_skill",
  "token_type": "skill_token",
  "scopes": [
    "memory:read",
    "memory:write",
    "memory:restore",
    "ledger:write"
  ]
}
```

Implementation notes:

- Existing `cli_version` can remain for backward compatibility, but commercial
  Skill should use `client_version` or `skill_version`.
- Token metadata should record:
  - `created_by: device_login`
  - `surface: standalone_skill`
  - `client_id: xmemo-skill`
  - `skill_version`
  - `device_label` when supplied
- Browser copy must say "XMemo Skill" / "Skill runtime", not "CLI".
- Approval page should show requested scopes in user language.
- Polling should return OAuth-style errors:
  - `authorization_pending`
  - `slow_down`
  - `expired_token`
  - `access_denied`
  - `setup_required`

### 2. Expand Scopes For Skill

Current `_device_login_scopes` appears limited to `memory:read` and
`memory:write`. Expand or map scopes for commercial Skill usage.

Required minimum:

```text
memory:read
memory:write
memory:restore
ledger:write
```

Optional future scopes:

```text
todo:read
todo:write
state:read
state:write
ledger:read
memory:admin
```

If existing authorization logic only recognizes `memory:*`, map Skill scopes to
existing internal checks initially, but expose user-facing scopes cleanly.

### 3. Add Dedicated Skill Operations Endpoint

Do not make the commercial Skill depend on MCP JSON-RPC.

Add:

```text
POST /v1/skill/operations
POST /api/v1/skill/operations
```

Request:

```json
{
  "operation": "search",
  "arguments": {
    "query": "release decision",
    "limit": 5
  },
  "client": {
    "surface": "standalone_skill",
    "skill_version": "0.4.177",
    "agent_id": "codex",
    "agent_instance_id": "..."
  }
}
```

Response:

```json
{
  "ok": true,
  "operation": "search",
  "result": {},
  "request_id": "..."
}
```

Error response:

```json
{
  "ok": false,
  "error": {
    "code": "auth_required",
    "message": "..."
  },
  "request_id": "..."
}
```

This endpoint should be a thin commercial facade over existing services and REST
handlers, not a parallel business-logic fork.

### 4. Operation Mapping

`POST /v1/skill/operations` should support:

```text
remember      -> existing remember service / POST /v1/remember semantics
recall        -> recall/search service
search        -> recall/search service
update        -> memory update service
forget        -> memory forget service
state-save    -> existing update_state service / POST /v1/update_state
state-restore -> latest matching state lookup or restart restore strategy
todo-add      -> existing reminders create service
todo-list     -> existing reminders list service
todo-done     -> existing reminders complete service
expense-add   -> first-class ledger expense write
doctor        -> service metadata + auth validation
```

State must use real `update_state` semantics. Do not use
`create_restart_snapshot` as a substitute for `state-save --content`.

Ledger must have a first-class write path:

- Preferred: add `POST /v1/ledger/expenses`.
- Acceptable internal implementation: route through the same ledger adapter used
  by `remember`, but expose it as a Skill operation and test it as ledger.

### 5. Token Lifecycle

Required endpoints or behaviors:

```text
GET  /v1/auth/token/validate
POST /v1/auth/token/revoke-self
```

Existing `/v1/auth/token/validate` is present. Add a self-revoke endpoint if
there is no safe user-token revocation endpoint for bearer tokens.

Skill commands:

- `auth status` checks local credential presence.
- `auth status --verify` calls token validate.
- `logout` revokes the token when possible, then deletes the local Skill
  credential.

### 6. Public Product And Discovery Updates

Update `memory-os` public/discovery surfaces that currently say Skill is only
guidance or requires plugin/MCP runtime.

Likely files:

- `src/memory_manager/routes/onboarding.py`
- `src/memory_manager/routes/mcp_config.py`
- `src/memory_manager/rendering/product.py`
- tests under `tests/web/test_agent_discovery.py`
- tests under `tests/web/test_product_subpages_smoke.py`

New positioning:

```text
XMemo Skill is a standalone runtime access path.
MCP, plugins, CLI, REST/SDK, and Skill are parallel integration surfaces.
```

## Required memory-os-cli Skill Changes

### 1. Self-Contained Skill Runtime

Rewrite:

```text
skills/xmemo/scripts/xmemo-skill.mjs
```

Requirements:

- Node built-ins only.
- No imports from `src/*`.
- No child process calls.
- No npm/npx/CLI calls.
- Direct HTTPS calls to XMemo service.
- JSON output only.

### 2. Credential Storage

Credential sources:

1. `XMEMO_KEY`
2. `MEMORY_OS_API_KEY`
3. `MEMORY_OS_MCP_TOKEN`
4. Skill-owned credential file:
   - Windows: `%USERPROFILE%\.xmemo\skill-credentials.json`
   - Unix: `~/.xmemo/skill-credentials.json`

Credential file contents:

```json
{
  "version": 1,
  "token_type": "skill_token",
  "token": "...",
  "source": "device_login",
  "created_at": "...",
  "service_url": "https://xmemo.dev",
  "scopes": ["memory:read", "memory:write"],
  "tokenPrinted": false
}
```

Set restrictive file permissions where the platform allows it.

### 3. Skill Commands

```text
login
auth status
auth status --verify
auth add --from-stdin
logout
remember --content "..." --path "..."
recall --query "..." [--limit n]
search --query "..." [--limit n]
update --id "..." --content "..."
forget --id "..."
state-save --key active_task --content "..."
state-restore --key active_task
todo-add --content "..."
todo-list
todo-done --id "..."
expense-add --item "..." --amount n [--currency CODE]
doctor
```

### 4. Runtime HTTP Contract

Primary operation transport:

```text
POST https://xmemo.dev/v1/skill/operations
```

Fallback transport is not allowed for the final commercial release. If the
service endpoint is missing, the Skill must report `service_not_ready` rather
than silently using MCP or CLI.

## Required Tests

### memory-os

Add or update tests to prove:

- Device login supports `surface: standalone_skill`.
- Device login records Skill metadata, not `cli_login`.
- Device login supports required Skill scopes.
- Device approval UI copy says Skill, not CLI, for Skill requests.
- `/v1/auth/token/validate` works for Skill-issued tokens and returns sanitized
  data only.
- Self-revoke works for Skill tokens.
- `/v1/skill/operations` routes every supported operation to the correct service.
- `state-save` stores content using `update_state`, and `state-restore` retrieves
  meaningful state.
- `expense-add` writes a ledger transaction through a first-class Skill/REST
  path.
- Public product/discovery tests no longer claim Skill-only cannot operate.

Suggested focused tests:

```powershell
python -m pytest tests\web\test_me_portal.py tests\web\test_auth_token_validate.py tests\web\test_agent_discovery.py tests\web\test_product_subpages_smoke.py
python -m pytest tests\web\test_skill_operations.py
```

### memory-os-cli

Add or update tests to prove:

- Copied-out Skill script runs without package root and without `src/*`.
- Script never calls `spawn`, `xmemo`, `memory-os`, `client`, `xmemo-mcp`, `npm`,
  or `npx`.
- `login` calls device start and token polling.
- `auth add --from-stdin` stores token in user-scoped credential file.
- `auth status` never prints token values.
- `auth status --verify` calls `/v1/auth/token/validate`.
- `logout` deletes local credential and calls revoke when available.
- Operations call `/v1/skill/operations`.
- Service errors return non-zero exit and structured JSON.
- `npm pack --dry-run` includes Skill script and references.

Suggested validation:

```powershell
npm run lint
npm test
npm pack --dry-run
git diff --check

$tmp = Join-Path $env:TEMP ("xmemo-skill-commercial-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item skills\xmemo\scripts\xmemo-skill.mjs (Join-Path $tmp "xmemo-skill.mjs")
node (Join-Path $tmp "xmemo-skill.mjs") doctor
```

## Implementation Phases

### Phase A: memory-os Service Readiness

1. Productize device login for `standalone_skill`.
2. Expand Skill scopes.
3. Add `/v1/skill/operations`.
4. Add ledger expense REST/Skill write path if missing.
5. Add token self-revoke.
6. Update public product/discovery positioning.
7. Deploy and verify production endpoints.

### Phase B: memory-os-cli Skill Runtime

1. Rewrite Skill script as standalone runtime.
2. Add Skill-owned login/auth/logout.
3. Call `/v1/skill/operations`.
4. Remove all CLI/npx/MCP runtime dependency from Skill docs and script.
5. Add copied-out tests.

### Phase C: Commercial Release Gate

Do not release until all are true:

- Production `memory-os` has device login for Skill.
- Production `memory-os` has `/v1/skill/operations`.
- Skill copied-out smoke test passes.
- Skill login flow works against production without exposing raw tokens.
- At least one read and one write operation pass live verification.
- Public docs no longer describe Skill as guidance-only.

## Release Guidance

Recommended split:

- `0.4.176`: LobeHub `client` bin hotfix only.
- `memory-os` service release: standalone Skill commercial backend.
- `0.4.177`: commercial standalone Skill runtime.

Do not tag, push, publish, or deploy unless the user explicitly asks.

## Handoff Prompt For Another AI

```text
You are working across two repos:

1. D:\repos\memory-os
2. D:\repos\memory-os-cli

Goal: implement the commercial standalone XMemo Skill plan in
D:\repos\memory-os-cli\STANDALONE_XMEMO_SKILL_PLAN.md.

Product truth:
- XMemo Skill is a first-class access path.
- It is not a fallback for MCP.
- It is not a host plugin helper.
- It is not an npm CLI wrapper.
- Users must be able to install the Skill, run Skill login, and use XMemo
  without configuring MCP, installing plugins, or installing @xmemo/client CLI.

Do not commit, tag, push, publish, or deploy.
Never print or store token values outside user-scoped credential storage.

Start in D:\repos\memory-os and verify current support:
- auth/device_login.py
- routes/auth_extension.py
- tests/web/test_me_portal.py
- tests/web/test_auth_token_validate.py
- routes/memory_write.py
- routes/recall.py
- routes/action_items.py
- routes/memory_mutation.py
- rendering/product.py
- routes/onboarding.py
- routes/mcp_config.py

Implement memory-os commercial backend:
1. Add Skill-aware device login: surface=standalone_skill, client_id=xmemo-skill,
   skill_version/client_version metadata, Skill copy in approval UI.
2. Expand supported scopes for Skill.
3. Add POST /v1/skill/operations and /api/v1/skill/operations.
4. Route operations to existing services: remember, search/recall, update,
   forget, update_state, reminders, restart restore where appropriate, ledger.
5. Add first-class ledger expense write path if missing.
6. Add token self-revoke if missing.
7. Update public/discovery text so Skill is not guidance-only.
8. Add focused tests.

Then in D:\repos\memory-os-cli:
1. Rewrite skills/xmemo/scripts/xmemo-skill.mjs as self-contained Node built-ins
   only.
2. No src/* imports.
3. No child_process/spawn.
4. No xmemo/memory-os/client/xmemo-mcp/npm/npx calls.
5. Implement login, auth status, auth status --verify, auth add --from-stdin,
   logout.
6. Store credential in user-scoped .xmemo/skill-credentials.json.
7. Call /v1/skill/operations for operations.
8. Update SKILL.md and references to commercial standalone positioning.
9. Add copied-out runtime tests.

Required validation:

memory-os:
- focused pytest for device login, token validate/revoke, skill operations,
  product/discovery text

memory-os-cli:
- npm run lint
- npm test
- npm pack --dry-run
- git diff --check
- copied-out Skill script smoke test from temp directory

Report:
- changed files by repo
- service endpoints added/changed
- Skill auth flow behavior
- live/service gaps that remain
```
