# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full_feature_test.spec.ts >> 木薯桌面端全功能测试 >> T18-结果详情查看
- Location: tests\full_feature_test.spec.ts:291:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('text=结果中心')

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
  - generic [ref=e48]:
    - generic [ref=e51]:
      - generic [ref=e52]:
        - generic [ref=e53]:
          - generic [ref=e54]:
            - img [ref=e55]
            - text: 中国热带农业科学院&海南师范大学
          - heading "木薯采后腐烂面积智能预测系统" [level=1] [ref=e58]
          - paragraph [ref=e59]: 联合实验室成果沉淀为可用平台
          - paragraph [ref=e60]: 把木薯采后腐烂量化研究转化为可视化、可回溯、可协作的检测界面。
          - generic [ref=e61]:
            - button "开始体验" [ref=e62] [cursor=pointer]:
              - text: 开始体验
              - img [ref=e63]
            - button "观看演示" [ref=e65] [cursor=pointer]
        - generic [ref=e66]:
          - generic [ref=e67]:
            - generic [ref=e68]:
              - generic [ref=e69]: 0+
              - generic [ref=e70]: 总访问量
            - generic [ref=e71]:
              - generic [ref=e72]: 98%
              - generic [ref=e73]: 预测准确率
            - generic [ref=e74]:
              - generic [ref=e75]: 0+
              - generic [ref=e76]: 预测功能使用次数
            - generic [ref=e77]:
              - generic [ref=e78]: 0+
              - generic [ref=e79]: 预测图片总数
          - generic [ref=e80]:
            - button "木薯采后腐烂面积智能预测系统" [ref=e81] [cursor=pointer]
            - button "木薯采后腐烂面积智能预测系统" [ref=e82] [cursor=pointer]
            - button "木薯采后腐烂面积智能预测系统" [ref=e83] [cursor=pointer]
      - generic [ref=e84]:
        - generic [ref=e85]:
          - generic:
            - generic:
              - generic:
                - generic:
                  - img
                - generic:
                  - generic:
                    - paragraph: Pipeline
                    - paragraph: Upload -> Segment -> Predict
                    - paragraph: 公共浏览、任务处理、结果归档拆分清晰。
                  - generic:
                    - paragraph: Access
                    - paragraph: Private OSS + Signed URL
                    - paragraph: 远程访问正常，原图按需签名获取。
            - generic:
              - generic: AI Segmentation
              - paragraph: 农业农村部木薯种质资源保护与利用重点实验室+海南师范大学龙海侠团队实验室联合出品
          - generic:
            - generic:
              - generic:
                - generic:
                  - img
                - generic:
                  - generic:
                    - paragraph: Pipeline
                    - paragraph: Upload -> Segment -> Predict
                    - paragraph: 公共浏览、任务处理、结果归档拆分清晰。
                  - generic:
                    - paragraph: Access
                    - paragraph: Private OSS + Signed URL
                    - paragraph: 远程访问正常，原图按需签名获取。
            - generic:
              - generic: Image Archive
              - paragraph: 科研样本、图像与分析流程集中管理
          - generic [ref=e86]:
            - generic [ref=e89]:
              - img [ref=e92]
              - generic [ref=e96]:
                - generic [ref=e97]:
                  - paragraph [ref=e98]: Pipeline
                  - paragraph [ref=e99]: Upload -> Segment -> Predict
                  - paragraph [ref=e100]: 公共浏览、任务处理、结果归档拆分清晰。
                - generic [ref=e101]:
                  - paragraph [ref=e102]: Access
                  - paragraph [ref=e103]: Private OSS + Signed URL
                  - paragraph [ref=e104]: 远程访问正常，原图按需签名获取。
            - generic [ref=e106]:
              - generic [ref=e107]: Research Delivery
              - paragraph [ref=e108]: 联合实验室成果沉淀为可用平台
        - generic [ref=e109]:
          - generic [ref=e110]:
            - img [ref=e112]
            - heading "数据" [level=3] [ref=e122]
            - paragraph [ref=e123]: 18.4 万张 5 通道多光谱影像，覆盖 1 096 份核心种质
          - generic [ref=e124]:
            - img [ref=e126]
            - heading "速度" [level=3] [ref=e128]
            - paragraph [ref=e129]: 1秒预测20张，支持批量离线处理
          - generic [ref=e130]:
            - img [ref=e132]
            - heading "落地" [level=3] [ref=e134]
            - paragraph [ref=e135]: 已在儋州、白沙、琼中示范 410 亩，累计减损 54 t
          - generic [ref=e136]:
            - img [ref=e138]
            - heading "系统架构" [level=3] [ref=e143]
            - paragraph [ref=e144]: 数据采集 → 数据标注 → 模型训练 → 面积换算 → 前端展示
    - generic [ref=e146]:
      - generic [ref=e147]:
        - paragraph [ref=e148]: 核心优势
        - heading "我们的系统在木薯腐烂面积预测方面具有独特优势" [level=2] [ref=e149]
        - generic [ref=e150]:
          - generic [ref=e151]:
            - img [ref=e152]
            - paragraph [ref=e155]: 木薯采后 48 h 内一旦出现细菌性软腐，损失率可达 30 % 以上。传统人工勾绘每 100 筐需 2.5 人·时，误差 > 15 %。
          - generic [ref=e156]:
            - img [ref=e157]
            - paragraph [ref=e160]: 18.4 万张 5 通道多光谱影像，覆盖 1 096 份核心种质
          - generic [ref=e161]:
            - img [ref=e162]
            - paragraph [ref=e165]: 1秒预测20张，误差 < 2.1%
      - generic [ref=e166]:
        - article [ref=e167]:
          - img [ref=e169]
          - heading "国家木薯种质资源圃（儋州）/ 木薯研究中心" [level=3] [ref=e172]
          - generic [ref=e173]:
            - generic [ref=e174]:
              - paragraph [ref=e175]: 负责人/团队
              - paragraph [ref=e176]: 木薯研究中心 / 国家木薯产业技术体系
            - generic [ref=e177]:
              - paragraph [ref=e178]: 依托平台
              - paragraph [ref=e179]: 主要职责：1.木薯种质资源保护利用与品种选育；2.高产栽培技术研究；3.采后处理与加工利用研究。
            - generic [ref=e180]:
              - paragraph [ref=e181]: 研究方向
              - paragraph [ref=e182]: 主要进展：1.考察收集保存木薯资源，培育优良新品种、获新品种权及国审品种；2.推动“食品化-饲料化-基质化”一体化（食用菜谱、特色食品、叶粉加工、茎秆基质利用、生物发酵饲料、全程机械化）；3.依托国家体系与CIAT等国内外机构深度合作，支撑获国家国际科技合作奖。
        - article [ref=e183]:
          - img [ref=e185]
          - heading "海南师范大学龙海侠实验室" [level=3] [ref=e189]
          - generic [ref=e190]:
            - generic [ref=e191]:
              - paragraph [ref=e192]: 负责人/团队
              - paragraph [ref=e193]: 龙海侠教授牵头，团队包含刘波、余霞、马翠花等多位互补专家，拥有IEEE高级会员、全球前2%顶尖科学家等高水平人才。现有博士生2名、研究生13名、本科生3名，分为网安、生信、生态、复杂网络4个研究组。
            - generic [ref=e194]:
              - paragraph [ref=e195]: 依托平台
              - paragraph [ref=e196]: 教育部重点实验室数据科学与智慧教育、海南省工程研究中心数据技术与应用
            - generic [ref=e197]:
              - paragraph [ref=e198]: 研究方向
              - paragraph [ref=e199]: 核心研究领域：1.网络空间安全（区块链诈骗检测、联邦隐私保护）；2.生物信息学（非编码RNA与疾病关联、单细胞肿瘤药物反应）；3.生态与农业智能检测（菠萝蜜/橙子无损检测、鸟类/两栖声学识别、木薯腐烂量化）；4.复杂网络与人工智能理论。 以第一或通讯作者在Computers in Biology and Medicine等国内外重要期刊发表高水平论文60余篇，近五年SCI论文32篇。 获授权专利11项，软件著作权15项。主持国家自然科学基金2项、省基金4项，获海南省科技进步奖1项等。
    - generic [ref=e202]:
      - generic [ref=e203]:
        - paragraph [ref=e204]: 开启智能农业新时代
        - heading "立即体验我们的木薯腐烂面积智能预测系统，感受AI技术为农业带来的革命性变化" [level=2] [ref=e205]
      - generic [ref=e206]:
        - button "立即开始检测" [ref=e207] [cursor=pointer]:
          - text: 立即开始检测
          - img [ref=e208]
        - button "联系我们" [ref=e210] [cursor=pointer]
```

# Test source

```ts
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
  263 | 
  264 |     const modelSelect = page.locator('.ant-select');
  265 |     const hasSelect = await modelSelect.count();
  266 |     console.log('模型选择器: ' + (hasSelect > 0 ? '存在' : '不存在'));
  267 | 
  268 |     const predictBtn = page.locator('button:has-text("预测")');
  269 |     const hasPredictBtn = await predictBtn.count();
  270 |     console.log('预测按钮: ' + (hasPredictBtn > 0 ? '存在' : '不存在'));
  271 | 
  272 |     console.log('预测创建流程测试完成');
  273 |   });
  274 | 
  275 |   test('T17-任务详情查看', async ({ page }) => {
  276 |     await page.click('text=任务中心');
  277 |     await page.waitForTimeout(3000);
  278 | 
  279 |     const taskRow = page.locator('.ant-table-row, [class*="task-item"]').first();
  280 |     if (await taskRow.count() > 0) {
  281 |       await taskRow.click();
  282 |       await page.waitForTimeout(1000);
  283 |       console.log('已点击任务行');
  284 |     } else {
  285 |       console.log('没有任务行（可能为空状态）');
  286 |     }
  287 | 
  288 |     console.log('任务详情查看测试完成');
  289 |   });
  290 | 
  291 |   test('T18-结果详情查看', async ({ page }) => {
> 292 |     await page.click('text=结果中心');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
  293 |     await page.waitForTimeout(3000);
  294 | 
  295 |     const resultCard = page.locator('[class*="result-card"], [class*="card"]').first();
  296 |     if (await resultCard.count() > 0) {
  297 |       await resultCard.click();
  298 |       await page.waitForTimeout(1000);
  299 |       console.log('已点击结果卡片');
  300 |     } else {
  301 |       console.log('没有结果卡片（可能为空状态）');
  302 |     }
  303 | 
  304 |     console.log('结果详情查看测试完成');
  305 |   });
  306 | 
  307 |   test('T19-语言切换', async ({ page }) => {
  308 |     const langButton = page.locator('[class*="lang"], [class*="language"]').first();
  309 |     const langButtonAlt = page.locator('button:has-text("EN")');
  310 |     const langButtonAlt2 = page.locator('button:has-text("中")');
  311 |     const hasLangBtn = await langButton.count() + await langButtonAlt.count() + await langButtonAlt2.count();
  312 | 
  313 |     if (hasLangBtn > 0) {
  314 |       const btn = langButton.count() > 0 ? langButton : (langButtonAlt.count() > 0 ? langButtonAlt : langButtonAlt2);
  315 |       await btn.first().click();
  316 |       await page.waitForTimeout(1000);
  317 |       console.log('已点击语言切换');
  318 |     } else {
  319 |       console.log('语言切换按钮未找到');
  320 |     }
  321 | 
  322 |     console.log('语言切换测试完成');
  323 |   });
  324 | 
  325 |   test('T20-响应式布局检查', async ({ page }) => {
  326 |     const initialSize = page.viewportSize();
  327 |     console.log('初始视口: ' + initialSize?.width + 'x' + initialSize?.height);
  328 | 
  329 |     await page.setViewportSize({ width: 375, height: 667 });
  330 |     await page.waitForTimeout(1000);
  331 | 
  332 |     await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
  333 |     await page.waitForTimeout(2000);
  334 | 
  335 |     const mobileMenu = page.locator('[class*="hamburger"], [class*="menu-icon"], .ant-drawer');
  336 |     const hasMobileMenu = await mobileMenu.count();
  337 |     console.log('移动端菜单: ' + (hasMobileMenu > 0 ? '存在' : '不存在'));
  338 | 
  339 |     await page.setViewportSize({ width: 1280, height: 720 });
  340 | 
  341 |     console.log('响应式布局检查完成');
  342 |   });
  343 | });
```