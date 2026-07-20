import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 一个仓库里一份清单文件的**关键字段**提取结果 —— 只取名称与依赖名,不留全文。
 *
 * 依赖名是证据分级里"清单文件"这一档的核心:它比源码便宜(不用精读)、
 * 比 README 硬(是机器写的事实),且是比对用户自述的第一手材料
 * ([[detect-contradictions]] 的证据面之一)。
 */
export interface RepoManifest {
  /** 仓名 */
  repo: string;
  /** 清单文件在仓内的相对路径(如 `package.json`) */
  file: string;
  /** 清单声明的项目名,缺失则为 undefined */
  packageName?: string;
  /** 依赖/模块名列表(原样保留大小写),不含版本号 */
  dependencies: string[];
}

/** 仓根下按此顺序尝试的清单文件与各自的解析器 */
const MANIFESTS: ReadonlyArray<{ file: string; parse: (raw: string) => ParsedManifest }> = [
  { file: 'package.json', parse: parsePackageJson },
  { file: 'pyproject.toml', parse: parsePyproject },
  { file: 'requirements.txt', parse: parseRequirements },
  { file: 'go.mod', parse: parseGoMod },
];

interface ParsedManifest {
  packageName?: string;
  dependencies: string[];
}

/**
 * 提取一个仓根下所有已知清单文件的关键字段。
 *
 * 只看仓根:MVP 不下探嵌套清单(monorepo 内的子包 package.json)。
 * 单个清单解析失败(损坏 JSON、非常规 TOML)只跳过该文件,不影响其余清单,
 * 更不中断整场扫描 —— 清单是辅助证据,缺一份不该让预处理白跑。
 */
export function extractManifests(repoRoot: string, repoName: string): RepoManifest[] {
  const result: RepoManifest[] = [];
  for (const { file, parse } of MANIFESTS) {
    let raw: string;
    try {
      raw = readFileSync(join(repoRoot, file), 'utf8');
    } catch {
      continue; // 该清单不存在,跳过
    }
    try {
      const parsed = parse(raw);
      result.push({ repo: repoName, file, ...parsed });
    } catch {
      continue; // 该清单解析失败,跳过但保留其余
    }
  }
  return result;
}

function parsePackageJson(raw: string): ParsedManifest {
  const pkg = JSON.parse(raw) as {
    name?: unknown;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  return {
    packageName: typeof pkg.name === 'string' ? pkg.name : undefined,
    dependencies: [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ],
  };
}

/**
 * pyproject.toml 的**轻量**解析 —— 不引 TOML 库,靠正则抓 PEP 621 与 poetry 两种写法。
 *
 * 覆盖:
 * - `[project]` 下的 `name = "x"` 与 `dependencies = ["fastapi>=0.1", ...]`
 * - `[tool.poetry.dependencies]` 表里的 `fastapi = "^0.1"` 行(跳过 `python` 这一条)
 * 依赖名统一取版本约束前的包名前缀。
 */
function parsePyproject(raw: string): ParsedManifest {
  const deps = new Set<string>();

  // PEP 621:dependencies = [ ... ] 数组。闭合 `]` 锚定在行首 ——
  // 依赖项内部的 `]`(如 `psycopg[binary]==3.1` 的 extras)不在行首,不会
  // 被误当成数组结尾而截断后续依赖。单行数组走回退分支。
  const multi = /(?:^|\n)[ \t]*dependencies[ \t]*=[ \t]*\[([\s\S]*?)\n[ \t]*\]/.exec(raw);
  const single = multi ? null : /(?:^|\n)[ \t]*dependencies[ \t]*=[ \t]*\[([^\n]*)\]/.exec(raw);
  const body = multi?.[1] ?? single?.[1];
  if (body) {
    for (const m of body.matchAll(/["']([^"']+)["']/g)) {
      const name = packageToken(m[1]!);
      if (name) deps.add(name);
    }
  }

  // poetry:[tool.poetry.dependencies] 表,读到下一个 [section] 为止
  const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(raw);
  if (poetry?.[1]) {
    for (const line of poetry[1].split('\n')) {
      const m = /^\s*([A-Za-z0-9._-]+)\s*=/.exec(line);
      const name = m?.[1];
      if (name && name.toLowerCase() !== 'python') deps.add(name);
    }
  }

  const nameMatch = /\[project\][\s\S]*?\n\s*name\s*=\s*["']([^"']+)["']/.exec(raw);
  return { packageName: nameMatch?.[1], dependencies: [...deps] };
}

/** requirements.txt:逐行取版本约束前的包名,跳过注释与选项行 */
function parseRequirements(raw: string): ParsedManifest {
  const deps = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const name = packageToken(trimmed);
    if (name) deps.add(name);
  }
  return { dependencies: [...deps] };
}

/**
 * go.mod:取 `module` 声明与 `require` 中的模块路径。
 * 模块路径原样保留(如 `github.com/gin-gonic/gin`),比对时按子串匹配。
 */
function parseGoMod(raw: string): ParsedManifest {
  const deps = new Set<string>();
  const moduleMatch = /(?:^|\n)\s*module\s+(\S+)/.exec(raw);

  // require ( ... ) 块
  const block = /require\s*\(([\s\S]*?)\)/.exec(raw);
  if (block?.[1]) {
    for (const line of block[1].split('\n')) {
      const m = /^\s*(\S+)\s+v\S+/.exec(line);
      if (m?.[1]) deps.add(m[1]);
    }
  }
  // 单行 require path v1.2.3
  for (const m of raw.matchAll(/(?:^|\n)\s*require\s+(\S+)\s+v\S+/g)) {
    deps.add(m[1]!);
  }

  return { packageName: moduleMatch?.[1], dependencies: [...deps] };
}

/** 从依赖声明里剥出包名前缀:遇到版本约束/空白/分号即止 */
function packageToken(spec: string): string | null {
  const m = /^[A-Za-z0-9._\-@/]+/.exec(spec.trim());
  return m ? m[0] : null;
}
