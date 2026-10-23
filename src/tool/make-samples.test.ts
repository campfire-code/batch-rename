// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）
import { it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeGrid } from './xlsx';
import { SAMPLE_FILES, SAMPLE_ROWS } from './fixtures';

// 1×1 像素的 PNG，只是让示例文件能被看图软件打开
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', async () => {
  rmSync('samples', { recursive: true, force: true });
  mkdirSync('samples/巡检照片', { recursive: true });
  for (const f of SAMPLE_FILES) writeFileSync(`samples/巡检照片/${f}`, f.endsWith('.png') ? PNG : '示例文件\n');
  writeFileSync('samples/改名对照表.xlsx', await writeGrid([['原文件名', '新文件名', '备注'], ...SAMPLE_ROWS]));
  writeFileSync('samples/改名对照表.csv', '﻿原文件名,新文件名\r\n' + SAMPLE_ROWS.map((r) => `${r[0]},${r[1]}`).join('\r\n') + '\r\n');
});
