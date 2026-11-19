'use client'
import toast from 'react-hot-toast'
import { useState, useEffect, Suspense, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Upload, 
  Download, 
  Printer, 
  Users, 
  CheckCircle2, 
  XCircle, 
  Search, 
  Clock, 
  CreditCard, 
  Radio, 
  Tv, 
  ChevronLeft, 
  ChevronRight, 
  AlertCircle, 
  Trash2, 
  Check, 
  RefreshCw 
} from 'lucide-react'
import { kioskAudio } from '@/lib/kioskAudio'

function GuestsContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgSlug = params.orgSlug as string
  const sessionId = searchParams?.get('sessionId')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [guests, setGuests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [nfcFilter, setNfcFilter] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [isSchool, setIsSchool] = useState(false)

  // NFC Enrollment Modal State
  const [showNfcModal, setShowNfcModal] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null)
  const [nfcInputUid, setNfcInputUid] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [conflictData, setConflictData] = useState<{ uid: string; assignedTo: any } | null>(null)
  const [lastLinkedSuccess, setLastLinkedSuccess] = useState<string | null>(null)

  // Hardware Keypress Listener Buffer for USB NFC Reader in Modal
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  const modalInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchGuests()
  }, [])

  const fetchGuests = async () => {
    try {
      setLoading(true)
      const url = sessionId && sessionId !== 'null' 
        ? `/org-attendance/${orgSlug}/guests?sessionId=${sessionId}`
        : `/org-attendance/${orgSlug}/guests`
      const res = await api.get(url)
      setGuests(res.data)

      try {
        const settingsRes = await api.get(`/org/${orgSlug}/settings`)
        setIsSchool(settingsRes.data?.is_edu || false)
      } catch(e) {}
    } catch (err) {
      toast.error('Gagal memuat daftar peserta eksternal')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default
    const { saveAs } = (await import('file-saver')).default

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Template')

    // Define columns
    worksheet.columns = [
      { header: 'Nama', key: 'nama', width: 30 },
      { header: 'ID', key: 'id', width: 25, style: { numFmt: '@' } }, // Format as Text
      { header: 'Kelas', key: 'kelas', width: 15 },
      { header: 'NFC_UID', key: 'nfc_uid', width: 20 }
    ]

    // Header styling
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).alignment = { horizontal: 'center' }

    // Add Sample Data
    worksheet.addRow({ nama: 'Budi Santoso', id: '10A-12345', kelas: '10A', nfc_uid: '04A1B2C3D4' })
    worksheet.addRow({ nama: 'Siti Aminah', id: '10B-98765', kelas: '10B', nfc_uid: '' })
    
    // Add extra empty rows with text formatting for ID column
    for(let i = 0; i < 50; i++) {
        const row = worksheet.addRow({})
        row.getCell('id').numFmt = '@' 
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    saveAs(blob, 'Template_Peserta_Eksternal_NFC.xlsx')
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx')
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws, { raw: false })

        // Parse data
        const payload = data.map((row: any) => ({
          name: String(row['Nama'] || row['nama'] || row['Name'] || row['name'] || '').trim(),
          identifier: String(row['ID'] || row['id'] || row['Identifier'] || row['NIM'] || row['nim'] || row['NIK'] || '').trim(),
          kelas: row['Kelas'] || row['kelas'] || row['Class'] || row['class'] ? String(row['Kelas'] || row['kelas'] || row['Class'] || row['class']).trim() : null,
          nfc_uid: row['NFC_UID'] || row['nfc_uid'] || row['NFC'] || row['nfc'] || row['UID'] || row['uid'] ? String(row['NFC_UID'] || row['nfc_uid'] || row['NFC'] || row['nfc'] || row['UID'] || row['uid']).trim() : null
        })).filter(g => g.name && g.identifier)

        if (payload.length === 0) {
          toast.error("Format file tidak sesuai. Pastikan ada kolom 'Nama' dan 'ID'.")
          setUploading(false)
          return
        }

        const uploadRes = await api.post(`/org-attendance/${orgSlug}/guests`, { guests: payload })
        toast.success(uploadRes.data.message)
        fetchGuests()
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Gagal mengupload data')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.readAsBinaryString(file)
  }

  // Buka Modal NFC untuk siswa tertentu
  const openNfcModal = (student: any) => {
    setSelectedStudent(student)
    setNfcInputUid('')
    setConflictData(null)
    setLastLinkedSuccess(null)
    setShowNfcModal(true)
    setTimeout(() => {
      modalInputRef.current?.focus()
    }, 150)
  }

  // Buka Pendaftaran Batch: cari siswa pertama yang belum ada kartu NFC
  const openBatchNfcEnrollment = () => {
    const unlinked = guests.find(g => !g.nfc_uid)
    if (unlinked) {
      openNfcModal(unlinked)
    } else if (guests.length > 0) {
      openNfcModal(guests[0])
    } else {
      toast.error('Belum ada siswa dalam daftar.')
    }
  }

  // Navigasi Siswa Sebelumnya / Berikutnya dalam Modal
  const navigateStudent = (direction: 'next' | 'prev') => {
    if (!selectedStudent || guests.length === 0) return
    const currentIndex = guests.findIndex(g => g.id === selectedStudent.id)
    if (currentIndex === -1) return

    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1
    if (nextIndex >= guests.length) nextIndex = 0
    if (nextIndex < 0) nextIndex = guests.length - 1

    setSelectedStudent(guests[nextIndex])
    setNfcInputUid('')
    setConflictData(null)
    setLastLinkedSuccess(null)
    setTimeout(() => {
      modalInputRef.current?.focus()
    }, 100)
  }

  // Cari siswa berikutnya yang belum punya kartu
  const advanceToNextUnlinked = (currentId: string) => {
    const currentIndex = guests.findIndex(g => g.id === currentId)
    // Cari yang belum punya kartu dari index berikutnya
    for (let i = currentIndex + 1; i < guests.length; i++) {
      if (!guests[i].nfc_uid && guests[i].id !== currentId) {
        setSelectedStudent(guests[i])
        setNfcInputUid('')
        setConflictData(null)
        setLastLinkedSuccess(null)
        setTimeout(() => modalInputRef.current?.focus(), 150)
        return
      }
    }
    // Jika tidak ada di depan, cari dari awal
    for (let i = 0; i < currentIndex; i++) {
      if (!guests[i].nfc_uid && guests[i].id !== currentId) {
        setSelectedStudent(guests[i])
        setNfcInputUid('')
        setConflictData(null)
        setLastLinkedSuccess(null)
        setTimeout(() => modalInputRef.current?.focus(), 150)
        return
      }
    }
    toast.success('🎉 Semua siswa dalam daftar sudah terhubung ke kartu NFC!')
  }

  // Eksekusi Tautkan Kartu NFC
  const handleLinkNfc = async (uidToLink: string, force = false) => {
    const cleanUid = (uidToLink || nfcInputUid || '').trim()
    if (!cleanUid || !selectedStudent || isLinking) return

    setIsLinking(true)
    setConflictData(null)

    try {
      const res = await api.post(`/org-attendance/${orgSlug}/nfc/link`, {
        targetType: 'guest',
        targetId: selectedStudent.id,
        guest_id: selectedStudent.id,
        nfc_uid: cleanUid,
        nfcUid: cleanUid,
        uid: cleanUid,
        force
      })

      kioskAudio.playSuccess()
      setLastLinkedSuccess(`Kartu ${cleanUid} berhasil ditautkan!`)
      toast.success(res.data.message || `Kartu berhasil ditautkan ke ${selectedStudent.name}`)

      // Update state lokal seketika
      setGuests(prev => prev.map(g => g.id === selectedStudent.id ? { ...g, nfc_uid: cleanUid } : g))
      setSelectedStudent((prev: any) => prev ? { ...prev, nfc_uid: cleanUid } : null)
      setNfcInputUid('')

      // Jika Auto-Advance aktif, lanjut ke siswa berikutnya yang belum punya kartu
      if (autoAdvance) {
        setTimeout(() => {
          advanceToNextUnlinked(selectedStudent.id)
        }, 600)
      }
    } catch (err: any) {
      if (err.response?.status === 409) {
        kioskAudio.playError()
        setConflictData({
          uid: cleanUid,
          assignedTo: err.response.data.assigned_to || err.response.data.conflictName || 'Pengguna lain'
        })
      } else {
        kioskAudio.playError()
        toast.error(err.response?.data?.error || 'Gagal menautkan kartu NFC')
      }
    } finally {
      setIsLinking(false)
      setTimeout(() => {
        modalInputRef.current?.focus()
      }, 150)
    }
  }

  // Lepas Tautan Kartu NFC
  const handleUnlinkNfc = async () => {
    if (!selectedStudent || !selectedStudent.nfc_uid || isLinking) return

    setIsLinking(true)
    try {
      await api.post(`/org-attendance/${orgSlug}/nfc/unlink`, {
        targetType: 'guest',
        targetId: selectedStudent.id,
        guest_id: selectedStudent.id
      })

      toast.success(`Kartu NFC dilepas dari ${selectedStudent.name}`)
      setGuests(prev => prev.map(g => g.id === selectedStudent.id ? { ...g, nfc_uid: null } : g))
      setSelectedStudent((prev: any) => prev ? { ...prev, nfc_uid: null } : null)
      setNfcInputUid('')
      setConflictData(null)
      setLastLinkedSuccess(null)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal melepas kartu NFC')
    } finally {
      setIsLinking(false)
      setTimeout(() => {
        modalInputRef.current?.focus()
      }, 150)
    }
  }

  // Keyboard Emulation Listener untuk USB Reader saat Modal Buka
  useEffect(() => {
    if (!showNfcModal) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tombol navigasi cepat
      if (e.key === 'ArrowRight' && (e.ctrlKey || e.altKey)) {
        e.preventDefault()
        navigateStudent('next')
        return
      }
      if (e.key === 'ArrowLeft' && (e.ctrlKey || e.altKey)) {
        e.preventDefault()
        navigateStudent('prev')
        return
      }

      const now = Date.now()
      const timeDiff = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3) {
          e.preventDefault()
          const capturedUid = bufferRef.current
          bufferRef.current = ''
          setNfcInputUid(capturedUid)
          handleLinkNfc(capturedUid)
        } else if (nfcInputUid.trim().length >= 3) {
          e.preventDefault()
          handleLinkNfc(nfcInputUid)
        }
        return
      }

      // Reset buffer jika jeda terlalu lama
      if (timeDiff > 150) {
        bufferRef.current = ''
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showNfcModal, selectedStudent, autoAdvance, nfcInputUid, isLinking, guests])

  // Filter List Siswa
  const filteredGuests = guests.filter(g => {
    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (g.identifier && g.identifier.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (g.kelas && g.kelas.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (g.nfc_uid && g.nfc_uid.toLowerCase().includes(searchQuery.toLowerCase()))
    if (!matchesSearch) return false

    // Filter Tab Status
    if (activeTab === 'hadir' && !(g.status === 'present' || g.status === 'late')) return false
    if (activeTab === 'izin' && g.status !== 'izin') return false
    if (activeTab === 'sakit' && g.status !== 'sakit') return false
    if (activeTab === 'alpha' && !(g.status === 'alpha' || (!g.status && !g.check_in_time))) return false

    // Filter NFC
    if (nfcFilter === 'linked' && !g.nfc_uid) return false
    if (nfcFilter === 'unlinked' && !!g.nfc_uid) return false

    return true
  })

  const totalNfcCount = guests.filter(g => !!g.nfc_uid).length
  const currentStudentIndex = selectedStudent ? guests.findIndex(g => g.id === selectedStudent.id) : -1

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 pt-6 pb-4 px-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <Link 
              href={sessionId && sessionId !== 'null' ? `/org/${orgSlug}/attendance/generate?sessionId=${sessionId}` : `/org/${orgSlug}/attendance`}
              className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors mb-3"
            >
              <ArrowLeft className="h-3 w-3" />
              {sessionId && sessionId !== 'null' ? 'Kembali ke Sesi' : 'Kembali ke Presensi'}
            </Link>
            <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-[#0087FF]" />
              {isSchool ? 'Data Siswa & Kartu NFC' : 'Peserta Eksternal & Kartu NFC'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isSchool ? 'Kelola siswa, daftarkan kartu NFC fisik, dan monitor kehadiran gerbang' : 'Kelola tamu dan cetak kartu presensi'}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button 
              onClick={openBatchNfcEnrollment}
              className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
              title="Daftarkan kartu fisik siswa satu per satu dengan USB NFC Reader"
            >
              <CreditCard className="w-4 h-4" />
              <span>Daftarkan Kartu NFC</span>
            </button>
            <Link
              href={`/org/${orgSlug}/attendance/kiosk`}
              className="bg-[#0087FF] hover:bg-[#0077E6] active:scale-95 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
              title="Buka layar Kiosk Presensi Tap Gerbang Sekolah"
            >
              <Tv className="w-4 h-4" />
              <span>Layar Kiosk Gerbang</span>
            </Link>
            <button 
              onClick={() => router.push(`/org/${orgSlug}/attendance/guests/analytics`)}
              className="bg-[#E0F4FE] border border-[#b9e5fa] hover:bg-[#cbeafc] text-[#007AE6] px-3.5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
            >
              <Users className="w-4 h-4 text-[#0087FF]" />
              <span>Statistik</span>
            </button>
            <button 
              onClick={() => router.push(`/org/${orgSlug}/attendance/guests/print`)}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak QR</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 mt-6">
        {/* Upload Excel Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <span>Upload Data {isSchool ? 'Siswa' : 'Peserta'} (Excel)</span>
                <span className="text-[11px] font-bold bg-blue-50 text-[#0087FF] px-2 py-0.5 rounded-full border border-blue-200">
                  Mendukung NFC
                </span>
              </h3>
              <p className="text-sm text-slate-500 mt-0.5">
                Format wajib: Kolom <b>Nama</b> dan <b>ID / NIS</b>. Opsional: <b>Kelas</b>, <b>NFC_UID</b>
              </p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <button 
                onClick={downloadTemplate}
                className="text-blue-600 hover:text-blue-700 text-sm font-bold flex items-center gap-1 shrink-0"
              >
                <Download className="w-4 h-4" />
                Template
              </button>
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all w-full md:w-auto justify-center disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Mengupload...' : 'Upload Excel'}
              </button>
            </div>
          </div>
        </div>

        {/* List Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header Search & Summary */}
          <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50">
            <div>
              <h3 className="font-bold text-slate-800">
                Daftar {isSchool ? 'Siswa' : 'Tamu'} ({guests.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Kartu NFC Terdaftar: <b className="text-emerald-600">{totalNfcCount}</b> / {guests.length} siswa ({Math.round((totalNfcCount / (guests.length || 1)) * 100)}%)
              </p>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Cari nama, NIS, kelas, NFC UID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-full md:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>
          
          {/* Status Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-200 px-4 pt-2 hide-scrollbar">
            {['Semua', 'Hadir', 'Izin', 'Sakit', 'Alpha'].map(tab => {
              const value = tab === 'Semua' ? 'all' : tab.toLowerCase();
              return (
                <button
                  key={value}
                  onClick={() => setActiveTab(value)}
                  className={`px-4 py-3 font-bold text-sm border-b-2 whitespace-nowrap transition-colors ${
                    activeTab === value
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {tab}
                </button>
              )
            })}
          </div>

          {/* NFC Filter Sub-Bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-slate-50/70 border-b border-slate-200 text-xs">
            <span className="font-semibold text-slate-500">Filter Kartu:</span>
            <button
              onClick={() => setNfcFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                nfcFilter === 'all' 
                  ? 'bg-white text-slate-800 shadow-xs border border-slate-200 font-bold' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Semua ({guests.length})
            </button>
            <button
              onClick={() => setNfcFilter('linked')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                nfcFilter === 'linked' 
                  ? 'bg-emerald-50 text-emerald-800 shadow-xs border border-emerald-300 font-bold' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              Sudah Ada NFC ({totalNfcCount})
            </button>
            <button
              onClick={() => setNfcFilter('unlinked')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                nfcFilter === 'unlinked' 
                  ? 'bg-amber-50 text-amber-800 shadow-xs border border-amber-300 font-bold' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
              Belum Ada NFC ({guests.length - totalNfcCount})
            </button>
          </div>

          {/* List Body */}
          <div className="p-4 bg-slate-50/50">
            {loading ? (
              <div className="space-y-3 p-2 animate-pulse">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-14 bg-white border border-slate-200 rounded-xl" />
                ))}
              </div>
            ) : guests.length === 0 ? (
              <div className="p-10 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
                Belum ada data {isSchool ? 'siswa' : 'peserta'} yang diupload. Silakan upload file Excel di atas.
              </div>
            ) : filteredGuests.length === 0 ? (
              <div className="p-10 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
                Pencarian tidak ditemukan.
              </div>
            ) : (
              <div>
                {/* Mobile View: Cards */}
                <div className="grid grid-cols-1 gap-4 md:hidden">
                  {filteredGuests.map((g) => (
                    <div key={g.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                      <div className="mb-4">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-slate-900 text-base">{g.name}</h4>
                          {g.kelas && (
                            <span className="bg-blue-50 text-[#0087FF] border border-blue-100 font-bold text-xs px-2 py-0.5 rounded-md shrink-0">
                              {g.kelas}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5 mt-3">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span className="font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] uppercase">ID/NIS</span>
                            <span className="font-mono">{g.identifier || '-'}</span>
                          </div>
                          
                          {/* NFC Status on Mobile */}
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 mt-1">
                            <span className="text-xs font-semibold text-slate-500">Kartu NFC:</span>
                            {g.nfc_uid ? (
                              <button
                                onClick={() => openNfcModal(g)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 active:scale-95"
                              >
                                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                                <span>{g.nfc_uid}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => openNfcModal(g)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-200 active:scale-95 hover:bg-blue-100"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>+ Tautkan Kartu</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</span>
                        {g.status === 'present' ? (
                          <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-xs font-bold border border-emerald-100">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {g.check_in_time ? new Date(g.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Hadir'}
                          </div>
                        ) : g.status === 'late' ? (
                          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-xs font-bold border border-amber-100">
                            <Clock className="w-3.5 h-3.5" />
                            {g.check_in_time ? new Date(g.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Terlambat'}
                          </div>
                        ) : g.status === 'izin' ? (
                          <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-3 py-1 rounded-full text-xs font-bold border border-amber-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Izin
                          </div>
                        ) : g.status === 'sakit' ? (
                          <div className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-3 py-1 rounded-full text-xs font-bold border border-rose-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Sakit
                          </div>
                        ) : g.status === 'alpha' ? (
                          <div className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-3 py-1 rounded-full text-xs font-bold border border-rose-200">
                            <XCircle className="w-3.5 h-3.5" />
                            Alpha
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-slate-500 bg-slate-100 px-3 py-1 rounded-full text-xs font-bold border border-slate-200">
                            <Clock className="w-3.5 h-3.5" />
                            Belum Hadir
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop View: Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/60">
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Nama Siswa</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Kelas</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">ID / NIS</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Kartu NFC Fisik</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600 text-right">Status Kehadiran</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGuests.map((g) => (
                        <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{g.name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm font-semibold text-slate-600">
                              {g.kelas ? (
                                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-mono">
                                  {g.kelas}
                                </span>
                              ) : '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded-md inline-block">
                              {g.identifier || '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {g.nfc_uid ? (
                              <button
                                onClick={() => openNfcModal(g)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors shadow-xs active:scale-95"
                                title="Klik untuk mengedit atau melepas kartu"
                              >
                                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                                <span>{g.nfc_uid}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => openNfcModal(g)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-[#0087FF] border border-blue-200 transition-colors active:scale-95"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>+ Tautkan Kartu</span>
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 flex justify-end">
                            {g.status === 'present' ? (
                              <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-xs font-bold border border-emerald-100">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {g.check_in_time ? new Date(g.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Hadir'}
                              </div>
                            ) : g.status === 'late' ? (
                              <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-xs font-bold border border-amber-100">
                                <Clock className="w-3.5 h-3.5" />
                                {g.check_in_time ? new Date(g.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Terlambat'}
                              </div>
                            ) : g.status === 'izin' ? (
                              <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-3 py-1 rounded-full text-xs font-bold border border-amber-200">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Izin
                              </div>
                            ) : g.status === 'sakit' ? (
                              <div className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-3 py-1 rounded-full text-xs font-bold border border-rose-200">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Sakit
                              </div>
                            ) : g.status === 'alpha' ? (
                              <div className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-3 py-1 rounded-full text-xs font-bold border border-rose-200">
                                <XCircle className="w-3.5 h-3.5" />
                                Alpha
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-slate-500 bg-slate-100 px-3 py-1 rounded-full text-xs font-bold border border-slate-200">
                                <Clock className="w-3.5 h-3.5" />
                                Belum Hadir
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL PENDAFTARAN KARTU NFC SISWA (USB HID READER / TAP & ENROLL)       */}
      {/* ========================================================================= */}
      {showNfcModal && selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#0087FF] flex items-center justify-center border border-blue-100">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base leading-tight">
                    Pendaftaran Kartu NFC
                  </h3>
                  <p className="text-xs text-slate-500">
                    Siswa {currentStudentIndex + 1} dari {guests.length} ({totalNfcCount} kartu terpasang)
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setShowNfcModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              
              {/* Student Identity Card */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#0087FF]/20 rounded-full blur-2xl"></div>
                <div className="relative z-10">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Profil Siswa
                      </span>
                      <h2 className="text-xl font-black text-white mt-0.5">
                        {selectedStudent.name}
                      </h2>
                    </div>
                    {selectedStudent.kelas && (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/10 text-sky-300 border border-white/10 backdrop-blur-xs">
                        Kelas {selectedStudent.kelas}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400 text-[11px]">Nomor Induk (NIS): </span>
                      <span className="font-mono font-bold text-white ml-1">{selectedStudent.identifier}</span>
                    </div>
                    <div>
                      {selectedStudent.nfc_uid ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-bold">
                          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                          {selectedStudent.nfc_uid}
                        </span>
                      ) : (
                        <span className="text-amber-300/80 text-[11px] font-medium">
                          Belum terhubung kartu
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Conflict Warning Box (If 409) */}
              {conflictData && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-amber-900 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-amber-900 text-sm">
                        Kartu Sudah Terdaftar!
                      </p>
                      <p className="text-amber-800 mt-1 leading-relaxed">
                        Kartu dengan UID <code className="font-mono font-bold bg-amber-100 px-1.5 py-0.5 rounded text-amber-900">{conflictData.uid}</code> sudah digunakan oleh:
                      </p>
                      <p className="font-bold text-slate-900 mt-1 bg-white/80 p-2 rounded-lg border border-amber-200">
                        {conflictData.assignedTo?.name || 'Siswa / Anggota Lain'}
                        {conflictData.assignedTo?.identifier ? ` (${conflictData.assignedTo.identifier})` : ''}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => handleLinkNfc(conflictData.uid, true)}
                          disabled={isLinking}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-xs transition-colors"
                        >
                          {isLinking ? 'Memindahkan...' : 'Ya, Pindahkan ke Siswa Ini'}
                        </button>
                        <button
                          onClick={() => setConflictData(null)}
                          className="bg-white border border-amber-300 text-amber-900 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-amber-100 transition-colors"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tap Zone Interactive */}
              <div className="bg-gradient-to-b from-[#E0F4FE]/40 to-white border-2 border-dashed border-[#0087FF]/40 rounded-2xl p-6 text-center relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 text-[#0087FF] mx-auto flex items-center justify-center mb-3 shadow-inner ring-4 ring-blue-100/50 animate-pulse">
                  <Radio className="w-8 h-8 text-[#0087FF]" />
                </div>
                
                <h4 className="font-extrabold text-slate-900 text-base">
                  Tempelkan Kartu Siswa ke Reader
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1 leading-relaxed">
                  Reader USB akan langsung membaca UID kartu secara otomatis dan memasangkannya ke siswa ini.
                </p>

                {/* Direct Keypress Receiver Input */}
                <div className="mt-4 flex items-center gap-2 max-w-xs mx-auto">
                  <input
                    ref={modalInputRef}
                    type="text"
                    value={nfcInputUid}
                    onChange={(e) => setNfcInputUid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nfcInputUid.trim()) {
                        e.preventDefault()
                        handleLinkNfc(nfcInputUid)
                      }
                    }}
                    placeholder="UID Kartu (Otomatis / Ketik)"
                    disabled={isLinking}
                    className="font-mono text-center text-sm font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#0087FF] uppercase tracking-wider"
                  />
                  <button
                    onClick={() => handleLinkNfc(nfcInputUid)}
                    disabled={!nfcInputUid.trim() || isLinking}
                    className="bg-[#0087FF] hover:bg-[#0077E6] disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-xl shrink-0 shadow-xs transition-all active:scale-95"
                  >
                    {isLinking ? 'Menyimpan...' : 'Tautkan'}
                  </button>
                </div>

                {lastLinkedSuccess && (
                  <p className="mt-2 text-xs font-bold text-emerald-600 flex items-center justify-center gap-1 animate-in fade-in">
                    <Check className="w-3.5 h-3.5" /> {lastLinkedSuccess}
                  </p>
                )}
              </div>

              {/* Already Linked Actions */}
              {selectedStudent.nfc_uid && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    <span>Terhubung ke UID: </span>
                    <strong className="font-mono text-slate-900">{selectedStudent.nfc_uid}</strong>
                  </div>
                  <button
                    onClick={handleUnlinkNfc}
                    disabled={isLinking}
                    className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors border border-rose-200"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Lepas Kartu</span>
                  </button>
                </div>
              )}

              {/* Auto Advance Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200 hover:bg-slate-100/60 transition-colors">
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={(e) => setAutoAdvance(e.target.checked)}
                  className="rounded text-[#0087FF] focus:ring-[#0087FF] w-4 h-4"
                />
                <span className="font-medium">
                  <strong>Mode Cepat:</strong> Langsung lanjut ke siswa berikutnya yang belum punya kartu setelah kartu di-tap
                </span>
              </label>

            </div>

            {/* Modal Footer (Navigation between students) */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => navigateStudent('prev')}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Sebelumnya</span>
              </button>

              <span className="text-xs font-semibold text-slate-500">
                {currentStudentIndex + 1} / {guests.length}
              </span>

              <button
                onClick={() => navigateStudent('next')}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 active:scale-95 transition-all"
              >
                <span>Berikutnya</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}

export default function GuestsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 p-4 md:p-8 animate-pulse">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="h-3 w-28 bg-slate-200 rounded-md mb-2" />
              <div className="h-8 w-60 bg-slate-300 rounded-xl" />
            </div>
            <div className="h-10 w-36 bg-slate-200 rounded-xl" />
          </div>
          <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-sm">
            <div className="h-10 bg-slate-100 rounded-xl w-full" />
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-14 bg-slate-50 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    }>
      <GuestsContent />
    </Suspense>
  )
}
