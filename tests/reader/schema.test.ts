import { describe, expect, test } from 'vitest';
import { LinkSchema, ProfileSchema } from '../../src/reader/schema.js';

describe('LinkSchema —— 关系泛化为 n 元', () => {
  test('接受引用三个仓库的关系', () => {
    const result = LinkSchema.safeParse({
      relation: '前端经 BFF 调用后端结算接口',
      repos: ['web/src/lib/api.ts', 'bff/routes/order.ts', 'core/billing/settle.py'],
      source: 'user',
    });
    expect(result.success).toBe(true);
  });

  test('source 标记推导来源', () => {
    const result = LinkSchema.safeParse({
      relation: '登录态从前端 store 流向后端中间件',
      repos: ['web/src/store/auth.ts', 'api/middleware/auth.py'],
      source: 'inferred',
    });
    expect(result.success).toBe(true);
  });

  test('拒绝 user / inferred 之外的来源', () => {
    const result = LinkSchema.safeParse({
      relation: '随便什么',
      repos: ['a.ts', 'b.py'],
      source: 'guessed',
    });
    expect(result.success).toBe(false);
  });

  test('description 可选', () => {
    const withDesc = LinkSchema.safeParse({
      relation: '前端调用后端',
      repos: ['a.ts', 'b.py'],
      source: 'user',
      description: '走 SSE 流式返回,前端逐块渲染',
    });
    expect(withDesc.success).toBe(true);
  });

  test('repos 为空时拒绝', () => {
    const result = LinkSchema.safeParse({
      relation: '空关系',
      repos: [],
      source: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('ProfileSchema —— metadata 结构', () => {
  const valid = {
    project_name: 'WhatIf',
    repos: [{ name: 'backend', path: 'G:/x/backend', tree: 'api/\n  app.py' }],
    links: [],
    entrypoints: ['api/app.py'],
    open_questions: ['为什么选 Qdrant 而不是 pgvector'],
    contradictions: [],
    failed_batches: [],
  };

  test('七个字段齐备时通过', () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true);
  });

  test('缺少 contradictions 时拒绝', () => {
    const { contradictions, ...missing } = valid;
    expect(ProfileSchema.safeParse(missing).success).toBe(false);
  });

  test('contradictions 同时保留用户说法与代码证据', () => {
    const result = ProfileSchema.safeParse({
      ...valid,
      contradictions: [
        {
          claim: '用 Redis 做缓存',
          evidence: '依赖清单与源码中均无 redis 相关引用',
          path: 'package.json',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('contradictions 缺少证据时拒绝', () => {
    const result = ProfileSchema.safeParse({
      ...valid,
      contradictions: [{ claim: '用 Redis 做缓存' }],
    });
    expect(result.success).toBe(false);
  });

  test('failed_batches 保留失败原因', () => {
    const result = ProfileSchema.safeParse({
      ...valid,
      failed_batches: [
        { batch: 'backend/runtime', paths: ['runtime/game.py'], reason: '连续三次调用超时' },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('repos 不再要求 modules 字段', () => {
    const result = ProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
