const fs = require('fs');
const Q = String.fromCharCode(39);
const st = JSON.parse(fs.readFileSync('/tmp/jutian-video/film2/stamps.json', 'utf8'));
let prev = 0;
const lines = [];
let total = 0;
let min = 99;
for (let f = 0; f < st.length; f++) {
  let n = Math.round(st[f] / 1000 * 30) - prev;
  prev = Math.round(st[f] / 1000 * 30);
  if (n < 1) n = 1;
  if (n < min) min = n;
  total += n;
  const name = 'frames/f' + String(f).padStart(4, '0') + '.jpg';
  lines.push('file ' + Q + name + Q);
  lines.push('duration ' + (n / 30).toFixed(6));
}
const last = 'frames/f' + String(st.length - 1).padStart(4, '0') + '.jpg';
lines.push('file ' + Q + last + Q);
fs.writeFileSync('/tmp/jutian-video/film2/frames.txt', lines.join('\n') + '\n');
console.log('帧数:', st.length, ' 输出总帧:', total, ' 时长:', (total / 30).toFixed(3) + 's  最小帧保持:', min);
let a = 0;
const per = {};
st.forEach((t) => { const i = Math.min(7, Math.ceil(t / 1000 / 6.5)); });
