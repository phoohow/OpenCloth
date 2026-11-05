import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  dialogButton, dialogHint, dialogLabel, dialogMessage, dialogRoot, dialogSectionTitle,
  dialogTab, dialogTabActive, dialogTabs, dialogTitle,
} from './dialogStyles';
import type {
  CloudProjectRecord, ReviewCommentRecord, ReviewEventRecord, ReviewRole, ReviewVersionRecord,
} from '../../core/model/review';
import {
  REVIEW_ACTION_LABELS, REVIEW_ROLE_LABELS, REVIEW_STATUS_LABELS, canComment, canEditVersions,
  canPerform, isReviewPackage, nextReviewStatus, reviewShareLink, type ReviewAction,
} from '../../core/model/review';
import { parseElementNodeId, type PatternElementKind } from '../../core/model/elementRef';
import { downloadTextFile, projectCodec, readFileAsText } from '../../io/codec';
import {
  addComment, addCommentReply, appendVersion, createCloudProject, deleteCloudProject,
  deleteComment, exportReviewPackage, getCloudProject, importReviewPackage, listCloudProjects,
  listComments, listReviewEvents, listVersions, localReviewUser, recordReviewStatus,
  roleForProject, setCommentResolved, setLocalReviewUser, setSharedRole,
} from '../../io/reviewStore';
import { useProjectStore, useUIStore } from '../../store/stores';
import { openFilePicker } from '../modelImport';

/** Chinese labels for the element kinds a comment can anchor to. */
const ANCHOR_KIND_LABELS: Record<PatternElementKind, string> = {
  panel: '版片',
  point: '顶点',
  edge: '轮廓边',
  internal: '内部线',
  dart: '省道',
  seam: '缝合',
  notch: '刀口',
  annotation: '注释',
  measurement: '尺寸线',
  print: '印花',
  topstitch: '明线',
  trim: '辅料',
};

/** Human-readable description of the current selection, used as a comment anchor. */
function describeAnchor(row: string): string {
  if (!row) return '整个工程';
  const pattern = useProjectStore.getState().project.pattern;
  const element = parseElementNodeId(row);
  if (!element) return pattern.panels[row]?.name ?? row;
  if (element.kind === 'panel') return `版片 · ${pattern.panels[element.id]?.name ?? element.id}`;
  return `${ANCHOR_KIND_LABELS[element.kind]} · ${element.id}`;
}

/** Formats an ISO timestamp as a local date and time. */
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

 /** Cloud project list, version history, comments, sharing and the review workflow. */
export function ReviewDialog({ initialProjectId }: { initialProjectId: string | null }) {
  const [user, setUser] = useState(localReviewUser());
  const [projects, setProjects] = useState<CloudProjectRecord[]>([]);
  const [active, setActive] = useState<CloudProjectRecord | null>(null);
  const [versions, setVersions] = useState<ReviewVersionRecord[]>([]);
  const [comments, setComments] = useState<ReviewCommentRecord[]>([]);
  const [events, setEvents] = useState<ReviewEventRecord[]>([]);
  const [tab, setTab] = useState<'versions' | 'comments' | 'review'>('versions');
  const [newName, setNewName] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const role: ReviewRole = active ? roleForProject(active, user) : 'viewer';

  /** Re-reads one project and its review data without changing the visible tab. */
  const reload = useCallback(async (projectId: string) => {
    const [project, nextVersions, nextComments, nextEvents] = await Promise.all([
      getCloudProject(projectId), listVersions(projectId), listComments(projectId), listReviewEvents(projectId),
    ]);
    setActive(project);
    setVersions(nextVersions);
    setComments(nextComments);
    setEvents(nextEvents);
  }, []);

  // An empty list is a valid state; a refused store should not become an unhandled rejection.
  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listCloudProjects());
    } catch {
      setMessage('本机存储不可用，审版数据只在当前会话有效');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list: Awaited<ReturnType<typeof listCloudProjects>>;
      try {
        list = await listCloudProjects();
      } catch {
        if (!cancelled) setMessage('本机存储不可用，审版数据只在当前会话有效');
        return;
      }
      if (cancelled) return;
      setProjects(list);
      const target = initialProjectId && list.some(project => project.id === initialProjectId)
        ? initialProjectId
        : null;
      if (target) {
        await reload(target);
        if (!cancelled) setTab('versions');
      }
    })();
    return () => { cancelled = true; };
  }, [initialProjectId, reload]);

  /** Runs one asynchronous action with a busy flag and a failure message. */
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectProject = (projectId: string) => run(async () => {
    await reload(projectId);
    setTab('versions');
  });

  const createProject = () => run(async () => {
    const project = useProjectStore.getState().project;
    const created = await createCloudProject(
      newName.trim() || project.meta.name,
      projectCodec.encode(project),
      localReviewUser(),
    );
    setNewName('');
    await refreshProjects();
    await reload(created.id);
    setTab('versions');
    setMessage(`已保存审版项目「${created.name}」`);
  });

  const saveVersion = () => run(async () => {
    if (!active || !canEditVersions(role)) return;
    const project = useProjectStore.getState().project;
    const saved = await appendVersion(active.id, projectCodec.encode(project), versionLabel.trim(), localReviewUser());
    if (!saved) throw new Error('审版项目已不存在');
    setVersionLabel('');
    await reload(active.id);
    await refreshProjects();
    setMessage(`已保存版本 ${saved.seq}`);
  });

  const restoreVersion = (version: ReviewVersionRecord) => run(async () => {
    if (!active || !canEditVersions(role)) return;
    if (!confirm(`恢复版本 ${version.seq} 会替换当前编辑中的工程，继续？`)) return;
    const projectId = active.id;
    useProjectStore.getState().loadProject(projectCodec.decode(version.json));
    await appendVersion(projectId, version.json, `恢复自版本 ${version.seq}`, localReviewUser());
    await reload(projectId);
    await refreshProjects();
    setMessage(`已载入版本 ${version.seq}`);
  });

  const removeProject = () => run(async () => {
    if (!active || role !== 'owner') return;
    if (!confirm(`删除审版项目「${active.name}」及其全部版本与评论，继续？`)) return;
    await deleteCloudProject(active.id);
    setActive(null);
    setVersions([]);
    setComments([]);
    setEvents([]);
    await refreshProjects();
  });

  const changeRole = (next: ReviewRole) => run(async () => {
    if (!active || role !== 'owner') return;
    await setSharedRole(active.id, next);
    await reload(active.id);
  });

  const copyLink = () => run(async () => {
    if (!active) return;
    const link = reviewShareLink(location.origin, location.pathname, active.id);
    try {
      await navigator.clipboard.writeText(link);
      setMessage('共享链接已复制（仅本机浏览器可打开，跨设备请导出审版包）');
    } catch {
      window.prompt('复制共享链接', link);
    }
  });

  const exportPackage = () => run(async () => {
    if (!active) return;
    const pkg = await exportReviewPackage(active.id, localReviewUser());
    if (!pkg) throw new Error('审版项目还没有版本');
    downloadTextFile(`${active.name}-审版包.json`, JSON.stringify(pkg, null, 2), 'application/json');
    setMessage('审版包已下载');
  });

  const importPackage = () => run(async () => {
    const files = await openFilePicker('.json', false);
    const file = files?.[0];
    if (!file) return;
    const parsed: unknown = JSON.parse(await readFileAsText(file));
    if (!isReviewPackage(parsed)) throw new Error('不是 OpenCloth 审版包文件');
    const imported = await importReviewPackage(parsed);
    await refreshProjects();
    await reload(imported.id);
    setTab('versions');
    setMessage(`已导入「${imported.name}」`);
  });

  const addAnchorComment = () => run(async () => {
    if (!active || !canComment(role)) return;
    const body = commentBody.trim();
    if (!body) throw new Error('请输入评论内容');
    const selection = useUIStore.getState().selection;
    await addComment(active.id, active.latestSeq, selection[0] ?? '', describeAnchor(selection[0] ?? ''), body, localReviewUser());
    setCommentBody('');
    await reload(active.id);
  });

  const toggleComment = (comment: ReviewCommentRecord) => run(async () => {
    await setCommentResolved(comment.id, !comment.resolved);
    if (active) await reload(active.id);
  });

  const removeComment = (comment: ReviewCommentRecord) => run(async () => {
    await deleteComment(comment.id);
    if (active) await reload(active.id);
  });

  const reply = (comment: ReviewCommentRecord) => run(async () => {
    const body = (replyDrafts[comment.id] ?? '').trim();
    if (!body) return;
    await addCommentReply(comment.id, localReviewUser(), body);
    setReplyDrafts(drafts => ({ ...drafts, [comment.id]: '' }));
    if (active) await reload(active.id);
  });

  const performReview = (action: ReviewAction) => run(async () => {
    if (!active) return;
    const target = nextReviewStatus(active.status, action);
    if (!target || !canPerform(role, action)) return;
    await recordReviewStatus(active.id, target, localReviewUser(), reviewNote);
    setReviewNote('');
    await reload(active.id);
    await refreshProjects();
  });

  const selection = useUIStore(s => s.selection);
  const currentName = useProjectStore(s => s.project.meta.name);

  return (
    <div style={styles.root}>
      <div style={styles.title}>版本与审版</div>
      <div style={styles.topbar}>
        <span style={styles.topLabel}>我的身份</span>
        <input
          style={styles.userInput}
          value={user}
          onChange={e => { setUser(e.target.value); setLocalReviewUser(e.target.value); }}
          title="用于版本作者与评论署名；只保存在本机"
        />
        <span style={styles.topNote}>本地优先：数据保存在本浏览器，跨设备用共享链接或审版包。</span>
        {message && <span style={styles.message}>{message}</span>}
      </div>

      <div style={styles.columns}>
        <div style={styles.projectsPane}>
          <div style={styles.paneTitle}>项目</div>
          <div style={styles.createRow}>
            <input
              style={styles.input}
              placeholder={currentName}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              title="新建审版项目时使用的名称"
            />
            <button style={styles.primaryBtn} disabled={busy} onClick={createProject}>保存当前工程</button>
          </div>
          <div style={styles.projectList}>
            {projects.length === 0 && <div style={styles.hint}>还没有审版项目；先把当前工程保存为一个。</div>}
            {projects.map(project => (
              <div
                key={project.id}
                style={{ ...styles.projectRow, ...(active?.id === project.id ? styles.projectRowActive : null) }}
                onClick={() => void selectProject(project.id)}
              >
                <div style={styles.projectName}>{project.name}</div>
                <div style={styles.projectMeta}>
                  {REVIEW_STATUS_LABELS[project.status]} · v{project.latestSeq} · {project.versionCount} 个版本
                </div>
                <div style={styles.projectMeta}>{formatTime(project.updatedAt)}</div>
              </div>
            ))}
          </div>
          <button style={styles.secondaryBtn} disabled={busy} onClick={importPackage}>导入审版包…</button>
        </div>

        <div style={styles.detailPane}>
          {!active ? (
            <div style={styles.hint}>选择左侧项目，或把当前工程保存为新的审版项目。</div>
          ) : (
            <>
              <div style={styles.activeHeader}>
                <div style={styles.activeName}>{active.name}</div>
                <span style={styles.badge}>{REVIEW_STATUS_LABELS[active.status]}</span>
                <span style={styles.badge}>{REVIEW_ROLE_LABELS[role]}</span>
              </div>
              <div style={styles.summary}>
                所有者 {active.owner} · 最近更新 {formatTime(active.updatedAt)} · 当前 v{active.latestSeq}
              </div>

              <div style={styles.actions}>
                <input
                  style={styles.input}
                  placeholder="版本说明（选填）"
                  value={versionLabel}
                  onChange={e => setVersionLabel(e.target.value)}
                  disabled={!canEditVersions(role)}
                />
                <button style={styles.primaryBtn} disabled={busy || !canEditVersions(role)} onClick={saveVersion}>
                  保存新版本
                </button>
                <button style={styles.secondaryBtn} disabled={busy} onClick={copyLink}>复制共享链接</button>
                <button style={styles.secondaryBtn} disabled={busy} onClick={exportPackage}>导出审版包</button>
                {role === 'owner' && (
                  <button style={styles.dangerBtn} disabled={busy} onClick={removeProject}>删除项目</button>
                )}
              </div>
              <div style={styles.actions}>
                <span style={styles.actionsLabel}>共享权限</span>
                <select
                  style={styles.select}
                  value={active.sharedRole}
                  disabled={role !== 'owner'}
                  onChange={e => void changeRole(e.target.value as ReviewRole)}
                  title="打开共享链接或导入审版包的人获得的角色"
                >
                  <option value="reviewer">审版人（可评论与通过/退回）</option>
                  <option value="viewer">只读</option>
                </select>
              </div>

              <div style={styles.tabs}>
                {([
                  ['versions', `版本（${versions.length}）`],
                  ['comments', `评论（${comments.filter(c => !c.resolved).length} 待处理）`],
                  ['review', '审版流程'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    style={{ ...styles.tabBtn, ...(tab === key ? styles.tabBtnActive : null) }}
                    onClick={() => setTab(key)}
                  >{label}</button>
                ))}
              </div>

              {tab === 'versions' && (
                <div style={styles.list}>
                  {versions.length === 0 && <div style={styles.hint}>还没有版本。</div>}
                  {versions.map(version => (
                    <div key={version.id} style={styles.card}>
                      <div style={styles.cardHeader}>
                        <span style={styles.cardTitle}>v{version.seq} · {version.label}</span>
                        <span style={styles.cardMeta}>{version.author} · {formatTime(version.createdAt)} · {Math.round(version.json.length / 1024)} KB</span>
                      </div>
                      <div style={styles.cardActions}>
                        <button
                          style={styles.secondaryBtn}
                          disabled={busy || !canEditVersions(role)}
                          onClick={() => void restoreVersion(version)}
                        >恢复此版本</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'comments' && (
                <div style={styles.list}>
                  <div style={styles.card}>
                    <div style={styles.cardMeta}>
                      锚点：{selection.length > 0 ? describeAnchor(selection[0]!) : '整个工程'}
                      {selection.length > 0 && <span style={styles.selectionNote}>（在 2D / 3D 中选择对象即可改变锚点）</span>}
                    </div>
                    <textarea
                      style={styles.textarea}
                      placeholder="写下修改意见…"
                      value={commentBody}
                      onChange={e => setCommentBody(e.target.value)}
                      disabled={!canComment(role)}
                    />
                    <button style={styles.primaryBtn} disabled={busy || !canComment(role)} onClick={addAnchorComment}>
                      添加评论
                    </button>
                  </div>
                  {comments.length === 0 && <div style={styles.hint}>还没有评论。</div>}
                  {comments.map(comment => (
                    <div key={comment.id} style={{ ...styles.card, ...(comment.resolved ? styles.cardResolved : null) }}>
                      <div style={styles.cardHeader}>
                        <span style={styles.cardTitle}>{comment.anchorLabel}</span>
                        <span style={styles.cardMeta}>{comment.author} · {formatTime(comment.createdAt)} · v{comment.versionSeq}{comment.resolved ? ' · 已解决' : ''}</span>
                      </div>
                      <div style={styles.commentBody}>{comment.body}</div>
                      <div style={styles.cardActions}>
                        {comment.anchor && (
                          <button style={styles.secondaryBtn} onClick={() => useUIStore.getState().select([comment.anchor])}>
                            定位
                          </button>
                        )}
                        <button style={styles.secondaryBtn} disabled={busy || !canComment(role)} onClick={() => void toggleComment(comment)}>
                          {comment.resolved ? '重新打开' : '标记解决'}
                        </button>
                        <button style={styles.dangerBtn} disabled={busy || role === 'viewer'} onClick={() => void removeComment(comment)}>删除</button>
                      </div>
                      {comment.replies.length > 0 && (
                        <div style={styles.replies}>
                          {comment.replies.map(replyItem => (
                            <div key={replyItem.id} style={styles.reply}>
                              <span style={styles.replyAuthor}>{replyItem.author}</span>
                              <span>{replyItem.body}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {canComment(role) && (
                        <div style={styles.replyRow}>
                          <input
                            style={styles.input}
                            placeholder="回复…"
                            value={replyDrafts[comment.id] ?? ''}
                            onChange={e => setReplyDrafts(drafts => ({ ...drafts, [comment.id]: e.target.value }))}
                          />
                          <button style={styles.secondaryBtn} disabled={busy} onClick={() => void reply(comment)}>回复</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'review' && (
                <div style={styles.list}>
                  <div style={styles.card}>
                    <div style={styles.cardMeta}>
                      当前阶段：{REVIEW_STATUS_LABELS[active.status]}　我的角色：{REVIEW_ROLE_LABELS[role]}
                    </div>
                    <input
                      style={styles.input}
                      placeholder="审版意见（随状态变更记录）"
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                      disabled={role === 'viewer'}
                    />
                    <div style={styles.cardActions}>
                      {(['submit', 'approve', 'requestChanges', 'reopen'] as ReviewAction[]).map(action => {
                        const target = nextReviewStatus(active.status, action);
                        const enabled = target !== null && canPerform(role, action);
                        return (
                          <button
                            key={action}
                            style={action === 'requestChanges' ? styles.dangerBtn : styles.primaryBtn}
                            disabled={busy || !enabled}
                            onClick={() => void performReview(action)}
                          >{REVIEW_ACTION_LABELS[action]}</button>
                        );
                      })}
                    </div>
                  </div>
                  {events.length === 0 && <div style={styles.hint}>还没有审版记录。</div>}
                  {events.map(event => (
                    <div key={event.id} style={styles.card}>
                      <div style={styles.cardHeader}>
                        <span style={styles.cardTitle}>
                          {REVIEW_STATUS_LABELS[event.from]} → {REVIEW_STATUS_LABELS[event.to]}
                        </span>
                        <span style={styles.cardMeta}>{event.actor} · {formatTime(event.at)}</span>
                      </div>
                      {event.note && <div style={styles.commentBody}>{event.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: dialogRoot,
  title: dialogTitle,
  topbar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 'var(--oc-fs-micro)' },
  topLabel: dialogLabel,
  userInput: { width: 130, padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  topNote: { color: '#777' },
  message: { ...dialogMessage, marginLeft: 'auto' },
  columns: { display: 'flex', gap: 12, flex: 1, minHeight: 0 },
  projectsPane: { width: 270, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 },
  paneTitle: dialogSectionTitle,
  createRow: { display: 'flex', gap: 4 },
  projectList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid #333', borderRadius: 4, padding: 4 },
  projectRow: { padding: '6px 8px', borderRadius: 3, cursor: 'pointer', background: '#26262b' },
  projectRowActive: { background: '#2a3a4a', border: '1px solid #4da6ff' },
  projectName: { color: '#ddd', fontSize: 'var(--oc-fs-micro)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  projectMeta: { color: '#777', fontSize: 'var(--oc-fs-note)', marginTop: 2 },
  detailPane: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'hidden' },
  activeHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  activeName: { color: '#fff', fontSize: 'var(--oc-fs-dialog-title)' },
  badge: { padding: '1px 6px', background: '#2a3a4a', border: '1px solid #3d6f9e', borderRadius: 3, color: '#9fd4ff', fontSize: 'var(--oc-fs-note)' },
  summary: { color: '#888', fontSize: 'var(--oc-fs-micro)' },
  actions: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  actionsLabel: dialogLabel,
  input: { flex: 1, minWidth: 110, padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  select: { padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  tabs: dialogTabs,
  tabBtn: dialogTab(10),
  tabBtnActive: dialogTabActive,
  list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  card: { background: '#26262b', border: '1px solid #333', borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 },
  cardResolved: { opacity: 0.65 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' },
  cardTitle: { color: '#ddd', fontSize: 'var(--oc-fs-micro)' },
  cardMeta: { color: '#777', fontSize: 'var(--oc-fs-note)' },
  cardActions: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  commentBody: { color: '#ccc', fontSize: 'var(--oc-fs-micro)', whiteSpace: 'pre-wrap' },
  replies: { display: 'flex', flexDirection: 'column', gap: 3, borderLeft: '2px solid #3a3a42', paddingLeft: 6 },
  reply: { display: 'flex', gap: 6, fontSize: 'var(--oc-fs-note)', color: '#aaa' },
  replyAuthor: { color: '#8ab4d8' },
  replyRow: { display: 'flex', gap: 4 },
  textarea: { minHeight: 52, padding: '4px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)', resize: 'vertical' },
  selectionNote: { color: '#666' },
  hint: dialogHint(6),
  primaryBtn: dialogButton('primary'),
  secondaryBtn: dialogButton('secondary'),
  dangerBtn: dialogButton('danger'),
};
