export const QUEUES = {
  extractUpload: 'extract-upload',
  notifyVersion: 'notify-version',
  rollupDaily: 'rollup-daily',
  export: 'export',
  retention: 'retention',
  categorise: 'categorise',
  billingRenewals: 'billing-renewals',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface NotifyVersionJob {
  receiptId: string;
  version: number;
  state: string;
}
export interface ExtractUploadJob {
  uploadId: string;
}
export interface ExportJob {
  exportId: string;
}
/** All fields optional: the cron job sends `{}` (every org, last 3 Amsterdam days). */
export interface RollupDailyJob {
  orgId?: string;
  from?: string;
  to?: string;
}

/** pg-boss lives in its own schema so audit_log stays append-only for every role (see DECISIONS.md). */
export const BOSS_SCHEMA = 'pgboss';
