-- Permission descriptions, verbatim from EasyContent's
-- "Complete guide to permissions" help article, so the Roles matrix "?" tooltip
-- shows EC's own wording. Permissions EC's article omits (billing, AI, credits,
-- AI prompt templates, account report) keep our existing descriptions.

update public.permissions p set description = v.description
from (values
  ('manage_projects', 'Create, rename, delete, and archive a project; View, restore, or delete an archived project; Assign or remove a user from a project through the project settings or via the project team widget; Configure the project''s email notification settings'),
  ('manage_users', 'Create, edit, or delete teams; Change a user''s name and email; Assign or remove users to a project via the Users page > Edit User; Add user notes; Change a user''s role; Trigger a password reset email for a user; Activate or deactivate a user; Delete a user from your account; Invite a user to your account; View guest users; View and cancel pending invites'),
  ('manage_roles', 'Create, edit, delete, duplicate, activate, and deactivate a role; Edit role permissions'),
  ('manage_integrations', 'View all website integrations; Create, regenerate, and delete an API key; Change an API key''s website URL; Add, edit, and delete webhook endpoints'),
  ('access_content_migration', 'Access the content migration tool and perform all actions within that tool'),
  ('manage_workflow', 'View, create, edit, and delete workflow statuses; Assign a workflow status to a role; View, create, edit, and delete a rating; Toggle additional workflow settings on or off'),
  ('manage_categories', 'View, create, edit, and delete a category'),
  ('manage_templates', 'View, create, edit, delete, and rename templates; Create, edit, and delete template tabs as well as hide and unhide system template tabs and fields; Add, reorder, and delete fields'),
  ('manage_structures', 'Add, edit, or remove a field in a content item that''s using a custom structure'),
  ('manage_asset_library', 'View the digital asset manager where they can manage all files in a project'),
  ('manage_people_and_deadlines', 'Assign, remove, or re-assign users to a brief or content item; Change or set a deadline; View reports regarding item assignment in the recent project activity widget'),
  ('manage_documentation', 'View, create, edit, and delete help articles and categories'),
  ('view_briefs', 'View all briefs in a project they''re assigned to'),
  ('manage_briefs', 'View all briefs; Create, edit, delete, import, and export briefs'),
  ('view_all_content_items', 'View all content items in a project they''re assigned to (read-only mode); View workflow status and assignments; View, resolve, reply to, and add comments'),
  ('manage_content_items', 'View all content items; Create a new content item; Convert a content item to a brief; Edit text, metadata, and custom fields; Change template, category, and workflow status'),
  ('publish_content', 'Publish an article directly to WordPress or other external CMS'),
  ('share_content', 'Able to generate a shareable link'),
  ('manage_comments', 'Able to edit, delete, resolve, and unresolve all comments in content items they have access to'),
  ('view_publishing_calendar', 'Access the publishing calendar'),
  ('view_communication_report', 'See everyone''s messages within the account, even on projects they''re not assigned to'),
  ('view_content_report', 'View and generate a content report chart for all projects within the account')
) as v(key, description)
where p.key = v.key;
