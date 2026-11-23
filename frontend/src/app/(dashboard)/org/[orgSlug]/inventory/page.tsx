'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { 
  ArrowLeft,
  Package,
  Plus,
  MagnifyingGlass,
  Funnel,
  Trash,
  PencilSimple,
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  Warning,
  Clock,
  ArrowBendUpLeft,
  User,
  Phone,
  MapPin,
  Tag,
  X,
  ShareNetwork,
  ImageSquare
} from '@phosphor-icons/react'
import { api } from '@/lib/api'
import { useDashboardStore } from '@/lib/dashboard-store'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { CustomUpload } from '@/components/ui/CustomUpload'

interface InventoryItem {
  id: string
  item_code?: string | null
  name: string
  category: string
  quantity: number
  available_quantity: number
  unit: string
  condition: 'good' | 'fair' | 'damaged' | string
  location?: string | null
  purchase_date?: string | null
  purchase_price?: number | string | null
  notes?: string | null
  image_url?: string | null
  created_at: string
  creator?: {
    full_name: string
    email: string
  }
  loans?: {
    id: string
    borrower_name: string
    quantity: number
    loan_date: string
    return_due_date?: string | null
  }[]
}

interface InventoryLoan {
  id: string
  borrower_name: string
  borrower_contact?: string | null
  quantity: number
  loan_date: string
  return_due_date?: string | null
  returned_date?: string | null
  status: 'borrowed' | 'returned'
  notes?: string | null
  created_at: string
  inventory: {
    id: string
    name: string
    item_code?: string | null
    unit: string
    location?: string | null
  }
}

interface InventorySummary {
  totalItems: number
  totalAvailable: number
  borrowedCount: number
  damagedCount: number
}

const CATEGORIES = [
  'Semua',
  'Perlengkapan',
  'Elektronik & Gadget',
  'Audio & Visual',
  'ATK & Dokumen',
  'Peralatan Olahraga',
  'Properti & Panggung',
  'Logistik',
  'Lainnya'
]

export default function InventoryPage() {
  const params = useParams()
  const router = useRouter()
  const confirm = useConfirm()
  const orgSlug = params.orgSlug as string

  const store = useDashboardStore()
  const currentUserRole = store.getCurrentRole(orgSlug) || 'member'
  const canManage = ['head', 'vice_head', 'sekretaris', 'bendahara'].includes(currentUserRole)

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loans, setLoans] = useState<InventoryLoan[]>([])
  const [summary, setSummary] = useState<InventorySummary>({
    totalItems: 0,
    totalAvailable: 0,
    borrowedCount: 0,
    damagedCount: 0
  })

  // Navigation tab: 'items' or 'loans'
  const [currentTab, setCurrentTab] = useState<'items' | 'loans'>('items')

  // Filters for items
  const [selectedCategory, setSelectedCategory] = useState('Semua')
  const [selectedCondition, setSelectedCondition] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Filter for loans
  const [loanStatusFilter, setLoanStatusFilter] = useState<'all' | 'borrowed' | 'returned'>('all')

  // Item Modal State
  const [isItemModalOpen, setIsItemModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [submittingItem, setSubmittingItem] = useState(false)
  const [itemFormData, setItemFormData] = useState({
    name: '',
    item_code: '',
    category: 'Perlengkapan',
    quantity: 1,
    unit: 'unit',
    condition: 'good',
    location: '',
    notes: '',
    image_url: ''
  })

  // Loan Modal State
  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false)
  const [selectedItemForLoan, setSelectedItemForLoan] = useState<InventoryItem | null>(null)
  const [submittingLoan, setSubmittingLoan] = useState(false)
  const [loanFormData, setLoanFormData] = useState({
    inventory_id: '',
    borrower_name: '',
    borrower_contact: '',
    quantity: 1,
    loan_date: new Date().toISOString().split('T')[0],
    return_due_date: '',
    notes: ''
  })

  // Fetch Inventory items
  const fetchInventory = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/org-inventory/${orgSlug}`, {
        params: {
          category: selectedCategory === 'Semua' ? 'all' : selectedCategory,
          condition: selectedCondition,
          search: searchQuery.trim() || undefined
        }
      })
      if (res.data) {
        setItems(res.data.items || [])
        if (res.data.summary) {
          setSummary(res.data.summary)
        }
      }
    } catch (err: any) {
      console.error('Failed to load inventory:', err)
      toast.error(err.response?.data?.error || 'Gagal memuat daftar inventaris')
    } finally {
      setLoading(false)
    }
  }

  // Fetch Inventory Loans
  const fetchLoans = async () => {
    try {
      const res = await api.get(`/org-inventory/${orgSlug}/loans`, {
        params: {
          status: loanStatusFilter
        }
      })
      if (res.data) {
        setLoans(res.data)
      }
    } catch (err: any) {
      console.error('Failed to load loans:', err)
    }
  }

  useEffect(() => {
    fetchInventory()
  }, [orgSlug, selectedCategory, selectedCondition])

  useEffect(() => {
    if (currentTab === 'loans') {
      fetchLoans()
    }
  }, [currentTab, loanStatusFilter, orgSlug])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchInventory()
  }

  // Open Add Item Modal
  const openAddItemModal = () => {
    setEditingItem(null)
    setItemFormData({
      name: '',
      item_code: `AST-${String(items.length + 1).padStart(3, '0')}`,
      category: 'Perlengkapan',
      quantity: 1,
      unit: 'unit',
      condition: 'good',
      location: '',
      notes: '',
      image_url: ''
    })
    setIsItemModalOpen(true)
  }

  // Open Edit Item Modal
  const openEditItemModal = (item: InventoryItem) => {
    setEditingItem(item)
    setItemFormData({
      name: item.name,
      item_code: item.item_code || '',
      category: item.category || 'Perlengkapan',
      quantity: item.quantity,
      unit: item.unit || 'unit',
      condition: item.condition || 'good',
      location: item.location || '',
      notes: item.notes || '',
      image_url: item.image_url || ''
    })
    setIsItemModalOpen(true)
  }

  // Save Item
  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!itemFormData.name.trim()) {
      toast.error('Nama barang wajib diisi')
      return
    }

    try {
      setSubmittingItem(true)
      if (editingItem) {
        await api.put(`/org-inventory/${orgSlug}/${editingItem.id}`, itemFormData)
        toast.success('Data barang berhasil diperbarui')
      } else {
        await api.post(`/org-inventory/${orgSlug}`, itemFormData)
        toast.success('Barang baru berhasil ditambahkan ke inventaris')
      }
      setIsItemModalOpen(false)
      fetchInventory()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menyimpan barang')
    } finally {
      setSubmittingItem(false)
    }
  }

  // Delete Item
  const handleDeleteItem = async (item: InventoryItem) => {
    const isConfirmed = await confirm({
      title: 'Hapus Barang Inventaris?',
      message: `Apakah Anda yakin ingin menghapus "${item.name}" dari inventaris organisasi? Tindakan ini tidak dapat dibatalkan.`
    })
    if (!isConfirmed) return

    try {
      await api.delete(`/org-inventory/${orgSlug}/${item.id}`)
      toast.success('Barang berhasil dihapus')
      fetchInventory()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus barang')
    }
  }

  // Open Loan Modal
  const openLoanModal = (item?: InventoryItem) => {
    const targetItem = item || (items.find(i => i.available_quantity > 0) || items[0])
    setSelectedItemForLoan(targetItem || null)
    setLoanFormData({
      inventory_id: targetItem ? targetItem.id : '',
      borrower_name: '',
      borrower_contact: '',
      quantity: 1,
      loan_date: new Date().toISOString().split('T')[0],
      return_due_date: '',
      notes: ''
    })
    setIsLoanModalOpen(true)
  }

  // Save Loan
  const handleLoanSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loanFormData.inventory_id || !loanFormData.borrower_name.trim()) {
      toast.error('Barang dan nama peminjam wajib diisi')
      return
    }

    try {
      setSubmittingLoan(true)
      await api.post(`/org-inventory/${orgSlug}/loans`, loanFormData)
      toast.success('Peminjaman barang berhasil dicatat!')
      setIsLoanModalOpen(false)
      fetchInventory()
      if (currentTab === 'loans') fetchLoans()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mencatat peminjaman')
    } finally {
      setSubmittingLoan(false)
    }
  }

  // Return Loan
  const handleReturnLoan = async (loan: InventoryLoan) => {
    const isConfirmed = await confirm({
      title: 'Kembalikan Barang?',
      message: `Konfirmasi bahwa barang "${loan.inventory.name}" sebanyak ${loan.quantity} ${loan.inventory.unit} telah dikembalikan oleh "${loan.borrower_name}". Stok siap pakai akan ditambahkan kembali.`
    })
    if (!isConfirmed) return

    try {
      await api.post(`/org-inventory/${orgSlug}/loans/${loan.id}/return`)
      toast.success('Pengembalian barang berhasil dicatat. Stok kembali!')
      fetchInventory()
      fetchLoans()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memproses pengembalian')
    }
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
                    <Package size={26} weight="duotone" className="text-amber-500" />
                    Inventaris & Aset Organisasi
                  </h1>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Pencatatan aset barang, stok siap pakai, kondisi, dan monitoring peminjaman.
                </p>
              </div>
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openLoanModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 transition-colors"
                >
                  <ArrowBendUpLeft size={16} weight="bold" />
                  + Catat Peminjaman
                </button>
                <button
                  onClick={openAddItemModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus size={16} weight="bold" />
                  Tambah Barang
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Aset Barang</span>
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                <Package size={20} weight="duotone" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{summary.totalItems}</span>
              <span className="text-xs text-slate-400 font-medium">unit terdata</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Siap Dipakai</span>
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle size={20} weight="duotone" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{summary.totalAvailable}</span>
              <span className="text-xs text-slate-400 font-medium">unit tersedia</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sedang Dipinjam</span>
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                <Clock size={20} weight="duotone" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-600">{summary.borrowedCount}</span>
              <span className="text-xs text-slate-400 font-medium">unit keluar</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kondisi Rusak</span>
              <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600">
                <Warning size={20} weight="duotone" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-rose-600">{summary.damagedCount}</span>
              <span className="text-xs text-slate-400 font-medium">butuh perbaikan</span>
            </div>
          </div>
        </div>

        {/* Tab Switcher: Daftar Aset vs Riwayat Peminjaman */}
        <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
          <button
            onClick={() => setCurrentTab('items')}
            className={`px-4 py-2 text-sm font-bold rounded-xl transition-all ${
              currentTab === 'items'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Daftar Aset ({items.length})
          </button>
          <button
            onClick={() => setCurrentTab('loans')}
            className={`px-4 py-2 text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 ${
              currentTab === 'loans'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Clock size={16} weight="bold" />
            Riwayat Peminjaman ({summary.borrowedCount} aktif)
          </button>
        </div>

        {/* TAB 1: DAFTAR ASET BARANG */}
        {currentTab === 'items' && (
          <div className="space-y-4">
            {/* Filter and Search Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>

                <select
                  value={selectedCondition}
                  onChange={(e) => setSelectedCondition(e.target.value)}
                  className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Semua Kondisi</option>
                  <option value="good">Kondisi Baik</option>
                  <option value="fair">Kurang Baik</option>
                  <option value="damaged">Rusak</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <form onSubmit={handleSearchSubmit} className="relative flex-1 md:w-64">
                  <input
                    type="text"
                    placeholder="Cari barang, kode, lokasi..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <MagnifyingGlass size={16} className="absolute left-3 top-2.5 text-slate-400" />
                </form>

                <button
                  onClick={fetchInventory}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                  title="Muat Ulang"
                >
                  <ArrowsClockwise size={16} weight="bold" className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Items Grid */}
            {loading ? (
              <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                <ArrowsClockwise size={28} weight="bold" className="animate-spin mx-auto text-blue-600 mb-3" />
                <p className="text-sm font-medium">Memuat inventaris barang...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                  <Package size={28} weight="duotone" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1">Belum Ada Barang Inventaris</h3>
                <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mb-5">
                  {searchQuery || selectedCategory !== 'Semua' || selectedCondition !== 'all'
                    ? 'Tidak ada barang yang cocok dengan kriteria pencarian.'
                    : 'Catat aset perlengkapan atau barang milik organisasi agar rapi dan tidak hilang.'}
                </p>
                {canManage && (
                  <button
                    onClick={openAddItemModal}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={16} weight="bold" />
                    Tambah Barang Pertama
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item) => {
                  const isAvailable = item.available_quantity > 0
                  return (
                    <div 
                      key={item.id}
                      className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between overflow-hidden"
                    >
                      <div>
                        {/* Image Preview / Placeholder */}
                        {item.image_url ? (
                          <div className="w-full h-40 bg-slate-100 overflow-hidden relative">
                            <img 
                              src={item.image_url} 
                              alt={item.name} 
                              className="w-full h-full object-cover" 
                            />
                            {item.item_code && (
                              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-slate-900/80 text-white font-mono text-[10px] font-bold backdrop-blur-xs">
                                {item.item_code}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-24 bg-gradient-to-r from-slate-100 to-slate-50 flex items-center justify-between px-4 border-b border-slate-100">
                            <div className="p-3 bg-white rounded-xl shadow-2xs text-slate-600">
                              <Package size={28} weight="duotone" className="text-amber-500" />
                            </div>
                            {item.item_code && (
                              <span className="px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono text-[11px] font-bold">
                                {item.item_code}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="p-5 space-y-3">
                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {item.category}
                            </span>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                              item.condition === 'good' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : item.condition === 'fair' 
                                ? 'bg-amber-100 text-amber-800' 
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {item.condition === 'good' ? 'Baik' : item.condition === 'fair' ? 'Kurang Baik' : 'Rusak'}
                            </span>
                          </div>

                          {/* Title */}
                          <h4 className="text-base font-bold text-slate-900 line-clamp-1">{item.name}</h4>

                          {/* Location & Notes */}
                          <div className="space-y-1 text-xs text-slate-500">
                            {item.location && (
                              <div className="flex items-center gap-1.5 text-slate-600">
                                <MapPin size={14} className="text-slate-400 shrink-0" />
                                <span className="truncate">{item.location}</span>
                              </div>
                            )}
                            {item.notes && (
                              <p className="text-slate-400 text-[11px] line-clamp-2">{item.notes}</p>
                            )}
                          </div>

                          {/* Stock progress */}
                          <div className="pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between text-xs font-semibold mb-1">
                              <span className="text-slate-500">Stok Siap Pakai:</span>
                              <span className={isAvailable ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                                {item.available_quantity} / {item.quantity} {item.unit}
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all ${
                                  isAvailable ? 'bg-emerald-500' : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, (item.available_quantity / item.quantity) * 100))}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="p-3 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between gap-2">
                        {canManage ? (
                          <>
                            <button
                              onClick={() => openLoanModal(item)}
                              disabled={item.available_quantity < 1}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 transition-colors"
                            >
                              <ArrowBendUpLeft size={14} weight="bold" />
                              Pinjamkan
                            </button>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEditItemModal(item)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit Barang"
                              >
                                <PencilSimple size={16} weight="bold" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Hapus Barang"
                              >
                                <Trash size={16} weight="bold" />
                              </button>
                            </div>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400">Hubungi pengurus untuk meminjam</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: RIWAYAT PEMINJAMAN */}
        {currentTab === 'loans' && (
          <div className="space-y-4">
            {/* Filter Status */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLoanStatusFilter('all')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    loanStatusFilter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Semua
                </button>
                <button
                  onClick={() => setLoanStatusFilter('borrowed')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    loanStatusFilter === 'borrowed' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Sedang Dipinjam
                </button>
                <button
                  onClick={() => setLoanStatusFilter('returned')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    loanStatusFilter === 'returned' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Sudah Dikembalikan
                </button>
              </div>

              <button
                onClick={fetchLoans}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                title="Muat Ulang"
              >
                <ArrowsClockwise size={16} weight="bold" />
              </button>
            </div>

            {/* Loans Table */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
              {loans.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                    <Clock size={24} weight="duotone" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">Belum Ada Catatan Peminjaman</h4>
                  <p className="text-xs text-slate-500 mt-1">Peminjaman barang oleh anggota atau pihak luar akan tampil di sini.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {loans.map((loan) => {
                    const isBorrowed = loan.status === 'borrowed'
                    const isOverdue = isBorrowed && loan.return_due_date && new Date(loan.return_due_date) < new Date()

                    return (
                      <div 
                        key={loan.id}
                        className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="flex items-start gap-3.5 flex-1 min-w-0">
                          <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                            isBorrowed ? (isOverdue ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600') : 'bg-emerald-50 text-emerald-600'
                          }`}>
                            {isBorrowed ? <Clock size={20} weight="bold" /> : <CheckCircle size={20} weight="bold" />}
                          </div>

                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                isBorrowed
                                  ? (isOverdue ? 'bg-rose-100 text-rose-800 animate-pulse' : 'bg-amber-100 text-amber-800')
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}>
                                {isBorrowed ? (isOverdue ? 'Terlambat Dikembalikan' : 'Sedang Dipinjam') : 'Sudah Kembali'}
                              </span>

                              <span className="text-xs text-slate-400">
                                Pinjam: {new Date(loan.loan_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>

                              {loan.return_due_date && (
                                <span className={`text-xs font-semibold ${isOverdue ? 'text-rose-600' : 'text-slate-500'}`}>
                                  (Batas: {new Date(loan.return_due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-bold text-slate-900">
                              {loan.inventory?.name} — <span className="text-blue-600 font-extrabold">{loan.quantity} {loan.inventory?.unit || 'unit'}</span>
                            </h4>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <User size={13} className="text-slate-400" />
                                Peminjam: <strong className="text-slate-700">{loan.borrower_name}</strong>
                              </span>

                              {loan.borrower_contact && (
                                <span className="flex items-center gap-1">
                                  <Phone size={13} className="text-slate-400" />
                                  {loan.borrower_contact}
                                </span>
                              )}

                              {loan.notes && (
                                <span className="text-slate-400 truncate max-w-xs">• {loan.notes}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Action: Return Button */}
                        <div className="self-end sm:self-center shrink-0">
                          {isBorrowed && canManage && (
                            <button
                              onClick={() => handleReturnLoan(loan)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs transition-colors"
                            >
                              <CheckCircle size={15} weight="bold" />
                              Kembalikan Barang
                            </button>
                          )}
                          {!isBorrowed && (
                            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle size={14} weight="fill" />
                              Selesai ({loan.returned_date ? new Date(loan.returned_date).toLocaleDateString('id-ID') : '-'})
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: TAMBAH / EDIT BARANG INVENTARIS */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <Package size={22} weight="duotone" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {editingItem ? 'Edit Barang Inventaris' : 'Tambah Aset Barang Baru'}
                  </h3>
                  <p className="text-xs text-slate-500">Catat perlengkapan milik organisasi ke database.</p>
                </div>
              </div>
              <button
                onClick={() => setIsItemModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <form onSubmit={handleItemSubmit} className="mt-5 space-y-4">
              {/* Nama Barang */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Nama Barang <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Proyektor Epson EB-X500, Speaker Portabel, dll."
                  value={itemFormData.name}
                  onChange={(e) => setItemFormData({ ...itemFormData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Kode Barang & Kategori */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Kode / ID Barang
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: AST-001 / ELK-01"
                    value={itemFormData.item_code}
                    onChange={(e) => setItemFormData({ ...itemFormData, item_code: e.target.value })}
                    className="w-full px-3.5 py-2.5 font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Kategori
                  </label>
                  <select
                    value={itemFormData.category}
                    onChange={(e) => setItemFormData({ ...itemFormData, category: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {CATEGORIES.filter(c => c !== 'Semua').map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Jumlah & Satuan & Kondisi */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Jumlah <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={itemFormData.quantity}
                    onChange={(e) => setItemFormData({ ...itemFormData, quantity: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Satuan
                  </label>
                  <input
                    type="text"
                    placeholder="unit, buah, set..."
                    value={itemFormData.unit}
                    onChange={(e) => setItemFormData({ ...itemFormData, unit: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Kondisi
                  </label>
                  <select
                    value={itemFormData.condition}
                    onChange={(e) => setItemFormData({ ...itemFormData, condition: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="good">Baik</option>
                    <option value="fair">Kurang Baik</option>
                    <option value="damaged">Rusak</option>
                  </select>
                </div>
              </div>

              {/* Lokasi Penyimpanan */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Lokasi Simpan
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Ruang Sekretariat - Lemari A Rak 2"
                  value={itemFormData.location}
                  onChange={(e) => setItemFormData({ ...itemFormData, location: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Catatan / Spesifikasi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Catatan / Spesifikasi (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Kelengkapan kabel, serial number, atau nomor garansi..."
                  value={itemFormData.notes}
                  onChange={(e) => setItemFormData({ ...itemFormData, notes: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Foto Barang */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Foto Fisik Barang (Opsional)
                </label>
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="URL gambar foto barang..."
                    value={itemFormData.image_url}
                    onChange={(e) => setItemFormData({ ...itemFormData, image_url: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Atau unggah langsung:</span>
                    <CustomUpload
                      onUpload={(url) => setItemFormData(prev => ({ ...prev, image_url: url }))}
                      label="Unggah Foto"
                      className="inline-block"
                    />
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingItem}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingItem ? 'Menyimpan...' : (editingItem ? 'Simpan Perubahan' : 'Tambahkan ke Inventaris')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CATAT PEMINJAMAN BARANG */}
      {isLoanModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                  <ArrowBendUpLeft size={22} weight="bold" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Catat Peminjaman Barang</h3>
                  <p className="text-xs text-slate-500">Stok barang akan otomatis berkurang selama dipinjam.</p>
                </div>
              </div>
              <button
                onClick={() => setIsLoanModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <form onSubmit={handleLoanSubmit} className="mt-5 space-y-4">
              {/* Pilih Barang */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Pilih Barang yang Dipinjam <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={loanFormData.inventory_id}
                  onChange={(e) => {
                    const selected = items.find(i => i.id === e.target.value)
                    setSelectedItemForLoan(selected || null)
                    setLoanFormData({ ...loanFormData, inventory_id: e.target.value })
                  }}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">-- Pilih Barang --</option>
                  {items.map(item => (
                    <option key={item.id} value={item.id} disabled={item.available_quantity < 1}>
                      {item.name} {item.item_code ? `(${item.item_code})` : ''} — Sisa {item.available_quantity} {item.unit}
                    </option>
                  ))}
                </select>
              </div>

              {/* Jumlah Pinjam */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Jumlah yang Dipinjam <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max={selectedItemForLoan?.available_quantity || 1}
                  required
                  value={loanFormData.quantity}
                  onChange={(e) => setLoanFormData({ ...loanFormData, quantity: parseInt(e.target.value) || 1 })}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {selectedItemForLoan && (
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Maksimal pinjam: {selectedItemForLoan.available_quantity} {selectedItemForLoan.unit}
                  </span>
                )}
              </div>

              {/* Nama Peminjam & Kontak */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Nama Peminjam <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Nama orang / panitia"
                    value={loanFormData.borrower_name}
                    onChange={(e) => setLoanFormData({ ...loanFormData, borrower_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    No. WhatsApp / HP
                  </label>
                  <input
                    type="text"
                    placeholder="0812xxxxxxx"
                    value={loanFormData.borrower_contact}
                    onChange={(e) => setLoanFormData({ ...loanFormData, borrower_contact: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Tanggal Pinjam & Estimasi Kembali */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Tanggal Pinjam
                  </label>
                  <input
                    type="date"
                    required
                    value={loanFormData.loan_date}
                    onChange={(e) => setLoanFormData({ ...loanFormData, loan_date: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Batas Waktu Kembali
                  </label>
                  <input
                    type="date"
                    value={loanFormData.return_due_date}
                    onChange={(e) => setLoanFormData({ ...loanFormData, return_due_date: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Catatan / Keperluan */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Keperluan Pinjam (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Contoh: Dipinjam untuk kegiatan seminar hari Sabtu..."
                  value={loanFormData.notes}
                  onChange={(e) => setLoanFormData({ ...loanFormData, notes: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLoanModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingLoan || !loanFormData.inventory_id}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingLoan ? 'Mencatat...' : 'Konfirmasi Peminjaman'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
