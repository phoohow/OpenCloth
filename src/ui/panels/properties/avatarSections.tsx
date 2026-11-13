import type { Avatar, AvatarPose, Project } from '@/model/types';
import { AVATAR_PRESETS } from '@/model/defaults';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import { importAvatarViaPicker } from '@/ui/modelImport';
import {
  IconButton, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';
import { Icon } from '@/ui/icons';
import { styles } from '@/ui/panels/properties/styles';
import { CUSTOM_MODEL } from '@/ui/panels/properties/constants';

const POSE_OPTIONS: Array<{ value: AvatarPose; label: string }> = [
  { value: 'a', label: 'A 姿态' },
  { value: 't', label: 'T 姿态' },
];

/** Model select value of a figure whose measurements no longer match a preset. */
const TAILORED_MODEL = 'tailored';

export function AvatarData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;
  const params = avatar.params;
  const imported = avatar.source === 'glb';

  /** Replaces the avatar record so the 3D view rebuilds the body. */
  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  /** Writes one measurement, which rebuilds the body and re-drapes the garment. */
  const setParam = (label: string, patch: Partial<typeof params>) =>
    setAvatar(label, { params: { ...params, ...patch } });

  const preset = AVATAR_PRESETS.find(item =>
    item.params.heightCm === params.heightCm
    && item.params.chestCm === params.chestCm
    && item.params.waistCm === params.waistCm
    && item.params.hipCm === params.hipCm
    && item.params.gender === params.gender
    && item.params.ageYears === params.ageYears)?.id;

  const modelOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
    ...AVATAR_PRESETS.map(item => ({ value: item.id, label: item.label })),
    ...(preset || imported ? [] : [{ value: TAILORED_MODEL, label: '自定义', disabled: true }]),
    ...(imported ? [{ value: CUSTOM_MODEL, label: '导入的模特' }] : []),
  ];

  /** Switches the figure, or brings an imported model back to a generated one. */
  const chooseModel = (id: string) => {
    const chosen = AVATAR_PRESETS.find(item => item.id === id);
    if (!chosen) return;
    setAvatar('切换模特', {
      source: 'makehuman',
      glbObjectKey: undefined,
      glbUrl: undefined,
      modelName: undefined,
      params: { ...chosen.params, pose: params.pose },
    });
  };

  return (
    <>
      <Section title="模型来源">
        <SelectRow label="模特" value={imported ? CUSTOM_MODEL : preset ?? TAILORED_MODEL}
          options={modelOptions} onChange={chooseModel}
          trailing={
            <IconButton title="导入模特" disabled={!engineRef.current}
              onClick={() => engineRef.current && void importAvatarViaPicker()}><Icon name="plus" size={12} /></IconButton>
          } />
        {imported && (
          <Row label="">
            <div style={styles.note}>导入模型仅用于显示</div>
          </Row>
        )}
      </Section>
      <Section title="姿态">
        <SelectRow label="姿态" value={params.pose ?? 'a'} options={POSE_OPTIONS}
          onChange={v => setParam('修改姿态', { pose: v })} />
      </Section>
      <Section title="体型">
        <SliderRow label="身高" min={45} max={220} step={1} unit="cm" value={params.heightCm} commitOnRelease
          onChange={v => setParam('修改身高', { heightCm: v })} />
        <SliderRow label="胸围" min={35} max={140} step={1} unit="cm" value={params.chestCm} commitOnRelease
          onChange={v => setParam('修改胸围', { chestCm: v })} />
        <SliderRow label="腰围" min={30} max={130} step={1} unit="cm" value={params.waistCm} commitOnRelease
          onChange={v => setParam('修改腰围', { waistCm: v })} />
        <SliderRow label="臀围" min={35} max={150} step={1} unit="cm" value={params.hipCm} commitOnRelease
          onChange={v => setParam('修改臀围', { hipCm: v })} />
        <SliderRow label="性别" min={0} max={100} step={1} unit="%" value={Math.round((params.gender ?? 0) * 100)} commitOnRelease
          onChange={v => setParam('修改性别', { gender: v / 100 })} />
        <SliderRow label="年龄" min={1} max={90} step={1} unit="岁" value={Math.round(params.ageYears ?? 25)} commitOnRelease
          onChange={v => setParam('修改年龄', { ageYears: v })} />
        <SliderRow label="肌肉" min={0} max={100} step={1} unit="%" value={Math.round((params.muscle ?? 0.5) * 100)} commitOnRelease
          onChange={v => setParam('修改肌肉', { muscle: v / 100 })} />
        <SliderRow label="体重" min={0} max={100} step={1} unit="%" value={Math.round((params.weight ?? 0.5) * 100)} commitOnRelease
          onChange={v => setParam('修改体重', { weight: v / 100 })} />
      </Section>
    </>
  );
}
