// autodetect.cjs — 一键生成 config/roots.cjs（发布版：新用户零配置起步）
// 扫描常见 AI 编码工具的 skill 目录（存在才收录），并探测单真身共享链接。
// 用法: node tools/autodetect.cjs [--force]   （已存在 roots.cjs 时需 --force 覆盖）
// 生成后可手工编辑 config/roots.cjs 增删目录或别名。
const fs = require('fs');
const path = require('path');
const os = require('os');

const WB = path.resolve(__dirname, '..');
const HOME = os.homedir();
const out = [];
const say = s => process.stdout.write(s + '\n');

// 候选工具：目录名 → 工具名（用户主目录下的 .<name>[/skills]）
// layer: user=用户级主区（可写）| runtime=工具运行时（只读）
const candidates = [
  // name, dir, layer
  ['zcode',      '.zcode/skills',                    'user'],
  ['codebuddy',  '.codebuddy/skills',                'user'],
  ['workbuddy',  '.workbuddy/skills',                'user'],
  ['claude',     '.claude/skills',                   'user'],
  ['lingma',     '.lingma/skills',                   'user'],
  ['trae-cn',    '.trae-cn/skills',                  'user'],
  ['trae',       '.trae/skills',                     'user'],
  ['openclaw',   '.openclaw/skills',                 'user'],
  ['qwenwork',   '.qwenworkcn/skills',               'user'],
  ['qwen',       '.qwen/skills',                     'user'],
  ['hub',        '.hub/skills',                      'user'],
  ['cline',      '.cline/skills',                    'user'],
  ['windsurf',   '.windsurf/skills',                 'user'],
  ['cursor',     '.cursor/skills',                   'user'],
  ['copilot',    '.copilot/skills',                  'user'],
  ['opencode',   '.opencode/skills',                 'user'],
  ['gemini',     '.gemini/skills',                   'user'],
  ['iflow',      '.iflow/skills',                    'user'],
  ['agents',     '.agents/skills',                   'user'],   // 通用单真身共享区（lark-master 类）
  ['lobsterai',  'AppData/Roaming/LobsterAI/SKILLs', 'runtime'],
];

const roots = [];
const pluginGlobs = [];
let masterTool = null;

for (const [tool, rel, layer] of candidates) {
  const abs = path.join(HOME, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) continue;
  let hasSkill = false;
  try { hasSkill = fs.readdirSync(abs).some(n => !n.startsWith('.') && fs.statSync(path.join(abs, n)).isDirectory()); } catch {}
  if (!hasSkill) { say(`  skip ${tool} (空目录)`); continue; }
  const isMaster = tool === 'agents';
  if (isMaster) masterTool = tool;
  roots.push({ tool, path: abs.replace(/\\/g, '/'), layer, ...(isMaster ? { master: true } : {}) });
  say(`  found ${tool}: ${abs}`);
}

// ZCode 插件缓存（有才收录）
const zplug = path.join(HOME, '.zcode', 'cli', 'plugins', 'cache');
if (fs.existsSync(zplug)) {
  pluginGlobs.push({ tool: 'zcode-plugins', path: zplug.replace(/\\/g, '/'), maxDepth: 4 });
  say(`  found zcode 插件缓存: ${zplug}`);
}

if (!roots.length) {
  say('\n未发现任何工具的 skill 目录。请手工创建 config/roots.cjs（参考 README「配置」一节）。');
  process.exit(1);
}

const body = `// config — skill 工作台扫描配置（由 tools/autodetect.cjs 生成于 ${new Date().toISOString().slice(0, 10)}，可手工修改）
// layer: user=用户级主区 | shared=单真身共享链接(入口) | plugin=插件缓存 | runtime=工具运行时（只读）
module.exports = {
  roots: ${JSON.stringify(roots, null, 2).replace(/\n/g, '\n  ')},
  pluginGlobs: ${JSON.stringify(pluginGlobs, null, 2).replace(/\n/g, '\n  ')},
  // 忽略的目录名
  ignore: ['.system', '.git', 'node_modules', '__pycache__'],
  // 别名映射（同一 skill 在不同工具下的目录名差异，如 zcode 的 agent-* 前缀）。
  // 自动发现：若某工具目录普遍带 agent- 前缀而其他工具不带，可加一条：
  //   { canonical: 'xxx', variants: ['agent-xxx'] }
  aliases: [],
  // 编辑器额外可访问目录（白名单，选填）
  extraAllowedDirs: [],
};
`;

const dst = path.join(WB, 'config', 'roots.cjs');
if (fs.existsSync(dst) && !process.argv.includes('--force')) {
  say(`\n${dst} 已存在（如需覆盖加 --force）。本次仅预览，未写入。`);
  say('--- 预览 ---\n' + body);
} else {
  fs.writeFileSync(dst, body);
  say(`\n已写入 ${dst}`);
  say('下一步: node tools/scan.cjs && node server.cjs → 打开 http://localhost:8788');
}
