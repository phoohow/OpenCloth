import { useEffect, useState } from 'react';
import { normalizeRayTracing } from '../../core/model/defaults';
import { usePerfStore, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import { rayTraceStateLabel, SIM_STEP_OPTIONS, simStepLabel } from '../optionTables';
import { setSimulationConfig } from '../sceneCommands';
import { Icon } from '../icons';

/** Playback bar for the cloth simulation: the 3D view's frame rate or per-pixel sample count and its elapsed cost, transport buttons, step length, frame, playback time and status. */
export function Timeline() {
  const isPlaying = useSimStore(s => s.isPlaying);
  const currentFrame = useSimStore(s => s.currentFrame);
  const stopFrame = useSimStore(s => s.stopFrame);
  const setStopFrame = useSimStore(s => s.setStopFrame);
  const playedMs = useSimStore(s => s.playedMs);
  const togglePlay = useSimStore(s => s.togglePlay);
  const step = useSimStore(s => s.step);
  const reset = useSimStore(s => s.reset);
  const isDressed = useSimStore(s => s.isDressed);
  const isDressing = useSimStore(s => s.isDressing);
  const renderMode = useUIStore(s => s.renderMode);
  const fps3D = usePerfStore(s => s.fps['3d']);
  const samples3D = usePerfStore(s => s.samples3D);
  const costMs3D = usePerfStore(s => s.costMs3D);
  const rayState3D = usePerfStore(s => s.rayState3D);
  const simRate = usePerfStore(s => s.simRate);
  const maxSamples = useProjectStore(s => normalizeRayTracing(s.project.scene.render.rayTracing).maxSamples);
  const dt = useProjectStore(s => s.project.scene.simulation.dt);
  const raytraced = renderMode === 'raytraced';
  /** Gate the traced image is stuck behind; the sample count already explains a running pass. */
  const rayNote = raytraced && samples3D === 0 ? rayTraceStateLabel(rayState3D) : '';
  /** Text being typed into the auto-pause field, committed on blur or Enter so clamping never eats a keystroke. */
  const [stopDraft, setStopDraft] = useState(stopFrame === null ? '' : String(stopFrame));
  const atStopFrame = stopFrame !== null && currentFrame >= stopFrame;
  /** Preset steps, plus the project's own value when it is not one of them. */
  const stepOptions = SIM_STEP_OPTIONS.includes(dt) ? SIM_STEP_OPTIONS : [dt, ...SIM_STEP_OPTIONS];

  useEffect(() => {
    setStopDraft(stopFrame === null ? '' : String(stopFrame));
  }, [stopFrame]);

  const commitStopFrame = () => {
    const trimmed = stopDraft.trim();
    if (trimmed === '') {
      setStopFrame(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setStopDraft(stopFrame === null ? '' : String(stopFrame));
      return;
    }
    const frame = Math.max(Math.round(value), useSimStore.getState().currentFrame);
    setStopFrame(frame);
    setStopDraft(String(frame));
  };

  return (
    <div style={styles.bar}>
      {raytraced ? (
        <div
          style={styles.spp}
          title={`3D 窗格每像素累计采样 ${samples3D} / ${maxSamples}，耗时 ${costLabel(costMs3D)}${rayNote ? `，${rayNote}` : ''}`}
        >
          <span style={styles.sppLabel}>SPP:</span>
          <div style={styles.fps}>
            <span style={styles.sppValue}>{samples3D}</span>
            <span style={styles.sppMax}>/{maxSamples}</span>
          </div>
          <span style={styles.sppLabel}>Cost:</span>
          <span style={styles.sppValue}>{costLabel(costMs3D)}</span>
          {rayNote && <span style={styles.sppNote}>{rayNote}</span>}
        </div>
      ) : (
        <div style={styles.fps} title="3D 窗格每秒绘制帧数">
          {`FPS(3D): ${fps3D}`}
        </div>
      )}

      <div style={styles.status}>
        {isDressing && <span style={{ color: '#4da6ff' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />缝合着装中</span>}
        {!isDressing && !isDressed && <span style={{ color: '#e0a040' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />未着装 — 播放或执行「自动着装」开始缝合</span>}
        {!isDressing && isDressed && isPlaying && <span style={{ color: '#50c878' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />模拟中</span>}
        {!isDressing && isDressed && !isPlaying && <span style={{ color: '#888' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />已暂停</span>}
      </div>

      <div style={styles.controls}>
        <button style={styles.btn} onClick={reset} title="重置 (R)"><Icon name="reset" size={12} /></button>
        <button
          style={{ ...styles.btn, ...styles.playBtn }}
          onClick={togglePlay}
          title={atStopFrame ? '已到达截至帧，先提高或取消截至帧再播放' : '播放/暂停 (空格)'}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
        </button>
        <button
          style={{ ...styles.btn, ...(atStopFrame ? styles.btnDisabled : null) }}
          onClick={step}
          disabled={atStopFrame}
          title={atStopFrame ? '已到达截至帧，先提高或取消截至帧' : '单步 (.)'}
        >
          <Icon name="step" size={12} />
        </button>

        <div
          style={styles.frameInfo}
          title={`已模拟 ${currentFrame} 帧；计时是从开始播放起累计的墙钟时间，暂停不计、重置清零，当前约 ${simRate} 步/秒。`}
        >
          帧 <span style={{ color: '#4da6ff', fontWeight: 600 }}>{currentFrame}</span>
          <span style={styles.simTime}> · 计时 {costLabel(playedMs)}</span>
        </div>

        <div
          style={styles.stepControl}
          title={`每帧跑一个物理步，每步推进 ${simStepLabel(dt)} 模拟时间；步长越小求解越稳、播放越慢`}
        >
          <span style={styles.stopLabel}>步长</span>
          <select
            style={styles.select}
            value={String(dt)}
            onChange={e => setSimulationConfig('修改仿真步长', { dt: Number(e.target.value) })}
          >
            {stepOptions.map(value => (
              <option key={String(value)} value={String(value)}>{simStepLabel(value)}</option>
            ))}
          </select>
        </div>

        <div style={styles.stopControl} title={`播放到第 ${stopFrame ?? '—'} 帧后自动暂停，不可小于当前帧`}>
          <span style={styles.stopLabel}>截至帧</span>
          <input
            style={styles.stopInput}
            type="number"
            min={currentFrame}
            step={1}
            placeholder="不限"
            value={stopDraft}
            onChange={e => setStopDraft(e.target.value)}
            onBlur={commitStopFrame}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setStopDraft(stopFrame === null ? '' : String(stopFrame));
            }}
          />
          {stopFrame !== null && (
            <button style={styles.clearBtn} onClick={() => setStopFrame(null)} title="取消截至帧">×</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Elapsed sampling time: one decimal under a minute, minutes and seconds beyond. */
function costLabel(costMs: number): string {
  const s = costMs / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 32, background: '#202024', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', padding: '0 16px', position: 'relative' },
  controls: {
    position: 'absolute', left: '50%', top: 0, bottom: 0, transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  btn: { width: 20, height: 20, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 4, color: '#ccc', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  playBtn: { background: '#2a4a6a', borderColor: '#4da6ff', color: '#fff', width: 28 },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  frameInfo: { fontSize: 12, color: '#aaa', minWidth: 140, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  simTime: { color: '#8a94a6' },
  stepControl: { display: 'flex', alignItems: 'center', gap: 6 },
  select: { background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd', padding: '2px 6px', fontSize: 12 },
  stopControl: { display: 'flex', alignItems: 'center', gap: 4 },
  stopLabel: { fontSize: 11, color: '#888' },
  stopInput: {
    width: 62, background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd',
    padding: '2px 6px', fontSize: 12, fontVariantNumeric: 'tabular-nums',
  },
  clearBtn: { width: 16, height: 16, background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 },
  status: { fontSize: 12, marginLeft: 'auto' },
  fps: { fontSize: 12, color: '#aaa', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  spp: { display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' },
  sppLabel: { fontSize: 11, fontWeight: 700, color: '#d0d0d6', letterSpacing: 0.3 },
  sppValue: { fontSize: 12, color: '#4da6ff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sppMax: { fontSize: 12, color: '#8a94a6' },
  sppNote: { fontSize: 11, color: '#c0a060' },
};
