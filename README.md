# Skill 工作台

一个**零依赖**的本地 Skill 管理工作台：把散落在十几个 AI 编码工具（ZCode、CodeBuddy、Claude、通义灵码、OpenClaw……）目录里的 skill 副本，收敛成一张可搜索、可编辑、可同步、可安装的总表。

单文件 HTTP 服务（`server.cjs`，仅用 Node 内置模块），浏览器打开即用。

## 它解决什么问题

同一份 skill 往往要复制到多个工具目录才能各自使用，于是产生三类痛点：

1. **看不见**——不知道某个 skill 装在了哪几个工具里、哪个版本最新；
2. **改了不同步**——在一个工具里改了 SKILL.md，其他副本还是旧的；
3. **装新 skill 麻烦**——从 GitHub 找到 skill，要手动 clone、挑目录、复制到每个工具。

工作台把每个工具目录扫描成「副本」，同名副本聚合为「组」，提供组级的同步、复制、安装、删除操作。

## 一句话部署

把下面这句话原样发给你的 AI 编码工具（Codex / WorkBuddy / ZCode / Claude Code / Cline 等任何能执行命令的 agent），它就会自动完成下载、检测、启动：

> 帮我部署 Skill 工作台：clone https://github.com/<你>/skill-workbench 到任意目录（如 E:\Projects\workbenches\skill-workbench），进入该目录后依次执行 `node tools/autodetect.cjs` 自动检测本机 AI 工具的 skill 目录并生成配置、`node tools/scan.cjs` 生成注册表、后台启动 `node server.cjs`（Node ≥ 18，零依赖无需 npm install），最后告诉我浏览器打开 http://localhost:8788 即可使用。若 autodetect 提示未发现工具目录，让它按 README「配置」一节手工编辑 config/roots.cjs 后重试。

部署好后每次启动只需一条命令：`node server.cjs`。

## 快速开始（手动三步）

```bash
# 1. 自动检测本机工具目录，生成 config/roots.cjs（可再手工编辑）
node tools/autodetect.cjs

# 2. 扫描生成注册表 data/registry.json
node tools/scan.cjs

# 3. 启动工作台
node server.cjs
# → 打开 http://localhost:8788
```

要求：Node ≥ 18（仅内置模块，无需 npm install）、Windows（robocopy 同步）/ macOS / Linux 均可运行，非 Windows 上同步自动退化为 Node 递归复制。

## 功能

| 功能 | 说明 |
|---|---|
| 总览矩阵 | 223 组 × N 副本；按功能分类（15 类，可点击卡片徽章人工覆写）；按工具/分歧/单副本/共享筛选 |
| 在线编辑 | 点开任意副本 → 文件树 → 编辑任意文件 → Ctrl+S 保存到原位；未保存离开有确认拦截 |
| 分歧检测 | 组内副本 treeHash 不一致即标「分歧」；查看差异（新增于源 / 目标多余 / 内容不同）→ 一键以最新副本同步全组 |
| 同步语义 | **最后编辑胜出**：组内 mtime 最新的副本为源，镜像到其余副本；多余文件先移入 `data/trash/<时间戳>/` 不硬删 |
| GitHub 安装 | 粘贴 `owner/repo` → 自动识别仓库内 skill（根 SKILL.md / 顶层目录 / skills/ 聚合目录）→ 勾选 + 选目标工具 → 落盘安装（保留 mtime） |
| 复制到… | 把某组最新副本复制到缺失的工具目录（409 防覆盖已存在目录） |
| 新建 skill | 填名称/描述/类别 → 生成带 frontmatter 的 SKILL.md 到所选工具 |
| 删除保护 | 单副本删除 / 整组删除均先移入工作台回收站 `data/trash/`，可手工捞回 |
| 操作日志 | 每次 sync/delete 记录到 `data/log.md`，右上角「日志」按钮查看 |
| 扫描时效 | 超 10 分钟未重扫时页面顶部提示，避免基于过期注册表操作 |

## CLI 等价命令

```bash
node tools/scan.cjs                 # 重扫注册表
node tools/sync.cjs status          # 列出全部 multi 组：一致 / 分歧
node tools/sync.cjs diff <组名>     # 行级差异概要
node tools/sync.cjs sync <组名>     # 最后编辑胜出同步
node tools/autodetect.cjs [--force] # 重新生成 config/roots.cjs
```

## 配置（config/roots.cjs）

```js
module.exports = {
  roots: [
    // layer: user=用户级主区 | shared=共享链接入口 | runtime=只读运行时
    { tool: 'zcode',   path: 'C:/Users/<你>/.zcode/skills',  layer: 'user' },
    { tool: 'claude',  path: 'C:/Users/<你>/.claude/skills', layer: 'user' },
    // master: true 表示该目录是“单真身共享区”——其他工具里的同名 skill
    // 若是指向这里的 junction/symlink，则识别为共享链接（shared 层）
    { tool: 'agents',  path: 'C:/Users/<你>/.agents/skills', layer: 'user', master: true },
  ],
  // 插件缓存（skill 目录藏在插件树里，按深度找 SKILL.md）
  pluginGlobs: [
    { tool: 'zcode-plugins', path: 'C:/Users/<你>/.zcode/cli/plugins/cache', maxDepth: 4 },
  ],
  ignore: ['.system', '.git', 'node_modules', '__pycache__'],
  // 同名 skill 在不同工具下的目录名差异归一化
  aliases: [{ canonical: 'my-skill', variants: ['agent-my-skill'] }],
  // 编辑器额外白名单目录（如仓库里的 skill 源）
  extraAllowedDirs: [],
};
```

## 架构

```
server.cjs            零依赖 HTTP 服务（API + 静态页），端口 8788
public/index.html     单文件前端（原生 JS，无框架）
config/roots.cjs      扫描配置（autodetect 生成或手写）
config/categories.cjs 功能分类规则（精确名 → 通配前缀 → 人工覆写）
tools/scan.cjs        扫描器：目录 → data/registry.json（treeHash/mtime/链接解析）
tools/sync.cjs        同步器：status / diff / sync（robocopy /NODE 回退）
data/registry.json    注册表（扫描快照）
data/trash/           回收站（删除/同步多余文件）
data/log.md           操作日志
data/cat-overrides.json  类别人工覆写
```

关键设计：

- **真实副本留在各工具原生目录**，工作台只读扫描 + 写回，不迁移不集中托管——卸载工作台零残留；
- **treeHash**（sha1 over 排序后的目录树）做副本一致性判定；**目录 mtime** 做同步源选择；复制/安装一律保留 mtime（`utimesSync`），否则 last-edit-wins 会失效；
- **安全**：所有文件读写经 `safePath()` 白名单（roots 目录 + 链接真身 + extraAllowedDirs）；GitHub 安装固定 clone 到系统临时目录、校验 relPath 防目录穿越、装完即删。

## Windows 注意

- 同步用 `robocopy /COPY:DAT /DCOPY:DAT`（退出码 < 8 视为成功）；
- 跨盘回收站移动（C:→E:）`renameSync` 会 EXDEV，自动退化为复制+删除；
- junction/symlink 在 `lstat` 下不返回 directory，扫描器已做 `statSync` 回退。

## License

MIT
