/** Layer policies: the only table deciding when a layer is drawn and what can see it. */

import {
  CHANNEL_ALL, CHANNEL_RASTER, type ChannelMask, type LayerId, type LayerPolicy,
} from '@/render/world/types';

/** One policy per layer, in draw order. */
export const LAYERS: Record<LayerId, LayerPolicy> = {
  underlay: { stage: 'scene', traceable: true, pickable: true, exportable: true },
  subject: { stage: 'scene', traceable: true, pickable: true, exportable: true },
  overlay: { stage: 'postTone', traceable: false, pickable: true, exportable: true },
  gizmo: { stage: 'gizmo', traceable: false, pickable: false, exportable: false },
};

/** Every layer, in draw order. */
export const LAYER_ORDER: readonly LayerId[] = ['underlay', 'subject', 'overlay', 'gizmo'];

/** Layers a pointer ray may resolve against. */
export function pickableLayers(): readonly LayerId[] {
  return LAYER_ORDER.filter(layer => LAYERS[layer].pickable);
}

/** Channels an entity of this layer joins when it does not override them. */
export function defaultChannels(layer: LayerId): ChannelMask {
  return LAYERS[layer].traceable ? CHANNEL_ALL : CHANNEL_RASTER;
}
