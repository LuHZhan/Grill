import { describe, expect, test } from 'vitest';
import { BatchNoteSchema } from '../../src/reader/schema.js';

describe('BatchNoteSchema —— 分批精读的笔记', () => {
  const valid = {
    batch: 'backend/api',
    modules: [
      {
        path: 'api/routes/game.py',
        role: '对局主流程的 HTTP 入口,以 SSE 流式返回叙事',
        contracts: ['向 runtime/game.py 传递 session_id,由后者持有对局状态'],
        decisions: ['流式而非轮询,以便前端逐块渲染长文本'],
      },
    ],
    open_questions: ['为什么对局状态放在进程内存而不是外部存储'],
    uncertain: ['疑似有第二个入口 extract.py,但本批未包含该文件'],
  };

  test('齐备时通过', () => {
    expect(BatchNoteSchema.safeParse(valid).success).toBe(true);
  });

  test('contracts 与 decisions 可为空数组', () => {
    const result = BatchNoteSchema.safeParse({
      ...valid,
      modules: [{ path: 'api/deps.py', role: '依赖注入容器', contracts: [], decisions: [] }],
    });
    expect(result.success).toBe(true);
  });

  test('缺少 uncertain 时拒绝', () => {
    const { uncertain, ...missing } = valid;
    expect(BatchNoteSchema.safeParse(missing).success).toBe(false);
  });

  test('模块缺少 path 时拒绝', () => {
    const result = BatchNoteSchema.safeParse({
      ...valid,
      modules: [{ role: '没有路径的模块', contracts: [], decisions: [] }],
    });
    expect(result.success).toBe(false);
  });

  test('笔记记名批次归属,便于失败时定位', () => {
    const { batch, ...missing } = valid;
    expect(BatchNoteSchema.safeParse(missing).success).toBe(false);
  });
});
