const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe',
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgpu-developer-features',
      '--no-sandbox',
      '--enable-features=Vulkan',
    ],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(2000);
  const info = await page.evaluate(async () => {
    const out = { userAgent: navigator.userAgent };
    try {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      out.highPerf = !!a;
      if (a) out.info = (a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device } : null);
    } catch (e) { out.err1 = String(e); }
    try {
      const a2 = await navigator.gpu.requestAdapter();
      out.default = !!a2;
      if (a2) {
        const d = await a2.requestDevice();
        out.device = !!d;
        out.limits = { storage: d.limits.maxStorageBufferBindingSize, groups: d.limits.maxBindGroups };
      }
    } catch (e) { out.err2 = String(e); }
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('LOGS:', logs.join(' | '));
  await browser.close();
})();
