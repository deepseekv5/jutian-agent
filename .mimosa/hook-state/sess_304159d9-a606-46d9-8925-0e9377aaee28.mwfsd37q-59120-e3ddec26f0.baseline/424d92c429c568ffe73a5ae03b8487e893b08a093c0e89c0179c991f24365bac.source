import { describe, it, expect } from 'vitest'
import { checkBlockingCommand, blockingMessage } from '../src/shared/shellGuard'

// 阻塞命令预检（v13.11）：模型误调交互式命令会白等 180 秒超时。
// 保守原则：确定会阻塞才拦，已做后台/超时/自动确认处理的命令一律放行。

describe('checkBlockingCommand 拦截', () => {
  const blocking: [string, string][] = [
    ['vim README.md', 'editor'],
    ['nano a.txt', 'editor'],
    ['less /var/log/syslog', 'editor'],
    ['python', 'repl'],
    ['python3', 'repl'],
    ['node', 'repl'],
    ['tail -f app.log', 'follower'],
    ['watch -n 1 date', 'follower'],
    ['npm run dev', 'server'],
    ['npm start', 'server'],
    ['vite', 'server'],
    ['uvicorn app:app', 'server'],
    ['ssh myserver', 'ssh'],
  ]
  for (const [cmd, kind] of blocking) {
    it(`拦截：${cmd}`, () => {
      const r = checkBlockingCommand(cmd)
      expect(r.blocked, cmd).toBe(true)
      expect(r.kind).toBe(kind)
      expect(r.hint && r.hint.length).toBeTruthy()
    })
  }
})

describe('checkBlockingCommand 放行', () => {
  const allowed = [
    'ls -la',
    'npm run build',
    'npm test',
    'git status',
    'cat file.txt',
    'tail -n 100 app.log',
    'python script.py',
    'python -c "print(1)"',
    'node script.js',
    'npm run dev > /tmp/dev.log 2>&1 &',
    'timeout 10 npm start',
    'apt-get install -y curl',
    'ssh host "uptime"',
    '',
  ]
  for (const cmd of allowed) {
    it(`放行：${cmd || '(空)'}`, () => {
      expect(checkBlockingCommand(cmd).blocked, cmd).toBe(false)
    })
  }
})

describe('blockingMessage', () => {
  it('包含阻塞原因与改法', () => {
    const r = checkBlockingCommand('npm run dev')
    const msg = blockingMessage(r)
    expect(msg).toContain('阻塞')
    expect(msg).toContain('后台')
  })
})
