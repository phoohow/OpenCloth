import { normalizeRayTracing } from '../../core/model/defaults';
import { usePerfStore, useProjectStore, useSimStore, useUIStore } from '../../store/stores';
import { rayTraceStateLabel } from '../optionTables';
import { Icon } from '../icons';

/** Playback bar for the cloth simulation: the 3D view's frame rate or per-pixel sample count and its elapsed cost, transport buttons, speed, frame, simulated time and status. */
export function Timeline() {
  const isPlaying = useSimStore(s => s.isPlaying);
  const currentFrame = useSimStore(s => s.currentFrame);
  const speed = useSimStore(s => s.speed);
  const togglePlay = useSimStore(s => s.togglePlay);
  const step = useSimStore(s => s.step);
  const reset = useSimStore(s => s.reset);
  const setSpeed = useSimStore(s => s.setSpeed);
  const isDraped = useSimStore(s => s.isDraped);
  const isDraping = useSimStore(s => s.isDraping);
  const renderMode = useUIStore(s => s.renderMode);
  const fps3D = usePerfStore(s => s.fps['3d']);
  const samples3D = usePerfStore(s => s.samples3D);
  const costMs3D = usePerfStore(s => s.costMs3D);
  const rayState3D = usePerfStore(s => s.rayState3D);
  const maxSamples = useProjectStore(s => normalizeRayTracing(s.project.scene.render.rayTracing).maxSamples);
  const dt = useProjectStore(s => s.project.scene.simulation.dt);
  const raytraced = renderMode === 'raytraced';
  /** Gate the traced image is stuck behind; the sample count already explains a running pass. */
  const rayNote = raytraced && samples3D === 0 ? rayTraceStateLabel(rayState3D) : '';

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
        {isDraping && <span style={{ color: '#4da6ff' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />缝合着装中</span>}
        {!isDraping && !isDraped && <span style={{ color: '#e0a040' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />未着装 — 播放或执行「自动着装」开始缝合</span>}
        {!isDraping && isDraped && isPlaying && <span style={{ color: '#50c878' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />模拟中</span>}
        {!isDraping && isDraped && !isPlaying && <span style={{ color: '#888' }}><Icon name="status-dot" size={8} style={{ marginRight: 5 }} />已暂停</span>}
      </div>

      <div style={styles.controls}>
        <button style={styles.btn} onClick={reset} title="重置 (R)"><Icon name="reset" size={12} /></button>
        <button style={{ ...styles.btn, ...styles.playBtn }} onClick={togglePlay} title="播放/暂停 (空格)">
          <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
        </button>
        <button style={styles.btn} onClick={step} title="单步 (.)"><Icon name="step" size={12} /></button>

        <div style={styles.frameInfo} title="已模拟的帧数与累计模拟时间（帧数 × 每帧步长）">
          帧 <span style={{ color: '#4da6ff', fontWeight: 600 }}>{currentFrame}</span>
          <span style={styles.simTime}> · 模拟时长 {costLabel(currentFrame * dt * 1000)}</span>
        </div>

        <div style={styles.speedControl}>
          <span style={{ fontSize: 11, color: '#888' }}>速度</span>
          <select style={styles.select} value={speed} onChange={e => setSpeed(parseFloat(e.target.value))}>
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
          </select>
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
  frameInfo: { fontSize: 12, color: '#aaa', minWidth: 170, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  simTime: { color: '#8a94a6' },
  speedControl: { display: 'flex', alignItems: 'center', gap: 6 },
  select: { background: '#2a2a30', border: '1px solid #3a3a42', borderRadius: 3, color: '#ddd', padding: '2px 6px', fontSize: 12 },
  status: { fontSize: 12, marginLeft: 'auto' },
  fps: { fontSize: 12, color: '#aaa', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  spp: { display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' },
  sppLabel: { fontSize: 11, fontWeight: 700, color: '#d0d0d6', letterSpacing: 0.3 },
  sppValue: { fontSize: 12, color: '#4da6ff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  sppMax: { fontSize: 12, color: '#8a94a6' },
  sppNote: { fontSize: 11, color: '#c0a060' },
};
