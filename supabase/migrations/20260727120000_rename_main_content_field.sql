-- Rename the system body field label "Main content" -> "Content" on all existing
-- templates. New templates already seed it as "Content" (templates.service.ts).
-- Pure label rename: no field values or IDs change.
update public.template_fields
   set label = 'Content'
 where label = 'Main content'
   and is_system = true;
