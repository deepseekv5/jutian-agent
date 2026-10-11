/**
 * 敏感操作判定测试
 *
 * 这组判据是「需要我确认」权限档的代码层强制点——此前该档只靠系统提示词
 * 让模型自觉，模型不遵守就能直接删文件。判据漏一个模式就等于少一道边界，
 * 因此逐个模式固化。
 */
import { describe, it, expect } from 'vitest'
import { checkSensitiveTool, isWriteTool } from '../src/shared/sensitiveOps'

describe('不可逆文件操作', () => {
  it('删除文件始终判为高危', () => {
    expect(checkSensitiveTool('delete_file', {})?.level).toBe('high')
  })

  it('移动文件判为高危（会覆盖目标且源路径消失）', () => {
    expect(checkSensitiveTool('move_file', {})?.level).toBe('high')
  })

  it('只读工具一律放行', () => {
    for (const name of ['read_file', 'list_dir', 'search_files', 'get_file_info', 'web_search']) {
      expect(checkSensitiveTool(name, {})).toBeNull()
    }
  })
})

describe('高危 shell 命令', () => {
  const cases: [string, string][] = [
    ['rm -rf ./build', '递归删除'],
    ['rm -fr /tmp/x', '参数顺序颠倒的递归删除'],
    ['git reset --hard HEAD~3', 'Git 破坏性操作'],
    ['git clean -fd', 'Git 清理'],
    ['git push --force origin main', '强制推送'],
    ['del /f /s /q C:\\data', 'Windows 递归删除'],
    ['DROP TABLE users', '数据库破坏性语句'],
    ['shutdown -h now', '系统级操作'],
    ['chmod -R 777 /var', '危险权限变更'],
  ]
  for (const [cmd, what] of cases) {
    it(`拦截${what}：${cmd}`, () => {
      const hit = checkSensitiveTool('shell', { command: cmd })
      expect(hit?.level).toBe('high')
    })
  }

  it('git_operation 工具的命令同样受检', () => {
    expect(checkSensitiveTool('git_operation', { command: 'reset --hard' })?.level).toBe('high')
  })

  it('普通命令放行（不能把所有 shell 都拦下，否则工具没法用）', () => {
    for (const cmd of ['ls -la', 'npm run build', 'git status', 'git commit -m "x"', 'cat a.txt']) {
      expect(checkSensitiveTool('shell', { command: cmd })).toBeNull()
    }
  })

  it('常见正常命令不被误伤（防过宽正则把工具变成不可用）', () => {
    const normal = [
      'npm test', 'npm run build:server', 'git log --oneline -5',
      'git commit -m "fix: 修复问题"', 'grep -rn "todo" src/', 'git diff HEAD~1',
      'git push origin main',      // 非 --force，应放行
      'git clean -n',              // 预演模式，无 f 参数，应放行
      'mkdir -p build/output', 'python3 -c "print(1)"',
      'curl -s https://api.example.com', 'echo "hello"',
    ]
    for (const cmd of normal) {
      expect(checkSensitiveTool('shell', { command: cmd }), `误伤: ${cmd}`).toBeNull()
    }
  })

  it('大小写与多余空格不影响判定', () => {
    expect(checkSensitiveTool('shell', { command: '  RM   -RF  ./x' })?.level).toBe('high')
  })
})

describe('清空文件内容', () => {
  it('write_file 传空内容判为需留意', () => {
    expect(checkSensitiveTool('write_file', { content: '' })?.level).toBe('warn')
  })

  it('write_file 有内容时放行（用户让它改代码就是要写）', () => {
    expect(checkSensitiveTool('write_file', { content: 'hello' })).toBeNull()
  })
})

describe('输入健壮性', () => {
  it('缺 name 返回 null', () => {
    expect(checkSensitiveTool(undefined, {})).toBeNull()
  })

  it('args 为 null/非对象不抛错', () => {
    expect(() => checkSensitiveTool('shell', null)).not.toThrow()
    expect(() => checkSensitiveTool('shell', 'not-an-object')).not.toThrow()
    expect(() => checkSensitiveTool('write_file', undefined)).not.toThrow()
  })

  it('shell 缺 command 字段不抛错且放行', () => {
    expect(checkSensitiveTool('shell', {})).toBeNull()
  })
})

describe('isWriteTool', () => {
  it('写类工具识别正确', () => {
    for (const n of ['write_file', 'edit_file', 'delete_file', 'shell', 'install_skill']) {
      expect(isWriteTool(n)).toBe(true)
    }
  })

  it('只读工具不误判', () => {
    for (const n of ['read_file', 'list_dir', 'web_search', 'recall']) {
      expect(isWriteTool(n)).toBe(false)
    }
  })

  it('undefined 返回 false', () => {
    expect(isWriteTool(undefined)).toBe(false)
  })
})
