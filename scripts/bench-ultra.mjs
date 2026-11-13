// 内核热路径基准：新实现 vs 旧实现
const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/g
function estNew(text){ if(!text) return 0; CJK_RE.lastIndex=0; const c=(text.match(CJK_RE)||[]).length; return Math.ceil(c+(text.length-c)/4) }
function estOld(text){ if(!text) return 0; let c=0; for(const ch of text){const cp=ch.codePointAt(0); if((cp>=0x3000&&cp<=0x9fff)||(cp>=0xff00&&cp<=0xffef))c++} return Math.ceil(c+(text.length-c)/4) }
function estMsgs(msgs, fn){ return msgs.reduce((s,m)=>s+fn(m.content||''),0) }
function trimNew(msgs, budget, est){ const out=[...msgs]; let total=est(out); if(total<=budget) return {messages:out,dropped:0}; let d=0; let i=0; while(i<out.length&&out[i].role==='system')i++; while(out.length>1&&total>budget&&i<out.length){ total-=est([out[i]]); out.splice(i,1); d++ } return {messages:out,dropped:d} }
function trimOld(msgs, budget, est){ const out=[...msgs]; let d=0; while(out.length>1&&est(out)>budget){ let i=0; while(i<out.length&&out[i].role==='system')i++; if(i>=out.length)break; out.splice(i,1); d++ } return {messages:out,dropped:d} }

const N = 300, L = 2000
const msgs = [{role:'system',content:'S'.repeat(500)}, ...Array.from({length:N},(_,i)=>({role:i%2?'user':'assistant',content:`m${i}:`+'中文abc'.repeat(L/4)}))]
const budget = 20000

let t0 = performance.now()
for (let k=0;k<20;k++) estMsgs(msgs, estOld)
const oldEst = performance.now()-t0
t0 = performance.now()
for (let k=0;k<20;k++) estMsgs(msgs, estNew)
const newEst = performance.now()-t0

t0 = performance.now(); const rOld = trimOld(msgs, budget, m=>estMsgs(m,estOld)); const oldTrim = performance.now()-t0
t0 = performance.now(); const rNew = trimNew(msgs, budget, m=>estMsgs(m,estNew)); const newTrim = performance.now()-t0

// 等价性
const eqEst = estMsgs(msgs, estOld) === estMsgs(msgs, estNew)
const eqTrim = JSON.stringify(rOld.messages.map(m=>m.role+':'+m.content.slice(0,8))) === JSON.stringify(rNew.messages.map(m=>m.role+':'+m.content.slice(0,8))) && rOld.dropped===rNew.dropped

console.log(`estimateTokens  20轮×${N}条: 旧 ${oldEst.toFixed(1)}ms → 新 ${newEst.toFixed(1)}ms  (${(oldEst/newEst).toFixed(1)}x)`)
console.log(`trimToBudget    ${N}条×${L}字: 旧 ${oldTrim.toFixed(1)}ms → 新 ${newTrim.toFixed(1)}ms  (${(oldTrim/newTrim).toFixed(1)}x)`)
console.log(`等价性: estimate=${eqEst} trim=${eqTrim} (dropped 旧${rOld.dropped}/新${rNew.dropped})`)
