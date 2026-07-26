/**
 * The workflow ladder a NEW project starts with.
 *
 * This is a starting point, never a constraint. Once a project exists it owns
 * its own statuses outright: anyone with `manage_workflow` can add, delete,
 * rename, recolour and reorder them, change which roles may act on each, set
 * auto-due days, and toggle read-only. Ladders are per-project and fully
 * independent — editing one project's workflow never affects another's.
 *
 * The database enforces only two structural rules:
 *   1. At most one entry status and one exit status per project.
 *   2. The ladder is linear, ordered by `position`. No branching.
 *
 * Colours are status IDENTITY, not deadline state. A content item's coloured
 * dot is simply its current status's colour.
 */

export interface WorkflowStatusDefinition {
  name: string;
  /** Hex, lowercase. Shown as the status dot and on every item in it. */
  color: string;
  /** Sparse steps so a status can be dragged between two others in one update. */
  position: number;
  /** Where items enter. Pinned first in the UI. */
  isInitial?: boolean;
  /** Where items come to rest. Pinned last; carries no reviewing roles. */
  isTerminal?: boolean;
  /** Days from entering this status until due. Null means no auto deadline. */
  autoDueDays?: number | null;
  /** Freezes items: nobody can edit them, whatever their permissions. */
  readOnly?: boolean;
  /** Role NAMES permitted to work on items here — gate 3. Resolved to ids at
   *  creation, so this stays readable and matches DEFAULT_ROLES. */
  reviewingRoles: readonly string[];
  /** Five-star criteria reviewers grade against when approving from this status. */
  ratings?: readonly { name: string; description?: string; position: number }[];
}

export const DEFAULT_WORKFLOW: readonly WorkflowStatusDefinition[] = [
  {
    name: 'Draft',
    color: '#ef4444',
    position: 1024,
    isInitial: true,
    reviewingRoles: ['Writer', 'Editor', 'Content Manager', 'Admin'],
  },
  {
    name: 'Editorial Review',
    color: '#eab308',
    position: 2048,
    reviewingRoles: ['Editor', 'Content Manager', 'Admin'],
    // Three default grading criteria, matching a real EasyContent account.
    ratings: [
      { name: 'Content/Value', position: 1024 },
      { name: 'Spelling/Grammar', position: 2048 },
      { name: 'Format/Structure', position: 3072 },
    ],
  },
  {
    name: 'Approved for Publishing',
    color: '#22c55e',
    position: 3072,
    reviewingRoles: ['Content Manager', 'Admin'],
  },
  {
    name: 'Completed',
    color: '#9ca3af',
    position: 4096,
    isTerminal: true,
    // Read-only by default (matching EasyContent): an item that has come to rest
    // is locked — it can be viewed but not edited.
    readOnly: true,
    // Empty by design, and enforced by the database: nobody works on an item
    // that has come to rest.
    reviewingRoles: [],
  },
];
