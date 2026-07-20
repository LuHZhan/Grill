import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * 仓库路径的共享类型与安全解析 —— offline 与 online 都依赖,故放在两者之上。
 *
 * 全流程用一个统一的"仓前缀路径"约定:`<仓名>/<仓内相对路径>`(与分批、目录树
 * 附录一致)。把这类路径解析回真实文件、并保证不逃出仓根,是唯一一处安全边界,
 * 不该有第二种实现。
 */

/** 一个仓的最小身份:名字 + 绝对根。带文件清单/树的形态在此之上扩展。 */
export interface RepoRoot {
  name: string;
  /** 仓的绝对本地路径 */
  root: string;
}

/** abs 是否落在 root 之内(含 root 自身);词法判断,挡 `..` 逃逸与仓外绝对路径 */
export function containedIn(abs: string, root: string): boolean {
  const rel = relative(root, abs);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** 把仓前缀路径拆成 (repo, rel);未知仓名且非单仓时报错 */
function splitRepoPath<R extends RepoRoot>(input: string, repos: R[]): { repo: R; rel: string } {
  if (isAbsolute(input)) {
    const abs = resolve(input);
    const owner = repos.find((r) => containedIn(abs, r.root));
    if (!owner) throw new Error(`绝对路径 ${input} 不在任何已声明仓库根内,拒绝访问`);
    return { repo: owner, rel: relative(owner.root, abs) || '.' };
  }

  const trimmed = input.replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');
  const first = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const byName = repos.find((r) => r.name === first);
  if (byName) return { repo: byName, rel: trimmed.slice(slash + 1) || '.' };
  if (repos.length === 1) return { repo: repos[0]!, rel: trimmed }; // 单仓允许裸相对路径
  throw new Error(
    `路径 ${input} 缺少仓名前缀;请用「仓名/仓内路径」,可选仓库:${repos.map((r) => r.name).join(', ')}`,
  );
}

/**
 * 把仓前缀路径解析到绝对路径,并确保仍在仓根内(拒 `..`、符号链接指向仓外、仓外绝对路径)。
 *
 * 这是唯一的路径安全边界:凡是把模型/配置给的路径变成真实文件访问的地方,都必须走这里。
 */
export function resolveRepoPath<R extends RepoRoot>(
  input: string,
  repos: R[],
): { abs: string; repo: R; rel: string } {
  const { repo, rel } = splitRepoPath(input, repos);
  const abs = resolve(repo.root, rel);
  if (!containedIn(abs, repo.root)) {
    throw new Error(`路径 ${input} 逃逸出仓库 ${repo.name} 的根,拒绝访问`);
  }
  // 符号链接:真实路径仍须在仓根真实路径内。文件不存在(ENOENT)时词法检查已足够,
  // 交由上层把"不存在"作为可读错误处理,不在此中断。
  try {
    if (!containedIn(realpathSync(abs), realpathSync(repo.root))) {
      throw new Error(`路径 ${input} 经符号链接指向仓库外,拒绝访问`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return { abs, repo, rel };
}
