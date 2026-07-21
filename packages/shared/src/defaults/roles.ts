/**
 * The default roles every new organization starts with.
 *
 * These are PRODUCT decisions, not schema, so they live here rather than baked
 * into a SQL function — changing a role name or moving one permission should
 * be a code review, not a database migration.
 *
 * EasyContent publishes only two of these cells (Admin holds all account
 * permissions; manage_comments defaults on for Admin and Content Manager). The
 * rest is our judgement, informed by a real account's Roles screen.
 *
 * Defaults start RESTRICTIVE. Loosening a permission is one tick in the UI;
 * tightening one rarely occurs to anyone once a team is used to the access.
 */

import { ALL_PERMISSIONS, PERMISSIONS as P, type Permission } from '../permissions.js';

export interface RoleDefinition {
  name: string;
  description: string;
  /** Sparse steps so a role can be dragged between two others in one update. */
  position: number;
  /** System roles cannot be deleted. */
  isSystem: boolean;
  /** Uneditable roles cannot have their permissions changed — this is what
   *  stops an org stripping Admin and locking itself out. */
  isEditable: boolean;
  /** The role given to the org's owner at creation. Exactly one. */
  isOwnerRole?: boolean;
  permissions: readonly Permission[];
}

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    name: 'Admin',
    description: 'Full access to the account.',
    position: 1024,
    isSystem: true,
    isEditable: false,
    isOwnerRole: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: 'Content Manager',
    description: 'Runs content operations across projects.',
    position: 2048,
    isSystem: false,
    isEditable: true,
    permissions: [
      P.MANAGE_PROJECTS,
      P.MANAGE_USERS,
      P.USE_AI_FEATURES,
      P.MANAGE_WORKFLOW,
      P.MANAGE_CATEGORIES,
      P.MANAGE_TEMPLATES,
      P.MANAGE_STRUCTURES,
      P.MANAGE_ASSET_LIBRARY,
      P.MANAGE_PEOPLE_AND_DEADLINES,
      P.MANAGE_DOCUMENTATION,
      P.VIEW_BRIEFS,
      P.MANAGE_BRIEFS,
      P.VIEW_ALL_CONTENT_ITEMS,
      P.MANAGE_CONTENT_ITEMS,
      P.PUBLISH_CONTENT,
      P.SHARE_CONTENT,
      P.MANAGE_COMMENTS,
      P.VIEW_PUBLISHING_CALENDAR,
      P.VIEW_COMMUNICATION_REPORT,
      P.VIEW_ACCOUNT_REPORT,
      P.VIEW_CONTENT_REPORT,
    ],
  },
  {
    name: 'Editor',
    description: 'Edits and reviews content within assigned projects.',
    position: 3072,
    isSystem: false,
    isEditable: true,
    // No MANAGE_WORKFLOW: changing the status ladder is structural, above an
    // editor's remit. No PUBLISH_CONTENT: shipping is a separate call.
    permissions: [
      P.USE_AI_FEATURES,
      P.MANAGE_CATEGORIES,
      P.MANAGE_TEMPLATES,
      P.MANAGE_STRUCTURES,
      P.MANAGE_ASSET_LIBRARY,
      P.MANAGE_PEOPLE_AND_DEADLINES,
      P.MANAGE_DOCUMENTATION,
      P.VIEW_BRIEFS,
      P.MANAGE_BRIEFS,
      P.VIEW_ALL_CONTENT_ITEMS,
      P.MANAGE_CONTENT_ITEMS,
      P.SHARE_CONTENT,
      P.MANAGE_COMMENTS,
      P.VIEW_PUBLISHING_CALENDAR,
      P.VIEW_CONTENT_REPORT,
    ],
  },
  {
    name: 'Subject Matter Expert',
    description: 'Reviews content for accuracy and leaves feedback.',
    position: 4096,
    isSystem: false,
    isEditable: true,
    // VIEW_ALL_CONTENT_ITEMS is read-only but carries comment rights, which is
    // exactly a reviewer's job.
    permissions: [P.VIEW_BRIEFS, P.VIEW_ALL_CONTENT_ITEMS, P.VIEW_PUBLISHING_CALENDAR],
  },
  {
    name: 'Writer',
    description: 'Claims briefs and drafts the content items assigned to them.',
    position: 5120,
    isSystem: true,
    isEditable: true,
    // Deliberately NO MANAGE_CONTENT_ITEMS. A writer edits the items they are
    // ASSIGNED to — gate 4 of the permission model, which needs no permission
    // at all. MANAGE_CONTENT_ITEMS would grant edit rights over every item in
    // the project regardless of assignment: reasonable for a small trusting
    // team, wrong as a shipped default.
    permissions: [
      P.USE_AI_FEATURES,
      P.MANAGE_ASSET_LIBRARY,
      P.VIEW_BRIEFS,
      P.VIEW_PUBLISHING_CALENDAR,
    ],
  },
];
