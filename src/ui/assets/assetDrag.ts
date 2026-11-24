import type { FabricAsset, TrimAsset } from '@/model';

const ASSET_DRAG_TYPE = 'application/x-opencloth-asset';

const GHOST_SIZE = 44;

let activeDrag: AssetDragPayload | null = null;

export type AssetDragPayload =
  | { kind: 'fabric'; asset: FabricAsset }
  | { kind: 'fabric-record'; fabricId: string; name: string }
  | { kind: 'trim'; asset: TrimAsset };

export type FabricDragPayload = Extract<AssetDragPayload, { kind: 'fabric' } | { kind: 'fabric-record' }>;

export interface AssetDragGhost {
  image?: string;
  color?: string;
}

export function currentAssetDrag(): AssetDragPayload | null {
  return activeDrag;
}

export function endAssetDrag(): void {
  activeDrag = null;
}

export function beginAssetDrag(
  e: React.DragEvent, payload: AssetDragPayload, ghost: AssetDragGhost = {},
): void {
  activeDrag = payload;
  window.addEventListener('dragend', endAssetDrag, { once: true });
  e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
  const image = dragGhostElement(ghost);
  if (!image) return;
  document.body.appendChild(image);
  e.dataTransfer.setDragImage(image, GHOST_SIZE / 2, GHOST_SIZE / 2);
  window.addEventListener('dragend', () => image.remove(), { once: true });
}

function dragGhostElement(ghost: AssetDragGhost): HTMLElement | null {
  if (!ghost.image && !ghost.color) return null;
  const node = document.createElement('div');
  node.style.cssText = [
    'position:fixed', 'left:-1000px', 'top:-1000px', 'pointer-events:none',
    `width:${GHOST_SIZE}px`, `height:${GHOST_SIZE}px`,
    'border-radius:5px', 'border:1px solid #4da6ff', 'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
    'background-color:#1f1f24', 'background-repeat:no-repeat', 'background-position:center',
    'background-size:contain',
  ].join(';');
  if (ghost.image) node.style.backgroundImage = `url("${ghost.image}")`;
  else if (ghost.color) node.style.backgroundColor = ghost.color;
  return node;
}

export function isAssetDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(ASSET_DRAG_TYPE);
}

export function readAssetDrag(e: React.DragEvent): AssetDragPayload | null {
  if (!isAssetDrag(e)) return null;
  try {
    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    return raw ? JSON.parse(raw) as AssetDragPayload : activeDrag;
  } catch {
    return activeDrag;
  }
}
