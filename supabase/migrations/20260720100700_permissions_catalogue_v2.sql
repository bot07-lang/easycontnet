-- Corrections to the permission catalogue, from a real EasyContent account's
-- Roles screen rather than their help article (which is incomplete).
--
-- Four permissions were missing, so the real total is 27, not 23. And
-- view_account_report is live in the product despite the docs saying
-- "coming soon".
--
-- Also adds ordering to roles: the Roles screen is drag-and-drop reorderable,
-- with Admin pinned first and not draggable.

insert into public.permissions (key, group_name, label, description, position) values
  ('manage_billing', 'account', 'Manage billing',
   'View and change the subscription, payment method and invoices.', 45),
  ('use_ai_features', 'account', 'Use AI features',
   'Generate and edit content with AI inside the editor.', 46),
  ('purchase_credits', 'account', 'Purchase credits',
   'Buy additional AI credit packs.', 47),
  ('manage_ai_prompt_templates', 'project', 'Manage AI prompt templates',
   'Create and edit reusable AI prompt presets for the project.', 85);

-- Live in the product; the help article is out of date.
update public.permissions
   set is_implemented = true
 where key = 'view_account_report';

-- Role ordering. Sparse steps so a role can be dragged between two others
-- without renumbering the whole list.
alter table public.roles
  add column position integer not null default 1024;

comment on column public.roles.position is
  'Display order on the Roles screen. Sparse steps (1024, 2048, ...) so reordering is a single update.';

create index roles_org_position_idx on public.roles (org_id, position);
