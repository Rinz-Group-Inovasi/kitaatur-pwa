'use client'

import { useEffect, useState } from 'react'
import { api, supabase } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  ArrowLeft, 
  HelpCircle, 
  Sparkles, 
  ChevronRight, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  QrCode, 
  X, 
  Loader2, 
  Ticket, 
  ExternalLink,
  ShieldCheck,
  Building2,
  Calendar
} from 'lucide-react'
import toast from 'react-hot-toast'
import dayjs from 'dayjs'
import 'dayjs/locale/id'
import { calculateSubscriptionPrice } from '@/lib/pricing'

interface SubscriptionItem {
  id: string
  profile_id: string
  plan_type: string
  status: 'active' | 'unpaid' | 'cancelled' | 'expired' | string
  amount_paid: number | string | null
  starts_at: string
  expires_at: string
  created_at: string
  organization_name?: string | null
  organization_slug?: string | null
  payment_url?: string | null
  voucher_code?: string | null
  discount_amount?: number | null
  original_amount?: number | null
}

export default function GoogleStyleSubscriptionPage() {
  const router = useRouter()
  const [subs, setSubs] = useState<SubscriptionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  // Renew / Checkout modal state
  const [renewModal, setRenewModal] = useState<{
    isOpen: boolean
    sub: SubscriptionItem | null
    planCategory: 'plus' | 'pro' | 'family'
    planCycle: 'monthly' | 'yearly'
    loading: boolean
    voucherCode: string
    voucherLoading: boolean
    appliedVoucher: any | null
    checkoutData: any | null
  }>({
    isOpen: false,
    sub: null,
    planCategory: 'plus',
    planCycle: 'monthly',
    loading: false,
    voucherCode: '',
    voucherLoading: false,
    appliedVoucher: null,
    checkoutData: null
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [{ data: { user: authUser } }, res] = await Promise.all([
        supabase.auth.getUser(),
        api.get('/subscription/me').catch(() => ({ data: [] }))
      ])
      setUser(authUser)
      const data: SubscriptionItem[] = res.data || []

      const adminList = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'generalrino@gmail.com').split(',').map((e) => e.trim().toLowerCase())
      const isSuperAdmin = authUser?.email && adminList.includes(authUser.email.toLowerCase())

      if (isSuperAdmin && !data.some((s: any) => s.is_admin_bypass)) {
        data.unshift({
          id: 'superadmin-unlimited-bypass',
          profile_id: authUser?.id || '',
          plan_type: 'KitaAtur Enterprise (Unlimited Admin)',
          status: 'active',
          amount_paid: 0,
          starts_at: '2024-01-01T00:00:00.000Z',
          expires_at: '2099-12-31T23:59:59.999Z',
          created_at: '2024-01-01T00:00:00.000Z',
          organization_name: 'Semua Organisasi (God Mode Bypass)',
          organization_slug: 'all-unlimited',
          is_admin_bypass: true
        } as any)
      }

      setSubs(data)
    } catch (err) {
      console.error('Error loading subscriptions:', err)
      toast.error('Gagal memuat data langganan')
    } finally {
      setLoading(false)
    }
  }

  const now = new Date()

  // Consolidate subscriptions so exactly ONE card is shown per organization or unique plan (Google Style)
  const consolidateSubs = (items: SubscriptionItem[]) => {
    const groups = new Map<string, SubscriptionItem[]>()
    for (const s of items) {
      const key = s.organization_slug
        ? `org:${s.organization_slug}`
        : s.organization_name
        ? `org_name:${s.organization_name}`
        : `plan:${s.plan_type || 'personal'}`

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }

    const result: SubscriptionItem[] = []
    groups.forEach((group) => {
      // 1. Prioritize active subscription
      const activeSub = group.find((s: SubscriptionItem) => {
        const isNotExpired = s.expires_at ? new Date(s.expires_at) >= now : false
        return s.status === 'active' && isNotExpired
      })
      if (activeSub) {
        result.push(activeSub)
        return
      }

      // 2. Otherwise pick the single best inactive subscription (prefer real payment, then latest expiry/creation)
      const sorted = [...group].sort((a: SubscriptionItem, b: SubscriptionItem) => {
        const aPaid = (Number(a.amount_paid) || 0) > 0 ? 1 : 0
        const bPaid = (Number(b.amount_paid) || 0) > 0 ? 1 : 0
        if (aPaid !== bPaid) return bPaid - aPaid

        const aExp = a.expires_at ? new Date(a.expires_at).getTime() : 0
        const bExp = b.expires_at ? new Date(b.expires_at).getTime() : 0
        if (aExp !== bExp) return bExp - aExp

        const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0
        const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0
        return bCreated - aCreated
      })
      result.push(sorted[0])
    })
    return result
  }

  const consolidatedSubs = consolidateSubs(subs)

  // Partition into Active and Inactive (matching Google's UI)
  const activeSubs = consolidatedSubs.filter((s) => {
    const isNotExpired = s.expires_at ? new Date(s.expires_at) >= now : false
    return s.status === 'active' && isNotExpired
  })

  const inactiveSubs = consolidatedSubs.filter((s) => {
    const isNotExpired = s.expires_at ? new Date(s.expires_at) >= now : false
    return !(s.status === 'active' && isNotExpired)
  })

  const formatGoogleDate = (dateStr?: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const getPlanDisplayName = (sub: SubscriptionItem) => {
    const raw = (sub.plan_type || '').toLowerCase()
    let base = 'KitaAtur Plus'
    if ((sub as any).is_admin_bypass || raw.includes('admin') || raw.includes('bypass')) base = 'KitaAtur Enterprise (Superadmin Unlimited)'
    else if (raw.includes('trial')) base = 'KitaAtur Plus (Uji Coba 7 Hari)'
    else if (raw.includes('pro')) base = 'KitaAtur Pro'
    else if (raw.includes('family')) base = 'KitaAtur Family'
    else if (raw.includes('school') || raw.includes('enterprise')) base = 'KitaAtur School Enterprise'

    if (sub.organization_name) {
      return `${base} · ${sub.organization_name}`
    }
    return base
  }

  const getPlanCycleName = (sub: SubscriptionItem) => {
    const raw = (sub.plan_type || '').toLowerCase()
    if ((sub as any).is_admin_bypass || raw.includes('admin') || raw.includes('bypass')) return 'Akses God Mode • Bypass Penuh'
    if (raw.includes('yearly')) return 'Langganan Tahunan'
    if (raw.includes('trial')) return 'Uji Coba Gratis'
    return 'Langganan Bulanan'
  }

  // Helper to detect plan category & billing cycle from existing subscription
  const detectPlanDetails = (rawPlanType?: string | null): { category: 'plus' | 'pro' | 'family', cycle: 'monthly' | 'yearly' } => {
    const raw = (rawPlanType || '').toLowerCase()
    let category: 'plus' | 'pro' | 'family' = 'plus'
    if (raw.includes('family')) {
      category = 'family'
    } else if (raw.includes('pro') || raw.includes('school') || raw.includes('enterprise')) {
      category = 'pro'
    }
    const cycle: 'monthly' | 'yearly' = raw.includes('yearly') ? 'yearly' : 'monthly'
    return { category, cycle }
  }

  const getPlanPrice = (category: 'plus' | 'pro' | 'family', cycle: 'monthly' | 'yearly') => {
    if (category === 'family') return cycle === 'yearly' ? 2500000 : 250000
    if (category === 'pro') return cycle === 'yearly' ? 1100000 : 110000
    return cycle === 'yearly' ? 400000 : 40000
  }

  const getPlanCategoryLabel = (category: 'plus' | 'pro' | 'family') => {
    if (category === 'family') return 'KitaAtur Family'
    if (category === 'pro') return 'KitaAtur Pro'
    return 'KitaAtur Plus'
  }

  // Open renewal modal - auto detects previous plan & cycle
  const handleOpenRenew = (sub: SubscriptionItem) => {
    const { category, cycle } = detectPlanDetails(sub.plan_type)
    setRenewModal({
      isOpen: true,
      sub,
      planCategory: category,
      planCycle: cycle,
      loading: false,
      voucherCode: '',
      voucherLoading: false,
      appliedVoucher: null,
      checkoutData: null
    })
  }

  const handleApplyVoucher = async () => {
    if (!renewModal.voucherCode.trim()) return
    setRenewModal(prev => ({ ...prev, voucherLoading: true }))

    const basePrice = getPlanPrice(renewModal.planCategory, renewModal.planCycle)
    try {
      const res = await api.post('/payment/validate-voucher', {
        code: renewModal.voucherCode.trim().toUpperCase(),
        planType: `${renewModal.planCategory}-${renewModal.planCycle}`,
        baseAmount: basePrice
      })
      setRenewModal(prev => ({
        ...prev,
        appliedVoucher: res.data,
        voucherLoading: false
      }))
      toast.success(`Voucher "${res.data.voucher.code}" berhasil diterapkan!`)
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Kode voucher tidak valid'
      toast.error(msg)
      setRenewModal(prev => ({ ...prev, voucherLoading: false }))
    }
  }

  const handleProceedCheckout = async () => {
    if (!user) return toast.error('Silakan login terlebih dahulu')
    setRenewModal(prev => ({ ...prev, loading: true }))

    const basePrice = getPlanPrice(renewModal.planCategory, renewModal.planCycle)
    const discountAmount = renewModal.appliedVoucher ? Number(renewModal.appliedVoucher.discountAmount || 0) : 0
    const pricing = calculateSubscriptionPrice(basePrice, discountAmount)

    try {
      const res = await api.post('/payment/checkout', {
        planType: `${renewModal.planCategory}-${renewModal.planCycle}`,
        baseAmount: basePrice,
        amount: pricing.netSubtotal,
        userId: user.id,
        voucherCode: renewModal.appliedVoucher?.voucher?.code || undefined
      })

      if (res.data.isFree) {
        toast.success('Langganan berhasil diaktifkan dengan voucher 100%!')
        setRenewModal(prev => ({ ...prev, isOpen: false, loading: false }))
        loadData()
        return
      }

      if (res.data.subscriptionId) {
        // Redirect directly to payment QRIS page
        router.push(`/payment/${res.data.subscriptionId}`)
      } else {
        toast.error('Gagal membuat transaksi pembayaran')
        setRenewModal(prev => ({ ...prev, loading: false }))
      }
    } catch (err: any) {
      console.error('Checkout error:', err)
      toast.error(err.response?.data?.error || 'Gagal memproses pembayaran')
      setRenewModal(prev => ({ ...prev, loading: false }))
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFD] text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900 pb-24">
      {/* Google-Style Clean Top Navigation Header (NO 3x3 Grid Dots) */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Left: Brand "KitaAtur Akun" */}
          <Link href="/personal/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center p-1.5 border border-blue-500/20 group-hover:scale-105 transition-transform">
              <img src="/logo.png" alt="KitaAtur" className="w-full h-full object-contain" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-lg text-slate-900 tracking-tight">KitaAtur</span>
              <span className="text-base text-slate-600 font-medium">Akun</span>
            </div>
          </Link>

          {/* Right: Help Icon + User Avatar (NO 3x3 App Launcher Icon) */}
          <div className="flex items-center gap-3">
            <a
              href="mailto:support.kitaatur@gmail.com"
              title="Pusat Bantuan"
              className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <HelpCircle className="w-5 h-5 text-slate-600" />
            </a>

            <div 
              className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0087FF] to-sky-400 text-white font-bold text-sm flex items-center justify-center ring-2 ring-white shadow-2xs overflow-hidden"
              title={user?.email || 'Akun Saya'}
            >
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                (user?.email || 'U').charAt(0).toUpperCase()
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-8">
        {/* Title Header with Google Back Arrow */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/personal/dashboard"
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-200/60 transition-colors shrink-0"
            aria-label="Kembali ke Dasbor"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-2xl sm:text-3xl font-normal text-slate-900 tracking-tight">
            Langganan
          </h1>
        </div>

        {/* Section: "Dikelola oleh KitaAtur" */}
        <div className="mb-8 pl-1 sm:pl-2">
          <h2 className="text-base font-medium text-slate-900 mb-1">
            Dikelola oleh KitaAtur
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
            Beberapa langganan mungkin diperpanjang secara otomatis atau manual oleh pengurus. Anda dapat mengelola paket dan metode pembayaran di{' '}
            <Link href="/upgrade" className="text-[#0087FF] hover:underline font-medium">
              Pusat Langganan KitaAtur
            </Link>
            .
          </p>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="h-4 w-24 bg-slate-200 rounded animate-pulse mb-3" />
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 space-y-4 shadow-2xs">
              <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-36 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
            </div>
          </div>
        ) : subs.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center shadow-2xs">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#0087FF] flex items-center justify-center mx-auto mb-4 border border-blue-100">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Belum Ada Langganan Aktif
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-6 leading-relaxed">
              Organisasi atau akun Anda saat ini menggunakan paket Personal Gratis. Aktifkan KitaAtur Plus untuk membuka presensi barcode, pembukuan kas otomatis, dan rekapan tanpa batas.
            </p>
            <Link
              href="/upgrade"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#0087FF] hover:bg-[#0077E6] text-white text-xs font-bold transition shadow-sm shadow-blue-500/20 active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>Lihat & Pilih Paket</span>
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 1. SECTION: AKTIF */}
            {activeSubs.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3 pl-1 flex items-center gap-2">
                  <span>Aktif</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </h3>

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden divide-y divide-slate-100">
                  {activeSubs.map((sub) => {
                    const daysLeft = sub.expires_at 
                      ? Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                      : null
                    const isExpiringSoon = daysLeft !== null && daysLeft <= 7

                    return (
                      <div
                        key={sub.id}
                        className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                      >
                        {/* Left: Icon & Details */}
                        <div className="flex items-start gap-4 min-w-0">
                          {/* App Icon (Google-style rounded square) */}
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 text-white flex items-center justify-center shrink-0 shadow-2xs border border-blue-400/20 p-2.5">
                            <img src="/logo.png" alt="KitaAtur" className="w-full h-full object-contain brightness-0 invert" />
                          </div>

                          <div className="min-w-0">
                            {/* Blue Title Link */}
                            <h4 className="text-sm sm:text-base font-semibold text-[#0087FF] hover:underline cursor-pointer truncate">
                              {getPlanDisplayName(sub)}
                            </h4>

                            {/* Subtitle / Plan Cycle */}
                            <p className="text-xs text-slate-600 mt-0.5 font-medium">
                              {getPlanCycleName(sub)}
                              {sub.amount_paid ? ` • Rp ${Number(sub.amount_paid).toLocaleString('id-ID')}` : ''}
                            </p>

                            {/* Expiration Text (Google Subscriptions Style) */}
                            <p className="text-xs text-slate-500 mt-1">
                              {(sub as any).is_admin_bypass ? (
                                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 inline" />
                                  Bypass Langganan Superadmin (Masa Aktif Permanen)
                                </span>
                              ) : (
                                <>
                                  Masa berlaku habis pada tanggal{' '}
                                  <strong className="text-slate-700 font-semibold">
                                    {formatGoogleDate(sub.expires_at)}
                                  </strong>
                                </>
                              )}
                            </p>

                            {/* Expiring Soon Badge */}
                            {!((sub as any).is_admin_bypass) && isExpiringSoon && (
                              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                                <Clock className="w-3 h-3 text-amber-600 animate-pulse" />
                                <span>{daysLeft === 0 ? 'Berakhir Hari Ini' : `Sisa ${daysLeft} Hari Lagi`}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          {(sub as any).is_admin_bypass ? (
                            <span className="px-3.5 py-1.5 rounded-full bg-[#E0F4FE] text-[#007AE6] border border-[#01C4FB]/40 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                              <ShieldCheck className="w-4 h-4 text-[#0087FF]" />
                              <span>Superadmin Bypass Aktif</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleOpenRenew(sub)}
                              className="px-4 py-2 rounded-full bg-[#0087FF] hover:bg-[#0077E6] text-white text-xs font-bold transition shadow-2xs hover:shadow-xs active:scale-95 flex items-center gap-1.5 cursor-pointer"
                            >
                              <span>Perpanjang</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 2. SECTION: TIDAK AKTIF (Matching User Screenshot) */}
            {inactiveSubs.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3 pl-1">
                  Tidak aktif
                </h3>

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden divide-y divide-slate-100">
                  {inactiveSubs.map((sub) => {
                    const isWaitingPayment = sub.status === 'unpaid' && 
                      new Date(sub.expires_at) >= now && 
                      (now.getTime() - new Date(sub.created_at).getTime()) < 60 * 60 * 1000

                    return (
                      <div
                        key={sub.id}
                        className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                      >
                        {/* Left: Icon & Details */}
                        <div className="flex items-start gap-4 min-w-0">
                          {/* App Icon (Google-style rounded square, slate tone) */}
                          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center shrink-0 p-2.5">
                            <img src="/logo.png" alt="KitaAtur" className="w-full h-full object-contain grayscale opacity-60" />
                          </div>

                          <div className="min-w-0">
                            {/* Blue Title Link */}
                            <h4 className="text-sm sm:text-base font-semibold text-[#0087FF] hover:underline cursor-pointer truncate">
                              {getPlanDisplayName(sub)}
                            </h4>

                            {/* Subtitle / Plan Cycle */}
                            <p className="text-xs text-slate-600 mt-0.5 font-medium">
                              {getPlanCycleName(sub)}
                              {sub.amount_paid ? ` • Rp ${Number(sub.amount_paid).toLocaleString('id-ID')}` : ''}
                            </p>

                            {/* Expiration Text (Exact copy of Google Screenshot: "Masa berlaku habis pada tanggal ...") */}
                            <p className="text-xs text-slate-500 mt-1">
                              {isWaitingPayment ? (
                                <span className="text-amber-700 font-semibold">Menunggu Pembayaran</span>
                              ) : (
                                <>
                                  Masa berlaku habis pada tanggal{' '}
                                  <span className="text-slate-600 font-medium">
                                    {formatGoogleDate(sub.expires_at || sub.created_at)}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <button
                            onClick={() => handleOpenRenew(sub)}
                            className="px-4 py-2 rounded-full border border-slate-300 hover:border-[#0087FF] hover:bg-blue-50/50 text-[#0087FF] text-xs font-bold transition shadow-2xs active:scale-95 flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>Aktifkan Kembali</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#0087FF]" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* RENEWAL / EXTENSION MODAL (Google Styled Dialog) */}
      {renewModal.isOpen && renewModal.sub && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md max-h-[92vh] sm:max-h-[88vh] rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="min-w-0 pr-2">
                <h3 className="text-base font-bold text-slate-900 truncate">
                  Perpanjang {getPlanCategoryLabel(renewModal.planCategory)}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
                  {getPlanDisplayName(renewModal.sub)}
                </p>
              </div>
              <button
                onClick={() => setRenewModal(prev => ({ ...prev, isOpen: false }))}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body (Scrollable if height exceeds viewport) */}
            {(() => {
              const monthlyPrice = getPlanPrice(renewModal.planCategory, 'monthly')
              const yearlyPrice = getPlanPrice(renewModal.planCategory, 'yearly')
              const currentBasePrice = getPlanPrice(renewModal.planCategory, renewModal.planCycle)
              const currentDiscount = renewModal.appliedVoucher ? Number(renewModal.appliedVoucher.discountAmount || 0) : 0
              const currentPricing = calculateSubscriptionPrice(currentBasePrice, currentDiscount)

              return (
                <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain">
                  {/* Plan Category Selector (Auto-detected from previous sub) */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 shrink-0">
                        Paket Langganan
                      </label>
                      <span className="text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 shrink-0 whitespace-nowrap">
                        Terdeteksi Otomatis
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-2xl">
                      {(['plus', 'pro', 'family'] as const).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setRenewModal(prev => ({ ...prev, planCategory: cat, appliedVoucher: null }))}
                          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center ${
                            renewModal.planCategory === cat
                              ? 'bg-white text-blue-600 shadow-xs'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {cat === 'plus' ? 'Plus' : cat === 'pro' ? 'Pro' : 'Family'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Cycle Toggle (Bulanan vs Tahunan) */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">
                      Pilih Periode Perpanjangan
                    </label>
                    <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-2xl">
                      <button
                        type="button"
                        onClick={() => setRenewModal(prev => ({ ...prev, planCycle: 'monthly', appliedVoucher: null }))}
                        className={`py-2 px-2 rounded-xl text-center transition-all ${
                          renewModal.planCycle === 'monthly'
                            ? 'bg-white text-slate-900 shadow-xs font-bold'
                            : 'text-slate-500 hover:text-slate-900 font-medium'
                        }`}
                      >
                        <div className="text-xs font-bold leading-tight">Bulanan</div>
                        <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-tight">
                          Rp {monthlyPrice.toLocaleString('id-ID')}/bln
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenewModal(prev => ({ ...prev, planCycle: 'yearly', appliedVoucher: null }))}
                        className={`py-2 px-2 rounded-xl text-center transition-all ${
                          renewModal.planCycle === 'yearly'
                            ? 'bg-white text-slate-900 shadow-xs font-bold'
                            : 'text-slate-500 hover:text-slate-900 font-medium'
                        }`}
                      >
                        <div className="text-xs font-bold leading-tight flex items-center justify-center gap-1">
                          <span>Tahunan</span>
                          <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black leading-none">
                            Hemat 2 Bln
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-tight">
                          Rp {yearlyPrice.toLocaleString('id-ID')}/thn
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Price Details Breakdown */}
                  <div className="bg-slate-50 rounded-2xl p-3.5 sm:p-4 border border-slate-100 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <span className="truncate">Harga Paket ({getPlanCategoryLabel(renewModal.planCategory)})</span>
                      <span className="font-semibold text-slate-900 shrink-0 whitespace-nowrap">
                        Rp {currentPricing.basePrice.toLocaleString('id-ID')}
                      </span>
                    </div>

                    {renewModal.appliedVoucher && (
                      <div className="flex items-center justify-between gap-2 text-emerald-600 font-semibold bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100">
                        <span className="flex items-center gap-1.5 truncate">
                          <Ticket className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Diskon ({renewModal.appliedVoucher.voucher.code})</span>
                        </span>
                        <span className="shrink-0 whitespace-nowrap">- Rp {currentPricing.discountAmount.toLocaleString('id-ID')}</span>
                      </div>
                    )}

                    {renewModal.appliedVoucher && currentPricing.discountAmount > 0 && (
                      <div className="flex items-center justify-between gap-2 text-slate-600">
                        <span className="truncate">Harga Setelah Diskon</span>
                        <span className="font-semibold text-slate-900 shrink-0 whitespace-nowrap">
                          Rp {currentPricing.discountedBasePrice.toLocaleString('id-ID')}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <span>PPN (11%)</span>
                      <span className="font-semibold text-slate-900 shrink-0 whitespace-nowrap">
                        Rp {currentPricing.ppn.toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-slate-500 border-t border-slate-200/60 pt-1.5">
                      <span>Subtotal</span>
                      <span className="font-bold text-slate-800 shrink-0 whitespace-nowrap">
                        Rp {currentPricing.netSubtotal.toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-slate-600">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate">Biaya Layanan (KitaPay)</span>
                        <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-[#0087FF] rounded font-semibold border border-blue-100 shrink-0 whitespace-nowrap">
                          {currentPricing.feeTier === 'Tier 1' ? 'Flat' : '1.5%'}
                        </span>
                      </div>
                      <span className="font-semibold text-slate-900 shrink-0 whitespace-nowrap">
                        Rp {currentPricing.paymentFee.toLocaleString('id-ID')}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">Total Pembayaran</span>
                      {currentPricing.isFree ? (
                        <span className="text-base sm:text-lg font-black text-emerald-600 shrink-0">GRATIS</span>
                      ) : (
                        <span className="text-base sm:text-lg font-black text-[#0087FF] shrink-0 whitespace-nowrap">
                          Rp {currentPricing.totalPayable.toLocaleString('id-ID')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Voucher Input */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">
                      Punya Kode Voucher? (Opsional)
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Ticket className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Contoh: MERDEKA50"
                          value={renewModal.voucherCode}
                          onChange={(e) => setRenewModal(prev => ({ ...prev, voucherCode: e.target.value.toUpperCase() }))}
                          className="w-full pl-9 pr-3 py-2 text-xs uppercase font-mono font-bold bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyVoucher}
                        disabled={renewModal.voucherLoading || !renewModal.voucherCode.trim()}
                        className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition shrink-0"
                      >
                        {renewModal.voucherLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Gunakan'}
                      </button>
                    </div>
                  </div>

                  {/* Security notice */}
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Pembayaran resmi & terenkripsi otomatis via QRIS KitaPay.</span>
                  </div>
                </div>
              )
            })()}

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setRenewModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/60 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleProceedCheckout}
                disabled={renewModal.loading}
                className="px-5 py-2.5 rounded-xl bg-[#0087FF] hover:bg-[#0077E6] disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-2 shadow-sm shadow-blue-500/20 active:scale-95"
              >
                {renewModal.loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Memproses QRIS...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="w-4 h-4" />
                    <span>Lanjut Bayar QRIS</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
