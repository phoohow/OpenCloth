import { useEffect, useMemo, useState } from 'react';
import { useMenuStore } from './menuStore';
import { SHORTCUTS, shortcutsByScope, type ShortcutScope } from './shortcuts';
import { detectWebGPU } from '../../render/renderer/rendererContext';
import { useProjectStore } from '../../store/stores';
import { downloadBytesFile, downloadTextFile } from '../../io/codec';
import { writeMarkerDxf, writePatternDxf } from '../../io/dxf/writer';
import { buildPatternPdf, planPatternPdfLayout, planPdfTiling } from '../../io/pdfPattern';
import { buildTechPackPdf } from '../../io/techPack';
import { orderedSizes } from '../../pattern/grading/grading';
import { exportMarkerSvg, exportPatternSvg } from '../../io/svgPattern';
import { buildMarkerLayout } from '../../pattern/marker/markerLayout';
import { buildMarkerReport, markerReportCsv } from '../../pattern/marker/markerReport';
import { bomCsv, bomQuantityText, bomTotals, buildBom } from '../../pattern/bom';
import { ReviewDialog } from './reviewDialog';
import { AssetLibraryDialog } from './assetLibraryDialog';
import { IntegrationDialog } from './integrationDialog';

const SCOPE_ORDER: ShortcutScope[] = ['全局', '3D 视口', '2D 制版', '菜单栏'];

/** Modal host for 帮助 ▸ 快捷键总览, 关于 OpenCloth and the pattern export options. */
export function MenuDialogs() {
  const dialog = useMenuStore(s => s.dialog);
  const dialogParam = useMenuStore(s => s.dialogParam);
  const closeDialog = useMenuStore(s => s.closeDialog);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dialog, closeDialog]);

  if (!dialog) return null;
  return (
    <div style={styles.backdrop} onClick={closeDialog}>
      <div
        style={{
          ...styles.panel,
          ...(dialog === 'review' ? styles.panelWide : null),
          ...(dialog === 'assets' || dialog === 'integration' ? styles.panelMedium : null),
        }}
        onClick={e => e.stopPropagation()}
      >
        {dialog === 'shortcuts' ? <ShortcutsDialog />
          : dialog === 'about' ? <AboutDialog />
          : dialog === 'exportBom' ? <BomDialog />
          : dialog === 'review' ? <ReviewDialog initialProjectId={dialogParam} />
          : dialog === 'assets' ? <AssetLibraryDialog />
          : dialog === 'integration' ? <IntegrationDialog />
          : <PatternExportDialog kind={dialog} />}
        <div style={styles.footer}>
          <button style={styles.closeBtn} onClick={closeDialog}>关闭</button>
        </div>
      </div>
    </div>
  );
}

type ExportKind = 'exportDxf' | 'exportSvg' | 'exportPdf' | 'exportTechPack' | 'exportMarker';

const EXPORT_TITLES: Record<ExportKind, string> = {
  exportDxf: '导出 DXF 版型',
  exportSvg: '导出 SVG 平面图',
  exportPdf: '导出 PDF 图纸',
  exportTechPack: '导出工艺单',
  exportMarker: '导出排料图',
};

/** Points per centimetre at 1:1, used to turn the layout scale into a 1:N ratio. */
const CM_TO_PT = 28.3465;

/** Rotation angle sets offered by the marker dialog; the default keeps the 0°/90° pair. */
const MARKER_ANGLE_MODES = [
  { value: 'default', label: '0° / 90°（默认）' },
  { value: 'none', label: '仅 0°' },
  { value: '15', label: '0°–90°，每 15°' },
  { value: '5', label: '0°–90°，每 5°' },
  { value: 'free', label: '自定义角度…' },
] as const;

type MarkerAngleMode = typeof MARKER_ANGLE_MODES[number]['value'];

/** Angles tried per piece for the chosen mode; undefined keeps the packer's 0°/90° default. */
function markerAngles(mode: MarkerAngleMode, freeText: string): number[] | undefined {
  if (mode === 'default') return undefined;
  if (mode === 'none') return [0];
  if (mode === 'free') {
    const parsed = freeText
      .split(/[,，\s]+/)
      .map(Number)
      .filter(value => Number.isFinite(value))
      .map(value => ((value % 360) + 360) % 360);
    return parsed.length > 0 ? [...new Set(parsed)] : [0];
  }
  const step = Number(mode);
  return Array.from({ length: Math.round(90 / step) + 1 }, (_, index) => index * step);
}

/** Options form and download step for the pattern export menu items. */
function PatternExportDialog({ kind }: { kind: ExportKind }) {
  const closeDialog = useMenuStore(s => s.closeDialog);
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

  const project = useProjectStore(s => s.project);

  /** Live marker measurements for the current options; null when the form is invalid. */
  const markerReport = useMemo(() => {
    if (kind !== 'exportMarker') return null;
    const width = Number(fabricWidth);
    if (!Number.isFinite(width) || width <= 0) return null;
    const pricePerMeter = price.trim() === '' ? undefined : Number(price);
    const sizes = markerSizeScope === 'chart'
      ? orderedSizes(project).map(size => ({ id: size.id, label: size.label }))
      : undefined;
    try {
      const angles = markerAngles(angleMode, freeAngles);
      const layout = buildMarkerLayout(project.pattern, {
        fabricWidthCm: width,
        shrinkPercent: Number.isFinite(Number(shrink)) ? Number(shrink) : 0,
        gapCm: Number.isFinite(Number(gap)) && Number(gap) >= 0 ? Number(gap) : 0.5,
        allowRotate: true,
        flip: markerFlip,
        ...(angles ? { angles } : {}),
        ...(sizes?.length ? { sizes, fromSizeId: project.activeSizeId } : {}),
      });
      return buildMarkerReport(layout, { pricePerMeter });
    } catch {
      return null;
    }
  }, [kind, project, fabricWidth, shrink, gap, angleMode, freeAngles, markerFlip, price, markerSizeScope]);

  /** Applied output scale of the PDF page the current options would produce. */
  const pdfScale = useMemo(() => {
    if (kind !== 'exportPdf' || pdfMode === 'tile') return null;
    const layout = planPatternPdfLayout(project.pattern, { page: paper, includeSeamAllowance: withAllowance });
    return CM_TO_PT / layout.scalePtPerCm;
  }, [kind, project.pattern, paper, withAllowance, pdfMode]);

  /** Page grid of the 1:1 tiled output the current options would produce. */
  const pdfTiling = useMemo(() => {
    if (kind !== 'exportPdf' || pdfMode !== 'tile') return null;
    const overlap = Number(pdfOverlap);
    return planPdfTiling(project.pattern, {
      page: paper,
      includeSeamAllowance: withAllowance,
      overlapCm: Number.isFinite(overlap) && overlap >= 0 ? overlap : 1,
    });
  }, [kind, project.pattern, paper, withAllowance, pdfMode, pdfOverlap]);

  /** Downloads the live marker report as a UTF-8 CSV. */
  const downloadMarkerReport = () => {
    if (!markerReport) return;
    downloadTextFile(`${project.meta.name}-用料报告.csv`, '\ufeff' + markerReportCsv(markerReport), 'text/csv;charset=utf-8');
  };

  const run = () => {
    try {
      if (kind === 'exportMarker') {
        const width = Number(fabricWidth);
        if (!Number.isFinite(width) || width <= 0) { alert('请输入有效的面料幅宽(cm)'); return; }
        const angles = markerAngles(angleMode, freeAngles);
        const options = {
          fabricWidthCm: width,
          shrinkPercent: Number.isFinite(Number(shrink)) ? Number(shrink) : 0,
          gapCm: Number.isFinite(Number(gap)) && Number(gap) >= 0 ? Number(gap) : 0.5,
          allowRotate: true,
          flip: markerFlip,
          ...(angles ? { angles } : {}),
          ...(markerSizeScope === 'chart' && orderedSizes(project).length > 0
            ? {
              sizes: orderedSizes(project).map(size => ({ id: size.id, label: size.label })),
              fromSizeId: project.activeSizeId,
            }
            : {}),
        };
        if (markerFormat === 'dxf') {
          downloadTextFile(`${project.meta.name}-排料图.dxf`, writeMarkerDxf(project.pattern, options), 'text/plain');
        } else {
          downloadTextFile(`${project.meta.name}-排料图.svg`, exportMarkerSvg(project.pattern, options), 'image/svg+xml');
        }
      } else if (kind === 'exportSvg') {
        downloadTextFile(`${project.meta.name}.svg`, exportPatternSvg(project.pattern, { includeSeamAllowance: withAllowance }), 'image/svg+xml');
      } else if (kind === 'exportPdf') {
        const overlap = Number(pdfOverlap);
        const pdf = buildPatternPdf(project.pattern, {
          page: paper,
          includeSeamAllowance: withAllowance,
          mode: pdfMode,
          ...(pdfMode === 'tile' ? { overlapCm: Number.isFinite(overlap) && overlap >= 0 ? overlap : 1 } : {}),
        });
        downloadBytesFile(`${project.meta.name}.pdf`, pdf, 'application/pdf');
      } else if (kind === 'exportTechPack') {
        const width = Number(techWidth);
        const unitPrice = techPrice.trim() === '' ? undefined : Number(techPrice);
        const pdf = buildTechPackPdf(project, {
          ...(Number.isFinite(width) && width > 0 ? { fabricWidthCm: width } : {}),
          ...(typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? { pricePerMeter: unitPrice } : {}),
        });
        downloadBytesFile(`${project.meta.name}-工艺单.pdf`, pdf, 'application/pdf');
      } else {
        const chart = sizeScope === 'chart' ? orderedSizes(project) : [];
        const gapCm = Number.isFinite(Number(sizeGap)) && Number(sizeGap) > 0 ? Number(sizeGap) : 10;
        downloadTextFile(`${project.meta.name}.dxf`, writePatternDxf(project.pattern, {
          includeSeamAllowance: withAllowance,
          encoding,
          ...(chart.length > 0 ? { sizes: { chart, ...(project.activeSizeId ? { fromSizeId: project.activeSizeId } : {}), gapCm } } : {}),
        }), 'text/plain');
      }
      closeDialog();
    } catch (err) {
      alert('导出失败：' + (err as Error).message);
    }
  };

  return (
    <>
      <div style={styles.title}>{EXPORT_TITLES[kind]}</div>
      <div style={styles.body}>
        {kind === 'exportMarker' ? (
          <>
            <div style={styles.row}>
              <span style={styles.rowLabel}>面料幅宽(cm)</span>
              <input
                style={styles.input} type="number" min="1" step="1" value={fabricWidth}
                onChange={e => setFabricWidth(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>缩率(%)</span>
              <input
                style={styles.input} type="number" min="0" step="0.5" value={shrink}
                onChange={e => setShrink(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>片间距(cm)</span>
              <input
                style={styles.input} type="number" min="0" step="0.5" value={gap}
                onChange={e => setGap(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>旋转角度</span>
              <select style={styles.select} value={angleMode} onChange={e => setAngleMode(e.target.value as MarkerAngleMode)}>
                {MARKER_ANGLE_MODES.map(mode => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </div>
            {angleMode === 'free' && (
              <div style={styles.row}>
                <span style={styles.rowLabel}>角度列表(°)</span>
                <input
                  style={styles.input} type="text" placeholder="例如 0, 30, 60, 90"
                  value={freeAngles} onChange={e => setFreeAngles(e.target.value)}
                />
              </div>
            )}
            <label style={styles.row}>
              <input type="checkbox" checked={markerFlip} onChange={e => setMarkerFlip(e.target.checked)} />
              <span style={styles.rowLabel}>每片翻转（反面朝上）</span>
            </label>
            <div style={styles.row}>
              <span style={styles.rowLabel}>尺码范围</span>
              <select style={styles.select} value={markerSizeScope} onChange={e => setMarkerSizeScope(e.target.value as 'current' | 'chart')}>
                <option value="current">当前码</option>
                <option value="chart">全部尺码</option>
              </select>
            </div>
            {markerSizeScope === 'chart' && (
              <div style={styles.note}>每码各排一片，片名后附码标；利用率与成本按全部尺码合计。</div>
            )}
            <div style={styles.row}>
              <span style={styles.rowLabel}>导出格式</span>
              <select style={styles.select} value={markerFormat} onChange={e => setMarkerFormat(e.target.value as 'svg' | 'dxf')}>
                <option value="svg">SVG 图片</option>
                <option value="dxf">DXF 唛架</option>
              </select>
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>面料单价(元/m)</span>
              <input
                style={styles.input} type="number" min="0" step="0.1" placeholder="选填"
                value={price} onChange={e => setPrice(e.target.value)}
              />
            </div>
            {markerReport ? (
              <>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>版片数</span>
                  <span style={styles.rowValue}>{markerReport.pieceCount}</span>
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>用料长度</span>
                  <span style={styles.rowValue}>{markerReport.usedLengthM.toFixed(2)} m</span>
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>面料面积</span>
                  <span style={styles.rowValue}>{markerReport.fabricAreaM2.toFixed(2)} m²</span>
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>利用率</span>
                  <span style={styles.rowValue}>{(markerReport.utilization * 100).toFixed(1)}%</span>
                </div>
                {markerReport.cost !== null && (
                  <div style={styles.row}>
                    <span style={styles.rowLabel}>面料成本</span>
                    <span style={styles.rowValue}>{markerReport.cost.toFixed(2)} 元</span>
                  </div>
                )}
              </>
            ) : (
              <div style={styles.note}>当前选项无法排料，请检查幅宽与版片是否可见。</div>
            )}
          </>
        ) : kind === 'exportTechPack' ? (
          <>
            <div style={styles.row}>
              <span style={styles.rowLabel}>面料幅宽(cm)</span>
              <input
                style={styles.input} type="number" min="1" step="1" value={techWidth}
                onChange={e => setTechWidth(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>面料单价(元/m)</span>
              <input
                style={styles.input} type="number" min="0" step="0.1" placeholder="选填"
                value={techPrice} onChange={e => setTechPrice(e.target.value)}
              />
            </div>
            <div style={styles.note}>
              排料摘要按缩率 0%、片间距 0.5 cm 实时计算；不填单价时不写成本。
            </div>
          </>
        ) : (
          <label style={styles.row}>
            <input type="checkbox" checked={withAllowance} onChange={e => setWithAllowance(e.target.checked)} />
            <span style={styles.rowLabel}>包含缝份轮廓</span>
          </label>
        )}
        {kind === 'exportDxf' && (
          <>
            <div style={styles.row}>
              <span style={styles.rowLabel}>尺码范围</span>
              <select style={styles.select} value={sizeScope} onChange={e => setSizeScope(e.target.value as 'current' | 'chart')}>
                <option value="current">当前码</option>
                <option value="chart">全部尺码（横向排开）</option>
              </select>
            </div>
            {sizeScope === 'chart' && (
              <div style={styles.row}>
                <span style={styles.rowLabel}>码间距(cm)</span>
                <input
                  style={styles.input} type="number" min="1" step="1" value={sizeGap}
                  onChange={e => setSizeGap(e.target.value)}
                />
              </div>
            )}
            <div style={styles.row}>
              <span style={styles.rowLabel}>文本编码</span>
              <select style={styles.select} value={encoding} onChange={e => setEncoding(e.target.value as 'utf-8' | 'ascii')}>
                <option value="utf-8">UTF-8（中文原名）</option>
                <option value="ascii">ASCII（非 ASCII 转 \\U+XXXX）</option>
              </select>
            </div>
          </>
        )}
        {kind === 'exportPdf' && (
          <>
            <div style={styles.row}>
              <span style={styles.rowLabel}>纸张</span>
              <select style={styles.select} value={paper} onChange={e => setPaper(e.target.value as 'A4' | 'A3')}>
                <option value="A4">A4</option>
                <option value="A3">A3</option>
              </select>
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>输出方式</span>
              <select style={styles.select} value={pdfMode} onChange={e => setPdfMode(e.target.value as 'single' | 'tile')}>
                <option value="single">适合单页</option>
                <option value="tile">1:1 多页拼版</option>
              </select>
            </div>
            {pdfMode === 'single' ? (
              <div style={styles.row}>
                <span style={styles.rowLabel}>输出比例</span>
                <span style={styles.rowValue}>约 1:{pdfScale === null ? '—' : pdfScale.toFixed(2)}</span>
              </div>
            ) : (
              <>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>重叠(cm)</span>
                  <input
                    style={styles.input} type="number" min="0" step="0.5" value={pdfOverlap}
                    onChange={e => setPdfOverlap(e.target.value)}
                  />
                </div>
                <div style={styles.row}>
                  <span style={styles.rowLabel}>预计页数</span>
                  <span style={styles.rowValue}>
                    {pdfTiling && pdfTiling.pages.length > 0 ? `${pdfTiling.cols} × ${pdfTiling.rows} 页` : '—'}
                  </span>
                </div>
                <div style={styles.note}>按 A4/A3 可打印区域裁页；相邻页保留重叠量，按页角十字标记对齐拼贴。</div>
              </>
            )}
          </>
        )}
        <div style={styles.row}>
          <span style={styles.rowLabel} />
          {kind === 'exportMarker' && (
            <button style={styles.secondaryBtn} onClick={downloadMarkerReport} disabled={!markerReport}>导出 CSV 报告</button>
          )}
          <button style={styles.exportBtn} onClick={run}>导出</button>
        </div>
      </div>
    </>
  );
}

/** Preview of the bill of materials with a CSV download. */
function BomDialog() {
  const closeDialog = useMenuStore(s => s.closeDialog);
  const project = useProjectStore(s => s.project);
  const rows = useMemo(() => buildBom(project), [project]);
  const totals = useMemo(() => bomTotals(rows), [rows]);

  const download = () => {
    downloadTextFile(`${project.meta.name}-物料清单.csv`, bomCsv(rows), 'text/csv;charset=utf-8');
    closeDialog();
  };

  return (
    <>
      <div style={styles.title}>导出物料清单</div>
      <div style={styles.body}>
        {rows.length === 0 ? (
          <div style={styles.note}>当前工程没有可见的物料，请先添加版片或生产物件。</div>
        ) : (
          <>
            <div style={styles.bomTable}>
              <div style={{ ...styles.bomRow, ...styles.bomHead }}>
                <span>类别</span>
                <span>名称</span>
                <span>规格</span>
                <span>单位</span>
                <span style={styles.bomNum}>数量</span>
                <span style={styles.bomNum}>单价</span>
                <span style={styles.bomNum}>金额</span>
              </div>
              {rows.map((row, index) => (
                <div key={`${row.category}:${row.name}:${index}`} style={styles.bomRow}>
                  <span style={styles.bomCell}>{row.category}</span>
                  <span style={styles.bomCell}>{row.name}</span>
                  <span style={styles.bomCell}>{row.spec}</span>
                  <span style={styles.bomCell}>{row.unit}</span>
                  <span style={{ ...styles.bomCell, ...styles.bomNum }}>{bomQuantityText(row.quantity)}</span>
                  <span style={{ ...styles.bomCell, ...styles.bomNum }}>{row.unitPrice === null ? '—' : row.unitPrice.toFixed(2)}</span>
                  <span style={{ ...styles.bomCell, ...styles.bomNum }}>{row.amount === null ? '—' : row.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>合计金额</span>
              <span style={styles.rowValue}>
                {totals.pricedRows === 0 ? '未填写单价' : `${totals.amount.toFixed(2)} 元（${totals.pricedRows} 项已定价）`}
              </span>
            </div>
          </>
        )}
        <div style={styles.note}>CSV 带 UTF-8 编码，Excel 可直接打开；未填单价的行不参与合计。</div>
        <div style={styles.row}>
          <span style={styles.rowLabel} />
          <button style={styles.exportBtn} onClick={download} disabled={rows.length === 0}>导出 CSV</button>
        </div>
      </div>
    </>
  );
}

function ShortcutsDialog() {
  return (
    <>
      <div style={styles.title}>快捷键总览</div>
      <div style={styles.body}>
        {SCOPE_ORDER.map(scope => {
          const rows = shortcutsByScope(scope);
          if (rows.length === 0) return null;
          return (
            <section key={scope} style={styles.group}>
              <div style={styles.groupTitle}>{scope}</div>
              {rows.map(row => (
                <div key={row.id} style={styles.row}>
                  <span style={styles.rowLabel}>{row.label}</span>
                  <kbd style={styles.kbd}>{row.combo}</kbd>
                </div>
              ))}
            </section>
          );
        })}
        <div style={styles.note}>
          视口鼠标操作：2D 拖拽平移、滚轮缩放、点击选中、Ctrl 加选；3D 左键旋转、右键平移、滚轮推拉。
        </div>
      </div>
    </>
  );
}

function AboutDialog() {
  const [gpu, setGpu] = useState<string>('检测中…');

  useEffect(() => {
    let cancelled = false;
    void detectWebGPU().then(ok => { if (!cancelled) setGpu(ok ? 'WebGPU 可用' : 'WebGPU 不可用'); });
    return () => { cancelled = true; };
  }, []);

  const rows: Array<[string, string]> = [
    ['渲染后端', gpu],
    ['布料求解', 'WebGPU 位置基底动力学'],
    ['技术栈', 'React · Zustand · three.js (WebGPURenderer)'],
  ];

  return (
    <>
      <div style={styles.title}>关于 OpenCloth</div>
      <div style={styles.body}>
        <div style={styles.summary}>OpenCloth 是一款在浏览器里运行的服装制版与试衣软件：2D 制版、缝合、自动着装与实时布料模拟。</div>
        {rows.map(([label, value]) => (
          <div key={label} style={styles.row}>
            <span style={styles.rowLabel}>{label}</span>
            <span style={styles.rowValue}>{value}</span>
          </div>
        ))}
        <div style={styles.note}>
          共 {SHORTCUTS.length} 项快捷键，全部列在「快捷键总览」中。
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(10,10,12,0.62)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    width: 520, maxWidth: '92vw', maxHeight: 'min(84vh, 84dvh)', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    background: '#232328', border: '1px solid #3a3a42', borderRadius: 6,
    boxShadow: '0 12px 36px rgba(0,0,0,0.55)', padding: '14px 16px 12px',
  },
  panelWide: {
    width: 900, height: 'min(84vh, 84dvh)', maxWidth: '96vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  panelMedium: {
    width: 760, height: 'min(82vh, 82dvh)', maxWidth: '94vw', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  title: { fontSize: 'var(--oc-fs-dialog-title)', color: '#4da6ff', letterSpacing: 1, paddingBottom: 8, borderBottom: '1px solid #333' },
  body: { paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 },
  summary: { fontSize: 'var(--oc-fs-micro)', color: '#bbb', lineHeight: 1.6 },
  group: { display: 'flex', flexDirection: 'column', gap: 2 },
  groupTitle: { fontSize: 'var(--oc-fs-micro)', color: '#7d7d88', letterSpacing: 1, margin: '4px 0 2px' },
  row: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--oc-fs-micro)', color: '#ccc', padding: '4px 2px' },
  rowLabel: { flex: 1 },
  rowValue: { color: '#ddd', fontSize: 'var(--oc-fs-micro)' },
  kbd: {
    background: '#1b1b1f', border: '1px solid #3a3a42', borderBottomWidth: 2, borderRadius: 3,
    padding: '1px 6px', fontSize: 'var(--oc-fs-micro)', color: '#cfe4ff', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  note: { fontSize: 'var(--oc-fs-micro)', color: '#777', lineHeight: 1.6 },
  bomTable: {
    display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '40vh', overflowY: 'auto',
    border: '1px solid #333', borderRadius: 4, padding: '4px 8px',
  },
  bomRow: {
    display: 'grid', gridTemplateColumns: '44px 1fr 1.8fr 36px 52px 52px 58px',
    gap: 6, fontSize: 'var(--oc-fs-micro)', color: '#ccc', lineHeight: 1.5,
  },
  bomHead: { color: '#7d7d88', borderBottom: '1px solid #3a3a42', paddingBottom: 3 },
  bomCell: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  bomNum: { textAlign: 'right' },
  footer: { display: 'flex', justifyContent: 'flex-end', paddingTop: 12 },
  input: {
    width: 90, padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#eee', fontSize: 'var(--oc-fs-micro)',
  },
  select: {
    padding: '3px 6px', background: '#1b1b1f', border: '1px solid #3a3a42', borderRadius: 3,
    color: '#eee', fontSize: 'var(--oc-fs-micro)',
  },
  exportBtn: {
    padding: '5px 14px', background: '#2a6a3a', border: '1px solid #3f9e55', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  secondaryBtn: {
    padding: '5px 14px', background: '#2a2a30', border: '1px solid #4a4a54', borderRadius: 3,
    color: '#ddd', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
  closeBtn: {
    padding: '5px 14px', background: '#2a4a6a', border: '1px solid #3d6f9e', borderRadius: 3,
    color: '#fff', cursor: 'pointer', fontSize: 'var(--oc-fs-micro)',
  },
};
