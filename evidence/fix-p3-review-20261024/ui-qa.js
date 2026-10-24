async (page) => {
  await page.goto('http://127.0.0.1:33322/projects');
  await page.getByRole('link', {name:'人工智能创意赛 忆程 ProjectMemo 作品开发',exact:true}).click();
  await page.getByRole('heading',{name:'项目概览',exact:true}).waitFor();
  await page.getByRole('link',{name:'GitHub 仓库',exact:true}).waitFor();
  const home = page.url();
  const checked = [];
  for (const width of [1440,1280,768,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    if (!(await page.getByRole('link',{name:'GitHub 仓库',exact:true}).isVisible())) throw Error('entry missing at '+width);
    if (!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))) throw Error('overview overflow at '+width);
    if (width===1440 || width===390) await page.screenshot({path:'tmp/p3-fix-overview-'+width+'.png',fullPage:false});
    checked.push('overview-'+width);
  }
  await page.getByRole('link',{name:'GitHub 仓库',exact:true}).click();
  await page.getByLabel('公开仓库（owner/repo）').waitFor();
  if (await page.locator('#repo-signals').getAttribute('open')===null) throw Error('entry did not expand');
  for (const width of [1440,1280,768,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    if (!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))) throw Error('repo overflow at '+width);
    if (width===1440 || width===390) await page.screenshot({path:'tmp/p3-fix-repo-'+width+'.png',fullPage:false});
    checked.push('repo-'+width);
  }
  let connected=false, adopted=false, refreshed=false;
  const signal = {id:'fixture-signal',connectionId:'fixture-connection',kind:'COMMITS',sha:'a'.repeat(40),title:'更新实验记录',authorName:'fixture',committedAt:'2026-10-24T00:00:00Z',url:'https://github.com/fixture/repo',status:'CANDIDATE',adoptedAt:null,adoptedCaptureId:null,linkedActionId:null};
  const connection = {id:'fixture-connection',repo:'fixture/repo',ref:'main',status:'ACTIVE',lastFetchedAt:'2026-10-24T00:00:00Z',lastStatus:'PARTIAL',lastError:'再次刷新将继续读取',revokedAt:null,revokedReason:null,candidateCount:1,adoptedCount:0};
  await page.route('**/repo-signals',async route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      if(body.repo!=='fixture/repo'||body.ref!=='main'||!body.requestId) throw Error('invalid create payload');
      connected=true;
      await route.fulfill({json:{connection,summary:{status:'PARTIAL',created:1}}});
    } else await route.fulfill({json:{enabled:true,note:'浏览器交互 fixture',connections:connected?[connection]:[],signals:connected?[signal]:[]}});
  });
  await page.route('**/repo-signals/connections/*',async route=>{
    if(route.request().postDataJSON().action!=='REFRESH') throw Error('invalid refresh payload');
    refreshed=true;connection.lastStatus='OK';connection.lastError=null;
    await route.fulfill({json:{connection,status:'OK',created:0}});
  });
  await page.route('**/repo-signals/signals/*',async route=>{
    if(route.request().postDataJSON().action!=='ADOPT') throw Error('invalid adoption payload');
    adopted=true;signal.status='ADOPTED';signal.adoptedCaptureId='fixture-capture';connection.candidateCount=0;connection.adoptedCount=1;
    await route.fulfill({json:{signal,captureId:'fixture-capture'}});
  });
  await page.reload();
  await page.getByLabel('公开仓库（owner/repo）').fill('fixture/repo');
  await page.getByLabel('分支或提交引用',{exact:true}).fill('main');
  await page.getByRole('button',{name:'创建并首次刷新',exact:true}).click();
  await page.getByText('fixture/repo@main',{exact:true}).waitFor();
  await page.getByRole('button',{name:'继续同步提交',exact:true}).click();
  await page.getByRole('button',{name:'刷新提交',exact:true}).waitFor();
  await page.getByRole('button',{name:'采纳为项目资料',exact:true}).click();
  await page.getByText(/已写入资料记录/).waitFor();
  if(!connected||!refreshed||!adopted) throw Error('interaction incomplete');
  if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))) throw Error('populated mobile overflow');
  await page.screenshot({path:'tmp/p3-fix-repo-mobile-fixture.png',fullPage:false});
  return {home,checked,fixtureInteractions:{connected,refreshed,adopted},realGithubRequests:0};
}
