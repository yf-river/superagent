/** 只在独立测试 profile 中验证任务 UI、附件、滚动与导航。 */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
const { values } = parseArgs({ options: { url:{type:'string',default:'http://127.0.0.1:8081'},cookies:{type:'string'},output:{type:'string'},fixtures:{type:'string'},'model-smoke':{type:'boolean',default:false} } })
assert(values.cookies&&values.output&&values.fixtures,'Required: --cookies --output --fixtures')
const base=new URL(values.url);assert(['127.0.0.1','localhost'].includes(base.hostname)&&base.port==='8081','Use only the 8081 test profile')
const output=resolve(values.output),directory=resolve(values.fixtures);assert(directory.startsWith('/root/.dsh-superagent-test/ui-evaluations/'),'Fixture directory must belong to the test home')
await mkdir(output,{recursive:true});await mkdir(directory,{recursive:true});await writeFile(join(directory,'attachment.txt'),'task-ui-attachment\n');await writeFile(join(directory,'input.txt'),'task-ui-model-read-smoke\n')
const cookies=JSON.parse(await readFile(values.cookies,'utf8')),cookie=Object.entries(cookies).map(([key,value])=>`${key}=${value}`).join('; ')
async function api(method,path,body){
 const response=await fetch(new URL('/api/superagentTasks/request',base),{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'superagentTasks/request',payload:{args:{input:{method,path,...(body===undefined?{}:{body})}}}})})
 assert.equal(response.status,200);const {result}=await response.json();assert(result.ok,JSON.stringify(result.error));assert.equal(result.value.status,200,JSON.stringify(result.value.body));return result.value.body
}
const browser=await chromium.launch({headless:true,args:['--no-proxy-server']})
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN',acceptDownloads:true,recordVideo:{dir:join(output,'video'),size:{width:1440,height:900}}})
await context.addCookies(Object.entries(cookies).map(([name,value])=>({name,value,url:base.origin})))
const page=await context.newPage(),errors=[],checks=[],created=[]
page.on('pageerror',error=>errors.push(error.message));page.on('console',item=>{if(item.type()==='error')errors.push(item.text())})
const stamp=`UI复刻验收-${Date.now()}`
const shot=async name=>{await page.waitForTimeout(180);await page.screenshot({path:join(output,`${name}.png`)})}
const closeDetail=()=>page.getByRole('button',{name:'返回任务',exact:true}).click()
async function display(){await page.getByRole('button',{name:'显示',exact:true}).click();await page.locator('[data-slot=popover-content]').waitFor()}
async function waitData(predicate){await assert.doesNotReject(async()=>{for(let i=0;i<80;i++){if(await predicate())return;await page.waitForTimeout(150)}throw Error('Task state did not converge')})}
try{
 await page.goto(base.origin,{waitUntil:'networkidle'});await page.getByRole('button',{name:'superagent',exact:true}).click();await page.locator('.st-card').first().waitFor();await shot('board-desktop')
 const column=await page.locator('.st-column').first().boundingBox();assert.equal(Math.round(column.width),280);checks.push('280px columns and independent board surface')
 await page.getByRole('button',{name:'新建任务',exact:true}).first().click();const dialog=page.getByRole('dialog');await dialog.waitFor()
 await dialog.getByRole('textbox',{name:'标题',exact:true}).fill(stamp)
 await dialog.locator('.tiptap').fill('这是一条通过界面保存的草稿；暂不开始执行。')
 await dialog.locator('input[aria-label="项目目录"]').fill(directory)
 await shot('create-desktop')
 await dialog.getByRole('button',{name:'保存到待规划',exact:true}).click();await page.locator('.st-detail-page').waitFor()
 let task=(await api('GET',`tasks?q=${encodeURIComponent(stamp)}`)).items[0];assert(task);created.push(task.id);assert.equal(task.phase,'draft');assert.equal(task.tickets.length,0)
 checks.push('UI creation saves a real draft without model execution')
 await page.locator('.st-detail-properties [data-slot=select-trigger]').first().click();await page.getByRole('option',{name:'重要不紧急',exact:true}).click()
 await waitData(async()=> (await api('GET',`tasks/${task.id}`)).priority==='important_not_urgent')
 await page.getByRole('button',{name:'截止日期',exact:true}).click();await page.locator('.st-calendar-day').filter({hasText:/^15$/}).first().click()
 await waitData(async()=>!!(await api('GET',`tasks/${task.id}`)).dueDate)
 await page.locator('.st-note .tiptap').fill('这是追加的补充要求，验证 Markdown 与附件一起保存。')
 await page.locator('.st-note input[type=file]').setInputFiles(join(directory,'attachment.txt'))
 await page.getByRole('button',{name:'提交补充要求',exact:true}).click()
 await waitData(async()=> (await api('GET',`tasks/${task.id}`)).events.some(event=>event.kind==='note'))
 const download=page.waitForEvent('download');await page.locator('.st-detail-body .st-file button').first().click();const file=await download;assert.equal(file.suggestedFilename(),'attachment.txt');await file.saveAs(join(output,'attachment-downloaded.txt'));assert.equal(await readFile(join(output,'attachment-downloaded.txt'),'utf8'),'task-ui-attachment\n')
 task=await api('GET',`tasks/${task.id}`);assert.equal(task.phase,'draft');assert.equal(task.tickets.length,0);checks.push('Priority/date changes, follow-up and authenticated attachment round trip')
 await shot('detail-desktop');await closeDetail();await page.locator('.st-board').waitFor()
 // 密集数据全部是本次创建的草稿，结束时通过正式取消指令收起。
 for(let i=0;i<38;i++){const value=await api('POST','tasks',{requestId:crypto.randomUUID(),title:`${stamp} ${String(i).padStart(2,'0')} 长标题换行与滚动验证`,description:'# 验证内容\n\n- 条目一\n- 条目二\n\n这是一条不会启动模型的测试草稿。',directory,priority:'important_urgent'});created.push(value.id)}
 await page.getByRole('button',{name:'搜索任务标题',exact:true}).click();await page.getByRole('textbox',{name:'搜索任务标题',exact:true}).fill(stamp);await page.keyboard.press('Escape')
 await waitData(async()=>Number((await page.locator('.st-column-draft header').first().textContent()).match(/\d+/)?.[0])===39)
 await display();await page.getByRole('checkbox',{name:'四象限分组',exact:true}).uncheck();await page.keyboard.press('Escape')
 await page.locator('.st-column-draft [data-virtuoso-scroller]').waitFor();assert((await page.locator('.st-column-draft .st-card').count())<39);checks.push('Large columns virtualize rather than mounting all cards')
 const cards=page.locator('.st-column-draft [data-board-card]'), firstId=await cards.nth(0).locator('a').getAttribute('href')
 const first=await cards.nth(0).boundingBox(),second=await cards.nth(1).boundingBox()
 await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(first.x+first.width/2,first.y+first.height/2+8,{steps:3});await page.locator('.st-board.st-dragging').waitFor();await page.mouse.move(second.x+second.width/2,second.y+second.height/2+12,{steps:12});await page.mouse.up()
 await waitData(async()=>await page.locator('.st-column-draft .st-card').first().getAttribute('href')!==firstId);checks.push('Pointer card reordering persists as view state without starting a model')
 await page.mouse.move(440,600);await page.mouse.wheel(0,430);await page.waitForTimeout(250);const vertical=await page.locator('[data-scroll-column=draft]').evaluate(e=>e.scrollTop);assert(vertical>0)
 const board=page.locator('.st-board'),bounds=await board.boundingBox();await page.mouse.move(bounds.x+bounds.width-100,bounds.y+bounds.height-60);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-380,bounds.y+bounds.height-60,{steps:15});await page.mouse.up();const horizontal=await board.evaluate(e=>e.scrollLeft);assert(horizontal>150)
 await page.mouse.wheel(220,0);await page.waitForTimeout(150);assert((await board.evaluate(e=>e.scrollLeft))>horizontal);assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'');checks.push('Blank-area pointer pan and horizontal wheel preserve text selection and column scrolling')
 // 回到第一列，通过真实链接进入详情再返回。
 await board.evaluate(e=>{e.scrollLeft=0});const link=page.locator('.st-column-draft .st-card').first();await link.scrollIntoViewIfNeeded();const before=await page.locator('[data-scroll-column=draft]').evaluate(e=>e.scrollTop);await link.click();await page.locator('.st-detail-page').waitFor();await closeDetail();await page.locator('.st-board').waitFor();const after=await page.locator('[data-scroll-column=draft]').evaluate(e=>e.scrollTop);assert(Math.abs(before-after)<2);checks.push('Detail back restores column position and card focus')
 await display();await page.keyboard.press('Escape');await waitData(async()=>await page.getByRole('button',{name:'显示',exact:true}).evaluate(e=>e===document.activeElement));checks.push('Popover Escape restores trigger focus')
 await page.getByRole('combobox',{name:'显示',exact:true}).click();await page.getByRole('option',{name:'列表',exact:true}).click();await page.locator('.st-list [data-virtuoso-scroller]').waitFor();await shot('list-desktop');checks.push('List view uses virtualized 36px rows')
 await page.getByRole('combobox',{name:'显示',exact:true}).click();await page.getByRole('option',{name:'看板',exact:true}).click();await page.locator('.st-board').waitFor();await shot('board-dense')
 await page.setViewportSize({width:2240,height:1260});await shot('board-wide');await page.locator('.st-page').evaluate(e=>e.style.zoom='0.8');await shot('board-80percent');await page.locator('.st-page').evaluate(e=>e.style.removeProperty('zoom'))
 await page.setViewportSize({width:390,height:844});await shot('board-mobile');await page.getByRole('button',{name:'显示',exact:true}).click();await shot('display-mobile');const popup=await page.locator('[data-slot=popover-content]').boundingBox();assert(popup.x>=0&&popup.x+popup.width<=391);await page.keyboard.press('Escape');checks.push('390px menus stay in viewport; 2240px and 80% rendering captured')
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''));await waitData(async()=>await page.locator('.st-card').first().evaluate(e=>getComputedStyle(e).color==='oklch(0.985 0 0)'));await shot('board-dark');assert(await page.locator('.st-page').evaluate(e=>e.classList.contains('dark')));await page.evaluate(()=>document.body.removeAttribute('data-ds-dark-theme'));checks.push('Task and portal surfaces follow the host theme')
 if(values['model-smoke']){
  const run=await api('POST','tasks',{requestId:crypto.randomUUID(),title:`${stamp} Router读取验证`,description:'仅使用终端读取 input.txt 的内容，不修改文件。读取后通过 orchestrator_report 报告 ready，摘要包含读取到的原文。',directory,priority:'important_urgent'});created.push(run.id)
  await page.evaluate(id=>location.hash=`superagent/tasks/${id}`,run.id);await page.locator('.st-detail-page').waitFor();await page.getByRole('button',{name:'开始执行',exact:true}).click()
  let finished
  for(let i=0;i<240;i++){finished=await api('GET',`tasks/${run.id}`);if(finished.stage==='review')break;if(finished.stage==='waiting')throw Error('Model smoke needs attention: '+finished.question);await page.waitForTimeout(500)}
  assert.equal(finished.stage,'review');assert(finished.sessionId);assert(finished.routes.length);assert.match(finished.summary,/task-ui-model-read-smoke/)
  await page.getByRole('button',{name:'确认完成',exact:true}).click();await waitData(async()=>(await api('GET',`tasks/${run.id}`)).phase==='done');assert.equal(await readFile(join(directory,'input.txt'),'utf8'),'task-ui-model-read-smoke\n');await shot('model-reviewed');checks.push('Real Router/Worker read-only task starts and completes through the UI with native routing records')
 }
 assert.deepEqual(errors,[])
}catch(error){
 await page.screenshot({path:join(output,'failure.png')});console.error('UI errors:',JSON.stringify(errors));console.error('Visible options:',JSON.stringify(await page.locator('[role=option]').allTextContents()));throw error
}finally{
 const owned=(await api('GET',`tasks?q=${encodeURIComponent(stamp)}&limit=200`)).items.map(task=>task.id)
 for(const id of new Set([...created,...owned])){try{const task=await api('GET',`tasks/${id}`);if(!['done','cancelled'].includes(task.phase))await api('POST',`tasks/${id}/cancel`,{requestId:crypto.randomUUID(),revision:task.revision})}catch(error){errors.push(`Cleanup: ${error.message}`)}}
 await writeFile(join(output,'browser.json'),JSON.stringify({checks,errors,created:created.length},null,2)+'\n');await context.close();await copyFile(await page.video().path(),join(output,'task-ui.webm'));await browser.close()
}
console.log(JSON.stringify({checks,errors},null,2))
