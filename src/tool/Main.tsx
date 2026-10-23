// 主界面：① 选文件夹 ② 导入映射表或填序号规则 ③ 预览改名前后对照与问题 ④ 执行改名 / 撤销。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FolderOpen, FileSpreadsheet, Play, Undo2, Download, RefreshCw, X } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';
import { dirname } from '@tauri-apps/api/path';
import type { RunContext } from '../kit/types';
import { FieldControl, useDroppedFiles } from '../kit/parts';
import { pickFiles, pickFolder, reveal } from '../kit/platform';
import {
  STATUS_LABEL, countBy, execute, isRecordFile, latestRecord, naturalCompare, parseMapping, planFromMapping, planFromRule, undo,
  type MapEntry, type PlanRow, type UndoRecord,
} from './core';
import { readGrid, writeGrid } from './xlsx';
import { tauriFs } from './io';
import { SAMPLE } from './samples';
import './tool.css';

type Ctx = Pick<RunContext, 'readFile' | 'writeFile' | 'join'>;
type Filter = 'all' | 'ok' | 'bad' | 'same';
type Mapping = { name: string; entries: MapEntry[]; skipped: number[]; columns: string };
type Toast = { kind: 'ok' | 'err'; text: string; path?: string } | null;

const TABLE_EXT = ['xlsx', 'csv'];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function BatchRename({ ctx }: { ctx: Ctx }) {
  const [sample, setSample] = useState(true);
  const [folder, setFolder] = useState(SAMPLE.folder);
  const [files, setFiles] = useState<string[]>(SAMPLE.files);
  const [mode, setMode] = useState<'table' | 'rule'>('table');
  const [mapping, setMapping] = useState<Mapping | null>(SAMPLE.mapping);
  const [keepExt, setKeepExt] = useState(true);
  const [rule, setRule] = useState({ template: '门店巡检-{序号}', start: 1, digits: 3, only: '' });
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [record, setRecord] = useState<{ path: string; record: UndoRecord } | null>(null);

  const loadFolder = useCallback(async (dir: string) => {
    try {
      const list = (await tauriFs.list(dir)).filter((n) => !isRecordFile(n)).sort(naturalCompare);
      setSample(false);
      setFolder(dir);
      setFiles(list);
      setRecord(await latestRecord(dir, tauriFs));
      return list;
    } catch (e) {
      setToast({ kind: 'err', text: `读取文件夹失败：${errText(e)}` });
      return null;
    }
  }, []);

  const importTable = useCallback(async (path: string) => {
    try {
      const m = parseMapping(await readGrid(await ctx.readFile(path), path));
      setMapping({ name: fileName(path), ...m });
      setMode('table');
      if (sample) {
        // 还在示例状态时先清掉示例文件夹，提示去选真实文件夹
        setSample(false);
        setFolder('');
        setFiles([]);
      }
      setToast(m.skipped.length ? { kind: 'err', text: `第 ${m.skipped.slice(0, 8).join('、')} 行只填了一边，已跳过` } : null);
    } catch (e) {
      setToast({ kind: 'err', text: `导入映射表失败：${errText(e)}` });
    }
  }, [ctx, sample]);

  const hover = useDroppedFiles(async (paths) => {
    for (const p of paths) {
      if (new RegExp(`\\.(${TABLE_EXT.join('|')})$`, 'i').test(p)) await importTable(p);
      else {
        const info = await stat(p).catch(() => null);
        if (info) await loadFolder(info.isDirectory ? p : await dirname(p));
      }
    }
  });

  useEffect(() => {
    if (!toast || toast.kind === 'err' || toast.path) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const { plan, planError } = useMemo((): { plan: PlanRow[]; planError: string | null } => {
    try {
      if (mode === 'rule') return { plan: files.length ? planFromRule(files, rule) : [], planError: null };
      return { plan: mapping && files.length ? planFromMapping(files, mapping.entries, { keepExt }) : [], planError: null };
    } catch (e) {
      return { plan: [], planError: errText(e) };
    }
  }, [mode, files, rule, mapping, keepExt]);

  const c = countBy(plan);
  const bad = plan.length - c.ok - c.same;
  const shown = plan.filter((r) => filter === 'all' || (filter === 'ok' ? r.status === 'ok' : filter === 'same' ? r.status === 'same' : r.status !== 'ok' && r.status !== 'same'));

  const run = async () => {
    if (sample) return setToast({ kind: 'err', text: '现在显示的是示例，先选择你的文件夹' });
    setBusy('正在改名…');
    try {
      const r = await execute(folder, plan, tauriFs);
      await loadFolder(folder);
      setToast(r.failed.length
        ? { kind: 'err', text: `改好 ${r.done.length} 个，${r.failed.length} 个没改：${r.failed.slice(0, 3).map((f) => `${f.from}（${f.reason}）`).join('；')}`, path: r.recordPath ?? undefined }
        : { kind: 'ok', text: `已改名 ${r.done.length} 个文件，撤销记录已保存在文件夹里`, path: r.recordPath ?? undefined });
    } catch (e) {
      setToast({ kind: 'err', text: `改名中断：${errText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const doUndo = async (path: string) => {
    setBusy('正在还原…');
    try {
      const r = await undo(path, tauriFs);
      const rec = JSON.parse(await ctx.readFile(path).then((b) => new TextDecoder().decode(b))) as UndoRecord;
      if (rec.folder) await loadFolder(rec.folder);
      setToast(r.failed.length
        ? { kind: 'err', text: `还原 ${r.done.length} 个，${r.failed.length} 个没还原：${r.failed.slice(0, 3).map((f) => `${f.from}（${f.reason}）`).join('；')}` }
        : { kind: 'ok', text: `已还原 ${r.done.length} 个文件的原名` });
    } catch (e) {
      setToast({ kind: 'err', text: `撤销失败：${errText(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const openRecord = async () => {
    const [p] = await pickFiles(['json'], '撤销记录');
    if (p) await doUndo(p);
  };

  const exportTemplate = async () => {
    const path = await save({ defaultPath: '改名对照表.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (!path) return;
    try {
      await ctx.writeFile(path, await writeGrid([['原文件名', '新文件名'], ...files.map((f) => [f, ''])]));
      setToast({ kind: 'ok', text: `已导出 ${files.length} 个文件名，在「新文件名」列填好后导入`, path });
    } catch (e) {
      setToast({ kind: 'err', text: `导出失败：${errText(e)}` });
    }
  };

  return (
    <div className={`br${hover ? ' hover' : ''}`}>
      {sample && <div className="br-tip"><span>下面是示例数据，演示改名前后对照。选择你的文件夹并导入映射表后开始，也可以把文件夹和表格直接拖进窗口。</span></div>}

      <section className="br-steps">
        <div className="br-step k-card">
          <span className="br-no">1</span>
          <div className="br-step-main">
            <b>要改名的文件夹</b>
            <span className="k-muted br-path" title={folder}>{folder ? `${folder} · ${files.length} 个文件` : '还没选'}</span>
          </div>
          <div className="br-step-ops">
            {folder && !sample && <button className="k-icon-btn" title="重新读取" aria-label="重新读取" onClick={() => loadFolder(folder)}><RefreshCw size={15} /></button>}
            <button className="k-btn" onClick={async () => { const p = await pickFolder(); if (p) await loadFolder(p); }}><FolderOpen size={15} />选择文件夹</button>
          </div>
        </div>

        <div className="br-step k-card">
          <span className="br-no">2</span>
          <div className="br-step-main">
            <FieldControl field={{ key: 'mode', label: '新名字从哪来', type: 'segment', options: [['table', '按映射表'], ['rule', '按序号规则']], default: 'table' }} value={mode} onChange={(v) => setMode(v as 'table' | 'rule')} />
            {mode === 'table' ? (
              <div className="br-src">
                <span className="k-muted">{mapping ? `${mapping.name} · ${mapping.entries.length} 行 · ${mapping.columns}` : '表格两列：原文件名、新文件名（.xlsx 或 .csv）'}</span>
                <label className="br-check"><input type="checkbox" checked={keepExt} onChange={(e) => setKeepExt(e.target.checked)} />新名字没写扩展名时沿用原扩展名</label>
              </div>
            ) : (
              <div className="br-rule">
                <FieldControl field={{ key: 'template', label: '名字模板', type: 'text', default: '', placeholder: '例如 主图-{序号}' }} value={rule.template} onChange={(v) => setRule({ ...rule, template: String(v) })} />
                <FieldControl field={{ key: 'start', label: '起始序号', type: 'number', default: 1, min: 0 }} value={rule.start} onChange={(v) => setRule({ ...rule, start: Number(v) })} />
                <FieldControl field={{ key: 'digits', label: '序号位数', type: 'number', default: 3, min: 1, max: 8, help: '3 → 001' }} value={rule.digits} onChange={(v) => setRule({ ...rule, digits: Number(v) })} />
                <FieldControl field={{ key: 'only', label: '只改这些类型', type: 'text', default: '', placeholder: '留空为全部，例如 jpg,png' }} value={rule.only} onChange={(v) => setRule({ ...rule, only: String(v) })} />
                <span className="k-help br-rule-help">{'{序号}'} 换成编号，{'{原名}'} 换成原文件名；按文件名自然顺序编号（图2 在 图10 前），扩展名保持不变。</span>
              </div>
            )}
          </div>
          {mode === 'table' && (
            <div className="br-step-ops">
              <button className="k-btn ghost" disabled={!files.length || sample} title="把文件夹里的文件名导出成表格，填好新名字再导入" onClick={exportTemplate}><Download size={15} />导出文件清单</button>
              <button className="k-btn" onClick={async () => { const [p] = await pickFiles(TABLE_EXT, '映射表'); if (p) await importTable(p); }}><FileSpreadsheet size={15} />导入映射表</button>
            </div>
          )}
        </div>
      </section>

      {toast && (
        <div className={`br-toast ${toast.kind}`} role="status">
          <span>{toast.text}</span>
          {toast.path && <button className="k-btn ghost" onClick={() => reveal(toast.path!)}>在文件夹中显示</button>}
          <button className="k-icon-btn" aria-label="关闭" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      <section className="br-preview k-card">
        <div className="br-preview-hd">
          <b>改名预览</b>
          <div className="br-filters">
            {([['all', `全部 ${plan.length}`], ['ok', `可改名 ${c.ok}`], ['bad', `有问题 ${bad}`], ['same', `名字没变 ${c.same}`]] as [Filter, string][]).map(([f, l]) => (
              <button key={f} className={`k-chip${filter === f ? ' on' : ''}${f === 'bad' && bad ? ' br-bad' : ''}`} onClick={() => setFilter(f)}>{l}</button>
            ))}
          </div>
        </div>
        {planError ? <div className="br-empty br-err">{planError}</div> : !plan.length ? (
          <div className="br-empty k-muted">{!folder ? '先选择要改名的文件夹' : !files.length ? '这个文件夹里没有文件' : mode === 'table' ? '导入映射表后在这里预览' : '没有符合类型的文件'}</div>
        ) : (
          <div className="k-table-wrap br-table-wrap">
            <table className="k-table br-table">
              <thead><tr><th className="br-num">行</th><th>原文件名</th><th aria-label="改为" /><th>新文件名</th><th>检查</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={`st-${r.status}`}>
                    <td className="br-num k-muted">{r.line}</td>
                    <td className="k-cell br-name" title={r.from}>{r.from}</td>
                    <td className="br-arrow"><ArrowRight size={13} /></td>
                    <td className="k-cell br-name br-to" title={r.to}>{r.to}</td>
                    <td className="br-state"><span className={`br-badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>{r.reason && r.status !== 'same' && <span className="k-muted br-reason" title={r.reason}>{r.reason}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="br-foot">
        <span className="k-muted br-foot-info">
          {record ? `上次改名：${record.record.at.slice(0, 16).replace('T', ' ')}，${record.record.items.length} 个` : '改名后会在文件夹里留一份撤销记录，可一键还原'}
        </span>
        <button className="k-btn ghost" onClick={openRecord} disabled={!!busy}>打开撤销记录…</button>
        <button className="k-btn" disabled={!record || !!busy} onClick={() => record && doUndo(record.path)}><Undo2 size={15} />撤销上次改名</button>
        <button className="k-btn primary big" disabled={!c.ok || !!busy} onClick={run}><Play size={15} />{busy ?? `执行改名（${c.ok} 个）`}</button>
      </footer>
    </div>
  );
}
