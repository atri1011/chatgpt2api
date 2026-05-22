"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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

import { CanvasImageNode } from "@/components/canvas/canvas-image-node";
import {
  CanvasNodeContext,
  type CanvasNodeContextValue,
} from "@/components/canvas/canvas-node-context";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { collectUpstreamReferences, runNode } from "@/lib/canvas-runner";
import { useCanvasStore, addEdgeConnection } from "@/store/canvas";
import type {
  CanvasEdge,
  CanvasImageNode as CanvasImageNodeType,
  CanvasImageNodeData,
} from "@/types/canvas";

const nodeTypes = { image: CanvasImageNode };

function CanvasFlowInner() {
  const store = useCanvasStore();
  const reactFlow = useReactFlow();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const nodesRef = useRef<CanvasImageNodeType[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const runningRef = useRef<Set<string>>(new Set());

  nodesRef.current = store.nodes;
  edgesRef.current = store.edges;

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      store.setNodes(
        (current) => applyNodeChanges(changes, current as Node[]) as CanvasImageNodeType[],
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

  const handleRun = useCallback(
    async (nodeId: string) => {
      if (runningRef.current.has(nodeId)) return;
      runningRef.current.add(nodeId);

      const targetNode = nodesRef.current.find((node) => node.id === nodeId);
      if (!targetNode) {
        runningRef.current.delete(nodeId);
        return;
      }

      store.updateNodeData(nodeId, (data) => ({ ...data, status: "queued", error: undefined }));

      try {
        const references = await collectUpstreamReferences(
          nodeId,
          nodesRef.current,
          edgesRef.current,
        );
        await runNode({
          node: targetNode,
          references,
          onUpdate: (updater) => store.updateNodeData(nodeId, updater),
        });
      } finally {
        runningRef.current.delete(nodeId);
      }
    },
    [store],
  );

  const contextValue = useMemo<CanvasNodeContextValue>(
    () => ({
      onRun: (nodeId) => void handleRun(nodeId),
      onDelete: (nodeId) => store.removeNode(nodeId),
      onChangePrompt: (nodeId, value) =>
        store.updateNodeData(nodeId, (data) => ({ ...data, prompt: value })),
      onChangeTitle: (nodeId, value) =>
        store.updateNodeData(nodeId, (data) => ({ ...data, title: value })),
      updateNodeData: (nodeId, updater: (data: CanvasImageNodeData) => CanvasImageNodeData) =>
        store.updateNodeData(nodeId, updater),
    }),
    [handleRun, store],
  );

  const handleAddNode = useCallback(() => {
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const node = store.addNode({
      x: center.x - 150,
      y: center.y - 180,
    });
    window.setTimeout(() => {
      reactFlow.setCenter(node.position.x + 150, node.position.y + 180, {
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
            onAdd={handleAddNode}
            onDeleteSelected={handleDeleteSelected}
            onFitView={handleFitView}
            onResetAll={handleResetAll}
          />
        </div>

        {store.isLoaded && store.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
            <div className="rounded-3xl bg-white/70 px-6 py-4 text-center text-sm text-stone-500 ring-1 ring-stone-200 backdrop-blur">
              点击左上角「+ 节点」开始
              <br />
              <span className="text-xs text-stone-400">连线后下游节点会用上游图作为参考图</span>
            </div>
          </div>
        ) : null}
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
