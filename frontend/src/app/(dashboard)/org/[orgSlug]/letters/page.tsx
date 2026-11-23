'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { 
  ArrowLeft,
  EnvelopeSimple,
  Plus,
  MagnifyingGlass,
  Funnel,
  Trash,
  PencilSimple,
  Sparkle,
  ArrowUpRight,
  ArrowDownLeft,
  Paperclip,
  Copy,
  X,
  ArrowsClockwise,
  CalendarBlank,
  FileText,
  CheckCircle,
  Clock
} from '@phosphor-icons/react'
import { api } from '@/lib/api'
import { useDashboardStore } from '@/lib/dashboard-store'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { CustomUpload } from '@/components/ui/CustomUpload'

interface Letter {
  id: string
  letter_type: 'incoming' | 'outgoing'
  letter_number: string
  title: string
  sender?: string | null
  recipient?: string | null
  letter_date: string
  received_date?: string | null
  status: string
  category?: string | null
  description?: string | null
  file_url?: string | null
  created_at: string
  creator?: {
    full_name: string
    email: string
  }
}

interface LetterSummary {
  total: number
  incomingCount: number
  outgoingCount: number
}

const CATEGORIES = [
  'Semua',
  'Undangan',
  'Permohonan',
  'Pemberitahuan',
  'Surat Keputusan (SK)',
  'Surat Tugas',
  'Edaran',
  'Keterangan',
  'Kerjasama / MoU',
  'Lainnya'
]

export default function LettersPage() {
  const params = useParams()
  const router = useRouter()
  const confirm = useConfirm()
  const orgSlug = params.orgSlug as string

  const store = useDashboardStore()
  const currentUserRole = store.getCurrentRole(orgSlug) || 'member'
  const canManage = ['head', 'vice_head', 'sekretaris'].includes(currentUserRole)

  const [loading, setLoading] = useState(true)
  const [letters, setLetters] = useState<Letter[]>([])
  const [summary, setSummary] = useState<LetterSummary>({ total: 0, incomingCount: 0, outgoingCount: 0 })

  // Filters
  const [activeTab, setActiveTab] = useState<'all' | 'incoming' | 'outgoing'>('all')
  const [selectedCategory, setSelectedCategory] = useState('Semua')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal Form State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLetter, setEditingLetter] = useState<Letter | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    letter_type: 'outgoing' as 'incoming' | 'outgoing',
    letter_number: '',
    title: '',
    sender: '',
    recipient: '',
    letter_date: new Date().toISOString().split('T')[0],
    received_date: '',
    category: 'Undangan',
    status: 'archived',
    description: '',
    file_url: ''
  })

  // AI Number Generator State
  const [generatingNumber, setGeneratingNumber] = useState(false)

  // Fetch Letters Data
  const fetchLetters = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/org-letter/${orgSlug}`, {
        params: {
          type: activeTab,
          category: selectedCategory === 'Semua' ? 'all' : selectedCategory,
          search: searchQuery.trim() || undefined
        }
      })
      if (res.data) {
        setLetters(res.data.letters || [])
        if (res.data.summary) {
          setSummary(res.data.summary)
        }
      }
    } catch (err: any) {
      console.error('Failed to load letters:', err)
      toast.error(err.response?.data?.error || 'Gagal memuat arsip surat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLetters()
  }, [orgSlug, activeTab, selectedCategory])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchLetters()
  }

  // Open Add Modal
  const openAddModal = (type: 'incoming' | 'outgoing' = 'outgoing') => {
    setEditingLetter(null)
    setFormData({
      letter_type: type,
      letter_number: '',
      title: '',
      sender: type === 'incoming' ? '' : '',
      recipient: type === 'outgoing' ? '' : '',
      letter_date: new Date().toISOString().split('T')[0],
      received_date: type === 'incoming' ? new Date().toISOString().split('T')[0] : '',
      category: 'Undangan',
      status: 'archived',
      description: '',
      file_url: ''
    })
    setIsModalOpen(true)
  }

  // Open Edit Modal
  const openEditModal = (letter: Letter) => {
    setEditingLetter(letter)
    setFormData({
      letter_type: letter.letter_type,
      letter_number: letter.letter_number,
      title: letter.title,
      sender: letter.sender || '',
      recipient: letter.recipient || '',
      letter_date: letter.letter_date ? letter.letter_date.split('T')[0] : '',
      received_date: letter.received_date ? letter.received_date.split('T')[0] : '',
      category: letter.category || 'Undangan',
      status: letter.status || 'archived',
      description: letter.description || '',
      file_url: letter.file_url || ''
    })
    setIsModalOpen(true)
  }

  // Save Letter (Create or Update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.letter_number.trim() || !formData.title.trim()) {
      toast.error('Nomor surat dan perihal/judul wajib diisi')
      return
    }

    try {
      setSubmitting(true)
      if (editingLetter) {
        await api.put(`/org-letter/${orgSlug}/${editingLetter.id}`, formData)
        toast.success('Arsip surat berhasil diperbarui')
      } else {
        await api.post(`/org-letter/${orgSlug}`, formData)
        toast.success(`${formData.letter_type === 'incoming' ? 'Surat Masuk' : 'Surat Keluar'} berhasil disimpan`)
      }
      setIsModalOpen(false)
      fetchLetters()
    } catch (err: any) {
      console.error('Error saving letter:', err)
      toast.error(err.response?.data?.error || 'Gagal menyimpan surat')
    } finally {
      setSubmitting(false)
    }
  }

  // Delete Letter
  const handleDelete = async (letter: Letter) => {
    const isConfirmed = await confirm({
      title: 'Hapus Arsip Surat?',
      message: `Apakah Anda yakin ingin menghapus surat nomor "${letter.letter_number}" (${letter.title})? Tindakan ini tidak dapat dibatalkan.`
    })
    if (!isConfirmed) return

    try {
      await api.delete(`/org-letter/${orgSlug}/${letter.id}`)
      toast.success('Arsip surat berhasil dihapus')
      fetchLetters()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus surat')
    }
  }

  // AI Generate Letter Number
  const handleGenerateNumber = async () => {
    try {
      setGeneratingNumber(true)
      const res = await api.post(`/org-letter/${orgSlug}/generate-number`, {
        category: formData.category,
        title: formData.title
      })
      if (res.data?.suggested_number) {
        setFormData(prev => ({ ...prev, letter_number: res.data.suggested_number }))
        toast.success(`Nomor surat di-generate: ${res.data.suggested_number}`)
      }
    } catch (err: any) {
      toast.error('Gagal generate nomor surat otomatis')
    } finally {
      setGeneratingNumber(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Nomor surat disalin ke clipboard')
  }

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      {/* Top Header Navigation */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20 backdrop-blur-md bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => router.back()}
                className="p-2 -ml-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                title="Kembali"
              >
                <ArrowLeft size={20} weight="bold" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <EnvelopeSimple size={26} weight="duotone" className="text-blue-600" />
                    Arsip & Tata Kelola Surat
                  </h1>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Pengelolaan terpusat surat masuk, surat keluar, nomor surat resmi, dan draf organisasi.
                </p>
              </div>
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAddModal('incoming')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                >
                  <ArrowDownLeft size={16} weight="bold" />
                  + Surat Masuk
                </button>
                <button
                  onClick={() => openAddModal('outgoing')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus size={16} weight="bold" />
                  Catat Surat Keluar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Arsip Surat</span>
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                <EnvelopeSimple size={20} weight="duotone" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{summary.total}</span>
              <span className="text-xs text-slate-400 font-medium">dokumen tersimpan</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Surat Masuk</span>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                <ArrowDownLeft size={20} weight="bold" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{summary.incomingCount}</span>
              <span className="text-xs text-slate-400 font-medium">diterima dari eksternal</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Surat Keluar</span>
              <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
                <ArrowUpRight size={20} weight="bold" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-indigo-600">{summary.outgoingCount}</span>
              <span className="text-xs text-slate-400 font-medium">diterbitkan resmi</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Tab Filter */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl self-start">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'all'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua ({summary.total})
              </button>
              <button
                onClick={() => setActiveTab('incoming')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'incoming'
                    ? 'bg-white text-emerald-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDownLeft size={14} weight="bold" />
                Surat Masuk ({summary.incomingCount})
              </button>
              <button
                onClick={() => setActiveTab('outgoing')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'outgoing'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowUpRight size={14} weight="bold" />
                Surat Keluar ({summary.outgoingCount})
              </button>
            </div>

            {/* Search and Category Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>

              <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:w-64">
                <input
                  type="text"
                  placeholder="Cari perihal, nomor, pihak..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <MagnifyingGlass size={16} className="absolute left-3 top-2.5 text-slate-400" />
              </form>

              <button
                onClick={fetchLetters}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                title="Muat Ulang"
              >
                <ArrowsClockwise size={16} weight="bold" className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* Letters List / Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <ArrowsClockwise size={28} weight="bold" className="animate-spin mx-auto text-blue-600 mb-3" />
              <p className="text-sm font-medium">Memuat arsip surat...</p>
            </div>
          ) : letters.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <EnvelopeSimple size={28} weight="duotone" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">Belum Ada Arsip Surat</h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mb-5">
                {searchQuery || selectedCategory !== 'Semua' 
                  ? 'Tidak ada surat yang sesuai dengan filter pencarian.'
                  : 'Catat surat masuk dari pihak eksternal atau terbitkan surat keluar dengan nomor resmi organisasi.'}
              </p>
              {canManage && (
                <button
                  onClick={() => openAddModal('outgoing')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  <Plus size={16} weight="bold" />
                  Mulai Buat Surat
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {letters.map((letter) => {
                const isIncoming = letter.letter_type === 'incoming'
                return (
                  <div 
                    key={letter.id}
                    className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        isIncoming ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {isIncoming ? (
                          <ArrowDownLeft size={20} weight="bold" />
                        ) : (
                          <ArrowUpRight size={20} weight="bold" />
                        )}
                      </div>

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            isIncoming ? 'bg-emerald-100/70 text-emerald-800' : 'bg-blue-100/70 text-blue-800'
                          }`}>
                            {isIncoming ? 'Surat Masuk' : 'Surat Keluar'}
                          </span>

                          {letter.category && (
                            <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {letter.category}
                            </span>
                          )}

                          <span className="text-xs text-slate-400 flex items-center gap-1">
                            <CalendarBlank size={13} />
                            {new Date(letter.letter_date).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => copyToClipboard(letter.letter_number)}
                            className="inline-flex items-center gap-1 font-mono text-xs font-bold text-slate-800 hover:text-blue-600 bg-slate-100 px-2 py-0.5 rounded transition-colors"
                            title="Klik untuk menyalin nomor surat"
                          >
                            <span>{letter.letter_number}</span>
                            <Copy size={13} className="text-slate-400" />
                          </button>
                          <h4 className="text-sm font-bold text-slate-900 truncate">{letter.title}</h4>
                        </div>

                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                          {isIncoming ? (
                            <span><strong className="text-slate-700">Pengirim:</strong> {letter.sender || 'Pihak Luar'}</span>
                          ) : (
                            <span><strong className="text-slate-700">Tujuan/Penerima:</strong> {letter.recipient || 'Semua Anggota/Pihak Terkait'}</span>
                          )}
                          {letter.description && (
                            <span className="text-slate-400 truncate max-w-xs">• {letter.description}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {letter.file_url && (
                        <a
                          href={letter.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                        >
                          <Paperclip size={14} weight="bold" />
                          Lampiran
                        </a>
                      )}

                      {canManage && (
                        <>
                          <button
                            onClick={() => openEditModal(letter)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                            title="Edit Surat"
                          >
                            <PencilSimple size={16} weight="bold" />
                          </button>
                          <button
                            onClick={() => handleDelete(letter)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                            title="Hapus Surat"
                          >
                            <Trash size={16} weight="bold" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Form: Tambah / Edit Surat */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${formData.letter_type === 'incoming' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                  <EnvelopeSimple size={22} weight="duotone" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editingLetter ? 'Edit Data Surat' : (formData.letter_type === 'incoming' ? 'Catat Surat Masuk' : 'Terbitkan Surat Keluar')}
                  </h3>
                  <p className="text-xs text-slate-500">Lengkapi metadata arsip surat resmi organisasi.</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              {/* Type Switcher */}
              {!editingLetter && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Tipe Surat
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, letter_type: 'outgoing' })}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        formData.letter_type === 'outgoing'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <ArrowUpRight size={16} weight="bold" />
                      Surat Keluar (Diterbitkan)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, letter_type: 'incoming' })}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                        formData.letter_type === 'incoming'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <ArrowDownLeft size={16} weight="bold" />
                      Surat Masuk (Diterima)
                    </button>
                  </div>
                </div>
              )}

              {/* Nomor Surat & AI Auto-Generate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Nomor Surat <span className="text-rose-500">*</span>
                  </label>
                  {formData.letter_type === 'outgoing' && (
                    <button
                      type="button"
                      onClick={handleGenerateNumber}
                      disabled={generatingNumber}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline disabled:opacity-50"
                    >
                      <Sparkle size={13} weight="fill" className="text-amber-500" />
                      {generatingNumber ? 'Menghitung...' : 'AI Auto-Numbering'}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="Contoh: 014/OSIS-SMAN1/UND/XI/2026"
                  value={formData.letter_number}
                  onChange={(e) => setFormData({ ...formData, letter_number: e.target.value })}
                  className="w-full px-3.5 py-2.5 font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Perihal / Judul Surat */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Perihal / Judul Surat <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Undangan Rapat Kerja Anggota Tahunan"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Pengirim / Penerima & Kategori */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    {formData.letter_type === 'incoming' ? 'Pengirim (Pihak Luar)' : 'Tujuan / Penerima'}
                  </label>
                  <input
                    type="text"
                    placeholder={formData.letter_type === 'incoming' ? 'Nama instansi / orang pengirim' : 'Nama pihak penerima'}
                    value={formData.letter_type === 'incoming' ? formData.sender : formData.recipient}
                    onChange={(e) => {
                      if (formData.letter_type === 'incoming') {
                        setFormData({ ...formData, sender: e.target.value })
                      } else {
                        setFormData({ ...formData, recipient: e.target.value })
                      }
                    }}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Kategori Surat
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {CATEGORIES.filter(c => c !== 'Semua').map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tanggal Surat & Tanggal Terima */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Tanggal Surat
                  </label>
                  <input
                    type="date"
                    value={formData.letter_date}
                    onChange={(e) => setFormData({ ...formData, letter_date: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {formData.letter_type === 'incoming' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Tanggal Diterima
                    </label>
                    <input
                      type="date"
                      value={formData.received_date}
                      onChange={(e) => setFormData({ ...formData, received_date: e.target.value })}
                      className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                )}
              </div>

              {/* Ringkasan Isi / Catatan */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Ringkasan Isi / Catatan (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan ringkas isi surat, tindak lanjut, atau disposisi..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* File Dokumen / Lampiran */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  File Dokumen / Scan Surat (Opsional)
                </label>
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="Tautan URL dokumen (Google Drive, Dropbox, PDF)..."
                    value={formData.file_url}
                    onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Atau unggah foto fisik surat:</span>
                    <CustomUpload
                      onUpload={(url) => setFormData(prev => ({ ...prev, file_url: url }))}
                      label="Unggah Foto Surat"
                      className="inline-block"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {submitting ? 'Menyimpan...' : (editingLetter ? 'Simpan Perubahan' : 'Arsipkan Surat')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
