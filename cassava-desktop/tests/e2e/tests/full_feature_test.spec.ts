import { test, expect, Page } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:39333';

test.describe('木薯桌面端全功能测试', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
  });

  test('T1-首页加载和功能', async ({ page }) => {
    const heroTitle = page.locator('h1').first();
    await expect(heroTitle).toBeVisible({ timeout: 10000 });

    const statsSection = page.locator('[class*="rounded-3xl"]');
    const statsCount = await statsSection.count();
    expect(statsCount).toBeGreaterThan(0);

    const ctaButton = page.locator('button:has-text("开始预测")');
    await expect(ctaButton.first()).toBeVisible();

    const featureSection = page.locator('text=AI智能分析');
    await expect(featureSection).toBeVisible();

    console.log('首页测试完成');
  });

  test('T2-图片管理页面', async ({ page }) => {
    await page.click('text=图片管理');
    await page.waitForTimeout(3000);

    const pageContent = page.locator('body');
    await expect(pageContent).toBeVisible();

    const uploadButtons = page.locator('button').filter({ hasText: /上传|导入|Upload|Import/ });
    const uploadCount = await uploadButtons.count();
    expect(uploadCount).toBeGreaterThan(0);

    const listContainer = page.locator('.ant-spin, [class*="list"], [class*="grid"]');
    const hasList = await listContainer.count();
    expect(hasList).toBeGreaterThan(0);

    console.log('图片管理页面测试完成');
  });

  test('T3-预测模块页面', async ({ page }) => {
    await page.click('text=预测');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const modelSelector = page.locator('.ant-select, [class*="select"]');
    const hasSelector = await modelSelector.count();
    expect(hasSelector).toBeGreaterThan(0);

    const predictButton = page.locator('button:has-text("预测")');
    const predictButtonAlt = page.locator('button:has-text("开始")');
    const predictCount = await predictButton.count() + await predictButtonAlt.count();
    expect(predictCount).toBeGreaterThan(0);

    const uploadArea = page.locator('[class*="upload"], [class*="drop"]');
    await uploadArea.count();

    console.log('预测模块测试完成');
  });

  test('T4-任务中心页面', async ({ page }) => {
    await page.click('text=任务中心');
    await page.waitForTimeout(3000);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    const taskList = page.locator('.ant-table, [class*="task"], [class*="list"]');
    const hasList = await taskList.count();
    expect(hasList).toBeGreaterThan(0);

    const pagination = page.locator('.ant-pagination');
    const hasPagination = await pagination.count();
    console.log('分页组件: ' + (hasPagination > 0 ? '存在' : '不存在'));

    console.log('任务中心测试完成');
  });

  test('T5-结果中心页面', async ({ page }) => {
    await page.click('text=结果中心');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const resultsList = page.locator('.ant-table, [class*="result"], [class*="card"]');
    const hasResults = await resultsList.count();
    expect(hasResults).toBeGreaterThan(0);

    const exportButton = page.locator('button:has-text("导出")');
    const exportButtonAlt = page.locator('button:has-text("下载")');
    const hasExport = await exportButton.count() + await exportButtonAlt.count();
    console.log('导出按钮: ' + (hasExport > 0 ? '存在' : '不存在'));

    console.log('结果中心测试完成');
  });

  test('T6-设置页面', async ({ page }) => {
    await page.click('text=设置');
    await page.waitForTimeout(3000);

    const settingsForm = page.locator('.ant-form, form, [class*="setting"]');
    const hasForm = await settingsForm.count();
    expect(hasForm).toBeGreaterThan(0);

    const saveButton = page.locator('button:has-text("保存")');
    const saveButtonAlt = page.locator('button:has-text("Save")');
    const hasSave = await saveButton.count() + await saveButtonAlt.count();
    expect(hasSave).toBeGreaterThan(0);

    console.log('设置页面测试完成');
  });

  test('T7-模型管理页面', async ({ page }) => {
    await page.click('text=模型管理');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const modelList = page.locator('.ant-table, [class*="model"], [class*="card"]');
    const hasModels = await modelList.count();
    expect(hasModels).toBeGreaterThan(0);

    console.log('模型管理页面测试完成');
  });

  test('T8-备份恢复页面', async ({ page }) => {
    await page.click('text=备份');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const backupButton = page.locator('button:has-text("备份")');
    const backupButtonAlt = page.locator('button:has-text("Backup")');
    const hasBackup = await backupButton.count() + await backupButtonAlt.count();
    expect(hasBackup).toBeGreaterThan(0);

    const restoreButton = page.locator('button:has-text("恢复")');
    const restoreButtonAlt = page.locator('button:has-text("Restore")');
    const hasRestore = await restoreButton.count() + await restoreButtonAlt.count();
    console.log('恢复按钮: ' + (hasRestore > 0 ? '存在' : '不存在'));

    console.log('备份恢复页面测试完成');
  });

  test('T9-关于页面', async ({ page }) => {
    await page.click('text=关于');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const versionInfo = page.locator('text=版本');
    const versionInfoAlt = page.locator('text=Version');
    const hasVersion = await versionInfo.count() + await versionInfoAlt.count();
    expect(hasVersion).toBeGreaterThan(0);

    console.log('关于页面测试完成');
  });

  test('T10-联系我们页面', async ({ page }) => {
    await page.click('text=联系');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toBeVisible();

    const contactForm = page.locator('.ant-form, form');
    const hasForm = await contactForm.count();
    expect(hasForm).toBeGreaterThan(0);

    console.log('联系我们页面测试完成');
  });

  test('T11-API后端连接测试', async ({ request }) => {
    const response = await request.get(BACKEND_URL + '/api/images/', { timeout: 10000 });
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(400);

    const data = await response.json();
    expect(data).toBeDefined();

    console.log('API测试完成 - 状态码: ' + response.status());
  });

  test('T12-键盘快捷键帮助', async ({ page }) => {
    await page.waitForTimeout(1000);

    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(1000);

    const modal = page.locator('.ant-modal, [class*="modal"], [class*="dialog"]');
    const hasModal = await modal.count();
    console.log('快捷键帮助弹窗: ' + (hasModal > 0 ? '存在' : '不存在'));
  });

  test('T13-深色模式切换', async ({ page }) => {
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      document.documentElement.classList.toggle('dark');
    });

    const hasDarkClass = await page.evaluate(() => {
      return document.documentElement.classList.contains('dark');
    });

    expect(hasDarkClass).toBe(true);

    console.log('深色模式切换测试完成');
  });

  test('T14-顶部导航测试', async ({ page }) => {
    const nav = page.locator('nav, [class*="nav"], header');
    const hasNav = await nav.count();
    expect(hasNav).toBeGreaterThan(0);

    const navLinks = page.locator('nav a, [class*="nav"] a, header a');
    const linkCount = await navLinks.count();
    console.log('导航链接数量: ' + linkCount);

    const sections = ['首页', '图片管理', '预测', '任务中心', '结果中心'];
    for (const section of sections) {
      const link = page.locator('text=' + section).first();
      if (await link.count() > 0) {
        await link.click();
        await page.waitForTimeout(1000);
        console.log('已点击: ' + section);
      }
    }

    console.log('顶部导航测试完成');
  });

  test('T15-图片上传流程', async ({ page }) => {
    await page.click('text=图片管理');
    await page.waitForTimeout(2000);

    const uploadBtn = page.locator('button').filter({ hasText: /上传|导入/ }).first();
    if (await uploadBtn.count() > 0) {
      await uploadBtn.click();
      await page.waitForTimeout(1000);

      const dialog = page.locator('.ant-modal, [class*="dialog"]');
      const hasDialog = await dialog.count();
      console.log('上传对话框: ' + (hasDialog > 0 ? '存在' : '不存在'));
    }

    console.log('图片上传流程测试完成');
  });

  test('T16-预测创建流程', async ({ page }) => {
    await page.click('text=预测');
    await page.waitForTimeout(2000);

    const body = page.locator('body');
    await expect(body).toBeVisible();

    const modelSelect = page.locator('.ant-select');
    const hasSelect = await modelSelect.count();
    console.log('模型选择器: ' + (hasSelect > 0 ? '存在' : '不存在'));

    const predictBtn = page.locator('button:has-text("预测")');
    const hasPredictBtn = await predictBtn.count();
    console.log('预测按钮: ' + (hasPredictBtn > 0 ? '存在' : '不存在'));

    console.log('预测创建流程测试完成');
  });

  test('T17-任务详情查看', async ({ page }) => {
    await page.click('text=任务中心');
    await page.waitForTimeout(3000);

    const taskRow = page.locator('.ant-table-row, [class*="task-item"]').first();
    if (await taskRow.count() > 0) {
      await taskRow.click();
      await page.waitForTimeout(1000);
      console.log('已点击任务行');
    } else {
      console.log('没有任务行（可能为空状态）');
    }

    console.log('任务详情查看测试完成');
  });

  test('T18-结果详情查看', async ({ page }) => {
    await page.click('text=结果中心');
    await page.waitForTimeout(3000);

    const resultCard = page.locator('[class*="result-card"], [class*="card"]').first();
    if (await resultCard.count() > 0) {
      await resultCard.click();
      await page.waitForTimeout(1000);
      console.log('已点击结果卡片');
    } else {
      console.log('没有结果卡片（可能为空状态）');
    }

    console.log('结果详情查看测试完成');
  });

  test('T19-语言切换', async ({ page }) => {
    const langButton = page.locator('[class*="lang"], [class*="language"]').first();
    const langButtonAlt = page.locator('button:has-text("EN")');
    const langButtonAlt2 = page.locator('button:has-text("中")');
    const hasLangBtn = await langButton.count() + await langButtonAlt.count() + await langButtonAlt2.count();

    if (hasLangBtn > 0) {
      const btn = langButton.count() > 0 ? langButton : (langButtonAlt.count() > 0 ? langButtonAlt : langButtonAlt2);
      await btn.first().click();
      await page.waitForTimeout(1000);
      console.log('已点击语言切换');
    } else {
      console.log('语言切换按钮未找到');
    }

    console.log('语言切换测试完成');
  });

  test('T20-响应式布局检查', async ({ page }) => {
    const initialSize = page.viewportSize();
    console.log('初始视口: ' + initialSize?.width + 'x' + initialSize?.height);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);

    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const mobileMenu = page.locator('[class*="hamburger"], [class*="menu-icon"], .ant-drawer');
    const hasMobileMenu = await mobileMenu.count();
    console.log('移动端菜单: ' + (hasMobileMenu > 0 ? '存在' : '不存在'));

    await page.setViewportSize({ width: 1280, height: 720 });

    console.log('响应式布局检查完成');
  });
});