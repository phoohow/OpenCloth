import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useMenuStore } from '@/ui/menu/menuStore';
import { useProjectStore } from '@/store';
import { downloadTextFile } from '@/io/serialization';
import {
  buildPlmPackage, buildTechPackData, buildWebhookPayload, pomReportCsv, postWebhook,
} from '@/io/exporters';
import { bomCsv, buildBom } from '@/pattern';
import { buildPomTable } from '@/pattern/pom';
import { BomTable } from '@/ui/menu/bomTable';
import { OutputRail } from '@/ui/menu/outputRail';

/** Characters rendered before the preview stops; the download keeps the whole file. */
const MAX_PREVIEW = 200_000;

/** Byte size of the payload, printed as the last summary chip. */
function payloadSize(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

type IntegrationKind = 'plm' | 'bom' | 'pom' | 'api' | 'webhook';

const ITEMS: Array<{ kind: IntegrationKind; label: string; format: string }> = [
  { kind: 'plm', label: 'PLM', format: 'JSON' },
  { kind: 'bom', label: 'BOM', format: 'CSV' },
  { kind: 'pom', label: 'POM', format: 'CSV' },
  { kind: 'api', label: 'API', format: 'JSON' },
  { kind: 'webhook', label: '推送', format: 'POST' },
];

const API_DOC = {
  format: 'opencloth-api',
  version: '1.0',
  global: 'window.opencloth',
  methods: [
    { name: 'getProject', returns: 'Project', description: '当前工程的深拷贝' },
    { name: 'getProjectJson', returns: 'string', description: '.ocproj.json 文本' },
    { name: 'loadProjectJson', returns: 'void', description: '校验并载入工程 JSON' },
    { name: 'getSummary', returns: 'OpenClothSummary', description: '片数、缝数、材质数与尺码数' },
    { name: 'getPlmPackage', returns: 'PlmPackage', description: '与【导出 PLM 包】同一份数据' },
  ],
};

const API_SNIPPET = [
  'const project = window.opencloth.getProjectJson();',
  'const summary = window.opencloth.getSummary();',
  'const plm = window.opencloth.getPlmPackage();',
].join('\n');

const WEBHOOK_KEY = 'oc-integration-webhook';

interface WebhookConfig {
  endpoint: string;
  token: string;
}

/** Reads the saved webhook settings, falling back to empty values. */
function readWebhook(): WebhookConfig {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WEBHOOK_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Partial<WebhookConfig>;
      return { endpoint: record.endpoint ?? '', token: record.token ?? '' };
    }
  } catch {
    // Unreadable settings fall back to blank fields.
  }
  return { endpoint: '', token: '' };
}

/** Industrial hand-off: preview the PLM bundle, its CSVs, the API reference and the webhook body. */
export function IntegrationDialog() {
  const project = useProjectStore(s => s.project);
  const closeDialog = useMenuStore(s => s.closeDialog);
  const [kind, setKind] = useState<IntegrationKind>('plm');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = readWebhook();
    setEndpoint(saved.endpoint);
    setToken(saved.token);
  }, []);

  const techPack = useMemo(() => buildTechPackData(project), [project]);
  const bomRows = useMemo(() => buildBom(project), [project]);
  const pomTable = useMemo(() => buildPomTable(project), [project]);
  const plm = useMemo(() => buildPlmPackage(project), [project]);
  const payload = useMemo(() => buildWebhookPayload(project), [project]);

  const item = ITEMS.find(row => row.kind === kind) ?? ITEMS[0]!;

  /** File name, mime and body of the selected output; the webhook row reuses the body as its request. */
  const output = useMemo(() => {
    const name = project.meta.name;
    switch (kind) {
      case 'plm':
        return { filename: `${name}-PLM包.json`, mime: 'application/json', content: JSON.stringify(plm, null, 2) };
      case 'bom':
        return { filename: `${name}-物料清单.csv`, mime: 'text/csv;charset=utf-8', content: '\ufeff' + bomCsv(bomRows) };
      case 'pom':
        return { filename: `${name}-POM报告.csv`, mime: 'text/csv;charset=utf-8', content: '\ufeff' + pomReportCsv(name, pomTable) };
      case 'api':
        return { filename: `${name}-API说明.json`, mime: 'application/json', content: JSON.stringify(API_DOC, null, 2) };
      default:
        return { filename: `${name}-Webhook.json`, mime: 'application/json', content: JSON.stringify(payload, null, 2) };
    }
  }, [kind, project.meta.name, plm, bomRows, pomTable, payload]);

  const stats = useMemo<Array<[string, string]>>(() => {
    const rows: Array<[string, string]> = (() => {
      switch (kind) {
        case 'plm':
          return [
            ['版片', String(techPack.panels.length)],
            ['缝合', String(techPack.seams.length)],
            ['BOM', `${techPack.bom.length} 行`],
            ['POM', `${techPack.pom.length} 行`],
          ];
        case 'bom': return [['物料行数', String(bomRows.length)]];
        case 'pom': return [['POM 行数', String(pomTable.rows.length)]];
        case 'api': return [['方法数', String(API_DOC.methods.length)]];
        default: return [['发送方式', 'POST JSON'], ['字段数', String(Object.keys(payload).length)]];
      }
    })();
    return [...rows, ['文件大小', payloadSize(output.content)]];
  }, [kind, techPack, bomRows, pomTable, payload, output.content]);

  const body = output.content;
  const truncated = body.length > MAX_PREVIEW;

  const saveWebhook = () => {
    try {
      localStorage.setItem(WEBHOOK_KEY, JSON.stringify({ endpoint, token }));
      setStatus('Webhook 设置已保存在本机');
    } catch {
      setStatus('本机存储不可用，设置只在当前会话有效');
    }
  };

  const sendWebhook = () => {
    if (busy) return;
    setBusy(true);
    setStatus('发送中');
    void postWebhook(endpoint, payload, token).then(result => {
      setStatus(result.message);
      setBusy(false);
    });
  };

  const run = () => {
    downloadTextFile(output.filename, output.content, output.mime);
    setStatus(`${item.label}已下载`);
  };

  const copyApiSnippet = () => {
    void navigator.clipboard.writeText(API_SNIPPET).then(
      () => setStatus('API 示例已复制'),
      () => setStatus(API_SNIPPET),
    );
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>外部对接</span>
        <span style={styles.headerItem}>{item.label}</span>
        <span style={styles.badge}>{item.format}</span>
      </div>

      <div style={styles.body}>
        <OutputRail
          items={ITEMS.map(entry => ({ key: entry.kind, label: entry.label }))}
          active={kind}
          onSelect={key => { setKind(key as IntegrationKind); setStatus(null); }}
        />
        <section style={styles.previewPane}>
          <div style={styles.canvas}>
            {kind === 'bom' ? <BomTable rows={bomRows} /> : <pre style={styles.code}>{body.slice(0, MAX_PREVIEW)}</pre>}
          </div>
          <div style={styles.stats}>
            {stats.map(([label, value]) => (
              <div key={label} style={styles.stat}>
                <span style={styles.statLabel}>{label}</span>
                <span style={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {kind === 'webhook' && (
          <aside style={styles.options}>
            <span style={styles.fieldLabel}>端点地址</span>
            <input
              style={styles.input} placeholder="https://example.com/hooks/opencloth"
              value={endpoint} onChange={e => setEndpoint(e.target.value)}
            />
            <span style={styles.fieldLabel}>访问令牌</span>
            <input
              style={styles.input} type="password" placeholder="可选，作为 Bearer Token"
              value={token} onChange={e => setToken(e.target.value)}
            />
            <button style={styles.secondaryBtn} onClick={saveWebhook}>保存设置</button>
          </aside>
        )}
      </div>

      <div style={styles.actions}>
        <span style={styles.hint}>{status ?? output.filename}</span>
        {truncated && <span style={styles.truncated}>预览已截断</span>}
        {kind === 'api' && <button style={styles.secondaryBtn} onClick={copyApiSnippet}>复制示例</button>}
        <button style={styles.secondaryBtn} onClick={closeDialog}>取消</button>
        {kind === 'webhook' ? (
          <button style={styles.exportBtn} disabled={busy} onClick={sendWebhook}>
            {busy ? '发送中' : '发送'}
          </button>
        ) : (
          <button style={styles.exportBtn} onClick={run}>导出</button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 },
  header: { display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 8, borderBottom: '1px solid #333' },
  title: { fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1 },
  headerItem: { fontSize: 'var(--oc-fs-label)', color: '#ddd' },
  badge: {
    fontSize: 'var(--oc-fs-micro)', color: '#8fbfe0', background: '#1f2a33', border: '1px solid #33505e',
    borderRadius: 3, padding: '1px 6px', letterSpacing: 0.5,
  },
  body: { display: 'flex', gap: 10, flex: 1, minHeight: 0 },
  previewPane: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  canvas: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#15151a', border: '1px solid #3a3a42', borderRadius: 4, overflow: 'auto', padding: 6,
  },
  code: {
    width: '100%', height: '100%', margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--oc-fs-note)', color: '#bcd',
    background: '#1b1b1f', borderRadius: 3, padding: '8px 10px', lineHeight: 1.6,
  },
  stats: { display: 'flex', flexWrap: 'wrap', gap: 14, padding: '2px 2px 0' },
  stat: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--oc-fs-micro)' },
  statLabel: { color: '#7d7d88' },
  statValue: { color: '#ddd' },
  options: {
    width: 246, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6,
    overflowY: 'auto', borderLeft: '1px solid #2c2c33', paddingLeft: 10,
  },
  fieldLabel: { fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  input: {
    width: '100%', padding: '4px 8px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#eee', fontSize: 'var(--oc-fs-micro)',
  },
  actions: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid #333' },
  hint: {
    flex: 1, fontSize: 'var(--oc-fs-micro)', color: '#7d7d88',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  truncated: { fontSize: 'var(--oc-fs-micro)', color: '#9a7d4a' },
  exportBtn: {
    padding: '5px 16px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  secondaryBtn: {
    padding: '5px 12px', background: '#2a2a30', border: '1px solid #4a4a54', borderRadius: 3,
    color: '#ddd', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};
