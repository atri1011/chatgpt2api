"use client";

import { createContext, useContext } from "react";

import type { CanvasImageNodeData } from "@/types/canvas";

export type CanvasNodeContextValue = {
  onRun: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onChangePrompt: (nodeId: string, value: string) => void;
  onChangeTitle: (nodeId: string, value: string) => void;
  updateNodeData: (nodeId: string, updater: (data: CanvasImageNodeData) => CanvasImageNodeData) => void;
};

const noop = () => undefined;

const fallback: CanvasNodeContextValue = {
  onRun: noop,
  onDelete: noop,
  onChangePrompt: noop,
  onChangeTitle: noop,
  updateNodeData: noop,
};

export const CanvasNodeContext = createContext<CanvasNodeContextValue>(fallback);

export function useCanvasNodeContext(): CanvasNodeContextValue {
  return useContext(CanvasNodeContext);
}
