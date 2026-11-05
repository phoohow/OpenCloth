import { computePressureField, pressureStats } from './pressure';
import type { AnalysisChannel } from './channel';

/** Contact-pressure heatmap: estimated from the normal correction of the last simulation step. */
export const pressureChannel: AnalysisChannel<'pressure'> = {
  kind: 'pressure',
  pass(source, overlay, { maxKpa }) {
    const contact = source.contact();
    if (!contact) return null;
    const field = computePressureField(contact);
    const panels = source.clothInput()?.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    })) ?? [];
    overlay.updatePressure(field.pressureKpa, maxKpa);
    return pressureStats(field, panels);
  },
};
