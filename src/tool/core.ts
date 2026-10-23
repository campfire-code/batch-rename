// 纯函数：映射表解析、改名计划（冲突与非法字符检查）、执行与撤销。
// 执行与撤销通过注入的 FileOps 访问文件系统，测试时用内存实现代替。

export type Cell = string | number | boolean | Date | null;

export interface MapEntry {
  from: string;
  to: string;
  /** 在表格里的行号（从 1 开始），用于提示 */
  line: number;
}

export type RowStatus = 'ok' | 'same' | 'missing' | 'illegal' | 'exists' | 'dup' | 'dupSource';

export interface PlanRow {
  from: string;
  to: string;
  status: RowStatus;
  reason?: string;
  line?: number;
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  ok: '可改名',
  same: '名字没变',
  missing: '找不到原文件',
  illegal: '新名字不合法',
  exists: '会覆盖已有文件',
  dup: '新名字重复',
  dupSource: '原文件重复出现',
};

/** 撤销记录文件名前缀：文件夹里的这类文件不参与改名 */
export const RECORD_PREFIX = '改名撤销记录-';
export const isRecordFile = (name: string) => name.startsWith(RECORD_PREFIX) && name.endsWith('.json');

const text = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
const FROM_RE = /^(原文件名|原始文件名|原名称?|旧文件名|旧名称?|当前文件名|现文件名|文件名|原名字|old\s*name|from|source|original)$/i;
const TO_RE = /^(新文件名|新名称?|目标文件名|改为|改成|新名字|重命名为|new\s*name|to|target)$/i;

/**
 * 解析映射表：有表头时按「原文件名 / 新文件名」等列名找列；没有表头时取前两列。
 * 空行跳过；只填了一边的行记为问题行。
 */
export function parseMapping(grid: Cell[][]): { entries: MapEntry[]; skipped: number[]; columns: string } {
  const rows = grid.map((r) => (r ?? []).map(text));
  const first = rows.findIndex((r) => r.some((c) => c !== ''));
  if (first < 0) throw new Error('表格是空的');
  const head = rows[first].map((c) => c.replace(/\s+/g, ' '));
  let fi = head.findIndex((c) => FROM_RE.test(c));
  let ti = head.findIndex((c) => TO_RE.test(c));
  let start = first + 1;
  let columns: string;
  if (fi >= 0 && ti >= 0 && fi !== ti) columns = `「${head[fi]}」→「${head[ti]}」`;
  else {
    if (fi >= 0 || ti >= 0) throw new Error(`认出了一列「${head[fi >= 0 ? fi : ti]}」，但没找到另一列。表头请写「原文件名」和「新文件名」，或者去掉表头、第一列放原文件名、第二列放新文件名`);
    fi = 0;
    ti = 1;
    start = first;
    columns = '没有表头，按第 1 列 → 第 2 列';
  }
  const entries: MapEntry[] = [];
  const skipped: number[] = [];
  for (let i = start; i < rows.length; i++) {
    const from = rows[i][fi] ?? '';
    const to = rows[i][ti] ?? '';
    if (!from && !to) continue;
    if (!from || !to) skipped.push(i + 1);
    else entries.push({ from, to, line: i + 1 });
  }
  if (!entries.length) throw new Error('表格里没有可用的行：每行要同时填原文件名和新文件名');
  return { entries, skipped, columns };
}

export const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
};
export const stemOf = (name: string) => name.slice(0, name.length - extOf(name).length);

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/** 检查文件名在 Windows 和 macOS 上是否都能用，返回问题说明；合法返回 null */
export function invalidReason(name: string): string | null {
  if (!name.trim()) return '新名字是空的';
  const bad = BAD_CHARS.exec(name);
  if (bad) return `含有不能用在文件名里的字符「${bad[0] < ' ' ? '控制字符' : bad[0]}」（不能用 < > : " / \\ | ? *）`;
  if (/[ .]$/.test(name)) return '不能以空格或句点结尾（Windows 不允许）';
  if (name === '.' || name === '..') return '不能叫 . 或 ..';
  if (RESERVED.test(name)) return `「${name.split('.')[0]}」是 Windows 保留名，不能当文件名`;
  if (new TextEncoder().encode(name).length > 255) return '名字太长（超过 255 字节）';
  return null;
}

const key = (s: string) => s.normalize('NFC').toLowerCase();

export interface PlanOptions {
  /** 新名字没写扩展名时沿用原文件的扩展名 */
  keepExt: boolean;
}

/** 新名字补扩展名：新名字已经带了像扩展名的后缀（.pdf、.jpg 等）就不动，否则补上原文件的扩展名 */
export function withExt(from: string, to: string, keepExt: boolean): string {
  const t = to.trim();
  const ext = extOf(from);
  if (!keepExt || !ext) return t;
  return /^\.[a-z][a-z0-9]{0,4}$/i.test(extOf(t)) ? t : t + ext;
}

/**
 * 生成改名计划：files 是文件夹里现有的文件名。
 * 原文件名可以不写扩展名（文件夹里只有一个同名文件时自动对上）。
 * 只把检查全部通过的行标为 ok；被挡住的行不改，其他行照常改。
 */
export function planFromMapping(files: string[], entries: MapEntry[], opts: PlanOptions): PlanRow[] {
  const byKey = new Map(files.map((f) => [key(f), f]));
  const byStem = new Map<string, string[]>();
  for (const f of files) byStem.set(key(stemOf(f)), [...(byStem.get(key(stemOf(f))) ?? []), f]);
  const rows: PlanRow[] = entries.map((e) => {
    let from = byKey.get(key(e.from));
    if (!from) {
      const cand = byStem.get(key(e.from)) ?? [];
      if (cand.length === 1) from = cand[0];
      else if (cand.length > 1) return { from: e.from, to: e.to, status: 'missing', reason: `有 ${cand.length} 个文件叫这个名字（扩展名不同），请在表里写上扩展名`, line: e.line };
    }
    if (!from) return { from: e.from, to: e.to, status: 'missing', reason: '文件夹里没有这个文件', line: e.line };
    return { from, to: withExt(from, e.to, opts.keepExt), status: 'ok', line: e.line };
  });
  return checkPlan(files, rows);
}

export interface RuleOptions {
  /** 名字模板：{序号} 换成编号，{原名} 换成原文件名（不含扩展名） */
  template: string;
  start: number;
  digits: number;
  /** 只改这些扩展名（如 jpg,png），空表示全部 */
  only: string;
}

/** 按「自然顺序」比较文件名：图2 排在 图10 前面 */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });

export function planFromRule(files: string[], o: RuleOptions): PlanRow[] {
  const exts = o.only.split(/[,，\s]+/).map((s) => s.replace(/^\./, '').toLowerCase()).filter(Boolean);
  const list = files.filter((f) => !exts.length || exts.includes(extOf(f).slice(1).toLowerCase())).sort(naturalCompare);
  const tpl = o.template.trim() || '{序号}';
  if (!tpl.includes('{序号}') && !tpl.includes('{原名}') && list.length > 1) throw new Error('名字模板里要有 {序号} 或 {原名}，否则所有文件会改成同一个名字');
  const rows: PlanRow[] = list.map((f, i) => {
    const n = String(Math.max(0, Math.round(o.start)) + i).padStart(Math.max(1, Math.min(8, Math.round(o.digits))), '0');
    const to = tpl.replace(/\{序号\}/g, n).replace(/\{原名\}/g, stemOf(f)).trim() + extOf(f);
    return { from: f, to, status: 'ok', line: i + 1 };
  });
  return checkPlan(files, rows);
}

/** 统一检查：名字不变、非法字符、新名字互相重复、会覆盖不参与改名的已有文件 */
export function checkPlan(files: string[], input: PlanRow[]): PlanRow[] {
  const rows = input.map((r) => ({ ...r }));
  const existing = new Set(files.map(key));
  const seenFrom = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.status !== 'ok') return;
    if (seenFrom.has(key(r.from))) {
      Object.assign(r, { status: 'dupSource', reason: `和第 ${rows[seenFrom.get(key(r.from))!].line ?? seenFrom.get(key(r.from))! + 1} 行是同一个文件` });
      return;
    }
    seenFrom.set(key(r.from), i);
    if (r.to === r.from) Object.assign(r, { status: 'same', reason: '新旧名字一样，不用改' });
    else {
      const bad = invalidReason(r.to);
      if (bad) Object.assign(r, { status: 'illegal', reason: bad });
    }
  });
  // 新名字互相重复：所有相关行都不改
  const byTarget = new Map<string, PlanRow[]>();
  for (const r of rows) if (r.status === 'ok') byTarget.set(key(r.to), [...(byTarget.get(key(r.to)) ?? []), r]);
  for (const list of byTarget.values()) if (list.length > 1) for (const r of list) Object.assign(r, { status: 'dup', reason: `有 ${list.length} 个文件都要改成这个名字` });
  // 会占用已有文件：目标名已存在，而且那个文件不会被改走（反复计算，直到稳定）
  for (let changed = true; changed;) {
    changed = false;
    const moving = new Set(rows.filter((r) => r.status === 'ok').map((r) => key(r.from)));
    for (const r of rows) {
      if (r.status !== 'ok') continue;
      const t = key(r.to);
      if (t === key(r.from)) continue; // 只改大小写
      if (existing.has(t) && !moving.has(t)) {
        Object.assign(r, { status: 'exists', reason: '文件夹里已经有同名文件，为了不覆盖，这个不改' });
        changed = true;
      }
    }
  }
  return rows;
}

export const countBy = (rows: PlanRow[]) => {
  const c: Record<RowStatus, number> = { ok: 0, same: 0, missing: 0, illegal: 0, exists: 0, dup: 0, dupSource: 0 };
  for (const r of rows) c[r.status]++;
  return c;
};

// ---------- 执行与撤销 ----------

export interface FileOps {
  /** 列出文件夹里的文件名（不含子文件夹） */
  list(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  join(...parts: string[]): Promise<string>;
}

export interface UndoRecord {
  tool: 'batch-rename';
  version: 1;
  folder: string;
  at: string;
  /** 实际改成功的：from 是改名前，to 是改名后 */
  items: { from: string; to: string }[];
  undoneAt?: string;
}

export interface RunReport {
  done: { from: string; to: string }[];
  failed: { from: string; to: string; reason: string }[];
}

/**
 * 按顺序改名：目标名空着的先改；遇到互换（a→b、b→a）或只改大小写时，先挪到临时名再改。
 * 每一步改名前都再确认目标不存在，绝不覆盖已有文件。
 */
export async function applyRenames(dir: string, pairs: { from: string; to: string }[], fs: FileOps, onStep?: (done: number) => void): Promise<RunReport> {
  const report: RunReport = { done: [], failed: [] };
  // cur：每个待改项现在实际叫什么名字（可能是临时名）
  const pending = pairs.map((p) => ({ ...p, cur: p.from }));
  const occupied = async (name: string) => fs.exists(await fs.join(dir, name));
  const tmpName = (i: number) => `.改名中-${Date.now().toString(36)}-${i}.tmp`;
  let tmpSeq = 0;
  const step = () => onStep?.(report.done.length + report.failed.length);

  while (pending.length) {
    let progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const caseOnly = key(p.cur) === key(p.to) && p.cur !== p.to;
      // 目标名还被另一个待改文件占着：等它先挪走
      const blockedByPending = pending.some((q, j) => j !== i && key(q.cur) === key(p.to));
      if (caseOnly || blockedByPending) continue;
      try {
        if (await occupied(p.to)) throw new Error('目标名已被别的文件占用，未覆盖');
        await fs.rename(await fs.join(dir, p.cur), await fs.join(dir, p.to));
        report.done.push({ from: p.from, to: p.to });
      } catch (e) {
        // 改名失败：如果已挪到临时名，尽量挪回原名
        if (p.cur !== p.from) await fs.rename(await fs.join(dir, p.cur), await fs.join(dir, p.from)).catch(() => {});
        report.failed.push({ from: p.from, to: p.to, reason: e instanceof Error ? e.message : String(e) });
      }
      pending.splice(i, 1);
      i--;
      progressed = true;
      step();
    }
    if (!progressed && pending.length) {
      // 全部互相等待（成环）或只改大小写：把第一个挪到临时名打破僵局
      const p = pending[0];
      const tmp = tmpName(tmpSeq++);
      try {
        if (await occupied(tmp)) throw new Error('临时名被占用');
        await fs.rename(await fs.join(dir, p.cur), await fs.join(dir, tmp));
        p.cur = tmp;
      } catch (e) {
        report.failed.push({ from: p.from, to: p.to, reason: e instanceof Error ? e.message : String(e) });
        pending.shift();
        step();
      }
    }
  }
  return report;
}

export const recordName = (d: Date) => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${RECORD_PREFIX}${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.json`;
};

/** 执行计划里可改的行，并把撤销记录写进同一个文件夹，返回记录路径 */
export async function execute(dir: string, plan: PlanRow[], fs: FileOps, now = new Date(), onStep?: (n: number) => void): Promise<RunReport & { recordPath: string | null }> {
  const pairs = plan.filter((r) => r.status === 'ok').map(({ from, to }) => ({ from, to }));
  const report = await applyRenames(dir, pairs, fs, onStep);
  let recordPath: string | null = null;
  if (report.done.length) {
    const record: UndoRecord = { tool: 'batch-rename', version: 1, folder: dir, at: now.toISOString(), items: report.done };
    recordPath = await fs.join(dir, recordName(now));
    await fs.writeText(recordPath, JSON.stringify(record, null, 2));
  }
  return { ...report, recordPath };
}

export function parseRecord(json: string): UndoRecord {
  let r: UndoRecord;
  try {
    r = JSON.parse(json);
  } catch {
    throw new Error('撤销记录文件损坏，读不出来');
  }
  if (r?.tool !== 'batch-rename' || !Array.isArray(r.items)) throw new Error('这不是本工具生成的撤销记录');
  return r;
}

/** 找文件夹里最近一份还没撤销的记录 */
export async function latestRecord(dir: string, fs: FileOps): Promise<{ path: string; record: UndoRecord } | null> {
  const names = (await fs.list(dir)).filter(isRecordFile).sort().reverse();
  for (const n of names) {
    const path = await fs.join(dir, n);
    try {
      const record = parseRecord(await fs.readText(path));
      if (!record.undoneAt) return { path, record };
    } catch {
      /* 跳过损坏的记录 */
    }
  }
  return null;
}

/** 按撤销记录改回原名：改名后的文件已不在、或原名已被别的文件占用时跳过这一项 */
export async function undo(recordPath: string, fs: FileOps, now = new Date()): Promise<RunReport> {
  const record = parseRecord(await fs.readText(recordPath));
  if (record.undoneAt) throw new Error(`这份记录已在 ${record.undoneAt.slice(0, 16).replace('T', ' ')} 撤销过`);
  const dir = record.folder;
  const pairs: { from: string; to: string }[] = [];
  const failed: RunReport['failed'] = [];
  const files = new Set((await fs.list(dir)).map(key));
  const back = record.items.map((i) => ({ from: i.to, to: i.from }));
  const vacating = new Set(back.map((b) => key(b.from)));
  for (const b of back) {
    if (!files.has(key(b.from))) failed.push({ ...b, reason: '改名后的文件已经不在了（可能被移动或删除）' });
    else if (files.has(key(b.to)) && !vacating.has(key(b.to)) && key(b.to) !== key(b.from)) failed.push({ ...b, reason: '原名已被别的文件占用，未覆盖' });
    else pairs.push(b);
  }
  const report = await applyRenames(dir, pairs, fs);
  record.undoneAt = now.toISOString();
  await fs.writeText(recordPath, JSON.stringify(record, null, 2));
  return { done: report.done, failed: [...failed, ...report.failed] };
}
