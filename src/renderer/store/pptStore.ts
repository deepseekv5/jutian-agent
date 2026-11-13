import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Block, Deck, FontKey, GenerateOptions, LayoutId, Slide, SlideSpec } from '../types/ppt';
import { materialize, extractSpec, LAYOUT_LABELS } from './ppt-layouts';

/** v16.3.0 AI 对话操作指令（PPTChat 解析 LLM 输出后执行） */
export type PptAction =
  | { op: 'setTitle'; title: string }
  | { op: 'setTheme'; themeId: string }
  | { op: 'addSlide'; layout?: LayoutId; title?: string; bullets?: string[]; index?: number }
  | { op: 'deleteSlide'; index: number }
  | { op: 'updateSlideTitle'; index: number; title: string }
  | { op: 'updateBullets'; index: number; bullets: string[] }
  | { op: 'replaceText'; index: number; old: string; new: string }
  | { op: 'addNotes'; index: number; notes: string };
import { localGenerate } from './ppt-engine';
import { aiGenerateSlides } from './ppt-ai';
import { uid } from '../utils/uid';

const STORAGE_KEY = 'claw:ppt:deck:v1';

interface Notice {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

interface PptState {
  deck: Deck;
  selectedSlideId: string;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  past: Deck[];
  future: Deck[];
  generating: boolean;
  genStage: string;
  notice: Notice | null;

  notify: (text: string, kind?: Notice['kind']) => void;
  clearNotice: () => void;
  undo: () => void;
  redo: () => void;

  selectSlide: (id: string) => void;
  selectBlock: (id: string | null) => void;
  setEditing: (id: string | null) => void;

  generate: (opts: GenerateOptions, onLog?: (phase: number, msg: string) => void) => Promise<void>;

  addSlide: (layout?: LayoutId, afterId?: string) => void;
  duplicateSlide: (id: string) => void;
  deleteSlide: (id: string) => void;
  moveSlide: (id: string, dir: -1 | 1) => void;
  updateSlideBackground: (id: string, patch: Partial<Slide['background']>) => void;
  applyLayout: (id: string, layout: LayoutId) => void;

  updateBlock: (slideId: string, blockId: string, patch: Partial<Block>) => void;
  updateBlockBox: (slideId: string, blockId: string, box: Partial<Block['box']>) => void;
  updateBlockBoxLive: (slideId: string, blockId: string, box: Partial<Block['box']>) => void;
  pushHistory: () => void;
  addBlock: (slideId: string, block: Block) => void;
  deleteBlock: (slideId: string, blockId: string) => void;
  bringForward: (slideId: string, blockId: string, toFront: boolean) => void;

  /** v16.3.0：AI 对话直接改 deck（PPTChat 解析 LLM 返回的操作指令执行） */
  applyActions: (actions: PptAction[]) => number;
  setTheme: (themeId: string) => void;
  setFont: (fontKey: FontKey) => void;
  setDeckTitle: (title: string) => void;

  loadDeck: (deck: Deck) => void;
  resetDeck: () => void;
}

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function emptyDeck(): Deck {
  const spec: SlideSpec = {
    layout: 'cover', name: '封面', eyebrow: 'CLAW AGENT',
    title: '点击「AI 生成」开始创建演示文稿',
    subtitle: '输入主题，AI 自动生成专业 PPT',
    background: 'clean',
  };
  return {
    id: uid('deck'), title: '未命名演示文稿', themeId: 'aurora', fontKey: 'sans',
    slides: [materialize(spec, 0)], createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function persistDeck(deck: Deck) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(deck)); } catch {}
}

function loadPersisted(): Deck | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Deck;
    if (!parsed || !Array.isArray(parsed.slides) || parsed.slides.length === 0) return null;
    parsed.slides.forEach((s) => {
      if (!s.background) s.background = { mode: 'clean' };
      if (!Array.isArray(s.blocks)) s.blocks = [];
    });
    return parsed;
  } catch { return null; }
}

const initialDeck = loadPersisted() ?? emptyDeck();

export const usePptStore = create<PptState>()(
  immer((set, get) => {
    const mutate = (fn: (deck: Deck) => void, history = true) => {
      set((s) => {
        if (history) {
          s.past.push(JSON.parse(JSON.stringify(s.deck)) as Deck);
          if (s.past.length > 60) s.past.shift();
          s.future = [];
        }
        fn(s.deck as Deck);
        s.deck.updatedAt = Date.now();
      });
    };
    const findSlide = (deck: Deck, id: string) => deck.slides.find((x) => x.id === id);

    return {
      deck: initialDeck,
      selectedSlideId: initialDeck.slides[0]?.id ?? '',
      selectedBlockId: null, editingBlockId: null,
      past: [], future: [], generating: false, genStage: '', notice: null,

      notify: (text, kind = 'info') => set({ notice: { id: uid('n'), kind, text } }),
      clearNotice: () => set({ notice: null }),

      undo: () => set((s) => {
        const prev = s.past.pop();
        if (!prev) return;
        s.future.push(JSON.parse(JSON.stringify(s.deck)) as Deck);
        s.deck = prev;
        if (!findSlide(s.deck, s.selectedSlideId)) s.selectedSlideId = s.deck.slides[0]?.id ?? '';
        s.selectedBlockId = null; s.editingBlockId = null;
      }),

      redo: () => set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push(JSON.parse(JSON.stringify(s.deck)) as Deck);
        s.deck = next;
        if (!findSlide(s.deck, s.selectedSlideId)) s.selectedSlideId = s.deck.slides[0]?.id ?? '';
        s.selectedBlockId = null; s.editingBlockId = null;
      }),

      selectSlide: (id) => set((s) => { s.selectedSlideId = id; s.selectedBlockId = null; s.editingBlockId = null; }),
      selectBlock: (id) => set((s) => { s.selectedBlockId = id; if (!id || s.editingBlockId !== id) s.editingBlockId = null; }),
      setEditing: (id) => set((s) => { s.editingBlockId = id; if (id) s.selectedBlockId = id; }),

      generate: async (opts, onLog) => {
        // v16.2.0：四阶段可观测流程（分析主题 → 规划大纲 → 逐页生成 → 排版渲染）
        set({ generating: true, genStage: '正在分析主题…' });
        onLog?.(1, `分析主题「${opts.topic}」：提取关键词与受众…`);
        try {
          // 优先 AI 智能生成（按主题产出真实内容），失败回退内置模板
          set({ genStage: 'AI 正在策划大纲与内容…' });
          onLog?.(2, 'AI 正在规划大纲与逐页内容…');
          let plan = await aiGenerateSlides(opts);
          if (plan && plan.length > 0) {
            set({ genStage: `AI 已生成 ${plan.length} 页，正在排版…` });
            onLog?.(2, `大纲就绪：共 ${plan.length} 页（${plan.map(p => p.name || p.layout).slice(0, 4).join('、')}…）`);
          } else {
            set({ genStage: '正在使用内置结构生成…' });
            onLog?.(2, 'AI 生成不可用，改用内置结构模板');
            plan = localGenerate(opts);
          }
          await new Promise((r) => setTimeout(r, 80));
          onLog?.(3, '逐页生成内容与版式…');
          mutate((deck) => {
            deck.title = opts.topic.slice(0, 40) || deck.title;
            deck.slides = plan.map((spec, i) => materialize(spec, i));
          });
          plan.forEach((spec, i) => onLog?.(3, `第 ${i + 1}/${plan.length} 页：${spec.name || spec.layout}`));
          onLog?.(4, `排版渲染完成，共 ${plan.length} 页`);
          set((s) => {
            s.selectedSlideId = s.deck.slides[0]?.id ?? '';
            s.selectedBlockId = null; s.editingBlockId = null; s.genStage = ''; s.generating = false;
          });
          onLog?.(4, '完成');
          persistDeck(get().deck);
          get().notify(`已生成 ${plan.length} 页`, 'success');
        } catch (err) {
          set({ generating: false, genStage: '' });
          get().notify(`生成失败：${String(err)}`, 'error');
        }
      },

      addSlide: (layout = 'bullets', afterId) => {
        let newId = '';
        mutate((deck) => {
          const spec: SlideSpec = { layout, name: LAYOUT_LABELS[layout], eyebrow: 'NEW', title: '新页面标题', bullets: ['第一条要点', '第二条要点', '第三条要点'], background: 'clean' };
          const slide = materialize(spec, deck.slides.length);
          const idx = afterId ? deck.slides.findIndex((s) => s.id === afterId) : deck.slides.length - 1;
          deck.slides.splice(idx + 1, 0, slide);
          newId = slide.id;
        });
        set({ selectedSlideId: newId, selectedBlockId: null, editingBlockId: null });
      },

      duplicateSlide: (id) => {
        let newId = '';
        mutate((deck) => {
          const idx = deck.slides.findIndex((s) => s.id === id);
          if (idx < 0) return;
          const copy: Slide = JSON.parse(JSON.stringify(deck.slides[idx]));
          copy.id = uid('sl'); copy.name = `${copy.name} 副本`;
          copy.blocks = copy.blocks.map((b) => ({ ...b, id: uid('b') }));
          deck.slides.splice(idx + 1, 0, copy); newId = copy.id;
        });
        if (newId) set({ selectedSlideId: newId, selectedBlockId: null, editingBlockId: null });
      },

      deleteSlide: (id) => {
        let newId = '';
        mutate((deck) => {
          if (deck.slides.length <= 1) return;
          const idx = deck.slides.findIndex((s) => s.id === id);
          if (idx < 0) return;
          deck.slides.splice(idx, 1);
          newId = deck.slides[clamp(idx, 0, deck.slides.length - 1)].id;
        });
        if (newId) set({ selectedSlideId: newId, selectedBlockId: null, editingBlockId: null });
      },

      moveSlide: (id, dir) => mutate((deck) => {
        const idx = deck.slides.findIndex((s) => s.id === id);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= deck.slides.length) return;
        const [item] = deck.slides.splice(idx, 1);
        deck.slides.splice(target, 0, item);
      }),

      updateSlideBackground: (id, patch) => mutate((deck) => {
        const s = findSlide(deck, id);
        if (s) Object.assign(s.background, patch);
      }),

      applyLayout: (id, layout) => {
        mutate((deck) => {
          const s = findSlide(deck, id);
          if (!s) return;
          const spec = extractSpec(s);
          spec.layout = layout;
          const rebuilt = materialize(spec, deck.slides.findIndex((x) => x.id === id));
          s.layout = rebuilt.layout; s.blocks = rebuilt.blocks;
        });
        set({ selectedBlockId: null, editingBlockId: null });
      },

      updateBlock: (slideId, blockId, patch) => mutate((deck) => {
        const s = findSlide(deck, slideId);
        const b = s?.blocks.find((x) => x.id === blockId);
        if (b) Object.assign(b, patch);
      }),

      updateBlockBox: (slideId, blockId, box) => mutate((deck) => {
        const s = findSlide(deck, slideId);
        const b = s?.blocks.find((x) => x.id === blockId);
        if (b) Object.assign(b.box, box);
      }),

      updateBlockBoxLive: (slideId, blockId, box) => mutate((deck) => {
        const s = findSlide(deck, slideId);
        const b = s?.blocks.find((x) => x.id === blockId);
        if (b) { Object.assign(b.box, box); deck.updatedAt = Date.now(); }
      }, false),

      pushHistory: () => set((s) => { s.past.push(JSON.parse(JSON.stringify(s.deck)) as Deck); if (s.past.length > 60) s.past.shift(); s.future = []; }),

      addBlock: (slideId, block) => {
        mutate((deck) => { const s = findSlide(deck, slideId); if (s) s.blocks.push(JSON.parse(JSON.stringify(block)) as Block); });
        set({ selectedBlockId: block.id });
      },

      deleteBlock: (slideId, blockId) => {
        mutate((deck) => { const s = findSlide(deck, slideId); if (s) s.blocks = s.blocks.filter((b) => b.id !== blockId); });
        set((st) => { if (st.selectedBlockId === blockId) st.selectedBlockId = null; if (st.editingBlockId === blockId) st.editingBlockId = null; });
      },

      bringForward: (slideId, blockId, toFront) => mutate((deck) => {
        const s = findSlide(deck, slideId);
        if (!s) return;
        const idx = s.blocks.findIndex((b) => b.id === blockId);
        if (idx < 0) return;
        const [b] = s.blocks.splice(idx, 1);
        if (toFront) s.blocks.push(b); else s.blocks.unshift(b);
      }),

      applyActions: (actions) => {
        let applied = 0;
        mutate((deck) => {
          for (const a of actions) {
            if (a.op === 'setTitle' && typeof a.title === 'string') { deck.title = a.title.slice(0, 60); applied++; }
            else if (a.op === 'setTheme' && typeof a.themeId === 'string') { deck.themeId = a.themeId; applied++; }
            else if (a.op === 'addSlide') {
              const spec = { layout: (a.layout || 'bullets') as LayoutId, title: String(a.title || '新页面'), bullets: Array.isArray(a.bullets) ? a.bullets.map(String).slice(0, 6) : undefined, background: 'clean' as const };
              const slide = materialize(spec, deck.slides.length);
              if (typeof a.index === 'number') deck.slides.splice(Math.max(0, Math.min(deck.slides.length, a.index)), 0, slide);
              else deck.slides.push(slide);
              applied++;
            }
            else if (a.op === 'deleteSlide' && typeof a.index === 'number') {
              const i = a.index - 1;
              if (i >= 0 && i < deck.slides.length) { deck.slides.splice(i, 1); applied++; }
            }
            else if (a.op === 'updateSlideTitle' && typeof a.index === 'number' && typeof a.title === 'string') {
              const sl = deck.slides[a.index - 1];
              if (sl) {
                sl.name = a.title.slice(0, 30);
                const tb = sl.blocks.find(b => b.type === 'title') as any;
                if (tb) tb.text = a.title.slice(0, 60);
                applied++;
              }
            }
            else if (a.op === 'updateBullets' && typeof a.index === 'number' && Array.isArray(a.bullets)) {
              const sl = deck.slides[a.index - 1];
              const bb = sl?.blocks.find(b => b.type === 'bullets') as any;
              if (bb) { bb.items = a.bullets.map(String).slice(0, 6); applied++; }
            }
            else if (a.op === 'replaceText' && typeof a.index === 'number' && typeof a.old === 'string' && typeof a.new === 'string') {
              const sl = deck.slides[a.index - 1];
              let hit = false;
              for (const b of sl?.blocks || []) {
                if (b.type === 'title' || b.type === 'subtitle' || b.type === 'paragraph' || b.type === 'eyebrow') {
                  const t = (b as any).text;
                  if (typeof t === 'string' && t.includes(a.old)) { (b as any).text = t.split(a.old).join(a.new); hit = true; }
                }
                if (b.type === 'bullets') {
                  const items = (b as any).items as string[];
                  (b as any).items = items.map(x => x.split(a.old).join(a.new));
                  if (items.some(x => x.includes(a.old))) hit = true;
                }
              }
              if (hit) applied++;
            }
            else if (a.op === 'addNotes' && typeof a.index === 'number' && typeof a.notes === 'string') {
              const sl = deck.slides[a.index - 1];
              if (sl) { sl.notes = a.notes.slice(0, 300); applied++; }
            }
          }
        });
        persistDeck(get().deck);
        return applied;
      },
      setTheme: (themeId) => mutate((deck) => { deck.themeId = themeId; }),
      setFont: (fontKey) => mutate((deck) => { deck.fontKey = fontKey; }),
      setDeckTitle: (title) => mutate((deck) => { deck.title = title; }),

      loadDeck: (deck) => {
        mutate((d) => { Object.assign(d, JSON.parse(JSON.stringify(deck))); });
        set((s) => { s.selectedSlideId = s.deck.slides[0]?.id ?? ''; s.selectedBlockId = null; s.editingBlockId = null; });
      },

      resetDeck: () => {
        mutate((d) => { Object.assign(d, emptyDeck()); });
        set((s) => { s.selectedSlideId = s.deck.slides[0]?.id ?? ''; s.selectedBlockId = null; s.editingBlockId = null; });
      },
    };
  })
);

let saveTimer: number | undefined;
usePptStore.subscribe((state, prev) => {
  if (state.deck === prev.deck) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistDeck(state.deck), 500);
});

export const selectCurrentSlide = (s: PptState): Slide | undefined =>
  s.deck.slides.find((x) => x.id === s.selectedSlideId) ?? s.deck.slides[0];
