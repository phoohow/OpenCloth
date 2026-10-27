import { describe, expect, it } from 'vitest';
import { RECENT_LIMIT, collectBlobKeys, pruneRecents, sortRecents } from '../../src/io/projectArchive';

type Record_ = { id: string; name: string; savedAt: string; json: string };

const at = (day: number): Record_ => ({
  id: `p${day}`,
  name: `工程 ${day}`,
  savedAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
  json: '{}',
});

describe('sortRecents', () => {
  it('orders newest first', () => {
    expect(sortRecents([at(3), at(1), at(2)]).map(r => r.id)).toEqual(['p3', 'p2', 'p1']);
  });

  it('does not mutate the input', () => {
    const input = [at(2), at(1)];
    sortRecents(input);
    expect(input.map(r => r.id)).toEqual(['p2', 'p1']);
  });
});

describe('pruneRecents', () => {
  it('moves the new record to the front', () => {
    const next = pruneRecents([at(1), at(2)], at(3));
    expect(next.map(r => r.id)).toEqual(['p3', 'p2', 'p1']);
  });

  it('replaces an older copy of the same project', () => {
    const older = { ...at(1), savedAt: '2026-09-01T10:00:00.000Z' };
    const next = pruneRecents([older, at(2)], at(1));
    expect(next).toHaveLength(2);
    expect(next[0].savedAt).toBe(at(1).savedAt);
  });

  it('caps the list at the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => at(i + 1));
    expect(pruneRecents(many, at(99))).toHaveLength(RECENT_LIMIT);
  });

  it('drops the oldest entries beyond the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => at(i + 1));
    const next = pruneRecents(many, at(99));
    expect(next.map(r => r.id)).not.toContain('p1');
    expect(next[0].id).toBe('p99');
  });
});

describe('collectBlobKeys', () => {
  it('gathers the avatar, environment and reference blob keys a project references', () => {
    const project = {
      avatar: { glbObjectKey: 'avatar-1' },
      scene: {
        lights: { iblObjectKey: 'env-1' },
        referenceObjects: [{ objectKey: 'object-a' }, { name: '失效文件' }],
      },
    };
    expect(collectBlobKeys(project).sort()).toEqual(['avatar-1', 'env-1', 'object-a']);
  });

  it('returns nothing for corrupt or partial snapshots', () => {
    expect(collectBlobKeys(null)).toEqual([]);
    expect(collectBlobKeys('corrupt')).toEqual([]);
    expect(collectBlobKeys({})).toEqual([]);
  });
});
