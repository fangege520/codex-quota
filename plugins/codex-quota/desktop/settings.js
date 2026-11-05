'use strict';
const $ = id => document.getElementById(id);
let period = 'today', activity, current;
const zh = () => current?.language !== 'en';
const t = (cn,en) => zh() ? cn : en;
const full = n => n.toLocaleString(zh() ? 'zh-CN' : 'en-US');
const compact = n => new Intl.NumberFormat(zh() ? 'zh-CN' : 'en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
function node(tag, text, css) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (css) el.className = css; return el; }
function resetLabel(w) { return w?.resetsAt ? new Date(w.resetsAt).toLocaleString(zh() ? 'zh-CN' : 'en-GB', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '—'; }
function paint(state) {
  const languageChanged = current?.language !== state.language;
  current = state;
  for (const [id, cn, en] of [['title','用量助手','Quota settings'],['account-title','当前额度','Current quota'],['official','官方用量详情 ↗','Official usage ↗'],['activity-title','Token 用量','Token activity'],['activity-source','本机 Codex 记录 · 按系统时区汇总','Local Codex records · system time zone'],['display-title','显示设置','Display'],['label-composer','编辑框额度','Composer strip'],['label-bar',state.mac?'菜单栏额度':'任务栏额度',state.mac?'Menu bar':'Taskbar'],['label-floating','桌面悬浮框','Floating panel'],['launch','启动 Codex（用量助手）','Launch Codex with Quota']]) $(id).textContent = t(cn,en);
  $('plan').textContent = state.quota?.plan || '—';
  const q = state.quota;
  const rows = [[t('5 小时','5 hours'),q?.short ? Math.round(q.short.remaining)+'%' : '—',resetLabel(q?.short)],[t('7 天','7 days'),q?.weekly ? Math.round(q.weekly.remaining)+'%' : '—',resetLabel(q?.weekly)],[t('Codex 点数','Codex credits'),q?.credits?.unlimited?'∞':q?.credits?.balance??'—',t('余额','Balance')],[t('重置卡','Saved resets'),q?.resets?.count??'—',t('可用张数','Available')]];
  $('summary').replaceChildren(...rows.map(([title,value,detail])=>{const el=node('div',undefined,'metric'); const val=node('strong',value); val.title=String(value); el.append(node('span',title),val,node('small',detail)); return el;}));
  for (const button of document.querySelectorAll('[data-setting]')) button.setAttribute('aria-checked', String(!!state[button.dataset.setting]));
  $('theme').value = state.theme;
  $('connection').textContent = state.sidebarVisible ? t('左栏已连接','Sidebar connected') : t('用「Codex（用量助手）」打开后显示左栏','Open Codex with Quota to show the sidebar');
  for (const [key,cn,en] of [['today','今日','Today'],['week','这周','Week'],['month','本月','Month']]) document.querySelector('[data-period='+key+']').textContent=t(cn,en);
  for (const [i,cn,en] of [[0,'跟随系统','System'],[1,'浅色','Light'],[2,'深色','Dark']]) $('theme').options[i].text=t(cn,en);
  if (activity && languageChanged) paintChart();
}
function paintChart() {
  const rows = activity?.[period]; if (!rows?.length) return;
  const total = rows.reduce((sum,row)=>sum+row.tokens,0);
  $('total').textContent = activity.sessions ? full(total)+' Token' : '—';
  $('hover-value').textContent = activity.sessions ? (period==='today'?t('按小时','Hourly'):t('按天','Daily')) : t('暂无本机用量记录','No local usage records');
  const max = Math.max(1,...rows.map(row=>row.tokens));
  const axis = node('div',undefined,'axis'); axis.append(node('span',compact(max)),node('span',compact(Math.round(max/2))),node('span','0'));
  const plot = node('div',undefined,'plot'); plot.style.setProperty('--columns',rows.length);
  rows.forEach((row,i)=>{
    const label = row.label+' · '+full(row.tokens)+' Token';
    const button = node('button',undefined,'column'+(row.tokens===0?' zero':'')); button.type='button'; button.title=label; button.setAttribute('aria-label',label);
    button.style.setProperty('--fraction',row.tokens/max); button.append(node('span',undefined,'fill'),node('small',period==='week'||i%(period==='today'?6:5)===0?row.label:''));
    for(const event of ['mouseenter','focus','click'])button.addEventListener(event,()=>{$('hover-value').textContent=label;});
    plot.append(button);
  });
  $('chart').replaceChildren(axis,plot);
}
const send = (k,v) => window.quotaSettings.change(k,v);
for (const button of document.querySelectorAll('[data-setting]')) button.onclick = () => send(button.dataset.setting, button.getAttribute('aria-checked') !== 'true');
for (const button of document.querySelectorAll('[data-period]')) button.onclick = () => { period=button.dataset.period; for(const tab of document.querySelectorAll('[data-period]'))tab.setAttribute('aria-pressed',String(tab===button)); paintChart(); };
$('theme').onchange=()=>send('theme',$('theme').value);
for(const key of ['close','official','launch']) $(key).onclick=()=>send(key);
addEventListener('keydown',event=>{if(event.key==='Escape')send('close');});
async function refreshChart(){ try{activity=await window.quotaSettings.usage();paintChart();}catch{$('hover-value').textContent=t('读取记录失败','Could not read local records');} }
window.quotaSettings.subscribe(paint);window.quotaSettings.read().then(paint);refreshChart();setInterval(refreshChart,30000);
