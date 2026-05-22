"use client";

import { createContext, useContext } from "react";

import type {
  CanvasConfigNodeData,
  CanvasImageNodeData,
  CanvasPromptNodeData,
} from "@/types/canvas";

export type CanvasNodeContextValue = {
  onDelete: (nodeId: string) => void;
  onChangeTitle: (nodeId: string, value: string) => void;

  // Image-node specific
  onRunImage: (nodeId: string) => void;
  onChangeImagePrompt: (nodeId: string, value: string) => void;
  updateImageNodeData: (
    nodeId: string,
    updater: (data: CanvasImageNodeData) => CanvasImageNodeData,
  ) => void;

  // Config-node specific
  onRunConfig: (nodeId: string) => void;
  onChangeConfigData: (
    nodeId: string,
    patch: Partial<CanvasConfigNodeData>,
  ) => void;
  onOpenPreview: (nodeId: string) => void;
  /** Read live upstream stats for a Config node (prompt/reference counts). */
  getConfigStats: (nodeId: string) => { promptCount: number; referenceCount: number };

  // Prompt-node specific
  onChangePromptText: (nodeId: string, value: string) => void;
  updatePromptNodeData: (
    nodeId: string,
    updater: (data: CanvasPromptNodeData) => CanvasPromptNodeData,
  ) => void;
};

const noop = () => undefined;

const fallback: CanvasNodeContextValue = {
  onDelete: noop,
  onChangeTitle: noop,
  onRunImage: noop,
  onChangeImagePrompt: noop,
  updateImageNodeData: noop,
  onRunConfig: noop,
  onChangeConfigData: noop,
  onOpenPreview: noop,
  getConfigStats: () => ({ promptCount: 0, referenceCount: 0 }),
  onChangePromptText: noop,
  updatePromptNodeData: noop,
};

export const CanvasNodeContext = createContext<CanvasNodeContextValue>(fallback);

export function useCanvasNodeContext(): CanvasNodeContextValue {
  return useContext(CanvasNodeContext);
}
