# XMemo MCP 配置教程

## 快速开始（3 步）

### 第 1 步：获取 XMemo Token

访问 [https://xmemo.dev](https://xmemo.dev) 注册账号，获取你的 API Key（Token）。

### 第 2 步：配置环境变量

**macOS / Linux (Bash/Zsh)**：

```bash
export XMEMO_KEY="your-xmemo-token-here"
export XMEMO_AGENT_ID="your-client-name"        # 可选，如 claude-code, cursor
export XMEMO_AGENT_INSTANCE_ID="$(uuidgen)"     # 可选，设备级唯一标识
```

**Windows (PowerShell)**：

```powershell
$env:XMEMO_KEY = "your-xmemo-token-here"
$env:XMEMO_AGENT_ID = "your-client-name"
$env:XMEMO_AGENT_INSTANCE_ID = [Guid]::NewGuid().ToString()
```

**Windows (CMD)**：

```cmd
set XMEMO_KEY=your-xmemo-token-here
set XMEMO_AGENT_ID=your-client-name
set XMEMO_AGENT_INSTANCE_ID=random-guid-here
```

### 第 3 步：添加 MCP 配置

根据你的客户端类型，将配置添加到对应的 MCP 配置文件中。

---

## 各客户端配置详情

### Kimi Code

配置文件：`~/.kimi-code/mcp.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "url": "https://xmemo.dev/mcp",
      "bearerTokenEnvVar": "XMEMO_KEY",
      "headers": {
        "X-Memory-OS-Agent-ID": "kimi-code",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

> ⚠️ **重要**：Kimi Code 通过 `bearerTokenEnvVar` 读取环境变量。确保 `XMEMO_KEY` 在启动 Kimi Code 的**同一环境**中已导出。推荐直接运行 `xmemo setup kimi-code`。

---

### Kiro

配置文件：`~/.kiro/settings/mcp.json`

Kiro 使用 `mcp-remote` 连接 Hosted MCP，并从 `XMEMO_KEY` 读取 Bearer Token。推荐运行：

```bash
xmemo setup kiro
```

不要把 Kiro 与 MCP OAuth 客户端混为一谈：`xmemo login` 可以通过浏览器获取 CLI 凭据，但 Kiro 的 MCP 请求仍由环境变量认证。

---

### Claude Desktop

配置文件：`%APPDATA%\Claude\claude_desktop_config.json` (Windows) 或 `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "XMemo": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://xmemo.dev/mcp",
        "--header",
        "Authorization:Bearer ${XMEMO_KEY}",
        "--header",
        "X-Memory-OS-Agent-ID:claude-desktop",
        "--header",
        "X-Memory-OS-Agent-Instance-ID:${XMEMO_AGENT_INSTANCE_ID}"
      ],
      "env": {
        "XMEMO_KEY": "${env:XMEMO_KEY}",
        "XMEMO_AGENT_INSTANCE_ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

Claude Desktop 的 CLI 配置路径使用 `mcp-remote` + `XMEMO_KEY`；它不属于本仓库 CLI 标记的 MCP OAuth 客户端。推荐运行 `xmemo setup claude-desktop` 生成配置。

---

### Cursor

配置文件：`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${env:XMEMO_KEY}",
        "X-Memory-OS-Agent-ID": "cursor",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

Cursor 的 CLI 配置使用 `XMEMO_KEY` Bearer Token；只有 Cursor marketplace 插件是 OAuth-first，两者不要混用。推荐运行 `xmemo setup cursor` 生成配置。

---

### Copilot CLI

Copilot CLI 需要本地代理（因为它不支持远程 HTTP 直接连接）：

```bash
# 1. 安装 XMemo CLI
npm install -g @xmemo/client

# 2. 登录并保存 token
xmemo login

# 3. 配置 Copilot CLI
xmemo setup copilot

# 4. 启动本地代理（保持运行）
xmemo mcp proxy
```

---

### Gemini CLI

配置文件：`~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "httpUrl": "https://xmemo.dev/mcp",
      "headers": {
        "X-Memory-OS-Agent-ID": "gemini-cli",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

Gemini CLI 使用 OAuth 认证，无需手动配置 token。

---

### Grok (xAI)

配置文件：`~/.grok/config.toml`

```toml
[mcp_servers.XMemo]
url = "https://xmemo.dev/mcp"
bearer_token_env_var = "XMEMO_KEY"

[mcp_servers.XMemo.http_headers]
"X-Memory-OS-Agent-ID" = "${XMEMO_AGENT_ID}"
"X-Memory-OS-Agent-Instance-ID" = "${XMEMO_AGENT_INSTANCE_ID}"
```

---

### Antigravity 2.0

配置文件：`~/.antigravity2/mcp.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "serverUrl": "https://xmemo.dev/mcp",
      "headers": {
        "X-Memory-OS-Agent-ID": "antigravity",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

Antigravity 2.0 支持 OAuth，首次使用时会自动打开浏览器完成授权。

---

### Windsurf / Cline

这些客户端使用 Bearer Token。不同版本的配置键可能不同，推荐用对应的 CLI ID 生成配置：`xmemo setup windsurf` 或 `xmemo setup cline`。

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${env:XMEMO_KEY}",
        "X-Memory-OS-Agent-ID": "your-client-id",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

### Trae / Trae Solo / Zed

这些客户端由 CLI 配置为 `mcp-remote` + `XMEMO_KEY`，不要复制上面的直连 HTTP 示例。运行 `xmemo setup trae`、`xmemo setup trae-solo` 或 `xmemo setup zed`，并在启动客户端的同一环境中设置 `XMEMO_KEY`。

### Qwen

Qwen 使用 MCP OAuth，无需在 MCP 配置中写入 `XMEMO_KEY`：

```json
{
  "mcpServers": {
    "XMemo": {
      "httpUrl": "https://xmemo.dev/mcp",
      "headers": {
        "X-Memory-OS-Agent-ID": "qwen",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

首次连接时按客户端提示完成浏览器授权。

---

## 验证配置

配置完成后，向你的 AI 助手提问：

> "列出你可以使用的 XMemo 工具。"

如果 AI 能列出 `remember`、`recall`、`recall_context`、`add_expense` 等工具，说明配置成功。

或者运行 XMemo CLI 的连通性检查：

```bash
xmemo token status --verify
xmemo smoke --client <your-client>
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| "无法连接到 XMemo" | 网络、地址或客户端传输配置错误 | 运行 `xmemo doctor`，确认地址为 `https://xmemo.dev/mcp`，再检查客户端日志 |
| "401 Unauthorized" | Token 缺失、无效或过期 | 运行 `xmemo auth status --verify`；按输出重新登录或更新 `XMEMO_KEY` |
| "403 Forbidden" | Token 有效，但缺少所需 scope 或当前资源不在授权范围 | 重新授权包含所需 scope 的正式凭据，并确认使用的是已授权的项目/团队范围；不要仅为绕过错误而扩大 scope |
| "OAuth 窗口未弹出" | 当前客户端不是 CLI 标记的 MCP OAuth 客户端，或客户端未重载配置 | 先运行 `xmemo mcp add <client-id> --write` 并重启客户端；对于 Bearer 客户端改为在同一启动环境设置 `XMEMO_KEY` |
| "工具未显示" | MCP 配置未加载、服务名重复或客户端缓存旧配置 | 检查生成配置中的 `XMemo`、重启/Reload MCP，再运行 `xmemo doctor` |
| `XMEMO_KEY` 未检测到 | 环境变量没有传给启动客户端的那个进程 | 在启动客户端的同一终端运行 `xmemo auth status` 或 `xmemo token status --verify`，设置变量后重新启动客户端；不要把 token 写入项目文件 |
| 召回结果为空 | 查询词、path、scope 或项目范围不匹配 | 先确认认证成功，再使用明确的查询词和正确的授权 scope；项目上下文必须传入准确的 `project_id`，不能只传项目名 |
| 项目范围错误 | 使用了错误的 scope、team 或 project ID | 使用当前账号已授权的精确 `project_id`；不要通过扩大范围来掩盖 ID 错误 |
| `XMEMO_AGENT_INSTANCE_ID` 每次变化 | 每次启动都重新生成实例 ID | 使用稳定的用户环境变量，或运行 `xmemo mcp add <client-id> --write` 让 CLI 保存用户级实例 ID；不要将其提交到 git |
| 出现重复记忆 | 同一事实被重复保存，或重复安装了 Native 与 MCP 两个集成 | 保存前先 `recall`；OpenClaw/Hermes 使用 Native 集成时不要再安装同一能力的 MCP fallback，除非明确需要 |
| forget/delete 不生效 | 误用了不存在的 `delete` 工具、目标不是精确 ID，或客户端没有刷新 | MCP 使用 `forget` 并传入 `current` 或精确 memory ID；删除后刷新并用 `recall` 验证，必要时用 `restore_memory` 恢复可恢复删除 |
| "代理连接失败" | Copilot CLI 本地代理未运行 | 保持 `xmemo mcp proxy` 运行，并检查代理端口配置 |

---

## 进阶用法

### 使用 XMemo CLI 自动配置

```bash
# 安装 CLI
npm install -g @xmemo/client

# 登录（OAuth 或 device-login）
xmemo login

# 一键配置所有检测到的客户端
xmemo setup --all --write

# 或单独配置某个客户端
xmemo setup codex
xmemo setup cursor
xmemo setup grok
```

### 行为配置（AI 记忆策略）

`xmemo setup <client>` 默认会安装一个行为配置文件，指导 AI 在以下时机使用 XMemo：

1. **任务开始时**：自动搜索/召回相关项目记忆
2. **关键决策后**：保存高信号决策和修复
3. **从不存储**：密钥、token、PII 等敏感信息

你可以查看当前行为配置：

```bash
xmemo mcp profile codex
```

---

*配置遇到问题？提交 Issue 到 [GitHub](https://github.com/yonro/memory-os-cli/issues) 或联系 support@xmemo.dev*
