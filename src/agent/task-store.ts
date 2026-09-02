import { invoke } from "@tauri-apps/api/core";
import type { AgentPlanStep, AgentState, AgentTimelineItem, AgentUsage } from "./types";

export type TaskArtifact = {
  language: string;
  content: string;
};

export type TaskSnapshot = {
  schemaVersion: 1;
  taskId: string;
  title: string;
  mode: "web" | "code" | "writing" | "assistant";
  provider: "ollama" | "orcarouter";
  model: string;
  status: AgentState;
  plan: AgentPlanStep[];
  toolLog: AgentTimelineItem[];
  finalArtifact: TaskArtifact | null;
  usage: AgentUsage | null;
  createdAt: number;
  updatedAt: number;
};

export type TaskSummary = {
  taskId: string;
  title: string;
  mode: TaskSnapshot["mode"];
  provider: TaskSnapshot["provider"];
  model: string;
  status: AgentState;
  hasArtifact: boolean;
  createdAt: number;
  updatedAt: number;
};

export const saveTaskSnapshot = (snapshot: TaskSnapshot) =>
  invoke<void>("save_task_snapshot", { snapshot });

export const listTaskSnapshots = () =>
  invoke<TaskSummary[]>("list_task_snapshots");

export const loadTaskSnapshot = (taskId: string) =>
  invoke<TaskSnapshot>("load_task_snapshot", { taskId });
