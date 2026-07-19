import { describe, expect, test, vi } from 'vitest';
import { validateLinks } from '../../../src/reader/offline/links.js';
import type { Link } from '../../../src/reader/schema.js';

/** 两个仓的扫描结果:仓名 → 该仓内的相对路径集合 */
const filesByRepo = new Map([
  ['frontend', new Set(['src/lib/api.ts', 'src/pages/gameplay-page.tsx'])],
  ['backend', new Set(['api/routes/game.py', 'runtime/game.py'])],
]);

function link(over: Partial<Link> = {}): Link {
  return {
    relation: '对局主流程',
    repos: ['frontend:src/lib/api.ts', 'backend:api/routes/game.py'],
    source: 'user',
    ...over,
  };
}

describe('validateLinks —— n 元关系的存在性校验', () => {
  test('全部路径都能对上时保留', () => {
    const warn = vi.fn();
    expect(validateLinks([link()], filesByRepo, warn)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('三元关系同样支持', () => {
    const warn = vi.fn();
    const three = link({
      repos: [
        'frontend:src/lib/api.ts',
        'backend:api/routes/game.py',
        'backend:runtime/game.py',
      ],
    });
    expect(validateLinks([three], filesByRepo, warn)).toHaveLength(1);
  });

  test('某个路径不在对应仓库时跳过该条并告警', () => {
    const warn = vi.fn();
    const bad = link({ repos: ['frontend:src/lib/api.ts', 'backend:api/routes/nope.py'] });
    expect(validateLinks([bad], filesByRepo, warn)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('api/routes/nope.py');
  });

  test('路径存在但归属错仓时跳过 —— 不做跨仓兜底匹配', () => {
    const warn = vi.fn();
    const crossed = link({ repos: ['frontend:api/routes/game.py'] });
    expect(validateLinks([crossed], filesByRepo, warn)).toHaveLength(0);
  });

  test('引用未知仓名时跳过并告警', () => {
    const warn = vi.fn();
    const unknown = link({ repos: ['mobile:src/main.kt'] });
    expect(validateLinks([unknown], filesByRepo, warn)).toHaveLength(0);
    expect(warn.mock.calls[0]?.[0]).toContain('mobile');
  });

  test('缺少 repo 前缀时跳过并告警', () => {
    const warn = vi.fn();
    const bare = link({ repos: ['src/lib/api.ts'] });
    expect(validateLinks([bare], filesByRepo, warn)).toHaveLength(0);
  });

  test('一条不合法不影响其余条目', () => {
    const warn = vi.fn();
    const bad = link({ relation: '坏的', repos: ['backend:api/routes/nope.py'] });
    const result = validateLinks([link(), bad, link({ relation: '另一条' })], filesByRepo, warn);
    expect(result.map((l) => l.relation)).toEqual(['对局主流程', '另一条']);
  });

  test('空关系列表返回空数组,不告警', () => {
    const warn = vi.fn();
    expect(validateLinks([], filesByRepo, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
