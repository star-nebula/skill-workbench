// origins.cjs — skill 来源标记（canonical 名 + 目录信号 → self|installed）
// self      = 自行创建/维护的 skill（为自身项目或工作流定制，放心改、值得维护）
// installed = 官方/第三方安装的通用 skill（可能被上游更新覆盖，改动风险高）
//
// 判定优先级（见 resolve）：
//   1. selfOverrides：人工确认的自管特例（唯一保留的人工表）
//      —— 自管件偶尔撞安装信号：company-due-diligence-skill 带 LICENSE、
//         agent-memory 目录名撞 agent-* 前缀
//   2. plugin / runtime 层 → installed（第三方安装产物）
//   3. 目录安装元数据：_skillhub_meta.json / _meta.json / _store_meta.json / .skill-metadata.yaml → installed
//      _user_meta.json 且 source=userImport → self（用户导入 = 自管资产）
//      目录含 LICENSE* → installed（第三方发行件特征）
//   4. user 层原始目录名 agent-* 前缀 → installed（ZCode 官方 agent-skills 包特有命名，对应工程方法论 19 件）
//   5. 其余（user 层无任何安装痕迹）→ **默认 self**（亲手创建/放入的才会在 user 层且无痕迹）
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

module.exports = {
  selfOverrides: SELF_OVERRIDES,
  dirOrigin,
  // 解析副本来源：dir 为该副本真实目录，layer 为注册表 layer，name 为原始目录名（未 canonical 化）
  resolve(canonical, dir, layer, name) {
    if (SELF_OVERRIDES.includes(canonical)) return 'self';
    if (layer === 'plugin' || layer === 'runtime') return 'installed';
    if (dir) {
      const d = dirOrigin(dir);
      if (d) return d;
    }
    if (name && /^agent-/.test(name)) return 'installed';
    return 'self'; // user 层无安装痕迹 → 默认自管
  },
};
