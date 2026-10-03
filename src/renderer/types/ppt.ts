/**
 * PPT 功能数据模型
 * 画布坐标系：逻辑分辨率 1280 x 720（16:9）
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export type LayoutId =
  | 'cover' | 'agenda' | 'bullets' | 'twoColumn' | 'compare'
  | 'stats' | 'quote' | 'timeline' | 'imageText' | 'closing'
  | 'table' | 'chart' | 'gallery';

export type BlockType =
  | 'title' | 'subtitle' | 'bullets' | 'paragraph' | 'quote'
  | 'stats' | 'graphic' | 'image' | 'eyebrow' | 'divider' | 'steps'
  | 'table' | 'chart';

export interface Box { x: number; y: number; w: number; h: number; }

export type ColorToken = 'text' | 'muted' | 'accent' | 'accent2' | 'onAccent' | 'surface' | (string & {});

export interface BlockStyle {
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  bold?: boolean;
  italic?: boolean;
  color?: ColorToken;
  fill?: 'none' | ColorToken;
  radius?: number;
  padding?: number;
  fillAlpha?: number;
  upper?: boolean;
}

export interface BaseBlock {
  id: string;
  type: BlockType;
  box: Box;
  style?: BlockStyle;
  locked?: boolean;
}

export interface TextBlock extends BaseBlock {
  type: 'title' | 'subtitle' | 'paragraph' | 'eyebrow';
  text: string;
}

export interface DividerBlock extends BaseBlock { type: 'divider'; }
export interface QuoteBlock extends BaseBlock { type: 'quote'; text: string; author?: string; }

export type BulletIcon = 'dot' | 'check' | 'number' | 'dash' | 'none';

export interface BulletsBlock extends BaseBlock {
  type: 'bullets';
  items: string[];
  icon?: BulletIcon;
  gap?: number;
}

export interface StatItem { value: string; label: string; }
export interface StatsBlock extends BaseBlock { type: 'stats'; items: StatItem[]; }

export interface StepItem { title: string; desc?: string; }
export interface StepsBlock extends BaseBlock { type: 'steps'; items: StepItem[]; numbered?: boolean; }

export type GraphicKind = 'orbit' | 'grid' | 'wave' | 'bars' | 'nodes' | 'rings' | 'cards' | 'ladder' | 'abstract';

export interface GraphicBlock extends BaseBlock {
  type: 'graphic';
  graphic: GraphicKind;
  variant: number;
  seed: number;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  src: string;
  fit?: 'cover' | 'contain';
  radius?: number;
  caption?: string;
}

export type Block = TextBlock | DividerBlock | QuoteBlock | BulletsBlock | StatsBlock | StepsBlock | GraphicBlock | ImageBlock | TableBlock | ChartBlock;

/** 表格块（导出为 PPTX 原生表格，可继续编辑） */
export interface TableBlock extends BaseBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
  zebra?: boolean;
}

export type ChartKind = 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'radar';
export interface ChartSeries { name: string; values: number[]; }

/** 图表块（导出为 PPTX 原生图表，可继续编辑） */
export interface ChartBlock extends BaseBlock {
  type: 'chart';
  chart: ChartKind;
  categories: string[];
  series: ChartSeries[];
  showLegend?: boolean;
  showValue?: boolean;
}

export type BackgroundMode = 'clean' | 'tint' | 'gradient' | 'deep' | 'custom';

export interface SlideBackground {
  mode: BackgroundMode;
  from?: string;
  to?: string;
  angle?: number;
}

export interface Slide {
  id: string;
  layout: LayoutId;
  name: string;
  background: SlideBackground;
  blocks: Block[];
  notes?: string;
}

export interface ThemeColors {
  bg: string; surface: string; text: string; muted: string;
  accent: string; accent2: string; onAccent: string;
}

export interface DeckTheme {
  id: string;
  name: string;
  colors: ThemeColors;
  fontTitle: string;
  fontBody: string;
  radius: number;
  dark: boolean;
}

export type FontKey = 'sans' | 'serif' | 'rounded' | 'mono';

export interface Deck {
  id: string;
  title: string;
  themeId: string;
  fontKey: FontKey;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

export interface SlideSpec {
  layout: LayoutId;
  name?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  paragraph?: string;
  quote?: { text: string; author?: string };
  stats?: StatItem[];
  steps?: StepItem[];
  columns?: { title: string; items: string[] }[];
  graphic?: GraphicKind;
  background?: BackgroundMode;
  notes?: string;
  /** 表格内容 */
  table?: { headers: string[]; rows: string[][] };
  /** 图表内容 */
  chart?: { kind: ChartKind; categories: string[]; series: ChartSeries[]; title?: string };
  /** 多图页（图文混排） */
  images?: { caption?: string }[];
}

export interface GenerateOptions {
  topic: string;
  depth: 'brief' | 'standard' | 'detailed';
  tone: 'professional' | 'minimal' | 'energetic';
  language: 'zh' | 'en' | 'auto';
  withNotes: boolean;
}
