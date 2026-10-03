import { useState, useRef, useCallback, useEffect } from 'react';
import { usePptStore, selectCurrentSlide } from '../store/pptStore';
import { useTheme } from '../hooks/useTheme';
import { LAYOUT_LABELS } from '../store/ppt-layouts';
import type { GenerateOptions, Slide, Block } from '../types/ppt';

const PPT_THEMES = [
  { id: 'aurora', name: '极光蓝', accent: '#2563eb', accent2: '#06b6d4' },
  { id: 'ink', name: '墨韵黑金', accent: '#e0a451', accent2: '#b45309' },
  { id: 'mint', name: '清水薄荷', accent: '#0d9488', accent2: '#22d3ee' },
  { id: 'sunset', name: '暮色霞光', accent: '#e2503a', accent2: '#f59e0b' },
  { id: 'graphite', name: '石墨商务', accent: '#1f6feb', accent2: '#6366f1' },
  { id: 'sakura', name: '樱粉轻氧', accent: '#e0447c', accent2: '#a855f7' },
];

interface Props {
  onBack: () => void;
}

export default function PPTView({ onBack }: Props) {
  const { c } = useTheme();
  const deck = usePptStore((s) => s.deck);
  const [exporting, setExporting] = useState(false);

  const handleExportPptx = async () => {
    if (exporting || deck.slides.length === 0) return;
    setExporting(true);
    try {
      const { exportDeckToPptx } = await import('../store/ppt-export');
      await exportDeckToPptx(deck, { colors: { accent: theme.accent, accent2: theme.accent2 } });
      notify('已导出 PPTX', 'success');
    } catch (e: any) {
      notify(`导出失败：${e.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };
  const slide = usePptStore(selectCurrentSlide);
  const selectedSlideId = usePptStore((s) => s.selectedSlideId);
  const selectedBlockId = usePptStore((s) => s.selectedBlockId);
  const editingBlockId = usePptStore((s) => s.editingBlockId);
  const generating = usePptStore((s) => s.generating);
  const genStage = usePptStore((s) => s.genStage);
  const notice = usePptStore((s) => s.notice);

  const selectSlide = usePptStore((s) => s.selectSlide);
  const selectBlock = usePptStore((s) => s.selectBlock);
  const setEditing = usePptStore((s) => s.setEditing);
  const undo = usePptStore((s) => s.undo);
  const redo = usePptStore((s) => s.redo);
  const generate = usePptStore((s) => s.generate);
  const addSlide = usePptStore((s) => s.addSlide);
  const duplicateSlide = usePptStore((s) => s.duplicateSlide);
  const deleteSlide = usePptStore((s) => s.deleteSlide);
  const setTheme = usePptStore((s) => s.setTheme);
  const setDeckTitle = usePptStore((s) => s.setDeckTitle);
  const updateBlock = usePptStore((s) => s.updateBlock);
  const updateBlockBox = usePptStore((s) => s.updateBlockBox);
  const updateBlockBoxLive = usePptStore((s) => s.updateBlockBoxLive);
  const pushHistory = usePptStore((s) => s.pushHistory);
  const deleteBlock = usePptStore((s) => s.deleteBlock);
  const notify = usePptStore((s) => s.notify);
  const clearNotice = usePptStore((s) => s.clearNotice);

  const [showGenerate, setShowGenerate] = useState(false);
  const [topic, setTopic] = useState('');
  const [depth, setDepth] = useState<GenerateOptions['depth']>('standard');
  const [tone, setTone] = useState<GenerateOptions['tone']>('professional');
  const [withNotes, setWithNotes] = useState(false);
  const [dragging, setDragging] = useState<{ blockId: string; startX: number; startY: number; boxX: number; boxY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const getScale = useCallback(() => {
    return (canvasRef.current?.clientWidth || 960) / 1280;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(clearNotice, 2800);
    return () => window.clearTimeout(t);
  }, [notice, clearNotice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (typing || !slide) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlockId) {
        e.preventDefault();
        deleteBlock(slide.id, selectedBlockId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slide, selectedBlockId, undo, redo, deleteBlock]);

  const handleGenerate = async () => {
    if (!topic.trim()) { notify('请输入主题', 'error'); return; }
    await generate({ topic, depth, tone, language: 'zh', withNotes });
    setShowGenerate(false);
    setTopic('');
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${deck.title}.json`; a.click();
    URL.revokeObjectURL(url);
    notify('已导出 JSON', 'success');
  };

  const handleExportHtml = () => {    const slidesHtml = deck.slides.map((s, i) => renderSlideToHtml(s, theme.accent, i)).join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${deck.title}</title>
<style>body{margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif}
.slide{width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden;background:linear-gradient(135deg,#0f172a,${theme.accent}22)}
.slide-title{font-size:clamp(2rem,5vw,4rem);font-weight:700;text-align:center;padding:0 5vw}
.slide-subtitle{font-size:clamp(1rem,2.5vw,1.5rem);opacity:.7;margin-top:1rem;text-align:center}
.slide-content{font-size:clamp(.9rem,2vw,1.2rem);max-width:80vw;margin-top:2rem;line-height:1.8}
.slide-content li{margin:.5rem 0}
.slide-num{position:absolute;bottom:1rem;right:1rem;opacity:.3;font-size:.8rem}
blockquote{font-size:1.5rem;font-style:italic;max-width:70vw;text-align:center}
.stats{display:flex;gap:3rem;justify-content:center;margin-top:2rem}
.stat{text-align:center}.stat-value{font-size:2.5rem;font-weight:700}
.stat-label{font-size:.9rem;opacity:.7;margin-top:.5rem}</style></head><body>\n${slidesHtml}\n</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${deck.title}.html`; a.click();
    URL.revokeObjectURL(url);
    notify('已导出 HTML', 'success');
  };

  const onBlockMouseDown = (e: React.MouseEvent, block: Block) => {
    e.stopPropagation();
    selectBlock(block.id);
    setEditing(null);
    setDragging({ blockId: block.id, startX: e.clientX, startY: e.clientY, boxX: block.box.x, boxY: block.box.y });
    pushHistory();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !slide) return;
    const scale = getScale();
    const dx = (e.clientX - dragging.startX) / scale;
    const dy = (e.clientY - dragging.startY) / scale;
    updateBlockBoxLive(slide.id, dragging.blockId, { x: Math.round(dragging.boxX + dx), y: Math.round(dragging.boxY + dy) });
  };

  const onMouseUp = () => { setDragging(null); };

  const handleTextEdit = (blockId: string, text: string) => {
    if (slide) updateBlock(slide.id, blockId, { text } as any);
  };

  const theme = PPT_THEMES.find((t) => t.id === deck.themeId) || PPT_THEMES[0];

  return (
    <div className="flex-1 flex h-screen overflow-hidden" style={{ background: c.bg }}>
      {/* Left Panel - Slide List */}
      <div className="w-52 shrink-0 flex flex-col border-r overflow-hidden glass" style={{ borderColor: c.border }}>
        <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: c.borderLight }}>
          <button onClick={onBack} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-black/5" style={{ color: c.textSecondary }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            返回
          </button>
          <span className="text-xs font-semibold" style={{ color: c.text }}>幻灯片</span>
        </div>
        <div className="flex items-center gap-1 p-2 border-b" style={{ borderColor: c.borderLight }}>
          <button onClick={() => addSlide()} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:bg-black/5" style={{ color: c.accent }}>+ 新增</button>
          <button onClick={() => slide && duplicateSlide(slide.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:bg-black/5" style={{ color: c.textTertiary }}>复制</button>
          {deck.slides.length > 1 && (
            <button onClick={() => slide && deleteSlide(slide.id)} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:bg-black/5" style={{ color: c.toolErr }}>删除</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
          {deck.slides.map((s, i) => (
            <div key={s.id} onClick={() => selectSlide(s.id)}
              className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${selectedSlideId === s.id ? 'border-blue-500 shadow-md' : 'border-transparent hover:border-gray-300'}`}
            >
              <div className="aspect-video relative" style={{ background: `linear-gradient(135deg, ${theme.accent}33, #0f172a)` }}>
                <div className="absolute inset-0 flex items-center justify-center"><span className="text-white text-[10px] font-bold truncate px-1">{s.name}</span></div>
                <span className="absolute bottom-0.5 right-1 text-[9px] text-white/50">{i + 1}</span>
              </div>
              <div className="px-1 py-0.5 text-[9px] truncate" style={{ color: c.textTertiary, background: c.bg }}>{s.name}</div>
            </div>
          ))}
        </div>
        <div className="p-2 border-t space-y-1.5" style={{ borderColor: c.borderLight }}>
          <div className="text-[10px] font-medium px-1" style={{ color: c.textTertiary }}>主题</div>
          <div className="grid grid-cols-3 gap-1">
            {PPT_THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)}
                className={`text-[9px] py-1 rounded transition-all ${deck.themeId === t.id ? 'ring-1 ring-offset-1' : ''}`}
                style={{ background: t.accent + '22', color: t.accent }}>
                {t.name.slice(0, 2)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Center - Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 flex items-center justify-between px-4 border-b shrink-0 glass" style={{ borderColor: c.border }}>
          <input className="text-sm font-medium bg-transparent border-none outline-none flex-1" style={{ color: c.text }} value={deck.title} onChange={(e) => setDeckTitle(e.target.value)} placeholder="演示文稿标题" />
          <div className="flex items-center gap-2">
            <button onClick={() => setShowGenerate(true)} className="px-4 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: theme.accent }}>
              AI 生成
            </button>
            <button onClick={handleExportPptx} disabled={exporting} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: c.accent }}>{exporting ? '导出中…' : 'PPTX'}</button>
            <button onClick={handleExportHtml} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: c.accentBg, color: c.accent }}>HTML</button>
            <button onClick={handleExportJson} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: c.buttonGhost, color: c.textSecondary }}>JSON</button>
            <div className="w-px h-4 mx-1" style={{ background: c.border }} />
            <button onClick={undo} className="w-7 h-7 rounded flex items-center justify-center" style={{ color: c.textTertiary }} title="撤销">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg>
            </button>
            <button onClick={redo} className="w-7 h-7 rounded flex items-center justify-center" style={{ color: c.textTertiary }} title="重做">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6-6m6 6l-6 6" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center overflow-hidden p-8" style={{ background: `linear-gradient(135deg, ${c.bg} 0%, ${theme.accent}08 100%)` }}>
          {slide && (
            <div ref={canvasRef} className="relative shadow-lg rounded-xl overflow-hidden"
              style={{ width: '100%', maxWidth: 960, aspectRatio: '16/9', background: `linear-gradient(135deg, #0f172a, ${theme.accent}44` }}
              onClick={() => selectBlock(null)} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
              {slide.blocks.map((block) => (
                <PPTBlock key={block.id} block={block} scale={getScale()} isSelected={selectedBlockId === block.id}
                  isEditing={editingBlockId === block.id} accent={theme.accent}
                  onMouseDown={(e) => onBlockMouseDown(e, block)} onSelect={() => selectBlock(block.id)}
                  onEditStart={() => setEditing(block.id)} onEditEnd={(text) => { handleTextEdit(block.id, text); setEditing(null); }} />
              ))}
            </div>
          )}
        </div>

        <div className="h-8 flex items-center justify-center text-[10px] border-t shrink-0" style={{ color: c.textTertiary, borderColor: c.borderLight }}>
          {slide ? `第 ${deck.slides.findIndex((s) => s.id === slide.id) + 1} / ${deck.slides.length} 页 · ${LAYOUT_LABELS[slide.layout]}` : '无幻灯片'}
        </div>
      </div>

      {/* Right Panel - Properties */}
      {slide && selectedBlockId && (
        <div className="w-60 shrink-0 border-l overflow-y-auto p-4 space-y-4 glass" style={{ borderColor: c.border }}>
          <div className="text-xs font-semibold" style={{ color: c.text }}>属性编辑</div>
          {(() => {
            const block = slide.blocks.find((b) => b.id === selectedBlockId);
            if (!block) return null;
            return (<>
              <div className="space-y-1.5">
                <label className="text-[10px]" style={{ color: c.textTertiary }}>类型</label>
                <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: c.bgInput, color: c.text }}>{block.type === 'title' ? '标题' : block.type === 'subtitle' ? '副标题' : block.type === 'bullets' ? '列表' : block.type === 'paragraph' ? '段落' : block.type}</div>
              </div>
              {(block.type === 'title' || block.type === 'subtitle' || block.type === 'paragraph') && (
                <div className="space-y-1.5">
                  <label className="text-[10px]" style={{ color: c.textTertiary }}>字号</label>
                  <input type="range" min={12} max={80} value={block.style?.fontSize || 22}
                    onChange={(e) => updateBlock(slide.id, block.id, { style: { ...block.style, fontSize: Number(e.target.value) } })} className="w-full" />
                  <span className="text-[10px]" style={{ color: c.textTertiary }}>{block.style?.fontSize || 22}px</span>
                </div>
              )}
              {['x', 'y', 'w', 'h'].map((prop) => (
                <div key={prop} className="space-y-1.5">
                  <label className="text-[10px]" style={{ color: c.textTertiary }}>{prop === 'x' ? 'X 坐标' : prop === 'y' ? 'Y 坐标' : prop === 'w' ? '宽度' : '高度'}</label>
                  <input type="number" value={(block.box as any)[prop]}
                    onChange={(e) => updateBlockBox(slide.id, block.id, { [prop]: Number(e.target.value) })}
                    className="w-full text-xs px-2 py-1.5 rounded-lg border" style={{ background: c.bgInput, color: c.text, borderColor: c.border }} />
                </div>
              ))}
              <button onClick={() => deleteBlock(slide.id, block.id)}
                className="w-full py-2 rounded-lg text-xs font-medium" style={{ background: '#fef2f2', color: '#dc2626' }}>删除元素</button>
            </>);
          })()}
        </div>
      )}

      {/* Generate Dialog */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: c.modalOverlay }} onClick={() => setShowGenerate(false)}>
          <div className="w-[420px] rounded-xl shadow-lg p-6 space-y-4" style={{ background: c.modalBg }} onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <h3 className="text-lg font-bold" style={{ color: c.text }}>AI 生成演示文稿</h3>
              <p className="text-xs mt-1" style={{ color: c.textTertiary }}>输入主题，自动生成专业 PPT</p>
            </div>
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：2024年度工作总结"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none border" style={{ background: c.bgInput, color: c.text, borderColor: c.border }} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: c.textSecondary }}>详细程度</label>
                <select value={depth} onChange={(e) => setDepth(e.target.value as any)} className="w-full px-2 py-1.5 rounded-lg text-xs outline-none border" style={{ background: c.bgInput, color: c.text, borderColor: c.border }}>
                  <option value="brief">简洁 (5-7页)</option>
                  <option value="standard">标准 (7-10页)</option>
                  <option value="detailed">详尽 (10-15页)</option>
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: c.textSecondary }}>语气风格</label>
                <select value={tone} onChange={(e) => setTone(e.target.value as any)} className="w-full px-2 py-1.5 rounded-lg text-xs outline-none border" style={{ background: c.bgInput, color: c.text, borderColor: c.border }}>
                  <option value="professional">专业</option>
                  <option value="minimal">简约</option>
                  <option value="energetic">活力</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} className="rounded" />
              <span className="text-xs" style={{ color: c.textSecondary }}>生成演讲备注</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowGenerate(false)} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ background: c.buttonGhost, color: c.textSecondary }}>取消</button>
              <button onClick={handleGenerate} disabled={generating}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white" style={{ background: theme.accent }}>
                {generating ? genStage || '生成中...' : '开始生成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium"
          style={{ background: notice.kind === 'success' ? '#ecfdf5' : notice.kind === 'error' ? '#fef2f2' : c.bgCard, color: notice.kind === 'success' ? '#059669' : notice.kind === 'error' ? '#dc2626' : c.text, border: `1px solid ${notice.kind === 'success' ? '#a7f3d0' : notice.kind === 'error' ? '#fecaca' : c.border}` }}>
          {notice.text}
        </div>
      )}
    </div>
  );
}

function PPTBlock({ block, scale, isSelected, isEditing, accent, onMouseDown, onSelect, onEditStart, onEditEnd }: {
  block: Block; scale: number; isSelected: boolean; isEditing: boolean; accent: string;
  onMouseDown: (e: React.MouseEvent) => void; onSelect: () => void; onEditStart: () => void; onEditEnd: (text: string) => void;
}) {
  const style: React.CSSProperties = { position: 'absolute', left: block.box.x * scale, top: block.box.y * scale, width: block.box.w * scale, height: block.box.h * scale, cursor: 'move', userSelect: 'none' };
  const fontSize = (block.style?.fontSize || 22) * scale;

  if (block.type === 'title' || block.type === 'subtitle' || block.type === 'paragraph' || block.type === 'eyebrow') {
    const text = (block as any).text || '';
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`${isSelected ? 'ring-2 ring-blue-400' : ''} ${isEditing ? 'ring-2 ring-green-400' : ''}`}>
        {isEditing ? (
          <textarea autoFocus defaultValue={text} onBlur={(e) => onEditEnd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onEditEnd((e.target as HTMLTextAreaElement).value); }}
            className="w-full h-full bg-transparent outline-none resize-none p-2"
            style={{ fontSize, color: block.style?.color === 'muted' ? '#94a3b8' : block.style?.color === 'accent' ? accent : '#fff', fontWeight: block.style?.bold ? 700 : 400 }} />
        ) : (
          <div onDoubleClick={(e) => { e.stopPropagation(); onEditStart(); }} className="w-full h-full overflow-hidden p-2"
            style={{ fontSize, color: block.style?.color === 'muted' ? '#94a3b8' : block.style?.color === 'accent' ? accent : '#fff', fontWeight: block.style?.bold ? 700 : 400, lineHeight: block.style?.lineHeight || 1.4, letterSpacing: block.style?.letterSpacing || 0, textTransform: block.style?.upper ? 'uppercase' : 'none', textAlign: block.style?.align || 'left' }}>
            {text}
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'bullets') {
    const items = (block as any).items || [];
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`${isSelected ? 'ring-2 ring-blue-400' : ''}`}>
        <ul className="space-y-1 p-2" style={{ fontSize, color: '#e2e8f0' }}>
          {items.map((item: string, i: number) => (<li key={i} className="flex items-start gap-2"><span style={{ color: accent }}>•</span><span>{item}</span></li>))}
        </ul>
      </div>
    );
  }

  if (block.type === 'divider') {
    return (<div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }} className={`${isSelected ? 'ring-2 ring-blue-400' : ''}`}><div className="w-full h-full rounded" style={{ background: accent }} /></div>);
  }

  if (block.type === 'quote') {
    return (<div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }} className={`${isSelected ? 'ring-2 ring-blue-400' : ''} flex items-center justify-center p-4`}><blockquote className="text-center italic" style={{ fontSize, color: '#e2e8f0' }}>"{(block as any).text}"{(block as any).author && <div className="text-sm mt-2 opacity-70">— {(block as any).author}</div>}</blockquote></div>);
  }

  if (block.type === 'stats') {
    const items = (block as any).items || [];
    return (<div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }} className={`${isSelected ? 'ring-2 ring-blue-400' : ''} flex items-center justify-around`}>{items.map((stat: any, i: number) => (<div key={i} className="text-center"><div className="text-2xl font-bold" style={{ color: accent, fontSize: 28 * scale }}>{stat.value}</div><div className="text-xs mt-1 opacity-70" style={{ color: '#94a3b8' }}>{stat.label}</div></div>))}</div>);
  }

  if (block.type === 'steps') {
    const items = (block as any).items || [];
    return (<div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }} className={`${isSelected ? 'ring-2 ring-blue-400' : ''} flex items-center justify-around px-4`}>{items.map((step: any, i: number) => (<div key={i} className="flex flex-col items-center"><div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: accent, color: '#fff' }}>{i + 1}</div><div className="text-xs mt-2 font-medium" style={{ color: '#e2e8f0' }}>{step.title}</div></div>))}</div>);
  }

  if (block.type === 'graphic' || block.type === 'image') {
    const src = (block as any).src;
    return (<div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }} className={`${isSelected ? 'ring-2 ring-blue-400' : ''} rounded-lg overflow-hidden`}>{src && <img src={src} alt="" className="w-full h-full object-cover" />}</div>);
  }

  // 表格：原生表格预览
  if (block.type === 'table') {
    const b = block as any;
    const headers: string[] = b.headers || [];
    const rows: string[][] = b.rows || [];
    const colCount = Math.max(headers.length, ...rows.map((r: string[]) => r.length), 1);
    const fs = 15 * scale;
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`${isSelected ? 'ring-2 ring-blue-400' : ''} overflow-hidden rounded-md`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {Array.from({ length: colCount }, (_, i) => (
                <th key={i} style={{ background: accent, color: '#fff', fontSize: fs, padding: `${6 * scale}px ${10 * scale}px`, textAlign: 'left', fontWeight: 600 }}>{headers[i] ?? ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: b.zebra !== false && ri % 2 === 1 ? 'rgba(148,163,184,0.10)' : 'transparent' }}>
                {Array.from({ length: colCount }, (_, ci) => (
                  <td key={ci} style={{ fontSize: fs, padding: `${6 * scale}px ${10 * scale}px`, color: '#e2e8f0', borderBottom: `1px solid rgba(148,163,184,0.22)` }}>{r[ci] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 图表：轻量 SVG 预览（导出时转为 PPTX 原生图表）
  if (block.type === 'chart') {
    const b = block as any;
    const cats: string[] = b.categories || [];
    const series: { name: string; values: number[] }[] = b.series || [];
    const all = series.flatMap(s => s.values || []);
    const max = Math.max(1, ...all);
    const colors = [accent, '#06b6d4', '#f59e0b', '#10b981', '#ef4444'];
    const isPie = b.chart === 'pie' || b.chart === 'doughnut';
    return (
      <div style={style} onMouseDown={onMouseDown} onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`${isSelected ? 'ring-2 ring-blue-400' : ''} flex items-center justify-center`}>
        {isPie ? (
          <svg viewBox="0 0 100 100" style={{ width: '78%', height: '78%' }}>
            {(() => {
              const vals = (series[0]?.values || []).map(v => Math.max(0, v));
              const total = vals.reduce((a, v) => a + v, 0) || 1;
              let acc = 0;
              return vals.map((v, i) => {
                const frac = v / total;
                const r = 42, cx = 50, cy = 50;
                const a0 = acc * Math.PI * 2 - Math.PI / 2;
                const a1 = (acc + frac) * Math.PI * 2 - Math.PI / 2;
                acc += frac;
                const large = frac > 0.5 ? 1 : 0;
                const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
                const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
                return <path key={i} d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={colors[i % colors.length]} opacity={0.92} />;
              });
            })()}
            {b.chart === 'doughnut' && <circle cx="50" cy="50" r="20" fill="#0b1220" />}
          </svg>
        ) : (
          <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '94%', height: '82%' }}>
            {(() => {
              const n = Math.max(1, cats.length);
              const groupW = 92 / n;
              const barW = (groupW * 0.62) / Math.max(1, series.length);
              return series.map((se, si) => (se.values || []).map((v, i) => {
                const bh = (Math.max(0, v) / max) * 48;
                const bx = 4 + i * groupW + groupW * 0.19 + si * barW;
                return <rect key={`${si}-${i}`} x={bx} y={52 - bh} width={barW * 0.86} height={bh} rx={1.2}
                  fill={colors[si % colors.length]} opacity={0.92} />;
              }));
            })()}
            <line x1="4" y1="52" x2="96" y2="52" stroke="rgba(148,163,184,0.5)" strokeWidth="0.6" />
          </svg>
        )}
      </div>
    );
  }

  return <div style={style} className={`${isSelected ? 'ring-2 ring-blue-400' : ''}`} onMouseDown={onMouseDown} />;
}

function renderSlideToHtml(slide: Slide, accent: string, index: number): string {
  let contentHtml = '';
  slide.blocks.forEach((block) => {
    if (block.type === 'title') contentHtml += `<div class="slide-title">${(block as any).text}</div>`;
    else if (block.type === 'subtitle') contentHtml += `<div class="slide-subtitle">${(block as any).text}</div>`;
    else if (block.type === 'bullets') { const items = (block as any).items || []; contentHtml += `<ul class="slide-content">${items.map((i: string) => `<li>${i}</li>`).join('')}</ul>`; }
    else if (block.type === 'paragraph') contentHtml += `<div class="slide-content">${(block as any).text}</div>`;
    else if (block.type === 'quote') contentHtml += `<blockquote>${(block as any).text}</blockquote>`;
    else if (block.type === 'stats') { const items = (block as any).items || []; contentHtml += `<div class="stats">${items.map((s: any) => `<div class="stat"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('')}</div>`; }
    else if (block.type === 'steps') { const items = (block as any).items || []; contentHtml += `<div class="slide-content">${items.map((s: any, i: number) => `<div><strong>步骤 ${i + 1}:</strong> ${s.title}</div>`).join('')}</div>`; }
  });
  return `<div class="slide" style="background:linear-gradient(135deg,#0f172a,${accent}44)">${contentHtml}<div class="slide-num">${index + 1}</div></div>`;
}
