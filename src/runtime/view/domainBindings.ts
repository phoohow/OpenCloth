import type { EntityId } from '@/render/common';

export interface DomainHit {
  readonly key: string;
  readonly object: string | null;
}

export type TriangleResolver = (triangle: number) => string | null;

interface Entry {
  readonly key: string;
  readonly objectAt?: TriangleResolver;
}

export class DomainBindings {
  private readonly entries = new Map<EntityId, Entry>();

  bind(domainKey: string, entity: EntityId, objectAt?: TriangleResolver): void {
    this.entries.set(entity, { key: domainKey, objectAt });
  }

  resolve(entity: EntityId, triangle = -1): DomainHit | null {
    const entry = this.entries.get(entity);
    if (!entry) return null;
    return {
      key: entry.key,
      object: triangle >= 0 ? entry.objectAt?.(triangle) ?? null : null,
    };
  }

  unbind(entity: EntityId): void {
    this.entries.delete(entity);
  }

  clear(): void {
    this.entries.clear();
  }
}
