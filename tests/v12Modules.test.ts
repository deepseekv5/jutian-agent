import { describe, it, expect } from 'vitest'
import { PROMPT_TEMPLATES, fillTemplate, missingVars, searchTemplates, findTemplate } from '../src/shared/promptTemplates'
import { normalizeTag, addTag, removeTag, togglePin, emptyMeta, sortSessions, filterByTags, tagCloud, makeBookmark, searchBookmarks, TAG_LIMIT_PER_SESSION } from '../src/shared/sessionMeta'
import { snippetVars, fillSnippet, matchTrigger, searchSnippets, makeSnippet, validateTrigger } from '../src/shared/snippets'
import { inferCapability, recommendModels, pickDefaultModel, resolvePrice, estimateCost, summarize, dailySeries, budgetState, formatUSD, formatTokens, MODEL_PRICES } from '../src/shared/usageCost'
import { tokenize, scoreDoc, highlight, excerpt, searchDocs, suggestQueries } from '../src/shared/searchIndex'
import { parseCombo, matchesCombo, formatCombo, findConflicts, shouldIgnoreInInput, DEFAULT_BINDINGS } from '../src/shared/shortcuts'
import { enqueue, dequeue, readyItems, backoffItem, pruneQueue, queueSummary, shouldPauseRetry, QUEUE_MAX } from '../src/shared/sendQueue'
import { pasteDisposition, pastedFileName, imageFileName, humanSize, dedupeAttachments, exceedsSizeLimit, folderWarning, PASTE_AS_FILE_THRESHOLD } from '../src/shared/attachments'
import { overallStatus, checkApiConfig, checkWorkDir, checkNodeVersion, checkStorage, checkServer, buildReport, reportToMarkdown } from '../src/shared/diagnostics'
import { buildPlan, verifyBackup, prunableBackups, backupFileName, sizeWarning, DEFAULT_SCOPES } from '../src/shared/backupPlan'
import { filterMessages, collectStats, buildMultiExport, exportFileName } from '../src/shared/exportSessions'

describe('promptTemplates', () => {
  it('模板 id 唯一', () => {
    const ids = PROMPT_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('每个模板的 vars 都在 body 里出现', () => {
    for (const t of PROMPT_TEMPLATES) {
      for (const v of t.vars) expect(t.body).toContain(`{{${v.key}}}`)
    }
  })
  it('填充只替换已知变量，未知保留', () => {
    expect(fillTemplate('a {{x}} b {{y}}', { x: '1' })).toBe('a 1 b {{y}}')
  })
  it('空值不替换（避免出现空档）', () => {
    expect(fillTemplate('a {{x}}', { x: '   ' })).toBe('a {{x}}')
  })
  it('missingVars 报告未填项', () => {
    const tpl = PROMPT_TEMPLATES[0]
    expect(missingVars(tpl, {}).length).toBe(tpl.vars.length)
  })
  it('搜索可按名称与描述命中', () => {
    expect(searchTemplates('周报').length).toBeGreaterThan(0)
    expect(searchTemplates('zzz-nothing').length).toBe(0)
  })
})

describe('sessionMeta', () => {
  it('标签规范化：去 #、小写、限长', () => {
    expect(normalizeTag('  #Work  ')).toBe('work')
    expect(normalizeTag('a'.repeat(50)).length).toBeLessThanOrEqual(16)
    expect(normalizeTag('')).toBe('')
  })
  it('重复标签不重复添加', () => {
    const m = addTag(addTag(emptyMeta('s'), '工作'), '工作')
    expect(m.tags).toEqual(['工作'])
  })
  it('标签数量有上限', () => {
    let m = emptyMeta('s')
    for (let i = 0; i < 20; i++) m = addTag(m, `t${i}`)
    expect(m.tags.length).toBe(TAG_LIMIT_PER_SESSION)
  })
  it('删除标签', () => {
    expect(removeTag(addTag(emptyMeta('s'), 'x'), 'x').tags).toEqual([])
  })
  it('置顶可切换', () => {
    const m = togglePin(emptyMeta('s'), 1000)
    expect(m.pinnedAt).toBe(1000)
    expect(togglePin(m).pinnedAt).toBeUndefined()
  })
  it('排序：置顶优先，其内按更新时间', () => {
    const sessions = [
      { id: 'a', updated_at: 100 },
      { id: 'b', updated_at: 300 },
      { id: 'c', updated_at: 200 },
    ]
    const metas = new Map([['c', { id: 'c', tags: [], pinnedAt: 50 }]])
    const out = sortSessions(sessions, (id) => metas.get(id))
    expect(out.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })
  it('归档默认不出现', () => {
    const sessions = [{ id: 'a' }, { id: 'b' }]
    const metas = new Map([['b', { id: 'b', tags: [], archived: true }]])
    expect(sortSessions(sessions, (id) => metas.get(id)).map((s) => s.id)).toEqual(['a'])
    expect(sortSessions(sessions, (id) => metas.get(id), { includeArchived: true }).length).toBe(2)
  })
  it('按标签筛选是 AND 语义', () => {
    const sessions = [{ id: 'a' }, { id: 'b' }]
    const metas = new Map([
      ['a', { id: 'a', tags: ['x', 'y'] }],
      ['b', { id: 'b', tags: ['x'] }],
    ])
    expect(filterByTags(sessions, (id) => metas.get(id), ['x', 'y']).map((s) => s.id)).toEqual(['a'])
    expect(filterByTags(sessions, (id) => metas.get(id), []).length).toBe(2)
  })
  it('标签云按次数排序', () => {
    const cloud = tagCloud([
      { id: 'a', tags: ['x', 'y'] },
      { id: 'b', tags: ['x'] },
    ])
    expect(cloud[0]).toEqual({ tag: 'x', count: 2 })
  })
  it('书签摘录会剥离代码块并截断', () => {
    const bm = makeBookmark('s', 'm', '前文 ```const a=1``` 后文' + 'x'.repeat(200))
    expect(bm.excerpt).toContain('[代码]')
    expect(bm.excerpt.length).toBeLessThanOrEqual(121)
  })
  it('书签搜索命中摘录', () => {
    const bm = makeBookmark('s', 'm', '部署脚本在这里')
    expect(searchBookmarks([bm], '部署').length).toBe(1)
    expect(searchBookmarks([bm], '不存在').length).toBe(0)
  })
})

describe('snippets', () => {
  it('解析变量名去重保序', () => {
    expect(snippetVars('{{b}} {{a}} {{b}}')).toEqual(['b', 'a'])
  })
  it('填充变量', () => {
    expect(fillSnippet('x {{a}}', { a: '1' })).toBe('x 1')
  })
  it('触发前缀只在整词匹配时生效', () => {
    const sn = makeSnippet('日志', 'console.log()', { trigger: 'log' })
    expect(matchTrigger('log', [sn])?.snippet.id).toBe(sn.id)
    expect(matchTrigger('log 内容', [sn])?.rest).toBe('内容')
    expect(matchTrigger('logger', [sn])).toBeNull()   // 不该误触发
    expect(matchTrigger('xlog ', [sn])).toBeNull()
  })
  it('触发器校验：非法字符与重复', () => {
    const a = makeSnippet('A', '', { trigger: 'abc' })
    expect(validateTrigger('中文', [a])).toContain('字母')
    expect(validateTrigger('ABC', [a])).toContain('已被')
    expect(validateTrigger('abc', [a], a.id)).toBeNull()  // 自己不算冲突
    expect(validateTrigger('', [a])).toBeNull()
  })
  it('搜索按使用次数排序', () => {
    const a = makeSnippet('A', 'a'); a.uses = 1
    const b = makeSnippet('B', 'b'); b.uses = 9
    expect(searchSnippets([a, b], '')[0].id).toBe(b.id)
  })
})

describe('usageCost', () => {
  it('定价宽松匹配：日期后缀/前缀', () => {
    expect(resolvePrice('gpt-4o-2024-08-06')).toBe(MODEL_PRICES['gpt-4o'])
    expect(resolvePrice('claude-sonnet-4-5')).toBeTruthy()
    expect(resolvePrice('unknown-model-xyz')).toBeUndefined()
  })
  it('未定价模型不编价格', () => {
    expect(estimateCost({ model: 'unknown', promptTokens: 1000, completionTokens: 1000 })).toBeUndefined()
    expect(summarize([{ ts: 0, model: 'unknown', promptTokens: 10, completionTokens: 10 }]).unpriced).toBe(1)
  })
  it('供应商给的金额优先', () => {
    expect(estimateCost({ model: 'gpt-4o', promptTokens: 1e6, completionTokens: 0, costUSD: 0.5 })).toBe(0.5)
  })
  it('成本按 token 折算', () => {
    const c = estimateCost({ model: 'gpt-4o', promptTokens: 1e6, completionTokens: 1e6 })
    expect(c).toBeCloseTo(2.5 + 10, 5)
  })
  it('汇总按模型分组并排序', () => {
    const s = summarize([
      { ts: 0, model: 'gpt-4o', promptTokens: 100, completionTokens: 100 },
      { ts: 0, model: 'gpt-4o-mini', promptTokens: 10, completionTokens: 10 },
      { ts: 0, model: 'gpt-4o', promptTokens: 100, completionTokens: 100 },
    ])
    expect(s.requests).toBe(3)
    expect(s.byModel[0].model).toBe('gpt-4o')
    expect(s.byModel[0].requests).toBe(2)
  })
  it('日序列长度固定且末日是今天', () => {
    const now = new Date('2026-10-18T12:00:00').getTime()
    const s = dailySeries([{ ts: now, model: 'gpt-4o', promptTokens: 100, completionTokens: 0 }], 7, now)
    expect(s.length).toBe(7)
    expect(s[6].tokens).toBe(100)
    expect(s[0].tokens).toBe(0)
  })
  it('预算判断', () => {
    expect(budgetState(5, 0).over).toBe(false)
    expect(budgetState(5, 10).pct).toBe(50)
    expect(budgetState(10, 10).over).toBe(true)
  })
  it('格式化', () => {
    expect(formatUSD(0)).toBe('$0.00')
    expect(formatUSD(0.001)).toBe('$0.0010')
    expect(formatTokens(1500)).toBe('1.5K')
    expect(formatTokens(2_500_000)).toBe('2.50M')
  })
})

describe('searchIndex', () => {
  it('中文按字切、英文按词切', () => {
    const t = tokenize('部署 deploy')
    expect(t).toContain('部署')
    expect(t).toContain('部')
    expect(t).toContain('deploy')
  })
  it('AND 语义：任一 token 未命中则 0 分', () => {
    const doc = { id: '1', title: '部署脚本', body: '如何部署到服务器' }
    expect(scoreDoc(doc, tokenize('部署'))).toBeGreaterThan(0)
    expect(scoreDoc(doc, tokenize('部署 zzz'))).toBe(0)
  })
  it('标题命中权重高于正文', () => {
    const inTitle = { id: '1', title: '部署', body: 'x' }
    const inBody = { id: '2', title: 'x', body: '部署' }
    expect(scoreDoc(inTitle, ['部署'])).toBeGreaterThan(scoreDoc(inBody, ['部署']))
  })
  it('高亮切分正确且拼回原文', () => {
    const parts = highlight('abc部署def', ['部署'])
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['部署'])
    expect(parts.map((p) => p.text).join('')).toBe('abc部署def')
  })
  it('高亮重叠区间合并', () => {
    const parts = highlight('abcd', ['ab', 'bc'])
    expect(parts.map((p) => p.text).join('')).toBe('abcd')
    expect(parts.filter((p) => p.hit).length).toBe(1) // ab+bc 合成 abc
  })
  it('摘要带省略号并包含命中词', () => {
    const parts = excerpt('前'.repeat(100) + '目标词' + '后'.repeat(100), ['目标词'], 10)
    const text = parts.map((p) => p.text).join('')
    expect(text).toContain('目标词')
    expect(text).toContain('…')
  })
  it('搜索按分数排序并限制数量', () => {
    const docs = [
      { id: '1', title: '别的', body: '部署' },
      { id: '2', title: '部署指南', body: '部署步骤' },
      { id: '3', title: '无关', body: 'zzz' },
    ]
    const r = searchDocs(docs, '部署', 10)
    expect(r[0].doc.id).toBe('2')
    expect(r.length).toBe(2)
    expect(searchDocs(docs, '部署', 1).length).toBe(1)
  })
  it('空查询不返回任何结果', () => {
    expect(searchDocs([{ id: '1', title: 'a', body: 'b' }], '  ')).toEqual([])
  })
  it('查询建议去重并排除自身', () => {
    expect(suggestQueries(['部署脚本', '部署', '其他'], '部署')).toEqual(['部署脚本'])
  })
})

describe('shortcuts', () => {
  it('解析 mod+k', () => {
    const p = parseCombo('mod+k')!
    expect(p.mod).toBe(true)
    expect(p.key).toBe('k')
  })
  it('非法组合返回 null', () => {
    expect(parseCombo('')).toBeNull()
    expect(parseCombo('a+b')).toBeNull()  // 两个非修饰键
  })
  it('mod 在 mac 认 meta、在 win 认 ctrl', () => {
    const p = parseCombo('mod+k')!
    expect(matchesCombo({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, p, true)).toBe(true)
    expect(matchesCombo({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, p, false)).toBe(true)
    // 交叉不应误判
    expect(matchesCombo({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, p, true)).toBe(false)
  })
  it('shift 必须精确匹配', () => {
    const p = parseCombo('mod+shift+p')!
    expect(matchesCombo({ key: 'p', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, p, true)).toBe(true)
    expect(matchesCombo({ key: 'p', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, p, true)).toBe(false)
  })
  it('平台化展示', () => {
    expect(formatCombo('mod+k', true)).toBe('⌘K')
    expect(formatCombo('mod+k', false)).toBe('Ctrl+K')
    expect(formatCombo('mod+shift+p', false)).toBe('Ctrl+Shift+P')
  })
  it('默认快捷键表自身无冲突', () => {
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([])
  })
  it('能检出冲突', () => {
    const c = findConflicts([
      { id: 'a', combo: 'mod+k', label: 'A' },
      { id: 'b', combo: 'mod+k', label: 'B' },
    ])
    expect(c.length).toBe(1)
    expect(c[0].ids.sort()).toEqual(['a', 'b'])
  })
  it('输入框内的纯字母键应跳过', () => {
    expect(shouldIgnoreInInput('a')).toBe(true)
    expect(shouldIgnoreInInput('space')).toBe(true)
    expect(shouldIgnoreInInput('mod+s')).toBe(false)
    expect(shouldIgnoreInInput('mod+shift+v')).toBe(false)
  })
})

describe('sendQueue', () => {
  const mk = (id: string, at = 0) => ({ id, sessionId: 's', content: 'c', createdAt: at })

  it('入队与出队', () => {
    let q = enqueue([], mk('1'))
    expect(q.length).toBe(1)
    q = dequeue(q, '1')
    expect(q.length).toBe(0)
  })
  it('超上限时丢最旧的', () => {
    let q: any[] = []
    for (let i = 0; i < QUEUE_MAX + 5; i++) q = enqueue(q, mk(String(i)))
    expect(q.length).toBe(QUEUE_MAX)
    expect(q[q.length - 1].id).toBe(String(QUEUE_MAX + 4))  // 最新保留
  })
  it('就绪项按创建时间 FIFO', () => {
    const q = enqueue(enqueue([], mk('b', 200)), mk('a', 100))
    expect(readyItems(q, 1000).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('退避后未到时间不重试', () => {
    const item = backoffItem(enqueue([], mk('1'))[0], 'err', 1000)
    expect(item.attempts).toBe(1)
    expect(item.nextAt).toBeGreaterThan(1000)
    expect(readyItems([item], 1000).length).toBe(0)
  })
  it('多次失败后标记为卡住', () => {
    let item = enqueue([], mk('1'))[0]
    for (let i = 0; i < 5; i++) item = backoffItem(item, 'e', 1000)
    expect(item.nextAt).toBe(Number.MAX_SAFE_INTEGER)
    expect(queueSummary([item]).stuck).toBe(1)
  })
  it('过期项被清理', () => {
    const old = enqueue([], { ...mk('1'), createdAt: 0 })
    expect(pruneQueue(old, 25 * 3600 * 1000).length).toBe(0)
  })
  it('连续失败时暂停自动重试', () => {
    let q: any[] = []
    for (let i = 0; i < 3; i++) {
      const it = enqueue([], mk(String(i)))[0]
      q.push({ ...it, attempts: 3, nextAt: 1000 })
    }
    expect(shouldPauseRetry(q)).toBe(true)
    expect(shouldPauseRetry([])).toBe(false)
  })
})

describe('attachments', () => {
  it('短文本内联、超长转文件', () => {
    expect(pasteDisposition(10)).toBe('inline')
    expect(pasteDisposition(PASTE_AS_FILE_THRESHOLD + 1)).toBe('file')
  })
  it('图片一律转附件', () => {
    expect(pasteDisposition(10, 'image/png')).toBe('file')
  })
  it('粘贴文件名取首行并清洗非法字符', () => {
    const n = pastedFileName('a/b:c\n第二行')
    expect(n).toMatch(/^a-b-c-\d+\.txt$/)
  })
  it('图片文件名扩展名归一', () => {
    expect(imageFileName('image/jpeg')).toMatch(/\.jpg$/)
    expect(imageFileName('image/png')).toMatch(/\.png$/)
  })
  it('体积格式化', () => {
    expect(humanSize(500)).toBe('500 B')
    expect(humanSize(2048)).toBe('2.0 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('附件按路径去重', () => {
    const out = dedupeAttachments([
      { path: '/a/x.ts', name: 'x.ts' },
      { path: '/a/X.ts', name: 'X.ts' },   // 大小写不同视为同一个（Windows 语义）
      { path: '/a/y.ts', name: 'y.ts' },
    ])
    expect(out.length).toBe(2)
  })
  it('体积超限检测', () => {
    expect(exceedsSizeLimit([{ size: 30 * 1024 * 1024 }])).toBe(true)
    expect(exceedsSizeLimit([{ size: 1024 }])).toBe(false)
  })
  it('文件夹告警', () => {
    expect(folderWarning(0)).toContain('空')
    expect(folderWarning(500)).toContain('上限')
    expect(folderWarning(10)).toBeNull()
  })
})

describe('diagnostics', () => {
  it('总体状态取最严重的', () => {
    expect(overallStatus([{ id: 'a', name: '', status: 'pass', message: '' }])).toBe('pass')
    expect(overallStatus([
      { id: 'a', name: '', status: 'pass', message: '' },
      { id: 'b', name: '', status: 'warn', message: '' },
    ])).toBe('warn')
    expect(overallStatus([{ id: 'c', name: '', status: 'fail', message: '' }])).toBe('fail')
  })
  it('API 配置检查：缺地址为失败、缺密钥为警告', () => {
    expect(checkApiConfig({}).status).toBe('fail')
    expect(checkApiConfig({ apiBaseUrl: 'ftp://x' }).status).toBe('fail')
    expect(checkApiConfig({ apiBaseUrl: 'https://a.com/v1' }).status).toBe('warn')
    expect(checkApiConfig({ apiBaseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm' }).status).toBe('pass')
  })
  it('工作目录不存在判失败', () => {
    expect(checkWorkDir('', false).status).toBe('warn')
    expect(checkWorkDir('/x', false).status).toBe('fail')
    expect(checkWorkDir('/x', true).status).toBe('pass')
  })
  it('Node 版本门槛', () => {
    expect(checkNodeVersion('v16.0.0').status).toBe('fail')
    expect(checkNodeVersion('v18.1.0').status).toBe('warn')
    expect(checkNodeVersion('v20.0.0').status).toBe('pass')
    expect(checkNodeVersion('unknown').status).toBe('skip')
  })
  it('存储降级给警告', () => {
    expect(checkStorage(false).status).toBe('warn')
    expect(checkStorage(true).status).toBe('pass')
  })
  it('服务不可达判失败', () => {
    expect(checkServer(false).status).toBe('fail')
    expect(checkServer(true, '12.0.0').message).toContain('12.0.0')
  })
  it('报告可序列化为 Markdown 且含建议', () => {
    const rep = buildReport({
      version: '12.0.0',
      platform: 'darwin',
      results: [checkApiConfig({}), checkServer(false)],
    })
    expect(rep.overall).toBe('fail')
    const md = reportToMarkdown(rep)
    expect(md).toContain('环境诊断报告')
    expect(md).toContain('建议')
    expect(md).toContain('12.0.0')
  })
})

describe('backupPlan', () => {
  const items = [
    { scope: 'settings' as const, path: 'settings.json', bytes: 100 },
    { scope: 'sessions' as const, path: 'db.sqlite', bytes: 2000 },
    { scope: 'skills' as const, path: 'skills/a.md', bytes: 300 },
  ]
  it('按范围筛选并合计体积', () => {
    const p = buildPlan(items, ['settings', 'sessions'])
    expect(p.items.length).toBe(2)
    expect(p.totalBytes).toBe(2100)
  })
  it('永远声明不含密钥', () => {
    expect(buildPlan(items).includesSecrets).toBe(false)
  })
  it('默认范围覆盖五项', () => {
    expect(DEFAULT_SCOPES.length).toBe(5)
  })
  it('空备份必须校验失败', () => {
    expect(verifyBackup(null, []).ok).toBe(false)
    expect(verifyBackup({ version: '1', createdAt: 'x', platform: 'p', appVersion: 'v', counts: {}, totalBytes: 0 }, []).ok).toBe(false)
  })
  it('正常备份校验通过', () => {
    const m = { version: '1', createdAt: '2026-10-18', platform: 'darwin', appVersion: '12.0.0', counts: { sessions: 3 }, totalBytes: 100 }
    expect(verifyBackup(m, ['a', 'b']).ok).toBe(true)
  })
  it('保留策略：同日只留一份 + 总数上限', () => {
    const list = [
      { name: 'a.zip', createdAt: '2026-10-18T10:00:00Z' },
      { name: 'b.zip', createdAt: '2026-10-18T09:00:00Z' },  // 同日，删
      { name: 'c.zip', createdAt: '2026-10-17T10:00:00Z' },
      { name: 'd.zip', createdAt: '2026-10-16T10:00:00Z' },
    ]
    // 顺序不属于契约，只看集合
    expect(new Set(prunableBackups(list, 2))).toEqual(new Set(['b.zip', 'd.zip']))
  })
  it('文件名带版本平台时间', () => {
    expect(backupFileName('12.0.0', 'win32', new Date('2026-10-18T05:06:00'))).toBe('jutian-backup-12.0.0-win32-20261018-0506.zip')
  })
  it('体积提示阈值', () => {
    expect(sizeWarning(10)).toBeNull()
    // 100MB~500MB 区间：提示耗时
    expect(sizeWarning(200 * 1024 * 1024)).toContain('十几秒')
    // >500MB：建议缩小范围
    expect(sizeWarning(800 * 1024 * 1024)).toContain('只选需要的范围')
  })
})

describe('exportSessions', () => {
  const msgs = [
    { role: 'user', content: '帮我写个函数', created_at: '2026-10-18T10:00:00Z' },
    { role: 'assistant', content: '好的\n```ts\nconst a=1\n```', created_at: '2026-10-18T10:01:00Z', tool_calls: [{ name: 'write_file', status: 'done' }] },
    { role: 'user', content: '谢谢', created_at: '2026-10-18T10:02:00Z' },
  ]
  it('按角色筛选', () => {
    expect(filterMessages(msgs, { roles: ['user'] }).length).toBe(2)
  })
  it('按关键词筛选（大小写不敏感）', () => {
    expect(filterMessages(msgs, { keyword: '函数' }).length).toBe(1)
  })
  it('只导含代码的消息', () => {
    expect(filterMessages(msgs, { onlyCode: true }).length).toBe(1)
  })
  it('统计工具调用与失败数', () => {
    const s = collectStats([{ id: '1', title: 't', messages: msgs }])
    expect(s.messages).toBe(3)
    expect(s.toolCalls).toBe(1)
    expect(s.failedToolCalls).toBe(0)
  })
  it('多会话导出含目录', () => {
    const md = buildMultiExport([
      { id: '1', title: '会话一', messages: msgs },
      { id: '2', title: '会话二', messages: msgs },
    ])
    expect(md).toContain('## 目录')
    expect(md).toContain('会话一')
    expect(md).toContain('会话二')
  })
  it('单会话不生成多余目录层级', () => {
    const md = buildMultiExport([{ id: '1', title: '唯一', messages: msgs }])
    expect(md).not.toContain('## 目录')
    expect(md).not.toContain('## 唯一')
  })
  it('可选包含工具与思考', () => {
    const md = buildMultiExport([{ id: '1', title: 't', messages: [{ role: 'assistant', content: 'x', thinking: '想过', tool_calls: [{ name: 'shell', status: 'error' }] }] }], { includeTools: true, includeThinking: true })
    expect(md).toContain('思考过程')
    expect(md).toContain('shell(失败)')
  })
  it('文件名清洗 Windows 非法字符', () => {
    const n = exportFileName('a/b:c*?"<>|', 'md', new Date('2026-10-18T05:06:00'))
    expect(n).not.toMatch(/[\\/:*?"<>|]/)
    expect(n).toMatch(/\.md$/)
  })
})
