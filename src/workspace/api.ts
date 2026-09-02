import { invoke } from "@tauri-apps/api/core";

export type WorkspaceEntry = {
  path: string;
  name: string;
  kind: "directory" | "file";
  depth: number;
  bytes: number | null;
};

export type WorkspaceIndex = {
  entries: WorkspaceEntry[];
  truncated: boolean;
};

export type WorkspaceFileContent = {
  path: string;
  language: string;
  content: string;
  bytes: number;
};

export type WorkspaceSearchResult = {
  path: string;
  line: number | null;
  preview: string;
  kind: "path" | "content";
};

export type WorkspaceSearchResponse = {
  results: WorkspaceSearchResult[];
  truncated: boolean;
  inspectedFiles: number;
};

export type GitFileChange = {
  status: string;
  path: string;
};

export type GitReview = {
  isRepository: boolean;
  branch: string;
  files: GitFileChange[];
  diff: string;
  truncated: boolean;
};

export const listWorkspaceEntries = () =>
  invoke<WorkspaceIndex>("list_workspace_entries");

export const readWorkspaceFile = (path: string) =>
  invoke<WorkspaceFileContent>("read_workspace_file", { path });

export const searchWorkspace = (query: string) =>
  invoke<WorkspaceSearchResponse>("search_workspace", { query });

export const getWorkspaceGitReview = () =>
  invoke<GitReview>("workspace_git_review");
