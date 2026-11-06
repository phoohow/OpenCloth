/** Scene layers and the policy each one carries. */

/** Layer of the scene an object belongs to. */
export type LayerId = 'underlay' | 'subject' | 'overlay' | 'gizmo';

/** What a layer is drawn by, exported with and picked through. */
export interface LayerPolicy {
  /** Whether the raster scene pass draws the layer. */
  readonly raster: boolean;
  /** Whether the path tracer sees the layer. */
  readonly trace: boolean;
  /** Whether GLB/OBJ/FBX/USD export contains the layer. */
  readonly exportable: boolean;
  /** Whether pointer picks hit the layer. */
  readonly pickable: boolean;
}

/**
 * One policy per layer; the only place that decides what a layer takes part in.
 *
 * `trace` doubles as the split point of the frame: layers the tracer sees are drawn as the lit
 * image, the rest are drawn on top of the resolved image. See {@link SCENE_LAYERS}.
 */
export const LAYERS: Record<LayerId, LayerPolicy> = {
  underlay: { raster: true, trace: true, exportable: false, pickable: false },
  subject: { raster: true, trace: true, exportable: true, pickable: true },
  overlay: { raster: true, trace: false, exportable: false, pickable: false },
  gizmo: { raster: true, trace: false, exportable: false, pickable: true },
};

/** Every layer, in draw order. */
export const LAYER_ORDER: readonly LayerId[] = ['underlay', 'subject', 'overlay', 'gizmo'];

/** Layers the raster scene pass draws as the lit image. */
export const SCENE_LAYERS: readonly LayerId[] = LAYER_ORDER.filter(id => LAYERS[id].raster && LAYERS[id].trace);

/** Layers drawn on top of the resolved image. */
export const TOP_LAYERS: readonly LayerId[] = LAYER_ORDER.filter(id => LAYERS[id].raster && !LAYERS[id].trace);

/** Every layer of one kind, in draw order. */
export function layersWhere(test: (policy: LayerPolicy) => boolean): readonly LayerId[] {
  return LAYER_ORDER.filter(id => test(LAYERS[id]));
}
