import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  dialogButton, dialogLabel, dialogMessage, dialogNote, dialogRoot, dialogSectionTitle,
  dialogTab, dialogTabActive, dialogTabs, dialogTitle,
} from '@/ui/menu/dialogStyles';
import { useProjectStore } from '@/store';
import { downloadTextFile } from '@/io/serialization';
import { buildTechPackData } from '@/io/exporters';
import { buildPlmPackage, buildWebhookPayload, postWebhook } from '@/io/exporters';
import { bomCsv } from '@/pattern';
import { buildPomTable } from '@/pattern/pom';
import { pomReportCsv } from '@/io/exporters';

type IntegrationTab = 'plm' | 'webhook' | 'api';

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

/** Industrial hand-off: PLM bundle, webhook delivery and the browser API reference. */
export function IntegrationDialog() {
  const project = useProjectStore(s => s.project);
  const [tab, setTab] = useState<IntegrationTab>('plm');
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
  const payload = useMemo(() => buildWebhookPayload(project), [project]);

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
    setStatus('发送中…');
    void postWebhook(endpoint, payload, token).then(result => {
      setStatus(result.message);
      setBusy(false);
    });
  };

  const exportPlm = () => {
    const plm = buildPlmPackage(project);
    downloadTextFile(`${project.meta.name}-PLM包.json`, JSON.stringify(plm, null, 2), 'application/json');
    setStatus('PLM 包已下载');
  };

  const exportBom = () => {
    downloadTextFile(`${project.meta.name}-物料清单.csv`, '\ufeff' + bomCsv(techPack.bom), 'text/csv;charset=utf-8');
    setStatus('物料清单 CSV 已下载');
  };

  const exportPom = () => {
    const csv = pomReportCsv(project.meta.name, buildPomTable(project));
    downloadTextFile(`${project.meta.name}-POM报告.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    setStatus('POM 报告 CSV 已下载');
  };

  const copyApiSnippet = () => {
    const snippet = [
      'const project = window.opencloth.getProjectJson();',
      'const summary = window.opencloth.getSummary();',
      'const plm = window.opencloth.getPlmPackage();',
    ].join('\n');
    void navigator.clipboard.writeText(snippet).then(
      () => setStatus('API 示例已复制'),
      () => setStatus(snippet),
    );
  };

  const exportApiDoc = () => {
    const doc = {
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
    downloadTextFile(`${project.meta.name}-API说明.json`, JSON.stringify(doc, null, 2), 'application/json');
    setStatus('API 说明已下载');
  };

  return (
    <div style={styles.root}>
      <div style={styles.title}>外部对接</div>
      <div style={styles.tabs}>
        {([
          ['plm', 'PLM / ERP'],
          ['webhook', 'Webhook'],
          ['api', 'API'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            style={{ ...styles.tabBtn, ...(tab === key ? styles.tabBtnActive : null) }}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>
      {status && <div style={styles.status}>{status}</div>}

      <div style={styles.body}>
        {tab === 'plm' && (
          <>
            <div style={styles.summary}>
              {project.meta.name} · 版片 {techPack.panels.length} · 缝合 {techPack.seams.length} ·
              材质 {techPack.fabrics.length} · BOM {techPack.bom.length} 行 · POM {techPack.pom.length} 行
            </div>
            <div style={styles.actions}>
              <button style={styles.primaryBtn} onClick={exportPlm}>导出 PLM 包 JSON</button>
              <button style={styles.secondaryBtn} onClick={exportBom}>导出物料清单 CSV</button>
              <button style={styles.secondaryBtn} onClick={exportPom}>导出 POM 报告 CSV</button>
            </div>
            <div style={styles.note}>
              PLM 包与工艺单同源，包含样式信息、尺码、版片、材质、缝合、物料清单、POM 与排料摘要；不包含贴图与模型本体。
            </div>
            <div style={styles.sectionTitle}>字段预览</div>
            <div style={styles.code}>
              {JSON.stringify({
                format: 'opencloth-plm',
                style: { name: project.meta.name, baseSize: techPack.baseSizeLabel },
                counts: {
                  sizes: techPack.sizes.length,
                  panels: techPack.panels.length,
                  seams: techPack.seams.length,
                  bom: techPack.bom.length,
                  pom: techPack.pom.length,
                },
                marker: { laidOut: techPack.marker.laidOut, usedLengthM: techPack.marker.usedLengthM },
              }, null, 2)}
            </div>
          </>
        )}

        {tab === 'webhook' && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>端点地址</span>
              <input
                style={styles.input} placeholder="https://example.com/hooks/opencloth"
                value={endpoint} onChange={e => setEndpoint(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.label}>访问令牌</span>
              <input
                style={styles.input} type="password" placeholder="可选，作为 Bearer Token"
                value={token} onChange={e => setToken(e.target.value)}
              />
            </div>
            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={saveWebhook}>保存设置</button>
              <button style={styles.primaryBtn} disabled={busy} onClick={sendWebhook}>{busy ? '发送中…' : '发送当前工程摘要'}</button>
            </div>
            <div style={styles.note}>
              发送的是项目名、更新时间与版片 / 缝合 / 材质 / 尺码数量，不含工程本体。浏览器直连受 CORS 限制，端点需允许跨域 POST。
            </div>
            <div style={styles.sectionTitle}>请求体预览</div>
            <div style={styles.code}>{JSON.stringify(payload, null, 2)}</div>
          </>
        )}

        {tab === 'api' && (
          <>
            <div style={styles.summary}>浏览器全局对象 `window.opencloth`（v1.0）</div>
            <div style={styles.code}>
              {[
                'window.opencloth.getProject()       // 当前工程深拷贝',
                'window.opencloth.getProjectJson()   // .ocproj.json 文本',
                'window.opencloth.loadProjectJson(j) // 校验并载入',
                'window.opencloth.getSummary()       // 片数 / 缝数 / 材质 / 尺码',
                'window.opencloth.getPlmPackage()    // 与 PLM 导出同源',
              ].join('\n')}
            </div>
            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={copyApiSnippet}>复制示例</button>
              <button style={styles.secondaryBtn} onClick={exportApiDoc}>下载 API 说明 JSON</button>
            </div>
            <div style={styles.note}>
              API 在页面加载后可用，供本地脚本、浏览器自动化或 PLM 连接器读取工程；写入只有 `loadProjectJson`，会替换当前工程并清空撤销历史。
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: dialogRoot,
  title: dialogTitle,
  tabs: dialogTabs,
  tabBtn: dialogTab(12),
  tabBtnActive: dialogTabActive,
  status: dialogMessage,
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  summary: { color: '#ccc', fontSize: 'var(--oc-fs-micro)', lineHeight: 1.6 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { ...dialogLabel, width: 72 },
  input: { flex: 1, padding: '4px 8px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)' },
  note: dialogNote(1.6),
  sectionTitle: dialogSectionTitle,
  code: {
    whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 'var(--oc-fs-note)', color: '#bcd',
    background: '#1b1b1f', border: '1px solid #333', borderRadius: 4, padding: '8px 10px', lineHeight: 1.6,
  },
  primaryBtn: dialogButton('primary', 14),
  secondaryBtn: dialogButton('secondary', 14),
};
