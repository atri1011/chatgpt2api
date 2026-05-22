"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
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
  collectUpstreamReferences,
  getOrderedUpstreamNodes,
  runConfigNode,
  runNode,
} from "@/lib/canvas-runner";
import {
  addEdgeConnection,
  buildBatchPlacement,
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

function CanvasFlowInner() {
  const store = useCanvasStore();
  const reactFlow = useReactFlow();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const nodesRef = useRef<CanvasAnyNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
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
        // Build placement (root + N children) and insert into the graph.
        const placement = buildBatchPlacement({
          sourceNodeId: configNodeId,
          sourcePosition: configNode.position,
          count: configNode.data.count || 1,
          rootTitle: `${configNode.data.title || "批次"} - ${new Date().toLocaleTimeString()}`,
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
      const ordered = getOrderedUpstreamNodes(
        nodeId,
        nodesRef.current,
        edgesRef.current,
        target.data.inputOrder,
      );
      let promptCount = 0;
      let referenceCount = 0;
      ordered.forEach((node) => {
        if (isImageNode(node)) {
          if (node.data.isBatchRoot) return;
          if (node.data.status === "success") referenceCount += 1;
          if (node.data.prompt?.trim()) promptCount += 1;
        } else if (isPromptNode(node)) {
          if (node.data.prompt?.trim()) promptCount += 1;
        } else if (isConfigNode(node)) {
          if (node.data.prompt?.trim()) promptCount += 1;
        }
      });
      return { promptCount, referenceCount };
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

  const handleFitView = useCallback(() => {
    void reactFlow.fitView({ duration: 320, padding: 0.2 });
  }, [reactFlow]);

  const handleResetAll = useCallback(() => {
    if (store.nodes.length === 0) return;
    const confirmed = window.confirm("确认清空当前画布？该操作不可撤销。");
    if (!confirmed) return;
    store.resetAll();
    setSelectedNodeIds([]);
  }, [store]);

  const previewNode = previewNodeId
    ? (store.nodes.find((node) => node.id === previewNodeId && isConfigNode(node)) as
        | CanvasConfigNodeType
        | undefined) ?? null
    : null;

  return (
    <CanvasNodeContext.Provider value={contextValue}>
      <div className="relative h-full w-full">
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
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color="#e7e5e4" />
          <Controls position="bottom-right" />
        </ReactFlow>

        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <CanvasToolbar
            nodeCount={store.nodes.length}
            selectionCount={selectedNodeIds.length}
            onAddPrompt={handleAddPrompt}
            onAddImage={handleAddImage}
            onAddConfig={handleAddConfig}
            onDeleteSelected={handleDeleteSelected}
            onFitView={handleFitView}
            onResetAll={handleResetAll}
          />
        </div>

        {store.isLoaded && store.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <div className="rounded-3xl bg-white/70 px-6 py-4 text-center text-sm text-stone-500 ring-1 ring-stone-200 backdrop-blur">
              点击「+ 提示词」开始，添加「+ 配置」节点驱动生成
              <br />
              <span className="text-xs text-stone-400">
                Config 上游可接提示词节点、图片节点，一次出 N 张
              </span>
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
