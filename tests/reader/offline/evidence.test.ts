import { describe, expect, test } from 'vitest';
import { assembleEvidence, evaluateShortCircuit } from '../../../src/reader/offline/evidence.js';
import type { ConventionDoc } from '../../../src/reader/offline/conventions.js';

function doc(over: Partial<ConventionDoc> = {}): ConventionDoc {
  return { path: '/CLAUDE.md', kind: 'convention', content: '内容', ...over };
}

describe('assembleEvidence —— 按 kind 分档', () => {
  test('convention 与 readme 分到不同档,保持原顺序', () => {
    const docs = [
      doc({ path: '/CLAUDE.md', kind: 'convention' }),
      doc({ path: '/README.md', kind: 'readme' }),
      doc({ path: '/frontend/AGENTS.md', kind: 'convention' }),
    ];
    const ev = assembleEvidence('简历', 'JD', docs, []);
    expect(ev.conventions.map((d) => d.path)).toEqual(['/CLAUDE.md', '/frontend/AGENTS.md']);
    expect(ev.readmes.map((d) => d.path)).toEqual(['/README.md']);
    expect(ev.resume).toBe('简历');
    expect(ev.jd).toBe('JD');
  });
});

describe('evaluateShortCircuit —— 约定文档信号充足才跳过', () => {
  test('无约定文档:不跳过', () => {
    const r = evaluateShortCircuit([]);
    expect(r.skip).toBe(false);
    expect(r.reason).toContain('未找到约定文档');
  });

  test('约定文档过短:不跳过', () => {
    const r = evaluateShortCircuit([doc({ content: '太短' })]);
    expect(r.skip).toBe(false);
    expect(r.reason).toContain('未达下限');
  });

  test('约定文档足够长:跳过精读', () => {
    const r = evaluateShortCircuit([doc({ content: 'x'.repeat(2000) })]);
    expect(r.skip).toBe(true);
    expect(r.reason).toContain('跳过分批精读');
  });

  test('多份约定文档累加达到下限:跳过', () => {
    const r = evaluateShortCircuit([
      doc({ content: 'x'.repeat(800) }),
      doc({ content: 'y'.repeat(800) }),
    ]);
    expect(r.skip).toBe(true);
  });
});
