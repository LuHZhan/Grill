import { readFileSync } from 'node:fs';
import { LinksConfigSchema, type Link, type LinksConfig } from './schema.js';

/** 读取并解析用户手写的链路配置文件 */
export function readLinksConfig(path: string): LinksConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`链路配置文件不存在或读不了:${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`链路配置文件不是合法 JSON:${path} —— ${(err as Error).message}`);
  }

  const result = LinksConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`链路配置文件结构不合法:${path}\n${formatIssues(result.error.issues)}`);
  }
  return result.data;
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.join('.') || '(根)'}: ${i.message}`).join('\n');
}

/**
 * 校验每条 link 的前后端路径存在于对应仓库,缺失时告警。
 * 只有前后端路径都能对上的 link 才合并进轻档案。
 */
export function validateLinks(
  links: Link[],
  frontendFiles: string[],
  backendFiles: string[],
  warn: (msg: string) => void,
): Link[] {
  const frontend = new Set(frontendFiles);
  const backend = new Set(backendFiles);

  return links.filter((link) => {
    const missing: string[] = [];
    if (!frontend.has(link.frontend)) missing.push(`前端 ${link.frontend}`);
    if (!backend.has(link.backend)) missing.push(`后端 ${link.backend}`);
    if (missing.length > 0) {
      warn(
        `链路「${link.desc}」的路径未出现在扫描结果中,已跳过:${missing.join('、')}` +
          `(可能是路径写错,也可能是该文件被忽略规则排除,如位于 node_modules/tests/ 或隐藏目录下)`,
      );
      return false;
    }
    return true;
  });
}
