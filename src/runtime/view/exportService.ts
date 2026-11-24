import type { AssetPort, ExportFormat, ExportPort } from '@/render/common';
import type { Renderer } from '@/render/renderer';

import { LAYERS, LAYER_ORDER, type LayerId, type WorldPorts } from '@/render/world';

const EXPORTABLE_LAYERS: readonly LayerId[] = LAYER_ORDER.filter(
  layer => LAYERS[layer].exportable,
);

export interface ExportOptions {
  readonly includeAvatar?: boolean;
}

export class ExportService {
  constructor(
    private readonly renderer: Renderer,
    private readonly world: WorldPorts,
    private readonly assets: AssetPort,
    private readonly port: ExportPort,
  ) {}

  async export(format: ExportFormat, options: ExportOptions = {}): Promise<ArrayBuffer> {
    const snapshot = this.renderer.buildExportSnapshot(
      this.world.view,
      this.world.versions,
      { layers: EXPORTABLE_LAYERS },
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
