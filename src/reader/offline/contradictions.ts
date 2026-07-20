import type { Contradiction } from '../schema.js';
import type { RepoManifest } from './manifest.js';

/**
 * 一条技术信号 —— 把"用户口中的技术名"映射到"代码里应留下的痕迹"。
 *
 * `mention` 匹配简历/自述里的提法(带词边界,避免 react 命中 reactive);
 * `traces` 是这项技术在代码侧可能留下的痕迹:依赖名(含驱动别名)或文件路径特征。
 * 只要任一 trace 命中,就认为有痕迹,不判矛盾。
 */
interface TechSignal {
  /** 规范技术名,用于生成可读的 claim 文案 */
  name: string;
  mention: RegExp;
  traces: RegExp[];
}

/**
 * 保守的高置信信号表 —— **仅**收录"名字明确、且一旦真用到必留依赖痕迹"的技术。
 *
 * 为什么刻意收窄:纯 S1 阶段只能机械比对,判错一条矛盾会给下游(裁判)喂噪声。
 * 故这里宁可漏报不误报 ——
 * - 驱动别名尽量收全(PostgreSQL 的 pg/psycopg、MySQL 的 mysql2/pymysql),
 *   否则用户说 PostgreSQL、代码用 psycopg2 会被误判成矛盾。
 * - 语言级、太泛的名字(go、c、node)一律不收,词边界也压不住其歧义。
 *
 * 这是**机械预筛**,不是语义比对。真正需要理解上下文的矛盾(如"高并发"却用了
 * 同步阻塞写法)属 S3 汇总阶段 LLM 的职责,不在此列。表可随评估结果增补。
 */
const SIGNALS: readonly TechSignal[] = [
  { name: 'Redis', mention: /(?<![a-z])redis(?![a-z])/i, traces: [/redis|ioredis/i] },
  {
    name: 'PostgreSQL',
    mention: /(?<![a-z])postgres(?:ql)?(?![a-z])/i,
    traces: [/(?<![a-z])(pg|postgres|psycopg|asyncpg|pgx)(?![a-z])/i],
  },
  {
    name: 'MySQL',
    mention: /(?<![a-z])mysql(?![a-z])/i,
    traces: [/mysql|pymysql|mariadb/i],
  },
  {
    name: 'MongoDB',
    mention: /(?<![a-z])mongo(?:db)?(?![a-z])/i,
    traces: [/mongo|mongoose|pymongo/i],
  },
  { name: 'Kafka', mention: /(?<![a-z])kafka(?![a-z])/i, traces: [/kafka/i] },
  {
    name: 'RabbitMQ',
    mention: /(?<![a-z])rabbitmq(?![a-z])/i,
    traces: [/rabbit|amqp|pika/i],
  },
  {
    name: 'Elasticsearch',
    mention: /(?<![a-z])el(?:astic)?search(?![a-z])/i,
    traces: [/elasticsearch|elastic|opensearch/i],
  },
  { name: 'GraphQL', mention: /(?<![a-z])graphql(?![a-z])/i, traces: [/graphql|apollo|gql/i] },
  { name: 'React', mention: /(?<![a-z])react(?![a-z])/i, traces: [/(?<![a-z])react(?![a-z])/i] },
  { name: 'Vue', mention: /(?<![a-z])vue(?:\.js)?(?![a-z])/i, traces: [/(?<![a-z])vue(?![a-z])/i] },
  {
    name: 'Django',
    mention: /(?<![a-z])django(?![a-z])/i,
    traces: [/django/i, /manage\.py/i],
  },
  { name: 'Flask', mention: /(?<![a-z])flask(?![a-z])/i, traces: [/flask/i] },
  { name: 'FastAPI', mention: /(?<![a-z])fastapi(?![a-z])/i, traces: [/fastapi|starlette|uvicorn/i] },
  { name: 'Docker', mention: /(?<![a-z])docker(?![a-z])/i, traces: [/dockerfile|docker-compose/i] },
  {
    name: 'Kubernetes',
    mention: /(?<![a-z])(kubernetes|k8s)(?![a-z])/i,
    traces: [/kubernetes|k8s|helm/i, /\.ya?ml$/i],
  },
];

/**
 * 机械比对用户自述与代码证据,产出 contradictions。
 *
 * 代码证据面 = 全部清单依赖名 ∪ 全部文件相对路径。选这两者是成本考量:
 * 都在 S0/S1 已收集,不用为比对再精读一遍源码(那是 S2 的开销)。
 * 代价是抓不到"只出现在源码正文、不留依赖也不留文件名"的用法 —— 这类留给 S3。
 *
 * 判据:某技术在自述中被提及,却在证据面里找不到任何痕迹 → 一条 contradiction。
 * **绝不**反过来改写用户的说法:不一致本身是下游最有价值的输入,替用户"修正"
 * 等于把最该被追问的接缝抹平(spec:MUST NOT 依据代码自行修正用户说法)。
 */
export function detectContradictions(
  resume: string,
  manifests: RepoManifest[],
  files: string[],
): Contradiction[] {
  const depNames = manifests.flatMap((m) => m.dependencies).join('\n');
  const evidence = `${depNames}\n${files.join('\n')}`;

  const out: Contradiction[] = [];
  for (const sig of SIGNALS) {
    if (!sig.mention.test(resume)) continue;
    if (sig.traces.some((t) => t.test(evidence))) continue;
    out.push({
      claim: `简历/自述提及 ${sig.name}`,
      evidence: `依赖清单与文件清单中均未见 ${sig.name} 的痕迹`,
    });
  }
  return out;
}
