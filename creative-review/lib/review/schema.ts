// Single source of truth for the review data model. Both stores (Postgres in
// production, a JSON file for local dev) read this; Postgres tables and columns
// are created from it automatically on first use.

export type FieldType = "text" | "longtext" | "number" | "bool" | "json" | "date" | "select";

export interface FieldDef {
  type: FieldType;
  choices?: readonly string[];
  description?: string;
}

export const PROJECT_STATUSES = [
  "queued", // brief + footage in, waiting for the AI's first cut
  "editing", // the AI has claimed it and is working
  "in_review", // a version is up and waiting on the reviewer
  "changes_requested", // reviewer sent feedback; back in the AI queue
  "approved",
  "archived",
] as const;

export const VERSION_STATUSES = ["in_review", "changes_requested", "approved", "superseded"] as const;
export const COMMENT_STATUSES = ["open", "resolved"] as const;
export const RULE_STATUSES = ["active", "proposed", "retired"] as const;
export const KINDS = ["video", "static"] as const;
export const SCOPES = ["all", "video", "static"] as const;

export const TABLES = {
  projects: {
    table: "review_projects",
    fields: {
      name: { type: "text" },
      kind: { type: "select", choices: KINDS },
      status: { type: "select", choices: PROJECT_STATUSES },
      brand: { type: "text", description: "Brand code (NAL / VIG / MED)." },
      brief: { type: "longtext", description: "The brief the AI edits against." },
      footage: { type: "json", description: "JSON list of raw footage / source files: [{url,name,size,type}]." },
      format: { type: "text", description: "Target spec, e.g. 9:16 · 30s." },
      source: { type: "text", description: "Who makes versions: ai | human." },
      created_by: { type: "text" },
      claimed_by: { type: "text", description: "Which AI session is working on it right now." },
      current_version: { type: "number" },
      open_comments: { type: "number", description: "Open comments on the current version (denormalised for the dashboard)." },
      poster_url: { type: "text", description: "Thumbnail of the latest version." },
      created_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
  versions: {
    table: "review_versions",
    fields: {
      label: { type: "text" },
      project_id: { type: "text" },
      number: { type: "number" },
      status: { type: "select", choices: VERSION_STATUSES },
      file_url: { type: "text" },
      file_name: { type: "text" },
      mime: { type: "text" },
      size: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
      duration: { type: "number", description: "Seconds (video only)." },
      fps: { type: "number" },
      poster_url: { type: "text" },
      notes: { type: "longtext", description: "Changelog from whoever uploaded this version." },
      uploaded_by: { type: "text" },
      decision_by: { type: "text" },
      decision_note: { type: "longtext" },
      created_at: { type: "date" },
    },
  },
  comments: {
    table: "review_comments",
    fields: {
      label: { type: "text" },
      project_id: { type: "text" },
      version_id: { type: "text" },
      version_number: { type: "number" },
      parent_id: { type: "text", description: "Set on replies." },
      author: { type: "text" },
      author_kind: { type: "text", description: "human | ai" },
      body: { type: "longtext" },
      timecode: { type: "number", description: "Seconds into the video. Empty = general comment." },
      timecode_end: { type: "number", description: "End of a range comment." },
      x: { type: "number", description: "Pin position, 0–1 from the left." },
      y: { type: "number", description: "Pin position, 0–1 from the top." },
      status: { type: "select", choices: COMMENT_STATUSES },
      resolution: { type: "longtext", description: "How the AI applied it." },
      resolved_in_version: { type: "number" },
      rule_id: { type: "text", description: "Playbook rule created from this comment." },
      created_at: { type: "date" },
    },
  },
  rules: {
    table: "review_rules",
    fields: {
      rule: { type: "text" },
      detail: { type: "longtext", description: "Why / example." },
      scope: { type: "select", choices: SCOPES },
      brand: { type: "text", description: "Empty = all brands." },
      status: { type: "select", choices: RULE_STATUSES },
      source_comment_id: { type: "text" },
      source_project_id: { type: "text" },
      created_by: { type: "text" },
      created_at: { type: "date" },
    },
  },
} as const satisfies Record<string, { table: string; fields: Record<string, FieldDef> }>;

export type TableKey = keyof typeof TABLES;
