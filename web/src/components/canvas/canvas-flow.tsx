"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { CanvasInspector } from "@/components/canvas/canvas-inspector";
import { CanvasConfigNode } from "@/components/canvas/canvas-config-node";
import { CanvasImageNode } from "@/components/canvas/canvas-image-node";
import {
  CanvasNodeContext,
  type CanvasNodeContextValue,
} from "@/components/canvas/canvas-node-context";
import { CanvasPreviewModal } from "@/components/canvas/canvas-preview-modal";
import { CanvasPromptNode } from "@/components/canvas/canvas-prompt-node";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import {
  collectUpstreamContributions,
  collectUpstreamReferences,
  runConfigNode,
  runNode,
} from "@/lib/canvas-runner";
import {
  addEdgeConnection,
  buildBatchPlacement,
  createCanvasExportPayload,
  normaliseCanvasGraph,
  useCanvasStore,
} from "@/store/canvas";
import {
  isConfigNode,
  isImageNode,
  isPromptNode,
  type CanvasAnyNode,
  type CanvasConfigNode as CanvasConfigNodeType,
  type CanvasConfigNodeData,
  type CanvasEdge,
  type CanvasImageNodeData,
  type CanvasPromptNodeData,
} from "@/types/canvas";

const nodeTypes = {
  image: CanvasImageNode,
  config: CanvasConfigNode,
  prompt: CanvasPromptNode,
};

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function getNodeColor(node: CanvasAnyNode) {
  if (isConfigNode(node)) return "#6366f1";
  if (isImageNode(node)) {
    if (node.data.status === "success") return "#10b981";
    if (node.data.status === "error") return "#f43f5e";
    if (node.data.status === "running" || node.data.status === "queued") return "#f59e0b";
    return "#38bdf8";
  }
  return "#f59e0b";
}

function CanvasFlowInner() {
  const store = useCanvasStore();
  const reactFlow = useReactFlow();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const nodesRef = useRef<CanvasAnyNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    nodesRef.current = store.nodes;
  }, [store.nodes]);
  useEffect(() => {
    edgesRef.current = store.edges;
  }, [store.edges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      store.setNodes(
        (current) => applyNodeChanges(changes, current as Node[]) as CanvasAnyNode[],
      );
    },
    [store],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      store.setEdges((current) => applyEdgeChanges(changes, current as Edge[]) as CanvasEdge[]);
    },
    [store],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return;
      store.setEdges((current) => {
        const next = addEdgeConnection(
          {
            nodes: nodesRef.current,
            edges: current,
            viewport: store.viewport,
            updatedAt: new Date().toISOString(),
          },
          source,
          target,
        );
        return next.edges;
      });
    },
    [store],
  );

  const handleSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => {
      setSelectedNodeIds(nodes.map((node) => node.id));
    },
    [],
  );

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      store.setViewport(viewport);
    },
    [store],
  );

  // ── Standalone image-node run (unchanged from MVP) ───────────────────
  const handleRunImage = useCallback(
    async (nodeId: string) => {
      if (runningRef.current.has(nodeId)) return;
      runningRef.current.add(nodeId);

      const targetNode = nodesRef.current.find((node) => node.id === nodeId);
      if (!targetNode || !isImageNode(targetNode)) {
        runningRef.current.delete(nodeId);
        return;
      }

      store.updateImageNodeData(nodeId, (data) => ({
        ...data,
        status: "queued",
        error: undefined,
      }));

      try {
        const references = await collectUpstreamReferences(
          nodeId,
          nodesRef.current,
          edgesRef.current,
        );
        await runNode({
          node: targetNode,
          references,
          onUpdate: (updater) => store.updateImageNodeData(nodeId, updater),
        });
      } finally {
        runningRef.current.delete(nodeId);
      }
    },
    [store],
  );

  // ── Config-node fan-out run ──────────────────────────────────────────
  const handleRunConfig = useCallback(
    async (configNodeId: string) => {
      if (runningRef.current.has(configNodeId)) return;
      runningRef.current.add(configNodeId);

      const configNode = nodesRef.current.find((node) => node.id === configNodeId);
      if (!configNode || !isConfigNode(configNode)) {
        runningRef.current.delete(configNodeId);
        return;
      }

      try {
        const runCount = configNode.data.count || 1;
        // Build placement and insert result node(s) into the graph.
        const placement = buildBatchPlacement({
          sourceNodeId: configNodeId,
          sourcePosition: configNode.position,
          count: runCount,
          rootTitle: `${configNode.data.title || (runCount === 1 ? "结果" : "批次")} - ${new Date().toLocaleTimeString()}`,
        });
        store.insertBatchPlacement(placement);

        // After insertion, the runner reads the latest graph snapshot via
        // updaters bound to nodeId.
        await runConfigNode({
          configNode,
          rootId: placement.rootId,
          childIds: placement.childIds,
          nodes: [...nodesRef.current, ...placement.newNodes],
          edges: [...edgesRef.current, ...placement.newEdges],
          onUpdateRoot: (updater) => store.updateImageNodeData(placement.rootId, updater),
          onUpdateChild: (childId, updater) => store.updateImageNodeData(childId, updater),
          onUpdateConfig: (status, error) =>
            store.updateConfigNodeData(configNodeId, (data) => ({
              ...data,
              status,
              error,
            })),
        });
      } finally {
        runningRef.current.delete(configNodeId);
      }
    },
    [store],
  );

  // ── Live stats lookup for Config nodes ───────────────────────────────
  const getConfigStats = useCallback(
    (nodeId: string) => {
      const target = nodesRef.current.find((node) => node.id === nodeId);
      if (!target || !isConfigNode(target)) {
        return { promptCount: 0, referenceCount: 0 };
      }
      const { imageNodes, textFragments } = collectUpstreamContributions(
        nodeId,
        nodesRef.current,
        edgesRef.current,
        target.data.inputOrder,
      );
      return {
        promptCount: textFragments.length,
        referenceCount: imageNodes.length,
      };
    },
    [],
  );

  const contextValue = useMemo<CanvasNodeContextValue>(
    () => ({
      onDelete: (nodeId) => store.removeNode(nodeId),
      onChangeTitle: (nodeId, value) => {
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (!target) return;
        if (isImageNode(target)) {
          store.updateImageNodeData(nodeId, (data: CanvasImageNodeData) => ({
            ...data,
            title: value,
          }));
        } else if (isConfigNode(target)) {
          store.updateConfigNodeData(nodeId, (data: CanvasConfigNodeData) => ({
            ...data,
            title: value,
          }));
        } else if (isPromptNode(target)) {
          store.updatePromptNodeData(nodeId, (data: CanvasPromptNodeData) => ({
            ...data,
            title: value,
          }));
        }
      },
      onRunImage: (nodeId) => void handleRunImage(nodeId),
      onChangeImagePrompt: (nodeId, value) =>
        store.updateImageNodeData(nodeId, (data) => ({ ...data, prompt: value })),
      updateImageNodeData: (nodeId, updater) => store.updateImageNodeData(nodeId, updater),
      onRunConfig: (nodeId) => void handleRunConfig(nodeId),
      onChangeConfigData: (nodeId, patch) =>
        store.updateConfigNodeData(nodeId, (data) => ({ ...data, ...patch })),
      onOpenPreview: (nodeId) => setPreviewNodeId(nodeId),
      getConfigStats,
      onChangePromptText: (nodeId, value) =>
        store.updatePromptNodeData(nodeId, (data) => ({ ...data, prompt: value })),
      updatePromptNodeData: (nodeId, updater) =>
        store.updatePromptNodeData(nodeId, updater),
    }),
    [handleRunImage, handleRunConfig, store, getConfigStats],
  );

  const handleAddImage = useCallback(() => {
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = store.addImageNode({ x: center.x - 150, y: center.y - 180 });
    window.setTimeout(() => {
      reactFlow.setCenter(node.position.x + 150, node.position.y + 180, {
        duration: 280,
        zoom: store.viewport.zoom,
      });
    }, 0);
  }, [reactFlow, store]);

  const handleAddPrompt = useCallback(() => {
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = store.addPromptNode({ x: center.x - 160, y: center.y - 100 });
    window.setTimeout(() => {
      reactFlow.setCenter(node.position.x + 160, node.position.y + 100, {
        duration: 280,
        zoom: store.viewport.zoom,
      });
    }, 0);
  }, [reactFlow, store]);

  const handleAddConfig = useCallback(() => {
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = store.addConfigNode({ x: center.x - 160, y: center.y - 140 });
    window.setTimeout(() => {
      reactFlow.setCenter(node.position.x + 160, node.position.y + 140, {
        duration: 280,
        zoom: store.viewport.zoom,
      });
    }, 0);
  }, [reactFlow, store]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    store.removeNodes(selectedNodeIds);
    setSelectedNodeIds([]);
  }, [selectedNodeIds, store]);

  const handleDuplicateSelected = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const duplicatedIds = store.duplicateNodes(selectedNodeIds);
    setSelectedNodeIds(duplicatedIds);
    if (duplicatedIds.length > 0) {
      window.setTimeout(() => {
        void reactFlow.fitView({
          nodes: duplicatedIds.map((id) => ({ id })),
          duration: 260,
          padding: 0.24,
          maxZoom: 1.2,
        });
      }, 0);
    }
  }, [reactFlow, selectedNodeIds, store]);

  const handleFitView = useCallback(() => {
    void reactFlow.fitView({ duration: 320, padding: 0.2 });
  }, [reactFlow]);

  const handleZoomSelection = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    void reactFlow.fitView({
      nodes: selectedNodeIds.map((id) => ({ id })),
      duration: 320,
      padding: 0.28,
      maxZoom: 1.35,
    });
  }, [reactFlow, selectedNodeIds]);

  const handleArrange = useCallback(() => {
    if (store.nodes.length <= 1) return;
    store.arrangeNodes();
    window.setTimeout(() => {
      void reactFlow.fitView({ duration: 360, padding: 0.22 });
    }, 0);
  }, [reactFlow, store]);

  const handleExport = useCallback(() => {
    if (store.nodes.length === 0) return;
    const payload = createCanvasExportPayload({
      nodes: store.nodes,
      edges: store.edges,
      viewport: store.viewport,
      updatedAt: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `chatgpt2api-canvas-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [store.edges, store.nodes, store.viewport]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const graph = normaliseCanvasGraph(parsed);
        if (!graph) {
          window.alert("导入失败：不是有效的画布工作流 JSON。");
          return;
        }
        if (store.nodes.length > 0) {
          const confirmed = window.confirm("导入会替换当前画布，是否继续？");
          if (!confirmed) return;
        }
        store.replaceGraph(graph);
        setSelectedNodeIds([]);
        window.setTimeout(() => {
          void reactFlow.fitView({ duration: 320, padding: 0.22 });
        }, 0);
      } catch {
        window.alert("导入失败：JSON 解析错误。");
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = "";
        }
      }
    },
    [reactFlow, store],
  );

  const handleLoadTemplate = useCallback(() => {
    if (store.nodes.length > 0) {
      const confirmed = window.confirm("载入模板会替换当前画布，是否继续？");
      if (!confirmed) return;
    }
    store.loadStarterTemplate();
    setSelectedNodeIds([]);
    window.setTimeout(() => {
      void reactFlow.fitView({ duration: 320, padding: 0.22 });
    }, 0);
  }, [reactFlow, store]);

  const handleResetAll = useCallback(() => {
    if (store.nodes.length === 0) return;
    const confirmed = window.confirm("确认清空当前画布？该操作不可撤销。");
    if (!confirmed) return;
    store.resetAll();
    setSelectedNodeIds([]);
  }, [store]);

  const handleSelectAll = useCallback(() => {
    const ids = nodesRef.current.map((node) => node.id);
    if (ids.length === 0) return;
    setSelectedNodeIds(ids);
    store.setNodes((current) =>
      current.map((node) => ({ ...node, selected: true }) as CanvasAnyNode),
    );
  }, [store]);

  const handleUndo = useCallback(() => {
    store.undo();
    setSelectedNodeIds([]);
  }, [store]);

  const handleRedo = useCallback(() => {
    store.redo();
    setSelectedNodeIds([]);
  }, [store]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (mod && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (mod && key === "a") {
        event.preventDefault();
        handleSelectAll();
        return;
      }

      if (mod && key === "d") {
        event.preventDefault();
        handleDuplicateSelected();
        return;
      }

      if (!mod && key === "f") {
        event.preventDefault();
        if (event.shiftKey) {
          handleZoomSelection();
        } else {
          handleFitView();
        }
        return;
      }

      if (event.altKey && key === "l") {
        event.preventDefault();
        handleArrange();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleArrange,
    handleDuplicateSelected,
    handleFitView,
    handleRedo,
    handleSelectAll,
    handleUndo,
    handleZoomSelection,
  ]);

  const previewNode = previewNodeId
    ? (store.nodes.find((node) => node.id === previewNodeId && isConfigNode(node)) as
        | CanvasConfigNodeType
        | undefined) ?? null
    : null;

  return (
    <CanvasNodeContext.Provider value={contextValue}>
      <div className="relative h-full w-full bg-slate-50 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.98))]">
        <ReactFlow
          nodes={store.nodes}
          edges={store.edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          onMoveEnd={handleMoveEnd}
          nodeTypes={nodeTypes}
          defaultViewport={store.viewport}
          fitView={false}
          panOnScroll
          selectionOnDrag
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#e5e5e7" size={1} />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(node) => getNodeColor(node as CanvasAnyNode)}
            nodeStrokeColor={(node) =>
              (node as CanvasAnyNode).selected ? "#111827" : "rgba(15,23,42,0.18)"
            }
            nodeStrokeWidth={2}
            nodeBorderRadius={4}
            bgColor="rgba(255,255,255,0.92)"
            maskColor="rgba(15,23,42,0.08)"
            maskStrokeColor="rgba(15,23,42,0.24)"
            className="!bottom-4 !left-4 !h-28 !w-44 !rounded-lg !border !border-stone-200 !shadow-[0_12px_32px_-18px_rgba(15,23,42,0.35)]"
            ariaLabel="画布缩略图"
          />
          <Controls
            position="bottom-right"
            className="!bottom-4 !right-4 !rounded-lg !border !border-stone-200 !bg-white/95 !shadow-[0_12px_32px_-18px_rgba(15,23,42,0.35)] xl:!right-[328px]"
          />
        </ReactFlow>

        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <CanvasToolbar
            nodeCount={store.nodes.length}
            selectionCount={selectedNodeIds.length}
            canUndo={store.canUndo}
            canRedo={store.canRedo}
            onAddPrompt={handleAddPrompt}
            onAddImage={handleAddImage}
            onAddConfig={handleAddConfig}
            onDeleteSelected={handleDeleteSelected}
            onDuplicateSelected={handleDuplicateSelected}
            onFitView={handleFitView}
            onZoomSelection={handleZoomSelection}
            onArrange={handleArrange}
            onExport={handleExport}
            onImport={handleImportClick}
            onLoadTemplate={handleLoadTemplate}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onResetAll={handleResetAll}
          />
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
          />
        </div>

        <div className="pointer-events-none absolute right-4 top-4 z-10 hidden xl:block">
          <CanvasInspector
            nodes={store.nodes}
            edges={store.edges}
            selectedNodeIds={selectedNodeIds}
          />
        </div>

        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-[11px] font-medium text-stone-600 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.3)] backdrop-blur-md lg:flex">
          <span className="font-semibold text-stone-800">
            {Math.round(store.viewport.zoom * 100)}%
          </span>
          <span className="h-3 w-px bg-stone-200" />
          <span>{selectedNodeIds.length} 已选</span>
          <span className="h-3 w-px bg-stone-200" />
          <span>F 适配</span>
          <span>Shift+F 选区</span>
          <span>Ctrl/⌘+Z 撤销</span>
          <span>Ctrl/⌘+D 复制</span>
          <span>Alt+L 整理</span>
          <span>JSON 导入/导出</span>
        </div>

        {store.isLoaded && store.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <div className="max-w-sm rounded-lg border border-stone-200 bg-white/92 px-7 py-6 text-center text-sm text-stone-600 shadow-[0_18px_44px_-28px_rgba(28,25,23,0.28)] backdrop-blur-md">
              <div className="mb-1.5 flex items-center justify-center gap-1.5 text-base font-bold text-stone-900">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                创作画布
              </div>
              <p className="text-xs leading-relaxed text-stone-500">
                点击上方「+ 提示词」开始，添加「+ 配置」节点驱动生成。
                <br />
                <span className="mt-1.5 block text-[11px] text-stone-400">
                  Config 上游可接提示词节点、图片节点，一次出 N 张
                </span>
              </p>
            </div>
          </div>
        ) : null}

        <CanvasPreviewModal
          open={previewNode !== null}
          configNode={previewNode}
          nodes={store.nodes}
          edges={store.edges}
          onOpenChange={(next) => {
            if (!next) setPreviewNodeId(null);
          }}
          onReorder={(configNodeId, nextOrder) => {
            store.updateConfigNodeData(configNodeId, (data) => ({
              ...data,
              inputOrder: nextOrder,
            }));
          }}
        />
      </div>
    </CanvasNodeContext.Provider>
  );
}

export function CanvasFlow() {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner />
    </ReactFlowProvider>
  );
}
