# ARCH-PR176-BOUNDSPACE-CROSS-BACKEND-NULL: BoundSpace 跨后端 NULL 过滤语义与模式收敛规范

- **文档标识**: `docs/architecture/ARCH-PR176-BOUNDSPACE-CROSS-BACKEND-NULL.md`
- **关联请求**: `381861e5-63c3-4030-8f50-b6706396ca2f` (`ARCH-PR176-BOUNDSPACE-FUSE-4`)
- **目标仓库**: `D:\repos\memory-os` (PR #176, 分支 `codex/feat-skill-readonly-operations`)
- **基线提交**: `d53bf10dd8991c3bc526328afc97bf7947ad277d`
- **状态**: 架构裁定 (Architect Ruling / Convergence Specification)
- **执行约束**: 严格只读，不在此步骤直接执行生产代码修改，仅产出经校验的设计文档与计划 JSON

---

## 摘要 (Executive Summary)

PR #176 在第 4 轮评审中触发 Reviewer 熔断机制。问题焦点在于：当前 Personal 空间的只读操作中，查询过滤使用了 `{"team_id": None}`。虽然内存测试桩 `FakeRepo` 与 `PostgresBackend` 能够将 `None` 解释为 `IS NULL` 并通过 325 个用例，但在生产 Supabase / PostgREST 环境中，`postgrest-py` 对 `eq("team_id", None)` 序列化为 `team_id=eq.None`，而非合法的 PostgREST NULL 谓词 `team_id=is.null`。此外，部分被查询的表（如 `storage_usage`、`token_usage`）物理上并不存在 `team_id` 列，盲目注入列过滤将导致 PostgREST 400（schema cache 缺失列）或 Postgres 运行时列不存在异常。

本文档给出完备根因分析、备选方案权衡、推荐最小实施改动、跨后端（Wire-Level）测试规范、系统不变量与 Reviewer 验收清单，指导后续执行器单向收敛。

---

## A. 根因判定 (Root Cause Analysis)

### 1. PostgREST 协议与 Python 对象语义割裂
在 `src/memory_manager/db/supabase_backend.py` 中，`_apply_filter(self, query, column: str, spec: Any)` 的实现逻辑如下：
```python
op = "eq"
value = spec
if isinstance(spec, dict):
    op = str(spec.get("op", "eq"))
    value = spec.get("value")
if op == "eq":
    query = query.eq(column, value)
elif op == "is":
    query = query.is_(column, value)
```
当调用方传入 `base_filters={"team_id": None}` 或 `filters["team_id"] = None` 时：
- `spec` 为 `None`，默认命中 `op = "eq"` 且 `value = None`。
- 调用 `query.eq("team_id", None)`。
- `postgrest-py` 将其格式化为 HTTP 查询字符串 `team_id=eq.None`。
- PostgREST 服务端解析 `eq.None` 为字面量字符串比较 `WHERE team_id = 'None'`。对于 UUID 或特定类型的字段，Postgres 会直接抛出 `invalid input syntax for type uuid: "None"` (HTTP 400)；对于 text 类型，则无法匹配到真正的 SQL `NULL` 行，导致所有合法的 Personal 数据被静默滤除。
- PostgREST 规范中，过滤 NULL 的唯一合法表示是 `team_id=is.null`，对应 `postgrest-py` 的 `query.is_("team_id", "null")`。

### 2. FakeRepo 与 PostgresBackend 的测试屏蔽效应 (False Confidence)
- **`FakeRepoBase._matches`**: 采用 Python 比较 `actual != value`。当数据行中 `team_id is None` 且期望值为 `None` 时，`None != None` 为 `False`（即匹配成功），故内存假仓完全放行。
- **`PostgresBackend._filter_clause`**: 在 SQL 拼装层有特化兼容逻辑：
  ```python
  if op == "eq":
      if value is None:
          return f"{ident} is null"
      return f"{ident} = {builder.placeholder(column, value)}"
  ```
  使得针对原生 PostgreSQL 的测试也将 `None` 静默转成了 `is null`。
- **后果**：整个测试套件虽然跑通了 325 个回归用例，但测试环境（FakeRepo/Postgres）与真实生产环境（Supabase/PostgREST）存在语义断层，完全掩盖了生产数据面的严重故障。

### 3. 规范标准未对齐 (Specification Divergence)
仓库中已有的空间绑定规范 `src/memory_manager/auth/memory_space_binding.py` 第 644-657 行 `apply_bound_space_filters` 早已确立了权威标准：
```python
if bound_space.kind == "personal":
    filters["owner_id"] = bound_space.owner_id
    filters["team_id"] = {"op": "is", "value": "null"}
```
但在 PR #176 的 `personal_console.py` 和 `ledger.py` 中，执行器未复用此规范，而是手写了 `{"team_id": None}`，造成了规范分裂。

### 4. 表结构异构性与列缺失陷阱 (Table Heterogeneity)
在 4 个只读接口涉及的表体系中：
- **含 `team_id` 的业务表**：`memory_vectors`、`ledger_transactions`、`memory_usage_logs` 均含有 `owner_id` 与 `team_id` 列，支持并必须执行数据库级 `owner_id = X AND team_id IS NULL` 过滤以防分页饥饿。
- **无 `team_id` 的度量/快照表**：
  - `storage_usage`: 纯聚合度量表，DDL 中无 `team_id`，甚至无 `owner_id`。
  - `token_usage`: 按 API Key 聚合的用量表，DDL 中无 `team_id`。
  - 若对这些表下发 `team_id: {"op": "is", "value": "null"}`，PostgREST 会因 `Could not find the 'team_id' column in schema cache` 返回 HTTP 400，PostgreSQL 会抛出 `column "team_id" does not exist` 错误。

---

## B. 修复备选方案权衡 (Options Evaluation & Trade-offs)

| 维度 | Option 1: 仅调用方规范化 | Option 2: 仅后端驱动修补 | Option 3 (推荐): 纵深防御双向收敛 |
| :--- | :--- | :--- | :--- |
| **做法** | 在 `personal_console.py` 和 `ledger.py` 中将 `team_id: None` 替换为 `{"op": "is", "value": "null"}`；不修改 driver。 | 在 `SupabaseBackend._apply_filter` 中将 `value is None` 自动重定向为 `is_(column, "null")`；调用方保持 `team_id: None`。 | 1. 调用方统一使用权威 `{"op": "is", "value": "null"}`；<br>2. `SupabaseBackend` 驱动层增加防呆转换；<br>3. 区分有/无 `team_id` 的表，精确下推查询。 |
| **PostgREST Wire 协议** | 修复（生成 `is.null`） | 修复（生成 `is.null`） | 修复（生成 `is.null`），具备最高容错性 |
| **规范一致性** | 与 `apply_bound_space_filters` 一致 | 依然存在隐式 `None`，不符合仓库已确立的显式谓词规范 | 全仓彻底统一使用 `{"op": "is", "value": "null"}` |
| **防御性** | 低：未来其他模块传入 `None` 依然会踩坑产生 `eq.None` | 中：若未来有表结构差异仍可能出现未知分支 | 最高：驱动层防呆 + 调用层显式 + 内存层防逃逸 |
| **表结构兼容** | 需单独处理无 `team_id` 表 | 未解决无 `team_id` 表的列缺失问题 | 明确表路由矩阵，无列表不下推列过滤，结合内存回退 |
| **结论** | 不完备 | 不彻底 | **采纳 Option 3** |

---

## C. 推荐的最小文件与函数改动 (Minimal Code Changes)

执行器获批后，仅需对以下 4 个文件实施外科手术式改动：

### 1. `src/memory_manager/db/supabase_backend.py` (驱动加固)
在 `_apply_filter` 中增加对 `None` 值的防呆处理，防止将 Python `None` 转为字面量 `eq.None`：
```python
def _apply_filter(self, query, column: str, spec: Any):
    op = "eq"
    value = spec
    if isinstance(spec, dict):
        op = str(spec.get("op", "eq"))
        value = spec.get("value")
    
    # 针对 NULL 谓词的防呆归一化
    if op == "eq" and value is None:
        return query.is_(column, "null")
    if op == "neq" and value is None:
        return query.not_.is_(column, "null")
    if op == "is":
        normalized = "null" if value in (None, "null") else value
        return query.is_(column, normalized)

    if op == "eq":
        query = query.eq(column, value)
    ...
```

### 2. `src/memory_manager/services/personal_console.py` (显式规范化与表路由)
- 引入常量：
  ```python
  PERSONAL_TEAM_FILTER: Dict[str, Any] = {"op": "is", "value": "null"}
  ```
- **`me_visible_memory_rows`**:
  ```python
  base_filters = {"team_id": PERSONAL_TEAM_FILTER} if personal_only else None
  ```
  保留内存兜底过滤：`if personal_only: memory_rows = [r for r in memory_rows if not r.get("team_id")]`。
- **`_me_overview_response`**:
  - `memory_vectors`: 传入 `personal_only=personal_only`。
  - `storage_usage`: 不注入 `team_id` 过滤（`storage_filters = None`）。当 `storage_rows` 为空或不可用时，系统现存逻辑会自动回退到基于 Personal 过滤后的 `memory_rows` 累加字节数（行 3139-3144），安全无泄漏。
  - `token_usage`: 不注入 `team_id` 过滤（`token_filters = None`）。通过内存循环追加保护：`if personal_only and row.get("team_id"): continue`。
- **`_me_activity_response`**:
  - `memory_usage_logs` (含 `team_id`):
    ```python
    log_filters = {"team_id": PERSONAL_TEAM_FILTER} if personal_only else None
    ```
    保留内存兜底过滤：`if personal_only and row.get("team_id"): continue`。

### 3. `src/memory_manager/services/ledger.py` (账本显式规范化)
- **`_me_ledger_transactions_response`**:
  ```python
  if personal_only:
      tx_filters["team_id"] = {"op": "is", "value": "null"}
  ...
  if personal_only:
      mem_filters["team_id"] = {"op": "is", "value": "null"}
  ```
- **`_me_ledger_monthly_summary_response`**:
  ```python
  base_filters = {"team_id": {"op": "is", "value": "null"}} if personal_only else {}
  ```
- 保留现有的 cross-space 关联引用校验（个人账本引用了 Team memory 时 fail-closed 剔除）。

### 4. `tests/web/test_pr176_review_regressions.py` (补齐驱动级测试)
- 新增单元测试直接断言 PostgREST / Supabase 查询构造器生成的 URL 参数。
- 新增单元测试断言 `PostgresBackend` 生成的 SQL 子句。

---

## D. 必须新增的后端语义测试规范 (Backend Semantic Verification)

严禁仅依赖 `FakeRepo`。必须包含以下针对实际 driver 和 wire-level 契约的测试：

### 1. Supabase / PostgREST Wire-Level 验证
```python
def test_supabase_backend_applies_null_filter_as_is_null_wire_param():
    """验证 SupabaseBackend 生成 PostgREST team_id=is.null 而非 team_id=eq.None"""
    backend = SupabaseBackend(...)  # 使用 mock 客户端或 spy 检查器
    query_mock = MagicMock()
    
    # 显式 dict 谓词
    backend._apply_filter(query_mock, "team_id", {"op": "is", "value": "null"})
    query_mock.is_.assert_called_with("team_id", "null")
    query_mock.eq.assert_not_called()
    
    # 防呆裸 None 谓词
    query_mock.reset_mock()
    backend._apply_filter(query_mock, "team_id", None)
    query_mock.is_.assert_called_with("team_id", "null")
    query_mock.eq.assert_not_called()
```

### 2. PostgresBackend SQL 语句生成验证
```python
def test_postgres_backend_generates_sql_is_null():
    """验证 PostgresBackend 生成真正的 SQL 'team_id IS NULL'"""
    backend = PostgresBackend(...)
    builder = _SqlBuilder()
    
    clause1 = backend._filter_clause(builder, "team_id", {"op": "is", "value": "null"})
    assert "team_id is null" in clause1.lower()
    
    clause2 = backend._filter_clause(builder, "team_id", None)
    assert "team_id is null" in clause2.lower()
```

### 3. 表列缺失时的鲁棒性验证
- 验证当查询 `storage_usage` 时，`personal_only=True` 不会导致 500 或 400，能够平滑计算 Personal 存储占用。
- 验证分页防饥饿测试继续在包含 Team 干扰行的情况下保持绿灯。

---

## E. 不变量与安全保证 (Invariants & Safety Guarantees)

1. **`/v1/me/*` 逐字节无感漂移不变量 (Portal Parity)**:
   - `/v1/me/*` 内部全链路默认 `personal_only=False`，其返回的 JSON 结构与数据内容与 PR 之前 100% 保持逐字节一致。
2. **Personal 凭据空间封闭不变量 (BoundSpace Isolation)**:
   - Personal 凭据只允许访问 `owner_id = user_id AND team_id IS NULL` 的数据。
   - 数据库底层下推过滤（防分页饥饿）与业务内存层检查（防意外遗漏）形成双重屏障。
   - 跨空间引用（如 Personal Ledger 关联到 Team Memory）一律 Fail-Closed 丢弃。
3. **Team 凭据 403 阻断不变量 (Team Auth Deny)**:
   - 携带 Team 凭据调用上述 4 个 Personal-only skill operation 时，必须立即在路由层被 403 拦截。
4. **事件循环非阻塞不变量 (Async Concurrency)**:
   - 耗时的数据组装依然由 `run_payload_builder` / `asyncio.to_thread` 调度至后台工作线程，严禁倒退为主线程同步阻塞。

---

## F. Reviewer 可验收清单 (Reviewer Acceptance Checklist)

- [ ] **R1. 谓词标准化**: `personal_console.py` 和 `ledger.py` 中所有 Personal 过滤均使用 `{"team_id": {"op": "is", "value": "null"}}`，无任何裸 `{"team_id": None}`。
- [ ] **R2. 驱动防呆**: `SupabaseBackend._apply_filter` 显式将 `None` 映射为 `is_(column, "null")`。
- [ ] **R3. 真实 Wire 级测试**: 包含直接测试 `SupabaseBackend` 产出 `is_("team_id", "null")` 的用例，且绝不产生 `eq.None`。
- [ ] **R4. 无 team_id 表保护**: `storage_usage` 和 `token_usage` 没有被传入 `team_id` 列过滤，无 PostgREST 400 或 SQL 列缺失风险；存储大小平滑回退至 `memory_rows`。
- [ ] **R5. 现有 325 个测试全绿**: 包含分页防饥饿、跨空间引用 fail-closed、Team 凭据 403、Portal 默认全集。
- [ ] **R6. 零网络与零未授权变更**: 严格限定在 PR #176 涉及的 3 个生产文件与 1 个测试文件，不引入无关改动，无 force push，不触发部署。
