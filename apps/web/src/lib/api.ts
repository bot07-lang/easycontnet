import { supabase } from './supabase';

/**
 * Thin client for the NestJS API. Attaches the current user's Supabase access
 * token as a bearer, which the API verifies and uses to enforce RLS.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

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
  is_terminal: boolean;
  mine: boolean;
  people: { name: string }[];
  next_due_date: string | null;
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
  itemNumber: number;
  name: string;
  status: { name: string; color: string } | null;
  tabs: { id: string; name: string; fields: ApiField[] }[];
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
export interface Dashboard {
  projects: DashboardProject[];
  myItems: DashboardMyItem[];
}

export interface OrgUser {
  id: string;
  full_name: string;
  role_name: string;
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

export const api = {
  getDashboard: (archived = false) =>
    request<Dashboard>(`/dashboard${archived ? '?archived=true' : ''}`),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  listUsers: () => request<OrgUser[]>('/users'),
  createProject: (name: string, memberIds: string[]) =>
    request<{ id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    }),
  renameProject: (id: string, name: string) =>
    request<{ ok: true }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
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
  setDefaultAssignees: (statusId: string, profileIds: string[]) =>
    request<{ ok: true }>(`/workflow/statuses/${statusId}/default-assignees`, {
      method: 'PUT',
      body: JSON.stringify({ profileIds }),
    }),
  saveField: (itemId: string, fieldId: string, value: unknown) =>
    request<{ ok: true }>(`/content/items/${itemId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};
