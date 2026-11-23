'use client'

import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import {
  CircleNotch as Loader2,
  CheckCircle as CheckCircle2,
  Warning as AlertTriangle,
  QrCode,
  PaperPlaneTilt,
  Power,
  ArrowsClockwise,
  WhatsappLogo,
  ShieldCheck,
  DeviceMobile
} from '@phosphor-icons/react'

interface SchoolWhatsAppConnectorProps {
  orgSlug: string
  isLeader: boolean
}

export default function SchoolWhatsAppConnector({ orgSlug, isLeader }: SchoolWhatsAppConnectorProps) {
  const [status, setStatus] = useState<'disconnected' | 'qr_ready' | 'connecting' | 'connected'>('disconnected')
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [lastActiveAt, setLastActiveAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [showTestModal, setShowTestModal] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchStatus = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const res = await api.get(`/whatsapp/${orgSlug}/status`)
      if (res.data) {
        setStatus(res.data.status || 'disconnected')
        setPhoneNumber(res.data.phoneNumber || null)
        setQrCode(res.data.qrCode || null)
        setLastActiveAt(res.data.lastActiveAt || null)
      }
    } catch (err: any) {
      if (!silent) {
        console.error('Failed to load WhatsApp bot status:', err)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [orgSlug])

  // Polling saat status sedang qr_ready atau connecting
  useEffect(() => {
    if (status === 'qr_ready' || status === 'connecting') {
      pollIntervalRef.current = setInterval(() => {
        fetchStatus(true)
      }, 3000)
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [status])

  const handleStart = async () => {
    setActionLoading(true)
    try {
      const res = await api.post(`/whatsapp/${orgSlug}/start`)
      if (res.data) {
        setStatus(res.data.status || 'qr_ready')
        setQrCode(res.data.qrCode || null)
        setPhoneNumber(res.data.phoneNumber || null)
        toast.success('Sesi WhatsApp dimulai. Silakan scan QR code.')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memulai koneksi WhatsApp')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Apakah Anda yakin ingin memutuskan bot WhatsApp sekolah ini?')) return
    setActionLoading(true)
    try {
      await api.post(`/whatsapp/${orgSlug}/disconnect`)
      setStatus('disconnected')
      setQrCode(null)
      setPhoneNumber(null)
      toast.success('Koneksi WhatsApp berhasil diputuskan.')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memutuskan WhatsApp')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testPhone.trim()) {
      toast.error('Masukkan nomor WhatsApp tujuan')
      return
    }

    setSendingTest(true)
    try {
      const res = await api.post(`/whatsapp/${orgSlug}/test`, {
        targetPhone: testPhone.trim()
      })
      toast.success(res.data.message || 'Pesan uji coba terkirim!')
      setShowTestModal(false)
      setTestPhone('')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengirim pesan uji coba')
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shadow-sm">
            <WhatsappLogo className="w-6 h-6" weight="fill" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-slate-900 text-base">Bot WhatsApp Sekolah (Baileys)</h4>
              {status === 'connected' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Terhubung
                </span>
              )}
              {status === 'qr_ready' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                  Menunggu Scan
                </span>
              )}
              {status === 'disconnected' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                  Tidak Terhubung
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Kirimkan notifikasi WhatsApp otomatis ke orang tua saat anak hadir/pulang dan pelanggaran siswa dicatat oleh Guru BK.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchStatus()}
          disabled={loading || actionLoading}
          className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-50 transition"
          title="Segarkan status"
        >
          <ArrowsClockwise className={`w-4 h-4 ${loading ? 'animate-spin text-[#0087FF]' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-[#0087FF]" />
          <span className="text-xs font-medium">Memeriksa koneksi WhatsApp...</span>
        </div>
      ) : (
        <>
          {/* Status: Connected */}
          {status === 'connected' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" weight="bold" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-800">Nomor WhatsApp Bot Aktif</p>
                    <p className="text-sm font-black text-emerald-950 font-mono">+{phoneNumber}</p>
                    {lastActiveAt && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Aktif sejak: {new Date(lastActiveAt).toLocaleString('id-ID')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowTestModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition shadow-sm"
                  >
                    <PaperPlaneTilt className="w-3.5 h-3.5 text-[#0087FF]" />
                    <span>Tes Kirim Pesan</span>
                  </button>

                  {isLeader && (
                    <button
                      onClick={handleDisconnect}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-xl transition disabled:opacity-50"
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>Putuskan</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Notifikasi Masuk</p>
                  <p className="text-xs font-semibold text-slate-800 mt-1">Tap Kiosk & QR Gate</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Otomatis kirim ke WA Ortu</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Notifikasi Pulang</p>
                  <p className="text-xs font-semibold text-slate-800 mt-1">Sesi Kepulangan</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Otomatis kirim waktu pulang</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Notifikasi BK</p>
                  <p className="text-xs font-semibold text-slate-800 mt-1">Poin Pelanggaran</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Orang tua langsung terinfo</p>
                </div>
              </div>
            </div>
          )}

          {/* Status: QR Ready */}
          {status === 'qr_ready' && qrCode && (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col md:flex-row items-center gap-6">
              <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm shrink-0">
                <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 object-contain" />
              </div>

              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
                  <QrCode className="w-4 h-4" />
                  <span>Pindai Kode QR dengan WhatsApp</span>
                </div>
                <h5 className="font-extrabold text-slate-900 text-base">Cara Menghubungkan:</h5>
                <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside leading-relaxed font-medium">
                  <li>Buka aplikasi WhatsApp di HP sekolah / admin.</li>
                  <li>Buka menu opsi / Pengaturan (titik tiga) lalu pilih <strong>Perangkat Tertaut</strong>.</li>
                  <li>Ketuk <strong>Tautkan Perangkat</strong> dan arahkan kamera ke kode QR di samping.</li>
                  <li>Halaman akan otomatis terhubung saat scan berhasil (real-time).</li>
                </ol>

                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={handleStart}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-[#0087FF] bg-[#E0F4FE] hover:bg-[#E0F4FE]/80 rounded-xl transition"
                  >
                    <ArrowsClockwise className="w-3.5 h-3.5" />
                    <span>Muat Ulang QR</span>
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition"
                  >
                    <span>Batalkan</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Status: Disconnected */}
          {status === 'disconnected' && (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm shrink-0">
                  <DeviceMobile className="w-6 h-6" />
                </div>
                <div>
                  <h5 className="font-bold text-slate-900 text-sm">WhatsApp Sekolah Belum Terhubung</h5>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Tautkan nomor WhatsApp sekolah Anda agar bot dapat mengirimkan pesan presensi otomatis dan melayani chat orang tua murid secara mandiri.
                  </p>
                </div>
              </div>

              {isLeader && (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-xl transition shadow-sm shrink-0 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <WhatsappLogo className="w-4 h-4" weight="fill" />}
                  <span>Hubungkan WhatsApp</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal Tes Kirim Pesan */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <PaperPlaneTilt className="w-5 h-5 text-[#0087FF]" />
                <h3 className="font-bold text-slate-900 text-sm">Tes Kirim Notifikasi WhatsApp</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendTest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nomor WhatsApp Tujuan (Ortu / Pribadi)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: 08123456789 atau 628123456789"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 outline-none focus:border-[#0087FF] transition font-mono"
                  autoFocus
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Pesan uji coba akan dikirim langsung dari nomor WhatsApp sekolah yang terhubung.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={sendingTest || !testPhone.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#0087FF] hover:bg-[#0077E6] rounded-xl transition shadow-sm disabled:opacity-50 flex items-center gap-1.5"
                >
                  {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PaperPlaneTilt className="w-3.5 h-3.5" />}
                  <span>Kirim Pesan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
