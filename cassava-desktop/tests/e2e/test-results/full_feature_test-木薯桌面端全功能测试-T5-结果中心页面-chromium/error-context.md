# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full_feature_test.spec.ts >> 木薯桌面端全功能测试 >> T5-结果中心页面
- Location: tests\full_feature_test.spec.ts:87:7

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
  1   | import { test, expect, Page } from '@playwright/test';
  2   | 
  3   | const FRONTEND_URL = 'http://localhost:5173';
  4   | const BACKEND_URL = 'http://localhost:39333';
  5   | 
  6   | test.describe('木薯桌面端全功能测试', () => {
  7   | 
  8   |   test.beforeEach(async ({ page }) => {
  9   |     await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 30000 });
  10  |     await page.waitForTimeout(2000);
  11  |   });
  12  | 
  13  |   test('T1-首页加载和功能', async ({ page }) => {
  14  |     const heroTitle = page.locator('h1').first();
  15  |     await expect(heroTitle).toBeVisible({ timeout: 10000 });
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
> 88  |     await page.click('text=结果中心');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
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
```