import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateObject } from 'ai';
import { readerModel, DEFAULT_MODEL, type BaseLlmConfig } from '../llm.js';
import { BatchNoteSchema, type BatchNote, type FailedBatch } from '../schema.js';
import type { Batch } from './batch.js';

/**
 * S2 分批精读:逐批把源码发给 LLM,产出结构化笔记(BatchNote)。
 *
 * 编排(缓存 / 并发 / 重试 / 失败聚合)与**具体的 LLM 调用**分离:后者以
 * `BatchNoteGenerator` 注入,默认是 DeepSeek 实现,测试时可换成假实现,
 * 让编排逻辑脱离网络可测。
 */

/**
 * S2 系统 Prompt —— 只讲"如何理解、如何取舍",**不描述输出结构**。
 * 结构由 BatchNoteSchema 强制(reader-agent spec:产出结构 MUST 由 schema 约束而非 Prompt)。
 * 放在 system 且跨批固定,让 DeepSeek 的自动前缀缓存能覆盖这段指令。
 */
const S2_SYSTEM_PROMPT = `你在精读一个软件项目中的一批源码文件,为下游生成一份"指路地图"做准备。

只提炼**需要读多个文件才能得出**的结论。单独读一个文件就能知道的事实一律不要写——下游有检索工具可以随时自己看,复述只会挤占它的上下文。

要抓的:
- 跨模块的调用契约:一个模块依赖另一个模块的什么、以什么形式交互
- 架构决策与权衡:为什么这么设计,而不是罗列它"是什么"
- 不显然的坑:容易踩错、与直觉相悖的地方

不要写:逐文件的功能清单、构建/测试/lint 命令、代码风格、语言通用常识。

对于本批文件看不全、需要读到本批之外才能确认的东西,如实标注为存疑——分批精读天然有盲区,把"这批没看到"显式留痕,避免下游把它误当成"项目里没有"。

忠实于你实际读到的源码,不要臆造材料里没有的内容。`;

export interface DeepReadConfig extends BaseLlmConfig {
  /** 笔记缓存目录(通常是 <out>/notes) */
  notesDir: string;
  /** 单批输出上限 token */
  maxOutputTokens: number;
  /** 并发批数 */
  concurrency: number;
  /** 单批失败重试次数(不含首次);2 表示最多尝试 3 次 */
  maxRetries: number;
}

export const DEFAULT_DEEPREAD_CONFIG: Omit<DeepReadConfig, 'notesDir'> = {
  model: DEFAULT_MODEL,
  temperature: 0.2, // 低温求稳定(设计:S2 用低温)
  maxOutputTokens: 8192,
  concurrency: 3,
  maxRetries: 2,
};

/** 把批内某个文件的相对路径(含仓名前缀)解析为其源码内容 */
export type FileContentReader = (relPath: string) => string;

/** 精读一批 → 一份笔记。默认走 DeepSeek,测试时可注入假实现 */
export type BatchNoteGenerator = (batch: Batch, content: string) => Promise<BatchNote>;

export interface DeepReadDeps {
  readContent: FileContentReader;
  generate?: BatchNoteGenerator;
  log?: (msg: string) => void;
}

export interface DeepReadResult {
  notes: BatchNote[];
  failed: FailedBatch[];
}

/**
 * 精读所有批次。
 *
 * - 缓存(3.5):命中 notes/ 里已有的合法笔记则直接复用,不再调用 LLM。
 * - 重试(3.7):单批失败按 maxRetries 重试。
 * - 失败可见(3.6):重试耗尽的批记入 failed;**全部批次失败则抛错**,
 *   由上层转非零退出、不落盘一份没有任何分析的地图。
 * - 并发(3.7):至多 concurrency 批同时在飞。
 */
export async function deepReadBatches(
  batches: Batch[],
  config: DeepReadConfig,
  deps: DeepReadDeps,
): Promise<DeepReadResult> {
  mkdirSync(config.notesDir, { recursive: true });
  const generate = deps.generate ?? makeDeepSeekGenerator(config);
  const log = deps.log ?? ((): void => {});

  const notes: BatchNote[] = [];
  const failed: FailedBatch[] = [];

  await runPool(batches, config.concurrency, async (batch) => {
    const cached = loadCachedNote(config.notesDir, batch.id);
    if (cached) {
      notes.push(cached);
      log(`  [缓存命中] ${batch.id}(${batch.files.length} 文件)`);
      return;
    }

    const content = assembleContent(batch, deps.readContent);
    let lastError: unknown;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const note = await generate(batch, content);
        const parsed = BatchNoteSchema.parse({ ...note, batch: batch.id });
        writeNote(config.notesDir, batch.id, parsed);
        notes.push(parsed);
        log(`  [完成] ${batch.id}(${batch.files.length} 文件, ~${batch.tokens} token)`);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < config.maxRetries) {
          log(`  [重试 ${attempt + 1}/${config.maxRetries}] ${batch.id}: ${errMsg(err)}`);
        }
      }
    }
    failed.push({
      batch: batch.id,
      paths: batch.files.map((f) => f.path),
      reason: errMsg(lastError),
    });
    log(`  [失败] ${batch.id}: ${errMsg(lastError)}`);
  });

  if (batches.length > 0 && failed.length === batches.length) {
    throw new Error(
      `全部 ${batches.length} 个批次精读失败,拒绝产出空地图:\n` +
        failed.map((f) => `  - ${f.batch}: ${f.reason}`).join('\n'),
    );
  }
  return { notes, failed };
}

/** 默认的 DeepSeek 精读实现 */
function makeDeepSeekGenerator(config: DeepReadConfig): BatchNoteGenerator {
  // batch 字段由代码回填,不劳模型生成 —— 少一个可被写错的字段
  const genSchema = BatchNoteSchema.omit({ batch: true });
  return async (_batch, content) => {
    const { object } = await generateObject({
      model: readerModel(config.model),
      schema: genSchema,
      schemaName: 'BatchNote',
      system: S2_SYSTEM_PROMPT,
      prompt: content, // 变化的源码放末尾,前缀缓存命中率最大化
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      maxRetries: 0, // 重试由外层统一控制,避免双层重试相乘
    });
    return { batch: '', ...object };
  };
}

/** 把一批文件拼成一段带路径标头的文本 */
function assembleContent(batch: Batch, read: FileContentReader): string {
  return batch.files
    .map((f) => `文件: ${f.path}\n----------\n${read(f.path)}`)
    .join('\n\n');
}

/**
 * 以并发上限 limit 跑一批异步任务。
 * 单线程下对共享数组的 push 发生在 await 之间,天然无竞态。
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const runners = Array.from({ length: width }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** notes 文件名:批标识里的路径分隔符等非法字符转成 `__` */
function notePath(dir: string, batchId: string): string {
  return join(dir, `${batchId.replace(/[^A-Za-z0-9._-]+/g, '__')}.json`);
}

/** 读缓存;不存在或损坏(解析/校验失败)一律视为未命中,交由重新精读 */
function loadCachedNote(dir: string, batchId: string): BatchNote | null {
  const path = notePath(dir, batchId);
  if (!existsSync(path)) return null;
  try {
    return BatchNoteSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function writeNote(dir: string, batchId: string, note: BatchNote): void {
  writeFileSync(notePath(dir, batchId), JSON.stringify(note, null, 2), 'utf8');
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
