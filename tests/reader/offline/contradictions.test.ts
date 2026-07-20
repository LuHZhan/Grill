import { describe, expect, test } from 'vitest';
import { detectContradictions } from '../../../src/reader/offline/contradictions.js';
import type { RepoManifest } from '../../../src/reader/offline/manifest.js';

function manifest(deps: string[]): RepoManifest {
  return { repo: 'backend', file: 'package.json', dependencies: deps };
}

describe('detectContradictions —— 机械比对自述与代码证据', () => {
  test('自述提及、依赖里有痕迹:不判矛盾', () => {
    const c = detectContradictions('负责 Redis 缓存层', [manifest(['ioredis'])], []);
    expect(c).toHaveLength(0);
  });

  test('自述提及、代码里毫无痕迹:判一条矛盾', () => {
    const c = detectContradictions('负责 Kafka 消息队列', [manifest(['express'])], ['src/app.ts']);
    expect(c).toHaveLength(1);
    expect(c[0]?.claim).toContain('Kafka');
    expect(c[0]?.evidence).toContain('Kafka');
  });

  test('驱动别名算命中:说 PostgreSQL、依赖是 psycopg,不误判', () => {
    const c = detectContradictions('用 PostgreSQL 存储', [manifest(['psycopg'])], []);
    expect(c).toHaveLength(0);
  });

  test('痕迹来自文件路径也算命中', () => {
    const c = detectContradictions('容器化用 Docker', [], ['ops/Dockerfile']);
    expect(c).toHaveLength(0);
  });

  test('自述未提及的技术不产生矛盾', () => {
    const c = detectContradictions('纯前端项目', [manifest(['react'])], []);
    expect(c).toHaveLength(0);
  });

  test('词边界:reactive 不误命中 React', () => {
    const c = detectContradictions('用 reactive 编程范式', [manifest(['rxjs'])], []);
    expect(c).toHaveLength(0);
  });

  test('多处不一致各记一条', () => {
    const c = detectContradictions('用了 Kafka 和 MongoDB', [manifest(['express'])], []);
    expect(c).toHaveLength(2);
  });
});
