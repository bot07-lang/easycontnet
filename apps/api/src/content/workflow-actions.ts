/**
 * Pure workflow-action rules (EasyContent parity). No DB access — takes the
 * facts about a caller + the item's current status and decides which action
 * buttons are available and whether completing now would be the last one.
 *
 * EC rules encoded here:
 *  - Submit shows ONLY on the first workflow status, ONLY to assigned users.
 *  - Approve shows ONLY on later (review) statuses, ONLY to assigned users.
 *  - The LAST assignee to complete auto-sends the item forward; `isLastToComplete`
 *    is true when every OTHER assignee has already completed, so the caller's
 *    completion would be the final one.
 */
export interface WorkflowActionFacts {
  /** Is the item's current status the first (initial) status? */
  isFirstStatus: boolean;
  /** Is the caller assigned to the current status? */
  isAssigned: boolean;
  /** Has the caller ALREADY completed (submitted/approved) the current status? */
  meCompleted: boolean;
  /** Number of people assigned to the current status. */
  assigneeCount: number;
  /** Assignees OTHER than the caller who have already completed the status. */
  othersCompleted: number;
}

export interface WorkflowActions {
  canSubmit: boolean;
  canApprove: boolean;
  /** If the caller completes now, would they be the last assignee to do so? */
  isLastToComplete: boolean;
}

export function workflowActions(f: WorkflowActionFacts): WorkflowActions {
  // Once you've completed the current status your action hides — no re-submit
  // (matches EC: the option is gone after you've submitted).
  const canSubmit = f.isFirstStatus && f.isAssigned && !f.meCompleted;
  const canApprove = !f.isFirstStatus && f.isAssigned && !f.meCompleted;
  // Only I remain: everyone else assigned has completed already.
  const isLastToComplete =
    f.isAssigned && f.assigneeCount > 0 && f.assigneeCount - f.othersCompleted === 1;
  return { canSubmit, canApprove, isLastToComplete };
}
