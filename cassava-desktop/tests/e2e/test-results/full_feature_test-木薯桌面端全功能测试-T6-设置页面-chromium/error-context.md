# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full_feature_test.spec.ts >> 木薯桌面端全功能测试 >> T6-设置页面
- Location: tests\full_feature_test.spec.ts:105:7

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
        - button "模型管理" [ref=e16] [cursor=pointer]
        - button "设置" [active] [ref=e17] [cursor=pointer]
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
      - heading "设置" [level=1] [ref=e51]
      - paragraph [ref=e52]: 管理系统设置和缓存
    - generic [ref=e53]:
      - generic [ref=e54]:
        - generic [ref=e55]:
          - img [ref=e57]
          - generic [ref=e59]:
            - heading "缓存管理" [level=2] [ref=e60]
            - paragraph [ref=e61]: 清理缩略图和临时文件
        - generic [ref=e62]: 加载缓存信息失败
      - generic [ref=e63]:
        - generic [ref=e64]:
          - img [ref=e66]
          - generic [ref=e68]:
            - heading "推理设置" [level=2] [ref=e69]
            - paragraph [ref=e70]: 配置 GPU/CPU 推理选项
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]:
              - img [ref=e74]
              - generic [ref=e76]:
                - paragraph [ref=e77]: 启用 GPU 加速
                - paragraph [ref=e78]: 使用 NVIDIA/AMD GPU 加速预测
            - switch [checked] [ref=e79] [cursor=pointer]
          - generic [ref=e82]:
            - generic [ref=e83]:
              - img [ref=e84]
              - generic [ref=e87]:
                - paragraph [ref=e88]: 强制使用 CPU
                - paragraph [ref=e89]: 禁用 GPU，使用 CPU 进行预测
            - switch [ref=e90] [cursor=pointer]
          - paragraph [ref=e94]: 注意：更改推理设置后需要重启应用才能生效。
      - generic [ref=e95]:
        - generic [ref=e96]:
          - img [ref=e98]
          - generic [ref=e101]:
            - heading "其他设置" [level=2] [ref=e102]
            - paragraph [ref=e103]: 更多系统设置
        - generic [ref=e104]:
          - button "重建图片索引 检测外部引用图片是否有效" [ref=e105] [cursor=pointer]:
            - generic [ref=e106]:
              - img [ref=e107]
              - generic [ref=e112]:
                - paragraph [ref=e113]: 重建图片索引
                - paragraph [ref=e114]: 检测外部引用图片是否有效
          - button "关于系统 查看版本信息和系统状态" [ref=e115] [cursor=pointer]:
            - generic [ref=e116]:
              - img [ref=e117]
              - generic [ref=e121]:
                - paragraph [ref=e122]: 关于系统
                - paragraph [ref=e123]: 查看版本信息和系统状态
      - generic [ref=e124]:
        - generic [ref=e125]:
          - img [ref=e127]
          - generic [ref=e130]:
            - heading "软件更新" [level=2] [ref=e131]
            - paragraph [ref=e132]: 检查并安装最新版本
        - generic [ref=e134]:
          - generic [ref=e137]:
            - paragraph [ref=e138]: 当前版本
            - paragraph [ref=e139]: 1.0.0
          - button "检查更新" [ref=e140] [cursor=pointer]:
            - img [ref=e141]
            - text: 检查更新
      - generic [ref=e146]:
        - generic [ref=e147]:
          - img [ref=e149]
          - generic [ref=e151]:
            - heading "快捷键设置" [level=2] [ref=e152]
            - paragraph [ref=e153]: 自定义键盘快捷键
        - generic [ref=e154]:
          - generic [ref=e155]:
            - generic [ref=e156]: settings.shortcuts.newPrediction
            - button "ctrl+n" [ref=e157] [cursor=pointer]
          - generic [ref=e158]:
            - generic [ref=e159]: settings.shortcuts.openImages
            - button "ctrl+o" [ref=e160] [cursor=pointer]
          - generic [ref=e161]:
            - generic [ref=e162]: settings.shortcuts.openSettings
            - button "ctrl+," [ref=e163] [cursor=pointer]
          - generic [ref=e164]:
            - generic [ref=e165]: settings.shortcuts.toggleDarkMode
            - button "ctrl+d" [ref=e166] [cursor=pointer]
          - generic [ref=e167]:
            - generic [ref=e168]: settings.shortcuts.showHelp
            - button "ctrl+/" [ref=e169] [cursor=pointer]
          - generic [ref=e170]:
            - generic [ref=e171]: settings.shortcuts.goHome
            - button "ctrl+h" [ref=e172] [cursor=pointer]
          - generic [ref=e173]:
            - generic [ref=e174]: settings.shortcuts.cancel
            - button "escape" [ref=e175] [cursor=pointer]
```

# Test source

```ts
  16  | 
  17  |     const statsSection = page.locator('[class*="rounded-3xl"]');
  18  |     const statsCount = await statsSection.count();
  19  |     expect(statsCount).toBeGreaterThan(0);
  20  | 
  21  |     const ctaButton = page.locator('button:has-text("开始预测")');
  22  |     await expect(ctaButton.first()).toBeVisible();
  23  | 
  24  |     const featureSection = page.locator('text=AI智能分析');
  25  |     await expect(featureSection).toBeVisible();
  26  | 
  27  |     console.log('首页测试完成');
  28  |   });
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
> 116 |     expect(hasSave).toBeGreaterThan(0);
      |                     ^ Error: expect(received).toBeGreaterThan(expected)
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
  129 |     expect(hasModels).toBeGreaterThan(0);
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
```