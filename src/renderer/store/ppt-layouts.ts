import type { Block, Box, BulletsBlock, ChartBlock, ChartKind, ChartSeries, DividerBlock, GraphicBlock, GraphicKind, ImageBlock, LayoutId, QuoteBlock, Slide, SlideSpec, StatsBlock, StepsBlock, TableBlock, TextBlock } from '../types/ppt';

export const LAYOUT_LABELS: Record<LayoutId, string> = {
  cover: '封面', agenda: '目录', bullets: '要点列表', twoColumn: '双栏对比',
  compare: '卡片对照', stats: '数据指标', quote: '金句引言', timeline: '流程步骤',
  imageText: '图文混排', closing: '结束页',
  table: '数据表格', chart: '图表分析', gallery: '多图展示',
};

const S: Record<string, any> = {
  eyebrow: { fontSize: 18, color: 'accent', bold: true, upper: true, letterSpacing: 2.4 },
  h1: { fontSize: 46, bold: true, color: 'text' },
  h2: { fontSize: 26, bold: true, color: 'text' },
  body: { fontSize: 22, color: 'text' },
  muted: { fontSize: 22, color: 'muted' },
  bullets: { fontSize: 21, color: 'text' },
  bulletsSm: { fontSize: 19, color: 'text' },
};

function uid(p: string): string { return p + Math.random().toString(36).slice(2, 10); }
function mkBox(x: number, y: number, w: number, h: number): Box { return { x, y, w, h }; }

function text(type: 'title' | 'subtitle' | 'paragraph' | 'eyebrow', box: Box, value: string, style: any): TextBlock {
  return { id: uid(type[0]), type, box, text: value, style: { ...style } };
}

function divider(box: Box): DividerBlock { return { id: uid('d'), type: 'divider', box, style: { fill: 'accent', radius: 3 } }; }

function bullets(box: Box, items: string[], style: any, icon: BulletsBlock['icon'] = 'dot'): BulletsBlock {
  return { id: uid('u'), type: 'bullets', box, items, icon, style: { ...style } };
}

function stats(box: Box, items: StatsBlock['items']): StatsBlock { return { id: uid('s'), type: 'stats', box, items, style: {} }; }
function steps(box: Box, items: StepsBlock['items'], numbered = true): StepsBlock { return { id: uid('p'), type: 'steps', box, items, numbered, style: {} }; }
function graphic(box: Box, kind: GraphicKind, seed: number, variant = 0): GraphicBlock { return { id: uid('g'), type: 'graphic', box, graphic: kind, seed, variant, style: {} }; }

function table(box: Box, headers: string[], rows: string[][]): TableBlock {
  return { id: uid('tb'), type: 'table', box, headers, rows, zebra: true, style: {} };
}

function chart(box: Box, kind: ChartKind, categories: string[], series: ChartSeries[], showLegend = true): ChartBlock {
  return { id: uid('ch'), type: 'chart', box, chart: kind, categories, series, showLegend, showValue: false, style: {} };
}

function autoIllustration(box: Box, kind: GraphicKind, seed: number, caption: string): ImageBlock {
  const hue = 210 + (seed % 5) * 18;
  const accent = `hsl(${hue} 82% 58%)`;
  const accent2 = `hsl(${(hue + 52) % 360} 78% 62%)`;
  const safeCaption = caption.replace(/[<>&"']/g, '');
  const bars = [24, 46, 34, 68, 54].map((h, i) => `<rect x="${82 + i * 42}" y="${198 - h}" width="22" height="${h}" rx="7" fill="${i % 2 ? accent2 : accent}" opacity="${0.55 + i * 0.08}"/>`).join('');
  const nodes = [[108, 94], [198, 58], [258, 146], [154, 196], [292, 224]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 18 : 11}" fill="${i % 2 ? accent2 : accent}"/><circle cx="${x}" cy="${y}" r="${i === 0 ? 28 : 19}" fill="none" stroke="${accent}" opacity=".24"/>`).join('');
  const content = kind === 'bars' ? `<path d="M70 214H310" stroke="${accent}" opacity=".22" stroke-width="2"/>${bars}`
    : kind === 'nodes' || kind === 'orbit' ? `<path d="M108 94L198 58L258 146L154 196L292 224M198 58L154 196" fill="none" stroke="${accent}" stroke-width="3" opacity=".32"/>${nodes}`
    : kind === 'grid' ? Array.from({ length: 12 }, (_, i) => `<rect x="${68 + (i % 4) * 66}" y="${58 + Math.floor(i / 4) * 66}" width="44" height="44" rx="12" fill="${i % 3 ? accent : accent2}" opacity="${0.18 + (i % 4) * 0.06}"/>`).join('')
    : kind === 'ladder' ? [0, 1, 2, 3].map((i) => `<rect x="${72 + i * 54}" y="${188 - i * 28}" width="92" height="18" rx="9" fill="${i % 2 ? accent2 : accent}" opacity="${0.42 + i * 0.12}"/>`).join('')
    : kind === 'rings' ? [0, 1, 2].map((i) => `<circle cx="190" cy="142" r="${44 + i * 34}" fill="none" stroke="${i % 2 ? accent2 : accent}" stroke-width="12" opacity="${0.22 + i * 0.12}"/>`).join('')
    : `<rect x="68" y="62" width="244" height="164" rx="26" fill="url(#card)"/><path d="M94 184C132 122 170 204 208 140S274 120 298 86" fill="none" stroke="${accent2}" stroke-width="9" stroke-linecap="round" opacity=".8"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="280" viewBox="0 0 380 280"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#172554"/></linearGradient><linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${accent2}" stop-opacity=".12"/></linearGradient></defs><rect width="380" height="280" rx="28" fill="url(#bg)"/><circle cx="320" cy="32" r="92" fill="${accent}" opacity=".08"/><circle cx="34" cy="250" r="84" fill="${accent2}" opacity=".08"/>${content}<text x="28" y="254" fill="#e2e8f0" font-family="Arial,sans-serif" font-size="11" letter-spacing="2" opacity=".68">AI VISUAL · ${safeCaption.slice(0, 24)}</text></svg>`;
  return { id: uid('img'), type: 'image', box, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, fit: 'cover', radius: 20, caption: safeCaption, style: {} };
}

function quote(box: Box, value: string, author?: string): QuoteBlock {
  return { id: uid('q'), type: 'quote', box, text: value, author, style: { fontSize: 42, align: 'center', color: 'text' } };
}

const GRAPHIC_CYCLE: GraphicKind[] = ['orbit', 'nodes', 'bars', 'rings', 'ladder', 'grid', 'abstract', 'wave'];

export function materialize(spec: SlideSpec, index: number): Slide {
  const seed = 1000 + index * 137;
  const gKind: GraphicKind = spec.graphic ?? GRAPHIC_CYCLE[index % GRAPHIC_CYCLE.length];
  const blocks: Block[] = [];
  const t = spec.title?.trim() || spec.name?.trim() || LAYOUT_LABELS[spec.layout];
  const push = (b: Block | null) => { if (b) blocks.push(b); };

  switch (spec.layout) {
    case 'cover':
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 142, 700, 38), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 196, 880, 232), t, { fontSize: 74, bold: true, lineHeight: 1.14 }));
      push(divider(mkBox(80, 452, 84, 6)));
      push(spec.subtitle ? text('subtitle', mkBox(80, 490, 780, 116), spec.subtitle, { fontSize: 26, color: 'muted', lineHeight: 1.6 }) : null);
      push(graphic(mkBox(944, 148, 260, 424), gKind, seed));
      break;
    case 'agenda':
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 88, 500, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 126, 760, 78), t, S.h1));
      push(divider(mkBox(80, 218, 64, 5)));
      push(spec.bullets?.length ? bullets(mkBox(80, 262, 540, 348), spec.bullets, { ...S.body, fontSize: 23 }, 'number') : null);
      push(graphic(mkBox(700, 236, 500, 392), gKind, seed));
      break;
    case 'bullets':
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 70, 620, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 108, 830, 78), t, S.h1));
      push(divider(mkBox(80, 200, 64, 5)));
      push(spec.bullets?.length ? bullets(mkBox(80, 244, 622, 400), spec.bullets, S.bullets, 'dot') : null);
      push(graphic(mkBox(748, 196, 452, 456), gKind, seed));
      break;
    case 'twoColumn': {
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 72, 500, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 110, 1120, 78), t, S.h1));
      push(divider(mkBox(80, 202, 64, 5)));
      const cols = spec.columns ?? [];
      push(text('subtitle', mkBox(80, 236, 520, 46), cols[0]?.title ?? '要点一', { ...S.h2, color: 'accent' }));
      push(cols[0]?.items.length ? bullets(mkBox(80, 296, 528, 330), cols[0].items, S.bulletsSm, 'check') : null);
      push(text('subtitle', mkBox(672, 236, 520, 46), cols[1]?.title ?? '要点二', { ...S.h2, color: 'accent2' }));
      push(cols[1]?.items.length ? bullets(mkBox(672, 296, 528, 330), cols[1].items, S.bulletsSm, 'check') : null);
      break;
    }
    case 'compare': {
      push(text('title', mkBox(80, 66, 1120, 76), t, { fontSize: 44, bold: true }));
      push(divider(mkBox(80, 154, 64, 5)));
      const cmpCols = spec.columns ?? [];
      push(text('subtitle', mkBox(108, 182, 340, 44), cmpCols[0]?.title ?? '方案 A', { ...S.h2, color: 'accent', fontSize: 24 }));
      push(cmpCols[0]?.items.length ? bullets(mkBox(80, 214, 520, 396), cmpCols[0].items, { ...S.bulletsSm, fill: 'surface', radius: 18, padding: 30 }, 'dot') : null);
      push(text('subtitle', mkBox(708, 182, 340, 44), cmpCols[1]?.title ?? '方案 B', { ...S.h2, color: 'accent2', fontSize: 24 }));
      push(cmpCols[1]?.items.length ? bullets(mkBox(680, 214, 520, 396), cmpCols[1].items, { ...S.bulletsSm, fill: 'surface', radius: 18, padding: 30 }, 'dot') : null);
      break;
    }
    case 'stats':
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 76, 500, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 114, 900, 78), t, S.h1));
      push(divider(mkBox(80, 206, 64, 5)));
      push(spec.stats?.length ? stats(mkBox(80, 254, 1120, 236), spec.stats) : null);
      push(spec.paragraph ? text('paragraph', mkBox(80, 528, 1120, 122), spec.paragraph, { fontSize: 22, color: 'muted', lineHeight: 1.7 }) : null);
      break;
    case 'quote':
      push(quote(mkBox(140, 196, 1000, 250), spec.quote?.text ?? t, spec.quote?.author));
      push(divider(mkBox(600, 476, 80, 5)));
      push(graphic(mkBox(936, 556, 244, 132), 'rings', seed, 2));
      break;
    case 'timeline':
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 74, 500, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 112, 900, 78), t, S.h1));
      push(divider(mkBox(80, 204, 64, 5)));
      push(spec.steps?.length ? steps(mkBox(80, 258, 1120, 336), spec.steps, true) : null);
      break;
    case 'imageText':
      push(text('title', mkBox(80, 76, 620, 80), t, { fontSize: 42, bold: true }));
      push(divider(mkBox(80, 168, 64, 5)));
      push(autoIllustration(mkBox(80, 214, 520, 400), gKind, seed, t));
      push(spec.bullets?.length ? bullets(mkBox(660, 214, 540, 400), spec.bullets, S.bulletsSm, 'check') : null);
      break;
    case 'table': {
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 74, 620, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 112, 1120, 78), t, S.h1));
      push(divider(mkBox(80, 204, 64, 5)));
      const tb = spec.table ?? { headers: ['项目', '数值', '说明'], rows: [['—', '—', '—']] };
      push(table(mkBox(80, 252, 1120, 356), tb.headers, tb.rows));
      break;
    }
    case 'chart': {
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 74, 620, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 112, 1120, 78), t, S.h1));
      push(divider(mkBox(80, 204, 64, 5)));
      const ch = spec.chart ?? {
        kind: 'bar' as ChartKind,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: '数值', values: [30, 52, 44, 68] }],
      };
      push(chart(mkBox(80, 248, 1120, 372), ch.kind, ch.categories, ch.series));
      break;
    }
    case 'gallery': {
      push(spec.eyebrow ? text('eyebrow', mkBox(80, 70, 620, 30), spec.eyebrow, S.eyebrow) : null);
      push(text('title', mkBox(80, 108, 1120, 78), t, S.h1));
      push(divider(mkBox(80, 200, 64, 5)));
      const caps = spec.images && spec.images.length ? spec.images : [{}, {}, {}];
      const gw = 352, gap = 32, gy = 250, gh = 330;
      caps.slice(0, 3).forEach((im, i) => {
        push(autoIllustration(
          mkBox(80 + i * (gw + gap), gy, gw, gh),
          GRAPHIC_CYCLE[(index + i) % GRAPHIC_CYCLE.length],
          seed + i * 31,
          im.caption || `${t} ${i + 1}`,
        ));
      });
      break;
    }
    case 'closing':
    default:
      push(text('title', mkBox(140, 246, 1000, 190), t, { fontSize: 70, bold: true, align: 'center' }));
      push(divider(mkBox(590, 128, 100, 6)));
      push(spec.subtitle ? text('subtitle', mkBox(200, 452, 880, 96), spec.subtitle, { fontSize: 26, color: 'muted', align: 'center', lineHeight: 1.6 }) : null);
      break;
  }

  return {
    id: uid('sl'), layout: spec.layout, name: spec.name ?? (t || LAYOUT_LABELS[spec.layout]),
    background: { mode: spec.background ?? 'clean' }, blocks, notes: spec.notes ?? '',
  };
}

export function extractSpec(slide: Slide): SlideSpec {
  const spec: SlideSpec = { layout: slide.layout, name: slide.name };
  const columns: { title: string; items: string[] }[] = [];
  slide.blocks.forEach((b) => {
    switch (b.type) {
      case 'title': spec.title = (b as TextBlock).text; break;
      case 'subtitle': spec.subtitle = (b as TextBlock).text; break;
      case 'paragraph': spec.paragraph = (b as TextBlock).text; break;
      case 'eyebrow': spec.eyebrow = (b as TextBlock).text; break;
      case 'quote': spec.quote = { text: (b as any).text, author: (b as any).author }; break;
      case 'bullets': columns.push({ title: `第 ${columns.length + 1} 组`, items: (b as BulletsBlock).items }); break;
      case 'stats': spec.stats = (b as StatsBlock).items; break;
      case 'steps': spec.steps = (b as StepsBlock).items; break;
      case 'graphic': spec.graphic = (b as GraphicBlock).graphic; break;
      case 'table': spec.table = { headers: (b as TableBlock).headers, rows: (b as TableBlock).rows }; break;
      case 'chart': spec.chart = { kind: (b as ChartBlock).chart, categories: (b as ChartBlock).categories, series: (b as ChartBlock).series }; break;
      default: break;
    }
  });
  if (columns.length >= 2) spec.columns = columns.slice(0, 2);
  else if (columns.length === 1) spec.bullets = columns[0].items;
  spec.background = slide.background.mode;
  spec.notes = slide.notes;
  return spec;
}
