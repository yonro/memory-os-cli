# XMemo MCP Server

> **AI 驱动的智能笔记与记忆管理 MCP 服务，让大模型拥有持久化记忆能力。**

[![smithery badge](https://smithery.ai/badge/xmemo/xmemo)](https://smithery.ai/servers/xmemo/xmemo)

---

## 简介

XMemo 是一个 **用户拥有的、托管的 MCP 记忆服务**，让 AI 智能体（Agent）能够跨会话、跨项目、跨工具持久化地存储、检索、管理和更新笔记与记忆片段，形成个人知识库。

无论你是使用 Kimi、Claude、Cursor、Copilot、Gemini、Grok 还是其他 MCP 兼容客户端，XMemo 都能为你的 AI 提供"长期记忆"能力——让每次对话都能记住之前的决策、偏好、项目上下文和待办事项。

### 核心价值

- **持久化记忆**：AI 的决策、偏好、项目上下文不再随会话消失
- **结构化知识管理**：支持搜索、更新、删除、脱敏、解释等完整生命周期管理
- **跨客户端同步**：一次记忆，处处可用（Copilot、Claude、Cursor、IDE、CLI 等）
- **隐私优先**：用户拥有数据，无遥测，无分析，token 不写入配置文件
- **零本地部署**：Hosted HTTP 服务，无需安装数据库或服务器

---

## 适用场景

| 场景 | 示例 |
|------|------|
| **项目上下文记忆** | "记住这个项目的架构决策：使用 PostgreSQL + Prisma，避免 MongoDB" |
| **编码偏好记录** | "记住我更喜欢 2 空格缩进，不使用分号" |
| **跨会话 TODO 追踪** | "创建一个 TODO：下周重构 auth 模块" |
| **决策审计** | "记录今天决定将 CI 从 GitHub Actions 迁移到 GitLab CI" |
| **知识库搜索** | "搜索我之前保存的关于 Docker 网络配置的记忆" |

---

## 支持的 MCP 工具

XMemo MCP 服务器提供以下工具，每个工具都有清晰的名称、描述和参数定义：

| 工具名称 | 功能描述 |
|----------|----------|
| `remember` | 保存一条新记忆（笔记、决策、偏好等） |
| `recall` / `recall_context` | 检索与当前上下文相关的记忆 |
| `search_memory` | 通过关键词搜索记忆 |
| `update_memory` | 修改/更新已有记忆内容 |
| `forget` / `forget_memory` | 删除指定记忆（需确认） |
| `redact_memory` | 对记忆内容进行脱敏处理，保留审计轨迹 |
| `explain_memory` | 解释某条记忆为何存在或为何被匹配 |
| `create_memory_todo` | 创建记忆相关的待办/跟进任务 |
| `list_memory_todos` | 列出所有待办事项 |
| `complete_memory_todo` | 标记待办事项为已完成 |
| `record_event` | 记录里程碑或重要决策事件 |
| `get_timeline` | 查看近期事件时间线 |
| `add_expense` | 记录一条流水/记账条目 |

---

## 接入配置

### 方式一：Hosted Streamable HTTP（推荐）

在支持 Streamable HTTP 的客户端中，添加以下配置：

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

**环境变量说明**：

| 变量名 | 是否必填 | 说明 |
|--------|----------|------|
| `XMEMO_KEY` | **是** | XMemo 颁发的 Bearer Token，用于身份认证 |
| `XMEMO_AGENT_ID` | 否 | 稳定的智能体家族 ID，如 `claude-code`、`copilot-cli` |
| `XMEMO_AGENT_INSTANCE_ID` | 否 | 本地安装实例 ID，用于设备级归因 |

获取 Token：访问 [https://xmemo.dev](https://xmemo.dev) 注册并获取 API Key。

### 方式二：OAuth 客户端（部分客户端支持）

Cursor、Gemini CLI、Antigravity、OpenCode 等客户端支持 MCP OAuth 流程，无需手动配置 `XMEMO_KEY`：

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

首次调用 XMemo 工具时，客户端会自动弹出浏览器 OAuth 授权窗口。

### 方式三：Local stdio（通过 CLI 代理）

如果你的客户端仅支持 stdio，可以安装 XMemo CLI 作为本地代理：

```bash
npm install -g @xmemo/client
xmemo login
xmemo setup <client>
```

支持的客户端：`codex`、`cursor`、`copilot`、`gemini`、`antigravity`、`grok`、`kiro`、`claude-desktop`、`windsurf`、`cline`、`kimi`、`qwen`、`trae` 等。

---

## 使用示例

### 场景 1：记录项目架构决策

> **用户**："记住我们决定用 PostgreSQL 而不是 MongoDB，因为需要强一致性和复杂查询。"

**AI 调用 `remember`**：
```json
{
  "tool": "remember",
  "content": "架构决策：本项目使用 PostgreSQL 作为主数据库，放弃 MongoDB。原因：需要 ACID 事务、复杂 JOIN 查询和强一致性保证。"
}
```

> **AI**："已保存。后续当你询问数据库选型时，我会优先推荐 PostgreSQL 方案。"

---

### 场景 2：跨会话搜索记忆

> **用户**："我之前保存过关于 CI/CD 的配置，帮我找出来。"

**AI 调用 `search_memory`**：
```json
{
  "tool": "search_memory",
  "query": "CI/CD 配置"
}
```

> **AI**："找到 2 条相关记忆：
> 1. *GitHub Actions 工作流配置*（2025-06-10）
> 2. *部署到 AWS ECS 的脚本*（2025-06-12）
> 需要我展示详细内容吗？"

---

### 场景 3：创建跨会话 TODO

> **用户**："提醒我下周重构 auth 模块，并把当前的 JWT 实现改成 Session + Redis。"

**AI 调用 `create_memory_todo`**：
```json
{
  "tool": "create_memory_todo",
  "title": "重构 auth 模块：将 JWT 改为 Session + Redis",
  "due": "next-week"
}
```

> **AI**："TODO 已创建。下次对话时，你可以问我'列出我的 TODO'来查看所有待办。"

---

## 技术规范

- **协议版本**：MCP Protocol 2025-03-26
- **传输协议**：Streamable HTTP（`/mcp` 端点）为主，SSE 与 stdio 可选
- **认证方式**：Bearer Token（`Authorization: Bearer <token>`）或 MCP OAuth
- **错误格式**：标准 MCP error 格式，包含 `code` 和 `message`
- **参数校验**：所有工具均有完整的 JSON Schema 参数定义

---

## 客户端兼容性

| 客户端 | 支持方式 | 配置命令 |
|--------|----------|----------|
| **Kimi Code** | Streamable HTTP + Bearer Token | `xmemo setup kiro` |
| **Claude Desktop** | Streamable HTTP + OAuth | `xmemo setup claude-desktop` |
| **Cursor** | Streamable HTTP + OAuth | `xmemo setup cursor` |
| **Copilot CLI** | Local Proxy + Bearer Token | `xmemo setup copilot` |
| **Gemini CLI** | Streamable HTTP + OAuth | `xmemo setup gemini` |
| **Grok (xAI)** | Streamable HTTP + Bearer Token | `xmemo setup grok` |
| **Antigravity** | Streamable HTTP + OAuth | `xmemo setup antigravity` |
| **Windsurf** | Streamable HTTP + Bearer Token | `xmemo setup windsurf` |
| **Cline** | Streamable HTTP + Bearer Token | `xmemo setup cline` |
| **Trae** | Streamable HTTP + Bearer Token | `xmemo setup trae` |
| **Qwen CLI** | Streamable HTTP + OAuth | `xmemo setup qwen` |
| **Zed** | Streamable HTTP + Bearer Token | `xmemo setup zed` |

---

## 隐私与安全

- **无遥测**：CLI 和 MCP 服务均不发送任何遥测或分析数据
- **Token 安全**：生成的配置文件仅引用环境变量（如 `${XMEMO_KEY}`），从不嵌入真实 token 值
- **OAuth 优先**：支持的客户端优先使用 OAuth 流程，避免手动管理密钥
- **设备级标识**：`XMEMO_AGENT_INSTANCE_ID` 为设备级非敏感标识符，用于归因分析，不暴露个人信息
- **数据归属**：用户完全拥有记忆数据，支持随时导出、删除或脱敏

---

## 资源链接

- 🏠 **官网**：https://xmemo.dev
- 📖 **MCP 产品页**：https://xmemo.dev/product/mcp
- 🔧 **GitHub 仓库**：https://github.com/yonro/memory-os-cli
- 📝 **行为配置（Skill）**：[`skills/xmemo/SKILL.md`](skills/xmemo/SKILL.md)
- 🖼️ **Logo**：[`plugins/xmemo/assets/logo.svg`](plugins/xmemo/assets/logo.svg)

---

## 许可证

[MIT](LICENSE)

---

*让每一次 AI 对话，都能记住过去的自己。*
