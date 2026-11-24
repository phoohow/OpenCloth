import type { EngineRef } from '@/ui/sceneCommands';
import type { CSSProperties } from 'react';

import { usePerfStore, useProjectStore, useSimStore, useUIStore, type PlaybackChannel } from '@/store';
import { Icon } from '@/ui/icons';
import { SIM_STEP_OPTIONS, simStepLabel } from '@/ui/optionTables';
import { useAvatarPlayback } from '@/ui/panels/animationPlayback';
import { useSimPlayback } from '@/ui/panels/simPlayback';
import {
  TRANSPORT_ACTION, TRANSPORT_BAR, TRANSPORT_BUTTON, TRANSPORT_GROUP, TRANSPORT_INPUT,
  TRANSPORT_LABEL, TRANSPORT_LINK, TRANSPORT_LINK_ON, TRANSPORT_PARAM, TRANSPORT_PILL,
  TRANSPORT_PLAY_BUTTON, TRANSPORT_RANGE, TRANSPORT_READOUT, TRANSPORT_SEGMENT,
  TRANSPORT_SEGMENT_ACTIVE, TRANSPORT_SEGMENTS, TRANSPORT_SELECT, TRANSPORT_STATUS,
  TRANSPORT_TRAILING,
} from '@/ui/panels/transportBar';
import { resetPlayback, stepPlayback, togglePlayback } from '@/ui/playbackControl';
import { setSimulationConfig } from '@/ui/sceneCommands';
import { formatElapsed } from '@/ui/timeFormat';

const styles: Record<string, CSSProperties> = {
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  value: { color: '#4da6ff', fontWeight: 600 },
  faint: { color: '#8a94a6' },
  elapsed: { marginLeft: 'auto', fontSize: 'var(--oc-fs-body)', color: '#8a94a6', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  clearBtn: {
    width: 16, height: 16, background: 'transparent', border: 'none', color: '#888', cursor: 'pointer',
    fontSize: 'var(--oc-fs-heading)', lineHeight: 1, padding: 0, flex: '0 0 auto',
  },
  check: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--oc-fs-body)', color: '#aaa', whiteSpace: 'nowrap', flex: '0 0 auto' },
  samples: { fontSize: 'var(--oc-fs-body)', color: '#8a94a6', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' },
  sampleValue: { color: '#4da6ff', fontWeight: 600 },
};

interface PlaybackBarProps {
  projectName: string;
  engineRef: EngineRef;
}

export function PlaybackBar({ projectName, engineRef }: PlaybackBarProps) {
  const sim = useSimPlayback();
  const anim = useAvatarPlayback(projectName, engineRef);
  const channel = useUIStore(s => s.playbackChannel);
  const setChannel = useUIStore(s => s.setPlaybackChannel);
  const linked = useUIStore(s => s.linkChannels);
  const toggleLinked = useUIStore(s => s.toggleLinkChannels);
  const isDressed = useSimStore(s => s.isDressed);
  const isDressing = useSimStore(s => s.isDressing);
  const simRate = usePerfStore(s => s.simRate);
  const dt = useProjectStore(s => s.project.scene.simulation.dt);

  const onSim = channel === 'sim';
  const animPlaying = anim.animation.playing;
  const playing = linked ? sim.isPlaying || animPlaying : onSim ? sim.isPlaying : animPlaying;
  const stepBlocked = linked ? sim.atStopFrame : onSim ? sim.atStopFrame : anim.playbackIdle;
  const idleOnAnimation = !linked && !onSim && anim.playbackIdle;
  const playBlocked = idleOnAnimation || (!linked && onSim && sim.atStopFrame);
  const duration = anim.durationMs / 1000;
  const animSeconds = anim.animation.timeMs / 1000;
  const stepOptions = SIM_STEP_OPTIONS.includes(dt) ? SIM_STEP_OPTIONS : [dt, ...SIM_STEP_OPTIONS];
  const status = simStatus(isDressed, isDressing, sim.isPlaying, sim.atStopFrame);

  const playTitle = linked
    ? `${playing ? '暂停' : '播放'}动画与模拟`
    : onSim
      ? sim.atStopFrame ? '已到截至帧：改大或取消截至帧后可继续' : '播放/暂停模拟 (空格)'
      : '播放/暂停动画';

  const stepTitle = (linked || onSim) && sim.atStopFrame
    ? '已到截至帧：改大或取消截至帧后可继续'
    : linked ? '动画前进一帧并推进一步模拟' : onSim ? '单步 (.)' : '动画单步';

  return (
    <div style={TRANSPORT_BAR}>
      <div style={TRANSPORT_PILL}>
        <div style={TRANSPORT_SEGMENTS}>
          <ChannelSegment channel="sim" label="模拟" active={onSim} onPick={setChannel} />
          <ChannelSegment channel="animation" label="动画" active={!onSim} onPick={setChannel} />
        </div>
        <button
          style={{ ...TRANSPORT_LINK, ...(linked ? TRANSPORT_LINK_ON : null) }}
          onClick={toggleLinked}
          aria-pressed={linked}
          title={linked ? '联动已开：一个传输键同时驱动动画与模拟' : '联动：用一个传输键同时驱动动画与模拟'}
        >
          联动
        </button>
      </div>

      <div style={TRANSPORT_GROUP}>
        <button style={{ ...TRANSPORT_BUTTON, ...(idleOnAnimation ? styles.btnDisabled : null) }} disabled={idleOnAnimation} onClick={() => resetPlayback(engineRef)} title={linked ? '重置动画与模拟' : onSim ? '重置 (R)' : '重置动画'}>
          <Icon name="reset" size={12} />
        </button>
        <button
          style={{ ...TRANSPORT_BUTTON, ...TRANSPORT_PLAY_BUTTON, ...(playBlocked ? styles.btnDisabled : null) }}
          disabled={playBlocked}
          onClick={() => togglePlayback(engineRef)}
          title={playTitle}
        >
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <button
          style={{ ...TRANSPORT_BUTTON, ...(stepBlocked ? styles.btnDisabled : null) }}
          disabled={stepBlocked}
          onClick={() => stepPlayback(engineRef)}
          title={stepTitle}
        >
          <Icon name="step" size={12} />
        </button>
      </div>

      {onSim ? (
        <input
          style={TRANSPORT_RANGE}
          className={sim.stopFrame === null ? 'oc-range-headless' : undefined}
          type="range" min={0} max={sim.trackEnd} step={1}
          value={sim.currentFrame}
          disabled
          aria-valuetext={sim.stopFrame === null
            ? `第 ${sim.currentFrame} 帧，未设截至帧`
            : `第 ${sim.currentFrame} 帧，截至第 ${sim.stopFrame} 帧`}
          title={sim.stopFrame === null
            ? `模拟进度：当前第 ${sim.currentFrame} 帧，约 ${simRate} 步/秒；终点在右侧“截至帧”里设定`
            : `模拟进度：第 ${sim.currentFrame} / ${sim.stopFrame} 帧，约 ${simRate} 步/秒`}
        />
      ) : (
        <input
          style={TRANSPORT_RANGE}
          type="range" min={0} max={Math.max(duration, 0.01)} step={0.05}
          disabled={!anim.hasClips || duration <= 0}
          value={animSeconds}
          onChange={e => anim.seekTo(Number(e.target.value))}
          onPointerUp={anim.commitSeek}
          onKeyUp={anim.commitSeek}
          onBlur={anim.commitSeek}
          aria-valuetext={`${animSeconds.toFixed(2)} 秒，共 ${duration.toFixed(2)} 秒`}
          title="动画时间"
        />
      )}

      <div style={TRANSPORT_READOUT} title={`模拟 ${sim.currentFrame} 帧，计时 ${formatElapsed(sim.playedMs)}；动画 ${animSeconds.toFixed(2)} 秒`}>
        <span style={onSim ? styles.value : styles.faint}>
          帧 {sim.currentFrame}
          {sim.stopFrame !== null && <span style={styles.faint}> / {sim.stopFrame}</span>}
        </span>
        <span style={onSim ? styles.faint : styles.value}>
          {animSeconds.toFixed(2)}<span style={styles.faint}> / {duration.toFixed(2)} s</span>
        </span>
      </div>

      {onSim ? (
        <div style={TRANSPORT_PARAM} title={`每帧一步，每步 ${simStepLabel(dt)}；步长越小越稳、播放越慢`}>
          <span style={TRANSPORT_LABEL}>步长</span>
          <select
            style={TRANSPORT_SELECT}
            value={String(dt)}
            onChange={e => setSimulationConfig('修改仿真步长', { dt: Number(e.target.value) })}
          >
            {stepOptions.map(value => (
              <option key={String(value)} value={String(value)}>{simStepLabel(value)}</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={TRANSPORT_PARAM} title="选择身体动作片段">
          <span style={TRANSPORT_LABEL}>动作</span>
          <select
            style={TRANSPORT_SELECT}
            value={String(anim.clipIndex)}
            disabled={!anim.hasClips}
            onChange={e => anim.chooseClip(e.target.value)}
          >
            {!anim.hasClips && <option value="0">无片段</option>}
            {anim.animation.clips.map((name, index) => (
              <option key={name} value={String(index)}>{name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={TRANSPORT_TRAILING}>
        {onSim ? (
          <>
            <span style={TRANSPORT_LABEL}>截至帧</span>
            <input
              style={TRANSPORT_INPUT}
              type="number"
              min={sim.currentFrame}
              step={1}
              placeholder="不限"
              value={sim.stopDraft}
              onChange={e => sim.setStopDraft(e.target.value)}
              onBlur={sim.commitStopFrame}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') sim.setStopDraft(sim.stopFrame === null ? '' : String(sim.stopFrame));
              }}
              title={`播到第 ${sim.stopFrame ?? '—'} 帧暂停，不可小于当前帧`}
            />
            {sim.stopFrame !== null && (
              <button style={styles.clearBtn} onClick={sim.clearStopFrame} title="取消">×</button>
            )}
            <span style={styles.elapsed} title={`本次已播放 ${formatElapsed(sim.playedMs)}`}>
              <span style={styles.faint}>计时</span> {formatElapsed(sim.playedMs)}
            </span>
          </>
        ) : (
          <>
            <label style={styles.check} title="记录动画期间每帧的接触压力">
              <input type="checkbox" checked={anim.dynamicSampling} onChange={e => anim.setDynamicSampling(e.target.checked)} />
              采样压力
            </label>
            <span style={styles.samples} title={`已采样 ${anim.samples} 帧`}>
              <span style={styles.sampleValue}>{anim.samples}</span> 帧
            </span>
            <button
              style={{ ...TRANSPORT_ACTION, marginLeft: 'auto' }}
              disabled={!engineRef.current || anim.samples === 0}
              onClick={anim.exportCsv}
              title="导出采样压力 CSV"
            >
              导出 CSV
            </button>
            <button
              style={TRANSPORT_ACTION}
              disabled={!engineRef.current}
              onClick={anim.clearSamples}
              title="丢弃已采样的帧"
            >
              清空采样
            </button>
          </>
        )}
      </div>

      <span style={TRANSPORT_STATUS}>
        <span style={{ color: status.color }}>
          <Icon name="status-dot" size={8} style={{ marginRight: 5 }} />{status.text}
        </span>
      </span>
    </div>
  );
}

function ChannelSegment({ channel, label, active, onPick }: {
  channel: PlaybackChannel;
  label: string;
  active: boolean;
  onPick: (channel: PlaybackChannel) => void;
}) {
  return (
    <button
      style={{ ...TRANSPORT_SEGMENT, ...(active ? TRANSPORT_SEGMENT_ACTIVE : null) }}
      onClick={() => onPick(channel)}
      aria-pressed={active}
      title={`传输键和轨道操作${label}`}
    >
      {label}
    </button>
  );
}

function simStatus(
  isDressed: boolean, isDressing: boolean, isPlaying: boolean, atStopFrame: boolean,
): { color: string; text: string } {
  if (isDressing) return { color: '#4da6ff', text: '着装中' };
  if (!isDressed) return { color: '#e0a040', text: '未着装' };
  if (isPlaying) return { color: '#50c878', text: '模拟中' };
  if (atStopFrame) return { color: '#4da6ff', text: '已到截至帧' };
  return { color: '#888', text: '已暂停' };
}
