# XMemo MCP 上架进度表

> 更新时间：2026-06-19
> 仓库：https://github.com/yonro/memory-os-cli
> MCP 端点：`https://xmemo.dev/mcp`

## 上架状态总览

| 平台 | 状态 | 链接 | 备注 |
|------|------|------|------|
| **Smithery** | ✅ 已上线 | https://smithery.ai/servers/xmemo/xmemo | README 已有 badge，确认页面可访问 |
| **Glama** | ✅ 已上线 | https://glama.ai/mcp/servers/yonro/memory-os-cli | 已自动索引/认领，页面可访问 |
| **MCP.so** | ✅ 已上线 | https://mcp.so/server/xmemo | 页面已存在，已索引 |
| **LobeHub** | ⚠️ 待确认 | https://lobehub.com | 已有 `lhm.plugin.json`，需确认是否已上架 |
| **PulseMCP** | ⚠️ 待确认 | https://www.pulsemcp.com | 可能需从 Official Registry 自动摄入 |
| **ModelScope 魔搭** | ❌ 未提交 | - | **国内最高优先级**，需浏览器提交 |
| **GitHub Awesome MCP Servers** | ❌ 未提交 | - | 需 Fork + PR（GitHub token 当前无效） |
| **阿里云百炼** | ❌ 未提交 | - | 需注册开发者账号并提交 |
| **字节火山引擎 MCP 市场** | ❌ 未提交 | - | 需注册开发者账号并提交 |
| **百度 SAI MCP** | ❌ 未提交 | - | 需注册开发者账号并提交 |
| **讯飞 Spark MCP** | ❌ 未提交 | - | 需注册开发者账号并提交 |

---

## 已上架平台详情

### 1. Smithery ✅

- **状态**：已上线
- **链接**：https://smithery.ai/servers/xmemo/xmemo
- **提交方式**：项目 README 中已有 Smithery badge，说明已提前提交
- **验证**：curl 返回 200 OK，页面包含 XMemo 内容
- **所需操作**：无需进一步操作

### 2. Glama ✅

- **状态**：已上线
- **链接**：https://glama.ai/mcp/servers/yonro/memory-os-cli
- **提交方式**：项目中已有 `glama.json`，Glama 可能已自动爬取/索引
- **验证**：curl 返回 200 OK，页面包含 XMemo 内容
- **所需操作**：建议访问 Glama 后台认领并完善描述

### 3. MCP.so ✅

- **状态**：已上线（页面已存在）
- **链接**：https://mcp.so/server/xmemo
- **提交方式**：未知（可能自动索引或之前提交）
- **验证**：curl 返回 200 OK，页面包含 xmemo 关键词
- **所需操作**：建议登录 MCP.so 后台确认并完善信息

---

## 待提交平台操作指南

### 🔴 最高优先级：ModelScope 魔搭 MCP 广场

**目标**：https://www.modelscope.cn/mcp/create

**操作步骤**：
1. 访问 https://www.modelscope.cn/mcp/create
2. 使用阿里云账号或 ModelScope 账号登录
3. 选择服务类型：**Hosted**（推荐，因为 xmemo 是 Hosted HTTP）
4. 填写表单：
   - **名称**：XMemo
   - **描述**：AI 驱动的智能笔记与记忆管理 MCP 服务，让大模型拥有持久化记忆能力
   - **分类**：笔记 / 效率工具 / 知识管理
   - **MCP 端点**：`https://xmemo.dev/mcp`
   - **认证方式**：Bearer Token（`XMEMO_KEY`）或 OAuth
   - **传输协议**：Streamable HTTP
   - **GitHub 仓库**：https://github.com/yonro/memory-os-cli
   - **Logo**：使用 `plugins/xmemo/assets/logo.svg`（1024x1024 SVG）
5. 提交审核，等待上架

**参考案例**：https://www.modelscope.cn/mcp/servers/quicktiny/wudao-a-share-stock-data-mcp

---

### 🟡 GitHub Awesome MCP Servers

**目标**：https://github.com/punkpeye/awesome-mcp-servers

**操作步骤**：
1. 访问 https://github.com/punkpeye/awesome-mcp-servers
2. 点击右上角 **Fork**，将仓库 fork 到你的账号（yonro）下
3. 在 fork 后的仓库中，找到 `README.md` 文件
4. 在 `### 🧠 Knowledge & Memory` 分类下，添加以下条目：

```markdown
- [yonro/memory-os-cli](https://github.com/yonro/memory-os-cli) [![xmemo MCP server](https://glama.ai/mcp/servers/yonro/memory-os-cli/badges/score.svg)](https://glama.ai/mcp/servers/yonro/memory-os-cli) 📇 ☁️ - User-owned memory for AI agents over remote MCP. Save, search, recall, update, forget, redact, and explain memories across Copilot, Claude, ChatGPT, IDEs, CLIs, and other MCP-compatible agents. `npx -y @xmemo/client`
```

5. 提交更改并创建 Pull Request
6. 等待维护者合并

**注意**：根据最新规则，Awesome MCP Servers 现在要求先完成 Glama 上架才能合并 PR。Glama 已上架，满足条件。

---

### 🟡 MCP.so 确认/完善

**目标**：https://mcp.so/server/xmemo

**操作步骤**：
1. 访问 https://mcp.so/server/xmemo
2. 确认页面信息是否完整（名称、描述、工具列表、GitHub 链接）
3. 如果信息不完整，点击页面上的 "Edit" 或 "Claim" 按钮
4. 使用 GitHub 账号登录
5. 完善服务器信息：
   - 工具列表：remember, recall, search_memory, update_memory, forget, redact_memory, explain_memory, create_memory_todo, list_memory_todos, complete_memory_todo, record_event, get_timeline, add_expense
   - 配置示例：提供 mcp.json
   - 使用场景：2-3 个示例对话

---

### 🟡 PulseMCP

**目标**：https://www.pulsemcp.com/submit

**操作步骤**：
1. 访问 https://www.pulsemcp.com/submit
2. 使用 GitHub 账号登录
3. 填写提交表单：
   - **Server Name**：XMemo
   - **GitHub Repository**：https://github.com/yonro/memory-os-cli
   - **MCP Endpoint**：https://xmemo.dev/mcp
   - **Description**：AI 驱动的智能笔记与记忆管理 MCP 服务
   - **Tags**：memory, knowledge-management, productivity, ai-agents
4. 提交后，PulseMCP 会从 Official Registry 或 GitHub 自动摄入信息

**替代方案**：如果 xmemo 已加入 Official MCP Registry，PulseMCP 会每周自动摄入，无需手动提交。

---

### 🟡 LobeHub

**目标**：https://lobehub.com/mcp

**操作步骤**：
1. 访问 https://lobehub.com/mcp
2. 搜索 "xmemo" 确认是否已上架
3. 如果未上架，点击 "Submit" 或 "Add Server"
4. 项目中已有 `lhm.plugin.json`，可以直接使用其中的元数据提交
5. 填写表单并提交

---

### 🟢 国内平台：阿里云百炼

**目标**：https://bailian.console.aliyun.com

**操作步骤**：
1. 访问阿里云百炼控制台
2. 注册/登录阿里云开发者账号
3. 在 MCP 市场或应用中心找到 "发布应用" / "入驻" 入口
4. 可能需要企业认证或开发者实名认证
5. 填写应用信息：
   - 名称：XMemo
   - 描述：AI 智能笔记与记忆管理 MCP 服务
   - 接入方式：Hosted HTTP
   - 端点：https://xmemo.dev/mcp
   - 认证：Bearer Token / OAuth
6. 提交审核

**注意**：阿里云百炼的 MCP 入驻可能需要企业主体，如个人开发者遇到障碍，请记录并联系阿里云客服。

---

### 🟢 国内平台：字节火山引擎 MCP 市场

**目标**：https://www.volcengine.com/mcp-marketplace

**操作步骤**：
1. 访问 https://www.volcengine.com/mcp-marketplace
2. 注册/登录火山引擎开发者账号
3. 找到 "发布 MCP 服务" / "开发者入驻" 入口
4. 填写服务信息：
   - 名称：XMemo
   - 描述：AI 智能笔记与记忆管理 MCP 服务
   - 端点：https://xmemo.dev/mcp
   - 认证：Bearer Token / OAuth
5. 提交审核

---

### 🟢 国内平台：百度 SAI MCP

**目标**：https://sai.baidu.com/mcp

**操作步骤**：
1. 访问 https://sai.baidu.com/mcp
2. 注册/登录百度开发者账号
3. 找到 MCP 服务入驻/发布入口
4. 填写服务信息
5. 提交审核

---

### 🟢 国内平台：讯飞 Spark MCP

**目标**：https://mcp.xfyun.cn

**操作步骤**：
1. 访问 https://mcp.xfyun.cn
2. 注册/登录讯飞开放平台账号
3. 找到 MCP 服务入驻/发布入口
4. 填写服务信息
5. 提交审核

---

## 已生成的上架材料

以下文件已生成在仓库根目录，可用于各平台提交：

| 文件 | 用途 |
|------|------|
| `MCP-README.md` | 面向 MCP 社区的标准 README（中英双语） |
| `MCP-SETUP-GUIDE.md` | 面向用户的 MCP 配置教程（含所有客户端） |
| `mcp-config-template.json` | 标准 `mcp.json` 配置模板 |
| `plugins/xmemo/assets/logo.svg` | 1024x1024 SVG Logo（各平台通用） |
| `server.json` | 标准 MCP 服务器元数据（ModelScope/Glama 等格式） |
| `glama.json` | Glama 平台元数据 |
| `lhm.plugin.json` | LobeHub 平台元数据 |

---

## 下一步行动建议

### 立即可做的（无需额外工具）
1. ✅ **GitHub Awesome MCP Servers PR**：手动 Fork + 添加条目 + 提交 PR（约 15 分钟）
2. ✅ **LobeHub 提交**：访问 lobehub.com/mcp，使用 `lhm.plugin.json` 中的信息提交

### 需要浏览器操作的
3. 🔴 **ModelScope 魔搭**：优先完成，这是国内最大 MCP 社区
4. 🟡 **MCP.so 确认**：登录后台完善信息
5. 🟡 **PulseMCP 提交**：访问 pulsemcp.com/submit

### 需要注册开发者账号的
6. 🟢 **阿里云百炼**：可能需要企业认证
7. 🟢 **字节火山引擎**：注册开发者账号
8. 🟢 **百度 SAI**：注册开发者账号
9. 🟢 **讯飞 Spark**：注册开发者账号

### 建议的自动化工具
- 使用 **Kimi WebBridge**（浏览器扩展）可以自动化浏览器操作，大幅减少手动工作量
- 安装地址：https://www.kimi.com/features/webbridge

---

*如需协助完成任何平台的上架，请提供对应平台的开发者账号或启用 Kimi WebBridge 扩展。*
