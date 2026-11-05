/** Review stage of a cloud project. */
export type ReviewStatus = 'draft' | 'inReview' | 'approved' | 'changesRequested';

/** What a viewer of a shared project may do. */
export type ReviewRole = 'owner' | 'reviewer' | 'viewer';

/** State-changing review actions. */
export type ReviewAction = 'submit' | 'approve' | 'requestChanges' | 'reopen';

/** Chinese labels shown for each review stage. */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: '草稿',
  inReview: '审版中',
  approved: '已通过',
  changesRequested: '退回修改',
};

/** Chinese labels shown for each role. */
export const REVIEW_ROLE_LABELS: Record<ReviewRole, string> = {
  owner: '所有者',
  reviewer: '审版人',
  viewer: '只读',
};

/** Chinese labels for the review actions. */
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

/** Target status of one action, or null when the current stage does not allow it. */
export function nextReviewStatus(status: ReviewStatus, action: ReviewAction): ReviewStatus | null {
  return TRANSITIONS[status][action] ?? null;
}

/** Actions each role may take; the owner keeps every action. */
const ROLE_ACTIONS: Record<ReviewRole, ReviewAction[]> = {
  owner: ['submit', 'approve', 'requestChanges', 'reopen'],
  reviewer: ['approve', 'requestChanges'],
  viewer: [],
};

/** Whether a role may take the action at all; the stage check comes from `nextReviewStatus`. */
export function canPerform(role: ReviewRole, action: ReviewAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

/** Whether a role may add comments and replies. */
export function canComment(role: ReviewRole): boolean {
  return role !== 'viewer';
}

/** Whether a role may save or restore project versions. */
export function canEditVersions(role: ReviewRole): boolean {
  return role === 'owner';
}

/** One saved snapshot of a cloud project. */
export interface ReviewVersionRecord {
  id: string;
  projectId: string;
  /** One-based sequence number within the project. */
  seq: number;
  label: string;
  author: string;
  createdAt: string;
  /** Encoded `.ocproj.json` payload. */
  json: string;
}

/** A saved cloud project without its snapshot payload. */
export interface CloudProjectRecord {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  /** Role granted to whoever opens the shared link or imports the review package. */
  sharedRole: ReviewRole;
  /** Sequence number of the latest version. */
  latestSeq: number;
  versionCount: number;
}

/** One reply under a review comment. */
export interface ReviewReplyRecord {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

/** One review comment, anchored to a selection row or to the whole project. */
export interface ReviewCommentRecord {
  id: string;
  projectId: string;
  /** Version sequence the comment was written against. */
  versionSeq: number;
  /** Selection row (`@kind:id` or a panel id); empty anchors the whole project. */
  anchor: string;
  /** Human-readable anchor, captured so a deleted element still reads sensibly. */
  anchorLabel: string;
  body: string;
  author: string;
  createdAt: string;
  resolved: boolean;
  replies: ReviewReplyRecord[];
}

/** One status change in the audit trail. */
export interface ReviewEventRecord {
  id: string;
  projectId: string;
  at: string;
  actor: string;
  from: ReviewStatus;
  to: ReviewStatus;
  note: string;
}

/** Cross-device transfer format for one cloud project and its review data. */
export interface ReviewPackage {
  format: 'opencloth-review';
  version: 1;
  exportedAt: string;
  exportedBy: string;
  project: CloudProjectRecord;
  /** Current project snapshot, encoded as `.ocproj.json`. */
  snapshot: string;
  comments: ReviewCommentRecord[];
  events: ReviewEventRecord[];
}

/** Review link for one project inside the current origin. */
export function reviewShareLink(origin: string, pathname: string, projectId: string): string {
  return `${origin}${pathname}#review=${encodeURIComponent(projectId)}`;
}

/** True when the parsed JSON is a review package this app can import. */
export function isReviewPackage(value: unknown): value is ReviewPackage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ReviewPackage>;
  if (record.format !== 'opencloth-review' || record.version !== 1) return false;
  if (typeof record.snapshot !== 'string' || !record.project || typeof record.project !== 'object') return false;
  return Array.isArray(record.comments) && Array.isArray(record.events);
}
