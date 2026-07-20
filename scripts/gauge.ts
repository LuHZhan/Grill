import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scanRepo } from '../src/reader/offline/tree.js';
import { planBatches, estimateTokens, type FileEntry } from '../src/reader/offline/batch.js';

const root = process.argv[2]!;
const budget = Number(process.argv[3] ?? 40000);
const name = basename(root);
const scan = scanRepo(root);
const entries: FileEntry[] = scan.files.map((rel) => ({
  path: `${name}/${rel}`,
  bytes: statSync(join(root, rel)).size,
}));
const totalTokens = entries.reduce((s, e) => s + estimateTokens(e.bytes), 0);
const batches = planBatches(entries, budget);

console.log(`仓库: ${name}`);
console.log(`文件数: ${entries.length}`);
console.log(`估算总 token: ${totalTokens} (≈ ${(totalTokens / 1000).toFixed(0)}K)`);
console.log(`预算 ${budget} token/批 → ${batches.length} 批 (即 ${batches.length} 次 S2 调用 + 1 次 S3)`);
console.log('各批:');
for (const b of batches) {
  console.log(`  - ${b.id}  ${b.files.length} 文件  ~${b.tokens} token`);
}
