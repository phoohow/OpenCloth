import type { FabricAsset, TrimAsset } from '@/model';

/** Catalogue asset travelling from a card to a panel; the viewports accept nothing else. */
export type AssetDragPayload =
  | { kind: 'fabric'; asset: FabricAsset }
  | { kind: 'trim'; asset: TrimAsset };

/** Picture carried under the pointer while dragging: a preview image or a plain colour. */
export interface AssetDragGhost {
  image?: string;
  color?: string;
}

/** Drag data type marking a catalogue drag, so viewports can tell it from a file drag. */
const ASSET_DRAG_TYPE = 'application/x-opencloth-asset';

/** Size of the floating drag image, in pixels. */
const GHOST_SIZE = 44;

/**
 * Payload of the drag in flight. Hover handlers cannot read drag data before the drop, so the
 * catalogue keeps the payload here while the pointer moves.
 */
let activeDrag: AssetDragPayload | null = null;

/** Payload being dragged right now, or null when the pointer carries nothing from the catalogue. */
export function currentAssetDrag(): AssetDragPayload | null {
  return activeDrag;
}

/** Drops the in-flight payload once the drag is over. */
export function endAssetDrag(): void {
  activeDrag = null;
}

/**
 * Starts a catalogue drag from a card, dragging the asset's own preview rather than the row:
 * the thumbnail for a pattern or model, the swatch colour for a material or trim.
 */
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
  // Outlives this handler so the browser can snapshot the bitmap in every engine.
  window.addEventListener('dragend', () => image.remove(), { once: true });
}

/** Element the browser snapshots as the drag image. */
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

/** Whether a drag hovering a viewport carries a catalogue asset. Payload data stays unreadable here. */
export function isAssetDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(ASSET_DRAG_TYPE);
}

/** Payload of a catalogue drop; null for any other drag. */
export function readAssetDrag(e: React.DragEvent): AssetDragPayload | null {
  if (!isAssetDrag(e)) return null;
  try {
    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    return raw ? JSON.parse(raw) as AssetDragPayload : activeDrag;
  } catch {
    return activeDrag;
  }
}
