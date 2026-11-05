import { genId } from '@/common/id';
import { deleteRecord, putRecord, readAll, readByIndex, readOne, type IdbSpec } from '@/io/storage/idb';
import type {
  CloudProjectRecord, ReviewCommentRecord, ReviewEventRecord, ReviewPackage, ReviewRole,
  ReviewStatus, ReviewVersionRecord,
} from '@/model';


const PROJECT_STORE = 'projects';
const VERSION_STORE = 'versions';
const COMMENT_STORE = 'comments';
const EVENT_STORE = 'events';
const USER_KEY = 'oc-review-user';

/** Stores whose records carry a `projectId` and are read by it. */
const PROJECT_SCOPED = [VERSION_STORE, COMMENT_STORE, EVENT_STORE] as const;

/** Index every project-scoped store is read by. */
const PROJECT_INDEX = 'projectId';

/**
 * Opened by `io/idb.ts`. Version 2 adds the `projectId` index to the three scoped stores;
 * the check per store keeps the upgrade idempotent for databases created at version 1.
 */
const SPEC: IdbSpec = {
  name: 'oc-review',
  version: 2,
  upgrade: (db, tx) => {
    for (const store of [PROJECT_STORE, VERSION_STORE, COMMENT_STORE, EVENT_STORE]) {
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
    }
    for (const store of PROJECT_SCOPED) {
      const scoped = tx.objectStore(store);
      if (!scoped.indexNames.contains(PROJECT_INDEX)) scoped.createIndex(PROJECT_INDEX, PROJECT_INDEX);
    }
  },
};

/** Display name used for locally authored versions and comments. */
export function localReviewUser(): string {
  try {
    const name = localStorage.getItem(USER_KEY)?.trim();
    return name || '本机用户';
  } catch {
    return '本机用户';
  }
}

/** Stores the display name; blank input falls back to the default. */
export function setLocalReviewUser(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(USER_KEY, trimmed);
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Storage refusal leaves the default in place.
  }
}

/** Role the local user holds on a project: creator owns it, everyone else gets the shared role. */
export function roleForProject(project: CloudProjectRecord, user: string): ReviewRole {
  return project.owner === user ? 'owner' : project.sharedRole;
}

/** Reads the records of one project through the `projectId` index instead of scanning the store. */
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

const now = (): string => new Date().toISOString();
const versionId = (): string => genId('ver');

/** Cloud projects, newest update first. */
export async function listCloudProjects(): Promise<CloudProjectRecord[]> {
  return (await readAll<CloudProjectRecord>(SPEC, PROJECT_STORE))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One cloud project, or null when it is not stored locally. */
export async function getCloudProject(projectId: string): Promise<CloudProjectRecord | null> {
  return getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
}

/** Saves the current snapshot as a new cloud project with its first version. */
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

/** Appends a snapshot as the next version; null when the project is gone. */
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

/** Versions of one project, newest first. */
export async function listVersions(projectId: string): Promise<ReviewVersionRecord[]> {
  return (await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId))
    .sort((a, b) => b.seq - a.seq);
}

/** Latest version of one project, or null when it has none. */
export async function latestVersion(projectId: string): Promise<ReviewVersionRecord | null> {
  const versions = await listVersions(projectId);
  return versions[0] ?? null;
}

/** Deletes a project together with its versions, comments and events. */
export async function deleteCloudProject(projectId: string): Promise<void> {
  const versions = await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId);
  const comments = await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId);
  const events = await readByProject<ReviewEventRecord>(EVENT_STORE, projectId);
  for (const version of versions) await remove(VERSION_STORE, version.id);
  for (const comment of comments) await remove(COMMENT_STORE, comment.id);
  for (const event of events) await remove(EVENT_STORE, event.id);
  await remove(PROJECT_STORE, projectId);
}

/** Updates the role granted to shared viewers. */
export async function setSharedRole(projectId: string, role: ReviewRole): Promise<void> {
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  if (project) await put(PROJECT_STORE, { ...project, sharedRole: role, updatedAt: now() });
}

/** Comments of one project, oldest first. */
export async function listComments(projectId: string): Promise<ReviewCommentRecord[]> {
  return (await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Adds one comment anchored to a selection row, or to the whole project when the anchor is blank. */
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

/** Marks a comment resolved or open again. */
export async function setCommentResolved(commentId: string, resolved: boolean): Promise<void> {
  const comment = await getOne<ReviewCommentRecord>(COMMENT_STORE, commentId);
  if (comment) await put(COMMENT_STORE, { ...comment, resolved });
}

/** Appends a reply to one comment and returns the updated record. */
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

/** Deletes one comment. */
export async function deleteComment(commentId: string): Promise<void> {
  await remove(COMMENT_STORE, commentId);
}

/** Status changes of one project, newest first. */
export async function listReviewEvents(projectId: string): Promise<ReviewEventRecord[]> {
  return (await readByProject<ReviewEventRecord>(EVENT_STORE, projectId))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Moves a project to a new review stage and records the change; null when unchanged. */
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

/** Review package with the latest snapshot, comments and status trail. */
export async function exportReviewPackage(projectId: string, author: string): Promise<ReviewPackage | null> {
  const project = await getOne<CloudProjectRecord>(PROJECT_STORE, projectId);
  const latest = (await readByProject<ReviewVersionRecord>(VERSION_STORE, projectId))
    .sort((a, b) => b.seq - a.seq)[0];
  if (!project || !latest) return null;
  return {
    format: 'opencloth-review',
    version: 1,
    exportedAt: now(),
    exportedBy: author,
    project,
    snapshot: latest.json,
    comments: await readByProject<ReviewCommentRecord>(COMMENT_STORE, projectId),
    events: await readByProject<ReviewEventRecord>(EVENT_STORE, projectId),
  };
}

/** Imports a review package as a new local cloud project and returns its record. */
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
