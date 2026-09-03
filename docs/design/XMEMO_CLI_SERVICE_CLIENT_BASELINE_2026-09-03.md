# XMemo CLI service-client baseline (CLI-00)

计划：`XMEMO-CLI-CLIENT-V1`
核验日期：2026-09-03
状态：历史基线，已由 `XMEMO_CLI_SERVICE_CLIENT_IMPLEMENTATION_STATUS_2026-09-04.md` 取代。本文保留 2026-09-03 的契约快照，不代表当前实现、审核或部署状态。

## Scope and repository evidence

| Item | Evidence |
| --- | --- |
| CLI worktree | Isolated worktree used for historical local validation |
| CLI baseline | detached `HEAD` `6a82011d202316997220e9183c2b309a7c5df61d` |
| CLI package | `@xmemo/client` `0.4.181` |
| CLI main checkout | Not modified by the isolated validation worktree |
| Service source checked | 历史值 `11fd8652a528b95de33310f20b2b6b70323b4f90`；当前值见实施状态文档 |
| Service ref checked | 历史值 `1fa16bfdb9c7c6db063e100d3ddbc00ec704a9f4`；不要用于当前判断 |
| Service deployment | Not checked; source/OpenAPI evidence is not deployment evidence |
| Independent Skill | `skills/xmemo/scripts/xmemo-skill.mjs`; no CLI import or shell-out added |

The service checkout was already three commits behind its `origin/master` ref
when checked. The local source and checked OpenAPI file are the contract
evidence for this baseline; the remote ref must be refreshed before any
target-environment claim.

## Frozen command registry

The source of truth is
`src/api/contracts/command-registry.js`. It contains the seven basic calls and
exactly the twelve planned domain entries. Existing setup, authentication,
diagnostic, MCP, profile, update, privacy, and uninstall commands remain
outside this new registry and are not removed.

| CLI entry | Service route(s) | Scope | Side effect | Status |
| --- | --- | --- | --- | --- |
| `memory add` | `POST /api/v1/remember` | `memory:write` | yes | current |
| `memory search` | `GET /api/v1/recall` | `memory:read` | no | current |
| `context recall` | `POST /api/v1/recall/context` | `memory:read` | no | current, read-only POST |
| `state save` | `POST /api/v1/update_state` | `memory:write` | yes | current |
| `state restore` | `POST /api/v1/skill/operations`, `operation=state-restore` | `memory:read` | no | current, read-only dispatcher operation |
| `restart snapshot` | `POST /api/v1/restart/snapshot` | `memory:write` | yes | current |
| `restart restore` | `POST /api/v1/restart/restore` | `memory:read`, `memory:restore` | yes | current; may restore remote state |
| `knowledge add` | base/document/item or item-from-document sequence | `knowledge:write` | yes | current |
| `knowledge search` | `POST /api/v1/knowledge/search` | `knowledge:read` | no | current, read-only POST |
| `knowledge read` | item metadata plus fixed revision read | `knowledge:read` | no | current |
| `knowledge update` | content, content-from-document, and metadata paths | `knowledge:write` | yes | current; CAS fields required by adapter |
| `dream preview` | settings read plus `POST /api/v1/me/dream/runs` | memory read/write | yes (run creation) | current |
| `dream show` | `GET /api/v1/me/dream/runs/{run_id}` | `memory:read` | no | current |
| `dream apply` | `POST /api/v1/me/dream/runs/{run_id}/confirm` | `memory:write` | yes | current |
| `cloud-skill add` | proposed `POST /v1/skills/create` | memory write | yes | contract-required |
| `cloud-skill list` | `GET /v1/skills` | memory read | no | current |
| `cloud-skill show` | skill detail plus components | memory read | no | current |
| `cloud-skill update` | proposed `PUT /v1/skills/{skill_id}/content` | memory write | yes | contract-required |
| `cloud-skill run` | `POST /v1/skills/{skill_id}/execute` | memory write | yes | current, no retry |

The registry records route intent only. Implementations use the checked
OpenAPI/source facts and fail closed when a required contract is absent; they
do not infer a full schema from MCP tool descriptions.

## Service contract facts

The checked service source exposes both `/api/v1/...` and compatibility
`/v1/...` aliases for the memory, knowledge, document, Dream, and restart
routes. The published OpenAPI uses `/api/v1/...` for those domains and `/v1`
for Cloud Skill routes. The selected defaults therefore preserve the documented
OpenAPI route rather than relying on an undocumented alias.

Relevant request facts from the checked OpenAPI/source:

- `MemoryRememberRequest` requires `content` and `path`.
- `RecallContextRequest` requires `query`; `include_knowledge` defaults false.
- `MemoryStateUpdateRequest` accepts `state_key`, structured state fields,
  `bucket`, `scope`, and bounded `ttl_seconds`.
- Restart snapshot/restore accept `state_key`, session selectors, restore
  controls, and bounded TTL. Restore can return a `state_update`, so the CLI
  treats it as a remote write even though it does not write local project files.
- Knowledge search accepts `query`, optional base, `limit` (1..100), and an
  opaque `cursor`; results carry `next_cursor` in the page response.
- Knowledge content update requires `expected_current_revision_id`; document
  update additionally requires `document_id` and `expected_document_version`.
- Document upload accepts `filename` and base64 content, requires the memory
  data-plane write permission as well as document runtime availability, and the
  checked route reports a 4 MiB raw-file limit.
- Dream preview uses `window_days` and optional `idempotency_key`; confirmation
  requires `item_id`, `expected_run_version`, and
  `expected_settings_version`.
- Cloud Skill execution accepts `script_path`, optional `revision_id` and
  `input_args`, and `timeout_seconds` bounded to 1..60 seconds.

The device-login implementation accepts the explicit scopes
`memory:read`, `memory:write`, `memory:restore`, `ledger:read`,
`ledger:write`, `knowledge:read`, and `knowledge:write`; when scopes are not
requested the service defaults to memory read/write. Dream checks the generic
REST read/write scope plus owner/entitlement rules. Cloud Skill currently uses
the generic memory read/write scope and owner/team checks; no new `dream:*` or
`skills:*` scope is introduced by this work.

## Cloud Skill safety blocker

The current source exposes:

- `POST /v1/skills` and `POST /v1/skills/import`, both capable of saving into
  an existing scoped slug;
- `PUT /v1/skills/{skill_id}/components`, which does not accept the planned
  expected-revision CAS field; and
- detail, revision, component, publish, execute, render, and export routes.

The planned safe paths `POST /v1/skills/create` and
`PUT /v1/skills/{skill_id}/content` are absent from the checked source and
OpenAPI. CLI-00 therefore marks only `cloud-skill.add` and
`cloud-skill.update` as `contract-required`. Future adapters must return a
stable server-contract error on 404/405 or incompatible response and must not
send an unsafe fallback request. MOS-01 remains a separate handoff to the
authorized `memory-os` project owner; no service files were modified here.

## Frozen implementation constraints

- New business commands will use the `schemaVersion/ok/command/data/meta/error`
  envelope and single-object JSON stdout under `--json`; progress goes to
  stderr.
- `Authorization` is attached only to the selected HTTPS service origin (with
  explicit loopback development exception), never followed across origins.
- Writes are not retried unless a verified idempotency/CAS contract says so;
  unknown outcomes remain unknown and are not replayed.
- `--from` read receipts bind update/apply/run to the resource, origin, scope,
  and viewed revision/settings version. Dream receipts use
  `confirmation_version` and candidate IDs; Cloud Skill receipts record
  published/draft status and default execution accepts published receipts
  only. A receipt is not an authorization token or approval proof.
- Credential-file tokens are origin-bound to login metadata. Legacy files with
  no origin metadata are rejected unless the caller explicitly opts into the
  default-service-only migration path with `--allow-legacy-credential`.
- Local file/input validation precedes Knowledge base creation. Document upload
  extraction is bounded and multi-step failures return resumable partial
  results; content update followed by publish uses the authoritative
  post-update version.
- Read-only POST requests may use bounded retry; side-effect requests never
  auto-replay. Response bodies are bounded before decoding completes, and new
  service commands reject unknown options/input fields.
- `skills/xmemo` remains runtime- and credential-independent from the CLI.

## Remediation evidence and review state

Changed files in this worktree include:

- `src/api/contracts/command-registry.js` — frozen registry and availability
  metadata.
- `test/command-registry.test.js` — count, route, scope, and safety assertions.
- `src/api/*.js` — shared service transport, errors, envelopes, inputs, receipts,
  upload safety, and command help schemas.
- `src/commands/service.js`, `knowledge.js`, `dream.js`, `cloud-skill.js` —
  command adapters and safety gates.
- `test/service-client.test.js`, `test/service-command.test.js` — regression
  coverage for the first review findings and command contracts.
- `docs/design/XMEMO_CLI_SERVICE_CLIENT_BASELINE_2026-09-03.md` — this audit
  record.

Historical validation at that checkpoint: `npm test` 166 passed / 0 failed,
`npm run lint` passed, `git diff --check` passed, and `npm pack --dry-run`
passed using a worktree-local npm cache. These counts do not describe the final
scope. The prior review request was
`824402e1-b80e-4012-85c2-891b2b006ce1` and was changes-requested; a new request
must include the immutable scope snapshot supplied by the current DevFlow
review helper.

Next authorized unit: CLI-01, implementing the shared REST transport,
validated inputs, error/envelope mapping, read receipts, and help schema while
preserving the existing CLI command behavior.
