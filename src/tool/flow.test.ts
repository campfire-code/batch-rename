// 流程测试：读真实格式的映射表（xlsx / GBK CSV）→ 生成计划 → 在内存文件夹里执行 → 撤销
import { describe, expect, it } from 'vitest';
import { countBy, execute, parseMapping, planFromMapping, undo } from './core';
import { readGrid, writeGrid } from './xlsx';
import { SAMPLE_FILES, SAMPLE_ROWS } from './fixtures';
import { memFs } from './core.test';

describe('示例映射表全流程', () => {
  it('xlsx：4 种情况各自处理，改完能还原', async () => {
    const grid = await readGrid(await writeGrid([['原文件名', '新文件名', '备注'], ...SAMPLE_ROWS]), '改名对照表.xlsx');
    const { entries } = parseMapping(grid);
    const { files, ops } = memFs('/巡检照片', SAMPLE_FILES);
    const plan = planFromMapping([...files.keys()], entries, { keepExt: true });
    expect(plan.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'exists', 'illegal', 'missing']);
    expect(countBy(plan).ok).toBe(3);
    const r = await execute('/巡检照片', plan, ops);
    expect(r.done.map((d) => d.to)).toEqual(['光谷店-门头.png', '光谷店-货架A区.png', '汉街店-门头.png']);
    expect([...files.keys()].sort()).toContain('IMG_2044.png');
    await undo(r.recordPath!, ops);
    expect([...files.keys()].filter((k) => !k.startsWith('改名撤销记录')).sort()).toEqual([...SAMPLE_FILES].sort());
  });
  it('GBK 编码的 CSV 映射表', async () => {
    // 用 GBK 编出「原文件名,新文件名\na.png,甲」：浏览器和 Node 都没有 GBK 编码器，这里直接写字节
    const gbk = new Uint8Array([0xd4, 0xad, 0xce, 0xc4, 0xbc, 0xfe, 0xc3, 0xfb, 0x2c, 0xd0, 0xc2, 0xce, 0xc4, 0xbc, 0xfe, 0xc3, 0xfb, 0x0a, 0x61, 0x2e, 0x70, 0x6e, 0x67, 0x2c, 0xbc, 0xd7]);
    const { entries, columns } = parseMapping(await readGrid(gbk, 'x.csv'));
    expect(columns).toContain('原文件名');
    expect(entries).toEqual([{ from: 'a.png', to: '甲', line: 2 }]);
  });
});
