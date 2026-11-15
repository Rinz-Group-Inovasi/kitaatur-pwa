'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Clock, 
  Search, 
  Building2, 
  Crown, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  CalendarPlus, 
  X, 
  Loader2, 
  Sparkles, 
  RefreshCw,
  Mail,
  GraduationCap,
  ExternalLink,
  ChevronRight,
  Filter,
  Users
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAdminRoute } from '../useAdminRoute'

interface OrgExpirationItem {
  id: string
  name: string
  slug: string
  logo_url: string | null
  is_edu: boolean | null
  is_school: boolean
  created_at: string
  owner_id: string | null
  owner_name: string | null
  owner_email: string | null
  members_count: number
  linked_schools_count: number
  plan_type: string
  status: 'active' | 'expiring_soon' | 'expired' | 'free' | 'no_owner'
  starts_at: string | null
  expires_at: string | null
  days_left: number | null
  hours_left: number | null
  is_expired: boolean
  subscription_id: string | null
  all_subscriptions_count: number
  purchased_by_member?: {
    email: string
    name: string | null
    role: string
  } | null
  is_linked_family?: boolean
  family_code?: string | null
  parent_id?: string | null
  parent_name?: string | null
  parent_slug?: string | null
}

export default function AdminExpirationsPage() {
  const { dashboardHref } = useAdminRoute()
  const [items, setItems] = useState<OrgExpirationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'expiring_soon' | 'expired' | 'active' | 'free'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'school' | 'ekskul'>('all')

  // Modal Perpanjang / Atur Masa Aktif
  const [extendModal, setExtendModal] = useState<{
    isOpen: boolean
    org: OrgExpirationItem | null
    planType: string
    durationType: 'quick' | 'custom'
    quickDays: number
    customDate: string
    submitting: boolean
  }>({
    isOpen: false,
    org: null,
    planType: 'plus',
    durationType: 'quick',
    quickDays: 30,
    customDate: '',
    submitting: false
  })

  useEffect(() => {
    fetchExpirations()
  }, [])

  const fetchExpirations = async () => {
    try {
      const res = await api.get('/admin/expirations')
      setItems(res.data || [])
    } catch (err: any) {
      console.error('Failed to fetch org expirations:', err)
      toast.error('Gagal memuat data kadaluwarsa organisasi')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleRefresh = () => {
    setRefreshing(true)
    fetchExpirations()
  }

  const openExtendModal = (org: OrgExpirationItem) => {
    // Default next date: 30 days from now or current expires_at
    const now = new Date()
    const baseDate = (org.expires_at && new Date(org.expires_at) > now) 
      ? new Date(org.expires_at) 
      : now
    const defaultCustom = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    const formattedDefault = defaultCustom.toISOString().slice(0, 10)

    setExtendModal({
      isOpen: true,
      org,
      planType: org.plan_type && !org.plan_type.includes('free') ? org.plan_type : (org.is_school ? 'school' : 'plus'),
      durationType: 'quick',
      quickDays: 30,
      customDate: formattedDefault,
      submitting: false
    })
  }

  const handleSaveExtend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!extendModal.org) return

    setExtendModal(prev => ({ ...prev, submitting: true }))

    try {
      const payload: any = {
        org_id: extendModal.org.id,
        profile_id: extendModal.org.owner_id,
        plan_type: extendModal.planType
      }

      if (extendModal.durationType === 'quick') {
        payload.days = extendModal.quickDays
      } else {
        if (!extendModal.customDate) {
          toast.error('Tanggal kadaluwarsa kustom wajib dipilih')
          setExtendModal(prev => ({ ...prev, submitting: false }))
          return
        }
        payload.expires_at = new Date(extendModal.customDate).toISOString()
      }

      const res = await api.post('/admin/subscriptions/set-expiration', payload)
      toast.success(res.data.message || 'Masa aktif berhasil diperbarui!')
      setExtendModal(prev => ({ ...prev, isOpen: false, submitting: false }))
      fetchExpirations()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memperbarui masa aktif')
      setExtendModal(prev => ({ ...prev, submitting: false }))
    }
  }

  // Filter calculations
  const totalOrgs = items.length
  const expiringSoonCount = items.filter(i => i.status === 'expiring_soon').length
  const expiredCount = items.filter(i => i.status === 'expired').length
  const activeCount = items.filter(i => i.status === 'active').length
  const freeCount = items.filter(i => i.status === 'free' || i.status === 'no_owner').length

  const filteredItems = items.filter(item => {
    // Search
    const q = search.toLowerCase()
    const matchesSearch = 
      item.name.toLowerCase().includes(q) ||
      item.slug.toLowerCase().includes(q) ||
      (item.owner_name && item.owner_name.toLowerCase().includes(q)) ||
      (item.owner_email && item.owner_email.toLowerCase().includes(q)) ||
      (item.family_code && item.family_code.toLowerCase().includes(q))

    if (!matchesSearch) return false

    // Status filter
    if (statusFilter === 'expiring_soon' && item.status !== 'expiring_soon') return false
    if (statusFilter === 'expired' && item.status !== 'expired') return false
    if (statusFilter === 'active' && item.status !== 'active') return false
    if (statusFilter === 'free' && item.status !== 'free' && item.status !== 'no_owner') return false

    // Type filter
    if (typeFilter === 'school' && !item.is_school) return false
    if (typeFilter === 'ekskul' && item.is_school) return false

    return true
  })

  // Format date helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatPlanName = (plan: string) => {
    const p = (plan || '').toLowerCase()
    if (p.includes('trial')) return 'Uji Coba (Trial)'
    if (p.includes('school')) return 'Paket School'
    if (p.includes('plus')) return 'Paket Plus'
    if (p.includes('enterprise')) return 'Enterprise'
    if (p.includes('free') || p.includes('personal')) return 'Personal (Free)'
    return plan
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 pb-24 font-sans">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link href={dashboardHref} className="text-blue-600 font-semibold hover:underline text-sm mb-2 inline-block">
            &larr; Kembali ke Admin Panel
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shadow-2xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Masa Aktif & Kadaluwarsa
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Pantau sisa hari langganan, jatuh tempo, dan perpanjang masa aktif tiap organisasi.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold flex items-center gap-2 shadow-2xs transition active:scale-95 self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Muat Ulang Data</span>
        </button>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {/* Card 1: Segera Kadaluwarsa */}
        <div 
          onClick={() => setStatusFilter(statusFilter === 'expiring_soon' ? 'all' : 'expiring_soon')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'expiring_soon'
              ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400/30 shadow-xs'
              : 'bg-white border-amber-200/70 hover:border-amber-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Jatuh Tempo &le; 7 Hari
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
          </div>
          <div className="text-3xl font-black text-amber-900">{expiringSoonCount}</div>
          <p className="text-[11px] text-amber-700/80 mt-1">Perlu perhatian atau perpanjangan</p>
        </div>

        {/* Card 2: Sudah Kadaluwarsa */}
        <div 
          onClick={() => setStatusFilter(statusFilter === 'expired' ? 'all' : 'expired')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'expired'
              ? 'bg-rose-50/90 border-rose-300 ring-2 ring-rose-400/30 shadow-xs'
              : 'bg-white border-rose-200/70 hover:border-rose-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Sudah Kadaluwarsa
            </span>
          </div>
          <div className="text-3xl font-black text-rose-900">{expiredCount}</div>
          <p className="text-[11px] text-rose-700/80 mt-1">Masa aktif langganan habis</p>
        </div>

        {/* Card 3: Aktif */}
        <div 
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'active'
              ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-400/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-emerald-200 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Langganan Aktif
            </span>
          </div>
          <div className="text-3xl font-black text-emerald-900">{activeCount}</div>
          <p className="text-[11px] text-emerald-700/80 mt-1">Masa aktif lebih dari 7 hari</p>
        </div>

        {/* Card 4: Total & Gratis */}
        <div 
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'bg-slate-100 border-slate-300 ring-2 ring-slate-400/20 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Total Organisasi
            </span>
          </div>
          <div className="text-3xl font-black text-slate-900">{totalOrgs}</div>
          <p className="text-[11px] text-slate-500 mt-1">{freeCount} Gratis / Personal</p>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 mb-6 shadow-2xs space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Cari organisasi, slug, nama pemilik, atau email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all outline-none text-sm text-slate-800"
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Semua ({totalOrgs})
            </button>
            <button
              onClick={() => setStatusFilter('expiring_soon')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'expiring_soon'
                  ? 'bg-amber-500 text-white shadow-2xs'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Clock className="w-3 h-3" />
              <span>&le; 7 Hari ({expiringSoonCount})</span>
            </button>
            <button
              onClick={() => setStatusFilter('expired')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'expired'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Kadaluwarsa ({expiredCount})</span>
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Aktif ({activeCount})</span>
            </button>
            <button
              onClick={() => setStatusFilter('free')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'free'
                  ? 'bg-slate-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Gratis ({freeCount})
            </button>
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
            <span className="hidden sm:inline">Tipe:</span>
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-lg ${typeFilter === 'all' ? 'bg-slate-200 text-slate-900 font-bold' : 'hover:bg-slate-100'}`}
            >
              Semua
            </button>
            <button
              onClick={() => setTypeFilter('school')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1 ${typeFilter === 'school' ? 'bg-purple-100 text-purple-800 font-bold' : 'hover:bg-slate-100'}`}
            >
              <GraduationCap className="w-3 h-3" />
              Sekolah
            </button>
            <button
              onClick={() => setTypeFilter('ekskul')}
              className={`px-2.5 py-1 rounded-lg ${typeFilter === 'ekskul' ? 'bg-blue-100 text-blue-800 font-bold' : 'hover:bg-slate-100'}`}
            >
              Ekskul
            </button>
          </div>
        </div>
      </div>

      {/* List Content */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-2xs animate-pulse flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-200 rounded-2xl" />
                <div className="space-y-2">
                  <div className="h-4 w-48 bg-slate-200 rounded" />
                  <div className="h-3 w-32 bg-slate-100 rounded" />
                </div>
              </div>
              <div className="h-8 w-28 bg-slate-100 rounded-xl" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-12 text-center text-slate-500">
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="font-bold text-slate-700 text-base mb-1">Tidak Ada Data Ditemukan</h3>
          <p className="text-xs text-slate-400">Cobalah ubah kata kunci pencarian atau sesuaikan filter status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isSchool = item.is_school
            const isExpSoon = item.status === 'expiring_soon'
            const isExpired = item.status === 'expired'
            const isActive = item.status === 'active'

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl sm:rounded-3xl border transition-all p-4 sm:p-5 shadow-2xs hover:shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isExpSoon 
                    ? 'border-amber-300/80 bg-amber-50/15 ring-1 ring-amber-400/20' 
                    : isExpired 
                    ? 'border-rose-200 bg-rose-50/10' 
                    : isSchool 
                    ? 'border-purple-200/80 hover:border-purple-300' 
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                {/* Left: Organization & Owner Info */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 font-bold text-sm ${
                    isSchool ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.logo_url ? (
                      <img src={item.logo_url} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      item.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-extrabold text-slate-900 text-base leading-tight truncate">
                        {item.name}
                      </h3>
                      {isSchool ? (
                        <span className="bg-purple-100 text-purple-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                          <GraduationCap className="w-3 h-3" />
                          Sekolah
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                          Ekskul
                        </span>
                      )}
                      <span className="text-slate-400 font-mono text-[11px] bg-slate-50 border border-slate-200/60 px-1.5 py-0.5 rounded">
                        /{item.slug}
                      </span>
                    </div>

                    {/* Owner & Member detail */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1 text-slate-700 font-medium">
                        <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>{item.owner_name || 'Tanpa Owner'}</span>
                      </span>
                      {item.owner_email && (
                        <span className="text-slate-400 flex items-center gap-1">
                          <Mail className="w-3 h-3 text-slate-300" />
                          <span>{item.owner_email}</span>
                        </span>
                      )}
                      <span className="text-slate-400 text-[11px]">
                        • {item.members_count} Anggota
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center / Right: Expiry Status Badge */}
                <div className="flex flex-wrap items-center gap-3 sm:gap-4 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 justify-between md:justify-end">
                  {/* Status Indicator Pill */}
                  <div className="text-left md:text-right">
                    <div className="flex items-center md:justify-end gap-1.5 mb-1">
                      {item.is_linked_family && item.family_code ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-[#0087FF] border border-blue-200 shadow-2xs font-mono tracking-wide">
                          <Users className="w-3.5 h-3.5 text-[#0087FF]" />
                          <span>{item.family_code}</span>
                        </span>
                      ) : isExpSoon ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs">
                          <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                          <span>Sisa {item.days_left} Hari Lagi</span>
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          <span>Kadaluwarsa ({Math.abs(item.days_left || 0)} hari lalu)</span>
                        </span>
                      ) : isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Aktif (Sisa {item.days_left} Hari)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          <Sparkles className="w-3 h-3 text-slate-400" />
                          <span>{item.status === 'no_owner' ? 'Tanpa Akun Owner' : 'Personal (Gratis)'}</span>
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 font-medium flex items-center md:justify-end gap-2">
                      {item.is_linked_family ? (
                        <span className="font-semibold text-blue-600">
                          Cabang Family · {item.parent_name ? `Induk: ${item.parent_name}` : 'Mengikuti Induk'}
                          {item.expires_at && ` • s/d ${formatDate(item.expires_at)}`}
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold text-slate-600">{formatPlanName(item.plan_type)}</span>
                          {item.expires_at ? (
                            <span>• s/d {formatDate(item.expires_at)}</span>
                          ) : (
                            <span>• Aktif Selamanya</span>
                          )}
                        </>
                      )}
                    </div>
                    {item.purchased_by_member && (
                      <div className="text-[10px] text-blue-600 font-medium md:text-right mt-0.5">
                        Dibayar oleh {item.purchased_by_member.role}: {item.purchased_by_member.name || item.purchased_by_member.email}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openExtendModal(item)}
                      className="px-3 py-2 bg-[#0087FF] hover:bg-[#0077E6] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs active:scale-95 cursor-pointer"
                      title="Perpanjang atau Ubah Tanggal Kadaluwarsa"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      <span>Perpanjang</span>
                    </button>

                    <a
                      href={`${
                        typeof window !== 'undefined' && (window.location.hostname.includes('localhost') || window.location.hostname === '127.0.0.1')
                          ? 'http://localhost:3000'
                          : `https://${process.env.NEXT_PUBLIC_MAIN_DOMAIN || 'kitatur.rinzgroup.web.id'}`
                      }/org/${item.slug}/${isSchool ? 'executive' : 'dashboard'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Masuk Dasbor Organisasi (God Mode)"
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition flex items-center justify-center"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Perpanjang / Atur Masa Aktif */}
      {extendModal.isOpen && extendModal.org && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setExtendModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute right-5 top-5 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
                <CalendarPlus className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Perpanjang Masa Aktif</h3>
                <p className="text-xs text-slate-500 font-medium">
                  {extendModal.org.name} ({extendModal.org.owner_name || 'Tanpa Owner'})
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveExtend} className="space-y-4">
              {/* Info Status Saat Ini */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Paket Saat Ini:</span>
                  <span className="font-bold text-slate-800">{formatPlanName(extendModal.org.plan_type)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kadaluwarsa Saat Ini:</span>
                  <span className="font-bold text-slate-800">
                    {extendModal.org.expires_at ? formatDate(extendModal.org.expires_at) : 'Aktif Selamanya / Belum Terdaftar'}
                  </span>
                </div>
              </div>

              {/* Pilih Paket Baru / Sama */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Pilih Paket Layanan
                </label>
                <select
                  value={extendModal.planType}
                  onChange={(e) => setExtendModal(prev => ({ ...prev, planType: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                >
                  <option value="plus">KitaAtur Plus (Komunitas / UKM)</option>
                  <option value="school">KitaAtur School (Institusi / Sekolah)</option>
                  <option value="plus_trial">Uji Coba Plus (Trial 7 Hari)</option>
                  <option value="enterprise">KitaAtur Enterprise</option>
                  <option value="personal">Personal (Free)</option>
                </select>
              </div>

              {/* Mode Pilihan: Cepat (+Hari) atau Tanggal Spesifik */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Durasi Tambahan
                  </label>
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setExtendModal(prev => ({ ...prev, durationType: 'quick' }))}
                      className={`px-2.5 py-1 rounded-md transition ${
                        extendModal.durationType === 'quick' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Pilihan Cepat
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtendModal(prev => ({ ...prev, durationType: 'custom' }))}
                      className={`px-2.5 py-1 rounded-md transition ${
                        extendModal.durationType === 'custom' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Tanggal Kalender
                    </button>
                  </div>
                </div>

                {extendModal.durationType === 'quick' ? (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '+7 Hari (Trial)', days: 7 },
                      { label: '+14 Hari', days: 14 },
                      { label: '+30 Hari (1 Bln)', days: 30 },
                      { label: '+3 Bulan', days: 90 },
                      { label: '+6 Bulan', days: 180 },
                      { label: '+1 Tahun (12 Bln)', days: 365 },
                    ].map((btn) => (
                      <button
                        key={btn.days}
                        type="button"
                        onClick={() => setExtendModal(prev => ({ ...prev, quickDays: btn.days }))}
                        className={`p-2 rounded-xl text-xs font-bold transition border cursor-pointer ${
                          extendModal.quickDays === btn.days
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                        }`}
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    <input
                      type="date"
                      value={extendModal.customDate}
                      onChange={(e) => setExtendModal(prev => ({ ...prev, customDate: e.target.value }))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Pilih tanggal jatuh tempo kadaluwarsa yang diinginkan.</p>
                  </div>
                )}
              </div>

              {/* Tombol Simpan */}
              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setExtendModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={extendModal.submitting}
                  className="flex-1 py-2.5 bg-[#0087FF] hover:bg-[#0077E6] text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-sm shadow-blue-500/20 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {extendModal.submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>Terapkan Perpanjangan</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

