/* 视觉验证：保存三维渲染 PNG、剖切后 PNG，并比对剖切前后像素差异 */
const fs = require('fs');
const { PNG } = (() => { try { return require('pngjs'); } catch { return { PNG: null }; } })();
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe',
    args: ['--use-angle=d3d11', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1000);
  await page.fill('#new-project-name', '视觉验证');
  await page.click('button:has-text("新建项目")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("载入 200 孔演示数据")');
  await page.waitForTimeout(700);
  await page.click('.nav button:has-text("建模参数")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("开始建模")');
  await page.waitForFunction(() => location.hash === '#/view3d', { timeout: 30000 });
  await page.waitForTimeout(2000);

  const grab = async () => page.evaluate(async () => {
    const eng = window.__strat3dEngine.get();
    const r = await eng.readPixels();
    return { w: r.width, h: r.height, data: Array.from(r.data) };
  });
  const before = await grab();

  // 剖切 Z 上限 0.55
  const zHi = page.locator('.clip-row').nth(2).locator('input').nth(1);
  await zHi.fill('0.55');
  await zHi.dispatchEvent('change');
  await page.waitForTimeout(1000);
  const after = await grab();

  let diff = 0;
  for (let i = 0; i < before.data.length; i++) if (Math.abs(before.data[i] - after.data[i]) > 25) diff++;
  console.log(`剖切前后变化字节数: ${diff}（应显著 > 0）`);

  if (PNG) {
    const writePng = (path, img) => {
      const png = new PNG({ width: img.w, height: img.h });
      png.data = Buffer.from(img.data);
      fs.writeFileSync(path, PNG.sync.write(png));
    };
    writePng('e2e-render-full.png', before);
    writePng('e2e-render-clipped.png', after);
    console.log('已保存 e2e-render-full.png / e2e-render-clipped.png');
  } else {
    // 无 pngjs 依赖时写 PPM（可直接被多数图像工具打开）
    const writePpm = (path, img) => {
      const head = Buffer.from(`P6\n${img.w} ${img.h}\n255\n`);
      const body = Buffer.alloc(img.w * img.h * 3);
      for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) {
        body[j] = img.data[i]; body[j + 1] = img.data[i + 1]; body[j + 2] = img.data[i + 2];
      }
      fs.writeFileSync(path, Buffer.concat([head, body]));
    };
    writePpm('e2e-render-full.ppm', before);
    writePpm('e2e-render-clipped.ppm', after);
    console.log('已保存 PPM（无 pngjs）');
  }

  // 剖面截图（Playwright 普通截图，2D canvas 可截）
  await page.click('button:has-text("复位剖切")');
  await page.waitForTimeout(600);
  await page.click('.nav button:has-text("剖面")');
  await page.waitForTimeout(700);
  await page.click('button:has-text("示例横线")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e-section-page.png' });
  console.log('已保存 e2e-section-page.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
