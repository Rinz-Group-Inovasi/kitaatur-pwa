'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import {
  ShieldWarning,
  Plus,
  MagnifyingGlass as Search,
  Funnel,
  Warning,
  WarningCircle,
  WarningOctagon,
  CheckCircle,
  Clock,
  Trash,
  PencilSimple,
  User,
  WhatsappLogo,
  CaretRight,
  ArrowsClockwise,
  UserCheck,
  CircleNotch as Loader2,
  ChatCircleDots,
  ShieldCheck,
  Calendar,
  X
} from '@phosphor-icons/react'

interface Violation {
  id: string
  organization_id: string
  guest_id: string
  title: string
  category: string
  points: number
  action_taken?: string | null
  notes?: string | null
  status: string
  occurred_at: string
  created_at: string
  guest?: {
    id: string
    name: string
    identifier: string
    custom_data?: any
  }
  reporter?: {
    id: string
    full_name?: string
    avatar_url?: string
  }
}

interface SummaryData {
  totalViolations: number
  totalPoints: number
  categoryCounts: {
    ringan: number
    sedang: number
    berat: number
  }
  topStudents: Array<{
    guestId: string
    name: string
    identifier: string
    kelas?: string | null
    parentPhone?: string | null
    totalPoints: number
    violationCount: number
  }>
}

export default function ViolationsPage() {
  const params = useParams()
  const router = useRouter()
  const orgSlug = params.orgSlug as string

  const [violations, setViolations] = useState<Violation[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [students, setStudents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // Modal Create State
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [categoryInput, setCategoryInput] = useState('ringan')
  const [pointsInput, setPointsInput] = useState(5)
  const [actionInput, setActionInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [notifyParent, setNotifyParent] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Modal Edit Status State
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null)
  const [editStatus, setEditStatus] = useState('recorded')
  const [editAction, setEditAction] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [updating, setUpdating] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      const [violationsRes, summaryRes, guestsRes] = await Promise.all([
        api.get(`/org-violation/${orgSlug}`, {
          params: {
            category: categoryFilter !== 'all' ? categoryFilter : undefined,
            status: statusFilter !== 'all' ? statusFilter : undefined,
            search: searchQuery.trim() || undefined
          }
        }),
        api.get(`/org-violation/${orgSlug}/summary`),
        api.get(`/org-attendance/${orgSlug}/guests`)
      ])

      setViolations(violationsRes.data.data || [])
      setSummary(summaryRes.data || null)
      setStudents(guestsRes.data || [])
    } catch (err: any) {
      console.error('Failed to load violations data:', err)
      toast.error('Gagal memuat data pelanggaran siswa')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [orgSlug, categoryFilter, statusFilter])

  // Set default points based on category
  const handleCategoryChange = (cat: string) => {
    setCategoryInput(cat)
    if (cat === 'ringan') setPointsInput(5)
    else if (cat === 'sedang') setPointsInput(15)
    else if (cat === 'berat') setPointsInput(50)
  }

  const handleCreateViolation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedStudentId) {
      toast.error('Silakan pilih siswa terlebih dahulu')
      return
    }
    if (!titleInput.trim()) {
      toast.error('Judul pelanggaran wajib diisi')
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/org-violation/${orgSlug}`, {
        guestId: selectedStudentId,
        title: titleInput.trim(),
        category: categoryInput,
        points: Number(pointsInput),
        actionTaken: actionInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
        notifyParent
      })

      toast.success('Pelanggaran berhasil dicatat' + (notifyParent ? ' & notifikasi WA dikirim!' : ''))
      setShowCreateModal(false)
      // Reset form
      setSelectedStudentId('')
      setTitleInput('')
      setCategoryInput('ringan')
      setPointsInput(5)
      setActionInput('')
      setNotesInput('')
      fetchData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mencatat pelanggaran')
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (v: Violation) => {
    setSelectedViolation(v)
    setEditStatus(v.status || 'recorded')
    setEditAction(v.action_taken || '')
    setEditNotes(v.notes || '')
    setShowEditModal(true)
  }

  const handleUpdateViolation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedViolation) return

    setUpdating(true)
    try {
      await api.put(`/org-violation/${orgSlug}/${selectedViolation.id}`, {
        status: editStatus,
        actionTaken: editAction.trim(),
        notes: editNotes.trim()
      })

      toast.success('Status pelanggaran berhasil diperbarui')
      setShowEditModal(false)
      fetchData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memperbarui status')
    } finally {
      setUpdating(false)
    }
  }

  const handleDeleteViolation = async (id: string) => {
    if (!window.confirm('Hapus catatan pelanggaran ini?')) return
    try {
      await api.delete(`/org-violation/${orgSlug}/${id}`)
      toast.success('Catatan pelanggaran dihapus')
      fetchData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus pelanggaran')
    }
  }

  const filteredViolations = useMemo(() => {
    if (!searchQuery.trim()) return violations
    const q = searchQuery.toLowerCase()
    return violations.filter(v =>
      v.title.toLowerCase().includes(q) ||
      (v.guest?.name && v.guest.name.toLowerCase().includes(q)) ||
      (v.guest?.identifier && v.guest.identifier.toLowerCase().includes(q))
    )
  }, [violations, searchQuery])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E0F4FE] text-[#007AE6] border border-[#0087FF]/20">
                <ShieldCheck className="w-3.5 h-3.5" />
                Modul Bimbingan Konseling (BK)
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
              <span>Pelanggaran Siswa & Rekap Poin</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-500 mt-1">
              Pencatatan tata tertib siswa, monitoring akumulasi poin pembinaan, dan notifikasi otomatis ke WhatsApp orang tua.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="p-2.5 text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition shadow-xs"
              title="Segarkan data"
            >
              <ArrowsClockwise className={`w-4 h-4 ${loading ? 'animate-spin text-[#0087FF]' : ''}`} />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0087FF] hover:bg-[#0077E6] active:scale-95 text-white font-bold text-xs md:text-sm rounded-xl transition shadow-sm"
            >
              <Plus className="w-4 h-4" weight="bold" />
              <span>Catat Pelanggaran</span>
            </button>
          </div>
        </div>

        {/* Executive Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Kasus</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl md:text-3xl font-black text-slate-900">{summary?.totalViolations || 0}</span>
              <span className="text-xs font-semibold text-slate-400">Kasus</span>
            </div>
            <p className="text-[11px] text-slate-500">Tercatat dalam sistem</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Poin</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl md:text-3xl font-black text-rose-600">{summary?.totalPoints || 0}</span>
              <span className="text-xs font-semibold text-rose-400">Poin</span>
            </div>
            <p className="text-[11px] text-slate-500">Akumulasi seluruh siswa</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ringan & Sedang</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl md:text-3xl font-black text-amber-600">
                {(summary?.categoryCounts.ringan || 0) + (summary?.categoryCounts.sedang || 0)}
              </span>
              <span className="text-xs font-semibold text-amber-500">
                ({summary?.categoryCounts.ringan || 0} / {summary?.categoryCounts.sedang || 0})
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Pembinaan bertahap</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pelanggaran Berat</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl md:text-3xl font-black text-rose-700">
                {summary?.categoryCounts.berat || 0}
              </span>
              <span className="text-xs font-semibold text-rose-400">Perhatian Khusus</span>
            </div>
            <p className="text-[11px] text-slate-500">Prioritas pemanggilan ortu</p>
          </div>
        </div>

        {/* Leaderboard BK: Top Siswa Akumulasi Poin Tertinggi */}
        {summary?.topStudents && summary.topStudents.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm md:text-base flex items-center gap-2">
                  <Warning className="w-5 h-5 text-amber-500" weight="fill" />
                  <span>Siswa Perlu Perhatian Khusus BK (Poin Tertinggi)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Daftar siswa dengan akumulasi poin pelanggaran tertinggi untuk jadwal bimbingan atau surat panggilan orang tua.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.topStudents.slice(0, 6).map((student, idx) => (
                <div
                  key={student.guestId}
                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:bg-slate-100/70 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      idx === 0 ? 'bg-rose-100 text-rose-700' : idx === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'
                    }`}>
                      #{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-slate-900 truncate">{student.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {student.kelas ? `Kelas ${student.kelas} • ` : ''}NIS: {student.identifier}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-black rounded-lg">
                      {student.totalPoints} Poin
                    </span>

                    {student.parentPhone ? (
                      <a
                        href={`https://wa.me/${student.parentPhone}?text=Halo%20Ayah/Bunda,%20kami%20dari%20pihak%20Bimbingan%20Konseling%20sekolah%20ingin%20berkoordinasi%20terkait%20perkembangan%20ananda%20${encodeURIComponent(student.name)}.`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition"
                        title="Chat WhatsApp Orang Tua"
                      >
                        <WhatsappLogo className="w-4 h-4" weight="fill" />
                      </a>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">No WA -</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter and Table Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Search & Filters */}
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Cari siswa, NIS, atau nama pelanggaran..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF] transition"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-[#0087FF]"
              >
                <option value="all">Semua Kategori</option>
                <option value="ringan">Ringan</option>
                <option value="sedang">Sedang</option>
                <option value="berat">Berat</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-[#0087FF]"
              >
                <option value="all">Semua Status</option>
                <option value="recorded">Dicatat</option>
                <option value="in_counseling">Dalam Pembinaan</option>
                <option value="resolved">Selesai</option>
              </select>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#0087FF]" />
              <span className="text-xs font-medium">Memuat catatan pelanggaran...</span>
            </div>
          ) : filteredViolations.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <ShieldCheck className="w-10 h-10 mx-auto text-emerald-500/70" />
              <p className="font-bold text-sm text-slate-700">Tidak ada data pelanggaran ditemukan</p>
              <p className="text-xs text-slate-400">Semua siswa tertib atau tidak ada yang sesuai dengan filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/60 text-slate-600 text-[11px] font-extrabold uppercase tracking-wider">
                    <th className="px-4 py-3">Tanggal</th>
                    <th className="px-4 py-3">Nama Siswa</th>
                    <th className="px-4 py-3">Pelanggaran</th>
                    <th className="px-4 py-3">Kategori & Poin</th>
                    <th className="px-4 py-3">Tindakan BK</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredViolations.map((v) => {
                    const dateFormatted = new Date(v.occurred_at).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })
                    const timeFormatted = new Date(v.occurred_at).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })

                    return (
                      <tr key={v.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                          <p className="font-semibold text-slate-800">{dateFormatted}</p>
                          <p className="text-[10px] text-slate-400">{timeFormatted} WIB</p>
                        </td>

                        <td className="px-4 py-3.5">
                          <p className="font-bold text-slate-900">{v.guest?.name || 'Siswa'}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            {v.guest?.identifier || '-'}
                            {v.guest?.custom_data?.kelas ? ` • Kelas ${v.guest.custom_data.kelas}` : ''}
                          </p>
                        </td>

                        <td className="px-4 py-3.5 max-w-xs">
                          <p className="font-semibold text-slate-900">{v.title}</p>
                          {v.notes && (
                            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1 italic">
                              "{v.notes}"
                            </p>
                          )}
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              v.category === 'berat'
                                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                : v.category === 'sedang'
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-blue-100 text-[#007AE6] border border-[#0087FF]/20'
                            }`}>
                              {v.category}
                            </span>
                            <span className="font-bold text-rose-600 font-mono">+{v.points} P</span>
                          </div>
                        </td>

                        <td className="px-4 py-3.5 max-w-xs text-slate-600">
                          {v.action_taken ? (
                            <p className="text-xs font-medium text-slate-800">{v.action_taken}</p>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">- Belum ada tindakan -</span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            v.status === 'resolved'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : v.status === 'in_counseling'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {v.status === 'resolved' && <CheckCircle className="w-3 h-3" />}
                            {v.status === 'in_counseling' && <Clock className="w-3 h-3" />}
                            {v.status === 'resolved' ? 'Selesai' : v.status === 'in_counseling' ? 'Pembinaan' : 'Dicatat'}
                          </span>
                        </td>

                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(v)}
                              className="p-1.5 text-slate-500 hover:text-[#0087FF] hover:bg-[#E0F4FE] rounded-lg transition"
                              title="Update Status & Tindakan"
                            >
                              <PencilSimple className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteViolation(v.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="Hapus Catatan"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Modal Catat Pelanggaran Baru */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <ShieldWarning className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Catat Pelanggaran Siswa</h3>
                  <p className="text-xs text-slate-500">Guru Bimbingan Konseling (BK)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateViolation} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Pilih Siswa *
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-[#0087FF]"
                  required
                >
                  <option value="">-- Pilih Siswa dari Data Sekolah --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.identifier}) {s.kelas ? `- Kelas ${s.kelas}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Judul Pelanggaran *
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Terlambat Masuk Kelas, Seragam Tidak Lengkap, Merokok"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Kategori Pelanggaran
                  </label>
                  <select
                    value={categoryInput}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-[#0087FF]"
                  >
                    <option value="ringan">Ringan (5 Poin)</option>
                    <option value="sedang">Sedang (15 Poin)</option>
                    <option value="berat">Berat (50 Poin)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Poin Pelanggaran
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pointsInput}
                    onChange={(e) => setPointsInput(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold font-mono text-rose-600 outline-none focus:border-[#0087FF]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tindakan Pembinaan BK (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Peringatan lisan, membersihkan lingkungan sekolah, pembinaan wali kelas"
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catatan / Kronologi (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Tambahkan keterangan atau saksi jika diperlukan..."
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF]"
                />
              </div>

              {/* Checkbox Notifikasi WA */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <WhatsappLogo className="w-5 h-5 text-emerald-600" weight="fill" />
                  <div>
                    <p className="text-xs font-bold text-emerald-900">Kirim Notifikasi WA ke Orang Tua</p>
                    <p className="text-[11px] text-emerald-700">Bot akan langsung mengirimkan rincian pelanggaran & poin</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={notifyParent}
                  onChange={(e) => setNotifyParent(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#0087FF] hover:bg-[#0077E6] rounded-xl transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldWarning className="w-3.5 h-3.5" />}
                  <span>Simpan Catatan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Update Status & Tindakan */}
      {showEditModal && selectedViolation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <PencilSimple className="w-5 h-5 text-[#0087FF]" />
                <h3 className="font-bold text-slate-900 text-sm">Update Tindakan & Status BK</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <p className="text-xs font-bold text-slate-900">{selectedViolation.title}</p>
              <p className="text-[11px] text-slate-500">
                Siswa: <span className="font-semibold text-slate-700">{selectedViolation.guest?.name}</span> ({selectedViolation.guest?.identifier})
              </p>
            </div>

            <form onSubmit={handleUpdateViolation} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Status Pembinaan
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-[#0087FF]"
                >
                  <option value="recorded">Dicatat (Menunggu Pembinaan)</option>
                  <option value="in_counseling">Dalam Pembinaan Guru BK</option>
                  <option value="resolved">Selesai (Sudah Diberi Sanksi / Pembinaan)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tindakan yang Telah Diambil
                </label>
                <input
                  type="text"
                  placeholder="Misal: Konseling individu, panggilan orang tua tgl 25 Nov"
                  value={editAction}
                  onChange={(e) => setEditAction(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catatan Evaluasi
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan hasil pembinaan..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#0087FF] hover:bg-[#0077E6] rounded-xl transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  <span>Perbarui Status</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
