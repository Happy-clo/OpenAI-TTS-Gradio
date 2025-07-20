// scripts/sync-repo.js
// 自动同步 https://github.com/Happy-clo/Happy-TTS 到本地仓库（排除 .github），并强制覆盖本地内容
// 用法：node scripts/sync-repo.js <github_token>
// 注意：本地 .github 目录不会被删除或覆盖，远程 .github 目录也不会被同步进来。

const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const REMOTE_REPO = 'https://github.com/Happy-clo/Happy-TTS.git';
const LOCAL_REPO = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(os.tmpdir(), 'repo-sync-tmp');
const EXCLUDE_DIRS = ['.github', '.git', 'node_modules', 'dist-obfuscated'];

function shouldExclude(name) {
  return EXCLUDE_DIRS.includes(name);
}

const GITHUB_DIR = path.join(LOCAL_REPO, '.github');
const GITHUB_BACKUP = path.join(os.tmpdir(), 'repo-sync-github-backup');

// 备份本地 .github 目录
if (fs.existsSync(GITHUB_DIR)) {
  fs.removeSync(GITHUB_BACKUP);
  fs.copySync(GITHUB_DIR, GITHUB_BACKUP);
}

async function main() {
  const GITHUB_TOKEN = process.argv[2] || process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.error('请提供 GitHub Token 作为参数或环境变量 GITHUB_TOKEN');
    process.exit(1);
  }

  // 1. 克隆远程仓库到临时目录
  if (fs.existsSync(TEMP_DIR)) fs.removeSync(TEMP_DIR);
  await simpleGit().clone(REMOTE_REPO, TEMP_DIR, ['--depth', '1']);

  // 2. 删除本地仓库除 .github 外的所有内容（本地 .github 目录不会被删除或覆盖）
  fs.readdirSync(LOCAL_REPO).forEach(item => {
    if (shouldExclude(item)) return;
    const target = path.join(LOCAL_REPO, item);
    fs.removeSync(target);
  });

  // 3. 复制远程仓库内容（排除 .github，远程 .github 目录不会被同步进来）
  fs.readdirSync(TEMP_DIR).forEach(item => {
    if (shouldExclude(item)) return;
    const src = path.join(TEMP_DIR, item);
    const dest = path.join(LOCAL_REPO, item);
    fs.copySync(src, dest);
  });

  // 同步后还原本地 .github 目录
  if (fs.existsSync(GITHUB_BACKUP)) {
    fs.removeSync(GITHUB_DIR);
    fs.copySync(GITHUB_BACKUP, GITHUB_DIR);
    fs.removeSync(GITHUB_BACKUP);
  }

  // 4. 强制 add/commit/push
  const git = simpleGit(LOCAL_REPO);
  await git.addConfig('user.name', 'Happy-clo');
  await git.addConfig('user.email', 'happycloo@outlook.com');
  await git.add('.');
  await git.commit('chore: 同步 Happy-TTS 仓库内容（自动同步脚本提交）', {'--allow-empty': null});
  // 设置远程仓库 URL，使用 token 认证
  const remoteUrl = `https://Happy-clo:${GITHUB_TOKEN}@github.com/Happy-clo/OpenAI-TTS-Gradio.git`;
  await git.remote(['set-url', 'origin', remoteUrl]);
  await git.push(['-f', 'origin', 'main']);

  console.log('同步完成并强制推送！');
}

main().catch(e => {
  console.error('同步失败：', e);
  process.exit(1);
}); 