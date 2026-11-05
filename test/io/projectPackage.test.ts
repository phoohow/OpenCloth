import { describe, expect, it } from 'vitest';
import { embedProjectAssets } from '@/io/storage/projectPackage';
import { createDefaultProject } from '@/model/defaults';

describe('embedProjectAssets', () => {
  it('returns a detached copy when no imported blob is referenced', async () => {
    const project = createDefaultProject();
    const embedded = await embedProjectAssets(project);
    expect(embedded).not.toBe(project);
    expect(embedded).toEqual(project);
  });
});