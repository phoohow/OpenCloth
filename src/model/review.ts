export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: '草稿',
  inReview: '审版中',
  approved: '已通过',
  changesRequested: '退回修改',
};

export const REVIEW_ROLE_LABELS: Record<ReviewRole, string> = {
  owner: '所有者',
  reviewer: '审版人',
  viewer: '只读',
};

export const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  submit: '提交审版',
  approve: '通过',
  requestChanges: '退回修改',
  reopen: '重新开启',
};

const TRANSITIONS: Record<ReviewStatus, Partial<Record<ReviewAction, ReviewStatus>>> = {
  draft: { submit: 'inReview' },
  inReview: { approve: 'approved', requestChanges: 'changesRequested' },
  approved: { reopen: 'inReview' },
  changesRequested: { submit: 'inReview' },
};

const ROLE_ACTIONS: Record<ReviewRole, ReviewAction[]> = {
  owner: ['submit', 'approve', 'requestChanges', 'reopen'],
  reviewer: ['approve', 'requestChanges'],
  viewer: [],
};

export type ReviewStatus = 'draft' | 'inReview' | 'approved' | 'changesRequested';

export type ReviewRole = 'owner' | 'reviewer' | 'viewer';

export type ReviewAction = 'submit' | 'approve' | 'requestChanges' | 'reopen';

export interface ReviewVersionRecord {
  id: string;
  projectId: string;
  seq: number;
  label: string;
  author: string;
  createdAt: string;
  json: string;
}

export interface CloudProjectRecord {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  sharedRole: ReviewRole;
  latestSeq: number;
  versionCount: number;
}

export interface ReviewReplyRecord {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewCommentRecord {
  id: string;
  projectId: string;
  versionSeq: number;
  anchor: string;
  anchorLabel: string;
  body: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  replies: ReviewReplyRecord[];
}

export interface ReviewEventRecord {
  id: string;
  projectId: string;
  at: string;
  actor: string;
  from: ReviewStatus;
  to: ReviewStatus;
  note: string;
}

export interface ReviewPackage {
  format: 'opencloth-review';
  exportedAt: string;
  exportedBy: string;
  project: CloudProjectRecord;
  snapshot: string;
  comments: ReviewCommentRecord[];
  events: ReviewEventRecord[];
}

export function nextReviewStatus(status: ReviewStatus, action: ReviewAction): ReviewStatus | null {
  return TRANSITIONS[status][action] ?? null;
}

export function canPerform(role: ReviewRole, action: ReviewAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

export function canComment(role: ReviewRole): boolean {
  return role !== 'viewer';
}

export function canEditVersions(role: ReviewRole): boolean {
  return role === 'owner';
}

export function reviewShareLink(origin: string, pathname: string, projectId: string): string {
  return `${origin}${pathname}#review=${encodeURIComponent(projectId)}`;
}

export function isReviewPackage(value: unknown): value is ReviewPackage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ReviewPackage>;
  if (record.format !== 'opencloth-review') return false;
  if (typeof record.snapshot !== 'string' || !record.project || typeof record.project !== 'object') return false;
  return Array.isArray(record.comments) && Array.isArray(record.events);
}
