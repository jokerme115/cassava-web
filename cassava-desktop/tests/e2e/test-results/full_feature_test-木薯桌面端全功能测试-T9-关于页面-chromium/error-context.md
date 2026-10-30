# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full_feature_test.spec.ts >> 木薯桌面端全功能测试 >> T9-关于页面
- Location: tests\full_feature_test.spec.ts:153:7

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
        - button "设置" [ref=e17] [cursor=pointer]
        - button "数据备份与恢复" [ref=e18] [cursor=pointer]
        - button "联系我们" [ref=e19] [cursor=pointer]
        - button "关于" [active] [ref=e20] [cursor=pointer]
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
      - heading "关于系统" [level=1] [ref=e51]
      - paragraph [ref=e52]: 木薯采后腐烂面积智能预测系统
    - generic [ref=e53]:
      - generic [ref=e54]:
        - generic [ref=e55]:
          - generic [ref=e56]:
            - img [ref=e58]
            - generic [ref=e60]:
              - heading "木薯腐烂面积精准量化系统" [level=2] [ref=e61]
              - paragraph [ref=e62]: v1.2.0
          - paragraph [ref=e63]: 本系统由中国热带农业科学院热带作物品种资源研究所"木薯研究中心"与海南师范大学信息科学技术学院"龙海侠团队"联合开发。
        - generic [ref=e64]:
          - heading "技术架构" [level=3] [ref=e65]
          - generic [ref=e66]:
            - generic [ref=e67]:
              - generic [ref=e68]: Electron
              - generic [ref=e69]: ...
            - generic [ref=e70]:
              - generic [ref=e71]: Chrome
              - generic [ref=e72]: ...
            - generic [ref=e73]:
              - generic [ref=e74]: Node.js
              - generic [ref=e75]: ...
            - generic [ref=e76]:
              - generic [ref=e77]: Python
              - generic [ref=e78]: ...
            - generic [ref=e79]:
              - generic [ref=e80]: PyTorch
              - generic [ref=e81]: ...
            - generic [ref=e82]:
              - generic [ref=e83]: CUDA
              - generic [ref=e84]: 不支持
        - generic [ref=e85]:
          - heading "系统信息" [level=3] [ref=e86]
          - generic [ref=e87]:
            - generic [ref=e88]:
              - generic [ref=e89]:
                - img [ref=e90]
                - generic [ref=e92]: 平台
              - generic [ref=e93]: Windows (x64)
            - generic [ref=e94]:
              - generic [ref=e95]:
                - img [ref=e96]
                - generic [ref=e98]: 数据目录
              - generic [ref=e99]: ...
            - generic [ref=e100]:
              - generic [ref=e101]:
                - img [ref=e102]
                - generic [ref=e106]: 数据库
              - generic [ref=e107]: ...
            - generic [ref=e108]:
              - generic [ref=e109]:
                - img [ref=e110]
                - generic [ref=e113]: 运行时间
              - generic [ref=e114]: ...
      - generic [ref=e115]:
        - generic [ref=e116]:
          - heading "核心功能" [level=3] [ref=e117]
          - generic [ref=e118]:
            - generic [ref=e119]:
              - img [ref=e121]
              - generic [ref=e124]:
                - paragraph [ref=e125]: 木薯采后腐烂检测
                - paragraph [ref=e126]: 基于改进 Mask R-CNN + CBAM 模型，实现精准的病斑分割
            - generic [ref=e127]:
              - img [ref=e129]
              - generic [ref=e131]:
                - paragraph [ref=e132]: 高效预测
                - paragraph [ref=e133]: 1 秒可处理 20 张图片，像素级分割误差 < 2.1%
            - generic [ref=e134]:
              - img [ref=e136]
              - generic [ref=e140]:
                - paragraph [ref=e141]: 离线优先
                - paragraph [ref=e142]: 本地 SQLite 数据库，所有数据存储在本地，确保数据安全
            - generic [ref=e143]:
              - img [ref=e145]
              - generic [ref=e147]:
                - paragraph [ref=e148]: 跨平台桌面
                - paragraph [ref=e149]: 基于 Electron 构建，支持 Windows、macOS、Linux
        - generic [ref=e150]:
          - heading "致谢" [level=3] [ref=e151]
          - paragraph [ref=e152]: 本系统基于以下开源项目构建：
          - list [ref=e153]:
            - listitem [ref=e154]: • React + TypeScript + Tailwind CSS
            - listitem [ref=e155]: • Electron
            - listitem [ref=e156]: • Django + Django REST Framework
            - listitem [ref=e157]: • PyTorch + torchvision
            - listitem [ref=e158]: • OpenCV
        - generic [ref=e159]:
          - heading "联系我们" [level=3] [ref=e160]
          - paragraph [ref=e161]:
            - text: 海南师范大学信息科学技术学院
            - text: 龙海侠教授团队
            - text: 邮箱：longhaixia@hainnu.edu.cn
          - button "查看更多联系方式" [ref=e162] [cursor=pointer]
```

# Test source

```ts
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
> 162 |     expect(hasVersion).toBeGreaterThan(0);
      |                        ^ Error: expect(received).toBeGreaterThan(expected)
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
  230 |       if (await link.count() > 0) {
  231 |         await link.click();
  232 |         await page.waitForTimeout(1000);
  233 |         console.log('已点击: ' + section);
  234 |       }
  235 |     }
  236 | 
  237 |     console.log('顶部导航测试完成');
  238 |   });
  239 | 
  240 |   test('T15-图片上传流程', async ({ page }) => {
  241 |     await page.click('text=图片管理');
  242 |     await page.waitForTimeout(2000);
  243 | 
  244 |     const uploadBtn = page.locator('button').filter({ hasText: /上传|导入/ }).first();
  245 |     if (await uploadBtn.count() > 0) {
  246 |       await uploadBtn.click();
  247 |       await page.waitForTimeout(1000);
  248 | 
  249 |       const dialog = page.locator('.ant-modal, [class*="dialog"]');
  250 |       const hasDialog = await dialog.count();
  251 |       console.log('上传对话框: ' + (hasDialog > 0 ? '存在' : '不存在'));
  252 |     }
  253 | 
  254 |     console.log('图片上传流程测试完成');
  255 |   });
  256 | 
  257 |   test('T16-预测创建流程', async ({ page }) => {
  258 |     await page.click('text=预测');
  259 |     await page.waitForTimeout(2000);
  260 | 
  261 |     const body = page.locator('body');
  262 |     await expect(body).toBeVisible();
```