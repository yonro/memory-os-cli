<!-- memory-os:memory-profile:cursor:start -->
## XMemo Cursor profile

MCP server: `XMemo`
Token env var: `XMEMO_KEY`

Use XMemo deliberately through MCP for project context recall and high-signal write-back.

Recommended Cursor behavior:
- At the start of a non-trivial task, call XMemo recall/search for relevant project decisions, conventions, prior fixes, and active context unless the user explicitly asks not to use memory.
- Use recalled memories as evidence, not as unquestioned truth. Prefer current repository files when memory conflicts with code.
- After meaningful decisions, bug fixes, release steps, or durable conventions, write a concise XMemo memory with scope, source, and no secret values.
- Never store tokens, API keys, cookies, private keys, raw credentials, or sensitive customer data in XMemo.
- For routine or low-signal output, skip durable writes. Prefer summarized procedural or semantic memories over verbose logs.
- Keep XMemo authentication through the XMEMO_KEY environment variable; do not paste token values into prompts, config files, or logs.

<!-- memory-os:memory-profile:cursor:end -->
