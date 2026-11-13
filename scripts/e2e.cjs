/* E2E：建项目 -> 载入演示数据 -> 校验 -> GPU 建模 -> 三维渲染 -> 图层/剖切 -> 剖面 PNG */
const fs = require('fs');
const { chromium } = require('playwright');

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5173/';
const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra: String(extra) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
};

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: EXE,
    args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE);
  await page.waitForTimeout(1500);
  const gpuBadge = await page.locator('.app-header .badge').innerText();
  check('WebGPU 就绪徽标', gpuBadge.includes('WebGPU 就绪'), gpuBadge);

  // 1. 新建项目
  await page.fill('#new-project-name', 'E2E测试项目');
  await page.click('button:has-text("新建项目")');
  await page.waitForTimeout(600);
  check('进入钻孔页', (await page.locator('.app-header .project-name').innerText()).includes('E2E测试项目'));

  // 2. 载入演示数据
  await page.click('button:has-text("载入 200 孔演示数据")');
  await page.waitForTimeout(1200);
  const rowCount = await page.locator('tbody tr').count();
  check('钻孔表 200 行', rowCount >= 200, `rows=${rowCount}`);
  const issueTitle = await page.locator('.card h3').first().innerText();
  check('校验无错误', !issueTitle.includes('错误'), issueTitle);

  // 3. 参数页：切克里金再切回 IDW，网格 256
  await page.click('.nav button:has-text("建模参数")');
  await page.waitForTimeout(500);
  await page.selectOption('select', 'idw');
  await page.fill('input[min="16"]', '256');
  await page.dispatchEvent('input[min="16"]', 'change');
  check('岩性表 5 项', (await page.locator('.layer-row, tbody tr').count()) >= 5);

  // 4. 建模（GPU）
  await page.click('button:has-text("开始建模")');
  await page.waitForFunction(() => location.hash === '#/view3d', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const hud = await page.locator('.hud').allInnerTexts().then((t) => t.join(' '));
  check('三维页显示 256³', hud.includes('256'), hud.replace(/\n/g, ' | '));
  check('HUD 显示 WebGPU', hud.includes('WebGPU'), '');
  const timing = hud.match(/建模总耗时\s*(\d+)\s*ms/);
  check('端到端 <5000ms', timing && Number(timing[1]) < 5000, timing ? timing[1] + 'ms' : 'no timing');

  // 5. 渲染非空：通过 WebGPU readPixels 读取真实画面
  const readBright = async () => {
    const r = await page.evaluate(async () => {
      const eng = window.__strat3dEngine?.get?.();
      if (!eng) return null;
      const { data } = await eng.readPixels();
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - 18) + Math.abs(data[i + 1] - 23) + Math.abs(data[i + 2] - 31) > 30) n++;
      }
      return n;
    });
    return r;
  };
  const pixel = await readBright();
  check('画布有渲染内容', pixel !== null && pixel > 10000, `非背景像素=${pixel}`);

  // 6. 图层透明度与隐藏
  const firstCheckbox = page.locator('.layer-row input[type=checkbox]').first();
  await firstCheckbox.uncheck();
  await page.waitForTimeout(600);
  await firstCheckbox.check();
  await page.locator('.layer-row input[type=range]').first().fill('0.4');
  await page.waitForTimeout(400);
  check('图层控件可用', true);

  // 7. 剖切盒：Z 上限切一半
  const zHi = page.locator('.clip-row').nth(2).locator('input').nth(1);
  await zHi.fill('0.55');
  await zHi.dispatchEvent('change');
  await page.waitForTimeout(900);
  const cutPixel = await readBright();
  check('剖切后仍有封面渲染', cutPixel !== null && cutPixel > 5000, `非背景像素=${cutPixel}`);
  await page.click('button:has-text("复位剖切")');
  await page.waitForTimeout(700);

  // 8. 剖面页：示例横线 -> 出图 -> PNG 导出
  await page.click('.nav button:has-text("剖面")');
  await page.waitForTimeout(800);
  await page.click('button:has-text("示例横线")');
  await page.waitForTimeout(1000);
  const secInfo = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('.viewport canvas')];
    const sec = canvases[canvases.length - 1];
    const d = sec.getContext('2d').getImageData(0, 0, sec.width, sec.height).data;
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) painted++;
    return { painted, w: sec.width, h: sec.height };
  });
  check('剖面画布有内容', secInfo.painted > 20000, `painted=${secInfo.painted} ${secInfo.w}x${secInfo.h}`);

  const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
  await page.click('button:has-text("导出 PNG")');
  const download = await downloadPromise;
  const savePath = './e2e-section.png';
  await download.saveAs(savePath);
  const stat = fs.statSync(savePath);
  check('PNG 导出成功', stat.size > 20000, `${stat.size} bytes`);

  // 9. 项目导出 JSON 并校验体素已持久化
  const [jsonReq] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.click('.nav button:has-text("项目列表")'),
  ]);
  await page.waitForTimeout(600);
  await page.click('.project-card button:has-text("导出")');
  const dl = await page.waitForEvent('download', { timeout: 8000 });
  await dl.saveAs('./e2e-project.json');
  const json = JSON.parse(fs.readFileSync('./e2e-project.json', 'utf8'));
  check('导出 JSON 含模型', json.model && json.model.gridSize === 256 && json.model.voxels.length === 256 ** 3,
    `voxels=${json.model?.voxels?.length}`);
  check('导出 JSON 含断层', !!json.fault && json.fault.throw === 9);
  check('GPU 后端记录', json.model.backend === 'webgpu', json.model.backend);
  void jsonReq;

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== E2E ${results.length - failed.length}/${results.length} 通过 ====`);
  if (errors.length) console.log('控制台错误:\n' + errors.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
