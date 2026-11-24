import { writeMarkerDxf, writePatternDxf } from '@/io/dxf';
import {
  buildPatternPdf, exportMarkerSvg, exportPatternSvg, planPatternPdfLayout, planPdfTiling,
} from '@/io/exporters';
import { downloadBytesFile, downloadTextFile } from '@/io/serialization';
import { orderedSizes } from '@/pattern/grading';
import { markerGerber, markerHpgl, buildTechPackPdf, bomCsv, bomTotals, buildBom, type BomRow } from '@/production';
import { buildMarkerLayout, buildMarkerReport, markerReportCsv, type MarkerLayoutOptions } from '@/production/marker';
import { useProjectStore } from '@/store';
import { BomTable } from '@/ui/menu/bomTable';
import { useMenuStore } from '@/ui/menu/menuStore';
import { OutputRail } from '@/ui/menu/outputRail';
import {
  MARKER_ANGLE_MODES, PRODUCTION_ITEMS, markerAngles, productionItem, type MarkerAngleMode,
  type ProductionOutputKind,
} from '@/ui/menu/production';
import { isMobileUi } from '@/ui/mobile/mobileUi';
import { notify, reportActionError } from '@/ui/widgets/toast';
import { useEffect, useMemo, useState } from 'react';

const CM_TO_PT = 28.3465;

const EMPTY_PREVIEW: ProductionPreview = { svg: null, pdf: null, stats: [], problem: null };

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 },
  header: { display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 8, borderBottom: '1px solid #333' },
  title: { fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1 },
  headerItem: { fontSize: 'var(--oc-fs-label)', color: '#ddd' },
  badge: {
    fontSize: 'var(--oc-fs-micro)', color: '#8fbfe0', background: '#1f2a33', border: '1px solid #33505e',
    borderRadius: 3, padding: '1px 6px', letterSpacing: 0.5,
  },
  body: { display: 'flex', gap: 10, flex: 1, minHeight: 0 },
  bodyStacked: { flexDirection: 'column', overflowY: 'auto', WebkitOverflowScrolling: 'touch' },
  previewPane: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  previewPaneStacked: { flex: '0 0 auto' },
  canvas: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#15151a', border: '1px solid #3a3a42', borderRadius: 4, overflow: 'auto', padding: 6,
  },
  canvasStacked: { flex: '0 0 auto', height: '34dvh', minHeight: 180 },
  image: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff' },
  pdfFrame: { width: '100%', height: '100%', border: 'none', background: '#fff' },
  problem: { fontSize: 'var(--oc-fs-micro)', color: '#8a8a95', padding: 12, textAlign: 'center', lineHeight: 1.6 },
  stats: { display: 'flex', flexWrap: 'wrap', gap: 14, padding: '2px 2px 0' },
  stat: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--oc-fs-micro)' },
  statLabel: { color: '#7d7d88' },
  statValue: { color: '#ddd' },
  options: {
    width: 246, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8,
    overflowY: 'auto', paddingRight: 2, borderLeft: '1px solid #2c2c33', paddingLeft: 10,
  },
  optionsStacked: {
    width: '100%', overflowY: 'visible', borderLeft: 'none', borderTop: '1px solid #2c2c33',
    paddingLeft: 0, paddingTop: 8, paddingRight: 0, gap: 10,
  },
  field: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  fieldLabel: { flex: 1 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--oc-fs-micro)', color: '#ccc' },
  input: {
    width: 92, height: 'var(--oc-h-control)', padding: '0 6px', background: '#1b1b1f', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)',
  },
  select: {
    maxWidth: 150, height: 'var(--oc-h-control)', padding: '0 6px', background: '#1b1b1f', border: '1px solid #3a3a42',
    borderRadius: 3, color: '#eee', fontSize: 'var(--oc-fs-micro)',
  },
  actions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid #333' },
  touchBtn: { flex: '1 1 0', minHeight: 40 },
  exportBtn: {
    padding: '5px 16px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  secondaryBtn: {
    padding: '5px 12px', background: '#2a2a30', border: '1px solid #4a4a54', borderRadius: 3,
    color: '#ddd', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};

interface ProductionPreview {
  svg: string | null;
  pdf: Uint8Array | null;
  stats: Array<[string, string]>;
  problem: string | null;
}

const kiloBytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

function textSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function ProductionDialog({ initialKind }: { initialKind: ProductionOutputKind | null }) {
  const closeDialog = useMenuStore(s => s.closeDialog);
  const project = useProjectStore(s => s.project);
  const [kind, setKind] = useState<ProductionOutputKind>(initialKind ?? 'exportMarker');
  const mobile = isMobileUi();

  const [withAllowance, setWithAllowance] = useState(true);
  const [fabricWidth, setFabricWidth] = useState('150');
  const [shrink, setShrink] = useState('0');
  const [gap, setGap] = useState('0.5');
  const [angleMode, setAngleMode] = useState<MarkerAngleMode>('default');
  const [freeAngles, setFreeAngles] = useState('0, 45, 90');
  const [markerFlip, setMarkerFlip] = useState(false);
  const [markerFormat, setMarkerFormat] = useState<'svg' | 'dxf'>('svg');
  const [markerSizeScope, setMarkerSizeScope] = useState<'current' | 'chart'>('current');
  const [sizeScope, setSizeScope] = useState<'current' | 'chart'>('current');
  const [sizeGap, setSizeGap] = useState('10');
  const [encoding, setEncoding] = useState<'utf-8' | 'ascii'>('utf-8');
  const [paper, setPaper] = useState<'A4' | 'A3'>('A4');
  const [pdfMode, setPdfMode] = useState<'single' | 'tile'>('single');
  const [pdfOverlap, setPdfOverlap] = useState('1');
  const [price, setPrice] = useState('');
  const [techWidth, setTechWidth] = useState('150');
  const [techPrice, setTechPrice] = useState('');

  const item = productionItem(kind);
  const pattern = project.pattern;
  const priceInput = price.trim() === '' ? undefined : Number(price);
  const pricePerMeter = priceInput !== undefined && Number.isFinite(priceInput) && priceInput >= 0 ? priceInput : undefined;

  const markerOptions = useMemo<MarkerLayoutOptions | null>(() => {
    const width = Number(fabricWidth);
    if (!Number.isFinite(width) || width <= 0) return null;
    const angles = markerAngles(angleMode, freeAngles);
    const sizes = markerSizeScope === 'chart' ? orderedSizes(project) : [];
    return {
      fabricWidthCm: width,
      shrinkPercent: Number.isFinite(Number(shrink)) ? Number(shrink) : 0,
      gapCm: Number.isFinite(Number(gap)) && Number(gap) >= 0 ? Number(gap) : 0.5,
      allowRotate: true,
      flip: markerFlip,
      ...(angles ? { angles } : {}),
      ...(sizes.length > 0
        ? { sizes: sizes.map(size => ({ id: size.id, label: size.label })), fromSizeId: project.activeSizeId }
        : {}),
    };
  }, [project, fabricWidth, shrink, gap, angleMode, freeAngles, markerFlip, markerSizeScope]);

  const dxfOptions = useMemo(() => {
    const chart = sizeScope === 'chart' ? orderedSizes(project) : [];
    const gapCm = Number.isFinite(Number(sizeGap)) && Number(sizeGap) > 0 ? Number(sizeGap) : 10;
    return {
      includeSeamAllowance: withAllowance,
      encoding,
      ...(chart.length > 0
        ? { sizes: { chart, ...(project.activeSizeId ? { fromSizeId: project.activeSizeId } : {}), gapCm } }
        : {}),
    };
  }, [project, sizeScope, sizeGap, withAllowance, encoding]);

  const preview = useMemo<ProductionPreview>(() => {
    try {
      if (kind === 'exportBom') {
        const rows = buildBom(project);
        if (rows.length === 0) return { ...EMPTY_PREVIEW, problem: '没有可见的物料，请先添加版片或物件。' };
        const totals = bomTotals(rows);
        return {
          ...EMPTY_PREVIEW,
          stats: [
            ['物料行数', String(rows.length)],
            ['合计金额', totals.pricedRows === 0 ? '未填写单价' : `${totals.amount.toFixed(2)} 元`],
          ],
        };
      }

      if (kind === 'exportMarker' || kind === 'exportCutGerber' || kind === 'exportCutHpgl') {
        if (!markerOptions) return { ...EMPTY_PREVIEW, problem: '请输入面料幅宽后预览。' };
        const layout = buildMarkerLayout(pattern, markerOptions);
        const report = buildMarkerReport(layout, { pricePerMeter });
        const svg = exportMarkerSvg(layout);
        const base: Array<[string, string]> = [
          ['版片数', String(report.pieceCount)],
          ['用料长度', `${report.usedLengthM.toFixed(2)} m`],
          ['利用率', `${(report.utilization * 100).toFixed(1)}%`],
        ];
        if (kind === 'exportMarker') {
          return { ...EMPTY_PREVIEW, svg, stats: [...base, ['导出格式', markerFormat === 'dxf' ? 'DXF 唛架' : 'SVG 图片']] };
        }

        const cut = kind === 'exportCutGerber' ? markerGerber(pattern, markerOptions) : markerHpgl(pattern, markerOptions);
        return {
          ...EMPTY_PREVIEW,
          svg,
          stats: [...base, ['刀路文件', kiloBytes(textSize(cut))]],
        };
      }

      if (kind === 'exportDxf') {
        const dxf = writePatternDxf(pattern, dxfOptions);
        return {
          ...EMPTY_PREVIEW,
          svg: exportPatternSvg(pattern, { includeSeamAllowance: withAllowance }),
          stats: [
            ['版片数', String(Object.values(pattern.panels).length)],
            ['尺码范围', sizeScope === 'chart' ? `全部尺码（${orderedSizes(project).length} 个）` : '当前码'],
            ['文件大小', kiloBytes(textSize(dxf))],
          ],
        };
      }

      if (kind === 'exportSvg') {
        const svg = exportPatternSvg(pattern, { includeSeamAllowance: withAllowance });
        return {
          ...EMPTY_PREVIEW,
          svg,
          stats: [
            ['版片数', String(Object.values(pattern.panels).length)],
            ['轮廓', withAllowance ? '净样 + 缝份' : '净样'],
            ['文件大小', kiloBytes(textSize(svg))],
          ],
        };
      }

      if (kind === 'exportPdf') {
        const overlap = Number(pdfOverlap);
        const pdf = buildPatternPdf(pattern, {
          page: paper,
          includeSeamAllowance: withAllowance,
          mode: pdfMode,
          ...(pdfMode === 'tile' ? { overlapCm: Number.isFinite(overlap) && overlap >= 0 ? overlap : 1 } : {}),
        });
        const stats: Array<[string, string]> = [['纸张', paper], ['文件大小', kiloBytes(pdf.length)]];
        if (pdfMode === 'single') {
          const layout = planPatternPdfLayout(pattern, { page: paper, includeSeamAllowance: withAllowance });
          stats.push(['输出比例', `约 1:${(CM_TO_PT / layout.scalePtPerCm).toFixed(2)}`]);
        } else {
          const tiling = planPdfTiling(pattern, {
            page: paper,
            includeSeamAllowance: withAllowance,
            overlapCm: Number.isFinite(overlap) && overlap >= 0 ? overlap : 1,
          });
          stats.push(['拼版页数', tiling.pages.length > 0 ? `${tiling.cols} × ${tiling.rows}` : '—']);
        }

        return { ...EMPTY_PREVIEW, pdf, stats };
      }

      const width = Number(techWidth);
      const unitPrice = techPrice.trim() === '' ? undefined : Number(techPrice);
      const pdf = buildTechPackPdf(project, {
        ...(Number.isFinite(width) && width > 0 ? { fabricWidthCm: width } : {}),
        ...(typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? { pricePerMeter: unitPrice } : {}),
      });
      return {
        ...EMPTY_PREVIEW,
        pdf,
        stats: [['纸张', 'A4'], ['文件大小', kiloBytes(pdf.length)]],
      };
    } catch (err) {
      return { ...EMPTY_PREVIEW, problem: '预览生成失败：' + (err as Error).message };
    }
  }, [kind, project, pattern, markerOptions, dxfOptions, withAllowance, sizeScope, pdfMode, paper, pdfOverlap,
    markerFormat, techWidth, techPrice, pricePerMeter]);

  const bomRows = useMemo<BomRow[]>(() => (kind === 'exportBom' ? buildBom(project) : []), [kind, project]);

  const svgUrl = useMemo(
    () => (preview.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}` : null),
    [preview.svg],
  );

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.pdf) { setPdfUrl(null); return undefined; }
    const url = URL.createObjectURL(new Blob([preview.pdf.slice()], { type: 'application/pdf' }));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.pdf]);

  const run = () => {
    const name = project.meta.name;
    try {
      if (kind === 'exportBom') {
        const rows = buildBom(project);
        if (rows.length === 0) { notify('没有可导出的物料。'); return; }
        downloadTextFile(`${name}-物料清单.csv`, bomCsv(rows), 'text/csv;charset=utf-8');
      } else if (kind === 'exportMarker' || kind === 'exportCutGerber' || kind === 'exportCutHpgl') {
        if (!markerOptions) { notify('请输入有效的面料幅宽(cm)'); return; }
        if (kind === 'exportMarker') {
          if (markerFormat === 'dxf') {
            downloadTextFile(`${name}-排料图.dxf`, writeMarkerDxf(buildMarkerLayout(pattern, markerOptions)), 'text/plain');
          } else {
            downloadTextFile(`${name}-排料图.svg`, exportMarkerSvg(buildMarkerLayout(pattern, markerOptions)), 'image/svg+xml');
          }
        } else if (kind === 'exportCutGerber') {
          downloadTextFile(`${name}-裁床.gbr`, markerGerber(pattern, markerOptions), 'text/plain');
        } else {
          downloadTextFile(`${name}-裁床.plt`, markerHpgl(pattern, markerOptions), 'text/plain');
        }
      } else if (kind === 'exportDxf') {
        downloadTextFile(`${name}.dxf`, writePatternDxf(pattern, dxfOptions), 'text/plain');
      } else if (kind === 'exportSvg') {
        downloadTextFile(`${name}.svg`, exportPatternSvg(pattern, { includeSeamAllowance: withAllowance }), 'image/svg+xml');
      } else if (kind === 'exportPdf') {
        const overlap = Number(pdfOverlap);
        const pdf = buildPatternPdf(pattern, {
          page: paper,
          includeSeamAllowance: withAllowance,
          mode: pdfMode,
          ...(pdfMode === 'tile' ? { overlapCm: Number.isFinite(overlap) && overlap >= 0 ? overlap : 1 } : {}),
        });
        downloadBytesFile(`${name}.pdf`, pdf, 'application/pdf');
      } else {
        const width = Number(techWidth);
        const unitPrice = techPrice.trim() === '' ? undefined : Number(techPrice);
        const pdf = buildTechPackPdf(project, {
          ...(Number.isFinite(width) && width > 0 ? { fabricWidthCm: width } : {}),
          ...(typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? { pricePerMeter: unitPrice } : {}),
        });
        downloadBytesFile(`${name}-工艺单.pdf`, pdf, 'application/pdf');
      }

      closeDialog();
    } catch (err) {
      reportActionError(err, '导出失败');
    }
  };

  const downloadMarkerReport = () => {
    if (!markerOptions) return;
    const report = buildMarkerReport(buildMarkerLayout(pattern, markerOptions), { pricePerMeter });
    downloadTextFile(`${project.meta.name}-用料报告.csv`, '\ufeff' + markerReportCsv(report), 'text/csv;charset=utf-8');
  };

  const markerFields = (
    <>
      <Field label="面料幅宽(cm)">
        <input style={styles.input} type="number" min="1" step="1" value={fabricWidth} onChange={e => setFabricWidth(e.target.value)} />
      </Field>
      <Field label="缩率(%)">
        <input style={styles.input} type="number" min="0" step="0.5" value={shrink} onChange={e => setShrink(e.target.value)} />
      </Field>
      <Field label="片间距(cm)">
        <input style={styles.input} type="number" min="0" step="0.5" value={gap} onChange={e => setGap(e.target.value)} />
      </Field>
      <Field label="旋转角度">
        <select style={styles.select} value={angleMode} onChange={e => setAngleMode(e.target.value as MarkerAngleMode)}>
          {MARKER_ANGLE_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </Field>
      {angleMode === 'free' && (
        <Field label="角度列表(°)">
          <input style={styles.input} type="text" placeholder="例如 0, 30, 60, 90" value={freeAngles} onChange={e => setFreeAngles(e.target.value)} />
        </Field>
      )}
      <label style={styles.checkRow}>
        <input type="checkbox" checked={markerFlip} onChange={e => setMarkerFlip(e.target.checked)} />
        <span>每片翻转（反面朝上）</span>
      </label>
      <Field label="尺码范围">
        <select style={styles.select} value={markerSizeScope} onChange={e => setMarkerSizeScope(e.target.value as 'current' | 'chart')}>
          <option value="current">当前码</option>
          <option value="chart">全部尺码</option>
        </select>
      </Field>
      {kind === 'exportMarker' && (
        <Field label="导出格式">
          <select style={styles.select} value={markerFormat} onChange={e => setMarkerFormat(e.target.value as 'svg' | 'dxf')}>
            <option value="svg">SVG 图片</option>
            <option value="dxf">DXF 唛架</option>
          </select>
        </Field>
      )}
      <Field label="面料单价(元/m)">
        <input style={styles.input} type="number" min="0" step="0.1" placeholder="选填" value={price} onChange={e => setPrice(e.target.value)} />
      </Field>
    </>
  );

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>生产预览</span>
        <span style={styles.headerItem}>{item.label}</span>
        <span style={styles.badge}>{item.format}</span>
      </div>

      <div style={{ ...styles.body, ...(mobile ? styles.bodyStacked : null) }}>
        <OutputRail
          items={PRODUCTION_ITEMS.map(entry => ({ key: entry.kind, label: entry.label }))}
          active={kind}
          orientation={mobile ? 'horizontal' : 'vertical'}
          onSelect={key => setKind(key as ProductionOutputKind)}
        />
        <section style={{ ...styles.previewPane, ...(mobile ? styles.previewPaneStacked : null) }}>
          <div style={{ ...styles.canvas, ...(mobile ? styles.canvasStacked : null) }}>
            {preview.problem ? (
              <div style={styles.problem}>{preview.problem}</div>
            ) : kind === 'exportBom' ? (
              <BomTable rows={bomRows} />
            ) : preview.pdf ? (
              pdfUrl
                ? <iframe title="生产预览" src={pdfUrl} style={styles.pdfFrame} />
                : <div style={styles.problem}>正在生成预览</div>
            ) : svgUrl ? (
              <img src={svgUrl} alt="" style={styles.image} />
            ) : (
              <div style={styles.problem}>正在生成预览</div>
            )}
          </div>
          <div style={styles.stats}>
            {preview.stats.map(([label, value]) => (
              <div key={label} style={styles.stat}>
                <span style={styles.statLabel}>{label}</span>
                <span style={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {kind !== 'exportBom' && (
          <aside style={{ ...styles.options, ...(mobile ? styles.optionsStacked : null) }}>
            {kind === 'exportMarker' || kind === 'exportCutGerber' || kind === 'exportCutHpgl' ? markerFields
              : kind === 'exportDxf' ? (
              <>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={withAllowance} onChange={e => setWithAllowance(e.target.checked)} />
                  <span>包含缝份轮廓</span>
                </label>
                <Field label="尺码范围">
                  <select style={styles.select} value={sizeScope} onChange={e => setSizeScope(e.target.value as 'current' | 'chart')}>
                    <option value="current">当前码</option>
                    <option value="chart">全部尺码（横向排开）</option>
                  </select>
                </Field>
                {sizeScope === 'chart' && (
                  <Field label="码间距(cm)">
                    <input style={styles.input} type="number" min="1" step="1" value={sizeGap} onChange={e => setSizeGap(e.target.value)} />
                  </Field>
                )}
                <Field label="文本编码">
                  <select style={styles.select} value={encoding} onChange={e => setEncoding(e.target.value as 'utf-8' | 'ascii')}>
                    <option value="utf-8">UTF-8（中文原名）</option>
                    <option value="ascii">ASCII（\\U+XXXX）</option>
                  </select>
                </Field>
              </>
            ) : kind === 'exportPdf' ? (
              <>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={withAllowance} onChange={e => setWithAllowance(e.target.checked)} />
                  <span>包含缝份轮廓</span>
                </label>
                <Field label="纸张">
                  <select style={styles.select} value={paper} onChange={e => setPaper(e.target.value as 'A4' | 'A3')}>
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                  </select>
                </Field>
                <Field label="输出方式">
                  <select style={styles.select} value={pdfMode} onChange={e => setPdfMode(e.target.value as 'single' | 'tile')}>
                    <option value="single">适合单页</option>
                    <option value="tile">1:1 多页拼版</option>
                  </select>
                </Field>
                {pdfMode === 'tile' && (
                  <Field label="重叠(cm)">
                    <input style={styles.input} type="number" min="0" step="0.5" value={pdfOverlap} onChange={e => setPdfOverlap(e.target.value)} />
                  </Field>
                )}
              </>
            ) : kind === 'exportTechPack' ? (
              <>
                <Field label="面料幅宽(cm)">
                  <input style={styles.input} type="number" min="1" step="1" value={techWidth} onChange={e => setTechWidth(e.target.value)} />
                </Field>
                <Field label="面料单价(元/m)">
                  <input style={styles.input} type="number" min="0" step="0.1" placeholder="选填" value={techPrice} onChange={e => setTechPrice(e.target.value)} />
                </Field>
              </>
            ) : (
              <label style={styles.checkRow}>
                <input type="checkbox" checked={withAllowance} onChange={e => setWithAllowance(e.target.checked)} />
                <span>包含缝份轮廓</span>
              </label>
            )}
            {kind === 'exportMarker' && (
              <button style={styles.secondaryBtn} onClick={downloadMarkerReport}>导出 CSV 报告</button>
            )}
          </aside>
        )}
      </div>

      <div style={styles.actions}>
        <button style={{ ...styles.secondaryBtn, ...(mobile ? styles.touchBtn : null) }} onClick={closeDialog}>取消</button>
        <button
          style={{ ...styles.exportBtn, ...(mobile ? styles.touchBtn : null) }}
          onClick={run}
          disabled={!!preview.problem}
        >导出</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
