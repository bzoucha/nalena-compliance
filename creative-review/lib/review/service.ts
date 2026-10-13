import "server-only";
import { after } from "next/server";
import { store } from "./store";
import { formatTimecode } from "./time";
import type { Comment, FileRef, Kind, Project, ProjectBundle, Rule, Scope, Version } from "./types";

export class ReviewError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

function byCreated<T extends { created_at: string }>(a: T, b: T) {
  return a.created_at.localeCompare(b.created_at);
}

export function sortComments(list: Comment[]): Comment[] {
  return [...list].sort((a, b) => {
    const ta = a.timecode ?? -1;
    const tb = b.timecode ?? -1;
    return ta !== tb ? ta - tb : byCreated(a, b);
  });
}

function commentLabel(c: { version_number: number; timecode: number | null; x: number | null; body: string; parent_id?: string }) {
  const where = c.timecode != null ? `@${formatTimecode(c.timecode)}` : c.x != null ? "📍" : "general";
  const prefix = c.parent_id ? "↳ " : "";
  return `${prefix}v${c.version_number} ${where} — ${c.body.replace(/\s+/g, " ").slice(0, 60)}`;
}

// ─── Projects ─────────────────────────────────────────────────────────────

export async function listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const rows = await store().projects.list();
  return rows
    .filter((p) => opts.includeArchived || p.status !== "archived")
    .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
}

export async function getProject(id: string): Promise<Project> {
  const p = await store().projects.get(id);
  if (!p) throw new ReviewError("Project not found", 404);
  return p;
}

export async function getBundle(id: string): Promise<ProjectBundle> {
  const [project, versions, comments] = await Promise.all([
    getProject(id),
    store().versions.list({ project_id: id }),
    store().comments.list({ project_id: id }),
  ]);
  return {
    project,
    versions: versions.sort((a, b) => a.number - b.number),
    comments: sortComments(comments),
  };
}

export interface NewProjectInput {
  name: string;
  kind: Kind;
  brand?: string;
  brief?: string;
  format?: string;
  footage?: FileRef[];
  source?: "ai" | "human";
  created_by?: string;
  /** Optional first version (e.g. a static ad that already exists). */
  version?: NewVersionInput;
}

export async function createProject(input: NewProjectInput): Promise<ProjectBundle> {
  if (!input.name?.trim()) throw new ReviewError("Name is required");
  if (input.kind !== "video" && input.kind !== "static") throw new ReviewError("kind must be video or static");
  const project = await store().projects.create({
    name: input.name.trim(),
    kind: input.kind,
    status: "queued",
    brand: input.brand?.trim() ?? "",
    brief: input.brief ?? "",
    footage: input.footage ?? [],
    format: input.format ?? "",
    source: input.source ?? "ai",
    created_by: input.created_by ?? "",
    current_version: 0,
    open_comments: 0,
    created_at: now(),
    updated_at: now(),
  });
  if (input.version) await addVersion(project.id, input.version);
  else notify("project_queued", project, `🎬 New ${project.kind} brief queued for the AI: ${project.name}`);
  return getBundle(project.id);
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "brand" | "brief" | "format" | "footage" | "status" | "claimed_by">>,
): Promise<Project> {
  await getProject(id);
  return store().projects.update(id, { ...patch, updated_at: now() });
}

/** The AI marks a job as "being worked on" so two sessions don't grab it. */
export async function claimProject(id: string, by: string): Promise<Project> {
  const p = await getProject(id);
  if (p.status !== "queued" && p.status !== "changes_requested" && p.status !== "editing") {
    throw new ReviewError(`Project is ${p.status}; nothing to claim`, 409);
  }
  return store().projects.update(id, { status: "editing", claimed_by: by || "ai", updated_at: now() });
}

// ─── Versions ─────────────────────────────────────────────────────────────

export interface NewVersionInput {
  file_url: string;
  file_name?: string;
  mime?: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  fps?: number | null;
  poster_url?: string;
  notes?: string;
  uploaded_by?: string;
  /** Comments from the previous round this version addresses. */
  resolutions?: { comment_id: string; resolution: string }[];
}

export async function addVersion(projectId: string, input: NewVersionInput): Promise<Version> {
  if (!input.file_url) throw new ReviewError("file_url is required");
  const project = await getProject(projectId);
  const existing = await store().versions.list({ project_id: projectId });
  const number = existing.reduce((m, v) => Math.max(m, v.number), 0) + 1;

  const version = await store().versions.create({
    label: `${project.name} · v${number}`,
    project_id: projectId,
    number,
    status: "in_review",
    file_url: input.file_url,
    file_name: input.file_name ?? "",
    mime: input.mime ?? "",
    size: input.size ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    duration: input.duration ?? null,
    fps: input.fps ?? null,
    poster_url: input.poster_url ?? "",
    notes: input.notes ?? "",
    uploaded_by: input.uploaded_by ?? "",
    created_at: now(),
  });

  // Older cuts still waiting on review are now superseded.
  await Promise.all(
    existing.filter((v) => v.status === "in_review").map((v) => store().versions.update(v.id, { status: "superseded" })),
  );

  for (const r of input.resolutions ?? []) {
    const c = await store().comments.get(r.comment_id);
    if (!c || c.project_id !== projectId) continue;
    await store().comments.update(c.id, { status: "resolved", resolution: r.resolution ?? "", resolved_in_version: number });
  }

  const updated = await store().projects.update(projectId, {
    status: "in_review",
    current_version: number,
    open_comments: 0,
    claimed_by: "",
    poster_url: input.poster_url || (input.mime?.startsWith("image/") ? input.file_url : project.poster_url),
    updated_at: now(),
  });
  const fixed = input.resolutions?.length ? ` — addressed ${input.resolutions.length} note(s)` : "";
  notify("version_uploaded", updated, `🆕 ${updated.name} v${number} is ready for review${fixed}`, version);
  return version;
}

export async function decide(
  projectId: string,
  input: { version_id: string; decision: "approve" | "request_changes"; by?: string; note?: string },
): Promise<ProjectBundle> {
  const project = await getProject(projectId);
  const version = await store().versions.get(input.version_id);
  if (!version || version.project_id !== projectId) throw new ReviewError("Version not found", 404);
  if (version.number !== project.current_version) throw new ReviewError("Only the latest version can be approved or sent back", 409);

  if (input.decision === "approve") {
    await store().versions.update(version.id, { status: "approved", decision_by: input.by ?? "", decision_note: input.note ?? "" });
    const p = await store().projects.update(projectId, { status: "approved", updated_at: now() });
    notify("approved", p, `✅ ${p.name} v${version.number} approved${input.by ? ` by ${input.by}` : ""}`, version);
  } else if (input.decision === "request_changes") {
    const open = (await store().comments.list({ version_id: version.id, status: "open" })).filter((c) => !c.parent_id);
    if (!open.length && !input.note?.trim()) throw new ReviewError("Leave at least one comment (or a note) before sending changes back");
    if (input.note?.trim()) {
      await addComment({
        project_id: projectId,
        version_id: version.id,
        author: input.by ?? "",
        author_kind: "human",
        body: input.note.trim(),
      });
    }
    await store().versions.update(version.id, { status: "changes_requested", decision_by: input.by ?? "", decision_note: input.note ?? "" });
    const p = await store().projects.update(projectId, { status: "changes_requested", claimed_by: "", updated_at: now() });
    const count = open.length + (input.note?.trim() ? 1 : 0);
    notify("changes_requested", p, `✏️ ${p.name} v${version.number}: ${count} note(s) sent to the AI editor`, version);
  } else {
    throw new ReviewError("decision must be approve or request_changes");
  }
  return getBundle(projectId);
}

// ─── Comments ─────────────────────────────────────────────────────────────

export interface NewCommentInput {
  project_id: string;
  version_id: string;
  parent_id?: string;
  author?: string;
  author_kind?: "human" | "ai";
  body: string;
  timecode?: number | null;
  timecode_end?: number | null;
  x?: number | null;
  y?: number | null;
  /** Reviewer ticked "save to playbook": also becomes a standing rule. */
  save_as_rule?: boolean;
  rule_scope?: Scope;
}

function clamp01(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

export async function addComment(input: NewCommentInput): Promise<Comment> {
  if (!input.body?.trim()) throw new ReviewError("Comment is empty");
  const project = await getProject(input.project_id);
  const version = await store().versions.get(input.version_id);
  if (!version || version.project_id !== project.id) throw new ReviewError("Version not found", 404);
  if (input.parent_id) {
    const parent = await store().comments.get(input.parent_id);
    if (!parent || parent.project_id !== project.id) throw new ReviewError("Parent comment not found", 404);
  }

  const timecode = input.timecode != null && Number.isFinite(input.timecode) ? Math.max(0, input.timecode) : null;
  const timecode_end =
    timecode != null && input.timecode_end != null && Number.isFinite(input.timecode_end) && input.timecode_end > timecode
      ? input.timecode_end
      : null;
  const base = {
    project_id: project.id,
    version_id: version.id,
    version_number: version.number,
    parent_id: input.parent_id ?? "",
    author: input.author?.trim() || (input.author_kind === "ai" ? "AI editor" : "Reviewer"),
    author_kind: input.author_kind ?? "human",
    body: input.body.trim(),
    timecode: input.parent_id ? null : timecode,
    timecode_end: input.parent_id ? null : timecode_end,
    x: input.parent_id ? null : clamp01(input.x),
    y: input.parent_id ? null : clamp01(input.y),
  };
  let comment = await store().comments.create({
    ...base,
    label: commentLabel(base),
    status: "open",
    created_at: now(),
  });

  if (input.save_as_rule && !input.parent_id) {
    const rule = await createRule({
      rule: comment.body,
      scope: input.rule_scope ?? project.kind,
      brand: "",
      status: "active",
      source_comment_id: comment.id,
      source_project_id: project.id,
      created_by: comment.author,
    });
    comment = await store().comments.update(comment.id, { rule_id: rule.id });
  }
  await refreshOpenCount(project.id);
  return comment;
}

export async function updateComment(
  id: string,
  patch: { status?: "open" | "resolved"; body?: string; resolution?: string; save_as_rule?: boolean; rule_scope?: Scope; by?: string },
): Promise<Comment> {
  const c = await store().comments.get(id);
  if (!c) throw new ReviewError("Comment not found", 404);
  const next: Partial<Comment> = {};
  if (patch.status === "open" || patch.status === "resolved") next.status = patch.status;
  if (typeof patch.body === "string" && patch.body.trim()) {
    next.body = patch.body.trim();
    next.label = commentLabel({ ...c, body: next.body });
  }
  if (typeof patch.resolution === "string") next.resolution = patch.resolution;
  if (patch.save_as_rule && !c.rule_id && !c.parent_id) {
    const project = await getProject(c.project_id);
    const rule = await createRule({
      rule: next.body ?? c.body,
      scope: patch.rule_scope ?? project.kind,
      brand: "",
      status: "active",
      source_comment_id: c.id,
      source_project_id: c.project_id,
      created_by: patch.by ?? c.author,
    });
    next.rule_id = rule.id;
  }
  const updated = await store().comments.update(id, next);
  if (next.status) await refreshOpenCount(c.project_id);
  return updated;
}

export async function deleteComment(id: string): Promise<void> {
  const c = await store().comments.get(id);
  if (!c) return;
  const replies = await store().comments.list({ parent_id: id });
  await Promise.all(replies.map((r) => store().comments.remove(r.id)));
  await store().comments.remove(id);
  await refreshOpenCount(c.project_id);
}

async function refreshOpenCount(projectId: string) {
  const p = await getProject(projectId);
  const open = await store().comments.list({ project_id: projectId, version_number: p.current_version, status: "open" });
  const count = open.filter((c) => !c.parent_id).length;
  if (count !== p.open_comments) await store().projects.update(projectId, { open_comments: count });
}

// ─── Playbook rules (the skill's memory) ──────────────────────────────────

export async function listRules(filter: { status?: Rule["status"] | "all"; scope?: Kind; brand?: string } = {}): Promise<Rule[]> {
  const rows = await store().rules.list(filter.status && filter.status !== "all" ? { status: filter.status } : undefined);
  return rows
    .filter((r) => !filter.scope || r.scope === "all" || r.scope === filter.scope)
    .filter((r) => !filter.brand || !r.brand || r.brand.toUpperCase() === filter.brand.toUpperCase())
    .sort(byCreated);
}

export async function createRule(input: Partial<Omit<Rule, "id">> & { rule: string }): Promise<Rule> {
  if (!input.rule?.trim()) throw new ReviewError("Rule text is required");
  const scope: Scope = input.scope === "video" || input.scope === "static" ? input.scope : "all";
  return store().rules.create({
    rule: input.rule.trim(),
    detail: input.detail ?? "",
    scope,
    brand: input.brand ?? "",
    status: input.status === "proposed" || input.status === "retired" ? input.status : "active",
    source_comment_id: input.source_comment_id ?? "",
    source_project_id: input.source_project_id ?? "",
    created_by: input.created_by ?? "",
    created_at: now(),
  });
}

export async function updateRule(id: string, patch: Partial<Pick<Rule, "rule" | "detail" | "scope" | "brand" | "status">>): Promise<Rule> {
  const r = await store().rules.get(id);
  if (!r) throw new ReviewError("Rule not found", 404);
  return store().rules.update(id, patch);
}

// ─── The AI editor's queue ────────────────────────────────────────────────

export interface AgentJob {
  project: Project;
  latest_version: Version | null;
  /** Open notes on the latest version, oldest-timecode first, replies inlined. */
  feedback: (Comment & { timecode_label: string; replies: Comment[] })[];
  history: { number: number; notes: string; status: string; file_url: string }[];
  rules: Rule[];
  next_step: string;
}

export async function agentJobs(opts: { includeEditing?: boolean; projectId?: string } = {}): Promise<AgentJob[]> {
  const statuses = opts.includeEditing ? ["queued", "changes_requested", "editing"] : ["queued", "changes_requested"];
  const projects = opts.projectId
    ? [await getProject(opts.projectId)]
    : (await store().projects.list({ status: statuses })).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const allRules = await listRules({ status: "active" });

  return Promise.all(
    projects.map(async (project) => {
      const { versions, comments } = await getBundle(project.id);
      const latest = versions.at(-1) ?? null;
      const onLatest = latest ? comments.filter((c) => c.version_id === latest.id) : [];
      const feedback = onLatest
        .filter((c) => !c.parent_id && c.status === "open" && c.author_kind === "human")
        .map((c) => ({
          ...c,
          timecode_label: c.timecode != null ? formatTimecode(c.timecode) + (c.timecode_end != null ? `–${formatTimecode(c.timecode_end)}` : "") : "",
          replies: onLatest.filter((r) => r.parent_id === c.id).sort(byCreated),
        }));
      const rules = allRules.filter(
        (r) => (r.scope === "all" || r.scope === project.kind) && (!r.brand || r.brand.toUpperCase() === project.brand.toUpperCase()),
      );
      const next_step = !latest
        ? `Make v1 from the brief${project.footage.length ? ` and ${project.footage.length} footage file(s)` : ""}, then upload it.`
        : `Apply the ${feedback.length} note(s) to v${latest.number}, upload v${latest.number + 1}, and resolve each note with what you changed.`;
      return {
        project,
        latest_version: latest,
        feedback,
        history: versions.map((v) => ({ number: v.number, notes: v.notes, status: v.status, file_url: v.file_url })),
        rules,
        next_step,
      };
    }),
  );
}

// ─── Notifications ────────────────────────────────────────────────────────

function projectUrl(p: Project): string {
  const base = (process.env.REVIEW_PUBLIC_URL || "").replace(/\/$/, "");
  return `${base}/review/${p.id}`;
}

function notify(event: string, project: Project, text: string, version?: Version) {
  const url = process.env.REVIEW_WEBHOOK_URL;
  if (!url) return;
  const body = JSON.stringify({
    event,
    text: `${text}\n${projectUrl(project)}`,
    project: { id: project.id, name: project.name, kind: project.kind, status: project.status, brand: project.brand, url: projectUrl(project) },
    version: version ? { id: version.id, number: version.number, file_url: version.file_url, notes: version.notes } : null,
  });
  const send = () =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000) })
      .then(() => undefined)
      .catch((e) => console.warn("[review] webhook failed", e));
  try {
    after(send);
  } catch {
    void send();
  }
}
