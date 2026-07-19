import { readFileSync } from 'node:fs';
import { LinksConfigSchema, type Link, type LinksConfig } from '../schema.js';

/** 读取并解析用户手写的关系配置文件 */
export function readLinksConfig(path: string): LinksConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`关系配置文件不存在或读不了:${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`关系配置文件不是合法 JSON:${path} —— ${(err as Error).message}`);
  }

  const result = LinksConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`关系配置文件结构不合法:${path}\n${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.join('.') || '(根)'}: ${i.message}`).join('\n');
}

/**
 * 关系里的一个引用项,形如 `仓名:仓内相对路径`。
 *
 * 必须带仓名前缀:n 元关系可横跨任意多个仓,靠"在所有仓里找一遍"来兜底
 * 会在同名文件上误判(两个仓都有 `src/index.ts` 时无从分辨),而这类误判
 * 恰恰会让下游以为某条不存在的链路成立。
 */
function parseRef(ref: string): { repo: string; path: string } | null {
  const sep = ref.indexOf(':');
  if (sep <= 0 || sep === ref.length - 1) return null;
  return { repo: ref.slice(0, sep), path: ref.slice(sep + 1) };
}

/**
 * 校验每条关系引用的路径存在于对应仓库,任一项对不上就跳过整条并告警。
 *
 * 跳过而非终止:关系配置是辅助信息,写错一条不该让整场预处理白跑;
 * 但也不能静默 —— 用户会以为自己声明的链路生效了,而它其实被丢了。
 */
export function validateLinks(
  links: Link[],
  filesByRepo: Map<string, Set<string>>,
  warn: (msg: string) => void,
): Link[] {
  return links.filter((link) => {
    const problems: string[] = [];

    for (const ref of link.repos) {
      const parsed = parseRef(ref);
      if (!parsed) {
        problems.push(`「${ref}」缺少仓名前缀(应形如 仓名:仓内路径)`);
        continue;
      }
      const files = filesByRepo.get(parsed.repo);
      if (!files) {
        problems.push(`仓名 ${parsed.repo} 不在被扫描的仓库列表中`);
        continue;
      }
      if (!files.has(parsed.path)) {
        problems.push(`${parsed.path} 不在仓库 ${parsed.repo} 中`);
      }
    }

    if (problems.length > 0) {
      warn(
        `关系「${link.relation}」已跳过:${problems.join(';')}` +
          `(可能是路径写错,也可能是该文件被忽略规则排除,如位于 node_modules 或隐藏目录下)`,
      );
      return false;
    }
    return true;
  });
}
