import { parseArgs } from 'node:util';
import { statSync } from 'node:fs';

/** 阅读者离线生成的命令行入参 */
export interface CliOptions {
  /** 被测仓库的本地路径,至少一个 —— 单仓项目不需要凑成对 */
  repos: string[];
  /** 用户简历履历文件 */
  resume: string;
  /** 岗位 JD 文件 */
  jd: string;
  /** 可选的功能关系配置 */
  links?: string;
  /** 产物目录(GRILL.md / profile.json / notes/) */
  out: string;
}

export const DEFAULT_OUT_DIR = './.lazygrill';

export const USAGE = `用法:
  npm run preprocess -- --repo <仓库路径> [--repo <仓库路径>...] --resume <简历文件> --jd <JD文件> [--links <关系配置.json>] [--out <输出目录>]

参数:
  --repo    被测项目的仓库本地路径,可重复传入;单仓项目给一个即可
  --resume  用户简历履历文件
  --jd      岗位 JD 文件
  --links   可选。用户手写的功能关系配置(JSON);不给则由阅读者推导
  --out     产物目录,默认 ${DEFAULT_OUT_DIR}

环境变量:
  DEEPSEEK_API_KEY  分批精读与汇总所需
`;

/**
 * 解析命令行入参。缺少必填项时抛错并点名缺的是哪一项 ——
 * 报错要能直接指向用户该补什么,而不是丢一份完整用法让人自己找。
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string', multiple: true },
      resume: { type: 'string' },
      jd: { type: 'string' },
      links: { type: 'string' },
      out: { type: 'string', default: DEFAULT_OUT_DIR },
    },
    allowPositionals: false,
  });

  const repos = values.repo ?? [];
  if (repos.length === 0) throw new Error('缺少 --repo:至少要指定一个被测仓库路径');
  if (!values.resume) throw new Error('缺少 --resume:需要一份简历履历文件');
  if (!values.jd) throw new Error('缺少 --jd:需要一份岗位 JD 文件');

  return {
    repos,
    resume: values.resume,
    jd: values.jd,
    links: values.links,
    out: values.out!,
  };
}

/** 校验一份输入文件可读;不可读时点名是哪一份,由 CLI 转成非零退出码 */
export function assertReadableFile(label: string, path: string): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${label}文件不存在:${path}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label}路径不是文件:${path}`);
  }
}
