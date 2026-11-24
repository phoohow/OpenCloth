import type { Command } from '@/commands';
import type { PomBodyKey, PomKind, PomPoint, Project } from '@/model/types';

import {
  AddPomPointCommand, DeletePomPointCommand, GeneratePomGradingCommand, ImportPomValuesCommand,
  UpdatePomPointCommand,
} from '@/commands';
import { downloadTextFile, readFileAsText } from '@/io/serialization';
import { idsOfKind } from '@/model';
import { parsePomCsv, pomMatrixCsv, pomReportCsv } from '@/production';
import { buildPomTable } from '@/production/pom';
import { useProjectStore, useUIStore } from '@/store';
import { Icon } from '@/ui/icons';
import { openFilePicker } from '@/ui/modelImport';
import { styles } from '@/ui/panels/properties/styles';
import { NumberField } from '@/ui/widgets/numberField';
import {
  ButtonRow, Field, IconButton, InlineText, Row, Section, SelectRow, SmallButton,
} from '@/ui/widgets/propertyRows';
import { reportActionError } from '@/ui/widgets/toast';
import { useState } from 'react';

const KIND_LABELS: Record<PomKind, string> = {
  distance: '两点距离',
  edge: '边长',
  body: '人体围度',
};

const EMPTY_POM: PomPoint = { id: '', name: '', part: '', kind: 'distance', refs: {}, values: {} };

const BODY_OPTIONS: Array<{ value: PomBodyKey; label: string }> = [
  { value: 'chest', label: '胸围' },
  { value: 'waist', label: '腰围' },
  { value: 'hip', label: '臀围' },
  { value: 'height', label: '身高' },
];

const ADD_OPTIONS: Array<{ value: PomAddSource; label: string }> = [
  { value: 'selection', label: '选中图形' },
  ...BODY_OPTIONS,
];

type PomAddSource = PomBodyKey | 'selection';

export function PomSection({ project }: { project: Project }) {
  const poms = project.poms ?? [];
  const selection = useUIStore(state => state.selection);
  const [addSource, setAddSource] = useState<PomAddSource>('selection');
  const [activePomId, setActivePomId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [formulaEditors, setFormulaEditors] = useState<Record<string, boolean>>({});
  const table = buildPomTable(project, poms);
  const activePom = poms.find(pom => pom.id === activePomId) ?? poms[0] ?? null;

  const selectAdded = (known: readonly string[]) => {
    const latest = useProjectStore.getState().project.poms ?? [];
    const created = latest.find(pom => !known.includes(pom.id));
    if (created) setActivePomId(created.id);
  };

  const exec = (cmd: Command): boolean => {
    try {
      useProjectStore.getState().executeCommand(cmd);
      return true;
    } catch (err) {
      reportActionError(err, 'POM 操作失败');
      return false;
    }
  };

  const execAdd = (cmd: Command): void => {
    const known = poms.map(pom => pom.id);
    if (exec(cmd)) selectAdded(known);
  };

  const nextMeasurementName = (): string => {
    const used = new Set(poms.map(pom => pom.name));
    let index = poms.length + 1;
    while (used.has(`测量点 ${index}`)) index += 1;
    return `测量点 ${index}`;
  };

  const addFromSelection = () => {
    const pointIds = idsOfKind(selection, 'point');
    const edgeIds = idsOfKind(selection, 'edge');
    const name = nextMeasurementName();
    if (pointIds.length === 2) {
      execAdd(new AddPomPointCommand({
        name, part: '自定义', kind: 'distance',
        refs: { pointAId: pointIds[0], pointBId: pointIds[1] },
      }));
      return;
    }

    if (edgeIds.length === 1) {
      execAdd(new AddPomPointCommand({
        name, part: '自定义', kind: 'edge', refs: { edgeId: edgeIds[0] },
      }));
      return;
    }

    useUIStore.getState().showToast('先在 2D 选中两点或一条边');
  };

  const add = () => {
    if (addSource === 'selection') {
      addFromSelection();
      return;
    }

    const label = BODY_OPTIONS.find(option => option.value === addSource)?.label ?? '人体围度';
    execAdd(new AddPomPointCommand({
      name: label, part: '人体', kind: 'body', refs: { bodyKey: addSource },
    }));
  };

  const remove = () => {
    if (!activePom) return;
    const index = poms.findIndex(pom => pom.id === activePom.id);
    const next = poms[index + 1] ?? poms[index - 1] ?? null;
    if (exec(new DeletePomPointCommand(activePom.id))) setActivePomId(next?.id ?? null);
  };

  const rename = (name: string) => {
    if (!activePom) return;
    const next = name.trim();
    setRenaming(false);
    if (!next || next === activePom.name) return;
    if (poms.some(item => item.id !== activePom.id && item.name === next)) {
      useUIStore.getState().showToast(`已存在名为「${next}」的测量点`);
      return;
    }

    exec(new UpdatePomPointCommand(activePom.id, { name: next }));
  };

  const generate = () => {
    const cmd = new GeneratePomGradingCommand();
    if (!exec(cmd)) return;
    const message = cmd.issues.length > 0
      ? `已生成放码；${cmd.issues.length} 项提示：${cmd.issues[0]!.message}`
      : '已生成放码';
    useUIStore.getState().showToast(message);
  };

  const exportMatrix = () => downloadTextFile(
    `${project.meta.name}-POM尺码表.csv`,
    `\ufeff${pomMatrixCsv(table)}`,
    'text/csv;charset=utf-8',
  );

  const exportReport = () => downloadTextFile(
    `${project.meta.name}-POM报告.csv`,
    `\ufeff${pomReportCsv(project.meta.name, table)}`,
    'text/csv;charset=utf-8',
  );

  const importCsv = async () => {
    const files = await openFilePicker('.csv', false);
    const file = files?.[0];
    if (!file) return;
    const parsed = parsePomCsv(await readFileAsText(file), table.sizes, poms);
    if (parsed.updates.length === 0) {
      useUIStore.getState().showToast(parsed.errors[0] ?? 'CSV 没有可导入的数值');
      return;
    }

    if (!exec(new ImportPomValuesCommand(parsed.updates))) return;
    const prefix = parsed.errors.length > 0 ? `${parsed.errors[0]!}；` : '';
    const skipped = parsed.skippedRows > 0 ? `，跳过 ${parsed.skippedRows} 行` : '';
    useUIStore.getState().showToast(`${prefix}导入 ${parsed.updates.length} 项${skipped}`);
  };

  const setPomValue = (pomId: string, values: Record<string, number>, sizeId: string, value: number) => {
    exec(new UpdatePomPointCommand(pomId, { values: { ...values, [sizeId]: value } }));
  };

  const pom = activePom ?? EMPTY_POM;
  const empty = !activePom;
  const pomTip = (tip: string) => (empty ? '还没有测量点，先在下方「测量点」行新增' : tip);
  const row = activePom ? table.rows.find(item => item.pom.id === activePom.id) : undefined;
  const hasFormula = !!activePom?.formula?.trim();
  const editingFormula = activePom ? (formulaEditors[activePom.id] ?? hasFormula) : false;

  return (
    <Section title="POM表">
      <div style={styles.sizeRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming && !empty ? (
            <Row label="名称" tip="公式里按名称引用这个测量点；回车或点勾完成">
              <Field>
                <InlineText value={pom.name} onChange={rename} />
                <IconButton title="完成改名" onClick={() => setRenaming(false)}><Icon name="check" size={10} /></IconButton>
              </Field>
            </Row>
          ) : (
            <SelectRow<string> label="名称" tip={pomTip('切换要编辑的测量点；右侧可改名或删除')}
              value={pom.id} disabled={empty}
              options={poms.map(item => ({ value: item.id, label: item.name }))}
              onChange={id => { setActivePomId(id); setRenaming(false); }}
              trailing={
                <>
                  <IconButton title="重命名" disabled={empty} onClick={() => setRenaming(true)}><Icon name="pen" size={10} /></IconButton>
                  <IconButton title="删除测量点" disabled={empty} onClick={remove}><Icon name="minus" size={10} /></IconButton>
                </>
              } />
          )}
          <Row label="部位" tip={pomTip('报告里显示的部位名称')} disabled={empty}>
            <Field>
              <InlineText value={pom.part} disabled={empty}
                onChange={part => exec(new UpdatePomPointCommand(pom.id, { part }))} />
            </Field>
          </Row>
          <Row label="方式" tip={pomTip('测量点的取值方式')} disabled={empty}>{empty ? '—' : KIND_LABELS[pom.kind]}</Row>
          {editingFormula ? (
            <Row label="公式" tip={pomTip('引用其它测量点计算各码，忽略档差；如 胸围 / 4 + 2')} disabled={empty}>
              <Field>
                <InlineText value={pom.formula ?? ''} placeholder="留空按档差" disabled={empty}
                  onChange={formula => exec(new UpdatePomPointCommand(pom.id, { formula }))} />
                <IconButton title="清除公式，改按档差" disabled={empty} onClick={() => {
                  if (hasFormula && !exec(new UpdatePomPointCommand(pom.id, { formula: '' }))) return;
                  setFormulaEditors(prev => ({ ...prev, [pom.id]: false }));
                }}><Icon name="minus" size={10} /></IconButton>
              </Field>
            </Row>
          ) : (
            <Row label="档差" tip={pomTip('相邻两码之间增减的数值(cm)；可切换为公式推算')} disabled={empty}>
              <Field>
                <NumberField value={pom.stepCm ?? 0} step={0.1} precision={2} disabled={empty}
                  onCommit={stepCm => exec(new UpdatePomPointCommand(pom.id, { stepCm }))} />
                <SmallButton compact title="改用公式推算" disabled={empty}
                  onClick={() => setFormulaEditors(prev => ({ ...prev, [pom.id]: true }))}>fx</SmallButton>
              </Field>
            </Row>
          )}
          <Row label="各码" tip={pomTip('各码的目标值(cm)')} disabled={empty}>
            {table.sizes.length === 0 ? '—' : (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {table.sizes.map(size => {
                  const value = row?.values[size.id];
                  const locked = empty || size.id === table.baseSizeId || hasFormula;
                  return (
                    <span key={size.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ color: '#888' }}>{size.label}</span>
                      {locked ? (
                        <span style={{ color: '#bbb' }}>{value === undefined ? '—' : value.toFixed(2)}</span>
                      ) : (
                        <NumberField value={value ?? 0} step={0.1} precision={2} min={0.1}
                          onCommit={next => setPomValue(pom.id, pom.values, size.id, next)} />
                      )}
                    </span>
                  );
                })}
              </span>
            )}
          </Row>
        </div>
      </div>
      <SelectRow<PomAddSource> label="测量点" tip="选择取值来源后点 + 新增测量点"
        value={addSource} options={ADD_OPTIONS} onChange={setAddSource}
        trailing={<IconButton title="新增测量点" onClick={add}><Icon name="plus" size={10} /></IconButton>} />
      <ButtonRow>
        <SmallButton onClick={generate} title="按档差或公式推算各码">生成放码</SmallButton>
        <SmallButton onClick={exportMatrix} title="导出 POM 表 CSV">导出POM表</SmallButton>
        <SmallButton onClick={exportReport} title="导出 POM 报告 CSV">导出报告</SmallButton>
        <SmallButton onClick={() => void importCsv()} title="从 CSV 导入 POM 表各码数值">导入POM表</SmallButton>
      </ButtonRow>
      {table.issues.length > 0 && (
        <div style={styles.note}>POM 提示：{table.issues.slice(0, 2).join('；')}</div>
      )}
    </Section>
  );
}
