// server.cjs — skill 工作台本地服务（零依赖，端口 8788）
// API:
//   GET  /api/registry          — 注册表概览（组+副本，组内含一致性状态）
//   GET  /api/group/<canonical> — 组详情
//   GET  /api/file?path=&tool=  — 读 skill 文件（限白名单目录）
//   POST /api/file              — 保存文件 {path, content}
//   POST /api/create            — 新建 skill {tool, name, description}
//   POST /api/delete            — 删除单个真实副本 {tool, name}（移入回收站）
//   POST /api/sync              — 同步组 {canonical}（最后编辑胜出）
//   POST /api/rescan            — 重扫注册表
//   GET  /api/log               — 同步日志
//   POST /api/install-preview   — GitHub 安装预览 {repo} → 识别 skill 清单（不落盘）
//   POST /api/install           — 安装 {repo, subpath?, targets:[{tool,name}]} → 复制落盘
//   POST /api/copy              — 复制组到目标工具 {canonical, targetTool} → 最新副本镜像
//   GET  /api/diff?canonical=   — 组内分歧明细（源候选 + 每副本差异文件）
//   GET  /api/tree?dir=         — skill 目录文件树（限白名单）
//   POST /api/category          — 类别人工覆写 {canonical, category|null}
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WB = path.resolve(__dirname);
const PORT = 8788;

// lark-master（master 共享区）磁盘位置：roots.cjs 里 master:true 的条目；找不到时退回 ~/.agents/skills
function masterRoot() {
  try {
    const m = require(WB + '/config/roots.cjs').roots.find(r => r.master);
    if (m) return m.path;
  } catch {}
  return require('os').homedir().replace(/\\/g, '/') + '/.agents/skills';
}

// 可访问目录白名单：注册表中出现的全部根 + 链接真身 + extraAllowedDirs
function allowedRoots() {
  const reg = loadRegistry();
  const set = new Set();
  for (const c of reg.copies) {
    set.add(path.resolve(c.link ? path.dirname(c.dir) : c.dir));
    // 共享链接的真身目录也要可读可写（经链接编辑实际写入真身）
    if (c.link && c.link.resolved) set.add(path.resolve(c.link.resolved));
  }
  let cfg = {};
  try { cfg = require(WB + '/config/roots.cjs'); } catch {}
  (cfg.extraAllowedDirs || []).forEach(d => set.add(path.resolve(d)));
  return [...set];
}
function loadRegistry() { return JSON.parse(fs.readFileSync(WB + '/data/registry.json', 'utf8')); }

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function safePath(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  for (const root of allowedRoots()) {
    if (abs === root || abs.startsWith(root + path.sep)) return abs;
  }
  return null;
}

function regWithStatus() {
  const reg = loadRegistry();
  for (const g of reg.groups) {
    const reals = g.copies.map(id => reg.copies.find(c => c.id === id)).filter(c => c && !c.link);
    if (reals.length >= 2) {
      const hashes = new Set(reals.map(c => c.treeHash));
      g.syncState = hashes.size === 1 ? 'identical' : 'diverged';
      // 最新副本（=同步源候选）
      const sorted = [...reals].sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
      g.newestCopy = sorted[0].id;
      g.divergedTools = g.syncState === 'diverged' ? reals.map(c => c.tool) : [];
    } else {
      g.syncState = reals.length === 1 ? 'single-real' : 'shared-only';
    }
  }
  return reg;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 5e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, t);
    else fs.copyFileSync(s, t);
  }
}
// 复制并保留 mtime（同步/安装落盘都用它，保证"最后编辑胜出"语义稳定）
function copyDirPreserve(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    if (e.isDirectory()) copyDirPreserve(s, t);
    else { fs.copyFileSync(s, t); fs.utimesSync(t, fs.statSync(s).atime, fs.statSync(s).mtime); }
  }
  // 顶层目录本身也保 mtime——目录 mtime 是 last-edit-wins 同步的判定依据
  try { fs.utimesSync(dst, fs.statSync(src).atime, fs.statSync(src).mtime); } catch {}
}
// 仓库内识别 skill 目录：返回 [{name, dir, description}]
function detectSkills(repoDir) {
  const out = [];
  const hasSkillMd = d => fs.existsSync(path.join(d, 'SKILL.md'));
  const fmDesc = d => {
    try {
      const t = fs.readFileSync(path.join(d, 'SKILL.md'), 'utf8');
      const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) return '';
      const kv = m[1].split(/\r?\n/).find(l => /^description:\s*/.test(l));
      return kv ? kv.replace(/^description:\s*/, '').replace(/^["']|["'],?$/g, '').slice(0, 160) : '';
    } catch { return ''; }
  };
  const push = d => out.push({ name: path.basename(d), dir: d, description: fmDesc(d) });
  if (hasSkillMd(repoDir)) { push(repoDir); return out; }
  for (const e of fs.readdirSync(repoDir, { withFileTypes: true })) {
    if (!e.isDirectory() || ['.git', 'node_modules', '__pycache__'].includes(e.name)) continue;
    const r = path.join(repoDir, e.name);
    if (hasSkillMd(r)) push(r);
    else if (e.name === 'skills') { // skills/ 聚合目录再下一层
      for (const e2 of fs.readdirSync(r, { withFileTypes: true })) {
        if (e2.isDirectory() && hasSkillMd(path.join(r, e2.name))) push(path.join(r, e2.name));
      }
    }
  }
  return out;
}
// git clone 到临时目录，返回本地路径（调用方负责删除）
function gitClone(repo) {
  let url = repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) url = 'https://github.com/' + repo + '.git';
  else if (/^https?:\/\/(github|gitee)\.com\//.test(repo) && !repo.endsWith('.git')) url = repo + '.git';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-'));
  execFileSync('git', ['clone', '--depth', '1', url, tmp], { stdio: 'pipe', timeout: 120000 });
  return tmp;
}
function treeHash(root) {
  const h = require('crypto').createHash('sha1');
  const walk = d => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(d, e.name);
      if (e.isDirectory()) { h.update('D' + e.name + '\n'); walk(r); }
      else { try { h.update('F' + e.name + '|' + fs.statSync(r).size + '\n'); } catch {} }
    }
  };
  walk(root);
  return h.digest('hex');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/registry') {
      const reg = regWithStatus();
      return json(res, 200, { generatedAt: reg.generatedAt, totalCopies: reg.totalCopies, totalGroups: reg.totalGroups, groups: reg.groups, copies: reg.copies });
    }
    if (req.method === 'GET' && url.pathname === '/api/log') {
      const p = WB + '/data/log.md';
      return json(res, 200, { log: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/group/')) {
      const reg = regWithStatus();
      const canonical = decodeURIComponent(url.pathname.split('/').pop());
      const g = reg.groups.find(x => x.canonical === canonical);
      if (!g) return json(res, 404, { error: 'group not found' });
      const copies = g.copies.map(id => reg.copies.find(c => c.id === id));
      return json(res, 200, { group: g, copies });
    }
    if (req.method === 'GET' && url.pathname === '/api/file') {
      const p = safePath(url.searchParams.get('path'));
      if (!p) return json(res, 403, { error: 'path not allowed' });
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return json(res, 404, { error: 'not a file' });
      return json(res, 200, { path: p, content: fs.readFileSync(p, 'utf8') });
    }
    if (req.method === 'POST' && url.pathname === '/api/file') {
      const b = await readBody(req);
      const p = safePath(b.path);
      if (!p) return json(res, 403, { error: 'path not allowed' });
      if (!fs.existsSync(p)) return json(res, 404, { error: 'file gone' });
      fs.writeFileSync(p, b.content, 'utf8');
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) return json(res, 400, { error: 'skill 名仅允许小写字母/数字/连字符（2-64 位）' });
      const reg = loadRegistry();
      const rootEntry = (b.tool === 'lark-master' ? { path: masterRoot() } : reg.copies.find(c => c.tool === b.tool && c.layer === 'user' && !c.link));
      const toolRoot = b.tool === 'lark-master' ? masterRoot() : path.dirname(rootEntry.dir);
      const dir = path.join(toolRoot, name);
      if (fs.existsSync(dir)) return json(res, 409, { error: '该工具下已存在同名 skill' });
      const desc = String(b.description || '').replace(/\r?\n/g, ' ').slice(0, 300);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: "${desc || 'TODO: 描述此 skill 的用途与触发时机'}"\n---\n\n# ${name}\n\nTODO: 编写 skill 正文（工作流、步骤、注意事项）。\n`, 'utf8');
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true, dir });
    }
    if (req.method === 'POST' && url.pathname === '/api/delete') {
      const b = await readBody(req);
      const reg = loadRegistry();
      const c = reg.copies.find(x => x.id === b.id);
      if (!c) return json(res, 404, { error: 'copy not found' });
      if (c.link) return json(res, 400, { error: 'shared-link 入口不删，请删除其真身或用工具卸载' });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dst = path.join(WB, 'data', 'trash', ts, c.tool + '-' + c.name);
      copyDir(c.dir, dst);
      fs.rmSync(c.dir, { recursive: true, force: true });
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true, trashedTo: dst });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync') {
      const b = await readBody(req);
      const before = fs.readFileSync(WB + '/data/log.md', 'utf8').length;
      execFileSync('node', [WB + '/tools/sync.cjs', 'sync', String(b.canonical)], { stdio: 'pipe' });
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      const log = fs.readFileSync(WB + '/data/log.md', 'utf8').slice(before);
      return json(res, 200, { ok: true, log });
    }
    if (req.method === 'POST' && url.pathname === '/api/rescan') {
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/install-preview') {
      const b = await readBody(req);
      const repo = String(b.repo || '').trim();
      if (!repo) return json(res, 400, { error: '请填 owner/repo 或仓库 URL' });
      let tmp;
      try { tmp = gitClone(repo); } catch (e) { return json(res, 400, { error: 'clone 失败: ' + e.message.split('\n')[0] }); }
      try {
        const skills = detectSkills(tmp).map(s => ({ ...s, dir: undefined, relPath: path.relative(tmp, s.dir).replace(/\\/g, '/') }));
        if (!skills.length) return json(res, 400, { error: '仓库中未识别到 skill（没有含 SKILL.md 的目录）' });
        const reg = loadRegistry();
        const existing = new Set(reg.groups.map(g => g.canonical));
        return json(res, 200, { ok: true, skills: skills.map(s => ({ ...s, exists: existing.has(s.name) })) });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/install') {
      const b = await readBody(req);
      const repo = String(b.repo || '').trim();
      const picks = Array.isArray(b.picks) ? b.picks : []; // [{relPath, name, targets:[toolRootKey...]}]
      if (!repo || !picks.length) return json(res, 400, { error: '缺少 repo 或 picks' });
      // 目标根：注册表里该工具 user 层真实副本的父目录
      const reg = loadRegistry();
      const toolRoots = {};
      for (const c of reg.copies) {
        if (c.layer === 'user' && !c.link && !toolRoots[c.tool]) toolRoots[c.tool] = path.dirname(c.dir);
      }
      let tmp;
      try { tmp = gitClone(repo); } catch (e) { return json(res, 400, { error: 'clone 失败: ' + e.message.split('\n')[0] }); }
      try {
        const installed = [], skipped = [];
        for (const p of picks) {
          const srcDir = path.resolve(tmp, p.relPath);
          if (!srcDir.startsWith(path.resolve(tmp))) return json(res, 400, { error: '非法 relPath' });
          if (!fs.existsSync(path.join(srcDir, 'SKILL.md'))) { skipped.push(p.name + '（无 SKILL.md）'); continue; }
          const name = String(p.name || path.basename(srcDir));
          if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name) && !/^[^\s\\/]{1,64}$/.test(name)) { skipped.push(name + '（名字不合法）'); continue; }
          for (const tk of (p.targets || [])) {
            const root = toolRoots[tk] || (tk === 'lark-master' ? masterRoot() : null);
            if (!root) { skipped.push(name + '→' + tk + '（无用户级目录）'); continue; }
            const dst = path.join(root, name);
            if (fs.existsSync(dst)) { skipped.push(name + '→' + tk + '（已存在）'); continue; }
            copyDirPreserve(srcDir, dst);
            installed.push(dst);
          }
        }
        if (installed.length) execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
        return json(res, 200, { ok: true, installed, skipped });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/copy') {
      const b = await readBody(req);
      const reg = regWithStatus();
      const g = reg.groups.find(x => x.canonical === b.canonical);
      if (!g) return json(res, 404, { error: 'group not found' });
      const reals = g.copies.map(id => reg.copies.find(c => c.id === id)).filter(c => c && !c.link);
      if (!reals.length) return json(res, 400, { error: '组内无真实副本可作源' });
      const src = [...reals].sort((a, b2) => new Date(b2.mtime) - new Date(a.mtime))[0];
      const rootEntry = reg.copies.find(c => c.tool === b.targetTool && c.layer === 'user' && !c.link);
      const toolRoot = b.targetTool === 'lark-master' ? masterRoot() : rootEntry ? path.dirname(rootEntry.dir) : null;
      if (!toolRoot) return json(res, 400, { error: '目标工具无用户级目录' });
      const dst = path.join(toolRoot, g.canonical);
      if (fs.existsSync(dst)) return json(res, 409, { error: '目标已存在 ' + dst });
      copyDirPreserve(src.dir, dst);
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true, dst, from: src.dir });
    }
    if (req.method === 'GET' && url.pathname === '/api/diff') {
      const canonical = url.searchParams.get('canonical');
      const reg = loadRegistry();
      const g = reg.groups.find(x => x.canonical === canonical);
      if (!g) return json(res, 404, { error: 'group not found' });
      const reals = g.copies.map(id => reg.copies.find(c => c.id === id)).filter(c => c && !c.link);
      if (reals.length < 2) return json(res, 200, { ok: true, diffs: [], note: '少于 2 个真实副本' });
      // 现算 treeHash/mtime（注册表是上次扫描的快照，直接用会漏掉刚发生的外部编辑）
      for (const c of reals) {
        try { const st = fs.statSync(c.dir); c.mtime = st.mtime.toISOString(); } catch {}
        c.treeHash = (() => { const h = require('crypto').createHash('sha1'); const walk = d => {
          let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const e of es.sort((a, b2) => a.name.localeCompare(b2.name))) {
            const r = path.join(d, e.name);
            if (e.isDirectory()) { h.update('D' + e.name + '\n'); walk(r); }
            else { try { h.update('F' + e.name + '|' + fs.statSync(r).size + '\n'); } catch {} }
          }
        }; walk(c.dir); return h.digest('hex'); })();
      }
      const sorted = [...reals].sort((a, b2) => new Date(b2.mtime) - new Date(a.mtime));
      const src = sorted[0];
      const diffs = [];
      for (const c of sorted.slice(1)) {
        if (c.treeHash === src.treeHash) { diffs.push({ tool: c.tool, dir: c.dir, identical: true, files: [] }); continue; }
        // 递归对比：source 有 target 无 = 新增；反向 = 多余(进回收站)；都在但大小不同 = 修改
        const files = [];
        const walkCmp = (rel) => {
          const s = path.join(src.dir, rel), t = path.join(c.dir, rel);
          const sIn = fs.existsSync(s), tIn = fs.existsSync(t);
          if (sIn && tIn && fs.statSync(s).isDirectory() && fs.statSync(t).isDirectory()) {
            for (const n of new Set([...fs.readdirSync(s), ...fs.readdirSync(t)])) walkCmp(rel ? rel + '/' + n : n);
          } else if (sIn && !tIn) files.push({ f: rel, change: '新增于源' });
          else if (!sIn && tIn) files.push({ f: rel, change: '目标多余→将进回收站' });
          else { try { if (fs.statSync(s).size !== fs.statSync(t).size) files.push({ f: rel, change: '内容不同→源覆盖' }); } catch {} }
        };
        walkCmp('');
        diffs.push({ tool: c.tool, dir: c.dir, identical: false, files: files.slice(0, 50), total: files.length });
      }
      return json(res, 200, { ok: true, source: { tool: src.tool, dir: src.dir, mtime: src.mtime }, diffs });
    }
    if (req.method === 'GET' && url.pathname === '/api/tree') {
      const p = safePath(url.searchParams.get('dir'));
      if (!p) return json(res, 403, { error: 'path not allowed' });
      const out = [];
      const walk = (d, rel, depth) => {
        if (depth > 4) return;
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
          if (['.git', 'node_modules', '__pycache__'].includes(e.name)) continue;
          const r = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) { out.push({ f: r, dir: true }); walk(path.join(d, e.name), r, depth + 1); }
          else out.push({ f: r, dir: false, size: (() => { try { return fs.statSync(path.join(d, e.name)).size; } catch { return 0; } })() });
        }
      };
      walk(p, '', 0);
      return json(res, 200, { ok: true, files: out });
    }
    if (req.method === 'POST' && url.pathname === '/api/category') {
      const b = await readBody(req);
      const p = WB + '/data/cat-overrides.json';
      let ov = {};
      try { ov = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      if (b.category === null || b.category === '') delete ov[b.canonical]; else ov[b.canonical] = b.category;
      fs.writeFileSync(p, JSON.stringify(ov, null, 1));
      execFileSync('node', [WB + '/tools/scan.cjs'], { stdio: 'pipe' });
      return json(res, 200, { ok: true });
    }
    // 静态页
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(WB + '/public/index.html', 'utf8'));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`skill workbench: http://127.0.0.1:${PORT}`));
