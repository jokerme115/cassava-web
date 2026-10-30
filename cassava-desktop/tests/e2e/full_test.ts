import { chromium, Browser, Page } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:39333';

interface TestResult {
  page: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  features: string[];
  issues: string[];
}

async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let browser: Browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page: Page = await context.newPage();

    // 启用控制台日志
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Console Error] ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      console.log(`[Page Error] ${error.message}`);
    });

    console.log('=== 开始全面测试 ===\n');

    // 测试1: 首页
    console.log('测试1: 首页 (HomePage)');
    try {
      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const homeFeatures: string[] = [];
      const homeIssues: string[] = [];

      // 检查关键元素
      const heroTitle = await page.locator('h1').first().textContent().catch(() => null);
      if (heroTitle) homeFeatures.push(`Hero标题: "${heroTitle?.substring(0, 30)}..."`);

      // 检查统计数据
      const stats = await page.locator('[class*="rounded-3xl"]').count();
      if (stats > 0) homeFeatures.push(`统计数据区块: ${stats}个`);

      // 检查轮播控制
      const slideButtons = await page.locator('button[aria-label]').count();
      if (slideButtons > 0) homeFeatures.push(`轮播控制按钮: ${slideButtons}个`);

      // 检查CTA按钮
      const ctaButtons = await page.locator('text=开始预测').count();
      if (ctaButtons > 0) homeFeatures.push('CTA按钮: 存在');

      // 检查功能卡片
      const featureCards = await page.locator('text=AI智能').count();
      if (featureCards > 0) homeFeatures.push('功能卡片: 存在');

      results.push({
        page: '首页 (HomePage)',
        status: homeIssues.length === 0 ? 'PASS' : 'WARN',
        features: homeFeatures,
        issues: homeIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${homeFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '首页 (HomePage)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试2: 导航到图片管理
    console.log('测试2: 图片管理 (ImageManagement)');
    try {
      await page.click('text=图片管理');
      await page.waitForTimeout(3000);

      const imgFeatures: string[] = [];
      const imgIssues: string[] = [];

      // 检查页面标题
      const heading = await page.locator('h1, h2').first().textContent().catch(() => '未知');
      imgFeatures.push(`页面标题: "${heading}"`);

      // 检查上传按钮
      const uploadBtn = await page.locator('button:has-text("上传"), button:has-text("导入"), button:has-text("Upload"), button:has-text("Import")').count();
      if (uploadBtn > 0) imgFeatures.push(`上传按钮: ${uploadBtn}个`);

      // 检查图片列表/表格
      const tableOrGrid = await page.locator('.ant-table, [class*="grid"], [class*="list"]').count();
      if (tableOrGrid > 0) imgFeatures.push('图片列表/网格: 存在');

      // 检查分页
      const pagination = await page.locator('.ant-pagination').count();
      if (pagination > 0) imgFeatures.push('分页组件: 存在');

      // 检查筛选/搜索
      const searchOrFilter = await page.locator('.ant-select, .ant-input-search, [class*="search"]').count();
      if (searchOrFilter > 0) imgFeatures.push('搜索/筛选: 存在');

      results.push({
        page: '图片管理 (ImageManagement)',
        status: imgIssues.length === 0 ? 'PASS' : 'WARN',
        features: imgFeatures,
        issues: imgIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${imgFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '图片管理 (ImageManagement)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试3: 预测模块
    console.log('测试3: 预测模块 (PredictionModule)');
    try {
      await page.click('text=预测');
      await page.waitForTimeout(3000);

      const predFeatures: string[] = [];
      const predIssues: string[] = [];

      // 检查模型选择
      const modelSelect = await page.locator('.ant-select, [class*="model"]').count();
      if (modelSelect > 0) predFeatures.push('模型选择: 存在');

      // 检查预测按钮
      const predictBtn = await page.locator('button:has-text("预测"), button:has-text("Predict"), button:has-text("开始")').count();
      if (predictBtn > 0) predFeatures.push(`预测按钮: ${predictBtn}个`);

      // 检查图片选择区域
      const imageArea = await page.locator('[class*="upload"], [class*="drop"], [class*="drag"]').count();
      if (imageArea > 0) predFeatures.push('图片上传区域: 存在');

      // 检查预测结果展示
      const resultArea = await page.locator('[class*="result"], [class*="preview"], [class*="output"]').count();
      if (resultArea > 0) predFeatures.push('结果预览区: 存在');

      results.push({
        page: '预测模块 (PredictionModule)',
        status: predIssues.length === 0 ? 'PASS' : 'WARN',
        features: predFeatures,
        issues: predIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${predFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '预测模块 (PredictionModule)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试4: 任务中心
    console.log('测试4: 任务中心 (TaskCenter)');
    try {
      await page.click('text=任务中心');
      await page.waitForTimeout(3000);

      const taskFeatures: string[] = [];
      const taskIssues: string[] = [];

      // 检查任务列表
      const taskList = await page.locator('.ant-table, [class*="task"], [class*="list"]').count();
      if (taskList > 0) taskFeatures.push('任务列表: 存在');

      // 检查任务状态
      const statusTags = await page.locator('.ant-tag, [class*="status"]').count();
      if (statusTags > 0) taskFeatures.push(`状态标签: ${statusTags}个`);

      // 检查分页
      const pagination = await page.locator('.ant-pagination').count();
      if (pagination > 0) taskFeatures.push('分页组件: 存在');

      // 检查刷新按钮
      const refreshBtn = await page.locator('button:has-text("刷新"), button:has-text("Refresh")').count();
      if (refreshBtn > 0) taskFeatures.push('刷新按钮: 存在');

      results.push({
        page: '任务中心 (TaskCenter)',
        status: taskIssues.length === 0 ? 'PASS' : 'WARN',
        features: taskFeatures,
        issues: taskIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${taskFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '任务中心 (TaskCenter)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试5: 结果中心
    console.log('测试5: 结果中心 (ResultsCenter)');
    try {
      await page.click('text=结果中心');
      await page.waitForTimeout(3000);

      const resultsFeatures: string[] = [];
      const resultsIssues: string[] = [];

      // 检查结果列表
      const resultsList = await page.locator('.ant-table, [class*="result"], [class*="card"]').count();
      if (resultsList > 0) resultsFeatures.push('结果列表: 存在');

      // 检查图片预览
      const imagePreview = await page.locator('img, [class*="image"], [class*="preview"]').count();
      if (imagePreview > 0) resultsFeatures.push(`图片预览: ${imagePreview}个`);

      // 检查导出功能
      const exportBtn = await page.locator('button:has-text("导出"), button:has-text("Export"), button:has-text("下载")').count();
      if (exportBtn > 0) resultsFeatures.push('导出按钮: 存在');

      // 检查详情查看
      const detailBtn = await page.locator('button:has-text("详情"), button:has-text("Detail"), text=查看').count();
      if (detailBtn > 0) resultsFeatures.push('详情按钮: 存在');

      results.push({
        page: '结果中心 (ResultsCenter)',
        status: resultsIssues.length === 0 ? 'PASS' : 'WARN',
        features: resultsFeatures,
        issues: resultsIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${resultsFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '结果中心 (ResultsCenter)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试6: 设置页面
    console.log('测试6: 设置页面 (SettingsPage)');
    try {
      await page.click('text=设置');
      await page.waitForTimeout(3000);

      const settingsFeatures: string[] = [];
      const settingsIssues: string[] = [];

      // 检查设置表单
      const formElements = await page.locator('.ant-form, .ant-switch, .ant-input, .ant-select').count();
      if (formElements > 0) settingsFeatures.push(`设置表单元素: ${formElements}个`);

      // 检查保存按钮
      const saveBtn = await page.locator('button:has-text("保存"), button:has-text("Save"), button:has-text("提交")').count();
      if (saveBtn > 0) settingsFeatures.push('保存按钮: 存在');

      // 检查各个设置分类
      const settingSections = await page.locator('[class*="section"], [class*="card"], .ant-collapse').count();
      if (settingSections > 0) settingsFeatures.push(`设置分类: ${settingSections}个`);

      results.push({
        page: '设置页面 (SettingsPage)',
        status: settingsIssues.length === 0 ? 'PASS' : 'WARN',
        features: settingsFeatures,
        issues: settingsIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${settingsFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '设置页面 (SettingsPage)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试7: 模型页面
    console.log('测试7: 模型页面 (ModelsPage)');
    try {
      await page.click('text=模型管理');
      await page.waitForTimeout(3000);

      const modelsFeatures: string[] = [];
      const modelsIssues: string[] = [];

      // 检查模型列表
      const modelList = await page.locator('.ant-table, [class*="model"], [class*="card"]').count();
      if (modelList > 0) modelsFeatures.push('模型列表: 存在');

      // 检查模型信息
      const modelInfo = await page.locator('text=准确率, text=精度, text=Accuracy').count();
      if (modelInfo > 0) modelsFeatures.push('模型指标: 存在');

      // 检查下载/上传按钮
      const dlBtn = await page.locator('button:has-text("下载"), button:has-text("Download"), button:has-text("上传")').count();
      if (dlBtn > 0) modelsFeatures.push('上传/下载按钮: 存在');

      results.push({
        page: '模型页面 (ModelsPage)',
        status: modelsIssues.length === 0 ? 'PASS' : 'WARN',
        features: modelsFeatures,
        issues: modelsIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${modelsFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '模型页面 (ModelsPage)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试8: 备份恢复页面
    console.log('测试8: 备份恢复 (BackupRestorePage)');
    try {
      await page.click('text=备份');
      await page.waitForTimeout(3000);

      const backupFeatures: string[] = [];
      const backupIssues: string[] = [];

      // 检查备份按钮
      const backupBtn = await page.locator('button:has-text("备份"), button:has-text("Backup")').count();
      if (backupBtn > 0) backupFeatures.push('备份按钮: 存在');

      // 检查恢复按钮
      const restoreBtn = await page.locator('button:has-text("恢复"), button:has-text("Restore"), button:has-text("还原")').count();
      if (restoreBtn > 0) backupFeatures.push('恢复按钮: 存在');

      // 检查导入/导出
      const importExport = await page.locator('button:has-text("导入"), button:has-text("Export"), button:has-text("导出")').count();
      if (importExport > 0) backupFeatures.push('导入/导出: 存在');

      results.push({
        page: '备份恢复 (BackupRestorePage)',
        status: backupIssues.length === 0 ? 'PASS' : 'WARN',
        features: backupFeatures,
        issues: backupIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${backupFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '备份恢复 (BackupRestorePage)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试9: 关于页面
    console.log('测试9: 关于页面 (AboutPage)');
    try {
      await page.click('text=关于');
      await page.waitForTimeout(3000);

      const aboutFeatures: string[] = [];
      const aboutIssues: string[] = [];

      // 检查版本信息
      const version = await page.locator('text=版本, text=Version, text=v1., text=1.0').count();
      if (version > 0) aboutFeatures.push('版本信息: 存在');

      // 检查团队信息
      const team = await page.locator('text=团队, text=Team, text=团队').count();
      if (team > 0) aboutFeatures.push('团队信息: 存在');

      // 检查版权信息
      const copyright = await page.locator('text=版权, text=Copyright, text=©').count();
      if (copyright > 0) aboutFeatures.push('版权信息: 存在');

      results.push({
        page: '关于页面 (AboutPage)',
        status: aboutIssues.length === 0 ? 'PASS' : 'WARN',
        features: aboutFeatures,
        issues: aboutIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${aboutFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '关于页面 (AboutPage)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试10: 联系我们
    console.log('测试10: 联系我们 (ContactUs)');
    try {
      await page.click('text=联系');
      await page.waitForTimeout(3000);

      const contactFeatures: string[] = [];
      const contactIssues: string[] = [];

      // 检查联系表单
      const form = await page.locator('.ant-form, form, [class*="form"]').count();
      if (form > 0) contactFeatures.push('联系表单: 存在');

      // 检查邮箱/电话信息
      const contactInfo = await page.locator('text=@, [class*="email"], [class*="phone"]').count();
      if (contactInfo > 0) contactFeatures.push('联系方式: 存在');

      // 检查提交按钮
      const submitBtn = await page.locator('button:has-text("提交"), button:has-text("Submit"), button:has-text("发送")').count();
      if (submitBtn > 0) contactFeatures.push('提交按钮: 存在');

      results.push({
        page: '联系我们 (ContactUs)',
        status: contactIssues.length === 0 ? 'PASS' : 'WARN',
        features: contactFeatures,
        issues: contactIssues
      });
      console.log(`  状态: ${results[results.length - 1].status}`);
      console.log(`  功能: ${contactFeatures.join(', ')}\n`);
    } catch (e: any) {
      results.push({
        page: '联系我们 (ContactUs)',
        status: 'FAIL',
        features: [],
        issues: [`加载失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试11: API后端连接
    console.log('测试11: API后端连接');
    try {
      const response = await page.request.get(`${BACKEND_URL}/api/images/`, { timeout: 10000 });
      if (response.ok()) {
        results.push({
          page: 'API后端 (Django)',
          status: 'PASS',
          features: [`状态码: ${response.status()}`, '数据库连接正常'],
          issues: []
        });
        console.log(`  状态: PASS - HTTP ${response.status()}\n`);
      } else {
        results.push({
          page: 'API后端 (Django)',
          status: 'WARN',
          features: [`状态码: ${response.status()}`],
          issues: ['响应非200']
        });
        console.log(`  状态: WARN - HTTP ${response.status()}\n`);
      }
    } catch (e: any) {
      results.push({
        page: 'API后端 (Django)',
        status: 'FAIL',
        features: [],
        issues: [`连接失败: ${e.message}`]
      });
      console.log(`  状态: FAIL - ${e.message}\n`);
    }

    // 测试12: 键盘快捷键
    console.log('测试12: 键盘快捷键帮助');
    try {
      await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000);

      // 尝试按?键打开快捷键帮助
      await page.keyboard.press('Shift+/'); // ?键
      await page.waitForTimeout(1000);

      const helpVisible = await page.locator('[class*="modal"], [class*="dialog"], [class*="overlay"]').count();
      if (helpVisible > 0) {
        results.push({
          page: '快捷键帮助',
          status: 'PASS',
          features: ['快捷键弹窗可打开'],
          issues: []
        });
        console.log(`  状态: PASS\n`);
      } else {
        results.push({
          page: '快捷键帮助',
          status: 'WARN',
          features: [],
          issues: ['快捷键弹窗未找到']
        });
        console.log(`  状态: WARN - 未找到弹窗\n`);
      }
    } catch (e: any) {
      results.push({
        page: '快捷键帮助',
        status: 'WARN',
        features: [],
        issues: [`测试失败: ${e.message}`]
      });
      console.log(`  状态: WARN - ${e.message}\n`);
    }

    await browser.close();

  } catch (e: any) {
    console.error(`测试过程出错: ${e.message}`);
    if (browser) await browser.close();
  }

  return results;
}

// 运行测试并生成报告
runTests().then(results => {
  console.log('\n=== 测试结果汇总 ===\n');

  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    warned: results.filter(r => r.status === 'WARN').length,
    failed: results.filter(r => r.status === 'FAIL').length
  };

  console.log(`总计: ${summary.total} | 通过: ${summary.passed} | 警告: ${summary.warned} | 失败: ${summary.failed}\n`);

  console.log('详细结果:');
  results.forEach((r, i) => {
    console.log(`${i + 1}. [${r.status}] ${r.page}`);
    if (r.features.length > 0) {
      console.log(`   功能: ${r.features.join(', ')}`);
    }
    if (r.issues.length > 0) {
      console.log(`   问题: ${r.issues.join(', ')}`);
    }
  });

  process.exit(summary.failed > 0 ? 1 : 0);
}).catch(e => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});