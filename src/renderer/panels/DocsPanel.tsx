import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PageShell from '../app/PageShell'
import { useTheme } from '../hooks/useTheme'
import { useLanguage } from '../hooks/useLanguage'

/**
 * 应用内文档（v14.15.0）：内置精简指南，零网络依赖。
 * 覆盖：快速上手 / 模型配置 / 模式与权限 / 公文写作 / 巨天安全 / 终端版 / 快捷键 / 数据与隐私。
 */

interface Doc { id: string; title: string; titleEn: string; icon: string; body: string }

const DOCS: Doc[] = [
  {
    id: 'quickstart', title: '快速上手', titleEn: 'Quick start', icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    body: `## 三步开始

1. **配置模型** — 设置 → 推理：填任意 OpenAI 兼容服务（DeepSeek / Kimi / GLM / 本地 Ollama），点「拉取模型列表」选择；或者到「免费模型」页一键免 key 使用。
2. **选个工作目录** — 设置 → 工作区：AI 的文件读写与命令默认在这个目录里进行。
3. **开聊** — 输入框直接说话。让它写文件、跑命令、做表格、生成 PPT 都可以；高风险操作会先征求你同意。

> 首次启动的全屏求星可以随时关闭，不影响任何功能。`,
  },
  {
    id: 'modes', title: '模式与权限', titleEn: 'Modes & permissions', icon: 'M9 12l2 2 4-4',
    body: `## 输入框

- **+ 菜单**：目标模式 / 深度调研 / 计划模式 / 权限档位，以及联网、公文、画画、造技能、集群、知识库。
- **公文开关**：按党政机关公文规范（GB/T 9704）产出通知/请示/报告/批复/函/纪要。
- **⚡ 思考档位**：档位越深推理越充分（推理模型收益明显）。

## 权限三档（单次生效）

| 档位 | 行为 |
|---|---|
| 需确认 | 写文件 / 删除 / 命令先问后做 |
| 可编辑 | 自由读写与常规命令，删除前确认 |
| 完全访问 | 自主完成，不再逐步确认 |

另有常驻**办公 / 编程**双模式：办公重文档产出，编程直接动手改代码、跑验证。`,
  },
  {
    id: 'gongwen', title: '公文写作', titleEn: 'Official documents', icon: 'M6 2h9l5 5v15H6V2zm8 1.5V8h4.5',
    body: `## 党政机关公文（GB/T 9704）

打开输入框「公文」开关（或输入 /公文），AI 按规范产出：

- **文种**：通知 / 请示 / 报告 / 批复 / 函 / 纪要 / 意见 / 决定（自动判断或你指定）
- **结构**：标题 → 主送机关 → 正文（引据 / 主体 / 惯用语结尾）→ 附件说明 → 落款与成文日期
- **层次序号**：一、 → （一） → 1. → （1），不跳级
- **语言**：庄重书面语，引用文件带文号，请示一文一事

配合「导出 → HTML/PDF」可留存归档。`,
  },
  {
    id: 'security', title: '巨天安全', titleEn: 'Security shield', icon: 'M12 2l8 4v6c0 5-3.5 9-8 10',
    body: `## 三道防线（默认全开）

1. **危险命令拦截** — rm -rf 根目录、抹盘、关机（含 osascript / bash -c 变体）等毁灭性命令直接拦下；恶意命令库（反弹 shell / 挖矿 / LOLBAS 等 80+ 条）持续叠加，可在设置页「检查更新」。
2. **提示词注入扫描** — 工具输出里藏的「忽略之前的指令」等话术会被打标，模型不会照做。
3. **密钥屏蔽与占位符** — 输出里的 key 自动打码；命令里用 {{KEY}} 引用密钥，明文不进对话。

所有事件在 设置 → 安全 → 安全记录 可查。权限档位与删除确认是第二层保险。`,
  },
  {
    id: 'terminal', title: '终端版', titleEn: 'Terminal (TUI)', icon: 'M4 17l6-5-6-5M12 19h8',
    body: `## jtcode / npm run tui

在终端里获得 Claude Code 式对话：

- **工作目录 = 启动时所在的文件夹**——在哪个项目里启动就操作哪个项目
- 巨天未运行时自动拉起；会话落盘，桌面端可见
- 权限操作同样会 [y/n/a] 向你确认

\`\`\`bash
npm run tui        # 仓库内
npm link && jt     # 全局 jt 命令
jtcode             # 桌面 App 一键安装的 CLI（任意目录）
\`\`\``,
  },
  {
    id: 'shortcuts', title: '快捷键', titleEn: 'Shortcuts', icon: 'M7 11.5V14m0-2.5v6h4m-4-3h3M13 3h6v18H6V3h4m5 6H9m5 3H9m5 3H9',
    body: `## 高频快捷键

| 按键 | 作用 |
|---|---|
| Cmd/Ctrl+K | 命令面板（搜索一切操作）|
| Cmd+T | 新标签页 |
| Ctrl+Tab | 切换标签 |
| Cmd+Shift+C | 复制最后回复 |
| Cmd+Shift+R | 朗读最后回复 |
| Cmd+Shift+E | 导出对话 |
| Cmd+Shift+B | 剪贴板历史 |
| Cmd+加/减/0 | 字号 |
| / | 输入框内唤起命令（/公文 /联网 /定时 …）|

输入框内：Esc 中断输出；↑↓ 翻输入历史。`,
  },
  {
    id: 'privacy', title: '数据与隐私', titleEn: 'Data & privacy', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6',
    body: `## 本地优先

- 全部数据（会话 / 密钥 / 记忆 / 知识库）只存 **~/.lyclaw/**，删除该目录即彻底清除
- 应用无遥测、无内置模型服务；对话只发给你自己配置的模型服务
- 密钥只在本地存储，界面回显一律掩码；对外接口（本地 API / 手机远程）默认关闭，开启后带配对码门禁
- 自动备份在 设置 → 数据（每天/每周，保留 4 份）`,
  },
  {
    id: 'faq', title: '常见问题', titleEn: 'FAQ', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907',
    body: `## FAQ

**启动提示端口被占用？** 本地服务默认 3211；旧实例残留时 \`lsof -i :3211\` 找到 PID 结束，或设置 PORT 换端口。

**模型响应报 429/401？** 上游额度或密钥问题，错误会原文透传——按提示处理即可；免费车道高峰期限速。

**知识库不生效？** 设置 → 推理里配置 embedding 模型后重建索引；无向量模型时仍可用全文检索。

**想回到旧版？** Releases 页保留全部历史版本安装包，asar 热更新也可在「关于」页回退。`,
  },
]

export default function DocsPanel({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { t, lang } = useLanguage()
  const [cur, setCur] = useState(DOCS[0].id)
  const [q, setQ] = useState('')
  const doc = DOCS.find(d => d.id === cur) || DOCS[0]
  const filtered = DOCS.filter(d => !q.trim() || d.title.includes(q.trim()) || d.body.includes(q.trim()))
  return (
    <PageShell onClose={onClose} title={t('使用文档', 'Documentation')} description={t('内置指南 · 无需联网', 'Built-in guides · offline')} icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253">
      <div className="flex gap-4 h-full min-h-0">
        {/* 目录 */}
        <div className="w-52 shrink-0 space-y-1 overflow-y-auto scrollbar-thin">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('搜索文档…', 'Search docs…')}
            className="w-full px-2.5 py-1.5 rounded-lg text-[11.5px] outline-none mb-1"
            style={{ background: c.bgInput, color: c.text, border: `1px solid ${c.borderLight}` }} />
          {filtered.map(d => (
            <button key={d.id} onClick={() => setCur(d.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors"
              style={{ background: cur === d.id ? c.accentBg : 'transparent', color: cur === d.id ? c.accent : c.textSecondary }}>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={d.icon} /></svg>
              <span className="text-[12.5px] font-medium truncate">{lang === 'en' ? d.titleEn : d.title}</span>
            </button>
          ))}
        </div>
        {/* 正文 */}
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin rounded-2xl border p-5"
          style={{ borderColor: c.borderLight, background: c.surfaceCard }}>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => { try { localStorage.removeItem('lyclaw_tour_done') } catch {}; window.dispatchEvent(new CustomEvent('jutian-tour')) }}
              className="text-[11.5px] px-2.5 py-1 rounded-lg" style={{ background: c.accentBg, color: c.accent }}>
              {t('重看新手引导', 'Replay tour')}
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent('jutian-tour'))}
              className="text-[11.5px] px-2.5 py-1 rounded-lg hidden" style={{ color: c.textTertiary }} aria-hidden>
            </button>
          </div>
          <div className="prose-chat max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
