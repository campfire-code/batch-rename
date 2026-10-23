// 打开时显示的示例状态（也用于截图）：一个虚构的门店巡检照片文件夹和对应的映射表
import type { MapEntry } from './core';

const files = ['IMG_2041.jpg', 'IMG_2042.jpg', 'IMG_2043.jpg', 'IMG_2044.jpg', 'IMG_2045.jpg', 'IMG_2046.jpg', 'IMG_2047.jpg', 'IMG_2048.jpg', 'IMG_2049.jpg', '巡检说明.docx', '光谷店-收银台.jpg'];
const pairs: [string, string][] = [
  ['IMG_2041.jpg', '光谷店-门头'],
  ['IMG_2042.jpg', '光谷店-货架A区'],
  ['IMG_2043.jpg', '光谷店-货架B区'],
  ['IMG_2044.jpg', '光谷店-收银台'],
  ['IMG_2045.jpg', '汉街店-门头'],
  ['IMG_2046.jpg', '汉街店-促销堆头'],
  ['IMG_2047', '汉街店-仓库'],
  ['IMG_2048.jpg', '汉街店-价签1/2'],
  ['IMG_2050.jpg', '五一店-门头'],
  ['巡检说明.docx', '巡检说明'],
];

export const SAMPLE = {
  folder: '/Users/demo/Pictures/门店巡检照片（示例）',
  files,
  mapping: {
    name: '巡检照片改名对照（示例）.xlsx',
    entries: pairs.map(([from, to], i): MapEntry => ({ from, to, line: i + 2 })),
    skipped: [] as number[],
    columns: '「原文件名」→「新文件名」',
  },
};
