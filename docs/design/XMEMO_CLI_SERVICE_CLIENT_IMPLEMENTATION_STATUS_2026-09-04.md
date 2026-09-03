# XMemo CLI service-client implementation status

Plan: `XMEMO-CLI-CLIENT-V1`
Audit date: 2026-09-04
CLI base: `origin/main` at `49a959f5f3c1cd72b4d449209054e91bd158afe4`

## Outcome

The planned CLI code is implemented for the seven basic service calls and the
safe, currently available Knowledge, Dream, and Cloud Skill contracts. It is
not an "all features available in production" claim. The
two Cloud Skill write adapters are implemented but intentionally remain marked
`contract-required` until MemoryOS provides and deploys MOS-01. A new binary
file cannot yet replace the source of an existing file-backed Knowledge item,
because the checked service has no API that creates a new version under the
same Document ID; the CLI supports the safe existing-Document update route and
rejects unsupported source conversion.

No merge, version bump, tag, package publish, service deployment, or production
write was performed.

## Local validation

- The targeted service suite passes. It includes child-process calls
  through a real loopback HTTP server for all 19 frozen commands, delayed-body
  timeouts, unknown writes, redaction, HTML 405 contract rejection, and a real
  npm archive executed outside the repository.
- Package smoke: the archive was unpacked to a temporary directory; a CLI-only
  copy called the HTTP fixture without `skills/`, while a Skill-only copy called
  the fixture without CLI `src/`.
- Full-suite, lint, diff, and formal-review results are recorded only after they
  actually run; this document does not treat the fixture as production E2E.
- Full repository suite, lint, package, and diff checks are rerun against the
  final candidate before review; formal review is tracked outside this document.
- Server source rechecked at clean local/origin
  `18d7a652de48181a43b10b8f771d3a8df5933884`;
  both proposed MOS-01 paths remain absent. No deployed service was checked.

## Work-unit coverage

| Work unit | Status | Evidence / remaining condition |
| --- | --- | --- |
| CLI-00 | implemented | Registry freezes seven basic calls and exactly twelve domain entries. |
| CLI-01 | implemented locally | HTTPS/loopback origin gate, whole-response timeout/interruption, retry policy, envelopes, typed receipts/input, and command-specific JSON schema/examples. |
| CLI-02 | implemented locally | Optional explicit service scopes without changing default login scopes; origin-bound credentials; legacy migration gate; recursive error redaction; read-only `doctor --services`. |
| CLI-03 | implemented | Memory/context/state/restart adapters; full restart request models accepted through `--input`. |
| CLI-04 | implemented locally | Knowledge search/read, explicit first-page cursor, `--from` fixed-revision continuation, cursor propagation, unmodified citations/index state, and receipts. |
| CLI-05 | implemented locally; one server limitation | Text/document add, prevalidated base/Document, bounded upload/extraction, provenance-preserving CAS update, publish-only, partial/unknown outcomes. New binary replacement requires a same-Document version-upload server contract. |
| CLI-06 | implemented | Settings/entitlement preflight, stable idempotency key, apply availability, bounded wait, terminal failures, receipts, candidate validation, and single-item apply. |
| CLI-07 | implemented locally | Cloud Skill list/show/run, draft/published distinction, script selection, HTTP budget covering 1..60-second execution, business failure, and unknown outcome handling. |
| CLI-08 | adapter complete; service blocked | File/directory safety, create-only request, content CAS, publish confirmation, and no legacy fallback are implemented. MOS-01 must exist and be deployed. |
| CLI-09 | partial | Windows loopback HTTP and real-package isolation are covered. Unix execution and authorized test-tenant E2E remain pending. |
| CLI-10 | release-gated | Final immutable-scope review and release authorization remain external gates rather than implementation claims. |

## Product boundary

The public command surface remains limited to:

- Basic calls: `memory add/search`, `context recall`, `state save/restore`, and
  `restart snapshot/restore`.
- Knowledge: `add/search/read/update`.
- Dream: `preview/show/apply`.
- Cloud Skill: `add/list/show/update/run`.

No revision, diff, export, rollback, schedule-management, batch, generic API,
or background-daemon command was added.

## Safety and agent-use behavior

- Every new business command supports `--json`; successful and failed machine
  output is one envelope on stdout.
- Every business command accepts JSON input where the command contract permits
  it. Cloud Skill run reserves `--input` for `input_args`, as frozen in the plan.
- Duplicate flag/JSON fields are rejected. High-impact actions require an
  interactive confirmation or an explicit `--yes`; missing confirmation exits
  with code 10.
- Read/show receipts bind origin, scope, resource, and viewed versions. Writes
  never silently refresh a stale receipt.
- Side-effect requests are not automatically replayed. Disconnect or timeout
  after a write is sent exits 11; known multi-step partial completion exits 12.
- Local SIGINT exits 130 for read/wait operations; interruption during an
  already-sent write remains an unknown outcome.
- Human output includes the actual bounded service result instead of only an
  acknowledgement line.
- Stored credentials are origin-bound. CLI and `skills/xmemo` retain separate
  runtime code and credential stores; neither imports or shells out to the other.

## Remaining external verification

1. Implement, review, and deploy MOS-01 in `memory-os`, then run create/create
   and update/update multi-instance races plus persisted reopen checks.
2. If direct replacement of a file-backed Knowledge source is required, add an
   authorized same-Document version-upload contract in `memory-os`; the existing
   `content/from-document` route already enforces that the Document ID matches.
3. Run authorized test-tenant E2E for one success and key failure path in each
   domain, and verify the deployed service SHA, feature flags, extraction queue,
   Dream entitlement, and Cloud Skill sandbox.
4. Repeat the package/HTTP checks on a Unix host. Do not infer production
   readiness from the successful Windows fixture.
