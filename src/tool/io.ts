// 本机文件操作：通过 Tauri 文件插件实现 FileOps（列目录、判断存在、改名、读写撤销记录）。
import { exists, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { FileOps } from './core';

export const tauriFs: FileOps = {
  /** 只列文件夹第一层的文件，跳过子文件夹和以 . 开头的隐藏文件 */
  list: async (dir) => (await readDir(dir)).filter((e) => e.isFile && !e.name.startsWith('.')).map((e) => e.name),
  exists: (p) => exists(p),
  rename: (a, b) => rename(a, b),
  readText: (p) => readTextFile(p),
  writeText: (p, t) => writeTextFile(p, t),
  join: (...p) => join(...p),
};
