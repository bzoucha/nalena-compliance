import type { COMMENT_STATUSES, KINDS, PROJECT_STATUSES, RULE_STATUSES, SCOPES, VERSION_STATUSES } from "./schema";

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type RuleStatus = (typeof RULE_STATUSES)[number];
export type Kind = (typeof KINDS)[number];
export type Scope = (typeof SCOPES)[number];

export interface FileRef {
  url: string;
  name: string;
  size?: number;
  type?: string;
}

export interface Project {
  id: string;
  name: string;
  kind: Kind;
  status: ProjectStatus;
  brand: string;
  brief: string;
  footage: FileRef[];
  format: string;
  source: "ai" | "human";
  created_by: string;
  claimed_by: string;
  current_version: number;
  open_comments: number;
  poster_url: string;
  created_at: string;
  updated_at: string;
}

export interface Version {
  id: string;
  label: string;
  project_id: string;
  number: number;
  status: VersionStatus;
  file_url: string;
  file_name: string;
  mime: string;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  fps: number | null;
  poster_url: string;
  notes: string;
  uploaded_by: string;
  decision_by: string;
  decision_note: string;
  created_at: string;
}

export interface Comment {
  id: string;
  label: string;
  project_id: string;
  version_id: string;
  version_number: number;
  parent_id: string;
  author: string;
  author_kind: "human" | "ai";
  body: string;
  timecode: number | null;
  timecode_end: number | null;
  x: number | null;
  y: number | null;
  status: CommentStatus;
  resolution: string;
  resolved_in_version: number | null;
  rule_id: string;
  created_at: string;
}

export interface Rule {
  id: string;
  rule: string;
  detail: string;
  scope: Scope;
  brand: string;
  status: RuleStatus;
  source_comment_id: string;
  source_project_id: string;
  created_by: string;
  created_at: string;
}

export interface Rows {
  projects: Project;
  versions: Version;
  comments: Comment;
  rules: Rule;
}

export interface ProjectBundle {
  project: Project;
  versions: Version[];
  comments: Comment[];
}
