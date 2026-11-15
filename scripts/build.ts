// Builds the static site into deploy/vercel. Needs Bun (https://bun.sh); the output is committed, so only
// people who change the game's source need to run this.
//   bun scripts/build.ts
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'deploy/vercel');
const src = join(root, 'apps/client/src');
const pub = join(root, 'apps/client/public');

for (const f of readdirSync(out)) {
  if (['api', 'package.json', 'vercel.json', 'README.md'].includes(f)) continue;
  rmSync(join(out, f), { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });

const entries = [
  { entry: join(src, 'main.ts'), name: 'app' },
  { entry: join(src, 'host.worker.ts'), name: 'host.worker' },
  { entry: join(src, 'calc.worker.ts'), name: 'calc.worker' },
];
for (const e of entries) {
  const r = await Bun.build({ entrypoints: [e.entry], outdir: out, naming: `${e.name}.js`, target: 'browser', format: 'esm', minify: true, sourcemap: 'none' });
  if (!r.success) {
    for (const m of r.logs) console.error(m);
    process.exit(1);
  }
}
cpSync(pub, out, { recursive: true });
let bytes = 0;
for (const f of readdirSync(out)) {
  const st = statSync(join(out, f));
  if (st.isFile()) bytes += st.size;
}
console.log(`built ${entries.length} bundles into ${out} (${(bytes / 1024).toFixed(0)} KB of files at the top level)`);
