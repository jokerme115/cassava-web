"use client"

import { useTranslation } from 'react-i18next';
import { Building2, Mail, MapPin, Phone } from "lucide-react"

interface ContactInfo {
  organization: string
  contact: string
  address: string
  phone?: string
  email: string
}

const contacts: ContactInfo[] = [
  {
    organization: t('contact.organizations.hainnu.name'),
    contact: t('contact.organizations.hainnu.contact'),
    address: t('contact.organizations.hainnu.address'),
    phone: t('contact.organizations.hainnu.phone'),
    email: t('contact.organizations.hainnu.email')
  },
  {
    organization: t('contact.organizations.catas.name'),
    contact: t('contact.organizations.catas.contact'),
    address: t('contact.organizations.catas.address'),
    phone: t('contact.organizations.catas.phone'),
    email: t('contact.organizations.catas.email')
  }
]

export default function ContactPage() {
  const { t } = useTranslation();

  return (
    <div className="bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.08),_transparent_26%),linear-gradient(180deg,#f5f7f4_0%,#eef3f1_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <section className="rounded-[40px] bg-slate-900 px-6 py-8 text-white shadow-[0_28px_100px_rgba(15,23,42,0.18)] sm:px-8 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200">
            {t('contact.subtitle')}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('contact.title')}
          </h1>
          <p className="mt-5 max-w-4xl text-base leading-8 text-slate-300">
            {t('contact.description')}
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {contacts.map((contact) => (
            <article
              key={contact.organization}
              className="h-full rounded-[36px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] sm:p-8"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">
                    {contact.organization}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{contact.contact}</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">{t('contact.labels.address')}</p>
                    <p className="mt-1 text-sm font-medium text-slate-700">{contact.address}</p>
                  </div>
                </div>

                {contact.phone && (
                  <div className="flex items-start gap-3">
                    <Phone className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">{t('contact.labels.phone')}</p>
                      <p className="mt-1 text-sm font-medium text-slate-700">{contact.phone}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <Mail className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">{t('contact.labels.email')}</p>
                    <a
                      href={`mailto:${contact.email}`}
                      className="mt-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
                    >
                      {contact.email}
                    </a>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
