/** Exportable world meshes and assets turned into file bytes through the injected port. */

import type { AssetPort, ExportFormat, ExportPort } from '@/render/common';
import type { Renderer } from '@/render/renderer';
import { LAYERS, LAYER_ORDER, type LayerId, type WorldPorts } from '@/render/world';

/** What one export keeps in the file. */
export interface ExportOptions {
  /** False leaves the stage out of the file; the default keeps every exportable entity. */
  readonly includeStage?: boolean;
  /** False leaves the body out of the file; the default keeps every exportable entity. */
  readonly includeAvatar?: boolean;
}

/** Layers a file keeps, read from the layer policy; gizmos never leave the viewport. */
const EXPORTABLE_LAYERS: readonly LayerId[] = LAYER_ORDER.filter(
  layer => LAYERS[layer].exportable,
);

/** Layers kept when the stage is left out. */
const BODY_LAYERS: readonly LayerId[] = EXPORTABLE_LAYERS.filter(layer => layer !== 'underlay');

/** Builds the export snapshot and hands it to the export port; owns no GPU objects. */
export class ExportService {
  constructor(
    private readonly renderer: Renderer,
    private readonly world: WorldPorts,
    private readonly assets: AssetPort,
    private readonly port: ExportPort,
  ) { }

  /** Exportable scene of the current world, written as one file. */
  async export(format: ExportFormat, options: ExportOptions = {}): Promise<ArrayBuffer> {
    const layers = options.includeStage === false ? BODY_LAYERS : EXPORTABLE_LAYERS;
    const snapshot = this.renderer.buildExportSnapshot(
      this.world.view,
      this.world.versions,
      { layers },
    );
    const items = options.includeAvatar === false
      ? snapshot.items.filter(item => !this.world.view.entity(item.key)?.tags.has('avatar'))
      : snapshot.items;
    const keys = new Set<string>();
    for (const item of items) {
      if (item.mesh.kind === 'asset') keys.add(item.mesh.key);
    }
    const handles = [...keys]
      .map(key => this.assets.handle(key))
      .filter((handle): handle is NonNullable<typeof handle> => handle !== null);
    return this.port.export({ ...snapshot, items }, handles, format);
  }
}