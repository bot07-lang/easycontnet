import { supabase } from './supabase';
import { api, type LibraryFile } from './api';

const BUCKET = 'content-files';

/**
 * Upload a File/Blob and record it in the project's file library (a `project_files`
 * row) — so it shows in the Files section. Returns the new library file (permanent
 * public `url` thumbnail + `fullUrl` original). Used for pasted images, which become
 * real library files attached to the item.
 */
export async function uploadLibraryFile(projectId: string, blob: Blob, name: string): Promise<LibraryFile> {
  const { path, token } = await api.createUploadUrl(projectId, name);
  const type = blob.type || 'image/png';
  const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: type });
  if (up.error) throw up.error;
  return api.recordFile({ projectId, path, name, mime: type, size: blob.size, folder: null });
}

export interface DerivedImage {
  /** 250px preview URL — for small UI (e.g. a file card), NOT for embedding in
   *  content; callers must use `fullUrl` as the inline image's actual `src`. */
  url: string;
  /** Original (full-size) URL — the inline image's real `src` and its data-full-name. */
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
