/** Entity and triangle ownership: presenters register domain objects as they create entities. */

import type { EntityId } from '@/render/common';

/** What a bound entity/triangle resolves to. */
export interface DomainHit {
  /** Stable domain key, e.g. `cloth`, `avatar` or a reference record id. */
  readonly key: string;
  /** Sub-object the triangle belongs to, e.g. a panel id; null without a resolver. */
  readonly object: string | null;
}

/** Triangle resolver of one entity, e.g. the cloth panel ranges. */
export type TriangleResolver = (triangle: number) => string | null;

interface Entry {
  readonly key: string;
  readonly objectAt?: TriangleResolver;
}

/** Binding table picking and selection read; no three scene graph is involved. */
export class DomainBindings {
  private readonly entries = new Map<EntityId, Entry>();

  /** Registers the domain key of one entity, with an optional triangle-range resolver. */
  bind(domainKey: string, entity: EntityId, objectAt?: TriangleResolver): void {
    this.entries.set(entity, { key: domainKey, objectAt });
  }

  /** Domain hit of an entity/triangle; null while the entity was never bound. */
  resolve(entity: EntityId, triangle = -1): DomainHit | null {
    const entry = this.entries.get(entity);
    if (!entry) return null;
    return {
      key: entry.key,
      object: triangle >= 0 ? entry.objectAt?.(triangle) ?? null : null,
    };
  }

  /** Forgets a destroyed entity. */
  unbind(entity: EntityId): void {
    this.entries.delete(entity);
  }

  /** Forgets every binding, used when the viewport tears the scene down. */
  clear(): void {
    this.entries.clear();
  }
}