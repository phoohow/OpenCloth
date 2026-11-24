import type { AssetDragPayload } from '@/ui/assets/assetDrag';
import type { IconName } from '@/ui/icons';

export type AssetThumb =
  | { kind: 'image'; src: string }
  | { kind: 'swatch'; color: string }
  | { kind: 'icon'; name: IconName };

export interface AssetAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  button?: boolean;
  run: () => void;
}

export interface AssetItem {
  id: string;
  name: string;
  meta?: string;
  thumb: AssetThumb;
  status?: 'active' | 'applied';
  statusLabel?: string;
  title?: string;
  drag?: AssetDragPayload;
  actions?: AssetAction[];
}
