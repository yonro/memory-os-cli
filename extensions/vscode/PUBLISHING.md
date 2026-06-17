# Publishing the XMemo VS Code extension

The extension ships to **two** registries from one build:

| Registry | Reaches | Tool |
| --- | --- | --- |
| Visual Studio Marketplace | Official VS Code | `vsce` |
| Open VSX | Cursor, Windsurf, VSCodium, Gitpod | `ovsx` |

CI does both automatically on a `vscode-v*` tag (`.github/workflows/publish-vscode-extension.yml`). It packages the `.vsix` once and pushes the *same artifact* to both registries.

## One-time setup

### 1. Visual Studio Marketplace publisher
1. Create a publisher named **`xmemo`** at https://marketplace.visualstudio.com/manage (must match `publisher` in `package.json`).
2. Create a token:
   - **Recommended (long-term):** Microsoft Entra ID secure automated publishing. Azure DevOps **Global PATs retire 2026-12-01**, so prefer Entra ID over a long-lived PAT.
   - **PAT (interim):** Azure DevOps → Personal Access Tokens → scope **Marketplace > Manage**.
3. Add it as the GitHub repo secret **`VSCE_PAT`**.

### 2. Open VSX namespace + token
1. Sign in at https://open-vsx.org with GitHub and create an access token.
2. Claim the namespace (once):
   ```bash
   npx ovsx create-namespace xmemo --pat <OVSX_TOKEN>
   ```
3. Add the token as the GitHub repo secret **`OVSX_PAT`**.

## Release flow (CI)

```bash
# bump version in extensions/vscode/package.json, commit, then:
git tag vscode-v0.1.0
git push origin vscode-v0.1.0
```

The workflow installs, typechecks, bundles, packages a `.vsix`, uploads it as an artifact, and publishes to both registries.

## Manual publish (local)

```bash
cd extensions/vscode
npm install
npm run build
npx @vscode/vsce package --no-dependencies -o xmemo-vscode.vsix   # validate the .vsix
npx @vscode/vsce publish --no-dependencies                        # → Marketplace (needs VSCE_PAT env or login)
npx ovsx publish xmemo-vscode.vsix --pat <OVSX_TOKEN>             # → Open VSX
```

## Notes

- The extension is bundled with esbuild, so `--no-dependencies` is used (no `node_modules` shipped).
- `contributes.mcpServerDefinitionProviders` is honored on hosts with the MCP API (VS Code ~1.101+). On older hosts it is ignored and the native commands remain the baseline. If marketplace validation flags the contribution, bump `engines.vscode` accordingly.
- Verify the OAuth sign-in flow on a real host before the first public release (see `CHANGELOG.md` roadmap).
