# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full_feature_test.spec.ts >> 木薯桌面端全功能测试 >> T7-模型管理页面
- Location: tests\full_feature_test.spec.ts:121:7

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - generic [ref=e6]:
      - button "木薯腐烂面积精准量化系统 CASSAVA LAB 木薯腐烂面积精准量化系统" [ref=e7] [cursor=pointer]:
        - img "木薯腐烂面积精准量化系统" [ref=e9]
        - generic [ref=e10]:
          - paragraph [ref=e11]: CASSAVA LAB
          - heading "木薯腐烂面积精准量化系统" [level=1] [ref=e12]
      - generic [ref=e13]:
        - button "首页" [ref=e14] [cursor=pointer]
        - button "图片管理" [ref=e15] [cursor=pointer]
        - button "模型管理" [active] [ref=e16] [cursor=pointer]
        - button "设置" [ref=e17] [cursor=pointer]
        - button "数据备份与恢复" [ref=e18] [cursor=pointer]
        - button "联系我们" [ref=e19] [cursor=pointer]
        - button "关于" [ref=e20] [cursor=pointer]
        - button "智能分析" [ref=e22] [cursor=pointer]:
          - img [ref=e23]
          - text: 智能分析
          - img [ref=e33]
      - generic [ref=e35]:
        - button [ref=e36] [cursor=pointer]:
          - img [ref=e37]
        - button "中文" [ref=e40] [cursor=pointer]:
          - img [ref=e41]
          - text: 中文
          - img [ref=e45]
  - generic [ref=e49]:
    - generic [ref=e50]:
      - heading "模型管理" [level=1] [ref=e51]
      - paragraph [ref=e52]: 查看和管理预测模型
    - generic [ref=e53]:
      - generic [ref=e54]:
        - img [ref=e56]
        - heading "模型说明" [level=2] [ref=e62]
      - list [ref=e63]:
        - listitem [ref=e64]:
          - img [ref=e65]
          - text: M6 Best 模型是专门为木薯病斑分割训练的深度学习模型
        - listitem [ref=e68]:
          - img [ref=e69]
          - text: ResNet 系列适合通用图像分割任务
        - listitem [ref=e72]:
          - img [ref=e73]
          - text: MobileNet 适合移动端部署，推理速度快但精度略低
        - listitem [ref=e76]:
          - img [ref=e77]
          - text: 当前版本已接入 M6 Best、ResNet101 和两阶段 YOLO 裁切模型
```

# Test source

```ts
  29  | 
  30  |   test('T2-图片管理页面', async ({ page }) => {
  31  |     await page.click('text=图片管理');
  32  |     await page.waitForTimeout(3000);
  33  | 
  34  |     const pageContent = page.locator('body');
  35  |     await expect(pageContent).toBeVisible();
  36  | 
  37  |     const uploadButtons = page.locator('button').filter({ hasText: /上传|导入|Upload|Import/ });
  38  |     const uploadCount = await uploadButtons.count();
  39  |     expect(uploadCount).toBeGreaterThan(0);
  40  | 
  41  |     const listContainer = page.locator('.ant-spin, [class*="list"], [class*="grid"]');
  42  |     const hasList = await listContainer.count();
  43  |     expect(hasList).toBeGreaterThan(0);
  44  | 
  45  |     console.log('图片管理页面测试完成');
  46  |   });
  47  | 
  48  |   test('T3-预测模块页面', async ({ page }) => {
  49  |     await page.click('text=预测');
  50  |     await page.waitForTimeout(3000);
  51  | 
  52  |     await expect(page.locator('body')).toBeVisible();
  53  | 
  54  |     const modelSelector = page.locator('.ant-select, [class*="select"]');
  55  |     const hasSelector = await modelSelector.count();
  56  |     expect(hasSelector).toBeGreaterThan(0);
  57  | 
  58  |     const predictButton = page.locator('button:has-text("预测")');
  59  |     const predictButtonAlt = page.locator('button:has-text("开始")');
  60  |     const predictCount = await predictButton.count() + await predictButtonAlt.count();
  61  |     expect(predictCount).toBeGreaterThan(0);
  62  | 
  63  |     const uploadArea = page.locator('[class*="upload"], [class*="drop"]');
  64  |     await uploadArea.count();
  65  | 
  66  |     console.log('预测模块测试完成');
  67  |   });
  68  | 
  69  |   test('T4-任务中心页面', async ({ page }) => {
  70  |     await page.click('text=任务中心');
  71  |     await page.waitForTimeout(3000);
  72  | 
  73  |     const body = page.locator('body');
  74  |     await expect(body).toBeVisible();
  75  | 
  76  |     const taskList = page.locator('.ant-table, [class*="task"], [class*="list"]');
  77  |     const hasList = await taskList.count();
  78  |     expect(hasList).toBeGreaterThan(0);
  79  | 
  80  |     const pagination = page.locator('.ant-pagination');
  81  |     const hasPagination = await pagination.count();
  82  |     console.log('分页组件: ' + (hasPagination > 0 ? '存在' : '不存在'));
  83  | 
  84  |     console.log('任务中心测试完成');
  85  |   });
  86  | 
  87  |   test('T5-结果中心页面', async ({ page }) => {
  88  |     await page.click('text=结果中心');
  89  |     await page.waitForTimeout(3000);
  90  | 
  91  |     await expect(page.locator('body')).toBeVisible();
  92  | 
  93  |     const resultsList = page.locator('.ant-table, [class*="result"], [class*="card"]');
  94  |     const hasResults = await resultsList.count();
  95  |     expect(hasResults).toBeGreaterThan(0);
  96  | 
  97  |     const exportButton = page.locator('button:has-text("导出")');
  98  |     const exportButtonAlt = page.locator('button:has-text("下载")');
  99  |     const hasExport = await exportButton.count() + await exportButtonAlt.count();
  100 |     console.log('导出按钮: ' + (hasExport > 0 ? '存在' : '不存在'));
  101 | 
  102 |     console.log('结果中心测试完成');
  103 |   });
  104 | 
  105 |   test('T6-设置页面', async ({ page }) => {
  106 |     await page.click('text=设置');
  107 |     await page.waitForTimeout(3000);
  108 | 
  109 |     const settingsForm = page.locator('.ant-form, form, [class*="setting"]');
  110 |     const hasForm = await settingsForm.count();
  111 |     expect(hasForm).toBeGreaterThan(0);
  112 | 
  113 |     const saveButton = page.locator('button:has-text("保存")');
  114 |     const saveButtonAlt = page.locator('button:has-text("Save")');
  115 |     const hasSave = await saveButton.count() + await saveButtonAlt.count();
  116 |     expect(hasSave).toBeGreaterThan(0);
  117 | 
  118 |     console.log('设置页面测试完成');
  119 |   });
  120 | 
  121 |   test('T7-模型管理页面', async ({ page }) => {
  122 |     await page.click('text=模型管理');
  123 |     await page.waitForTimeout(3000);
  124 | 
  125 |     await expect(page.locator('body')).toBeVisible();
  126 | 
  127 |     const modelList = page.locator('.ant-table, [class*="model"], [class*="card"]');
  128 |     const hasModels = await modelList.count();
> 129 |     expect(hasModels).toBeGreaterThan(0);
      |                       ^ Error: expect(received).toBeGreaterThan(expected)
  130 | 
  131 |     console.log('模型管理页面测试完成');
  132 |   });
  133 | 
  134 |   test('T8-备份恢复页面', async ({ page }) => {
  135 |     await page.click('text=备份');
  136 |     await page.waitForTimeout(3000);
  137 | 
  138 |     await expect(page.locator('body')).toBeVisible();
  139 | 
  140 |     const backupButton = page.locator('button:has-text("备份")');
  141 |     const backupButtonAlt = page.locator('button:has-text("Backup")');
  142 |     const hasBackup = await backupButton.count() + await backupButtonAlt.count();
  143 |     expect(hasBackup).toBeGreaterThan(0);
  144 | 
  145 |     const restoreButton = page.locator('button:has-text("恢复")');
  146 |     const restoreButtonAlt = page.locator('button:has-text("Restore")');
  147 |     const hasRestore = await restoreButton.count() + await restoreButtonAlt.count();
  148 |     console.log('恢复按钮: ' + (hasRestore > 0 ? '存在' : '不存在'));
  149 | 
  150 |     console.log('备份恢复页面测试完成');
  151 |   });
  152 | 
  153 |   test('T9-关于页面', async ({ page }) => {
  154 |     await page.click('text=关于');
  155 |     await page.waitForTimeout(3000);
  156 | 
  157 |     await expect(page.locator('body')).toBeVisible();
  158 | 
  159 |     const versionInfo = page.locator('text=版本');
  160 |     const versionInfoAlt = page.locator('text=Version');
  161 |     const hasVersion = await versionInfo.count() + await versionInfoAlt.count();
  162 |     expect(hasVersion).toBeGreaterThan(0);
  163 | 
  164 |     console.log('关于页面测试完成');
  165 |   });
  166 | 
  167 |   test('T10-联系我们页面', async ({ page }) => {
  168 |     await page.click('text=联系');
  169 |     await page.waitForTimeout(3000);
  170 | 
  171 |     await expect(page.locator('body')).toBeVisible();
  172 | 
  173 |     const contactForm = page.locator('.ant-form, form');
  174 |     const hasForm = await contactForm.count();
  175 |     expect(hasForm).toBeGreaterThan(0);
  176 | 
  177 |     console.log('联系我们页面测试完成');
  178 |   });
  179 | 
  180 |   test('T11-API后端连接测试', async ({ request }) => {
  181 |     const response = await request.get(BACKEND_URL + '/api/images/', { timeout: 10000 });
  182 |     expect(response.status()).toBeGreaterThanOrEqual(200);
  183 |     expect(response.status()).toBeLessThan(400);
  184 | 
  185 |     const data = await response.json();
  186 |     expect(data).toBeDefined();
  187 | 
  188 |     console.log('API测试完成 - 状态码: ' + response.status());
  189 |   });
  190 | 
  191 |   test('T12-键盘快捷键帮助', async ({ page }) => {
  192 |     await page.waitForTimeout(1000);
  193 | 
  194 |     await page.keyboard.press('Shift+?');
  195 |     await page.waitForTimeout(1000);
  196 | 
  197 |     const modal = page.locator('.ant-modal, [class*="modal"], [class*="dialog"]');
  198 |     const hasModal = await modal.count();
  199 |     console.log('快捷键帮助弹窗: ' + (hasModal > 0 ? '存在' : '不存在'));
  200 |   });
  201 | 
  202 |   test('T13-深色模式切换', async ({ page }) => {
  203 |     await page.waitForTimeout(1000);
  204 | 
  205 |     await page.evaluate(() => {
  206 |       document.documentElement.classList.toggle('dark');
  207 |     });
  208 | 
  209 |     const hasDarkClass = await page.evaluate(() => {
  210 |       return document.documentElement.classList.contains('dark');
  211 |     });
  212 | 
  213 |     expect(hasDarkClass).toBe(true);
  214 | 
  215 |     console.log('深色模式切换测试完成');
  216 |   });
  217 | 
  218 |   test('T14-顶部导航测试', async ({ page }) => {
  219 |     const nav = page.locator('nav, [class*="nav"], header');
  220 |     const hasNav = await nav.count();
  221 |     expect(hasNav).toBeGreaterThan(0);
  222 | 
  223 |     const navLinks = page.locator('nav a, [class*="nav"] a, header a');
  224 |     const linkCount = await navLinks.count();
  225 |     console.log('导航链接数量: ' + linkCount);
  226 | 
  227 |     const sections = ['首页', '图片管理', '预测', '任务中心', '结果中心'];
  228 |     for (const section of sections) {
  229 |       const link = page.locator('text=' + section).first();
```