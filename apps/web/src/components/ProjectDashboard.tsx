import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ProjectDashboardActivity,
  type ProjectDashboardFunnelSlice,
  type ProjectDashboardUtilization,
  type ProjectDashboardVelocity,
} from '../lib/api';
import { MemberAvatars, RenameDialog, formatActivity } from './AllProjects';
import { HoverTip } from './HoverTip';

/**
 * The per-project "Dashboard" tab: header + members, "My items" scoped to
 * this project, a recent status-change activity feed, the workflow funnel,
 * per-member item load, and average time-in-status. Mirrors the reference's
 * layout; "Recent Messages & Comments" stays an empty state until comments
 * exist (same reasoning as the All Projects page), and there's no "Manage
 * team" button — there's no API yet to add/remove a project member after
 * creation, so a button for it would just be dead.
 */
export function ProjectDashboard({
  projectId,
  onOpenItem,
}: {
  projectId: string;
  onOpenItem: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: () => api.getProjectDashboard(projectId),
  });

  if (isLoading) return <p className="p-8 text-slate-400">Loading…</p>;
  if (error) return <p className="p-8 text-red-600">Can’t reach the API. Is it running on :3001?</p>;
  if (!data) return null;

  const { project, myItems, recentActivity, workflowFunnel, teamUtilization, workflowVelocity } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4">
        <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
        <div className="flex items-center gap-4">
          <MemberAvatars members={project.members} max={8} />
          <button type="button" onClick={() => setRenaming(true)}
                  className="flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <IconGear /> SETTINGS
          </button>
        </div>
      </div>

      {renaming && (
        <RenameDialog
          project={project}
          onClose={() => setRenaming(false)}
          onDone={() => { setRenaming(false); qc.invalidateQueries({ queryKey: ['project-dashboard', projectId] }); }}
        />
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">My Items</h2>
        {myItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-400">
            No items assigned to you
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {myItems.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => onOpenItem(it.id)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">
                  {it.status_color && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.status_color }} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] text-slate-800">{it.name}</span>
                  {it.status_name && (
                    <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-0.5 text-[12px] text-slate-600">
                      {it.status_name}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Panel title="Recent activity">
          {recentActivity.length === 0 ? (
            <EmptyHint text="No status changes yet." />
          ) : (
            <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
              {recentActivity.map((a) => (
                <ActivityRow key={a.id} activity={a} onOpenItem={onOpenItem} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent Messages & Comments" hint="Mentions, replies, and comments across this project">
          <EmptyHint text="No messages or comments in the last 30 days." sub="Mentions, replies, and messages will appear here" />
        </Panel>

        <Panel title="Workflow funnel" hint="Share of items currently in each status">
          <FunnelList slices={workflowFunnel} />
        </Panel>

        <Panel title="Team utilization" hint="Items currently assigned to each member">
          <UtilizationList rows={teamUtilization} />
        </Panel>
      </div>

      <VelocityPanel rows={workflowVelocity} />
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        {hint && (
          <HoverTip label={hint}>
            <span className="grid h-4 w-4 place-items-center rounded-full text-[11px] text-slate-400">ⓘ</span>
          </HoverTip>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-sm text-slate-500">{text}</p>
      {sub && <p className="text-[13px] text-slate-400">{sub}</p>}
    </div>
  );
}

function ActivityRow({ activity, onOpenItem }: { activity: ProjectDashboardActivity; onOpenItem: (id: string) => void }) {
  return (
    <li className="py-3 text-[13px] leading-relaxed first:pt-0">
      <p className="mb-1 text-slate-400">{formatActivity(activity.created_at)}</p>
      <p className="text-slate-700">
        <span className="font-semibold text-slate-900">{activity.actor_name ?? 'Someone'}</span>
        {activity.actor_role && <span className="text-slate-500"> ({activity.actor_role})</span>} changed the status of{' '}
        <button type="button" onClick={() => onOpenItem(activity.item_id)}
                className="font-medium text-blue-600 hover:underline">
          {activity.item_name}
        </button>{' '}
        to <span className="font-semibold text-slate-900">{activity.to_status_name ?? '—'}</span>.
      </p>
    </li>
  );
}

function FunnelList({ slices }: { slices: ProjectDashboardFunnelSlice[] }) {
  if (slices.length === 0) return <EmptyHint text="No workflow statuses yet." />;
  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.id}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-slate-700">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="text-slate-500">{s.count} <span className="text-slate-400">({s.pct}%)</span></span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function UtilizationList({ rows }: { rows: ProjectDashboardUtilization[] }) {
  if (rows.length === 0) return <EmptyHint text="No members on this project yet." />;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.profile_id} className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: avatarColorFor(r.name) }}>
            {initialsFor(r.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-800">{r.name}</p>
            {r.role_name && <p className="truncate text-[12px] text-slate-400">{r.role_name}</p>}
          </div>
          <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[12px] font-medium text-slate-600">
            {r.items_count} items
          </span>
        </li>
      ))}
    </ul>
  );
}

function VelocityPanel({ rows }: { rows: ProjectDashboardVelocity[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-[15px] font-semibold text-slate-900">Workflow velocity</h3>
        <HoverTip label="Average time items spend in each status">
          <span className="grid h-4 w-4 place-items-center rounded-full text-[11px] text-slate-400">ⓘ</span>
        </HoverTip>
      </div>
      <p className="mb-3 text-[12px] text-slate-400">Last 30 days vs previous 30 days</p>
      {rows.length === 0 ? (
        <EmptyHint text="Not enough history yet." />
      ) : (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[12px] text-slate-400">
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Avg time<br />30 days</th>
              <th className="pb-2 font-medium">Previous<br />period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2">
                  <span className="flex items-center gap-2 text-slate-700">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
                    {r.name}
                  </span>
                </td>
                <td className="py-2 text-slate-700">{formatDuration(r.avgSeconds30d)}</td>
                <td className="py-2 text-slate-500">{formatDuration(r.avgSecondsPrev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// Mirrors AllProjects's avatarColor()/initials() — kept local since those
// aren't exported (the card avatars there work off a slightly different
// {name} shape than this panel's utilization rows).
function initialsFor(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function avatarColorFor(name: string): string {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
