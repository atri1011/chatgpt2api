# Phase A 实施计划：Prompt 库融合

## 需求摘要

将 `basketikun/infinite-canvas`（AGPL-3.0，同作者）的预设提示词库移植到 `chatgpt2api/web`。Phase A 范围：
- 数百条图片提示词数据本地化
- 新增 `/prompts` 浏览页面（搜索 + 分类筛选 + 详情）
- 在 `ImageComposer` 工具栏注入「提示词库」入口，一键填入输入框
- 收藏夹（localforage 持久化）
- 完全离线，不引入服务端

## 决策汇总（综合 Gemini 分析 + 项目实情）

| 决策项 | 方案 | 理由 |
|------|------|------|
| **UI 库** | Radix + shadcn 自建（**不引入 antd**）| 与现有 stone 配色/rounded-3xl 风格无缝；零 bundle 增量；Phase B/C 画布需要 headless primitives，antd 复用价值低 |
| **状态管理** | Zustand store + localforage | 复用现有 `image-conversations.ts` 模式 |
| **搜索引擎** | 手写多字段 token 匹配（无新依赖）| 数百条数据规模足够；中英文 + tag 多 token AND 检索 |
| **数据获取** | 静态打包 `prompts.json` | 当前先用一份精选种子集（~30-80 条），未来可扩展为远程拉取增量同步 |
| **图片封面** | 优先外链 + 本地 fallback 占位 | 不增加 repo 体积；Tailwind 渐变占位兜底失败 |
| **集成入口** | `/prompts` 独立页 + ImageComposer 内 `Sparkles` 按钮 + 顶导链接 | 双入口覆盖浏览发现 vs 快速应用两种场景 |
| **License** | LICENSE 改为 AGPL-3.0 + 顶部 attribution 注释 | 源项目 AGPL 传染；移植代码需保留作者署名 |

## 数据获取策略

Phase A 先用**精选种子集**（手写一份 prompts.json 30-80 条，覆盖各品类）。理由：
- 避免依赖运行 infinite-canvas Go 后端
- 静态打包后体积可控（< 50KB JSON）
- 后续可加一个 `scripts/sync-prompts.ts` 从上游 demo 站抓取增量

源项目完整数据集后续可通过 GET `https://infinite-canvas-cpco.onrender.com/api/prompts?pageSize=500` 批量导出（运行时迁移到 localforage）— 留作 Phase A.1 增强。

## 步骤（按顺序执行）

### 1. 准备数据与类型
- **新增** `web/src/data/prompts/seed.json` — 精选种子 prompt（~30 条覆盖二次元/写实/3D/矢量/科幻/复古等品类）
- **新增** `web/src/types/prompt.ts` — Prompt 类型定义（id/title/coverUrl/prompt/tags/category/githubUrl/preview/createdAt）

### 2. Store 与持久化
- **新增** `web/src/store/prompts.ts` — Zustand store
  - state: `prompts[]`（合并 seed + 用户自定义）、`favorites[]`、`isInitialized`
  - actions: `init()`（合并 seed → localforage）、`toggleFavorite(id)`、`addCustom(p)`、`removeCustom(id)`
  - localforage 实例：`createInstance({ name: "chatgpt2api", storeName: "prompts_library" })`
  - keys: `custom_prompts`、`favorite_ids`、`seed_version`（用于种子升级）

### 3. 搜索/筛选工具
- **新增** `web/src/lib/prompt-search.ts` — `filterPrompts(prompts, query, category, tags)`：
  - 分类精确匹配
  - tags 多选 AND
  - keyword 空格分词，跨 title/prompt/tags/category 多字段 AND

### 4. UI 组件（基于 Radix + shadcn）
- **新增** `web/src/components/prompts/prompt-card.tsx` — 卡片（cover/标题/标签/hover 操作）
- **新增** `web/src/components/prompts/prompt-detail-dialog.tsx` — 详情对话框（复用 `ui/dialog`）
- **新增** `web/src/components/prompts/prompt-select-dialog.tsx` — 工作台内的精简选择器（紧凑网格 + 单行搜索）
- **新增** `web/src/components/prompts/prompt-filter-bar.tsx` — 搜索框 + 分类 Tab + Tag chips
- **新增** `web/src/components/prompts/prompt-cover.tsx` — 封面图带 lazy load + 渐变占位 fallback

### 5. 浏览页面
- **新增** `web/src/app/prompts/page.tsx` — `/prompts` 路由
  - 顶部：标题 + 副标题
  - 左侧 240px 分类导航（移动端折叠）
  - 主区：搜索栏 + Tag chips + 卡片网格（1/2/3/4 列响应式）
  - 客户端分页（每页 20，"加载更多" 按钮）
  - 详情对话框 + "应用到工作台"（跳转 `/image?prompt=<encoded>`）

### 6. 工作台集成
- **修改** `web/src/app/image/components/image-composer.tsx`：
  - 在工具栏（额度/张数/比例之间）新增「提示词库」按钮（lucide `Sparkles` icon）
  - 添加 prop `onApplyPrompt: (text: string, mode: "replace" | "append") => void`
  - 点击打开 `PromptSelectDialog`，选中后回调
- **修改** `web/src/app/image/page.tsx`：
  - 实现 `handleApplyPrompt`，根据 mode 设置 `setImagePrompt`（追加用 `\n` 分隔，覆盖直接 set）
  - URL `?prompt=<text>` query 参数读取后预填 `imagePrompt`（从 /prompts 跳来）

### 7. 顶导集成
- **修改** `web/src/components/top-nav.tsx`：新增 `{ href: "/prompts", label: "提示词库" }` 导航项

### 8. License & Attribution
- **修改** `LICENSE` — 替换为 AGPL-3.0 全文
- **新增** `NOTICE.md` — 列明 infinite-canvas 来源、作者署名、AGPL 链接
- **修改** `README.md` — 在功能区添加"预设提示词库"说明 + License 段落更新

## 影响范围

**新增（13 个）**：
```
web/src/data/prompts/seed.json
web/src/types/prompt.ts
web/src/store/prompts.ts
web/src/lib/prompt-search.ts
web/src/components/prompts/prompt-card.tsx
web/src/components/prompts/prompt-detail-dialog.tsx
web/src/components/prompts/prompt-select-dialog.tsx
web/src/components/prompts/prompt-filter-bar.tsx
web/src/components/prompts/prompt-cover.tsx
web/src/app/prompts/page.tsx
NOTICE.md
LICENSE (覆盖)
```

**修改（3 个）**：
```
web/src/app/image/components/image-composer.tsx  # 注入按钮
web/src/app/image/page.tsx                       # handleApplyPrompt + URL query
web/src/components/top-nav.tsx                   # 新增导航项
README.md                                        # 功能说明
```

**不变**：
- 所有 Python 后端（`api/`、`services/`、`main.py`）
- `web/package.json`（无新增依赖！）
- 数据库与配置文件

## 验收标准

- [ ] `/prompts` 可访问，能看到 ~30+ 条 prompt，分类/搜索/详情正常
- [ ] ImageComposer 按钮点击打开选择器，选中后 prompt 填入文本框
- [ ] 收藏切换持久化（刷新后保留）
- [ ] `bun run build` 通过，无 lint error
- [ ] `bun run dev` 启动后所有原有页面（/image、/accounts 等）行为不变
- [ ] LICENSE/NOTICE/README 合规

## 风险与降级

| 风险 | 降级方案 |
|------|---------|
| seed.json 数据稀少（< 30 条）| Phase A.1 加 sync 脚本从上游 demo 站拉取 |
| 外链封面图加载慢/被墙 | 渐变 + 首字母占位 fallback（已设计） |
| LICENSE 改 AGPL 用户敏感 | 与用户单独确认（已在 Phase 1 确认"开源"，但 AGPL 是具体协议） |
| 收藏数据迁移 | seed_version 字段控制；用户数据始终保留 |

## 不在本次范围

- Phase B（画布 MVP）— 待 Phase A 验收后立项
- Phase C（完整画布）— 同上
- 服务端 prompts CRUD — 永不（按决策）
- antd 集成 — 不引入（按决策修订）
