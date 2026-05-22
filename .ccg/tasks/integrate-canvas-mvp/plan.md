# Phase B 实施计划：画布 MVP

## 需求摘要

新增 `/canvas` 单画布工作台，支持：
- 添加图片节点（带 prompt 输入 + 运行按钮）
- 节点拖拽、画布平移/缩放、节点连线
- 节点运行时调用 `/v1/images/generations` 或 `/v1/images/edits`
- **语义化连线**：节点 N 运行时，自动把所有上游节点（incoming edges）成功生成的图片作为参考图喂给 `/v1/images/edits`；若无上游图，则走 `/v1/images/generations`
- 画布状态本地持久化（localforage），刷新不丢
- 顶部导航增加 `/canvas` 入口

## 决策汇总

| 项 | 选择 | 理由 |
|---|---|---|
| **画布库** | `@xyflow/react` v12（React Flow）| 节点拖拽/连线/平移缩放/选中开箱即用；MIT；MVP 工作量降低 ~70% |
| **状态** | Zustand store + localforage 持久化 | 与 Phase A 模式一致 |
| **轮询模式** | 复用 image/page.tsx 的 `runConversationQueue` 思路（每节点独立 task）| 已验证可靠 |
| **节点类型** | 仅 `image` 一种 | MVP 砍掉 text/config 节点（Phase C） |
| **连线语义** | 上游成功节点的图 → 当前节点 reference files | 与 infinite-canvas 上游一致 |
| **多画布** | **不做**（MVP 只有一个全局画布）| Phase C 引入 project 维度 |
| **持久化粒度** | 整个画布快照（防抖写入）| 简单可靠，节点数 < 100 时性能无压力 |
| **不引入** | TanStack Query / dagre / elkjs / immer-keep-existing | 不必要 |

## 步骤（按顺序）

### 1. 依赖与类型
- **修改** `web/package.json` — 新增 `@xyflow/react: ^12.x`（运行 `bun add @xyflow/react`）
- **新增** `web/src/types/canvas.ts`：
  - `CanvasNodeData`：`{ prompt, status: "idle"|"queued"|"running"|"success"|"error", taskId?, b64_json?, url?, error?, size?, model?, generationMode: "text"|"image" }`
  - `CanvasNodeKind = "image"`
  - `CanvasGraph`：`{ nodes: CanvasNode[], edges: CanvasEdge[], viewport: {x,y,zoom}, updatedAt }`

### 2. Store（localforage 持久化）
- **新增** `web/src/store/canvas.ts`：
  - localforage 实例 `{ name: "chatgpt2api", storeName: "canvas" }`，key `graph`
  - `loadCanvas() / saveCanvas(graph)`（写队列，防抖 300ms）
  - `useCanvasStore` React hook：state（nodes/edges/viewport），actions（addNode/deleteNode/updateNodeData/connect/disconnect/setViewport/reset），自动持久化
  - Zustand store + 持久化 middleware（手写而非 zustand/middleware，与 Phase A 一致）

### 3. Runner — 节点执行 + 上游图收集
- **新增** `web/src/lib/canvas-runner.ts`：
  - `collectUpstreamReferences(nodes, edges, targetNodeId): File[]` — 遍历入度边的源节点，对成功节点的 `b64_json|url` 转 File
  - `runNode(node, references, prompt)` → 调用 `createImageGenerationTask` 或 `createImageEditTask`
  - `pollNodeTask(taskId)` — 复用 `fetchImageTasks` 轮询
  - 与 Phase A image/page 的 runConversationQueue 不同：每节点独立队列，并发安全用 `Set<nodeId>` 标记

### 4. UI - 自定义节点
- **新增** `web/src/components/canvas/canvas-image-node.tsx`：
  - 节点头：标题（可编辑）+ 状态徽章（idle/loading/error/success）
  - 节点体：textarea（prompt 输入）+ 生成图预览 + 重试/删除按钮
  - 节点底：Handle（源/目标）来自 `@xyflow/react`
  - 大小：固定 280×320，可调
  - 风格：rounded-3xl, border-stone-200, white bg，与 Phase A 卡片一致

### 5. UI - 工具栏
- **新增** `web/src/components/canvas/canvas-toolbar.tsx`：
  - 浮动在画布左上：[+ 图片节点] [删除选中] [适配视图] [清空] [节点数指示]
  - 用 Radix Button / lucide icons

### 6. UI - 画布主体
- **新增** `web/src/components/canvas/canvas-flow.tsx`：
  - 包裹 `<ReactFlowProvider>`
  - `<ReactFlow>` 注册自定义 nodeType `image`
  - 处理：onNodesChange / onEdgesChange / onConnect / onSelectionChange / onMove
  - `<Background>` + `<Controls>`（暂不加 minimap，留给 Phase C）

### 7. 页面入口
- **新增** `web/src/app/canvas/page.tsx`：
  - `useAuthGuard` 鉴权
  - 全屏布局（`h-[calc(100dvh-3.5rem)]`），无内边距给画布最大空间
  - 渲染 CanvasFlow + CanvasToolbar
  - 首次加载提示空状态："点击工具栏 + 创建第一个节点"

### 8. 顶导集成
- **修改** `web/src/components/top-nav.tsx`：在 admin 和 user 导航数组中追加 `{ href: "/canvas", label: "画布" }`，位置在 `/prompts` 之后

### 9. 文档与归属
- **修改** `NOTICE.md`：在派生文件列表中追加 canvas 相关路径
- **修改** `README.md`：在「在线画图功能」段落追加 "**画布工作台**：`/canvas` 节点化编排，连线自动注入上游图作为参考图"

## 影响范围

**新增（8 个）**：
```
web/src/types/canvas.ts
web/src/store/canvas.ts
web/src/lib/canvas-runner.ts
web/src/components/canvas/canvas-image-node.tsx
web/src/components/canvas/canvas-toolbar.tsx
web/src/components/canvas/canvas-flow.tsx
web/src/app/canvas/page.tsx
```

**修改（4 个）**：
```
web/package.json                          # 新增 @xyflow/react
web/src/components/top-nav.tsx            # 新增导航项
NOTICE.md                                 # 追加 canvas 派生
README.md                                 # 追加功能说明
```

**不变**：
- 后端 Python（api/, services/）
- Phase A 所有文件（prompts 库完全独立）
- 既有图片工作台 (image/page.tsx / image-composer.tsx)
- LICENSE

## 验收标准

- [ ] `/canvas` 可访问，工具栏显示
- [ ] 添加节点 → 输入 prompt → 点运行 → 显示生成图
- [ ] 添加第二节点 → 输入"把它改成赛博朋克风格" → 拖线从节点 1 → 节点 2 → 节点 2 运行 → 走 image edit 路径，注入节点 1 的图
- [ ] 拖拽节点位置、缩放/平移视口持久化（刷新仍在）
- [ ] 删除节点同时删除关联边
- [ ] `bun run build` 通过
- [ ] 原有页面（/image, /prompts 等）行为不变

## 风险与降级

| 风险 | 缓解 |
|---|---|
| @xyflow/react v12 + React 19 兼容性 | 该库已声明 React 19 支持；若有边界问题切到 v11 |
| 大量节点时 localforage 写入卡顿 | 防抖 300ms + 增量序列化关键路径 |
| dataUrl 体积大（base64 图）持久化超 IndexedDB 配额 | 节点 b64_json 不入库，仅保存 taskId + image URL；若仅有 b64 则需要后端缓存（已有 image_storage_service） |
| 节点循环引用导致 collectUpstream 无限递归 | DAG 拓扑检查 + 仅 BFS 一层（直接父节点）|

## 不在本次范围

- 多画布项目管理（Phase C）
- minimap / undo-redo / context menu / 多选 / crop 编辑 / 助手聊天面板 / import-export / 批量生成 / text+config 节点（全部 Phase C）
- 从 Phase A 提示词库右键创建节点（按用户决策 Phase A 不动）
