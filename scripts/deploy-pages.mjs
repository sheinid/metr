import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.status !== 0) throw new Error(`git ${args[0]}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else {
      if (!/\.(html|js|css|svg|ico|png|webp|jpg)$/.test(entry.name)) throw new Error(`Недопустимый файл сборки: ${entry.name}`);
      if (/\.(html|js|css)$/.test(entry.name)) {
        const text = await readFile(path, 'utf8');
        if (/\/api\/planner|OPENAI_API_KEY|api\.openai\.com|PlannerDialog|\/Users\//.test(text)) throw new Error('Сборка содержит локальную фичу или приватные пути. Выполните build:pages.');
      }
    }
  }
}
if (git(['status', '--porcelain'])) throw new Error('Перед публикацией сохраните изменения в коммит.');
const remote = git(['remote', 'get-url', 'origin']);
if (!['https://github.com/sheinid/metr.git', 'git@github.com:sheinid/metr.git'].includes(remote)) throw new Error('Ожидался репозиторий sheinid/metr.');
const sourceCommit = git(['rev-parse', 'HEAD']);
const dist = join(root, 'dist');
const html = await readFile(join(dist, 'index.html'), 'utf8');
if (!html.includes('/metr/assets/')) throw new Error('Выполните npm run build:pages перед публикацией.');
await inspect(dist);
const branch = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/gh-pages'], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
if (![0, 2].includes(branch.status)) throw new Error('Не удалось проверить ветку gh-pages.');
const dir = await mkdtemp(join(tmpdir(), 'metr-pages-'));
try {
  git(['init', '--initial-branch=gh-pages'], dir);
  git(['remote', 'add', 'origin', remote], dir);
  if (branch.status === 0) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], dir);
    git(['checkout', '-B', 'gh-pages', 'FETCH_HEAD'], dir);
    for (const entry of await readdir(dir)) if (entry !== '.git') await rm(join(dir, entry), { recursive: true, force: true });
  }
  for (const entry of await readdir(dist)) await cp(join(dist, entry), join(dir, entry), { recursive: true });
  await writeFile(join(dir, '.nojekyll'), '');
  await writeFile(join(dir, 'build.json'), JSON.stringify({ sourceCommit, mode: 'pages', plannerEnabled: false }, null, 2) + '\n');
  git(['config', 'user.name', git(['config', 'user.name'])], dir);
  git(['config', 'user.email', git(['config', 'user.email'])], dir);
  git(['add', '--all'], dir);
  const changed = git(['status', '--porcelain'], dir);
  if (!changed) console.log('На GitHub Pages уже эта сборка.');
  else {
    git(['commit', '-m', `Publish editor ${sourceCommit.slice(0, 7)}`], dir);
    git(['push', 'origin', 'HEAD:refs/heads/gh-pages'], dir);
    console.log(`Опубликована ветка gh-pages: ${git(['rev-parse', 'HEAD'], dir)}`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
