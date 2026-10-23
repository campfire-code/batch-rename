// 工具声明：按表格批量改文件名（自定义界面：选文件夹 → 映射表 / 序号规则 → 预览检查 → 执行 / 撤销）
import { FilePen as FilePenIcon } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { BatchRename } from './Main';

const tool: CustomTool = {
  id: 'o12',
  name: '按表格批量改文件名',
  tagline: '按 Excel 映射表或序号规则批量改文件名：先预览对照、检查冲突和非法字符，不覆盖已有文件，改完留撤销记录可一键还原。',
  icon: FilePenIcon,
  category: '办公提效',
  type: 'data',
  mode: 'custom',
  mainLabel: '批量改名',
  params: [],
  Main: ({ ctx }) => createElement(BatchRename, { ctx }),
};

export default tool;
