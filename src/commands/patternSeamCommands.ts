import type { ProjectContext } from '@/commands/command';
import type { Pattern, Seam, SeamEnd, SeamType } from '@/model/types';

import { genId } from '@/base/id';
import { SnapshotCommand } from '@/commands/patternSnapshot';

export interface SeamOptions {
  type?: SeamType;
  flip?: boolean;
  strength?: number;
  threadColor?: string;
  stitchVisible?: boolean;
  gatherRatio?: number;
}

export interface SeamPart {
  edgeBId: string;
  tB0: number;
  tB1: number;
  tA0: number;
  tA1: number;
}

function defaultSeam(opts: SeamOptions, a: SeamEnd, b: SeamEnd): Omit<Seam, 'id'> {
  return {
    type: opts.type ?? (opts.gatherRatio !== undefined ? 'gather' : 'normal'),
    a,
    b,
    flip: opts.flip ?? false,
    strength: opts.strength ?? 0.8,
    threadColor: opts.threadColor ?? '#ff4444',
    stitchVisible: opts.stitchVisible ?? true,
    ...(opts.gatherRatio !== undefined ? { gatherRatio: opts.gatherRatio } : {}),
  };
}

function checkInterval(edgeId: string, t0: number, t1: number): void {
  if (!(t0 >= 0 && t0 < t1 && t1 <= 1)) {
    throw new Error(`边 ${edgeId} 的缝合区间 [${t0}, ${t1}] 不合法`);
  }
}

export class CreateFreeSeamCommand extends SnapshotCommand {
  readonly label = '创建自由缝合';
  constructor(
    private edgeAId: string, private t0a: number, private t1a: number,
    private edgeBId: string, private t0b: number, private t1b: number,
    private opts: SeamOptions & { anchorTs?: [number, number] } = {},
  ) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeAId] || !pattern.edges[this.edgeBId]) throw new Error('缝合的边不存在');
    checkInterval(this.edgeAId, this.t0a, this.t1a);
    checkInterval(this.edgeBId, this.t0b, this.t1b);
    const [aAnchor, bAnchor] = this.opts.anchorTs ?? [];
    if (aAnchor !== undefined && (aAnchor < this.t0a || aAnchor > this.t1a)) throw new Error('A 侧对位点不在缝合区间内');
    if (bAnchor !== undefined && (bAnchor < this.t0b || bAnchor > this.t1b)) throw new Error('B 侧对位点不在缝合区间内');
    const seamId = genId('seam');
    const a: SeamEnd = { edgeId: this.edgeAId, t0: this.t0a, t1: this.t1a, ...(aAnchor !== undefined ? { anchorT: aAnchor } : {}) };
    const b: SeamEnd = { edgeId: this.edgeBId, t0: this.t0b, t1: this.t1b, ...(bAnchor !== undefined ? { anchorT: bAnchor } : {}) };
    pattern.seams[seamId] = { id: seamId, ...defaultSeam(this.opts, a, b) };
  }
}

export class CreateMultiSeamCommand extends SnapshotCommand {
  readonly label = '创建分段缝合';
  constructor(private edgeAId: string, private parts: SeamPart[], private opts: SeamOptions = {}) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.edges[this.edgeAId]) throw new Error('缝合的边不存在');
    if (this.parts.length === 0) throw new Error('至少需要一个缝合分段');
    const seamIds: string[] = [];
    for (const part of this.parts) {
      if (!pattern.edges[part.edgeBId]) throw new Error('缝合的边不存在');
      checkInterval(this.edgeAId, part.tA0, part.tA1);
      checkInterval(part.edgeBId, part.tB0, part.tB1);
      const seamId = genId('seam');
      seamIds.push(seamId);
      pattern.seams[seamId] = {
        id: seamId,
        ...defaultSeam(this.opts,
          { edgeId: this.edgeAId, t0: part.tA0, t1: part.tA1 },
          { edgeId: part.edgeBId, t0: part.tB0, t1: part.tB1 }),
      };
    }
  }
}

export class DeleteSeamCommand extends SnapshotCommand {
  readonly label = '删除缝合';
  constructor(private seamId: string) { super(); }

  protected apply(pattern: Pattern, _ctx: ProjectContext): void {
    if (!pattern.seams[this.seamId]) throw new Error('缝合不存在');
    delete pattern.seams[this.seamId];
  }
}
