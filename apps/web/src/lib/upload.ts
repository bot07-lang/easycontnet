import { supabase } from './supabase';
import { api } from './api';

const BUCKET = 'content-files';

export interface DerivedImage {
  /** 250px thumbnail URL for inline display. */
  url: string;
  /** Original (full-size) URL — kept as the inline image's data-full-name. */
  fullUrl: string;
}

/**
 * Upload an edited/rotated image to storage and return its URLs, WITHOUT adding
 * it to the project file library (no `project_files` row) — so, like the
 * reference, edited images don't show up in the Files section; only originals
 * uploaded there do. URLs are built client-side from the storage path (the bucket
 * is public); the thumbnail uses Supabase's on-the-fly transform.
 */
export async function uploadDerivedImage(projectId: string, blob: Blob, name: string): Promise<DerivedImage> {
  const { path, token } = await api.createUploadUrl(projectId, name);
  const type = blob.type || 'image/png';
  const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: type });
  if (up.error) throw up.error;
  const store = supabase.storage.from(BUCKET);
  return {
    fullUrl: store.getPublicUrl(path).data.publicUrl,
    url: store.getPublicUrl(path, { transform: { width: 250, height: 250, resize: 'contain' } }).data.publicUrl,
  };
}
