/** Photo/PDF upload flow (v2 §13): presign → PUT to S3 → complete → poll status. Pure: api and timers are injected. */
import { ApiError, putToStorage, type Api } from './api.ts';
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from '@lr/schema';
import type { UploadContentType, UploadStatus } from './api-schemas.ts';

export function isUploadContentType(type: string): type is UploadContentType {
  return UPLOAD_CONTENT_TYPES.some((t) => t === type);
}

export type UploadStartError = 'unsupported_type' | 'too_large' | 'empty';

export function validateUploadFile(file: { type: string; size: number }): UploadStartError | null {
  if (file.size <= 0) return 'empty';
  if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
  return isUploadContentType(file.type) ? null : 'unsupported_type';
}

export type UploadApi = Pick<Api, 'createUpload' | 'completeUpload'>;

/** Returns the upload id once the server has been told the object is in storage. */
export async function uploadFile(api: UploadApi, file: Blob, fetchImpl?: typeof fetch): Promise<string> {
  const type = file.type;
  if (!isUploadContentType(type)) throw new ApiError(400, 'unsupported_type');
  const presigned = await api.createUpload(type, file.size);
  await putToStorage(presigned.uploadUrl, { 'content-type': type, ...presigned.headers }, file, fetchImpl);
  await api.completeUpload(presigned.uploadId);
  return presigned.uploadId;
}

export function isSettled(status: UploadStatus['status']): boolean {
  return status === 'done' || status === 'needs_review' || status === 'failed' || status === 'replaced';
}

export interface PollDeps {
  fetchStatus(): Promise<UploadStatus>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onStatus?(status: UploadStatus): void;
  timeoutMs?: number;
  intervalMs?: number;
}

/** Poll until the upload leaves `pending_upload`/`processing`. Returns null on timeout (the user can come back to /uploads/:id). */
export async function pollUpload(deps: PollDeps): Promise<UploadStatus | null> {
  const deadline = deps.now() + (deps.timeoutMs ?? 120_000);
  for (;;) {
    const status = await deps.fetchStatus();
    deps.onStatus?.(status);
    if (isSettled(status.status)) return status;
    if (deps.now() >= deadline) return null;
    await deps.sleep(deps.intervalMs ?? 1500);
  }
}
