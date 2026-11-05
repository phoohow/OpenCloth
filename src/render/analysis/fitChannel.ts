import { computeFitField, fitStats } from './fit';
import { liveOr, type AnalysisChannel } from './channel';

/** Body-clearance heatmap: signed distance from the live cloth to the avatar. */
export const fitChannel: AnalysisChannel<'fit'> = {
  kind: 'fit',
  pass(source, overlay, { tightCm, looseCm }) {
    const collider = source.collider();
    const positions = liveOr(source.initialPositions(), source.lastGoodPositions());
    if (!collider || positions.length === 0) return null;
    const field = computeFitField(positions, collider, { thresholds: { tightCm, looseCm } });
    overlay.update(field);
    return fitStats(field);
  },
};
