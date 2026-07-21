/**
 * The permission vocabulary.
 *
 * These keys are a contract between the database and the application:
 * `role_permissions.permission_key` has a foreign key to `permissions.key`, so
 * a typo here is rejected by the database rather than silently granting
 * nothing. The catalogue rows live in a migration; this file mirrors them for
 * type safety and must stay in step (see the drift test).
 */

export const PERMISSION_GROUPS = ['account', 'project', 'briefs', 'content', 'reports'] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSIONS = {
  // Account
  MANAGE_PROJECTS: 'manage_projects',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  MANAGE_INTEGRATIONS: 'manage_integrations',
  ACCESS_CONTENT_MIGRATION: 'access_content_migration',
  MANAGE_BILLING: 'manage_billing',
  USE_AI_FEATURES: 'use_ai_features',
  PURCHASE_CREDITS: 'purchase_credits',

  // Project
  MANAGE_WORKFLOW: 'manage_workflow',
  MANAGE_CATEGORIES: 'manage_categories',
  MANAGE_TEMPLATES: 'manage_templates',
  MANAGE_AI_PROMPT_TEMPLATES: 'manage_ai_prompt_templates',
  MANAGE_STRUCTURES: 'manage_structures',
  MANAGE_ASSET_LIBRARY: 'manage_asset_library',
  MANAGE_PEOPLE_AND_DEADLINES: 'manage_people_and_deadlines',
  MANAGE_DOCUMENTATION: 'manage_documentation',

  // Briefs
  VIEW_BRIEFS: 'view_briefs',
  MANAGE_BRIEFS: 'manage_briefs',

  // Content
  VIEW_ALL_CONTENT_ITEMS: 'view_all_content_items',
  MANAGE_CONTENT_ITEMS: 'manage_content_items',
  PUBLISH_CONTENT: 'publish_content',
  SHARE_CONTENT: 'share_content',
  MANAGE_COMMENTS: 'manage_comments',

  // Reports
  VIEW_PUBLISHING_CALENDAR: 'view_publishing_calendar',
  VIEW_COMMUNICATION_REPORT: 'view_communication_report',
  VIEW_ACCOUNT_REPORT: 'view_account_report',
  VIEW_CONTENT_REPORT: 'view_content_report',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);
