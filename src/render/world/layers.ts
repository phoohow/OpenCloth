import {
  CHANNEL_ALL, CHANNEL_RASTER, type ChannelMask, type LayerId, type LayerPolicy,
} from '@/render/world/types';

export const LAYERS: Record<LayerId, LayerPolicy> = {
  underlay: { stage: 'scene', traceable: true, pickable: true, exportable: false },
  subject: { stage: 'scene', traceable: true, pickable: true, exportable: true },
  overlay: { stage: 'postTone', traceable: false, pickable: true, exportable: true },
  gizmo: { stage: 'gizmo', traceable: false, pickable: false, exportable: false },
};

export const LAYER_ORDER: readonly LayerId[] = ['underlay', 'subject', 'overlay', 'gizmo'];

export function pickableLayers(): readonly LayerId[] {
  return LAYER_ORDER.filter(layer => LAYERS[layer].pickable);
}

export function defaultChannels(layer: LayerId): ChannelMask {
  return LAYERS[layer].traceable ? CHANNEL_ALL : CHANNEL_RASTER;
}
