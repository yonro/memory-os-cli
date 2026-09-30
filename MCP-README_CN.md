# XMemo MCP 接入

> 面向 AI 智能体的用户私有 Memory OS。通过 MCP 客户端连接 XMemo 托管的 MCP 服务（`https://xmemo.dev/mcp`），或在本地运行 `xmemo-mcp` stdio 服务。

[![MCP Badge](https://lobehub.com/badge/mcp-full/yonro-memory-os-cli?theme=light)](https://lobehub.com/mcp/yonro-memory-os-cli)

[English](MCP-README.md) · [简体中文](MCP-README_CN.md) | [完整文档](https://docs.xmemo.dev/) · [托管 MCP](https://xmemo.dev/mcp)

---

## 简介

XMemo 是一个面向 AI 智能体的**用户私有 Memory OS (User-owned Memory OS for AI agents)**。MCP 是 XMemo 的一种主要接入方式，让各类兼容客户端能够跨会话、跨项目、跨工具持久化地存储、检索与治理长期记忆和项目上下文。

无论你是使用 Claude、Cursor、Copilot、Gemini、Kimi、Grok、Antigravity 还是其他 MCP 兼容客户端，XMemo 都能为你的 AI 提供持久、统一且用户私有的记忆操作层——在每次交互中保留架构决策、编码偏好、项目上下文与工作状态。

### 核心价值

- **持久化记忆 (Persistent Memory)**：AI 的决策、偏好与项目事实在会话与重启之间保持持久，不再随上下文窗口关闭而消失。
- **权限与数据治理 (Governed Access)**：细粒度 Token 作用域管控、客户端 OAuth 支持、软/硬删除机制以及敏感记忆治理。
- **跨客户端连续性 (Cross-Client Continuity)**：一次记录，处处可用（Copilot、Claude、Cursor、Gemini、IDE 与 CLI）。
- **默认隐私 (Privacy by Default)**：CLI 与 `xmemo-mcp` stdio 代理不发送任何遥测数据，生成的配置文件引用 `XMEMO_KEY` 而非硬编码明文 Token（详见[数据边界与安全](https://docs.xmemo.dev/docs/security/data-boundary)）。
- **托管 HTTP 与本地代理**：支持直接连接 Hosted Streamable HTTP (`https://xmemo.dev/mcp`)，或使用本地 `xmemo-mcp` stdio 代理。

---

## 适用场景

| 场景 | 示例 |
|------|------|
| **项目上下文记忆** | "记住这个项目的架构决策：使用 PostgreSQL + Prisma，避免 MongoDB" |
| **编码偏好记录** | "记住我更喜欢 2 空格缩进，不使用分号" |
| **跨会话 TODO 追踪** | "创建一个 TODO：下周重构 auth 模块" |
| **关键决策记录** | "记录今天决定将 CI 从 GitHub Actions 迁移到 GitLab CI" |
| **知识检索与回忆** | "搜索我之前保存的关于 Docker 网络配置的记忆" |

---

## 支持的 MCP 工具

XMemo MCP 服务端提供丰富的核心工具集合（具体工具集根据客户端特性与授权配置动态呈现，完整文档请参考 [XMemo 工具文档](https://docs.xmemo.dev/docs/tools/remember)）：

| 工具名称 | 功能描述 | 文档链接 |
|----------|----------|----------|
| `get_mcp_identity` | 检查 XMemo 连接状态及当前登录账户/智能体身份 | [身份机制](https://docs.xmemo.dev/docs/concepts/agent-identity) |
| `remember` | 存储一条持久记忆（事实、偏好、决策等） | [`/docs/tools/remember`](https://docs.xmemo.dev/docs/tools/remember) |
| `recall` | 检索与当前上下文最相关的记忆条目 | [`/docs/tools/recall`](https://docs.xmemo.dev/docs/tools/recall) |
| `recall_context` | 针对特定任务构建结构化、受 Token 预算约束的记忆上下文包 | [`/docs/tools/recall-context`](https://docs.xmemo.dev/docs/tools/recall-context) |
| `memory_stats` | 查看记忆的聚合统计指标 | [记忆模型](https://docs.xmemo.dev/docs/concepts/memory-model) |
| `update_memory` | 更新已有记忆的内容或元数据 | [`/docs/tools/remember`](https://docs.xmemo.dev/docs/tools/remember) |
| `explain_memory` | 解释某条记忆的召回与匹配依据 | [`/docs/tools/recall`](https://docs.xmemo.dev/docs/tools/recall) |
| `restore_memory` | 恢复此前被软删除的记忆 | [数据治理](https://docs.xmemo.dev/docs/concepts/governance-retention) |
| `forget` | 软删除或永久删除指定记忆条目 | [`/docs/tools/forget`](https://docs.xmemo.dev/docs/tools/forget) |
| `create_memory_todo` | 创建与记忆关联的待办事项与跟进任务 | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `list_memory_todos` | 列出当前活跃的待办事项 | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `complete_memory_todo` | 标记指定待办事项为已完成 | [`/docs/tools/todos`](https://docs.xmemo.dev/docs/tools/todos) |
| `add_expense` | 记录记账流水与运维支出条目 | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `list_ledger_transactions` | 查看记账流水记录列表 | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `get_monthly_ledger_summary` | 按月份汇总流水统计（支出/收入/币种） | [`/docs/tools/ledger`](https://docs.xmemo.dev/docs/tools/ledger) |
| `update_state` | 保存跨会话/长任务的工作状态，便于后续恢复 | [会话恢复指南](https://docs.xmemo.dev/docs/guides/resume-and-handoff) |
| `get_project_context` | 构建项目范围的持久记忆上下文 | [项目上下文](https://docs.xmemo.dev/docs/concepts/projects) |

### Prompts 与 Resources

本地 stdio 服务同时提供标准 MCP Prompt（`remember`、`recall`、`project-context`）以及两个无需凭据的安全文档资源：
- `xmemo://docs/getting-started`：安装、登录与 MCP 接入快速指南
- `xmemo://docs/security`：凭据处理、隐私边界与操作安全规范

---

## 接入配置

### 方式一：Hosted Streamable HTTP（推荐）

在支持 Streamable HTTP 的客户端中配置：

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
- `XMEMO_KEY`（**必需**）：XMemo 颁发的 Bearer Token，在 [https://xmemo.dev](https://xmemo.dev) 注册并获取。
- `XMEMO_AGENT_ID`（可选）：智能体家族标识，如 `claude-code`、`cursor`、`copilot-cli`。
- `XMEMO_AGENT_INSTANCE_ID`（可选）：设备级唯一实例标识符，用于来源归因与会话追踪。

### 方式二：MCP OAuth 客户端

Gemini CLI、Antigravity 系列、OpenCode 与 Qwen 等客户端原生支持 MCP OAuth，无需手动配置 `XMEMO_KEY`：

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

首次调用 XMemo 工具时，客户端会自动打开浏览器完成 OAuth 授权。

### 方式三：Local stdio（通过 CLI 代理）

对于仅支持本地 stdio 的客户端，可通过 XMemo CLI 进行本地代理：

```bash
npm install -g @xmemo/client
xmemo login
xmemo setup <client>
xmemo-mcp
```

`xmemo-mcp` 是专用的 stdio MCP 入口（与 `xmemo mcp serve` 等价）。工具发现阶段无需 Token，实际工具执行时需完成认证。

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

> **AI**："已保存。后续在涉及数据库选型时，我会优先基于此决策提供建议。"

---

### 场景 2：跨会话检索记忆

> **用户**："我之前保存过关于 CI/CD 的配置，帮我找出来。"

**AI 调用 `recall`**：
```json
{
  "tool": "recall",
  "query": "CI/CD 配置"
}
```

---

### 场景 3：创建跨会话待办事项

> **用户**："提醒我下周重构 auth 模块，并将 JWT 改为 Session + Redis。"

**AI 调用 `create_memory_todo`**：
```json
{
  "tool": "create_memory_todo",
  "content": "重构 auth 模块：将 JWT 改为 Session + Redis",
  "due_at": "2026-10-06T09:00:00Z"
}
```

---

## 客户端兼容性与文档

各客户端的详细配置说明与官方接入指南请参见：

| 客户端 | 支持方式 | CLI 配置命令 | 官方文档 |
|--------|----------|--------------|----------|
| **Cursor** | Streamable HTTP + Bearer Token | `xmemo setup cursor` | [Cursor 接入指南](https://docs.xmemo.dev/docs/mcp/cursor) |
| **Copilot CLI** | Local Proxy + Bearer Token | `xmemo setup copilot` | [Copilot CLI 指南](https://docs.xmemo.dev/docs/mcp/copilot-cli) |
| **Gemini CLI** | Streamable HTTP + MCP OAuth | `xmemo setup gemini` | [Gemini CLI 指南](https://docs.xmemo.dev/docs/mcp/gemini) |
| **Kiro** | 原生 HTTP OAuth / Key 认证 | `xmemo setup kiro` | [Kiro 指南](https://docs.xmemo.dev/docs/mcp/kiro) |
| **Devin Desktop (Windsurf)** | Streamable HTTP + Bearer Token | `xmemo setup windsurf` | [Windsurf 指南](https://docs.xmemo.dev/docs/mcp/windsurf) |
| **Claude Desktop** | `mcp-remote` + Bearer Token | `xmemo setup claude-desktop` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Kimi Code** | Streamable HTTP + Bearer Token | `xmemo setup kimi-code` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Antigravity 系列** | Streamable HTTP + MCP OAuth | `xmemo setup antigravity` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **OpenCode** | Remote MCP + MCP OAuth | `xmemo setup opencode` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Qwen CLI** | Streamable HTTP + MCP OAuth | `xmemo setup qwen` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Trae / Trae Solo** | `mcp-remote` + Bearer Token | `xmemo setup trae` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Cline** | Streamable HTTP + Bearer Token | `xmemo setup cline` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |
| **Zed** | `mcp-remote` + Bearer Token | `xmemo setup zed` | [MCP 概览](https://docs.xmemo.dev/docs/mcp/overview) |

---

## 隐私与安全

- **客户端无遥测**：CLI 与 `xmemo-mcp` stdio 代理不发送任何遥测、埋点或使用情况分析数据；服务端数据处理规范请参见[数据边界与安全](https://docs.xmemo.dev/docs/security/data-boundary)。
- **Token 安全**：生成的配置文件仅引用环境变量（如 `${XMEMO_KEY}`），从不硬编码真实 Token。
- **认证方式以规范为准**：仅标明 MCP OAuth 的客户端走浏览器授权；其余客户端通过环境变量读取 Bearer Token。
- **设备级标识**：`XMEMO_AGENT_INSTANCE_ID` 为非敏感设备唯一标识符，用于归因与审计，不暴露个人信息。
- **数据归属**：用户完全拥有自己的记忆数据，支持随时导出、软/硬删除或脱敏治理。

---

## 资源链接

- 🏠 **官方网站**：[https://xmemo.dev](https://xmemo.dev)
- 📖 **官方文档**：[https://docs.xmemo.dev/](https://docs.xmemo.dev/)
- 📖 **MCP 产品页**：[https://xmemo.dev/product/mcp](https://xmemo.dev/product/mcp)
- 🔧 **GitHub 仓库**：[https://github.com/yonro/memory-os-cli](https://github.com/yonro/memory-os-cli)
- 📝 **XMemo Skill**：[`skills/xmemo/SKILL.md`](skills/xmemo/SKILL.md)
- 📋 **配置指南**：[`MCP-SETUP-GUIDE.md`](MCP-SETUP-GUIDE.md)

---

## 许可证

[MIT](LICENSE)
