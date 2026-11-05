import type { Project } from '@/model/types';
import { useSimStore, useUIStore } from '@/store';
import { downloadTextFile } from '@/io/serialization';
import { DEFAULT_PRESSURE_KPA_PER_MM } from '@/analysis';
import { dynamicPressureCsv } from '@/analysis';
import { ButtonRow, CheckRow, Row, Section, SelectRow, SliderRow, SmallButton } from '@/ui/widgets/propertyRows';
import type { EngineRef } from '@/ui/sceneCommands';
import { styles } from '@/ui/panels/properties/styles';

/** Body animation playback and the per-frame pressure report while the clip runs. */
export function DynamicFitSection({ project, engineRef }: { project: Project; engineRef: EngineRef }) {
  const animation = useSimStore(s => s.animation);
  const samples = useSimStore(s => s.dynamicSamples);
  const dynamicSampling = useUIStore(s => s.dynamicSampling);
  const setDynamicSampling = useUIStore(s => s.setDynamicSampling);
  const pressureMaxKpa = useUIStore(s => s.pressureMaxKpa);
  const engine = engineRef.current;
  const hasClips = animation.clips.length > 0;
  const clipIndex = animation.clipIndex >= 0 ? animation.clipIndex : 0;
  const playbackIdle = !engine || !hasClips;

  /** Starts the selected clip, or resumes the one already playing. */
  const togglePlay = () => {
    if (!engine || !hasClips) return;
    if (animation.playing) engine.pauseAvatarAnimation();
    else engine.playAvatarAnimation(clipIndex);
  };

  /** Switches clip; the new clip starts from its beginning. */
  const chooseClip = (value: string) => {
    engine?.playAvatarAnimation(Number(value));
  };

  const exportCsv = () => {
    if (!engine) return;
    downloadTextFile(
      `${project.meta.name}-动态合身.csv`,
      '\ufeff' + dynamicPressureCsv(project.meta.name, engine.getDynamicFitSamples(), {
        maxKpa: pressureMaxKpa,
        kpaPerMm: DEFAULT_PRESSURE_KPA_PER_MM,
        clipName: animation.clips[clipIndex],
      }),
      'text/csv;charset=utf-8',
    );
  };

  return (
    <Section title="动态合身">
      {hasClips ? (
        <SelectRow label="动画片段" value={String(clipIndex)}
          options={animation.clips.map((name, index) => ({ value: String(index), label: name }))}
          onChange={chooseClip} />
      ) : (
        <div style={styles.note}>当前模特没有动画片段。导入带动画的 FBX / GLB 模特后，可在这里播放动作并逐帧采样压力。</div>
      )}
      <ButtonRow>
        <SmallButton disabled={playbackIdle} onClick={togglePlay}>{animation.playing ? '暂停' : '播放'}</SmallButton>
        <SmallButton disabled={playbackIdle} onClick={() => engine?.stopAvatarAnimation()}>停止</SmallButton>
        <SmallButton disabled={!engine} onClick={() => {
          engine?.clearDynamicFitSamples();
          useSimStore.getState().setDynamicSamples(0);
        }}>清空采样</SmallButton>
      </ButtonRow>
      {hasClips && animation.durationMs > 0 && (
        <SliderRow label="动画时间" min={0} max={animation.durationMs / 1000} step={0.05} unit="s"
          value={animation.timeMs / 1000}
          onChange={v => engine?.seekAvatarAnimation(v * 1000)} />
      )}
      {hasClips && (
        <>
          <CheckRow label="逐帧采样压力" checked={dynamicSampling} onChange={setDynamicSampling} />
          <Row label="采样帧数">{samples}</Row>
          {samples > 0 && (
            <button style={styles.action} onClick={exportCsv}>导出动态压力 CSV</button>
          )}
          <div style={styles.note}>播放在时间轴上进行；采样只在模拟步进时记录，先开启时间轴播放再播放动画。压力沿用接触法向修正量的估算口径，CSV 按动画时间逐帧列出最小 / 平均 / 最大压力。</div>
        </>
      )}
    </Section>
  );
}
