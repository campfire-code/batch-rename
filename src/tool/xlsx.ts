// 读映射表：xlsx 用 exceljs（MIT），CSV 自己解析。写法沿用「Excel 拆分与合并」工具。
import ExcelJS from 'exceljs';
import type { Cell } from './core';

/** 文本解码：优先 UTF-8（去掉 BOM），不是合法 UTF-8 时按 GBK 解（Excel 中文版导出的 CSV 常见） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('gbk').decode(bytes);
  }
}

/** 解析 CSV：支持引号、引号内换行与逗号、两个引号转义，自动识别逗号 / 制表符 / 分号分隔 */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const sep = [',', '\t', ';'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** 读第一个可见工作表（CSV 直接解析），返回二维数组 */
export async function readGrid(bytes: Uint8Array, fileName: string): Promise<Cell[][]> {
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(decodeText(bytes));
  if (/\.xls$/i.test(fileName)) throw new Error('旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再导入');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new Error('表格文件打不开，可能已损坏或不是 .xlsx');
  }
  const ws = wb.worksheets.find((s) => s.state === 'visible');
  if (!ws) throw new Error('表格里没有可见的工作表');
  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    grid[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}

/** 生成映射表模板（示例文件与「下载模板」用） */
export async function writeGrid(rows: Cell[][], sheet = '改名对照'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '篝火 · 按表格批量改文件名';
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    if (i === 0) row.font = { bold: true };
  });
  ws.columns.forEach((c) => (c.width = 30));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
