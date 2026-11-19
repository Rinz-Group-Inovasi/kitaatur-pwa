'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, Tag, XCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

export default function PaymentPage() {
  const { id } = useParams()
  const router = useRouter()
  const [sub, setSub] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState<string>('')

  const fetchSub = async () => {
    if (!id) return
    try {
      const res = await api.get(`/subscription/${id}`)
      setSub(res.data)
    } catch (err) {
      console.error('Error fetching subscription:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSub()
  }, [id])

  // Polling status secara otomatis setiap 3.5 detik jika status masih unpaid
  useEffect(() => {
    if (!sub || sub.status !== 'unpaid' || !id) return

    const pollInterval = setInterval(async () => {
      try {
        const res = await api.get(`/subscription/${id}`)
        if (res.data && res.data.status !== 'unpaid') {
          setSub(res.data)
        }
      } catch (err) {
        // Ignore background polling errors
      }
    }, 3500)

    return () => clearInterval(pollInterval)
  }, [sub?.status, id])

  // Countdown timer sisa waktu pembayaran QRIS (30 menit sejak dibuat)
  useEffect(() => {
    if (!sub || sub.status !== 'unpaid') return

    const createdTime = sub.created_at ? new Date(sub.created_at).getTime() : Date.now()
    const expiryTime = createdTime + 30 * 60 * 1000

    const updateTimer = () => {
      const now = Date.now()
      const distance = expiryTime - now

      if (distance <= 0) {
        setTimeLeft('Kedaluwarsa')
        return
      }

      const minutes = Math.floor(distance / (1000 * 60))
      const seconds = Math.floor((distance % (1000 * 60)) / 1000)
      setTimeLeft(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [sub?.status, sub?.created_at])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center pt-12 p-6 animate-pulse">
        <div className="w-full max-w-md space-y-6">
          <div className="h-4 w-32 bg-slate-200 rounded-md mb-6" />
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
            <div className="flex justify-between items-center">
              <div className="h-6 w-36 bg-slate-200 rounded-lg" />
              <div className="h-6 w-20 bg-slate-100 rounded-full" />
            </div>
            <div className="h-10 w-48 bg-slate-300 rounded-xl" />
            <div className="w-48 h-48 bg-slate-100 rounded-2xl mx-auto" />
            <div className="h-12 bg-slate-200 rounded-xl w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!sub) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-md bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mb-4">
            <XCircle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Tagihan Tidak Ditemukan</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-xs">
            Data tagihan pembayaran ini mungkin sudah kedaluwarsa atau ID transaksi tidak sesuai.
          </p>
          <Link
            href="/personal/settings/subscription"
            className="w-full py-2.5 px-4 rounded-xl font-bold text-xs text-white bg-[#0087FF] hover:bg-[#0077E6] transition text-center shadow-sm"
          >
            Kembali ke Langganan
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center pt-12 p-6">
      <div className="w-full max-w-md">
        <Link href="/personal/settings/subscription" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-6 text-sm font-medium">
          <ArrowLeft className="w-4 h-4" />
          Kembali ke Pengaturan
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-[#0087FF] via-[#0077E6] to-[#01C4FB] p-6 text-white text-center">
            <h2 className="text-xl font-bold mb-1">Tagihan Langganan</h2>
            <p className="text-white/80 text-sm">Order ID: {sub.kitapay_transaction_id || sub.id}</p>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-slate-500 text-sm">Status</span>
              {sub.plan_type.includes('trial') ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold uppercase tracking-wider">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Masa Uji Coba 7 Hari
                </span>
              ) : sub.status === 'unpaid' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5" /> Menunggu Pembayaran
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-wider">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Lunas
                </span>
              )}
            </div>

            {(() => {
              const isTrial = sub.plan_type?.includes('trial')
              const totalAmount = Number(sub.amount_paid || 0)
              const origAmount = Number(sub.original_amount || 0)

              // Hitung rincian Harga Dasar, Diskon Voucher, PPN 11%, dan Biaya Layanan Pembayaran KitaPay
              const isYearly = (sub.plan_type || '').toLowerCase().includes('yearly')
              const basePrice = origAmount > 0 
                ? Math.round(origAmount / 1.11) 
                : (isYearly ? 400000 : 40000)
              const discountAmt = Math.min(Number(sub.discount_amount || 0), basePrice)
              const discountedBasePrice = Math.max(0, basePrice - discountAmt)
              // PPN 11% mengikuti hitungan dasar dari harga paket (setelah dipotong diskon)
              const ppn = Math.round(discountedBasePrice * 0.11)
              const netSubtotal = discountedBasePrice + ppn
              const fee = totalAmount > 0 ? Math.max(0, totalAmount - netSubtotal) : 0

              return (
                <div className="space-y-3 mb-8">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Paket</span>
                    <span className="font-medium text-slate-900 capitalize">
                      {isTrial ? 'KitaAtur Plus (Trial 7 Hari)' : sub.plan_type.replace('-', ' ')}
                    </span>
                  </div>

                  {!isTrial && totalAmount > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-slate-600">
                        <span>Harga Paket</span>
                        <span className="font-medium text-slate-900">
                          Rp {basePrice.toLocaleString('id-ID')}
                        </span>
                      </div>

                      {sub.voucher_code && discountAmt > 0 && (
                        <div className="flex justify-between text-sm text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100">
                          <span className="flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5" />
                            Diskon Voucher ({sub.voucher_code})
                          </span>
                          <span className="font-bold">
                            - Rp {discountAmt.toLocaleString('id-ID')}
                          </span>
                        </div>
                      )}

                      {sub.voucher_code && discountAmt > 0 && (
                        <div className="flex justify-between text-sm text-slate-600">
                          <span>Harga Paket Setelah Diskon</span>
                          <span className="font-semibold text-slate-900">
                            Rp {discountedBasePrice.toLocaleString('id-ID')}
                          </span>
                        </div>
                      )}

                      <div className="flex justify-between text-sm text-slate-600">
                        <span>PPN (11%)</span>
                        <span className="font-medium text-slate-900">
                          Rp {ppn.toLocaleString('id-ID')}
                        </span>
                      </div>

                      <div className="flex justify-between text-sm text-slate-500 border-t border-slate-100 pt-1.5">
                        <span>Subtotal</span>
                        <span className="font-semibold text-slate-800">
                          Rp {netSubtotal.toLocaleString('id-ID')}
                        </span>
                      </div>

                      {fee > 0 && (
                        <div className="flex justify-between text-sm text-slate-600">
                          <span className="flex items-center gap-1.5">
                            <span>Biaya Layanan (KitaPay)</span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-blue-50 text-[#0087FF] rounded font-semibold border border-blue-100">
                              {fee <= 1500 ? 'Tier 1' : 'Tier 2'}
                            </span>
                          </span>
                          <span className="font-medium text-slate-900">
                            Rp {fee.toLocaleString('id-ID')}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between text-sm border-t border-slate-100 pt-3 items-center">
                    <span className="text-slate-700 font-medium">Total Pembayaran</span>
                    <span className="font-black text-[#0087FF] text-xl">
                      {isTrial ? 'Rp 0 (Gratis Uji Coba)' : `Rp ${totalAmount.toLocaleString('id-ID')}`}
                    </span>
                  </div>
                </div>
              )
            })()}

            {sub.status === 'unpaid' && sub.payment_url && (
              <div className="flex flex-col items-center w-full">
                {sub.payment_url.startsWith('http') ? (
                  <div className="w-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm mb-6 flex flex-col">
                    <iframe 
                      src={sub.payment_url} 
                      className="w-full h-[600px] border-none"
                      title="Pembayaran KitaPay"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                  </div>
                ) : (
                  <div className="bg-white p-4 rounded-xl border border-slate-200 mb-6 shadow-sm flex flex-col items-center">
                    <QRCodeSVG value={sub.payment_url} size={200} />
                    <p className="text-slate-500 text-sm mt-4 text-center">Scan QRIS ini menggunakan aplikasi M-Banking atau E-Wallet Anda</p>
                  </div>
                )}
                
                {timeLeft && (
                  <div className="w-full bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-1">Sisa Waktu Pembayaran</span>
                    <span className="text-2xl font-black text-blue-700 tracking-widest">{timeLeft}</span>
                  </div>
                )}
                
                <p className="text-xs text-slate-400 text-center px-4 leading-relaxed">
                  Catatan: Tergantung pada metode pembayaran yang Anda pilih, mungkin terdapat tambahan biaya layanan dari pihak payment gateway.
                </p>
              </div>
            )}
            
            {sub.status === 'active' && (
              <Link 
                href="/personal/dashboard" 
                className="flex items-center justify-center w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
              >
                Mulai Menggunakan KitaAtur
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
