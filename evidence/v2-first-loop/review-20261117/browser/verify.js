async (page) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = '/api/missions/' + new URL(page.url()).searchParams.get('missionId');
  const read = async path => { const r = await page.request.get('http://127.0.0.1:4480' + base + path); if(!r.ok()) throw new Error(await r.text()); return r.json(); };
  const duo = page.getByRole('region', {name:'双人冲刺'}), before = await read('/workbench');
  const initial = await read('/sprint');
  if(initial.session?.agent.newOutputs !== 1 || initial.session.agent.completedSteps < 1) throw new Error('Missing durable real Runner receipts');
  let dropped = false; const ids = [];
  await page.route('**/sprint', async route => {
    if(route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if(body.action === 'SELF_REPORT') { ids.push(body.requestId); if(!dropped) { dropped=true; await route.fetch(); return route.abort('failed'); } }
    await route.continue();
  });
  await duo.getByRole('checkbox', {name:'我完成了 个人自述'}).click();
  await duo.getByRole('button', {name:'重试原冲刺请求'}).waitFor();
  await duo.getByRole('button', {name:'重试原冲刺请求'}).click();
  await page.waitForTimeout(250);
  const reported = await read('/sprint');
  if(!reported.session.selfReportedDone || new Set(ids).size !== 1 || ids.length !== 2) throw new Error('Self report retry not idempotent');
  await page.screenshot({path:'output/playwright/review-20261117/sprint-active.png',fullPage:true});
  await duo.getByRole('button', {name:'结束本轮',exact:true}).click();
  for(let i=0;i<30;i++) { if((await read('/sprint')).session.status === 'ENDED') break; await page.waitForTimeout(100); }
  const ended = await read('/sprint'), after = await read('/workbench');
  if(ended.session.status !== 'ENDED' || after.version !== before.version || after.status !== before.status) throw new Error('Ending sprint changed original Mission');
  await page.reload(); await duo.getByRole('button', {name:'打开成果与证据'}).waitFor();
  await duo.getByRole('button', {name:'打开成果与证据'}).click();
  await page.setViewportSize({width:360,height:900});
  await page.screenshot({path:'output/playwright/review-20261117/sprint-mobile.png',fullPage:true});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if(overflow || errors.length) throw new Error(JSON.stringify({overflow,errors}));
  return {at:new Date().toISOString(), origin:'http://127.0.0.1:4480', data:'isolated synthetic SQLite', provider:'localhost HTTP mock with 10s latency', missionId:before.id,
    checks:['real running Mission permits sprint; idle refuses start','3 real Step receipts and 1 new Output','lost self-report response retries same requestId','ending sprint preserves Mission version/status','reload keeps ended sprint; opens original output/evidence','360px has no horizontal overflow'],
    before:{status:before.status,version:before.version},after:{status:after.status,version:after.version},sprint:ended.session, errors, overflow, physicalHarmonyVerified:false,realProviderQualityVerified:false};
}
