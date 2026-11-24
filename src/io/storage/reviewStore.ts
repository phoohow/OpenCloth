import type {
  CloudProjectRecord, ReviewCommentRecord, ReviewEventRecord, ReviewPackage, ReviewRole,
  ReviewStatus, ReviewVersionRecord,
} from '@/model';

import { genId } from '@/base/id';
import { deleteRecord, putRecord, readAll, readByIndex, readOne, type IdbSpec } from '@/io/storage/idb';

const PROJECT_STORE = 'projects';

const VERSION_STORE = 'versions';

const COMMENT_STORE = 'comments';

const EVENT_STORE = 'events';

const USER_KEY = 'oc-review-user';

const PROJECT_SCOPED = [VERSION_STORE, COMMENT_STORE, EVENT_STORE] as const;

const PROJECT_INDEX = 'projectId';

const SPEC: IdbSpec = {
  name: 'oc-review',
  upgrade: (db, tx) => {
    for (const store of [PROJECT_STORE, VERSION_STORE, COMMENT_STORE, EVENT_STORE]) {
      db.createObjectStore(store, { keyPath: 'id' });
    }

    for (const store of PROJECT_SCOPED) {
      tx.objectStore(store).createIndex(PROJECT_INDEX, PROJECT_INDEX);
    }
  },
};

const now = (): string => new Date().toISOString();

const versionId = (): string => genId('ver');

export function localReviewUser(): string {
  try {
    const name = localStorage.getItem(USER_KEY)?.trim();
    return name || '本机用户';
  } catch {
    return '本机用户';
  }
}

export function setLocalReviewUser(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(USER_KEY, trimmed);
    else localStorage.removeItem(USER_KEY);
  } catch {
  }
}

export function roleForProject(project: CloudProjectRecord, user: string): ReviewRole {
  return project.owner === user ? 'owner' : project.sharedRole;
}

function readByProject<T>(store: string, projectId: string): Promise<T[]> {
  return readByIndex<T>(SPEC, store, PROJECT_INDEX, projectId);
}

function getOne<T>(store: string, key: string): Promise<T | null> {
  return readOne<T>(SPEC, store, key);
}

function put<T extends { id: string }>(store: string, value: T): Promise<void> {
  return putRecord(SPEC, store, value);
}

function remove(store: string, key: string): Promise<void> {
  return deleteRecord(SPEC, store, key);
}

export async function listCloudProjects(): Promise<CloudProjectRecord[]> {
  return (await readAll<CloudProjectRecord>(SPEC, PROJECT_STORE))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCloudProject(projectId: string): Promise<CloudProjectRecord | null> {
  return getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
}

export async function createCloudProject(
  name: string, snapshot: string, author: string, sharedRole: ReviewRole = 'reviewer',
): Promise<CloudProjectRecord> {
  const at = now();
  const project: CloudProjectRecord = {
    id: genId('cloud'),
    name: name.trim() || '未命名审版项目',
    owner: author,
    createdAt: at,
    updatedAt: at,
    status: 'draft',
    sharedRole,
    latestSeq: 1,
    versionCount: 1,
  };
  const version: ReviewVersionRecord = {
    id: versionId(), projectId: project.id, seq: 1, label: '初始版本', author, createdAt: at, json: snapshot,
  };
  await put(PROJECT_STORE, project);
  await put(VERSION_STORE, version);
  return project;
}

export async function appendVersion(
  projectId: string, snapshot: string, label: string, author: string,
): Promise<ReviewVersionRecord | null> {
  const at = now();
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  if (!project) return null;
  const seq = project.latestSeq + 1;
  const version: ReviewVersionRecord = {
    id: versionId(), projectId, seq, label: label.trim() || `版本 ${seq}`, author, createdAt: at, json: snapshot,
  };
  await put(VERSION_STORE, version);
  await put(PROJECT_STORE, {
    ...project, latestSeq: seq, versionCount: project.versionCount + 1, updatedAt: at,
  });
  return version;
}

export async function listVersions(projectId: string): Promise<ReviewVersionRecord[]> {
  return (await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId))
    .sort((a, b) => b.seq - a.seq);
}

export async function deleteCloudProject(projectId: string): Promise<void> {
  const versions = await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId);
  const comments = await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId);
  const events = await readByProject<ReviewEventRecord>(EVENT_STORE, projectId);
  for (const version of versions) await remove(VERSION_STORE, version.id);
  for (const comment of comments) await remove(COMMENT_STORE, comment.id);
  for (const event of events) await remove(EVENT_STORE, event.id);
  await remove(PROJECT_STORE, projectId);
}

export async function setSharedRole(projectId: string, role: ReviewRole): Promise<void> {
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  if (project) await put(PROJECT_STORE, { ...project, sharedRole: role, updatedAt: now() });
}

export async function listComments(projectId: string): Promise<ReviewCommentRecord[]> {
  return (await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addComment(
  projectId: string, versionSeq: number, anchor: string, anchorLabel: string, body: string, author: string,
): Promise<ReviewCommentRecord> {
  const comment: ReviewCommentRecord = {
    id: genId('comment'),
    projectId,
    versionSeq,
    anchor,
    anchorLabel,
    body: body.trim(),
    author,
    createdAt: now(),
    resolved: false,
    replies: [],
  };
  await put(COMMENT_STORE, comment);
  return comment;
}

export async function setCommentResolved(commentId: string, resolved: boolean): Promise<void> {
  const comment = await getOne<ReviewCommentRecord>(COMMENT_STORE, commentId);
  if (comment) await put(COMMENT_STORE, { ...comment, resolved });
}

export async function addCommentReply(
  commentId: string, author: string, body: string,
): Promise<ReviewCommentRecord | null> {
  const comment = await getOne<ReviewCommentRecord>(COMMENT_STORE, commentId);
  if (!comment) return null;
  const updated: ReviewCommentRecord = {
    ...comment,
    replies: [...comment.replies, { id: genId('reply'), author, body: body.trim(), createdAt: now() }],
  };
  await put(COMMENT_STORE, updated);
  return updated;
}

export async function deleteComment(commentId: string): Promise<void> {
  await remove(COMMENT_STORE, commentId);
}

export async function listReviewEvents(projectId: string): Promise<ReviewEventRecord[]> {
  return (await readByProject<ReviewEventRecord>(EVENT_STORE, projectId))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function recordReviewStatus(
  projectId: string, to: ReviewStatus, actor: string, note = '',
): Promise<ReviewEventRecord | null> {
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  if (!project || project.status === to) return null;
  const at = now();
  const event: ReviewEventRecord = {
    id: genId('event'), projectId, at, actor, from: project.status, to, note: note.trim(),
  };
  await put(EVENT_STORE, event);
  await put(PROJECT_STORE, { ...project, status: to, updatedAt: at });
  return event;
}

export async function exportReviewPackage(projectId: string, author: string): Promise<ReviewPackage | null> {
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  const latest = (await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId))
    .sort((a, b) => b.seq - a.seq)[0];
  if (!project || !latest) return null;
  return {
    format: 'opencloth-review',
    exportedAt: now(),
    exportedBy: author,
    project,
    snapshot: latest.json,
    comments: await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId),
    events: await readByProject<ReviewEventRecord>(EVENT_STORE, projectId),
  };
}

export async function importReviewPackage(pkg: ReviewPackage): Promise<CloudProjectRecord> {
  const at = now();
  const project: CloudProjectRecord = {
    ...pkg.project,
    id: genId('cloud'),
    createdAt: at,
    updatedAt: at,
    latestSeq: 1,
    versionCount: 1,
  };
  const version: ReviewVersionRecord = {
    id: versionId(), projectId: project.id, seq: 1, label: '导入的审版包', author: pkg.exportedBy, createdAt: at, json: pkg.snapshot,
  };
  const comments = pkg.comments.map((comment): ReviewCommentRecord => ({
    ...comment, id: genId('comment'), projectId: project.id, versionSeq: 1,
  }));
  const events = pkg.events.map((event): ReviewEventRecord => ({
    ...event, id: genId('event'), projectId: project.id,
  }));
  await put(PROJECT_STORE, project);
  await put(VERSION_STORE, version);
  for (const comment of comments) await put(COMMENT_STORE, comment);
  for (const event of events) await put(EVENT_STORE, event);
  return project;
}
