-- Make the content-files bucket public so download URLs are permanent (like the
-- reference product). This lets inline images be embedded directly in content
-- without a signed URL that expires, and lets HTML exports work when shared.
-- Files still aren't listable — only a holder of the unguessable object path can
-- reach a file.
--
-- Note: image transformation (the 250px on-the-fly thumbnails used for display)
-- is enabled at the project level in the Dashboard — Storage → Settings → "Enable
-- image transformation" — which is not expressible in SQL, so it lives there.
update storage.buckets set public = true where id = 'content-files';
