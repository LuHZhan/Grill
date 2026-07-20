/**
 * S2 分批精读的**分批算法**(纯函数,不碰 LLM 也不碰文件系统)。
 *
 * 分批的单位是**目录**,不是文件、也不是字节(设计决策 6):
 * - 按文件切:单文件视角物理上产不出"跨文件才能得出"的结论,而那正是 S2 唯一想要的。
 * - 按字节切:会把互不相关的模块凑进同一批,同样写不出跨文件结论。
 * 所以这里以目录子树为原子单位聚类:整棵子树装得下就整批读(内聚最大),
 * 装不下才向下拆,并把拆出的小目录**在同一父目录内**相邻合并回批预算。
 *
 * 单个文件体积超过批预算时**单独成批且不截断**(设计决策 6 / 任务 3.2):
 * 截断一个核心文件产出的笔记是有毒的,宁可它独占一次调用。
 */

/** 估算 token 用的字节/词元比 —— 源码以 ASCII 为主,取 3.5 够用;预算本身留了余量 */
const BYTES_PER_TOKEN = 3.5;

export interface FileEntry {
  /** 文件路径(posix 分隔符,含仓名前缀,如 `backend/api/routes/game.py`) */
  path: string;
  /** 文件字节数 */
  bytes: number;
}

export interface Batch {
  /** 批标识 —— 取自该批文件的公共目录,用于 notes 文件名与 failed_batches 定位 */
  id: string;
  files: FileEntry[];
  /** 该批估算 token 合计 */
  tokens: number;
}

/** 按字节估算 token;向上取整,避免小文件被估成 0 */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

interface DirNode {
  /** 目录路径前缀(posix),根为 '' */
  path: string;
  /** 直接位于本目录下的文件(不含子目录) */
  files: FileEntry[];
  children: Map<string, DirNode>;
}

/**
 * 把文件清单按目录聚类切成若干批,每批 token 不超过 budgetTokens
 * (超预算的单文件除外 —— 它独占一批)。
 */
export function planBatches(files: FileEntry[], budgetTokens: number): Batch[] {
  if (budgetTokens <= 0) throw new Error(`批预算必须为正,收到 ${budgetTokens}`);
  const root = buildTree(files);
  return packDir(root, budgetTokens);
}

/** 把扁平文件清单折成目录树 */
function buildTree(files: FileEntry[]): DirNode {
  const root: DirNode = { path: '', files: [], children: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    const fileName = segments.pop()!; // 最后一段是文件名
    let node = root;
    const acc: string[] = [];
    for (const seg of segments) {
      acc.push(seg);
      let child = node.children.get(seg);
      if (!child) {
        child = { path: acc.join('/'), files: [], children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(file);
    void fileName; // 文件名已含在 file.path 中,这里只用于定位所属目录
  }
  return root;
}

/**
 * 递归打包一个目录子树:
 * - 整棵子树装得下 → 整批读(内聚最大);
 * - 装不下 → 本目录直属文件先打包,子目录各自递归,最后**同层相邻合并**回批预算。
 */
function packDir(node: DirNode, budget: number): Batch[] {
  const subtreeFiles = collectFiles(node);
  const subtreeTokens = totalTokens(subtreeFiles);

  if (subtreeFiles.length === 0) return [];
  if (subtreeTokens <= budget) {
    return [makeBatch(subtreeFiles)];
  }

  const parts: Batch[] = [];
  // 本目录直属文件先成批(单文件超预算则独占一批)
  parts.push(...packFiles(node.files, budget));
  // 子目录按名排序后各自递归 —— 排序让"相邻"约等于"目录相邻",合并时不会凑无关模块
  for (const name of [...node.children.keys()].sort()) {
    parts.push(...packDir(node.children.get(name)!, budget));
  }
  return mergeAdjacent(parts, budget);
}

/** 把一组同目录文件贪心装箱;单个超预算文件冲洗当前批后独占一批,不截断 */
function packFiles(files: FileEntry[], budget: number): Batch[] {
  const out: Batch[] = [];
  let cur: FileEntry[] = [];
  let curTokens = 0;
  const flush = (): void => {
    if (cur.length > 0) {
      out.push(makeBatch(cur));
      cur = [];
      curTokens = 0;
    }
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const t = estimateTokens(file.bytes);
    if (t > budget) {
      flush(); // 先把攒着的收掉
      out.push(makeBatch([file])); // 超预算单文件独占一批
      continue;
    }
    if (curTokens + t > budget) flush();
    cur.push(file);
    curTokens += t;
  }
  flush();
  return out;
}

/**
 * 相邻合并:把连续的小批合并到批预算内,减少调用次数(设计"小目录合并至批预算")。
 * 只合并相邻项 —— 因子目录已按名排序,相邻即目录相邻,不会把无关模块凑一批。
 * 超预算的单文件批天然不会被并入(任何东西加上它都超预算)。
 */
function mergeAdjacent(batches: Batch[], budget: number): Batch[] {
  const out: Batch[] = [];
  for (const b of batches) {
    const last = out[out.length - 1];
    if (last && last.tokens + b.tokens <= budget) {
      last.files.push(...b.files);
      last.tokens += b.tokens;
      last.id = commonDirOfFiles(last.files); // 合并后按新文件集重算公共目录
    } else {
      out.push({ id: b.id, files: [...b.files], tokens: b.tokens });
    }
  }
  return out;
}

/** 收集一个子树下的全部文件 */
function collectFiles(node: DirNode): FileEntry[] {
  const out = [...node.files];
  for (const child of node.children.values()) out.push(...collectFiles(child));
  return out;
}

function totalTokens(files: FileEntry[]): number {
  return files.reduce((sum, f) => sum + estimateTokens(f.bytes), 0);
}

/** 由一组文件构造批:标识取自它们的公共目录,token 为估算合计 */
function makeBatch(files: FileEntry[]): Batch {
  return { id: commonDirOfFiles(files), files: [...files], tokens: totalTokens(files) };
}

/**
 * 一组文件的公共目录前缀。作为批标识,直观指向"这批读的是哪块"。
 * 根下的文件没有公共目录段时标成 'root',以便 notes 文件名与日志可用。
 */
function commonDirOfFiles(files: FileEntry[]): string {
  const dirs = files.map((f) => f.path.split('/').slice(0, -1)); // 去掉文件名段
  if (dirs.length === 0) return 'root';
  let common = dirs[0]!;
  for (const segs of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
  }
  return common.length > 0 ? common.join('/') : 'root';
}
