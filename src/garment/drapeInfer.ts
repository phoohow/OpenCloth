import type { PanelDrape, Vec2 } from '@/model/types';

import { computeBBox } from '@/base/geom';

export function inferDrape(panelNameOrShape: string | Vec2[]): PanelDrape {
  if (typeof panelNameOrShape === 'string') return inferDrapeFromName(panelNameOrShape);
  return inferDrapeFromShape(panelNameOrShape);
}

function inferDrapeFromName(name: string): PanelDrape {
  if (name.includes('袖')) {
    return { region: 'arm', side: name.includes('左') ? 'left' : 'right' };
  }

  if (name.includes('裤') || name.includes('腿')) {
    return { region: 'leg', side: name.includes('左') ? 'left' : 'right' };
  }

  if (name.includes('领')) {
    return { region: 'neck' };
  }

  if (name.includes('后')) {
    return { region: 'torso', zone: 'back' };
  }

  return { region: 'torso' };
}

function inferDrapeFromShape(pts: Vec2[]): PanelDrape {
  const box = computeBBox(pts);
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  if (w <= 0 || h <= 0) return { region: 'torso' };
  const ratio = w / h;
  if (ratio < 0.45 && h < 45) return { region: 'arm' };
  if (ratio < 0.55 && h >= 45) return { region: 'leg' };
  return { region: 'torso' };
}
