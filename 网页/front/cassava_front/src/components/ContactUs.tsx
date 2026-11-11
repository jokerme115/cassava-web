"use client"

import { Building2, Mail, MapPin, Phone, UserRound } from "lucide-react"

type ContactProfile = {
  badge: string
  title: string
  institution: string
  address: string
  email?: string
  phone?: string
  contactPerson?: string
  summary: string[]
  highlights?: string[]
  sections: Array<{
    title: string
    items: string[]
  }>
}

const profiles: ContactProfile[] = [
  {
    badge: "Hainan Normal University",
    title: "科研合作与数据共享（龙海侠 教授）",
    institution: "海南师范大学信息科学技术学院",
    address: "海南省海口市美兰区海南师范大学",
    email: "lhx@hainnu.edu.cn",
    summary: [
      "龙海侠，女，工学博士，教授，博士生导师，CCF高级会员，海南省南海名家，海南省高层次拔尖人才，海南省一流本科专业负责人，海南省优秀研究生导师，海南省科技专家。",
      "国家自然科学基金函评专家，海南省科技厅项目评审专家，广东科技厅评审专家，海南省大数据管理局政务信息化项目评审专家。教育部重点实验室数据科学与智慧教育、海南省重点实验室计算科学与应用、海南省工程研究中心数据技术与应用骨干成员。",
      "研究领域为人工智能（机器学习、深度学习）、网络空间安全。"
    ],
    highlights: [
      "国家自然科学基金 2 项",
      "海南省自然科学基金项目 4 项",
      "高水平论文 60 余篇",
      "专著 3 部",
      "授权专利 11 项",
      "省级以上竞赛奖励 32 项"
    ],
    sections: [
      {
        title: "招生方向",
        items: [
          "网络空间安全",
          "电子信息（计算机技术、人工智能、网络与信息安全）"
        ]
      },
      {
        title: "主要学习和工作经历",
        items: [
          "2000.09-2004.07 河南大学 计算机科学与技术 本科 / 学士",
          "2004.09-2007.07 江南大学 计算机软件与理论 硕士研究生 / 硕士",
          "2007.09-2010.06 江南大学 轻工信息技术与工程 博士研究生 / 博士",
          "2016.07-2017.08 美国密苏里大学 计算机科学与技术 访问学者",
          "2010.07-2012.11 海南师范大学 讲师",
          "2012.12-2018.11 海南师范大学 副教授",
          "2018.12-至今 海南师范大学 教授"
        ]
      },
      {
        title: "主持科研项目",
        items: [
          "国家自然科学基金（62262019）：基于图神经网络模型的单细胞 RNA-seq 数据分析，2023.01-2026.12，在研，主持",
          "国家自然科学基金（61762034）：基于深度学习方法预测蛋白质翻译后修饰位点，2018.01-2021.12，结题，主持",
          "海南省自然科学基金（618MS057）：深度学习中的神经网络在蛋白质翻译后修饰鉴定中的应用，2018.03-2020.12，结题，主持",
          "海南省自然科学基金项目（614235）：群体智能优化算法和剖面 HMM 在蛋白质结构比对中的应用，2014.01-2015.07，结题，主持",
          "海南省自然科学基金项目（611131）：群体智能算法及其在代谢通量评估中的应用，2012.01-2012.06，结题，主持",
          "海南省高等学校科学研究项目（Hjkj2013-22）：进化算法在蛋白质结构预测中的应用，2013.01-2015.03，结题，主持"
        ]
      },
      {
        title: "第一作者或通讯作者期刊论文（节选）",
        items: [
          "Computers in Biology and Medicine, 2024：NIMEQ-SACNet，自注意力精准医疗糖尿病视网膜病变模型",
          "Electronics, 2023：WGM-dSAGA，具备 Byzantine 鲁棒性的联邦学习策略",
          "Methods, 2023：基于有向图神经网络的单细胞 RNA-seq 数据分析",
          "Electronics, 2023：NT-GNN，面向 5G 移动物联网 Android 恶意软件检测",
          "Frontiers in Genetics, 2022：基于图自编码器与图注意网络的单细胞 RNA-seq 分析",
          "Scientific Reports, 2022：用于 Android 恶意软件分类的卷积神经网络模型",
          "IEEE Access, 2021：恶意代码分类中的深度学习与正则化算法",
          "Current Bioinformatics, 2020：基于深度学习的蛋白质磷酸化位点预测",
          "International Journal of Molecular Sciences, 2019：甲状腺癌分子网络药物预测",
          "Frontiers in Genetics, 2019：QS-Net 系统发育网络重建",
          "International Journal of Molecular Sciences, 2018：蛋白质羟基化位点混合深度学习预测模型"
        ]
      },
      {
        title: "专著、奖励与专利",
        items: [
          "专著 3 部：《深度学习算法及其在网络空间安全中的应用》《进化算法及其在生物信息中的应用》《进化算法在生物多序列比对中的应用》",
          "海南省科技进步奖三等奖（2014）",
          "海南省高等学校优秀科研成果奖三等奖（2016）",
          "已获授权专利 11 项，代表成果涵盖安全监控、海上风险评估、网络主动防御、生态与旅游监测、自然语言处理、智能运维与样本监控等方向"
        ]
      }
    ]
  },
  {
    badge: "CATAS Cassava Center",
    title: "木薯研究中心合作窗口",
    institution: "中国热带农业科学院热带作物品种资源研究所木薯研究中心",
    address: "海南省儋州市宝岛新村中国热带农业科学院热带作物品种资源研究所",
    email: "aff85110@163.com",
    phone: "0898-66961663",
    contactPerson: "联系人：安飞飞 研究员",
    summary: [
      "安飞飞，女，博士，研究员，硕士生导师，海南自贸港 D 类人才、三亚崖州湾科技城 E 类人才，2023 年入选院“热科优青”计划，国家自然科学基金网络评审专家，农业农村部重点实验室秘书，海南省“双百”人才团队核心成员，专业技术六级岗专家。",
      "长期从事木薯种质资源分子评价及育种工作，主要围绕木薯块根耐贮机理解析及种质创制两大方向开展科技攻关。",
      "主持包括国家自然科学基金在内科研项目 8 项，发表科技论文 30 篇，其中 SCI 收录 12 篇；授权国家发明专利 3 件，育成国审木薯品种 2 个，获植物新品种权 5 件，出版专著 3 部。"
    ],
    highlights: [
      "国家自然科学基金等项目 8 项",
      "科技论文 30 篇",
      "SCI 收录 12 篇",
      "国家发明专利 3 件",
      "国审木薯品种 2 个",
      "植物新品种权 5 件"
    ],
    sections: [
      {
        title: "研究领域",
        items: [
          "木薯生物育种",
          "木薯块根耐贮机理解析",
          "木薯种质资源分子评价与种质创制"
        ]
      },
      {
        title: "主要经历",
        items: [
          "2004.09-2008.06 海南师范大学 生物科学专业 学士",
          "2008.09-2011.06 海南大学 种质资源学专业 硕士",
          "2011.07-2014.06 中国热带农业科学院热带作物品种资源研究所木薯研究中心 研究实习员",
          "2014.07-2019.12 中国热带农业科学院热带作物品种资源研究所木薯研究中心 助理研究员",
          "2018.07-2019.01 夏威夷大学马诺分校 访问学者",
          "2020.01-至今 中国热带农业科学院热带作物品种资源研究所木薯研究中心 研究员"
        ]
      },
      {
        title: "主要业绩",
        items: [
          "长期支撑木薯种质资源分子评价和木薯生物育种平台建设",
          "先后获中华农业科技优秀创新团队奖、中国热带农业科学院科学技术奖等科技奖励",
          "承担农业农村部重点实验室秘书等科研组织工作，推动资源共享与协同育种"
        ]
      }
    ]
  }
]

export default function ContactPage() {
  return (
    <div className="research-contact px-4 py-8 sm:px-8 lg:px-10 lg:py-12">
      <div className="mx-auto max-w-[1240px] space-y-8">
        <section className="contact-hero relative overflow-hidden rounded-[24px] bg-brand-fill px-6 py-8 text-white shadow-[0_4px_16px_rgba(17,24,28,0.05)] sm:px-8 sm:py-10">
          <img src="/cases/cassava-lab.jpg" alt="" className="pointer-events-none absolute right-0 top-0 h-full w-2/3 object-cover opacity-20" />
          <p className="relative text-xs font-semibold uppercase tracking-[0.12em] text-white">
            Contact & Collaboration
          </p>
          <h1 className="page-title relative mt-4 max-w-3xl text-white ">
            联系我们
          </h1>


          <div className="relative mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Research", value: "人工智能、网络空间安全、木薯生物育种" },
              { label: "Collaboration", value: "数据共享、平台共建、科研协同与招生交流" },
              { label: "Coverage", value: "高校实验室与国家级科研院所双线联动" }
            ].map((item) => (
              <div key={item.label} className="rounded-[12px] border border-white/20 bg-white/10 p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-white">{item.label}</p>
                <p className="mt-3 text-sm leading-6 text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {profiles.map((profile) => (
            <article
              key={profile.title}
              className="h-full rounded-[24px] border border-hairline bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] sm:p-8"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-fill text-white">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-text">
                    {profile.badge}
                  </p>
                  <h2 className="section-title mt-2 ">
                    {profile.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-ink-secondary">{profile.institution}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[16px] bg-surface-muted px-5 py-5 md:col-span-2">
                  <div className="flex items-center gap-3 text-sm text-muted">
                    <MapPin className="h-4 w-4" />
                    地址
                  </div>
                  <p className="mt-3 text-sm font-medium leading-7 text-ink">{profile.address}</p>
                </div>

                {profile.phone && (
                  <div className="rounded-[16px] bg-surface-muted px-5 py-5">
                    <div className="flex items-center gap-3 text-sm text-muted">
                      <Phone className="h-4 w-4" />
                      电话
                    </div>
                    <p className="mt-3 text-sm font-medium text-ink"><a href={`tel:${profile.phone}`} className="underline decoration-current/30 underline-offset-4">{profile.phone}</a></p>
                  </div>
                )}

                {profile.email && (
                  <div className={`rounded-[16px] bg-surface-muted px-5 py-5 ${profile.phone ? "" : "md:col-span-2"}`}>
                    <div className="flex items-center gap-3 text-sm text-muted">
                      <Mail className="h-4 w-4" />
                      邮箱
                    </div>
                    <p className="mt-3 break-all text-sm font-medium text-ink"><a href={`mailto:${profile.email}`} className="underline decoration-current/30 underline-offset-4">{profile.email}</a></p>
                  </div>
                )}

                {profile.contactPerson && (
                  <div className="rounded-[16px] bg-surface-muted px-5 py-5 md:col-span-2">
                    <div className="flex items-center gap-3 text-sm text-muted">
                      <UserRound className="h-4 w-4" />
                      对接联系人
                    </div>
                    <p className="mt-3 text-sm font-medium leading-7 text-ink">{profile.contactPerson}</p>
                  </div>
                )}
              </div>

              <p className="mt-5 text-sm leading-7 text-ink-secondary">{profile.badge === 'CATAS Cassava Center' ? '团队负责人：陈松笔 研究员 · 联系人：安飞飞 研究员' : '团队负责人及联系人：龙海侠 教授'}</p>
              <details className="mt-6 border-t border-hairline pt-5"><summary>查看团队与联系人完整资料</summary>
              <div className="mt-6 space-y-3">
                {profile.summary.map((paragraph, index) => (
                  <p key={`${profile.title}-summary-${index}`} className="text-sm leading-8 text-ink-secondary">
                    {paragraph}
                  </p>
                ))}
              </div>

              {profile.highlights && (
                <div className="mt-6 flex flex-wrap gap-3">
                  {profile.highlights.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[rgba(23,201,100,0.28)] bg-[rgba(10,132,255,0.08)] px-4 py-2 text-sm font-medium text-ok-text"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-8 space-y-5">
                {profile.sections.map((section) => (
                  <section key={section.title} className="rounded-[16px] border border-hairline bg-white px-5 py-5">
                    <h3 className="text-lg font-semibold text-ink">{section.title}</h3>
                    <div className="mt-4 space-y-3">
                      {section.items.map((item, index) => (
                        <div key={`${section.title}-${index}`} className="flex items-start gap-3 text-sm leading-7 text-ink-secondary">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-ok" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              </details>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
