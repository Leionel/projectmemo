import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { E2E_ENV } from '../scripts/e2e-env';
function fixture(op:string,id:string){return execFileSync(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),'scripts/e2e-pr6-fixture.ts',op,id],{env:{...process.env,...E2E_ENV},timeout:30000}).toString();}
test('PR6 原回答来源回读、研究总结确认及撤权，桌面手机同一会话',async({page})=>{
  test.setTimeout(90000);
  const session=(await page.context().cookies()).find(c=>c.name==='pm_session')!;
  const me=await page.request.get('/api/auth/me',{headers:{Authorization:'Bearer '+session.value}});
  expect(me.ok(),await me.text()).toBe(true);
  const user=(await me.json()).user;
  const data=JSON.parse(fixture('create',user.id));
  try {
    await page.goto('/focus?conversation='+data.conversationId);
    const panel=page.getByRole('region',{name:'问忆程',exact:true});
    await expect(panel.getByText('先补同条件验证，再决定是否采用。',{exact:false})).toBeVisible();
    await panel.getByText('调查覆盖与缺口',{exact:true}).click();
    await expect(panel.getByText('待核对：本项目同条件实测')).toBeVisible();
    const guides=panel.getByLabel('本条回答的资料指引');
    await guides.locator('summary').click();
    await expect(guides).toContainText('正文片段');
    await guides.getByRole('link',{name:'查看网页来源'}).click();
    await expect(page.getByText('这份合成资料仅用于界面验收。',{exact:false})).toBeVisible();
    await page.goBack();
    await panel.getByRole('button',{name:'保存研究总结',exact:true}).click();
    await expect(panel.getByRole('group',{name:'研究总结预览'})).toBeVisible();
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:`evidence/r4-continuity/20261028-pr6-close-ct1/web/pr6-preview-${width}.png`,fullPage:true});
    }
    await panel.getByRole('button',{name:'确认归入项目'}).click();
    await expect(panel.getByRole('status').filter({hasText:'研究总结已归入项目'})).toBeVisible();
    await panel.getByRole('button',{name:'联网研究 ✓'}).click();
    await panel.getByRole('button',{name:'关闭联网'}).click();
    await expect(panel.getByText('先补同条件验证，再决定是否采用。',{exact:false})).toHaveCount(0);
  } finally {fixture('remove',data.projectId);}
});
