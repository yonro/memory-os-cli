# XMemo Skill Change Log

## Unreleased

- `scripts/xmemo-skill.mjs`: add an explicit, policy-gated `register --reason unattended|declined` fallback for the server's unauthenticated agent registration. Formal `login` remains the primary path.
- `scripts/xmemo-skill.mjs`: persist temporary credentials locally, route their allowed `remember`/`recall`/`search` requests to the temporary REST sandbox, reject unsupported commands clearly, and support claim-status/claim-confirm formal-token handoff.
- `SKILL.md` and references: document the temporary sandbox limits, required user disclosure, bind URL, and formal-account upgrade path.

- `scripts/xmemo-skill.mjs`: normalize successful list payloads (`result.results`, `result.todos`, or a bare array), so `recall`, `search`, and `todo-list` never call `forEach` on an API wrapper object.
- `scripts/xmemo-skill.mjs`: extract IDs from object or string results for `remember` and `expense-add`, preventing `[object Object]` output.
- `scripts/xmemo-skill.mjs`: parse every REST response through one guarded JSON helper. Empty or non-JSON gateway responses now include the HTTP status and a bounded server-response preview.
- `scripts/xmemo-skill.mjs`: add global and command-level `--help`, clear unknown-command errors, and `--compact` rendering for recall/search.
- `SKILL.md` and `references/*.md`: make every command relative to the Skill root (`node scripts/xmemo-skill.mjs ...`) and document compact output and help.
- `test/xmemo-standalone-skill.test.js`: add regression coverage for wrapped list payloads, object IDs, help output, and non-JSON responses.
