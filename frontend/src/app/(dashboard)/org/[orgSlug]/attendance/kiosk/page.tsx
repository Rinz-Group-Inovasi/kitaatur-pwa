'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { kioskAudio } from '@/lib/kioskAudio'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Maximize2, 
  Minimize2, 
  Volume2, 
  VolumeX, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Radio, 
  Search, 
  X, 
  RefreshCw,
  Sparkles,
  CreditCard
} from 'lucide-react'

interface KioskStudent {
  id: string
  name: string
  identifier: string
  kelas: string | null
  avatar_url: string | null
  type: string
}

interface TapResult {
  student: KioskStudent
  status: 'present' | 'late'
  checkInTime: string
  isCheckOut?: boolean
  alreadyRecorded?: boolean
  message: string
}

interface RecentTap {
  id: string
  name: string
  identifier: string
  kelas: string | null
  status: string
  checkInTime: string
  type: string
}

export default function NfcKioskPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgSlug = params.orgSlug as string
  const customSessionId = searchParams.get('sessionId')

  // State Utama Kiosk
  const [loading, setLoading] = useState(true)
  const [orgData, setOrgData] = useState<any>(null)
  const [sessionData, setSessionData] = useState<any>(null)
  const [stats, setStats] = useState({
    totalStudents: 0,
    presentCount: 0,
    lateCount: 0,
    notYetCount: 0,
    totalAttended: 0
  })
  const [recentTaps, setRecentTaps] = useState<RecentTap[]>([])

  // State Interaktif & Audio
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const [currentDate, setCurrentDate] = useState('')

  // Tap State & Animasi
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastResult, setLastResult] = useState<TapResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showManualModal, setShowManualModal] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [manualSearching, setManualSearching] = useState(false)
  const [manualResults, setManualResults] = useState<any[]>([])

  // Hardware Keypress Listener Buffer
  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 1. Update Jam & Tanggal Digital Real-Time
  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setCurrentDate(now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    }
    updateClock()
    const timer = setInterval(updateClock, 1000)
    return () => clearInterval(timer)
  }, [])

  // 2. Muat Informasi Kiosk & Sesi Aktif
  const fetchKioskInfo = useCallback(async () => {
    try {
      const query = customSessionId ? `?sessionId=${customSessionId}` : ''
      const res = await api.get(`/org-attendance/${orgSlug}/nfc/kiosk-info${query}`)
      setOrgData(res.data.organization)
      setSessionData(res.data.session)
      setStats(res.data.stats || { totalStudents: 0, presentCount: 0, lateCount: 0, notYetCount: 0, totalAttended: 0 })
      setRecentTaps(res.data.recentTaps || [])
    } catch (err: any) {
      console.error('Error fetching kiosk info:', err)
    } finally {
      setLoading(false)
    }
  }, [orgSlug, customSessionId])

  useEffect(() => {
    fetchKioskInfo()
    // Polling statistik setiap 20 detik agar sinkron jika ada guru yang absen manual
    const interval = setInterval(fetchKioskInfo, 20000)
    return () => clearInterval(interval)
  }, [fetchKioskInfo])

  // 3. Proses Tap Kartu NFC (Kirim UID ke Backend)
  const handleProcessCardUid = async (rawUid: string) => {
    const cleanUid = rawUid.trim()
    if (!cleanUid || isProcessing) return

    setIsProcessing(true)
    setErrorMessage(null)

    try {
      const res = await api.post(`/org-attendance/${orgSlug}/nfc/tap`, {
        nfcUid: cleanUid,
        sessionId: sessionData?.id || customSessionId || undefined
      })

      const data = res.data

      // Bunyikan Audio Chime Sesuai Status
      if (soundEnabled) {
        if (data.alreadyRecorded) {
          kioskAudio.playDuplicate()
        } else if (data.status === 'late') {
          kioskAudio.playLate()
        } else {
          kioskAudio.playSuccess()
        }
      }

      setLastResult({
        student: data.student,
        status: data.status,
        checkInTime: data.checkInTime,
        isCheckOut: data.isCheckOut,
        alreadyRecorded: data.alreadyRecorded,
        message: data.message
      })

      // Update Ticker Live Feed (tambahkan siswa ke antrian terbaru)
      if (!data.alreadyRecorded && data.student) {
        const newTap: RecentTap = {
          id: data.student.id,
          name: data.student.name,
          identifier: data.student.identifier,
          kelas: data.student.kelas,
          status: data.status,
          checkInTime: data.checkInTime || new Date().toISOString(),
          type: data.student.type
        }
        setRecentTaps(prev => [newTap, ...prev.slice(0, 9)])

        // Update Counter Statistik
        if (!data.isCheckOut) {
          setStats(prev => ({
            ...prev,
            presentCount: data.status === 'present' ? prev.presentCount + 1 : prev.presentCount,
            lateCount: data.status === 'late' ? prev.lateCount + 1 : prev.lateCount,
            totalAttended: prev.totalAttended + 1,
            notYetCount: Math.max(0, prev.notYetCount - 1)
          }))
        }
      }
    } catch (err: any) {
      const errText = err.response?.data?.error || 'Kartu gagal diproses'
      setErrorMessage(errText)
      if (soundEnabled) {
        kioskAudio.playError()
      }
    } finally {
      setIsProcessing(false)
      // Reset kartu notifikasi setelah 3.2 detik
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = setTimeout(() => {
        setLastResult(null)
        setErrorMessage(null)
      }, 3200)

      // Pastikan input buffer tetap fokus untuk tap berikutnya
      if (inputRef.current) {
        inputRef.current.value = ''
        inputRef.current.focus()
      }
    }
  }

  // 4. Hardware Keypress Listener untuk USB NFC Reader (Keyboard Emulation Mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Abaikan jika user sedang mengetik di modal pencarian manual
      if (showManualModal) return

      // Tombol Hotkey F2: Buka pencarian manual siswa
      if (e.key === 'F2') {
        e.preventDefault()
        setShowManualModal(true)
        return
      }

      const now = Date.now()
      const timeDiff = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      // USB Reader biasanya mengetik karakter dengan jeda sangat cepat (< 60ms)
      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3) {
          e.preventDefault()
          const capturedUid = bufferRef.current
          bufferRef.current = ''
          handleProcessCardUid(capturedUid)
        } else {
          bufferRef.current = ''
        }
        return
      }

      // Jika jeda pengetikan terlalu lama (> 150ms), kemungkinan manusia mengetik biasa, reset buffer
      if (timeDiff > 150) {
        bufferRef.current = ''
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showManualModal, sessionData, customSessionId, isProcessing, soundEnabled])

  // Menjaga agar input tersembunyi selalu fokus
  const keepFocus = () => {
    if (!showManualModal && inputRef.current) {
      inputRef.current.focus()
    }
  }

  // Toggle Layar Penuh
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }

  // Pencarian Manual untuk Siswa Lupa Bawa Kartu
  const handleManualSearch = async (val: string) => {
    setManualQuery(val)
    if (!val.trim()) {
      setManualResults([])
      return
    }

    setManualSearching(true)
    try {
      const res = await api.get(`/org-attendance/${orgSlug}/guests?search=${encodeURIComponent(val)}`)
      const guests = Array.isArray(res.data) ? res.data : []
      const filtered = guests.filter((g: any) => 
        g.name.toLowerCase().includes(val.toLowerCase()) || 
        (g.identifier && g.identifier.toLowerCase().includes(val.toLowerCase())) ||
        (g.kelas && g.kelas.toLowerCase().includes(val.toLowerCase()))
      ).slice(0, 8)
      setManualResults(filtered)
    } catch {
      setManualResults([])
    } finally {
      setManualSearching(false)
    }
  }

  const handleManualCheckIn = async (student: any) => {
    setShowManualModal(false)
    setManualQuery('')
    setManualResults([])
    // Gunakan identifier sebagai pengganti UID
    await handleProcessCardUid(student.identifier || student.id)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFD] text-slate-800 flex flex-col items-center justify-center p-6">
        <RefreshCw className="w-10 h-10 text-[#0087FF] animate-spin mb-4" />
        <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Menyiapkan Kiosk Presensi NFC...</h2>
        <p className="text-xs text-slate-500 mt-1">Menghubungkan ke sistem sekolah & terminal reader</p>
      </div>
    )
  }

  return (
    <div 
      onClick={keepFocus}
      className="min-h-screen bg-[#F8FAFD] text-slate-800 select-none overflow-x-hidden flex flex-col justify-between relative font-sans"
    >
      {/* Ambient decorative soft blurs */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#0087FF]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#01C4FB]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Hidden input to catch USB NFC Keystrokes reliably */}
      <input
        ref={inputRef}
        type="text"
        className="opacity-0 absolute -top-96 left-0 pointer-events-none"
        autoFocus
        onBlur={() => setTimeout(keepFocus, 100)}
      />

      {/* TOP HEADER */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200/80 bg-white/95 backdrop-blur-md shadow-2xs z-20">
        <div className="flex items-center gap-4">
          <Link
            href={`/org/${orgSlug}/attendance`}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition flex items-center gap-2 text-xs font-bold active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dasbor Presensi</span>
          </Link>
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E0F4FE] border border-[#01C4FB]/30 flex items-center justify-center font-bold text-[#007AE6] overflow-hidden shadow-2xs">
              {orgData?.logo_url ? (
                <img src={orgData.logo_url} alt={orgData.name} className="w-full h-full object-cover" />
              ) : (
                orgData?.name?.charAt(0).toUpperCase() || 'S'
              )}
            </div>
            <div>
              <h1 className="font-extrabold text-sm sm:text-base tracking-tight text-slate-900 flex items-center gap-2">
                <span>{orgData?.name || 'Sekolah'}</span>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#E0F4FE] text-[#007AE6] border border-[#01C4FB]/30 font-bold uppercase tracking-wider">
                  Terminal Gerbang
                </span>
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                {sessionData ? sessionData.title : 'Sesi Presensi Harian'} • {currentDate}
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualModal(true)}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-2 transition border border-slate-200 shadow-2xs active:scale-95"
            title="Siswa tidak bawa kartu? Cari manual (F2)"
          >
            <Search className="w-3.5 h-3.5 text-[#0087FF]" />
            <span className="hidden md:inline">Cari Manual (F2)</span>
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 transition border border-slate-200 shadow-2xs"
            title={soundEnabled ? 'Matikan Suara Beep' : 'Nyalakan Suara Beep'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-600" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 transition border border-slate-200 shadow-2xs"
            title="Layar Penuh"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* MAIN KIOSK BODY */}
      <main className="flex-1 flex flex-col justify-center max-w-6xl w-full mx-auto px-6 py-6 space-y-6 z-10">
        
        {/* JAM DIGITAL & STATISTIK ATAS */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          
          {/* Jam Raksasa */}
          <div className="md:col-span-5 bg-white border border-slate-200/90 rounded-3xl p-6 text-center shadow-xs relative overflow-hidden">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>TERMINAL AKTIF & SIAP TEMPEL</span>
            </div>
            <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-slate-900 mb-2">
              {currentTime || '00:00:00'}
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-500">
              Waktu Indonesia Barat (WIB)
            </p>
          </div>

          {/* 4 Counter Statistik Kehadiran */}
          <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 text-center shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Total Siswa</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">{stats.totalStudents}</span>
            </div>

            <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-4 text-center shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block mb-1">Tepat Waktu</span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-600 font-mono">{stats.presentCount}</span>
            </div>

            <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 text-center shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 block mb-1">Terlambat</span>
              <span className="text-2xl sm:text-3xl font-black text-amber-600 font-mono">{stats.lateCount}</span>
            </div>

            <div className="bg-rose-50/60 border border-rose-200/70 rounded-2xl p-4 text-center shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 block mb-1">Belum Hadir</span>
              <span className="text-2xl sm:text-3xl font-black text-rose-600 font-mono">{stats.notYetCount}</span>
            </div>

          </div>
        </div>

        {/* TAP FEEDBACK AREA (DINAMIS SAAT TEMPEL KARTU) */}
        <div className="relative min-h-[260px] flex items-center justify-center">
          
          {/* Skenario 1: Kartu Baru Ditempel (Visual Pop-Up Berhasil) */}
          {lastResult && (
            <div className={`w-full max-w-xl p-8 rounded-3xl shadow-xl border-2 transition-all animate-in zoom-in-95 duration-200 text-center ${
              lastResult.alreadyRecorded
                ? 'bg-gradient-to-b from-white to-blue-50/40 border-blue-400 shadow-blue-500/10'
                : lastResult.status === 'late'
                ? 'bg-gradient-to-b from-white to-amber-50/40 border-amber-400 shadow-amber-500/10'
                : 'bg-gradient-to-b from-white to-emerald-50/40 border-emerald-400 shadow-emerald-500/10'
            }`}>
              <div className="flex flex-col items-center">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-lg text-3xl font-black ring-4 ring-white ${
                  lastResult.alreadyRecorded
                    ? 'bg-[#0087FF] text-white shadow-blue-500/30'
                    : lastResult.status === 'late'
                    ? 'bg-amber-500 text-white shadow-amber-500/30'
                    : 'bg-emerald-600 text-white shadow-emerald-600/30'
                }`}>
                  {lastResult.student.name.charAt(0).toUpperCase()}
                </div>

                <div className="space-y-1 mb-4">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                    {lastResult.student.name}
                  </h2>
                  <p className="text-sm font-semibold text-slate-600 flex items-center justify-center gap-2 flex-wrap">
                    {lastResult.student.kelas && (
                      <span className="bg-blue-50 text-[#0087FF] border border-blue-200 px-2.5 py-0.5 rounded-lg text-xs font-bold">
                        Kelas {lastResult.student.kelas}
                      </span>
                    )}
                    <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-lg text-xs font-mono">
                      NIS: {lastResult.student.identifier}
                    </span>
                  </p>
                </div>

                {/* Badge Status */}
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold uppercase tracking-wide border shadow-2xs ${
                  lastResult.alreadyRecorded
                    ? 'bg-[#E0F4FE] text-[#007AE6] border-[#01C4FB]/40'
                    : lastResult.status === 'late'
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                }`}>
                  {lastResult.status === 'late' ? <Clock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{lastResult.message}</span>
                </div>
              </div>
            </div>
          )}

          {/* Skenario 2: Error / Kartu Belum Terdaftar */}
          {!lastResult && errorMessage && (
            <div className="w-full max-w-xl p-8 rounded-3xl bg-rose-50 border-2 border-rose-300 shadow-xl shadow-rose-500/10 text-center animate-in shake duration-200">
              <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-extrabold text-rose-900 mb-1">Kartu Tidak Dikenali</h3>
              <p className="text-xs sm:text-sm text-rose-700 max-w-md mx-auto leading-relaxed">
                {errorMessage}
              </p>
            </div>
          )}

          {/* Skenario 3: Idle / Standby Siap Tempel Kartu */}
          {!lastResult && !errorMessage && (
            <div className="w-full max-w-xl p-10 rounded-3xl bg-white border-2 border-dashed border-[#0087FF]/40 shadow-xs text-center flex flex-col items-center">
              <div className="relative mb-5">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#E0F4FE] to-[#BAE6FD]/60 text-[#0087FF] flex items-center justify-center shadow-inner ring-8 ring-[#E0F4FE]/70 animate-pulse">
                  <CreditCard className="w-11 h-11 text-[#0087FF]" />
                </div>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-slate-900 mb-2 tracking-tight">
                Silakan Tempelkan Kartu NFC Siswa
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-sm leading-relaxed font-medium">
                Dekatkan kartu ke sensor USB reader. Data kehadiran siswa otomatis dicatat seketika tanpa perlu menekan tombol.
              </p>
            </div>
          )}

        </div>

        {/* DAFTAR SISWA YANG BARU SAJA TAP (ROLLING FEED) */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#0087FF]" />
              <span>Aktivitas Tap Terkini (Live Feed)</span>
            </h4>
            <span className="text-[11px] text-slate-400 font-semibold">10 Siswa Terakhir</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {recentTaps.length > 0 ? (
              recentTaps.map((item, idx) => (
                <div 
                  key={`${item.id}-${idx}`}
                  className="bg-white border border-slate-200/90 rounded-2xl p-3 flex flex-col justify-between hover:border-slate-300 shadow-2xs transition"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-[#E0F4FE] text-[#007AE6] font-bold text-xs flex items-center justify-center shrink-0">
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <p className="font-bold text-xs text-slate-900 truncate">{item.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{item.kelas || item.identifier}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 text-[10px]">
                    <span className="font-mono text-slate-500 font-medium">
                      {new Date(item.checkInTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] uppercase border ${
                      item.status === 'late' 
                        ? 'bg-amber-50 text-amber-700 border-amber-200' 
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {item.status === 'late' ? 'Telat' : 'Hadir'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-6 text-center text-xs text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200">
                Belum ada siswa yang melakukan presensi pada sesi ini.
              </div>
            )}
          </div>
        </div>

      </main>

      {/* FOOTER KIOSK */}
      <footer className="px-6 py-3 border-t border-slate-200/80 bg-white/80 text-center text-[11px] text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2 z-20">
        <span>KitaAtur Edu • Sistem Presensi Cepat Kartu NFC Sekolah</span>
        <span>Tips: Jika reader USB terputus, cabut dan colokkan kembali kabel USB ke laptop/PC.</span>
      </footer>

      {/* MODAL PENCARIAN MANUAL (JIKA SISWA LUPA BAWA KARTU - F2) */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E0F4FE] text-[#007AE6] flex items-center justify-center">
                  <Search className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Presensi Manual Siswa</h3>
                  <p className="text-xs text-slate-500 font-medium">Untuk siswa yang lupa atau kehilangan kartu</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowManualModal(false)
                  setManualQuery('')
                  setManualResults([])
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => handleManualSearch(e.target.value)}
                  placeholder="Ketik Nama Siswa atau NIS..."
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-[#0087FF] focus:ring-2 focus:ring-[#0087FF]/20 transition"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 divide-y divide-slate-100">
              {manualSearching ? (
                <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0087FF]" />
                  <span>Mencari data siswa...</span>
                </div>
              ) : manualResults.length > 0 ? (
                manualResults.map((s) => (
                  <div key={s.id} className="pt-2 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {s.kelas ? `Kelas ${s.kelas} • ` : ''}NIS: {s.identifier}
                      </p>
                    </div>
                    <button
                      onClick={() => handleManualCheckIn(s)}
                      className="px-3.5 py-1.5 bg-[#0087FF] hover:bg-[#0077E6] text-white rounded-xl text-xs font-bold transition active:scale-95 shadow-sm"
                    >
                      Hadirkan
                    </button>
                  </div>
                ))
              ) : manualQuery.trim() ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  Tidak ada siswa ditemukan dengan kata kunci tersebut.
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  Ketik nama atau NIS siswa untuk mencari.
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowManualModal(false)
                  setManualQuery('')
                  setManualResults([])
                }}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                Tutup (Esc)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
