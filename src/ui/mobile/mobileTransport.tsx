import { useProjectStore, useUIStore, type PlaybackChannel } from '@/store';
import { Icon, type IconName } from '@/ui/icons';
import { SIM_STEP_OPTIONS, simStepLabel } from '@/ui/optionTables';
import { useAvatarPlayback } from '@/ui/panels/animationPlayback';
import { useSimPlayback } from '@/ui/panels/simPlayback';
import { resetPlayback, stepPlayback, togglePlayback } from '@/ui/playbackControl';
import { setSimulationConfig, type EngineRef } from '@/ui/sceneCommands';
import { formatElapsed } from '@/ui/timeFormat';
import { type CSSProperties, type ReactNode } from 'react';

const styles: Record<string, CSSProperties> = {
  bar: {
    flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 6,
    padding: '6px 8px', paddingBottom: 'calc(6px + env(safe-area-inset-bottom))',
    background: '#202024', borderTop: '1px solid #333',
  },
  extra: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
    paddingBottom: 6, borderBottom: '1px solid #2e2e35',
  },
  progressRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  range: { flex: '1 1 auto', minWidth: 0 },
  readout: {
    flex: '0 0 auto', fontSize: 'var(--oc-fs-body)', color: '#8a94a6',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  },
  row: { display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' },
  segments: {
    flex: '0 0 auto', display: 'flex', background: '#2a2a30',
    border: '1px solid #3a3a42', borderRadius: 7, overflow: 'hidden',
  },
  segment: {
    minWidth: 42, minHeight: 34, padding: '0 8px',
    background: 'transparent', border: 'none', color: '#9a9aa4',
    fontSize: 'var(--oc-fs-body)', cursor: 'pointer',
  },
  segmentActive: { background: '#2a4a6a', color: '#fff' },
  push: { flex: '1 1 auto' },
  gap: { flex: '0 0 auto', width: 10 },
  divider: {
    flex: '0 0 auto', alignSelf: 'center', width: 1, height: 24,
    background: '#4a4a52', margin: '0 3px',
  },
  key: {
    flex: '0 0 auto', width: 38, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 7,
    color: '#ccc', cursor: 'pointer',
  },
  keyPrimary: { width: 44, background: '#2f3a46', border: '1px solid #4a5a6a', color: '#fff' },
  keyDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  field: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--oc-fs-body)', color: '#9a9aa4' },
  fieldLabel: { flex: '0 0 auto' },
  input: {
    height: 32, padding: '0 6px', background: '#2a2a30', border: '1px solid #3a3a42',
    borderRadius: 6, color: '#ddd', fontSize: 'var(--oc-fs-body)',
  },
  pill: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
    minHeight: 32, padding: '0 9px', background: '#2a2a30', border: '1px solid #3a3a42',
    borderRadius: 6, color: '#ccc', fontSize: 'var(--oc-fs-body)', cursor: 'pointer',
  },
  pillActive: { background: '#2a4a6a', border: '1px solid #4da6ff', color: '#fff' },
};

interface MobileTransportProps {
  engineRef: EngineRef;
  onOpenProps: () => void;
}

export function MobileTransport({ engineRef, onOpenProps }: MobileTransportProps) {
  const projectName = useProjectStore(s => s.project.meta.name);
  const dt = useProjectStore(s => s.project.scene.simulation.dt);
  const sim = useSimPlayback();
  const anim = useAvatarPlayback(projectName, engineRef);
  const channel = useUIStore(s => s.playbackChannel);
  const setChannel = useUIStore(s => s.setPlaybackChannel);
  const linked = useUIStore(s => s.linkChannels);
  const toggleLinked = useUIStore(s => s.toggleLinkChannels);

  const onSim = channel === 'sim';
  const animPlaying = anim.animation.playing;
  const playing = linked ? sim.isPlaying || animPlaying : onSim ? sim.isPlaying : animPlaying;
  const stepBlocked = linked ? sim.atStopFrame : onSim ? sim.atStopFrame : anim.playbackIdle;
  const idleOnAnimation = !linked && !onSim && anim.playbackIdle;
  const playBlocked = idleOnAnimation || (!linked && onSim && sim.atStopFrame);
  const duration = anim.durationMs / 1000;
  const animSeconds = anim.animation.timeMs / 1000;
  const stepOptions = SIM_STEP_OPTIONS.includes(dt) ? SIM_STEP_OPTIONS : [dt, ...SIM_STEP_OPTIONS];

  const playTitle = linked
    ? `${playing ? '暂停' : '播放'}动画与模拟`
    : onSim
      ? sim.atStopFrame ? '已到截至帧' : '播放/暂停模拟'
      : '播放/暂停动画';
  const stepTitle = (linked || onSim) && sim.atStopFrame ? '已到截至帧' : '单步';

  return (
    <div style={styles.bar}>
      <div style={styles.extra}>
        {onSim ? (
          <>
            <Field label="步长">
              <select
                style={styles.input}
                value={String(dt)}
                onChange={e => setSimulationConfig('修改仿真步长', { dt: Number(e.target.value) })}
              >
                {stepOptions.map(value => (
                  <option key={String(value)} value={String(value)}>{simStepLabel(value)}</option>
                ))}
              </select>
            </Field>
            <Field label="截至帧">
              <input
                style={{ ...styles.input, width: 68 }}
                type="number"
                min={sim.currentFrame}
                step={1}
                placeholder="不限"
                value={sim.stopDraft}
                onChange={e => sim.setStopDraft(e.target.value)}
                onBlur={sim.commitStopFrame}
              />
            </Field>
            {sim.stopFrame !== null && (
              <TextButton label="取消截至帧" onClick={sim.clearStopFrame} />
            )}
            <span style={styles.readout}>计时 {formatElapsed(sim.playedMs)}</span>
          </>
        ) : (
          <>
            <Field label="动作">
              <select
                style={{ ...styles.input, width: 88 }}
                value={String(anim.clipIndex)}
                disabled={!anim.hasClips}
                onChange={e => anim.chooseClip(e.target.value)}
              >
                {!anim.hasClips && <option value="0">无片段</option>}
                {anim.animation.clips.map((name, index) => (
                  <option key={name} value={String(index)}>{name}</option>
                ))}
              </select>
            </Field>
            <CheckButton
              label="采样压力"
              checked={anim.dynamicSampling}
              onChange={anim.setDynamicSampling}
            />
            <TextButton
              label="导出 CSV"
              disabled={!engineRef.current || anim.samples === 0}
              onClick={anim.exportCsv}
            />
            <TextButton
              label="清空"
              disabled={!engineRef.current}
              onClick={anim.clearSamples}
            />
          </>
        )}
      </div>

      <div style={styles.progressRow}>
        {onSim ? (
          <input
            style={styles.range}
            type="range" min={0} max={sim.trackEnd} step={1}
            value={sim.currentFrame}
            disabled
            aria-valuetext={`第 ${sim.currentFrame} 帧`}
          />
        ) : (
          <input
            style={styles.range}
            type="range" min={0} max={Math.max(duration, 0.01)} step={0.05}
            disabled={!anim.hasClips || duration <= 0}
            value={animSeconds}
            onChange={e => anim.seekTo(Number(e.target.value))}
            onPointerUp={anim.commitSeek}
            onKeyUp={anim.commitSeek}
            onBlur={anim.commitSeek}
            aria-valuetext={`${animSeconds.toFixed(2)} 秒，共 ${duration.toFixed(2)} 秒`}
          />
        )}
        <span style={styles.readout}>
          {onSim
            ? `帧 ${sim.currentFrame}${sim.stopFrame !== null ? ` / ${sim.stopFrame}` : ''}`
            : `${animSeconds.toFixed(2)} / ${duration.toFixed(2)} s · ${anim.samples} 帧`}
        </span>
      </div>

      <div style={styles.row}>
        <div style={styles.segments}>
          <Segment channel="sim" label="模拟" active={onSim} onPick={setChannel} />
          <Segment channel="animation" label="动画" active={!onSim} onPick={setChannel} />
        </div>
        <TextButton
          label="联动"
          active={linked}
          onClick={toggleLinked}
        />
        <span style={styles.gap} />
        <TransportKey icon="reset" title={linked ? '重置动画与模拟' : onSim ? '重置' : '重置动画'}
          onClick={() => resetPlayback(engineRef)} />
        <TransportKey icon={playing ? 'pause' : 'play'} title={playTitle} primary
          disabled={playBlocked} onClick={() => togglePlayback(engineRef)} />
        <TransportKey icon="step" title={stepTitle} disabled={stepBlocked}
          onClick={() => stepPlayback(engineRef)} />
        <span style={styles.push} />
        <span style={styles.divider} />
        <TransportKey icon="cube" title="参数" onClick={onOpenProps} />
      </div>
    </div>
  );
}

function Segment({ channel, label, active, onPick }: {
  channel: PlaybackChannel;
  label: string;
  active: boolean;
  onPick: (channel: PlaybackChannel) => void;
}) {
  return (
    <button
      style={{ ...styles.segment, ...(active ? styles.segmentActive : null) }}
      aria-pressed={active}
      onClick={() => onPick(channel)}
    >
      {label}
    </button>
  );
}

function TransportKey({ icon, title, primary, disabled, onClick }: {
  icon: IconName;
  title: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.key,
        ...(primary ? styles.keyPrimary : null),
        ...(disabled ? styles.keyDisabled : null),
      }}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={primary ? 18 : 16} />
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function CheckButton({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ ...styles.pill, ...(checked ? styles.pillActive : null) }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function TextButton({ label, active, disabled, onClick }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      style={{
        ...styles.pill,
        ...(active ? styles.pillActive : null),
        ...(disabled ? styles.keyDisabled : null),
      }}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
