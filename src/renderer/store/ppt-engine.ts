import type { GenerateOptions, GraphicKind, SlideSpec } from '../types/ppt';

const GRAPHIC_CYCLE: GraphicKind[] = ['orbit', 'nodes', 'bars', 'rings', 'ladder', 'grid', 'abstract', 'wave'];

const SCENE_TEMPLATES: Record<string, { layouts: SlideSpec[] }> = {
  report: {
    layouts: [
      { layout: 'cover', eyebrow: '工作汇报', title: '{topic}', subtitle: '汇报人：AI助手 | {date}', background: 'gradient' },
      { layout: 'agenda', title: '目录', bullets: ['工作回顾', '核心成果', '问题分析', '下一步计划'] },
      { layout: 'stats', title: '核心数据', stats: [{ value: '98%', label: '完成率' }, { value: '+32%', label: '同比增长' }, { value: '15', label: '重点项目' }] },
      { layout: 'bullets', title: '工作回顾', bullets: ['完成项目交付 12 项', '优化核心流程 5 个', '团队协作效率提升 40%'] },
      { layout: 'compare', title: '成果对比', columns: [{ title: '上季度', items: ['收入 100万', '客户 50家'] }, { title: '本季度', items: ['收入 132万', '客户 68家'] }] },
      { layout: 'timeline', title: '下一步计划', steps: [{ title: '第一阶段', desc: '需求梳理与立项' }, { title: '第二阶段', desc: '研发实施' }, { title: '第三阶段', desc: '测试上线' }] },
      { layout: 'closing', title: '感谢聆听', subtitle: 'Q & A', background: 'deep' },
    ],
  },
  plan: {
    layouts: [
      { layout: 'cover', eyebrow: '方案策划', title: '{topic}', subtitle: '—— 从构想到落地的完整路径', background: 'gradient' },
      { layout: 'agenda', title: '方案概览', bullets: ['背景分析', '目标设定', '实施路径', '资源预算'] },
      { layout: 'bullets', title: '背景分析', bullets: ['市场趋势与机会', '当前痛点与挑战', '竞品对比分析'] },
      { layout: 'stats', title: '目标设定', stats: [{ value: '6个月', label: '落地周期' }, { value: '50万', label: '预算投入' }, { value: '3倍', label: '预期 ROI' }] },
      { layout: 'timeline', title: '实施路径', steps: [{ title: '调研', desc: '需求确认' }, { title: '设计', desc: '方案输出' }, { title: '执行', desc: '落地推进' }, { title: '复盘', desc: '效果评估' }] },
      { layout: 'twoColumn', title: '资源与预算', columns: [{ title: '人力资源', items: ['产品 1 人', '研发 3 人', '设计 1 人'] }, { title: '资金预算', items: ['研发 30万', '运营 15万', '预留 5万'] }] },
      { layout: 'closing', title: '携手共进', subtitle: '期待合作', background: 'deep' },
    ],
  },
  education: {
    layouts: [
      { layout: 'cover', eyebrow: '教育培训', title: '{topic}', subtitle: '讲师：AI 助手', background: 'gradient' },
      { layout: 'agenda', title: '课程大纲', bullets: ['基础概念', '核心原理', '实践案例', '总结练习'] },
      { layout: 'bullets', title: '基础概念', bullets: ['什么是核心概念', '为什么需要掌握', '应用场景概览'] },
      { layout: 'imageText', title: '核心原理', bullets: ['原理一：深入浅出', '原理二：举一反三', '原理三：融会贯通'] },
      { layout: 'stats', title: '学习收益', stats: [{ value: '80%+', label: '学员满意度' }, { value: '20+', label: '实战案例' }, { value: '3年', label: '经验沉淀' }] },
      { layout: 'quote', quote: { text: '授人以鱼不如授人以渔', author: 'AI 助手' } },
      { layout: 'closing', title: '学以致用', subtitle: '实践出真知', background: 'deep' },
    ],
  },
  pitch: {
    layouts: [
      { layout: 'cover', eyebrow: '商业计划', title: '{topic}', subtitle: '—— 连接现在与未来', background: 'gradient' },
      { layout: 'agenda', title: '商业计划', bullets: ['市场机会', '解决方案', '商业模式', '团队介绍'] },
      { layout: 'stats', title: '市场机会', stats: [{ value: '千亿级', label: '市场规模' }, { value: '+25%', label: '年增长率' }, { value: '蓝海', label: '竞争格局' }] },
      { layout: 'bullets', title: '解决方案', bullets: ['痛点精准识别', '产品差异化定位', '技术壁垒构建'] },
      { layout: 'compare', title: '竞争优势', columns: [{ title: '传统方案', items: ['成本高', '效率低', '扩展性差'] }, { title: '我们的方案', items: ['成本降低 60%', '效率提升 3 倍', '弹性扩展'] }] },
      { layout: 'timeline', title: '发展路线', steps: [{ title: '种子期', desc: '产品验证' }, { title: 'A轮', desc: '市场拓展' }, { title: 'B轮', desc: '规模扩张' }, { title: '战略', desc: '行业领先' }] },
      { layout: 'closing', title: '期待同行', subtitle: '携手共创未来', background: 'deep' },
    ],
  },
  product: {
    layouts: [
      { layout: 'cover', eyebrow: '产品介绍', title: '{topic}', subtitle: '让科技改变生活', background: 'gradient' },
      { layout: 'agenda', title: '产品概览', bullets: ['产品定位', '核心功能', '用户场景', '未来规划'] },
      { layout: 'stats', title: '产品数据', stats: [{ value: '100万+', label: '注册用户' }, { value: '4.9', label: '用户评分' }, { value: '99.9%', label: '稳定性' }] },
      { layout: 'bullets', title: '核心功能', bullets: ['智能识别 · 秒级响应', '个性推荐 · 懂你所需', '云端同步 · 随时随地'] },
      { layout: 'imageText', title: '用户场景', bullets: ['场景一：高效办公', '场景二：学习提升', '场景三：生活娱乐'] },
      { layout: 'timeline', title: '未来规划', steps: [{ title: 'Q1', desc: '功能完善' }, { title: 'Q2', desc: '体验优化' }, { title: 'Q3', desc: '生态扩展' }, { title: 'Q4', desc: '商业变现' }] },
      { layout: 'closing', title: '开启新体验', subtitle: '立即下载', background: 'deep' },
    ],
  },
};

const DEFAULT_TEMPLATE = SCENE_TEMPLATES.report;

function detectScene(topic: string): string {
  const t = topic.toLowerCase();
  if (t.includes('汇报') || t.includes('总结') || t.includes('review') || t.includes('季度') || t.includes('年度')) return 'report';
  if (t.includes('方案') || t.includes('策划') || t.includes('plan') || t.includes('规划')) return 'plan';
  if (t.includes('培训') || t.includes('教育') || t.includes('课程') || t.includes('教学') || t.includes('分享')) return 'education';
  if (t.includes('融资') || t.includes('商业') || t.includes('BP') || t.includes('pitch') || t.includes('路演')) return 'pitch';
  if (t.includes('产品') || t.includes('发布') || t.includes('介绍') || t.includes('product')) return 'product';
  return 'report';
}

function fillTemplate(spec: SlideSpec, opts: GenerateOptions): SlideSpec {
  const today = new Date().toLocaleDateString('zh-CN');
  const fill = (s: string) => s.replace('{topic}', opts.topic).replace('{date}', today);
  const filled: SlideSpec = { ...spec };
  filled.name = spec.name ? fill(spec.name) : undefined;
  filled.title = spec.title ? fill(spec.title) : opts.topic;
  filled.subtitle = spec.subtitle ? fill(spec.subtitle) : undefined;
  filled.eyebrow = spec.eyebrow ? fill(spec.eyebrow) : undefined;
  if (spec.bullets) filled.bullets = spec.bullets.map(fill);
  if (spec.paragraph) filled.paragraph = fill(spec.paragraph);
  if (spec.quote) filled.quote = { text: fill(spec.quote.text), author: spec.quote.author };
  if (spec.steps) filled.steps = spec.steps.map((s) => ({ title: fill(s.title), desc: s.desc ? fill(s.desc) : undefined }));
  if (spec.columns) filled.columns = spec.columns.map((c) => ({ title: fill(c.title), items: c.items.map(fill) }));
  filled.graphic = GRAPHIC_CYCLE[Math.floor(Math.random() * GRAPHIC_CYCLE.length)];
  filled.background = spec.background;
  filled.notes = opts.withNotes ? `第 ${Math.floor(Math.random() * 10)} 页讲解要点` : '';
  return filled;
}

export function localGenerate(opts: GenerateOptions): SlideSpec[] {
  const scene = detectScene(opts.topic);
  const template = SCENE_TEMPLATES[scene] || DEFAULT_TEMPLATE;
  let specs = template.layouts;

  if (opts.depth === 'brief') {
    specs = [specs[0], specs[1], specs[2], specs[specs.length - 2], specs[specs.length - 1]];
  } else if (opts.depth === 'detailed') {
    const extras: SlideSpec[] = [
      { layout: 'quote', quote: { text: '成功的关键在于持续学习与迭代', author: '行业洞察' } },
      { layout: 'bullets', title: '补充说明', bullets: ['可根据实际情况调整', '重点数据需二次确认', '建议配合口头讲解'] },
    ];
    specs = [...specs, ...extras];
  }

  return specs.map((s, i) => fillTemplate({ ...s }, opts));
}
