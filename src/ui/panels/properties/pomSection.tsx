import { useState } from 'react';
import type { PomBodyKey, PomKind, Project } from '../../../core/model/types';
import { buildPomTable } from '../../../pattern/pom/pomTable';
import {
  AddPomPointCommand, DeletePomPointCommand, GeneratePomGradingCommand,
  ImportPomValuesCommand, UpdatePomPointCommand,
} from '../../../core/command/pomCommands';
import { parsePomCsv, pomMatrixCsv, pomReportCsv } from '../../../io/pomCsv';
import type { Command } from '../../../core/command/command';
import { downloadTextFile, readFileAsText } from '../../../io/codec';
import { idsOfKind } from '../../elementSelection';
import { openFilePicker } from '../../modelImport';
import { reportActionError } from '../../widgets/toast';
import { NumberField } from '../../widgets/numberField';
import {
  ButtonRow, FlexSelect, InlineText, Row, Section, SmallButton,
} from '../../widgets/propertyRows';
import { useProjectStore, useUIStore } from '../../../store/stores';
import { styles } from './styles';

/** Display name of each POM anchor kind. */
const KIND_LABELS: Record<PomKind, string> = {
  distance: '两点距离',
  edge: '边长',
  body: '人体围度',
};

/** Body dimensions a body-anchored POM can read. */
const BODY_OPTIONS: Array<{ value: PomBodyKey; label: string }> = [
  { value: 'chest', label: '胸围' },
  { value: 'waist', label: '腰围' },
  { value: 'hip', label: '臀围' },
  { value: 'height', label: '身高' },
];

/** Size chart, POM table, rule grading and the CSV exchange of one project. */
export function PomSection({ project }: { project: Project }) {
  const poms = project.poms ?? [];
  const selection = useUIStore(state => state.selection);
  const [bodyKey, setBodyKey] = useState<PomBodyKey>('chest');
  const table = buildPomTable(project, poms);
  const baseSize = table.sizes.find(size => size.id === table.baseSizeId) ?? null;

  const exec = (cmd: Command): boolean => {
    try {
      useProjectStore.getState().executeCommand(cmd);
      return true;
    } catch (err) {
      reportActionError(err, 'POM 操作失败');
      return false;
    }
  };

  const addFromSelection = () => {
    const pointIds = idsOfKind(selection, 'point');
    const edgeIds = idsOfKind(selection, 'edge');
    const name = `测量点 ${poms.length + 1}`;
    if (pointIds.length === 2) {
      exec(new AddPomPointCommand({
        name, part: '自定义', kind: 'distance',
        refs: { pointAId: pointIds[0], pointBId: pointIds[1] },
      }));
      return;
    }
    if (edgeIds.length === 1) {
      exec(new AddPomPointCommand({
        name, part: '自定义', kind: 'edge', refs: { edgeId: edgeIds[0] },
      }));
      return;
    }
    useUIStore.getState().showToast('在 2D 窗格里选中两个点或一条边，再加测量点');
  };

  const addBody = () => {
    const label = BODY_OPTIONS.find(option => option.value === bodyKey)?.label ?? '人体围度';
    exec(new AddPomPointCommand({ name: label, part: '人体', kind: 'body', refs: { bodyKey } }));
  };

  const generate = () => {
    const cmd = new GeneratePomGradingCommand();
    if (!exec(cmd)) return;
    const message = cmd.issues.length > 0
      ? `已生成全部尺码；${cmd.issues.length} 项提示：${cmd.issues[0]!.message}`
      : '已生成全部尺码的放码';
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

  return (
    <Section title="POM 尺寸表">
      {poms.length === 0 ? (
        <Row label="测量点">未建立</Row>
      ) : (
        poms.map(pom => {
          const row = table.rows.find(item => item.pom.id === pom.id);
          const baseValue = row?.baseValue ?? null;
          return (
            <div key={pom.id} style={styles.sizeRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Row label="名称">
                  <InlineText value={pom.name} title="测量点名称，公式按名称引用"
                    onChange={name => exec(new UpdatePomPointCommand(pom.id, { name }))} />
                  <SmallButton compact title="删除测量点"
                    onClick={() => exec(new DeletePomPointCommand(pom.id))}>−</SmallButton>
                </Row>
                <Row label="部位">
                  <InlineText value={pom.part} title="报告里的部位名称"
                    onChange={part => exec(new UpdatePomPointCommand(pom.id, { part }))} />
                </Row>
                <Row label="方式">{KIND_LABELS[pom.kind]}</Row>
                <Row label="基码">{baseValue === null ? '—' : `${baseValue.toFixed(2)} cm`}</Row>
                <Row label="档差(cm/码)">
                  <NumberField value={pom.stepCm ?? 0} step={0.1} precision={2} title="每个尺码序号增加或减少的数值"
                    onCommit={stepCm => exec(new UpdatePomPointCommand(pom.id, { stepCm }))} />
                </Row>
                <Row label="公式">
                  <InlineText value={pom.formula ?? ''} placeholder="留空按档差"
                    title="引用其它测量点名称的四则运算，例如 胸围 / 4 + 2"
                    onChange={formula => exec(new UpdatePomPointCommand(pom.id, { formula }))} />
                  {pom.formula?.trim() && (
                    <SmallButton compact title="清除公式"
                      onClick={() => exec(new UpdatePomPointCommand(pom.id, { formula: '' }))}>×</SmallButton>
                  )}
                </Row>
                <Row label="各码">
                  {table.sizes.length === 0 ? '未建立尺码' : (
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {table.sizes.map(size => {
                        const value = row?.values[size.id];
                        const locked = size.id === table.baseSizeId || !!pom.formula?.trim();
                        return (
                          <span key={size.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ color: '#888' }}>{size.label}</span>
                            {locked ? (
                              <span style={{ color: '#bbb' }}>{value === undefined ? '—' : value.toFixed(2)}</span>
                            ) : (
                              <NumberField value={value ?? 0} step={0.1} precision={2} min={0.1}
                                title="这一码的目标值"
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
          );
        })
      )}
      <ButtonRow>
        <SmallButton onClick={addFromSelection}>由选中两点 / 边加测量点</SmallButton>
        <SmallButton onClick={generate}>生成全部尺码放码</SmallButton>
      </ButtonRow>
      <Row label="加人体围度">
        <FlexSelect<PomBodyKey> value={bodyKey} options={BODY_OPTIONS} onChange={setBodyKey} />
        <SmallButton compact onClick={addBody} title="从模特参数读取该围度">＋</SmallButton>
      </Row>
      <ButtonRow>
        <SmallButton onClick={exportMatrix}>导出尺码表 CSV</SmallButton>
        <SmallButton onClick={exportReport}>导出 POM 报告 CSV</SmallButton>
        <SmallButton onClick={() => void importCsv()}>导入尺码表 CSV</SmallButton>
      </ButtonRow>
      {table.issues.length > 0 && (
        <div style={styles.note}>POM 提示：{table.issues.slice(0, 2).join('；')}</div>
      )}
      <div style={styles.note}>基码数值从版型或模特实测，锁定不可改；其它码先取手填值，没有手填时按「基码 + 档差 × 码序差」。公式按测量点名称计算，支持 + - * / 与括号。生成放码会重写全部尺码的逐点偏移，每个测量点把长度差平均分配到两端点。{baseSize ? ` 当前基码：${baseSize.label}。` : ''}</div>
    </Section>
  );
}
