// origins.cjs — skill 来源标记（canonical 名 + 目录信号 → self|installed）
// self      = 自行创建/维护的 skill（为自身项目或工作流定制，放心改、值得维护）
// installed = 官方/第三方安装的通用 skill（可能被上游更新覆盖，改动风险高）
//
// 判定优先级（见 resolve）：
//   1. selfOverrides：人工确认的自管特例（唯一保留的人工表）
//      —— 自管件偶尔撞安装信号：company-due-diligence-skill 带 LICENSE、
//         agent-memory 目录名撞 agent-* 前缀
//   2. plugin / runtime 层 → installed（第三方安装产物）
//   3. 安装账本：skills CLI 的 .skill-lock.json（如 ~/.agents/.skill-lock.json，记录
//      lark CLI 等经其安装的 skill 名单）——安装痕迹不在 skill 目录内时由此兜住
//   4. 目录安装元数据：_skillhub_meta.json / _meta.json / _store_meta.json / .skill-metadata.yaml → installed
//      _user_meta.json 且 source=userImport → self（用户导入 = 自管资产）
//      目录含 LICENSE* → installed（第三方发行件特征）
//   5. user 层原始目录名 agent-* 前缀 → installed（ZCode 官方 agent-skills 包特有命名，对应工程方法论 19 件）
//   6. 其余（user 层无任何安装痕迹）→ **默认 self**（亲手创建/放入的才会在 user 层且无痕迹）
//
// 已知边界：安装证据只存在于部分副本时（如 zcode 的 agent-* 副本被删后，
// codebuddy/workbuddy 的无痕迹副本会回落 self）——此时该组上游更新通道已断，
// 判 self 语义上反而准确。组级取"任一 installed 即 installed"（保守）。
//
// 修改后重扫（node tools/scan.cjs 或工作台"重新扫描"）生效。
const fs = require('fs');
const path = require('path');

const SELF_OVERRIDES = [
  // 带安装痕迹信号但实为自管的特例：
  'company-due-diligence-skill', // 自管但带 LICENSE（防规则 5 误判）
  'agent-memory',                // 自管，原始目录名撞 agent-* 前缀（防规则 4 误判）
];

// 反向特例：无任何安装痕迹但实为工具自带/安装的（信号盲区人工兜底）
const INSTALLED_OVERRIDES = [
  'android-dev',              // CodeBuddy 自带（目录仅 INSTALL_ENVIRONMENT.md + SKILL.md，无任何信号）
  'api-and-interface-design', // CodeBuddy 自带（工程方法论家族成员；zcode 的 agent-* 副本被删后组内无信号）
  // WorkBuddy 预装/自定义生态件（用户确认非自管，2026-09-17）
  'browser-skill', 'shadowbot-yingdao-migration',
  'feishu-docx-fourcolor', 'feishu-whiteboard-svg', 'feishu-wiki-publish-images',
  // ZCode 侧经 npx skills add 安装的 vercel-labs 系与官方指南（用户确认，2026-09-17）
  'deploy-to-vercel', 'vercel-cli-with-tokens', 'vercel-composition-patterns', 'vercel-optimize',
  'vercel-react-best-practices', 'vercel-react-native-skills', 'vercel-react-view-transitions',
  'web-design-guidelines', 'writing-guidelines',
];

// 预装型工具：其 user 层的无信号 skill 视为工具自带（installed）。
// 依据：这些工具的生态件（连接器/媒体/官方模板）由工具预装，不在 skill 目录留任何痕迹。
const BUNDLED_TOOLS = ['qwenwork', 'hub', 'understand-anything', 'openclaw-autoclaw'];

// 不确定自管还是安装的：不强行分类，标 unknown（用户确认原则，2026-09-17）
const UNKNOWN_OVERRIDES = [
  'ef-broadcast', 'ef-communication', 'ef-profile', // EigenFlux 体系，来源待定
  'self-improving-agent', 'tavily-search',           // openclaw 侧，来源待定
];

// 判定是否带安装元数据文件（各工具命名不统一，全列出）
const INSTALL_META_FILES = ['_skillhub_meta.json', '_meta.json', '_store_meta.json', '.skill-metadata.yaml'];
const USER_IMPORT_META = '_user_meta.json';

function dirOrigin(dir) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return null; }
  if (INSTALL_META_FILES.some(f => files.includes(f))) return 'installed';
  if (files.includes(USER_IMPORT_META)) {
    try {
      const um = JSON.parse(fs.readFileSync(path.join(dir, USER_IMPORT_META), 'utf8'));
      if (um.source === 'userImport') return 'self';
    } catch {}
  }
  if (files.some(f => /^LICENSE(\.|$)/.test(f))) return 'installed';
  return null; // 无信号
}

// 安装账本：skills CLI 的 lock 文件（skill 名 → 来源记录）。安装痕迹不在 skill
// 目录里而在账本里（如 lark CLI 装的 lark-*），目录无任何信号时由此兜住。
const LOCK_FILES = [
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.agents', '.skill-lock.json'),
];
let ledger = null;
function loadLedger() {
  if (ledger) return ledger;
  ledger = new Set();
  for (const f of LOCK_FILES) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const name of Object.keys(j.skills || {})) ledger.add(name);
    } catch {}
  }
  return ledger;
}

module.exports = {
  selfOverrides: SELF_OVERRIDES,
  installedOverrides: INSTALLED_OVERRIDES,
  unknownOverrides: UNKNOWN_OVERRIDES,
  bundledTools: BUNDLED_TOOLS,
  dirOrigin,
  loadLedger,
  // 解析副本来源：dir 为该副本真实目录，layer 为注册表 layer，name 为原始目录名（未 canonical 化）
  // 返回 'self' | 'installed' | 'unknown'
  resolve(canonical, dir, layer, name) {
    if (SELF_OVERRIDES.includes(canonical)) return 'self';
    if (INSTALLED_OVERRIDES.includes(canonical)) return 'installed';
    if (UNKNOWN_OVERRIDES.includes(canonical)) return 'unknown';
    if (layer === 'plugin' || layer === 'runtime') return 'installed';
    if (loadLedger().has(canonical) || loadLedger().has(name)) return 'installed';
    if (dir) {
      const d = dirOrigin(dir);
      if (d) return d;
    }
    if (name && /^agent-/.test(name)) return 'installed';
    return 'self'; // 默认自管
  },
  // 带工具上下文的解析（scan.cjs 用这个）：预装型工具的无信号件判 installed
  resolveWithTool(canonical, dir, layer, name, tool) {
    if (SELF_OVERRIDES.includes(canonical)) return 'self';
    if (INSTALLED_OVERRIDES.includes(canonical)) return 'installed';
    if (UNKNOWN_OVERRIDES.includes(canonical)) return 'unknown';
    if (layer === 'plugin' || layer === 'runtime') return 'installed';
    if (loadLedger().has(canonical) || loadLedger().has(name)) return 'installed';
    if (dir) {
      const d = dirOrigin(dir);
      if (d) return d;
    }
    if (name && /^agent-/.test(name)) return 'installed';
    if (BUNDLED_TOOLS.includes(tool)) return 'installed'; // 预装型工具的无信号件 = 工具自带
    return 'self'; // 默认自管
  },
};
