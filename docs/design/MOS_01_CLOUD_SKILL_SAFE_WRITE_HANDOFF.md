# MOS-01: proposed Cloud Skill safe write contract handoff

Owner: authorized `memory-os` project AI
Consumer: `@xmemo/client` Cloud Skill add/update adapters
Status: required proposal; absent from MemoryOS source/OpenAPI at the clean
`origin/master` snapshot `18d7a652de48181a43b10b8f771d3a8df5933884`. This is not an implemented,
reviewed, frozen, or deployed server contract. The CLI fails closed until the
service publishes compatible OpenAPI and response fixtures.

## Required endpoints

### `POST /v1/skills/create`

Request fields: `markdown_content`, `sub_files`, optional `name`, optional
`slug`, `publish` (default false), and optional `team_id`.

The operation must be atomic create-only. A duplicate slug in the effective
personal/team scope returns 409 and does not append a revision or move any
latest/published pointer.

### `PUT /v1/skills/{skill_id}/content`

Request fields: required `expected_revision_id`, optional `markdown_content`,
optional `sub_files`, `publish` (default false), and optional `team_id`.
Omitting content is allowed only to publish the reviewed revision.

The operation must atomically compare the current maintenance head, merge the
provided files while preserving omitted files, append at most one revision,
and update latest/published or team-proposed state. A stale expected revision
returns 409 with no resource or pointer change.

## Compatibility and errors

- Existing upsert/import/component endpoints keep their current behavior.
- The new paths must not delegate to a saving importer before uniqueness/CAS
  checks are acquired in the real storage transaction or lock.
- Distinguish duplicate slug, stale revision, missing skill, permission denial,
  parse failure, and unsupported publication state.
- Preserve current memory read/write scopes, ownership, team role/approval,
  audit, and sandbox policies. Do not invent `skills:*` scopes in this task.
- 404/405 on these paths is interpreted by the CLI as
  `SERVER_CONTRACT_REQUIRED`; the CLI does not fall back.

## Required service tests

1. Two independent repository/service instances race the same scoped slug:
   exactly one create succeeds and one receives 409.
2. Two independent instances update the same expected revision: exactly one
   succeeds and one receives 409.
3. Reopen persisted storage and prove resource count, components, latest head,
   and published/proposed head match the winning transaction.
4. Prove a failed parse, permission check, stale CAS, or duplicate create leaves
   no orphan revision and changes no pointer.
5. Prove omitted sub-files survive update, explicit replacements change only
   named paths, and path/case normalization is deterministic.
6. Exercise personal publish and team proposal/approval policy separately.

After source review, record the deployed service SHA and run the CLI contract
fixtures against that deployment before declaring Cloud Skill add/update
available to users.
