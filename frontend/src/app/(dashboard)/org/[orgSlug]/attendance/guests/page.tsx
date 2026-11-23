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
  RefreshCw,
  Phone,
  MessageCircle,
  Smartphone 
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

  // WhatsApp Pairing Modal State
  const [showPairWaModal, setShowPairWaModal] = useState(false)
  const [waStudent, setWaStudent] = useState<any | null>(null)
  const [waPhoneInput, setWaPhoneInput] = useState('')
  const [waNameInput, setWaNameInput] = useState('')
  const [isSavingWa, setIsSavingWa] = useState(false)

  // Bulk Delete & Multi-select State
  const [selectedGuestIds, setSelectedGuestIds] = useState<string[]>([])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteTab, setDeleteTab] = useState<'all' | 'class' | 'unlinked'>('all')
  const [confirmText, setConfirmText] = useState('')
  const [targetClass, setTargetClass] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const openPairWaModal = (student: any) => {
    setWaStudent(student)
    setWaPhoneInput(student.parent_phone || '')
    setWaNameInput(student.parent_name || '')
    setShowPairWaModal(true)
  }

  const handleSaveParentWa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!waStudent) return
    setIsSavingWa(true)
    try {
      const res = await api.post(`/whatsapp/${orgSlug}/pair-parent`, {
        guestId: waStudent.id,
        parentPhone: waPhoneInput.trim(),
        parentName: waNameInput.trim()
      })
      toast.success(res.data.message || 'Nomor WhatsApp berhasil ditautkan!')
      setShowPairWaModal(false)
      fetchGuests()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menautkan nomor WhatsApp')
    } finally {
      setIsSavingWa(false)
    }
  }

  // Multi-select & Deletion Handlers
  const toggleSelectGuest = (id: string) => {
    setSelectedGuestIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredGuests.map(g => g.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedGuestIds.includes(id))
    if (allSelected) {
      setSelectedGuestIds(prev => prev.filter(id => !visibleIds.includes(id)))
    } else {
      setSelectedGuestIds(prev => Array.from(new Set([...prev, ...visibleIds])))
    }
  }

  const handleDeleteSingle = async (guest: any) => {
    if (!window.confirm(`Hapus data ${guest.name}? Data presensi dan pelanggaran terkait juga akan dihapus.`)) return
    setIsDeleting(true)
    try {
      const res = await api.delete(`/org-attendance/${orgSlug}/guests/${guest.id}`)
      toast.success(res.data.message || 'Data berhasil dihapus')
      setGuests(prev => prev.filter(g => g.id !== guest.id))
      setSelectedGuestIds(prev => prev.filter(id => id !== guest.id))
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus data')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedGuestIds.length === 0) return
    if (!window.confirm(`Hapus ${selectedGuestIds.length} data siswa terpilih secara permanen?`)) return
    setIsDeleting(true)
    try {
      const res = await api.post(`/org-attendance/${orgSlug}/guests/bulk-delete`, {
        guestIds: selectedGuestIds
      })
      toast.success(res.data.message || `Berhasil menghapus ${selectedGuestIds.length} data`)
      setGuests(prev => prev.filter(g => !selectedGuestIds.includes(g.id)))
      setSelectedGuestIds([])
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus data')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExecuteDeleteModal = async () => {
    if (deleteTab === 'all') {
      if (confirmText.trim().toUpperCase() !== 'HAPUS') {
        toast.error('Ketik "HAPUS" untuk konfirmasi reset total.')
        return
      }
    } else if (deleteTab === 'class') {
      if (!targetClass) {
        toast.error('Pilih kelas yang ingin dihapus.')
        return
      }
    }

    setIsDeleting(true)
    try {
      const payload: any = {}
      if (deleteTab === 'all') payload.deleteAll = true
      if (deleteTab === 'class') payload.kelas = targetClass
      if (deleteTab === 'unlinked') payload.onlyUnlinkedNfc = true

      const res = await api.post(`/org-attendance/${orgSlug}/guests/bulk-delete`, payload)
      toast.success(res.data.message || 'Penghapusan data berhasil!')
      setShowDeleteModal(false)
      setConfirmText('')
      setSelectedGuestIds([])
      fetchGuests()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal menghapus data')
    } finally {
      setIsDeleting(false)
    }
  }

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
      { header: 'NFC_UID', key: 'nfc_uid', width: 20 },
      { header: 'No_WA_Ortu', key: 'no_wa_ortu', width: 20 },
      { header: 'Nama_Ortu', key: 'nama_ortu', width: 25 }
    ]

    // Header styling
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).alignment = { horizontal: 'center' }

    // Add Sample Data
    worksheet.addRow({ nama: 'Budi Santoso', id: '10A-12345', kelas: '10A', nfc_uid: '04A1B2C3D4', no_wa_ortu: '081234567890', nama_ortu: 'Santoso' })
    worksheet.addRow({ nama: 'Siti Aminah', id: '10B-98765', kelas: '10B', nfc_uid: '', no_wa_ortu: '089876543210', nama_ortu: 'Ahmad' })
    
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

        const payload: any[] = []
        const sheetsProcessed: string[] = []

        // Iterasi semua sheet di file Excel (misal: "X A", "X B", "X C", ...)
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName]
          if (!ws) continue

          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
          if (!rows || rows.length === 0) continue

          // Deteksi kelas default dari nama sheet
          let sheetClass = ''
          const cleanSheet = sheetName.trim()
          if (!cleanSheet.toLowerCase().startsWith('sheet') && cleanSheet.toLowerCase() !== 'template') {
            sheetClass = cleanSheet
          }

          // Cari info kelas di baris-baris awal sebelum tabel utama (misal: "KELAS X A")
          for (let r = 0; r < Math.min(rows.length, 10); r++) {
            const rowStr = rows[r].map(c => String(c || '').trim()).join(' ')
            const matchClass = rowStr.match(/KELAS\s*[:\s-]?\s*([A-Za-z0-9\s.-]+)/i)
            if (matchClass && matchClass[1]) {
              const detected = matchClass[1].trim()
              if (detected.length <= 15 && !detected.toLowerCase().includes('fase')) {
                sheetClass = detected
              }
            }
          }

          // Deteksi baris header tabel
          let headerRowIndex = -1
          let nameCol = -1
          let nisCol = -1
          let nisnCol = -1
          let idCol = -1
          let kelasCol = -1
          let jkCol = -1
          let sekolahAsalCol = -1
          let nfcCol = -1
          let parentPhoneCol = -1
          let parentNameCol = -1

          for (let r = 0; r < Math.min(rows.length, 20); r++) {
            const row = rows[r]
            const nextRow = r + 1 < rows.length ? rows[r + 1] : []
            const nonEmpty = row.filter((c: any) => String(c || '').trim().length > 0)
            if (nonEmpty.length < 2) continue

            let tempNameCol = -1
            let hasIdentifierLike = false

            row.forEach((cellVal: any, colIdx: number) => {
              const text1 = String(cellVal || '').toLowerCase().replace(/[\r\n]+/g, ' ').trim()
              const text2 = String(nextRow[colIdx] || '').toLowerCase().replace(/[\r\n]+/g, ' ').trim()
              const comb = `${text1} ${text2}`.trim()

              const isName =
                text1 === 'nama' ||
                text1 === 'name' ||
                text1.includes('nama siswa') ||
                text1.includes('nama peserta didik') ||
                text1.includes('nama lengkap') ||
                text1.includes('student name') ||
                (text1.includes('nama') && !text1.includes('sekolah') && !text1.includes('daftar') && !text1.includes('ortu') && !text1.includes('wali'))

              if (isName) tempNameCol = colIdx

              if (
                text1.includes('nisn') || comb.includes('nisn') ||
                text1 === 'nis' || comb.includes('nis') ||
                text1 === 'id' || text1.includes('identifier') ||
                text1 === 'no' || text1 === 'nomor' || text1.includes('nik') || text1.includes('nim')
              ) {
                hasIdentifierLike = true
              }
            })

            if (tempNameCol !== -1 && hasIdentifierLike) {
              headerRowIndex = r
              break
            }
          }

          if (headerRowIndex === -1) {
            // Bukan sheet tabel siswa, lewati
            continue
          }

          const headerRow = rows[headerRowIndex]
          const subHeaderRow = headerRowIndex + 1 < rows.length ? rows[headerRowIndex + 1] : []

          headerRow.forEach((cellVal: any, colIdx: number) => {
            const t1 = String(cellVal || '').toLowerCase().replace(/[\r\n]+/g, ' ').trim()
            const t2 = String(subHeaderRow[colIdx] || '').toLowerCase().replace(/[\r\n]+/g, ' ').trim()
            const comb = `${t1} ${t2}`.trim()

            if (comb.includes('nama ortu') || comb.includes('nama wali') || comb.includes('parent name')) {
              parentNameCol = colIdx
            } else if (
              t1 === 'nama' || t1 === 'name' ||
              comb.includes('nama siswa') || comb.includes('nama peserta didik') || comb.includes('nama lengkap') ||
              comb.includes('student name') ||
              (t1.includes('nama') && !comb.includes('sekolah') && !comb.includes('daftar') && !comb.includes('ortu') && !comb.includes('wali'))
            ) {
              if (nameCol === -1) nameCol = colIdx
            } else if (comb.includes('nisn') || t1.includes('nisn') || comb === 'nomor nisn' || t1 === 'nomor nisn') {
              nisnCol = colIdx
            } else if (t1 === 'nis' || t2 === 'nis' || comb === 'nis' || comb === 'nomor nis' || (/\bnis\b/.test(t1) && !t1.includes('nisn'))) {
              nisCol = colIdx
            } else if (t1 === 'id' || comb.includes('identifier') || comb.includes('nim') || comb.includes('nik')) {
              idCol = colIdx
            } else if (comb.includes('kelas') || comb.includes('kls') || comb.includes('class') || t1.includes('ket kls') || comb.includes('ket kls')) {
              kelasCol = colIdx
            } else if (comb.includes('jk') || comb.includes('p/l') || comb.includes('l/p') || comb.includes('gender') || comb.includes('jenis kelamin')) {
              jkCol = colIdx
            } else if (comb.includes('sekolah asal') || comb.includes('asal sekolah')) {
              sekolahAsalCol = colIdx
            } else if (comb.includes('nfc') || comb.includes('uid')) {
              nfcCol = colIdx
            } else if (
              comb.includes('no_wa_ortu') || comb.includes('wa ortu') || comb.includes('telepon') ||
              comb.includes('telp') || comb.includes('no wa') || comb.includes('hp ortu') ||
              comb.includes('wa') || comb.includes('phone')
            ) {
              if (parentPhoneCol === -1) parentPhoneCol = colIdx
            }
          })

          let startDataRow = headerRowIndex + 1
          if (subHeaderRow.length > 0) {
            const subStr = subHeaderRow.map(c => String(c || '').trim().toLowerCase()).join(' ')
            if (subStr.includes('nisn') || subStr.includes('nis') || subStr.includes('p/l') || subStr.includes('kls')) {
              startDataRow = headerRowIndex + 2
            }
          }

          let sheetStudentsCount = 0

          for (let r = startDataRow; r < rows.length; r++) {
            const dataRow = rows[r]
            if (!dataRow || dataRow.length === 0) continue

            const rawName = nameCol !== -1 ? String(dataRow[nameCol] || '').trim() : ''
            if (!rawName) continue

            const upper = rawName.toUpperCase()
            if (
              upper.startsWith('JUMLAH') ||
              upper.startsWith('TOTAL') ||
              upper.startsWith('MENGETAHUI') ||
              upper.startsWith('KEPALA') ||
              upper.startsWith('WALI KELAS') ||
              upper.startsWith('GURU') ||
              upper === 'L' || upper === 'P' || upper === 'L/P'
            ) {
              continue
            }

            let rawNis = nisCol !== -1 ? String(dataRow[nisCol] || '').trim() : ''
            let rawNisn = nisnCol !== -1 ? String(dataRow[nisnCol] || '').trim() : ''
            let rawId = idCol !== -1 ? String(dataRow[idCol] || '').trim() : ''

            // Tambahkan angka 0 di depan jika format angka Excel menghilangkan leading zero NISN 10 digit
            if (/^\d{9}$/.test(rawNisn)) {
              rawNisn = '0' + rawNisn
            }

            // Fallback Identifier: NIS -> NISN -> ID Kolom -> Generated Fallback
            const identifier = rawNis || rawNisn || rawId || (sheetClass ? `${sheetClass}-${r + 1}` : `SISWA-${r + 1}`)

            // Fallback Kelas: Kolom KET KLS/KELAS -> Sheet Title -> Sheet Name
            let kelas = kelasCol !== -1 ? String(dataRow[kelasCol] || '').trim() : ''
            if (!kelas && sheetClass) {
              kelas = sheetClass
            }
            if (!kelas && wb.SheetNames.length > 1 && !sheetName.toLowerCase().startsWith('sheet')) {
              kelas = sheetName
            }

            const nfcUid = nfcCol !== -1 ? String(dataRow[nfcCol] || '').trim() : null
            const parentPhone = parentPhoneCol !== -1 ? String(dataRow[parentPhoneCol] || '').trim() : null
            const parentName = parentNameCol !== -1 ? String(dataRow[parentNameCol] || '').trim() : null
            const gender = jkCol !== -1 ? String(dataRow[jkCol] || '').trim() : null
            const sekolahAsal = sekolahAsalCol !== -1 ? String(dataRow[sekolahAsalCol] || '').trim() : null

            payload.push({
              name: rawName,
              identifier,
              kelas: kelas || null,
              nfc_uid: nfcUid || null,
              parent_phone: parentPhone || null,
              parent_name: parentName || null,
              gender: gender || null,
              nisn: rawNisn || null,
              sekolah_asal: sekolahAsal || null
            })
            sheetStudentsCount++
          }

          if (sheetStudentsCount > 0) {
            sheetsProcessed.push(`${sheetName} (${sheetStudentsCount} siswa)`)
          }
        }

        if (payload.length === 0) {
          toast.error("Format file tidak terbaca. Pastikan ada baris tabel dengan kolom 'Nama' dan 'NIS' / 'NISN' / 'ID'.")
          setUploading(false)
          return
        }

        const uploadRes = await api.post(`/org-attendance/${orgSlug}/guests`, { guests: payload })
        toast.success(
          sheetsProcessed.length > 1 
            ? `Berhasil mengimpor ${payload.length} siswa dari ${sheetsProcessed.length} kelas!`
            : uploadRes.data.message || `${payload.length} data siswa berhasil disimpan.`
        )
        fetchGuests()
      } catch (err: any) {
        console.error('Error uploading excel:', err)
        toast.error(err.response?.data?.error || 'Gagal memproses data Excel')
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

  const availableClasses = Array.from(
    new Set(guests.map(g => g.kelas).filter((k): k is string => Boolean(k)))
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

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
                Mendukung format standar KitaAtur maupun <b>Format Absen / Dapodik Sekolah</b> (multi-sheet kelas, NISN/NIS, jenis kelamin).
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
            
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari nama, NIS, kelas, NFC UID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-full md:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {guests.length > 0 && (
                <button
                  onClick={() => {
                    setShowDeleteModal(true)
                    setDeleteTab('all')
                    setConfirmText('')
                    if (availableClasses.length > 0 && !targetClass) {
                      setTargetClass(availableClasses[0])
                    }
                  }}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0 active:scale-95 shadow-xs"
                  title="Opsi hapus massal: reset semua, per kelas, atau siswa tanpa kartu"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  <span className="hidden sm:inline">Kelola & Hapus Data...</span>
                  <span className="sm:hidden">Hapus</span>
                </button>
              )}
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

          {/* Multi-select Action Bar */}
          {selectedGuestIds.length > 0 && (
            <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 flex items-center justify-between animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                <span>{selectedGuestIds.length} data siswa dipilih</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedGuestIds([])}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-lg transition"
                >
                  Batal
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus ({selectedGuestIds.length})</span>
                </button>
              </div>
            </div>
          )}

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
                    <div 
                      key={g.id} 
                      className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between transition-colors ${
                        selectedGuestIds.includes(g.id) ? 'bg-rose-50/40 border-rose-300' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="mb-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={selectedGuestIds.includes(g.id)}
                              onChange={() => toggleSelectGuest(g.id)}
                              className="w-4 h-4 mt-1 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                            />
                            <div>
                              <h4 className="font-bold text-slate-900 text-base">{g.name}</h4>
                              {g.sekolah_asal && (
                                <p className="text-[11px] text-slate-400 mt-0.5">Asal: {g.sekolah_asal}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {g.kelas && (
                              <span className="bg-blue-50 text-[#0087FF] border border-blue-100 font-bold text-xs px-2 py-0.5 rounded-md">
                                {g.kelas}
                              </span>
                            )}
                            <button
                              onClick={() => handleDeleteSingle(g)}
                              disabled={isDeleting}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              title="Hapus siswa ini"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 mt-3">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span className="font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] uppercase">ID/NIS</span>
                            <span className="font-mono">{g.identifier || '-'}</span>
                            {g.nisn && g.nisn !== g.identifier && (
                              <span className="text-[10px] text-slate-400 font-mono">(NISN: {g.nisn})</span>
                            )}
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

                          {/* WA Ortu on Mobile */}
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 mt-1">
                            <span className="text-xs font-semibold text-slate-500">WA Ortu:</span>
                            {g.parent_phone ? (
                              <button
                                onClick={() => openPairWaModal(g)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 active:scale-95"
                              >
                                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                                <span>+{g.parent_phone}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => openPairWaModal(g)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 active:scale-95 hover:bg-emerald-100"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                <span>+ Tautkan WA</span>
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
                  <table className="w-full text-left border-collapse min-w-[750px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/60">
                        <th className="w-10 px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={filteredGuests.length > 0 && filteredGuests.every(g => selectedGuestIds.includes(g.id))}
                            onChange={toggleSelectAllVisible}
                            className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                            title="Pilih semua siswa di tampilan ini"
                          />
                        </th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Nama Siswa</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Kelas</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">ID / NIS</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">Kartu NFC Fisik</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600">WhatsApp Ortu</th>
                        <th className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-slate-600 text-right">Status Kehadiran</th>
                        <th className="w-12 px-3 py-3 text-center text-xs font-extrabold uppercase tracking-wider text-slate-600">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGuests.map((g) => (
                        <tr 
                          key={g.id} 
                          className={`border-b border-slate-100 transition-colors ${
                            selectedGuestIds.includes(g.id) ? 'bg-rose-50/50' : 'hover:bg-slate-50/80'
                          }`}
                        >
                          <td className="w-10 px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedGuestIds.includes(g.id)}
                              onChange={() => toggleSelectGuest(g.id)}
                              className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{g.name}</div>
                            {g.sekolah_asal && (
                              <div className="text-[11px] text-slate-400 mt-0.5">Asal: {g.sekolah_asal}</div>
                            )}
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
                            {g.nisn && g.nisn !== g.identifier && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">NISN: {g.nisn}</div>
                            )}
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
                          <td className="px-4 py-3">
                            {g.parent_phone ? (
                              <button
                                onClick={() => openPairWaModal(g)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors shadow-xs active:scale-95"
                                title="Klik untuk mengubah nomor WhatsApp"
                              >
                                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                                <span>+{g.parent_phone}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => openPairWaModal(g)}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors active:scale-95"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                <span>+ Tautkan WA</span>
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
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => handleDeleteSingle(g)}
                              disabled={isDeleting}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors active:scale-95 disabled:opacity-50"
                              title="Hapus data siswa ini"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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

      {/* Modal Tautkan WhatsApp Orang Tua */}
      {showPairWaModal && waStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Tautkan WhatsApp Orang Tua</h3>
                  <p className="text-xs text-slate-500">Notifikasi presensi & BK otomatis</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPairWaModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <p className="text-xs font-bold text-slate-800">{waStudent.name}</p>
              <p className="text-[11px] text-slate-500">
                NIS: <span className="font-mono">{waStudent.identifier}</span> {waStudent.kelas ? `• Kelas ${waStudent.kelas}` : ''}
              </p>
            </div>

            <form onSubmit={handleSaveParentWa} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nomor WhatsApp Orang Tua / Wali
                </label>
                <input
                  type="text"
                  placeholder="Contoh: 081234567890"
                  value={waPhoneInput}
                  onChange={(e) => setWaPhoneInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-emerald-500 transition font-mono"
                  autoFocus
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Format bisa diawali 08... atau 628... Sistem akan otomatis menormalkan ke format internasional.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nama Orang Tua / Wali (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Bpk. Santoso"
                  value={waNameInput}
                  onChange={(e) => setWaNameInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPairWaModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingWa || !waPhoneInput.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingWa ? 'Menyimpan...' : 'Simpan Nomor WA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kelola & Hapus Massal Data Siswa */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Kelola & Hapus Data Siswa</h3>
                  <p className="text-xs text-slate-500">Pilih opsi pembersihan data yang efisien</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {/* Opsi Tab */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-2xl">
              <button
                type="button"
                onClick={() => setDeleteTab('all')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                  deleteTab === 'all'
                    ? 'bg-white text-rose-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Reset Semua
              </button>
              <button
                type="button"
                onClick={() => setDeleteTab('class')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                  deleteTab === 'class'
                    ? 'bg-white text-rose-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Kelas
              </button>
              <button
                type="button"
                onClick={() => setDeleteTab('unlinked')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                  deleteTab === 'unlinked'
                    ? 'bg-white text-rose-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tanpa Kartu
              </button>
            </div>

            {/* Tab 1: Reset Semua */}
            {deleteTab === 'all' && (
              <div className="space-y-4">
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    Peringatan Tindakan Permanen
                  </p>
                  <p className="text-rose-700 leading-relaxed">
                    Tindakan ini akan menghapus <b>seluruh {guests.length} data siswa</b> di sekolah ini, beserta riwayat presensi kartu gerbang dan catatan pelanggaran terkait.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Ketik <span className="font-mono text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">HAPUS</span> untuk mengonfirmasi:
                  </label>
                  <input
                    type="text"
                    placeholder="Ketik HAPUS"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-rose-500 uppercase transition tracking-wider"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Tab 2: Per Kelas */}
            {deleteTab === 'class' && (
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
                  <p className="font-bold">Hapus Seluruh Siswa di Kelas Tertentu</p>
                  <p className="text-amber-800 leading-relaxed">
                    Data siswa di kelas lain tidak akan terpengaruh. Pilih kelas yang ingin dibersihkan.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Pilih Kelas ({availableClasses.length} kelas terdeteksi):
                  </label>
                  {availableClasses.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Tidak ada data kelas yang terdaftar.</p>
                  ) : (
                    <select
                      value={targetClass}
                      onChange={(e) => setTargetClass(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 outline-none focus:border-rose-500 transition"
                    >
                      {availableClasses.map(cls => {
                        const count = guests.filter(g => g.kelas === cls).length
                        return (
                          <option key={cls} value={cls}>
                            Kelas {cls} ({count} siswa)
                          </option>
                        )
                      })}
                    </select>
                  )}
                </div>

                {targetClass && (
                  <p className="text-xs text-slate-500">
                    Siswa di kelas <b>{targetClass}</b>:{' '}
                    <span className="font-bold text-rose-600">
                      {guests.filter(g => g.kelas === targetClass).length} orang
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Tab 3: Tanpa Kartu */}
            {deleteTab === 'unlinked' && (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 space-y-1">
                  <p className="font-bold text-slate-900">Bersihkan Siswa Tanpa Kartu NFC</p>
                  <p className="text-slate-600 leading-relaxed">
                    Siswa yang sudah memiliki kartu NFC fisik (<b>{totalNfcCount} orang</b>) akan tetap dipertahankan dengan aman.
                  </p>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-amber-800 block">Total Siswa Belum Ada NFC</span>
                    <span className="text-xl font-extrabold text-amber-900 font-mono">
                      {guests.length - totalNfcCount} siswa
                    </span>
                  </div>
                  <span className="text-xs font-bold bg-amber-200/70 text-amber-900 px-2.5 py-1 rounded-lg">
                    Akan Dihapus
                  </span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteDeleteModal}
                disabled={
                  isDeleting ||
                  (deleteTab === 'all' && confirmText.trim().toUpperCase() !== 'HAPUS') ||
                  (deleteTab === 'class' && !targetClass) ||
                  (deleteTab === 'unlinked' && (guests.length - totalNfcCount) === 0)
                }
                className="px-5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 rounded-xl transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {deleteTab === 'all'
                        ? 'Konfirmasi Reset Total'
                        : deleteTab === 'class'
                        ? `Hapus Kelas ${targetClass}`
                        : 'Hapus Siswa Tanpa NFC'}
                    </span>
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
