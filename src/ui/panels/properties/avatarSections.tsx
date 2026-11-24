import type { Avatar, AvatarPose, Project } from '@/model/types';

import { AVATAR_PRESETS, matchAvatarPreset } from '@/model/defaults';
import { Icon } from '@/ui/icons';
import { importAvatarViaPicker } from '@/ui/modelImport';
import { CUSTOM_MODEL } from '@/ui/panels/properties/constants';
import { styles } from '@/ui/panels/properties/styles';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import {
  IconButton, Row, Section, SelectRow, SliderRow,
} from '@/ui/widgets/propertyRows';

const POSE_OPTIONS: Array<{ value: AvatarPose; label: string }> = [
  { value: 'a', label: 'A 姿态' },
  { value: 't', label: 'T 姿态' },
];

const TAILORED_MODEL = 'tailored';

export function AvatarData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;
  const params = avatar.params;
  const imported = avatar.source === 'glb';

  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  const setParam = (label: string, patch: Partial<typeof params>) =>
    setAvatar(label, { params: { ...params, ...patch } });

  const preset = matchAvatarPreset(params)?.id;

  const modelOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
    ...AVATAR_PRESETS.map(item => ({ value: item.id, label: item.label })),
    ...(preset || imported ? [] : [{ value: TAILORED_MODEL, label: '自定义', disabled: true }]),
    ...(imported ? [{ value: CUSTOM_MODEL, label: '导入模型' }] : []),
  ];

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
      <Section title="来源">
        <SelectRow label="形体" value={imported ? CUSTOM_MODEL : preset ?? TAILORED_MODEL}
          options={modelOptions} onChange={chooseModel}
          trailing={
            <IconButton title="导入模特" disabled={!engineRef.current}
              onClick={() => engineRef.current && void importAvatarViaPicker()}><Icon name="plus" size={10} /></IconButton>
          } />
        {imported && (
          <Row label="">
            <div style={styles.note}>仅用于显示</div>
          </Row>
        )}
      </Section>
      <Section title="姿态">
        {imported && <div style={styles.note}>导入的模型只按身高缩放，姿态与其余体型参数不生效</div>}
        <SelectRow label="姿态" value={params.pose ?? 'a'} options={POSE_OPTIONS} disabled={imported}
          onChange={v => setParam('修改姿态', { pose: v })} />
      </Section>
      <Section title="体型">
        <SliderRow label="身高" tip="cm" min={45} max={220} step={1} value={params.heightCm} commitOnRelease
          onChange={v => setParam('修改身高', { heightCm: v })} />
        <SliderRow label="胸围" tip="cm" min={35} max={140} step={1} value={params.chestCm} commitOnRelease disabled={imported}
          onChange={v => setParam('修改胸围', { chestCm: v })} />
        <SliderRow label="腰围" tip="cm" min={30} max={130} step={1} value={params.waistCm} commitOnRelease disabled={imported}
          onChange={v => setParam('修改腰围', { waistCm: v })} />
        <SliderRow label="臀围" tip="cm" min={35} max={150} step={1} value={params.hipCm} commitOnRelease disabled={imported}
          onChange={v => setParam('修改臀围', { hipCm: v })} />
        <SliderRow label="性别" tip="偏男性或偏女性的程度（%）" min={0} max={100} step={1} value={Math.round((params.gender ?? 0) * 100)} commitOnRelease disabled={imported}
          onChange={v => setParam('修改性别', { gender: v / 100 })} />
        <SliderRow label="年龄" tip="岁" min={1} max={90} step={1} value={Math.round(params.ageYears ?? 25)} commitOnRelease disabled={imported}
          onChange={v => setParam('修改年龄', { ageYears: v })} />
        <SliderRow label="肌肉" tip="肌肉量（%）" min={0} max={100} step={1} value={Math.round((params.muscle ?? 0.5) * 100)} commitOnRelease disabled={imported}
          onChange={v => setParam('修改肌肉', { muscle: v / 100 })} />
        <SliderRow label="体重" tip="偏瘦或偏胖的程度（%）" min={0} max={100} step={1} value={Math.round((params.weight ?? 0.5) * 100)} commitOnRelease disabled={imported}
          onChange={v => setParam('修改体重', { weight: v / 100 })} />
      </Section>
    </>
  );
}
