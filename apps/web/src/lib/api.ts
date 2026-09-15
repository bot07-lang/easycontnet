import { supabase } from './supabase';

/**
 * Get the current access token. `getSession()` returns the STORED token, which
 * can be momentarily expired (e.g. right after the laptop wakes, before the
 * background auto-refresh fires) — so refresh proactively when it's expired or
 * within 60s of expiring. `forceRefresh` is used to recover from a 401.
 */
async function currentToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  if (s.expires_at != null && s.expires_at * 1000 <= Date.now() + 60_000) {
    const { data: r } = await supabase.auth.refreshSession();
    return r.session?.access_token ?? s.access_token;
  }
  return s.access_token;
}

/**
 * Thin client for the NestJS API. Attaches the current user's Supabase access
 * token as a bearer, which the API verifies and uses to enforce RLS. If the
 * token has expired (401), force a refresh and retry once before failing.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = await currentToken();
  if (!token) throw new Error('Not signed in');

  const send = (t: string) => fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${t}`,
      ...init?.headers,
    },
  });

  let res = await send(token);
  // A stale token is rejected by the API's AuthGuard before any handler runs, so
  // retrying is safe even for POST/DELETE — the original never executed.
  if (res.status === 401) {
    const fresh = await currentToken(true);
    if (fresh && fresh !== token) {
      token = fresh;
      res = await send(token);
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body || res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface ProjectSummary {
  id: string;
  project_number: number;
  name: string;
  description: string | null;
}

export interface ItemSummary {
  id: string;
  item_number: number;
  name: string;
  updated_at: string;
  template_name: string | null;
  status_name: string | null;
  status_color: string | null;
  /** 1-based stage number of the current status in the workflow ladder. */
  status_index: number | null;
  is_terminal: boolean;
  mine: boolean;
  /** Assignees of the item's CURRENT status. */
  people: { name: string; role?: string | null }[];
  /** First assignee of the INITIAL status (the writer/author), or null. */
  author: { name: string; role?: string | null } | null;
  /** True when the item's current status is the first (initial) status. */
  in_first_status: boolean;
  next_due_date: string | null;
  /** Caller may open the assign-people affordance (has manage_people_and_deadlines). */
  can_assign: boolean;
  /** Caller may claim (self-assign): unassigned item + reviewing role + not an assigner. */
  can_claim: boolean;
}

/** Shape returned by GET /content/items/:id — matches the editor's field model. */
export interface ApiField {
  id: string;
  type: string;
  label: string;
  isRequired: boolean;
  isSystem: boolean;
  guidelines?: string;
  isPlainText: boolean;
  recommendedLength?: number;
  recommendedLengthUnits?: 'words' | 'characters';
  choices: string[];
  value: unknown;
}

export interface ApiItem {
  id: string;
  /** Caller may claim (self-assign): unassigned + reviewing role + not an assigner. */
  canClaim: boolean;
  /** Caller may edit: assigned to the current status (or manage_content_items),
   *  and the current status isn't read-only. False → editor is read-only. */
  canEdit: boolean;
  itemNumber: number;
  name: string;
  /** Template the item was created from (null if none). */
  templateId: string | null;
  templateName: string | null;
  /** Brief keywords + description (brief "title" is the item name). */
  keywords: string[];
  description: string | null;
  status: { name: string; color: string } | null;
  tabs: { id: string; name: string; fields: ApiField[] }[];
}

/** A comment on a content item (item / field / text / file anchored; threaded). */
export interface ItemComment {
  id: string;
  item_id: string;
  anchor: 'item' | 'field' | 'text' | 'file';
  field_id: string | null;
  file_id: string | null;
  text_anchor: unknown;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_role: string | null;
  body: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  /** Caller may edit / delete / resolve this comment (own or manage_comments). */
  can_manage: boolean;
}

export interface NewComment {
  body: string;
  anchor?: 'item' | 'field' | 'text' | 'file';
  fieldId?: string | null;
  fileId?: string | null;
  textAnchor?: unknown;
  parentId?: string | null;
}

export interface DashboardMember {
  name: string;
}
export interface DashboardStatusSlice {
  name: string;
  color: string;
  count: number;
}
export interface DashboardProject {
  id: string;
  project_number: number;
  name: string;
  description: string | null;
  archived: boolean;
  active_count: number;
  overdue_count: number;
  last_activity: string | null;
  members: DashboardMember[];
  my_items_count: number;
  status_breakdown: DashboardStatusSlice[];
}
export interface DashboardMyItem {
  id: string;
  item_number: number;
  name: string;
  project_id: string;
  project_name: string;
  status_name: string | null;
  status_color: string | null;
}
export interface ProjectDashboardMember {
  id: string;
  name: string;
  role_name: string | null;
}
export interface ProjectDashboardActivity {
  id: string;
  created_at: string;
  item_id: string;
  item_number: number;
  item_name: string;
  to_status_name: string | null;
  actor_name: string | null;
  actor_role: string | null;
}
export interface ProjectDashboardComment {
  id: string;
  created_at: string;
  body: string;
  resolved: boolean;
  item_id: string;
  item_number: number;
  item_name: string;
  author_name: string | null;
}
export interface ProjectDashboardFunnelSlice {
  id: string;
  name: string;
  color: string;
  position: number;
  count: number;
  pct: number;
}
export interface ProjectDashboardUtilization {
  profile_id: string;
  name: string;
  role_name: string | null;
  items_count: number;
}
export interface ProjectDashboardVelocity {
  id: string;
  name: string;
  color: string;
  avgSeconds30d: number | null;
  avgSecondsPrev: number | null;
}
export interface ProjectDashboard {
  project: { id: string; name: string; members: ProjectDashboardMember[] };
  myItems: DashboardMyItem[];
  recentActivity: ProjectDashboardActivity[];
  recentComments: ProjectDashboardComment[];
  workflowFunnel: ProjectDashboardFunnelSlice[];
  teamUtilization: ProjectDashboardUtilization[];
  workflowVelocity: ProjectDashboardVelocity[];
}

export interface Dashboard {
  projects: DashboardProject[];
  myItems: DashboardMyItem[];
}

export interface OrgUser {
  id: string;
  full_name: string;
  role_name: string;
}

export interface ProjectSettings {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
}

export interface WorkflowRole {
  id: string;
  name: string;
  is_active: boolean;
}
export interface WorkflowMember {
  id: string;
  name: string;
}
export interface WorkflowStatus {
  id: string;
  name: string;
  color: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  auto_due_days: number | null;
  read_only: boolean;
  reviewing_role_ids: string[];
  default_assignees: WorkflowMember[];
}
export interface WorkflowRating {
  id: string;
  name: string;
  description: string | null;
  position: number;
  status_id: string;
  status_name: string;
  status_color: string;
}
export interface WorkflowConfig {
  project: { id: string; name: string };
  auto_complete_on_publish: boolean;
  roles: WorkflowRole[];
  members: WorkflowMember[];
  statuses: WorkflowStatus[];
  ratings: WorkflowRating[];
}

export interface ApprovalInfo {
  currentStatus: { id: string; name: string; color: string } | null;
  /** True when the current status is the first (initial) status → Submit, not Approve. */
  isFirstStatus: boolean;
  nextStatusId: string | null;
  statuses: { id: string; name: string; color: string; position: number; is_terminal: boolean }[];
  criteria: { id: string; name: string; description: string | null }[];
  /** Assignees of the current status + whether each has completed it. */
  assignees: { id: string; name: string; completed: boolean }[];
  /** Whether the caller (assigned) may approve on this review status. */
  canApprove: boolean;
  /** Whether the caller (assigned) may submit on this first status. */
  canSubmit: boolean;
  /** If the caller completes now, would they be the last → auto-check "send forward". */
  isLastToComplete: boolean;
}

export interface AssignmentStatus {
  id: string;
  name: string;
  color: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  read_only: boolean;
  reviewing_role_ids: string[];
  assignees: { id: string; name: string; completed: boolean; note: string | null }[];
  /** Shared per-status due date (ISO), or null. */
  due_at: string | null;
}
export interface AssignmentInfo {
  currentStatusId: string | null;
  statuses: AssignmentStatus[];
  members: { id: string; name: string; role_id: string; role_name: string }[];
}

export interface ItemVersion {
  id: string;
  kind: 'manual' | 'status_change' | 'auto';
  label: string | null;
  item_name: string;
  status_name: string | null;
  status_color: string | null;
  /** For status_change versions: the status the item moved from (null otherwise). */
  from_status_name: string | null;
  from_status_color: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_role: string | null;
}
export interface VersionDetail {
  id: string;
  item_id: string;
  kind: string;
  label: string | null;
  item_name: string;
  status_name: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  updated_at: string;
  tab_count: number;
  field_count: number;
  item_count: number;
}
export interface TemplateField {
  id: string;
  type: string;
  label: string;
  position: number;
  isSystem: boolean;
  isVisible: boolean;
  isRequired: boolean;
  guidelines?: string;
  isPlainText: boolean;
  recommendedLength?: number;
  recommendedLengthUnits?: string;
  choices: string[];
  defaultContent?: string;
}
export interface TemplateTab {
  id: string;
  name: string;
  position: number;
  isSystem: boolean;
  isHidden: boolean;
  fields: TemplateField[];
}
export interface TemplateDetail {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  tabs: TemplateTab[];
}

export const api = {
  getDashboard: (archived = false) =>
    request<Dashboard>(`/dashboard${archived ? '?archived=true' : ''}`),
  getProjectDashboard: (projectId: string) =>
    request<ProjectDashboard>(`/dashboard/project/${projectId}`),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  listUsers: () => request<OrgUser[]>('/users'),
  createProject: (name: string, memberIds: string[]) =>
    request<{ id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),
  renameProject: (id: string, name: string) =>
    request<{ ok: true }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  getProjectSettings: (id: string) => request<ProjectSettings>(`/projects/${id}`),
  setProjectMembers: (id: string, profileIds: string[]) =>
    request<{ ok: true }>(`/projects/${id}/members`, { method: 'PATCH', body: JSON.stringify({ profileIds }) }),
  archiveProject: (id: string) => request<{ ok: true }>(`/projects/${id}/archive`, { method: 'POST' }),
  restoreProject: (id: string) => request<{ ok: true }>(`/projects/${id}/restore`, { method: 'POST' }),
  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) =>
    request<{ id: string }>(`/projects/${id}/duplicate`, { method: 'POST' }),
  listItems: (projectId: string) =>
    request<ItemSummary[]>(`/content/items?projectId=${encodeURIComponent(projectId)}`),
  getItem: (id: string) => request<ApiItem>(`/content/items/${id}`),
  listTemplates: (projectId: string) =>
    request<{ id: string; name: string; is_default: boolean }[]>(
      `/content/templates?projectId=${encodeURIComponent(projectId)}`,
    ),
  createItem: (
    projectId: string,
    name: string,
    templateId: string | null,
    opts?: { description?: string; keywords?: string[] },
  ) =>
    request<{ id: string }>('/content/items', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        name,
        templateId,
        description: opts?.description ?? null,
        keywords: opts?.keywords ?? [],
      }),
    }),
  deleteItem: (id: string) =>
    request<{ ok: true }>(`/content/items/${id}`, { method: 'DELETE' }),
  renameItem: (id: string, name: string) =>
    request<{ ok: true }>(`/content/items/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateItemBrief: (id: string, patch: { name?: string; description?: string | null; keywords?: string[] }) =>
    request<{ ok: true }>(`/content/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  changeItemStatus: (id: string, statusId: string) =>
    request<{ ok: true }>(`/content/items/${id}/status`, { method: 'PATCH', body: JSON.stringify({ statusId }) }),
  claimItem: (id: string) =>
    request<{ ok: true }>(`/content/items/${id}/claim`, { method: 'POST' }),
  getApprovalInfo: (id: string) => request<ApprovalInfo>(`/content/items/${id}/approval`),
  approveItem: (
    id: string,
    body: { ratings: { ratingId: string; stars: number }[]; note: string | null; nextStatusId: string | null },
  ) => request<{ ok: true }>(`/content/items/${id}/approve`, { method: 'POST', body: JSON.stringify(body) }),
  submitItem: (id: string, body: { note: string | null; nextStatusId: string | null }) =>
    request<{ ok: true; advanced: boolean; isLast: boolean }>(`/content/items/${id}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  listVersions: (id: string) => request<ItemVersion[]>(`/content/items/${id}/versions`),
  saveVersion: (id: string, label?: string) =>
    request<{ id: string }>(`/content/items/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label: label ?? null }),
    }),
  getVersion: (versionId: string) => request<VersionDetail>(`/content/versions/${versionId}`),
  renameVersion: (versionId: string, label: string) =>
    request<{ ok: true }>(`/content/versions/${versionId}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  deleteVersion: (versionId: string) =>
    request<{ ok: true }>(`/content/versions/${versionId}`, { method: 'DELETE' }),
  copyVersionToItem: (versionId: string, name: string) =>
    request<{ id: string }>(`/content/versions/${versionId}/copy-to-item`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  restoreVersion: (id: string, versionId: string) =>
    request<{ ok: true }>(`/content/items/${id}/versions/${versionId}/restore`, { method: 'POST' }),
  getAssignmentInfo: (id: string) => request<AssignmentInfo>(`/content/items/${id}/assignment`),
  setStatusAssignees: (id: string, statusId: string, profileIds: string[], dueAt?: string | null) =>
    request<{ ok: true }>(`/content/items/${id}/statuses/${statusId}/assignees`, {
      method: 'PUT',
      body: JSON.stringify({ profileIds, dueAt: dueAt ?? null }),
    }),
  getWorkflow: (projectId: string) =>
    request<WorkflowConfig>(`/projects/${projectId}/workflow`),
  updateStatus: (
    statusId: string,
    patch: {
      name?: string;
      color?: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) =>
    request<{ ok: true }>(`/workflow/statuses/${statusId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  createStatus: (
    projectId: string,
    patch: {
      name: string;
      color: string;
      autoDueDays?: number | null;
      readOnly?: boolean;
      reviewingRoleIds?: string[];
    },
  ) =>
    request<{ id: string }>(`/projects/${projectId}/workflow/statuses`, {
      method: 'POST',
      body: JSON.stringify(patch),
    }),
  deleteStatus: (statusId: string) =>
    request<{ ok: true }>(`/workflow/statuses/${statusId}`, { method: 'DELETE' }),
  setDefaultAssignees: (statusId: string, profileIds: string[]) =>
    request<{ ok: true }>(`/workflow/statuses/${statusId}/default-assignees`, {
      method: 'PUT',
      body: JSON.stringify({ profileIds }),
    }),
  createRating: (projectId: string, patch: { name: string; description: string | null; statusId: string }) =>
    request<{ id: string }>(`/projects/${projectId}/workflow/ratings`, {
      method: 'POST',
      body: JSON.stringify(patch),
    }),
  updateRating: (
    ratingId: string,
    patch: { name?: string; description?: string | null; statusId?: string },
  ) =>
    request<{ ok: true }>(`/workflow/ratings/${ratingId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteRating: (ratingId: string) =>
    request<{ ok: true }>(`/workflow/ratings/${ratingId}`, { method: 'DELETE' }),
  listProjectTemplates: (projectId: string) =>
    request<TemplateSummary[]>(`/projects/${projectId}/templates`),
  getTemplate: (id: string) => request<TemplateDetail>(`/templates/${id}`),
  createTemplate: (projectId: string, name: string, description?: string | null) =>
    request<{ id: string }>(`/projects/${projectId}/templates`, {
      method: 'POST',
      body: JSON.stringify({ name, description: description ?? null }),
    }),
  duplicateTemplate: (id: string) =>
    request<{ id: string }>(`/templates/${id}/duplicate`, { method: 'POST' }),
  cloneTemplateToProject: (id: string, targetProjectId: string) =>
    request<{ id: string; projectId: string }>(`/templates/${id}/clone`, {
      method: 'POST',
      body: JSON.stringify({ targetProjectId }),
    }),
  updateTemplate: (id: string, patch: { name?: string; description?: string | null; isDefault?: boolean }) =>
    request<{ ok: true }>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTemplate: (id: string) => request<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' }),
  createField: (tabId: string, fieldType: string) =>
    request<{ id: string }>(`/template-tabs/${tabId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ fieldType }),
    }),
  updateField: (
    fieldId: string,
    patch: {
      label?: string;
      isVisible?: boolean;
      isRequired?: boolean;
      isPlainText?: boolean;
      recommendedLength?: number | null;
      recommendedLengthUnits?: string;
      guidelines?: string | null;
      choices?: string[];
      defaultContent?: string | null;
    },
  ) =>
    request<{ ok: true }>(`/template-fields/${fieldId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  moveField: (fieldId: string, direction: 'up' | 'down') =>
    request<{ ok: true }>(`/template-fields/${fieldId}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),
  deleteField: (fieldId: string) =>
    request<{ ok: true }>(`/template-fields/${fieldId}`, { method: 'DELETE' }),
  createTab: (templateId: string, name: string) =>
    request<{ id: string }>(`/templates/${templateId}/tabs`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateTab: (tabId: string, patch: { name?: string; isHidden?: boolean }) =>
    request<{ ok: true }>(`/template-tabs/${tabId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTab: (tabId: string) =>
    request<{ ok: true }>(`/template-tabs/${tabId}`, { method: 'DELETE' }),
  saveField: (itemId: string, fieldId: string, value: unknown, signal?: AbortSignal) =>
    request<{ ok: true }>(`/content/items/${itemId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
      signal,
    }),

  // Comments -----------------------------------------------------------------
  listComments: (itemId: string) =>
    request<ItemComment[]>(`/content/items/${itemId}/comments`),
  addComment: (itemId: string, input: NewComment) =>
    request<{ id: string }>(`/content/items/${itemId}/comments`, { method: 'POST', body: JSON.stringify(input) }),
  editComment: (id: string, body: string) =>
    request<{ ok: true }>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: string) =>
    request<{ ok: true }>(`/comments/${id}`, { method: 'DELETE' }),
  resolveComment: (id: string, resolved: boolean) =>
    request<{ ok: true }>(`/comments/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolved }) }),

  /* ---- project file library ---- */
  listFiles: (projectId: string) =>
    request<LibraryFile[]>(`/files?projectId=${encodeURIComponent(projectId)}`),
  listFileFolders: (projectId: string) =>
    request<string[]>(`/files/folders?projectId=${encodeURIComponent(projectId)}`),
  createUploadUrl: (projectId: string, name: string) =>
    request<{ path: string; token: string; signedUrl: string }>(`/files/upload-url`, {
      method: 'POST',
      body: JSON.stringify({ projectId, name }),
    }),
  recordFile: (input: {
    projectId: string; path: string; name: string;
    mime?: string | null; size?: number | null; folder?: string | null;
  }) => request<LibraryFile>(`/files`, { method: 'POST', body: JSON.stringify(input) }),
  moveFile: (id: string, folder: string | null) =>
    request<{ ok: true }>(`/files/${id}`, { method: 'PATCH', body: JSON.stringify({ folder }) }),
  deleteFile: (id: string) => request<{ ok: true }>(`/files/${id}`, { method: 'DELETE' }),

  /** The signed-in caller's own permission set, for hiding UI they can't use
   *  (the API still enforces the real gate; this just skips the dead end). */
  me: () => request<CurrentUser>('/auth/me'),

  /* ---- roles & permissions (Team → Roles) ---- */
  listPermissionsCatalogue: () => request<PermissionDef[]>('/permissions'),
  listRoles: () => request<Role[]>('/roles'),
  createRole: (name: string, description: string) =>
    request<{ id: string }>('/roles', { method: 'POST', body: JSON.stringify({ name, description }) }),
  updateRole: (id: string, patch: { name?: string; description?: string | null; isActive?: boolean }) =>
    request<{ ok: true }>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  setRolePermission: (id: string, key: string, on: boolean) =>
    request<{ ok: true }>(`/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ key, on }) }),
  reorderRoles: (order: { id: string; position: number }[]) =>
    request<{ ok: true }>('/roles/reorder', { method: 'PUT', body: JSON.stringify({ order }) }),
  duplicateRole: (id: string) => request<{ id: string }>(`/roles/${id}/duplicate`, { method: 'POST' }),
  deleteRole: (id: string) => request<{ ok: true }>(`/roles/${id}`, { method: 'DELETE' }),
};

/** The signed-in caller, as returned by GET /auth/me. */
export interface CurrentUser {
  userId: string;
  orgId: string;
  isOwner: boolean;
  roleId: string;
  permissions: string[];
}

/** One entry in the universal permission catalogue (grouped + ordered). */
export interface PermissionDef {
  key: string;
  group_name: string;
  label: string;
  description: string;
  position: number;
}

/** An org-wide role plus the permission keys it holds. */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  /** System roles (Admin, Writer) can't be deleted/deactivated. */
  is_system: boolean;
  /** Admin is not editable (name/permissions locked). */
  is_editable: boolean;
  position: number;
  permissions: string[];
}

/** A file in a project's library, as returned by the API (url is short-lived). */
export interface LibraryFile {
  id: string;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  folder: string | null;
  uploadedBy: string | null;
  uploadedByRole: string | null;
  linkedItems: { id: string; name: string }[];
  createdAt: string;
  /** 250px thumbnail URL for display (images); the original URL for other types. */
  url: string | null;
  /** The original file URL — download / full-size / inline data-full-name. */
  fullUrl: string | null;
}

/**
 * What a file/image field stores: a stable reference into the library plus
 * enough to render even if the fresh signed URL can't be resolved. The live
 * download URL is looked up from the library query at render time, never saved.
 */
export interface StoredFile {
  id: string;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
}
