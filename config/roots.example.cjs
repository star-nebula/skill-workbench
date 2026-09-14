// config/roots.cjs — skill 工作台扫描配置（示例模板）
// 推荐用法：运行 `node tools/autodetect.cjs` 自动检测本机工具目录生成本文件；
// 或复制本文件为 roots.cjs 后手工编辑。roots.cjs 含个人路径，已被 .gitignore 排除。
// layer: user=用户级主区（可写）| runtime=工具运行时（只读）
module.exports = {
  roots: [
    // 每个工具的 skill 目录一条记录。path 用正斜杠。
    { tool: 'zcode',  path: 'C:/Users/<你>/.zcode/skills',  layer: 'user' },
    { tool: 'claude', path: 'C:/Users/<你>/.claude/skills', layer: 'user' },
    // 单真身共享区（可选）：其他工具里指向该目录的 junction/symlink 会被识别为 shared 链接层，
    // 展示/编辑直达真身，不做材料化。master: true 全库只能有一个。
    // { tool: 'agents', path: 'C:/Users/<你>/.agents/skills', layer: 'user', master: true },
    // 只读系统区（工具运行时自动管理的 skill）
    // { tool: 'lobsterai', path: 'C:/Users/<你>/AppData/Roaming/LobsterAI/SKILLs', layer: 'runtime' },
  ],
  // 插件缓存（可选）：工具插件树内的 skill，按深度找 SKILL.md，标「插件更新即失效」
  pluginGlobs: [
    // { tool: 'zcode-plugins', path: 'C:/Users/<你>/.zcode/cli/plugins/cache', maxDepth: 4 },
  ],
  // 忽略的目录名
  ignore: ['.system', '.git', 'node_modules', '__pycache__'],
  // 别名映射（可选）：同一 skill 在不同工具下的目录名差异归一化，
  // 如 zcode 惯用 agent- 前缀而其他工具不带：{ canonical: 'my-skill', variants: ['agent-my-skill'] }
  aliases: [],
  // 编辑器额外白名单目录（可选）：如仓库里的 skill 源
  extraAllowedDirs: [],
};
