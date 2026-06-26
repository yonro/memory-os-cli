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

### Kimi Code / Kiro

配置文件：`~/.kiro/settings/mcp.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${XMEMO_KEY}",
        "X-Memory-OS-Agent-ID": "${XMEMO_AGENT_ID}",
        "X-Memory-OS-Agent-Instance-ID": "${XMEMO_AGENT_INSTANCE_ID}"
      }
    }
  }
}
```

> ⚠️ **重要**：Kimi Code 通过 `bearerTokenEnvVar` 读取环境变量。确保 `XMEMO_KEY` 在启动 Kimi Code 的**同一环境**中已导出。

---

### Claude Desktop

配置文件：`%APPDATA%\Claude\settings.json` (Windows) 或 `~/Library/Application Support/Claude/settings.json` (macOS)

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp"
    }
  }
}
```

Claude Desktop 支持 MCP OAuth，首次使用 XMemo 工具时会自动弹出浏览器授权窗口。

---

### Cursor

配置文件：`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp"
    }
  }
}
```

Cursor 同样支持 OAuth，无需手动配置 `Authorization`。

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
      "type": "http",
      "httpUrl": "https://xmemo.dev/mcp"
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
      "type": "http",
      "url": "https://xmemo.dev/mcp"
    }
  }
}
```

Antigravity 2.0 支持 OAuth，首次使用时会自动打开浏览器完成授权。

---

### Windsurf / Cline / Trae / Zed / Qwen

这些客户端通常使用标准的 `mcp.json` 格式：

```json
{
  "mcpServers": {
    "XMemo": {
      "type": "streamable-http",
      "url": "https://xmemo.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${XMEMO_KEY}"
      }
    }
  }
}
```

---

## 验证配置

配置完成后，向你的 AI 助手提问：

> "列出你可以使用的 XMemo 工具。"

如果 AI 能列出 `remember`、`recall`、`search_memory` 等工具，说明配置成功。

或者运行 XMemo CLI 的连通性检查：

```bash
xmemo token status --verify
xmemo smoke --client <your-client>
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| "无法连接到 XMemo" | Token 未设置 | 确认 `XMEMO_KEY` 环境变量已导出 |
| "401 Unauthorized" | Token 无效或过期 | 访问 xmemo.dev 重新获取 token |
| "OAuth 窗口未弹出" | 客户端不支持 MCP OAuth | 改用 Bearer Token 方式 |
| "工具未显示" | 客户端未重新加载 MCP 配置 | 重启客户端或执行 `/mcp reload` |
| "代理连接失败" | Copilot CLI 代理未运行 | 保持 `xmemo mcp proxy` 运行 |

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
