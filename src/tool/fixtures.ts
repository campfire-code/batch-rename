// samples/ 示例与流程测试共用的数据（内容均为虚构）
export const SAMPLE_FILES = ['IMG_2041.png', 'IMG_2042.png', 'IMG_2043.png', 'IMG_2044.png', 'IMG_2045.png', 'IMG_2046.png', '光谷店-收银台.png', '巡检说明.txt'];

/** 原文件名、新文件名、备注 */
export const SAMPLE_ROWS: [string, string, string][] = [
  ['IMG_2041.png', '光谷店-门头', '没写扩展名，自动沿用 .png'],
  ['IMG_2042.png', '光谷店-货架A区.png', ''],
  ['IMG_2043', '汉街店-门头', '原文件名没写扩展名也能对上'],
  ['IMG_2044.png', '光谷店-收银台', '文件夹里已有同名文件：不改'],
  ['IMG_2045.png', '汉街店-价签1/2', '含非法字符 /：不改'],
  ['IMG_2049.png', '五一店-门头', '文件夹里没有：跳过'],
];
