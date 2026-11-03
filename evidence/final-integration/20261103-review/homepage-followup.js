async (page) => {
  const requests = [];
  page.on('request', r => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  await page.reload({ waitUntil: 'networkidle' });
  const stages = [];
  for (const [name, label] of [['离开时', '无需操作'], ['期间', '核对示例'], ['回来后', '等你确认']]) {
    await page.getByRole('tab', { name, exact: true }).click();
    const header = await page.locator('[data-hero-lens] header').innerText();
    if (!header.includes(label)) throw new Error(`阶段状态不符: ${name}: ${header}`);
    stages.push({ name, header });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.scrollTo(0, 280));
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-motion') === 'on');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-motion') === 'reduced');
  const reduced = await page.locator('[data-hero]').evaluate(el => ({ translate: getComputedStyle(el).translate, shift: el.style.getPropertyValue('--hero-shift') }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-motion') === 'on');
  const viewports = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `D:/Projects/hongmen-final-integration/evidence/final-integration/20261103-review/home-${width}.png` });
    viewports.push(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })));
  }
  return { scope: 'anonymous local homepage browser only', stages, reduced, viewports, requests,
    nonReadRequests: requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)),
    externalRequests: requests.filter(r => new URL(r.url).origin !== 'http://127.0.0.1:34119'),
    serverModelCalls: { measured: false, reason: 'Browser network cannot attest server-to-provider traffic. Preview configured mock; no live-model quality claim.' } };
}
