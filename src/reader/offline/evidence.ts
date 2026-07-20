import type { ConventionDoc } from './conventions.js';
import type { RepoManifest } from './manifest.js';

/**
 * 按可信度分级组织好的全部离线证据 —— S2/S3 据此决定"信谁的、跳过谁"。
 *
 * 分级顺序固定为:用户输入 > 约定文档 > README > 清单文件 > 源码
 * (设计:证据分级)。这里把前四档物化成字段;源码是第五档,不预读,
 * 由 S2 分批精读现取,故不入此结构。
 */
export interface Evidence {
  /** 第 1 档:用户输入 —— 简历与 JD 原文,最高可信度 */
  resume: string;
  jd: string;
  /** 第 2 档:约定文档(CLAUDE.md / AGENTS.md),由根向下排序 */
  conventions: ConventionDoc[];
  /** 第 3 档:README */
  readmes: ConventionDoc[];
  /** 第 4 档:清单文件的关键字段 */
  manifests: RepoManifest[];
}

/**
 * 把散收的原料按证据分级归位。
 *
 * `docs` 是 collectConventions 的原始输出(convention 与 readme 混在一起、已按
 * 根→叶排好序),这里只按 kind 拆到两档,不重排 —— 排序语义在收集阶段已定。
 */
export function assembleEvidence(
  resume: string,
  jd: string,
  docs: ConventionDoc[],
  manifests: RepoManifest[],
): Evidence {
  return {
    resume,
    jd,
    conventions: docs.filter((d) => d.kind === 'convention'),
    readmes: docs.filter((d) => d.kind === 'readme'),
    manifests,
  };
}

/** 约定文档信号被判为"充足"的总长下限(字符)—— MVP 拍的阈值,非 spec 约束 */
const CONVENTION_SIGNAL_MIN_CHARS = 1500;

export interface ShortCircuit {
  /** 是否跳过 S2 分批精读 */
  skip: boolean;
  /** 决策原因,无论跳不跳都要能打印说明 */
  reason: string;
}

/**
 * 短路判据:约定文档信号充足时跳过分批精读(设计决策 4)。
 *
 * MVP 用一个简单阈值 —— 存在至少一份 convention 档文档(CLAUDE.md/AGENTS.md),
 * 且其正文总长超过下限。理由:人专门写的项目约定信息密度远高于 LLM 从源码里
 * 推的,够长就说明作者已把该说的说清楚了,再精读一遍源码是重复付费。
 *
 * 阈值是拍的,spec 只约束"存在短路机制"、不写死数值(设计 Open Questions),
 * 故此处易于按评估结果调。README 不计入信号 —— 它常是安装说明而非设计约定,
 * 拿它当"信号充足"会把该精读的项目误判成可跳过。
 */
export function evaluateShortCircuit(conventions: ConventionDoc[]): ShortCircuit {
  if (conventions.length === 0) {
    return { skip: false, reason: '未找到约定文档(CLAUDE.md/AGENTS.md),进入分批精读' };
  }
  const totalChars = conventions.reduce((sum, d) => sum + d.content.length, 0);
  if (totalChars < CONVENTION_SIGNAL_MIN_CHARS) {
    return {
      skip: false,
      reason:
        `约定文档共 ${totalChars} 字符,未达下限 ${CONVENTION_SIGNAL_MIN_CHARS},` +
        '信号不足,进入分批精读',
    };
  }
  return {
    skip: true,
    reason:
      `约定文档共 ${conventions.length} 份、${totalChars} 字符,信号充足,` +
      '跳过分批精读(S2)',
  };
}
