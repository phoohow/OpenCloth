import type { Avatar, Project } from '@/model/types';
import { patchValue, type EngineRef } from '@/ui/sceneCommands';
import { BUNDLED_AVATARS } from '@/model';
import { cloneJoints, POSE_PRESETS, posePresetParams } from '@/avatar';
import { importAvatarViaPicker } from '@/ui/modelImport';
import {
  ButtonRow, IconButton, Row, Section, SelectRow, SliderRow, SmallButton,
} from '@/ui/widgets/propertyRows';
import { Icon } from '@/ui/icons';
import { styles } from '@/ui/panels/properties/styles';
import { CUSTOM_MODEL, PROCEDURAL_MODEL, toDeg, toRad } from '@/ui/panels/properties/constants';

/** Joint rotation fields the avatar sliders edit. */
type JointKey = 'shoulderFlexRad' | 'elbowBendRad' | 'hipFlexRad' | 'kneeBendRad';

export function AvatarData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;

  /** Replaces the avatar record so the 3D view rebuilds the body. */
  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  /** Joint angle of one side in degrees. */
  const jointDeg = (side: 'left' | 'right', key: JointKey) =>
    toDeg(avatar.params.joints?.[side]?.[key] ?? 0);

  /** Writes one joint angle, keeping the other joints and the global pose. */
  const setJoint = (side: 'left' | 'right', key: JointKey, label: string, degrees: number) => {
    const joints = cloneJoints(avatar.params.joints) ?? {};
    joints[side] = { ...joints[side], [key]: toRad(degrees) };
    setAvatar(label, { params: { ...avatar.params, joints } });
  };

  return (
    <>
      <AvatarModelData project={project} engineRef={engineRef} />
      <Section title="体型">
        <SliderRow label="身高" min={140} max={200} step={1} unit="cm" value={avatar.params.heightCm} commitOnRelease
          onChange={v => setAvatar('修改身高', { params: { ...avatar.params, heightCm: v } })} />
        <SliderRow label="胸围" min={60} max={140} step={1} unit="cm" value={avatar.params.chestCm} commitOnRelease
          onChange={v => setAvatar('修改胸围', { params: { ...avatar.params, chestCm: v } })} />
        <SliderRow label="腰围" min={50} max={130} step={1} unit="cm" value={avatar.params.waistCm} commitOnRelease
          onChange={v => setAvatar('修改腰围', { params: { ...avatar.params, waistCm: v } })} />
        <SliderRow label="臀围" min={60} max={150} step={1} unit="cm" value={avatar.params.hipCm} commitOnRelease
          onChange={v => setAvatar('修改臀围', { params: { ...avatar.params, hipCm: v } })} />
      </Section>
      <Section title="姿态">
        <SliderRow label="手臂外展" min={0} max={90} step={1} unit="°" value={toDeg(avatar.params.poseArmAngleRad ?? 0.12)} commitOnRelease
          onChange={v => setAvatar('修改手臂外展', { params: { ...avatar.params, poseArmAngleRad: toRad(v) } })} />
        <SliderRow label="腿部开合" min={0} max={45} step={1} unit="°" value={toDeg(avatar.params.poseLegSpreadRad ?? 0)} commitOnRelease
          onChange={v => setAvatar('修改腿部开合', { params: { ...avatar.params, poseLegSpreadRad: toRad(v) } })} />
        <SliderRow label="躯干倾斜" min={-20} max={20} step={1} unit="°" value={toDeg(avatar.params.poseTorsoLeanRad ?? 0)} commitOnRelease
          onChange={v => setAvatar('修改躯干倾斜', { params: { ...avatar.params, poseTorsoLeanRad: toRad(v) } })} />
        <div style={styles.note}>肩与肘</div>
        <SliderRow label="左肩前摆" min={-80} max={80} step={1} unit="°" value={jointDeg('left', 'shoulderFlexRad')} commitOnRelease
          onChange={v => setJoint('left', 'shoulderFlexRad', '修改左肩', v)} />
        <SliderRow label="右肩前摆" min={-80} max={80} step={1} unit="°" value={jointDeg('right', 'shoulderFlexRad')} commitOnRelease
          onChange={v => setJoint('right', 'shoulderFlexRad', '修改右肩', v)} />
        <SliderRow label="左肘弯曲" min={0} max={135} step={1} unit="°" value={jointDeg('left', 'elbowBendRad')} commitOnRelease
          onChange={v => setJoint('left', 'elbowBendRad', '修改左肘', v)} />
        <SliderRow label="右肘弯曲" min={0} max={135} step={1} unit="°" value={jointDeg('right', 'elbowBendRad')} commitOnRelease
          onChange={v => setJoint('right', 'elbowBendRad', '修改右肘', v)} />
        <div style={styles.note}>髋与膝</div>
        <SliderRow label="左髋前摆" min={-80} max={80} step={1} unit="°" value={jointDeg('left', 'hipFlexRad')} commitOnRelease
          onChange={v => setJoint('left', 'hipFlexRad', '修改左髋', v)} />
        <SliderRow label="右髋前摆" min={-80} max={80} step={1} unit="°" value={jointDeg('right', 'hipFlexRad')} commitOnRelease
          onChange={v => setJoint('right', 'hipFlexRad', '修改右髋', v)} />
        <SliderRow label="左膝弯曲" min={0} max={120} step={1} unit="°" value={jointDeg('left', 'kneeBendRad')} commitOnRelease
          onChange={v => setJoint('left', 'kneeBendRad', '修改左膝', v)} />
        <SliderRow label="右膝弯曲" min={0} max={120} step={1} unit="°" value={jointDeg('right', 'kneeBendRad')} commitOnRelease
          onChange={v => setJoint('right', 'kneeBendRad', '修改右膝', v)} />
        <Row label="姿态预设">
          <ButtonRow>
            {POSE_PRESETS.map(preset => (
              <SmallButton
                key={preset.key}
                title={`手臂 ${preset.armDeg}° · 腿 ${preset.legDeg}° · 躯干 ${preset.leanDeg}°${preset.joints ? ' · 关节' : ''}`}
                onClick={() => setAvatar('切换姿态', { params: posePresetParams(avatar.params, preset) })}
              >{preset.label}</SmallButton>
            ))}
          </ButtonRow>
        </Row>
        <div style={styles.note}>关节角度只作用于程序模特；导入模特请用动态合身的动画播放。体型与姿态改动都会重建模特、布料与模拟状态。</div>
      </Section>
    </>
  );
}

/** Model source of the avatar; selecting a bundled model also adopts its measurements. */
function AvatarModelData({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const avatar = project.avatar;
  const bundled = BUNDLED_AVATARS.find(b => b.url === avatar.glbUrl);
  const modelValue = avatar.source === 'procedural'
    ? PROCEDURAL_MODEL
    : bundled ? bundled.url : CUSTOM_MODEL;
  const modelOptions = [
    ...(avatar.source === 'glb' && !bundled ? [{ value: CUSTOM_MODEL, label: `自定义：${avatar.modelName ?? '模型'}` }] : []),
    ...BUNDLED_AVATARS.map(b => ({ value: b.url, label: b.label })),
    { value: PROCEDURAL_MODEL, label: '程序模特' },
  ];

  /** Replaces the avatar record so the 3D view rebuilds the body. */
  const setAvatar = (label: string, patch: Partial<Avatar>) => patchValue(
    label,
    p => p.avatar,
    (ctx, value) => { ctx.project.avatar = { ...value }; },
    { ...avatar, ...patch },
  );

  /** Selecting a bundled model also adopts the measurements that fit its mesh. */
  const chooseModel = (value: string) => {
    if (value === PROCEDURAL_MODEL) setAvatar('恢复程序模特', { source: 'procedural' });
    else if (value !== CUSTOM_MODEL) {
      const model = BUNDLED_AVATARS.find(b => b.url === value);
      if (model) setAvatar('切换模特', {
        source: 'glb', glbUrl: value, modelName: undefined, params: { ...model.params },
      });
    }
  };

  return (
    <Section title="模型来源">
      <SelectRow label="模型" value={modelValue} options={modelOptions} onChange={chooseModel}
        trailing={
          <IconButton title="导入模特" disabled={!engineRef.current}
            onClick={() => engineRef.current && void importAvatarViaPicker()}><Icon name="plus" size={12} /></IconButton>
        } />
    </Section>
  );
}
