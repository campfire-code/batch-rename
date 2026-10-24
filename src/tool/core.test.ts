import { describe, expect, it } from 'vitest';
import { countBy, execute, invalidReason, latestRecord, parseMapping, planFromMapping, planFromRule, undo, withExt, type FileOps } from './core';

/** 内存文件系统：一个文件夹，按 macOS / Windows 默认的「不区分大小写」处理 */
export function memFs(dir: string, names: string[]) {
  const files = new Map<string, string>(names.map((n) => [n, `内容:${n}`]));
  const find = (name: string) => [...files.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
  const nameOf = (p: string) => {
    if (!p.startsWith(dir + '/')) throw new Error('越界路径 ' + p);
    return p.slice(dir.length + 1);
  };
  const ops: FileOps = {
    list: async () => [...files.keys()],
    exists: async (p) => find(nameOf(p)) != null,
    rename: async (a, b) => {
      const src = find(nameOf(a));
      if (src == null) throw new Error('原文件不存在');
      const dst = find(nameOf(b));
      if (dst != null && dst !== src) throw new Error('会覆盖');
      const v = files.get(src)!;
      files.delete(src);
      files.set(nameOf(b), v);
    },
    readText: async (p) => files.get(find(nameOf(p))!)!,
    writeText: async (p, t) => void files.set(nameOf(p), t),
    join: async (...p) => p.join('/'),
  };
  return { files, ops };
}

describe('映射表解析', () => {
  it('按表头找列，表头前可以有空行、列顺序随意', () => {
    const r = parseMapping([[], ['备注', '新文件名', '原文件名'], ['x', '新A', 'a.jpg'], [null, null, null], ['', '新B', 'b.jpg'], ['', '', 'c.jpg']]);
    expect(r.entries).toEqual([{ from: 'a.jpg', to: '新A', line: 3 }, { from: 'b.jpg', to: '新B', line: 5 }]);
    expect(r.skipped).toEqual([6]);
    expect(r.columns).toContain('原文件名');
  });
  it('没有表头时按前两列', () => {
    expect(parseMapping([['a.jpg', 'A'], ['b.jpg', 1001]]).entries.map((e) => e.to)).toEqual(['A', '1001']);
  });
  it('只认出一列时说清楚怎么改', () => {
    expect(() => parseMapping([['原文件名', '说明'], ['a', 'b']])).toThrow('没找到另一列');
  });
});

describe('文件名检查', () => {
  it('非法字符、保留名、结尾句点', () => {
    expect(invalidReason('合同:2026.pdf')).toContain('「:」');
    expect(invalidReason('a/b.pdf')).toContain('「/」');
    expect(invalidReason('CON.txt')).toContain('保留名');
    expect(invalidReason('报告.')).toContain('句点');
    expect(invalidReason('门店照片-001.jpg')).toBeNull();
  });
  it('补扩展名', () => {
    expect(withExt('a.jpg', '新名', true)).toBe('新名.jpg');
    expect(withExt('a.jpg', '新名.png', true)).toBe('新名.png');
    expect(withExt('a.jpg', '版本1.2', true)).toBe('版本1.2.jpg');
    expect(withExt('a.jpg', '新名', false)).toBe('新名');
  });
});

describe('改名计划', () => {
  const files = ['IMG_001.jpg', 'IMG_002.jpg', 'IMG_003.jpg', '已有.jpg', '说明.txt'];
  it('标出各种问题，只有通过检查的行可改', () => {
    const plan = planFromMapping(files, [
      { from: 'IMG_001.jpg', to: '光谷店-门头', line: 2 },
      { from: 'IMG_002', to: '已有', line: 3 },
      { from: 'IMG_003.jpg', to: '汉街店?', line: 4 },
      { from: 'IMG_009.jpg', to: 'x', line: 5 },
      { from: '说明.txt', to: '说明.txt', line: 6 },
      { from: 'IMG_001.jpg', to: 'y', line: 7 },
    ], { keepExt: true });
    expect(plan.map((r) => r.status)).toEqual(['ok', 'exists', 'illegal', 'missing', 'same', 'dupSource']);
    expect(plan[0].to).toBe('光谷店-门头.jpg');
    expect(plan[1].from).toBe('IMG_002.jpg');
  });
  it('两个文件改成同一个名字时都不改', () => {
    const plan = planFromMapping(files, [{ from: 'IMG_001.jpg', to: 'A', line: 1 }, { from: 'IMG_002.jpg', to: 'a.JPG', line: 2 }], { keepExt: true });
    expect(countBy(plan).dup).toBe(2);
  });
  it('目标名被另一个也要改走的文件占着时允许（互换名字）', () => {
    const plan = planFromMapping(files, [{ from: 'IMG_001.jpg', to: 'IMG_002.jpg', line: 1 }, { from: 'IMG_002.jpg', to: 'IMG_001.jpg', line: 2 }], { keepExt: true });
    expect(plan.every((r) => r.status === 'ok')).toBe(true);
  });
  it('挡住的文件不改走时，占它名字的行也被挡住', () => {
    const plan = planFromMapping(files, [{ from: 'IMG_001.jpg', to: 'IMG_002.jpg', line: 1 }, { from: 'IMG_002.jpg', to: '已有.jpg', line: 2 }], { keepExt: true });
    expect(plan.map((r) => r.status)).toEqual(['exists', 'exists']);
  });
  it('序号规则：自然排序、补零、只改指定类型', () => {
    const plan = planFromRule(['图10.png', '图2.png', '图1.png', '说明.txt'], { template: '主图-{序号}', start: 1, digits: 3, only: 'png' });
    expect(plan.map((r) => `${r.from}→${r.to}`)).toEqual(['图1.png→主图-001.png', '图2.png→主图-002.png', '图10.png→主图-003.png']);
    expect(planFromRule(['a.jpg'], { template: '{原名}-{序号}', start: 7, digits: 1, only: '' })[0].to).toBe('a-7.jpg');
    expect(() => planFromRule(['a.jpg', 'b.jpg'], { template: '固定名', start: 1, digits: 1, only: '' })).toThrow('{序号}');
  });
});

describe('执行与撤销', () => {
  it('改名、写撤销记录、一键还原', async () => {
    const { files, ops } = memFs('/照片', ['IMG_001.jpg', 'IMG_002.jpg', '已有.jpg']);
    const plan = planFromMapping([...files.keys()], [{ from: 'IMG_001.jpg', to: '门头', line: 1 }, { from: 'IMG_002.jpg', to: '已有', line: 2 }], { keepExt: true });
    const r = await execute('/照片', plan, ops, new Date(2026, 9, 23, 9, 5, 7));
    expect(r.done).toEqual([{ from: 'IMG_001.jpg', to: '门头.jpg' }]);
    expect(r.recordPath).toBe('/照片/改名撤销记录-20261023-090507.json');
    expect(files.get('门头.jpg')).toBe('内容:IMG_001.jpg');
    expect(files.get('已有.jpg')).toBe('内容:已有.jpg');

    const latest = await latestRecord('/照片', ops);
    expect(latest?.record.items).toHaveLength(1);
    const u = await undo(latest!.path, ops);
    expect(u.done).toEqual([{ from: '门头.jpg', to: 'IMG_001.jpg' }]);
    expect(files.get('IMG_001.jpg')).toBe('内容:IMG_001.jpg');
    expect(await latestRecord('/照片', ops)).toBeNull();
    await expect(undo(latest!.path, ops)).rejects.toThrow('撤销过');
  });
  it('互换名字、链式改名、只改大小写都能完成且不丢文件', async () => {
    const { files, ops } = memFs('/d', ['a.txt', 'b.txt', 'c.txt', 'x.txt']);
    const plan = planFromMapping([...files.keys()], [
      { from: 'a.txt', to: 'b.txt', line: 1 }, { from: 'b.txt', to: 'a.txt', line: 2 },
      { from: 'c.txt', to: 'd.txt', line: 3 }, { from: 'x.txt', to: 'X.txt', line: 4 },
    ], { keepExt: true });
    const r = await execute('/d', plan, ops);
    expect(r.failed).toEqual([]);
    expect(files.get('a.txt')).toBe('内容:b.txt');
    expect(files.get('b.txt')).toBe('内容:a.txt');
    expect(files.get('d.txt')).toBe('内容:c.txt');
    expect(files.get('X.txt')).toBe('内容:x.txt');
    expect([...files.keys()].filter((k) => k.endsWith('.tmp'))).toEqual([]);
    await undo(r.recordPath!, ops);
    for (const n of ['a', 'b', 'c', 'x']) expect(files.get(`${n}.txt`)).toBe(`内容:${n}.txt`);
  });
  it('执行时目标名突然被占用（计划后有人放进了同名文件）不覆盖', async () => {
    const { files, ops } = memFs('/d', ['a.txt']);
    const plan = planFromMapping(['a.txt'], [{ from: 'a.txt', to: 'b', line: 1 }], { keepExt: true });
    files.set('b.txt', '别人的文件');
    const r = await execute('/d', plan, ops);
    expect(r.failed[0].reason).toContain('未覆盖');
    expect(files.get('b.txt')).toBe('别人的文件');
    expect(r.recordPath).toBeNull();
  });
  it('撤销时改名后的文件已被删掉就跳过那一项', async () => {
    const { files, ops } = memFs('/d', ['a.txt', 'b.txt']);
    const plan = planFromMapping(['a.txt', 'b.txt'], [{ from: 'a.txt', to: 'A1', line: 1 }, { from: 'b.txt', to: 'B1', line: 2 }], { keepExt: true });
    const r = await execute('/d', plan, ops);
    files.delete('A1.txt');
    const u = await undo(r.recordPath!, ops);
    expect(u.done).toHaveLength(1);
    expect(u.failed[0].reason).toContain('已经不在');
  });
});
