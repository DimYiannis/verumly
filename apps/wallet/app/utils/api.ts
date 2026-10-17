/** buyer-api client. Pure: base URL, token source and fetch are injected so it runs in vitest and in the browser. */
import type { z } from 'zod';
import * as s from './api-schemas.ts';
import type { ReceiptFilters, UploadContentType } from './api-schemas.ts';
import type { profileBody as profileBodyT, splitCreateBody } from '@lr/schema';

export type Reaction = (typeof s.REACTIONS)[number];
/** What the client sends: defaults of the zod body are optional here. */
export type SplitInput = z.input<typeof splitCreateBody>;

/** `status` 0 means the request never got an answer (offline, DNS, CORS). */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface ApiOptions {
  baseUrl: string;
  getToken(): string | null;
  fetch?: typeof fetch;
}

interface Call {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
}

export function createApi(opts: ApiOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;

  async function send(path: string, call: Call): Promise<Response> {
    const url = new URL(path, opts.baseUrl);
    for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {};
    if (call.body !== undefined) headers['content-type'] = 'application/json';
    if (call.auth !== false) {
      const token = opts.getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await doFetch(url, { method: call.method ?? 'GET', headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) });
    } catch {
      throw new ApiError(0, 'network');
    }
    if (!res.ok) {
      const err: unknown = await res.json().catch(() => null);
      const code = typeof err === 'object' && err !== null && 'error' in err && typeof err.error === 'string' ? err.error : 'http_error';
      throw new ApiError(res.status, code);
    }
    return res;
  }

  async function json<T extends z.ZodType>(schema: T, path: string, call: Call = {}): Promise<z.infer<T>> {
    const res = await send(path, call);
    return schema.parse(await res.json());
  }

  return {
    resolveView: (receiptId: string, secret: string) => json(s.resolveView, '/v1/resolve/view', { method: 'POST', auth: false, body: { receiptId, secret } }),

    emailStart: async (email: string) => {
      await send('/v1/auth/email/start', { method: 'POST', auth: false, body: { email } });
    },
    emailVerify: (email: string, code: string) => json(s.sessionResult, '/v1/auth/email/verify', { method: 'POST', auth: false, body: { email, code } }),
    demoInfo: async (): Promise<{ enabled: boolean; email?: string; users?: Array<{ email: string; label: string }> }> => {
      try {
        return (await (await send('/v1/auth/demo', { auth: false })).json()) as { enabled: boolean; email?: string; users?: Array<{ email: string; label: string }> };
      } catch {
        return { enabled: false };
      }
    },
    demoLogin: (email?: string) => json(s.sessionResult, '/v1/auth/demo', { method: 'POST', auth: false, body: email ? { email } : undefined }),
    logout: async () => {
      await send('/v1/auth/logout', { method: 'POST' });
    },

    /** Resolves with the HTTP status (201 claimed, 200 already_yours); ApiError carries 404/409/410/401/0. */
    claim: async (receiptId: string, secret: string, source: 'qr' | 'link' = 'qr') => {
      const res = await send('/v1/me/claims', { method: 'POST', body: { receiptId, secret, source } });
      s.claimResult.parse(await res.json());
      return res.status;
    },

    listReceipts: (filters: ReceiptFilters & { cursor?: string; limit?: number }) => json(s.receiptList, '/v1/me/receipts', { query: { ...filters } }),
    getReceipt: (id: string) => json(s.receiptDetail, `/v1/me/receipts/${id}`),
    receiptPdf: async (id: string) => (await send(`/v1/me/receipts/${id}/pdf`, {})).blob(),

    createUpload: (contentType: UploadContentType, size: number) => json(s.presignResult, '/v1/me/uploads', { method: 'POST', body: { contentType, size } }),
    completeUpload: (id: string) => json(s.completeResult, `/v1/me/uploads/${id}/complete`, { method: 'POST' }),
    getUpload: (id: string) => json(s.uploadStatus, `/v1/me/uploads/${id}`),
    listUploads: (filters: { category?: string } = {}) => json(s.uploadList, '/v1/me/uploads', { query: { ...filters } }),
    /** the buyer's own category per line (`null` = let the rules decide again); allowed on done and needs_review uploads */
    setUploadCategories: (id: string, lines: Array<{ index: number; category: string | null }>) =>
      json(s.uploadStatus, `/v1/me/uploads/${id}/categories`, { method: 'PUT', body: { lines } }),
    /** the photo goes through buyer-api (bearer header), so the caller turns the blob into an object URL */
    uploadPhoto: async (id: string) => (await send(`/v1/me/uploads/${id}/photo`, {})).blob(),
    deleteUpload: async (id: string) => {
      await send(`/v1/me/uploads/${id}`, { method: 'DELETE' });
    },
    patchUpload: (id: string, corrections: { merchantName?: string; printedAt?: string; gross?: number; lines?: s.UploadDraft['lines'] }) =>
      json(s.uploadStatus, `/v1/me/uploads/${id}`, { method: 'PATCH', body: corrections }),
    acceptMatch: (id: string) => json(s.acceptMatchResult, `/v1/me/uploads/${id}/accept-match`, { method: 'POST' }),

    insights: () => json(s.insights, '/v1/me/insights'),
    getConsents: () => json(s.consentsResponse, '/v1/me/consents'),
    putConsents: (patch: Partial<s.Consents>) => json(s.consentsResponse, '/v1/me/consents', { method: 'PUT', body: patch }),
    vapidPublicKey: () => json(s.vapidResponse, '/v1/push/vapid-public-key', { auth: false }),
    addPushSubscription: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => json(s.pushSubscriptionResult, '/v1/me/push-subscriptions', { method: 'POST', body: sub }),
    removePushSubscription: async (id: string) => {
      await send(`/v1/me/push-subscriptions/${id}`, { method: 'DELETE' });
    },
    // social: profile, friends, invites
    getProfile: () => json(s.profile, '/v1/me/profile'),
    putProfile: (body: z.input<typeof profileBodyT>) => json(s.profile, '/v1/me/profile', { method: 'PUT', body }),
    getFriends: () => json(s.friendsResponse, '/v1/me/friends'),
    requestFriend: async (handle: string) => {
      const res = await send('/v1/me/friends/requests', { method: 'POST', body: { handle } });
      const body = (await res.json()) as { status?: string };
      return body.status === 'accepted' ? ('accepted' as const) : ('requested' as const);
    },
    acceptFriendRequest: async (requestId: string) => {
      await send(`/v1/me/friends/requests/${requestId}/accept`, { method: 'POST' });
    },
    declineFriendRequest: async (requestId: string) => {
      await send(`/v1/me/friends/requests/${requestId}/decline`, { method: 'POST' });
    },
    removeFriend: async (userId: string) => {
      await send(`/v1/me/friends/${userId}`, { method: 'DELETE' });
    },
    createInvite: () => json(s.inviteCreated, '/v1/me/invites', { method: 'POST' }),
    /** a fresh invite link for a guest slot nobody has joined yet (the earlier link stops working) */
    createGuestInvite: (splitId: string, shareId: string) => json(s.inviteCreated, `/v1/me/splits/${splitId}/shares/${shareId}/invite`, { method: 'POST' }),
    acceptInvite: (code: string) => json(s.inviteAcceptResult, '/v1/me/invites/accept', { method: 'POST', body: { code } }),

    // social: shares and reactions
    createShare: async (receiptId: string, friendId: string) => {
      const res = await send('/v1/me/shares', { method: 'POST', body: { receiptId, friendId } });
      return ((await res.json()) as { id: string }).id;
    },
    listShares: () => json(s.shareList, '/v1/me/shares'),
    getShare: (id: string) => json(s.shareDetail, `/v1/me/shares/${id}`),
    setReaction: async (shareId: string, emoji: Reaction | null) => {
      await send(`/v1/me/shares/${shareId}/reaction`, { method: 'PUT', body: { emoji } });
    },

    // social: splits and balances
    createSplit: (body: SplitInput) => json(s.splitDetail, '/v1/me/splits', { method: 'POST', body }),
    listSplits: () => json(s.splitList, '/v1/me/splits'),
    getSplit: (id: string) => json(s.splitDetail, `/v1/me/splits/${id}`),
    settleShare: (splitId: string, shareId: string, settled: boolean) =>
      json(s.splitDetail, `/v1/me/splits/${splitId}/shares/${shareId}/settled`, { method: 'PUT', body: { settled } }),
    deleteSplit: async (id: string) => {
      await send(`/v1/me/splits/${id}`, { method: 'DELETE' });
    },
    getBalances: () => json(s.balances, '/v1/me/balances'),
    // home summary and friends feed
    getHome: () => json(s.homeSummary, '/v1/me/home'),
    getActivity: () => json(s.activityFeed, '/v1/me/activity'),

    exportData: async () => (await send('/v1/me/export', {})).blob(),
    deleteAccount: async () => {
      await send('/v1/me', { method: 'DELETE' });
    },
  };
}

export type Api = ReturnType<typeof createApi>;

/** Upload bytes straight to the presigned S3 URL (not through buyer-api, so no bearer header). */
export async function putToStorage(url: string, headers: Record<string, string>, body: Blob, doFetch: typeof fetch = globalThis.fetch): Promise<void> {
  let res: Response;
  try {
    res = await doFetch(url, { method: 'PUT', headers, body });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, 'upload_failed');
}
