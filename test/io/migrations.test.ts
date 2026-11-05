import { describe, expect, it } from 'vitest';
import { migrateProjectDocument } from '../../src/io/migrations';
import { PROJECT_FORMAT_VERSION } from '../../src/core/model/format';

describe('migrateProjectDocument', () => {
  it('按版本顺序应用每一步，并盖上新版本号', () => {
    const order: number[] = [];
    const document: Record<string, unknown> = {};
    migrateProjectDocument(document, 0, 3, {
      0: () => void order.push(0),
      1: () => void order.push(1),
      2: () => void order.push(2),
    });
    expect(order).toEqual([0, 1, 2]);
    expect(document.formatVersion).toBe(3);
  });

  it('缺少某一步时抛中文错误，而不是跳过', () => {
    expect(() => migrateProjectDocument({}, 0, 2, { 1: () => {} }))
      .toThrow(/版本 0 缺少迁移步骤/);
  });

  it('当前版本的文件不经过任何步骤', () => {
    const document: Record<string, unknown> = { meta: {} };
    migrateProjectDocument(document, PROJECT_FORMAT_VERSION);
    expect(document).toEqual({ meta: {} });
  });

  it('0 → 1 是空步骤：只盖版本号，不动内容', () => {
    const document: Record<string, unknown> = { meta: { name: '旧工程' }, pattern: {} };
    migrateProjectDocument(document, 0);
    expect(document.formatVersion).toBe(1);
    expect(document.meta).toEqual({ name: '旧工程' });
    expect(document.pattern).toEqual({});
  });
});
