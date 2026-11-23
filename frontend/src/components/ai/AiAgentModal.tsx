'use client'

import React, { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  FileText, 
  Calendar, 
  Copy, 
  Download, 
  Check, 
  RotateCcw, 
  X, 
  Clock, 
  ChevronRight, 
  CheckCircle2, 
  Loader2,
  ListOrdered,
  HelpCircle,
  Building,
  UserCheck,
  Bell,
  AlertTriangle,
  Radio,
  Zap,
  Printer,
  Camera,
  Receipt,
  FileCheck
} from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agendaAction?: any
  reportAction?: any
  broadcastAction?: any
  documentAction?: any
  transactionAction?: any
  timestamp: string
}

interface QuickPrompt {
  id: string
  category: string
  label: string
  prompt: string
}

interface AiAgentModalProps {
  isOpen: boolean
  onClose: () => void
  orgSlug?: string
  mode?: 'org' | 'personal'
  initialPrompt?: string
}

// Simple Markdown Renderer without external bloat
function renderFormattedMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  let inList = false
  let listItems: React.ReactNode[] = []

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="my-2 space-y-1 pl-4 list-disc text-slate-700">
          {listItems}
        </ul>
      )
      listItems = []
      inList = false
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()

    // Header 1 / 2 / 3
    if (trimmed.startsWith('### ')) {
      flushList()
      elements.push(
        <h4 key={index} className="text-sm font-bold text-slate-900 mt-3 mb-1">
          {formatInline(trimmed.replace('### ', ''))}
        </h4>
      )
      return
    }
    if (trimmed.startsWith('## ')) {
      flushList()
      elements.push(
        <h3 key={index} className="text-base font-bold text-slate-900 mt-4 mb-1.5 pb-1 border-b border-slate-200">
          {formatInline(trimmed.replace('## ', ''))}
        </h3>
      )
      return
    }
    if (trimmed.startsWith('# ')) {
      flushList()
      elements.push(
        <h2 key={index} className="text-lg font-extrabold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-300">
          {formatInline(trimmed.replace('# ', ''))}
        </h2>
      )
      return
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true
      listItems.push(
        <li key={index} className="text-xs sm:text-sm text-slate-700 leading-relaxed">
          {formatInline(trimmed.replace(/^[-*]\s+/, ''))}
        </li>
      )
      return
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      flushList()
      elements.push(
        <div key={index} className="flex items-start gap-2 text-xs sm:text-sm text-slate-700 my-1">
          <span className="font-semibold text-sky-600 shrink-0">{trimmed.match(/^\d+\./)?.[0]}</span>
          <span>{formatInline(trimmed.replace(/^\d+\.\s+/, ''))}</span>
        </div>
      )
      return
    }

    flushList()

    // Blank line
    if (!trimmed) {
      elements.push(<div key={index} className="h-2" />)
      return
    }

    // Regular paragraph
    elements.push(
      <p key={index} className="text-xs sm:text-sm text-slate-700 leading-relaxed my-1">
        {formatInline(trimmed)}
      </p>
    )
  })

  flushList()
  return <div className="space-y-0.5">{elements}</div>
}

function formatInline(str: string): React.ReactNode {
  // Bold **text**
  const parts = str.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      )
    }
    // Inline code `code`
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono text-sky-700">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

export default function AiAgentModal({
  isOpen,
  onClose,
  orgSlug,
  mode = 'org',
  initialPrompt
}: AiAgentModalProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Halo! Saya **KitaAtur Copilot**. Ada yang bisa saya bantu terkait laporan kas, agenda kegiatan, atau administrasi hari ini?`,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }
  ])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'Laporan' | 'Agenda' | 'Asisten'>('all')
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([])
  const [applyingAgendaId, setApplyingAgendaId] = useState<string | null>(null)
  const [createdSessionSuccess, setCreatedSessionSuccess] = useState<{ [msgId: string]: { pin: string; title: string } }>({})
  const [broadcastingMsgId, setBroadcastingMsgId] = useState<string | null>(null)
  const [broadcastSuccess, setBroadcastSuccess] = useState<{ [msgId: string]: boolean }>({})
  const [earlyWarnings, setEarlyWarnings] = useState<any>(null)
  const [loadingDigest, setLoadingDigest] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [savingTxId, setSavingTxId] = useState<string | null>(null)
  const [savedTxSuccess, setSavedTxSuccess] = useState<{ [msgId: string]: boolean }>({})

  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    if (isOpen) {
      scrollToBottom()
      loadQuickPrompts()
      if (mode === 'org' && orgSlug) {
        loadEarlyWarnings()
      }
      if (initialPrompt && messages.length === 1) {
        handleSendMessage(initialPrompt)
      }
    }
  }, [isOpen])

  const loadEarlyWarnings = async () => {
    if (!orgSlug) return
    try {
      const res = await api.get(`/ai/agent/${orgSlug}/warnings`)
      if (res.data) {
        setEarlyWarnings(res.data)
      }
    } catch (e) {
      console.warn('Gagal memuat early warning:', e)
    }
  }

  const handleTriggerDigest = async () => {
    if (!orgSlug || loadingDigest) return
    try {
      setLoadingDigest(true)
      const res = await api.post(`/ai/agent/${orgSlug}/trigger-digest`)
      toast.success('Autonomous AI Digest berhasil dikirimkan ke pengurus!')
      if (res.data?.summary) {
        setMessages(prev => [
          ...prev,
          {
            id: `digest-${Date.now()}`,
            role: 'assistant',
            content: `📢 **Autonomous AI Weekly Digest Terkirim:**\n\n${res.data.summary}`,
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ])
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Gagal memicu AI Digest')
    } finally {
      setLoadingDigest(false)
    }
  }

  const handleBroadcastNotification = async (msgId: string, broadcast: any) => {
    if (!orgSlug) {
      toast.error('Penyiaran notifikasi hanya berlaku di ruang Organisasi')
      return
    }

    try {
      setBroadcastingMsgId(msgId)
      const res = await api.post('/ai/agent/broadcast', {
        orgSlug,
        title: broadcast.title || 'Pengumuman Resmi Organisasi',
        body: broadcast.body || broadcast.full_announcement?.slice(0, 150) || 'Pengumuman baru dari pengurus',
        url: `/org/${orgSlug}/dashboard`
      })

      toast.success(res.data.message || 'Notifikasi berhasil disiarkan ke semua anggota!')
      setBroadcastSuccess(prev => ({ ...prev, [msgId]: true }))
    } catch (err: any) {
      console.error('Failed to broadcast:', err)
      toast.error(err?.response?.data?.error || 'Gagal menyiarkan notifikasi ke anggota')
    } finally {
      setBroadcastingMsgId(null)
    }
  }

  const handlePrintDocument = (title: string, content: string) => {
    const printWindow = window.open('', '_blank', 'width=800,height=900')
    if (!printWindow) {
      toast.error('Izinkan pop-up peramban untuk mencetak dokumen')
      return
    }
    const orgTitle = orgSlug ? `ORGANISASI ${orgSlug.toUpperCase()}` : 'KITAATUR ORGANISASI'
    const safeContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            @page { size: A4; margin: 25mm 20mm 20mm 20mm; }
            body { font-family: 'Times New Roman', Times, serif; color: #111; line-height: 1.6; font-size: 12pt; padding: 25px; }
            .kop { text-align: center; border-bottom: 3px double #000; padding-bottom: 12px; margin-bottom: 24px; }
            .kop h2 { margin: 0; font-size: 16pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
            .kop p { margin: 2px 0; font-size: 10pt; color: #333; }
            .content { white-space: pre-wrap; font-size: 12pt; }
          </style>
        </head>
        <body>
          <div class="kop">
            <h2>${orgTitle}</h2>
            <p>Sistem Manajemen Administrasi & Keuangan Organisasi KitaAtur</p>
          </div>
          <div class="content">${safeContent}</div>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  const handleReceiptFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Harap pilih file gambar (JPG/PNG)')
      return
    }

    try {
      setUploadingReceipt(true)
      toast.loading('Mengunggah & memindai struk dengan AI OCR...', { id: 'receipt-ocr' })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'appweb')

      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'djkkckmig'
      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      })
      const uploadData = await uploadRes.json()

      if (!uploadData.secure_url) {
        throw new Error(uploadData.error?.message || 'Gagal mengunggah gambar struk')
      }

      const scanRes = await api.post('/ai/agent/scan-receipt', {
        imageUrl: uploadData.secure_url
      })

      toast.success('Struk berhasil dipindai!', { id: 'receipt-ocr' })
      const tx = scanRes.data?.data

      setMessages(prev => [
        ...prev,
        {
          id: `scan-${Date.now()}`,
          role: 'assistant',
          content: `📸 **Struk Kas Berhasil Dipindai!**\n- **Nominal:** Rp ${parseFloat(tx.amount).toLocaleString('id-ID')}\n- **Kategori:** ${tx.category}\n- **Keterangan:** ${tx.description}\n- **Tanggal:** ${tx.transaction_date}\n\nPeriksa data di bawah, lalu klik **"Simpan ke Buku Kas"** untuk langsung mencatatnya ke database.`,
          transactionAction: tx,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } catch (err: any) {
      console.error('Scan receipt error:', err)
      toast.error(err?.response?.data?.error || err.message || 'Gagal memindai struk', { id: 'receipt-ocr' })
    } finally {
      setUploadingReceipt(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSaveScannedTransaction = async (msgId: string, tx: any) => {
    try {
      setSavingTxId(msgId)
      const res = await api.post('/ai/agent/save-transaction', {
        orgSlug: mode === 'org' ? orgSlug : undefined,
        mode,
        amount: tx.amount,
        type: tx.type || 'expense',
        category: tx.category,
        description: tx.description,
        transaction_date: tx.transaction_date,
        receipt_url: tx.receipt_url
      })

      toast.success(res.data.message || 'Transaksi berhasil dicatat ke kas!')
      setSavedTxSuccess(prev => ({ ...prev, [msgId]: true }))
    } catch (err: any) {
      console.error('Save transaction error:', err)
      toast.error(err?.response?.data?.error || 'Gagal menyimpan transaksi kas')
    } finally {
      setSavingTxId(null)
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  const loadQuickPrompts = async () => {
    try {
      const res = await api.get(`/ai/agent/quick-prompts?mode=${mode}${orgSlug ? `&orgSlug=${orgSlug}` : ''}`)
      if (res.data?.prompts) {
        setQuickPrompts(res.data.prompts)
      }
    } catch (e) {
      console.warn('Gagal memuat rekomendasi prompt:', e)
    }
  }

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || input).trim()
    if (!text || loading) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }))

      const res = await api.post('/ai/agent/chat', {
        message: text,
        orgSlug: mode === 'org' ? orgSlug : undefined,
        mode,
        conversationHistory
      })

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: res.data.reply,
        agendaAction: res.data.agendaAction || null,
        reportAction: res.data.reportAction || null,
        broadcastAction: res.data.broadcastAction || null,
        documentAction: res.data.documentAction || null,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      }

      setMessages(prev => [...prev, botMsg])
    } catch (error: any) {
      console.error('Chat error:', error)
      const errorMsg = error?.response?.data?.error || 'Maaf, terjadi kendala saat memproses permintaan AI Agent.'
      toast.error(errorMsg)

      setMessages(prev => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Gagal memproses:** ${errorMsg}\n\nSilakan coba tanyakan kembali atau pastikan pengaturan API aktif.`,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleApplyAgenda = async (msgId: string, agenda: any) => {
    if (!orgSlug) {
      toast.error('Pembuatan sesi presensi hanya berlaku dalam ruang Organisasi')
      return
    }

    try {
      setApplyingAgendaId(msgId)
      const res = await api.post('/ai/agent/apply-agenda', {
        orgSlug,
        title: agenda.title,
        session_type: agenda.session_type || 'in_only',
        date: agenda.suggested_date,
        start_time: agenda.start_time,
        end_time: agenda.end_time,
        late_time: agenda.late_time
      })

      toast.success(res.data.message || 'Sesi agenda presensi berhasil dibuat!')
      setCreatedSessionSuccess(prev => ({
        ...prev,
        [msgId]: {
          pin: res.data.pin_code,
          title: agenda.title
        }
      }))
    } catch (err: any) {
      console.error('Failed to apply agenda:', err)
      toast.error(err?.response?.data?.error || 'Gagal menerapkan agenda ke presensi.')
    } finally {
      setApplyingAgendaId(null)
    }
  }

  const handleCopyText = (content: string, label = 'Teks') => {
    navigator.clipboard.writeText(content)
    toast.success(`${label} berhasil disalin ke clipboard!`)
  }

  const handleDownloadReport = (title: string, content: string) => {
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.md`
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    toast.success(`Laporan "${filename}" berhasil diunduh!`)
  }

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome-reset',
        role: 'assistant',
        content: `Percakapan baru telah dimulai. Apa yang bisa saya bantu hari ini?`,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      }
    ])
    toast('Percakapan direset', { icon: '🔄' })
  }

  if (!isOpen) return null

  const filteredPrompts = categoryFilter === 'all' 
    ? quickPrompts 
    : quickPrompts.filter(p => p.category.toLowerCase() === categoryFilter.toLowerCase())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full h-full sm:h-[90vh] sm:max-w-3xl flex flex-col bg-white sm:rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0087FF] border border-blue-100 flex items-center justify-center font-bold shadow-xs">
              <Sparkles className="w-5 h-5 text-[#0087FF]" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base leading-tight">KitaAtur Copilot</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                {mode === 'org' && orgSlug ? `Mode Organisasi (${orgSlug})` : 'Mode Pribadi'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleResetChat}
              title="Reset Percakapan"
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title="Tutup"
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifikasi Anomali (Hanya tampil jika ada anomali butuh perhatian) */}
        {mode === 'org' && earlyWarnings?.warnings && earlyWarnings.warnings.length > 0 && (
          <div className="px-4 py-2 bg-amber-50/80 border-b border-amber-200/60 flex items-center justify-between gap-3 text-xs text-amber-900 shrink-0">
            <div className="flex items-center gap-2 truncate">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-semibold truncate">{earlyWarnings.warnings[0].title}</span>
            </div>
            <button
              onClick={() => handleSendMessage(earlyWarnings.warnings[0].actionPrompt)}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 rounded-lg transition shrink-0 shadow-xs"
            >
              Atasi Sekarang
            </button>
          </div>
        )}

        {/* Chat Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`max-w-[85%] sm:max-w-[78%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-3 shadow-xs ${
                    msg.role === 'user'
                      ? 'bg-[#0087FF] text-white rounded-br-sm'
                      : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div>{renderFormattedMarkdown(msg.content)}</div>
                  )}
                </div>

                {/* ACTION CARD: AGENDA PREVIEW & 1-CLICK APPLY */}
                {msg.agendaAction && (
                  <div className="mt-2 w-full bg-white border border-sky-200 rounded-xl p-3 sm:p-4 shadow-sm bg-gradient-to-b from-sky-50/40 to-white">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-sky-100">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 bg-sky-100 text-sky-700 rounded-lg">
                          <Calendar className="w-4 h-4" />
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">{msg.agendaAction.title || 'Agenda Baru'}</h4>
                          <span className="text-[10px] text-sky-600 font-medium">
                            {msg.agendaAction.session_type === 'in_out' ? 'Masuk & Pulang' : 'Presensi Satu Arah'}
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
                        Siap Didaftarkan
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Jadwal Acara</span>
                        <span className="font-semibold text-slate-800">
                          {msg.agendaAction.suggested_date || 'Hari ini'}, {msg.agendaAction.start_time} - {msg.agendaAction.end_time} WIB
                        </span>
                      </div>
                      {msg.agendaAction.late_time && (
                        <div>
                          <span className="text-[10px] text-slate-400 block">Batas Terlambat</span>
                          <span className="font-semibold text-amber-600">{msg.agendaAction.late_time} WIB</span>
                        </div>
                      )}
                    </div>

                    {msg.agendaAction.items && Array.isArray(msg.agendaAction.items) && msg.agendaAction.items.length > 0 && (
                      <div className="mb-3">
                        <span className="text-[11px] font-bold text-slate-700 block mb-1">Rundown Kegiatan:</span>
                        <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                          {msg.agendaAction.items.map((it: any, i: number) => (
                            <div key={i} className="flex items-center justify-between text-xs bg-white p-1.5 rounded border border-slate-100">
                              <span className="font-mono text-[10px] text-slate-500">{it.time}</span>
                              <span className="font-medium text-slate-800 flex-1 px-2 truncate">{it.activity}</span>
                              <span className="text-[10px] text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">{it.pic || 'PIC'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {createdSessionSuccess[msg.id] ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-emerald-900">Sesi Presensi Aktif!</p>
                            <p className="text-[10px] text-emerald-700">PIN Absensi: <strong className="font-mono text-emerald-900">{createdSessionSuccess[msg.id].pin}</strong></p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleCopyText(createdSessionSuccess[msg.id].pin, 'PIN Presensi')}
                          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 transition"
                        >
                          Salin PIN
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 pt-1">
                        {mode === 'org' && orgSlug && (
                          <button
                            onClick={() => handleApplyAgenda(msg.id, msg.agendaAction)}
                            disabled={applyingAgendaId === msg.id}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:scale-95 rounded-lg transition disabled:opacity-50"
                          >
                            {applyingAgendaId === msg.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Mendaftarkan ke Sesi...
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Daftarkan Jadi Sesi Presensi
                              </>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopyText(
                            `RUNDOWN ACARA: ${msg.agendaAction.title}\n` +
                            `Waktu: ${msg.agendaAction.start_time} - ${msg.agendaAction.end_time}\n\n` +
                            (msg.agendaAction.items || []).map((it: any) => `[${it.time}] ${it.activity} (PIC: ${it.pic})`).join('\n'),
                            'Rundown Acara'
                          )}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                        >
                          <Copy className="w-3.5 h-3.5" /> Salin Rundown
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ACTION CARD: REPORT ACTIONS */}
                {msg.reportAction && (
                  <div className="mt-2 w-full bg-white border border-emerald-200 rounded-xl p-3 shadow-sm bg-gradient-to-b from-emerald-50/40 to-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                        <FileText className="w-4 h-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">{msg.reportAction.title || 'Laporan Terstruktur'}</h4>
                        <span className="text-[10px] text-emerald-600 font-medium">Periode: {msg.reportAction.period || 'Berjalan'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopyText(msg.content, 'Laporan Lengkap')}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-sm transition"
                      >
                        <Copy className="w-3 h-3 text-slate-500" /> Salin
                      </button>
                      <button
                        onClick={() => handleDownloadReport(msg.reportAction.title || 'Laporan', msg.content)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition"
                      >
                        <Download className="w-3 h-3" /> Unduh .md
                      </button>
                    </div>
                  </div>
                )}

                {/* ACTION CARD: AGENTIC BROADCAST ANNOUNCEMENT */}
                {msg.broadcastAction && (
                  <div className="mt-2 w-full bg-white border border-indigo-200 rounded-xl p-3 sm:p-4 shadow-sm bg-gradient-to-b from-indigo-50/40 to-white">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-indigo-100">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                          <Bell className="w-4 h-4" />
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">{msg.broadcastAction.title || 'Pengumuman Siaran'}</h4>
                          <span className="text-[10px] text-indigo-600 font-medium">Siaran Push Notification Organisasi</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md">
                        Agentic Broadcast
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 mb-3 leading-relaxed">
                      "{msg.broadcastAction.body || msg.broadcastAction.full_announcement?.slice(0, 150)}"
                    </p>

                    {broadcastSuccess[msg.id] ? (
                      <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Notifikasi berhasil disiarkan ke seluruh anggota!
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {mode === 'org' && orgSlug && (
                          <button
                            onClick={() => handleBroadcastNotification(msg.id, msg.broadcastAction)}
                            disabled={broadcastingMsgId === msg.id}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-lg transition disabled:opacity-50"
                          >
                            {broadcastingMsgId === msg.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Menyiarkan Notifikasi...
                              </>
                            ) : (
                              <>
                                <Radio className="w-3.5 h-3.5" />
                                Siarkan Push Notification Sekarang
                              </>
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleCopyText(msg.broadcastAction.full_announcement || msg.broadcastAction.body || msg.content, 'Teks Pengumuman')}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                        >
                          <Copy className="w-3.5 h-3.5" /> Salin Teks
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ACTION CARD: PRINTABLE OFFICIAL DOCUMENT (LPJ, SURAT IZIN, PROPOSAL) */}
                {msg.documentAction && (
                  <div className="mt-2 w-full bg-white border border-amber-200 rounded-xl p-3 sm:p-4 shadow-sm bg-gradient-to-b from-amber-50/40 to-white">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-100">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                          <FileCheck className="w-4 h-4" />
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">{msg.documentAction.title || 'Dokumen Resmi'}</h4>
                          <span className="text-[10px] text-amber-700 font-medium">Format Naskah Resmi Organisasi</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded-md">
                        Siap Cetak A4
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        onClick={() => handlePrintDocument(msg.documentAction.title || 'Dokumen Resmi', msg.content)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 active:scale-95 rounded-lg shadow-xs transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Cetak / Print Dokumen (Kop Resmi)
                      </button>
                      <button
                        onClick={() => handleCopyText(msg.content, 'Naskah Dokumen')}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-500" /> Salin Teks
                      </button>
                      <button
                        onClick={() => handleDownloadReport(msg.documentAction.title || 'Dokumen', msg.content)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-500" /> Unduh .md
                      </button>
                    </div>
                  </div>
                )}

                {/* ACTION CARD: SCANNED RECEIPT OCR TO KAS TRANSACTION */}
                {msg.transactionAction && (
                  <div className="mt-2 w-full bg-white border border-emerald-200 rounded-xl p-3 sm:p-4 shadow-sm bg-gradient-to-b from-emerald-50/40 to-white">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-emerald-100">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                          <Receipt className="w-4 h-4" />
                        </span>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">Hasil Pindai Struk Kas</h4>
                          <span className="text-[10px] text-emerald-600 font-medium">AI Multimodal OCR</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">
                        Akurasi {msg.transactionAction.confidence || 'Tinggi'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 mb-3">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Total Nominal:</span>
                        <span className="font-bold text-emerald-700 font-mono text-sm">
                          Rp {parseFloat(msg.transactionAction.amount || '0').toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Kategori:</span>
                        <span className="font-semibold text-slate-800">{msg.transactionAction.category || 'Operasional'}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[10px] text-slate-400 block">Keterangan / Merchant:</span>
                        <span className="font-medium text-slate-800">{msg.transactionAction.description || '-'}</span>
                      </div>
                    </div>

                    {savedTxSuccess[msg.id] ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Transaksi berhasil dicatat ke buku kas!
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveScannedTransaction(msg.id, msg.transactionAction)}
                          disabled={savingTxId === msg.id}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-lg shadow-xs transition disabled:opacity-50"
                        >
                          {savingTxId === msg.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Mencatat ke Buku Kas...
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Simpan ke Buku Kas Sekarang
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none px-4 py-2.5 shadow-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />
                <span className="text-xs text-slate-500 font-medium animate-pulse">KitaAtur AI sedang menyusun analisis & jawaban...</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        {filteredPrompts.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {filteredPrompts.slice(0, 5).map(p => (
              <button
                key={p.id}
                onClick={() => handleSendMessage(p.prompt)}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 hover:text-[#0087FF] hover:border-blue-200 border border-slate-200 rounded-xl shadow-xs transition shrink-0 disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-3 sm:p-4 bg-white border-t border-slate-100 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendMessage()
            }}
            className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:border-[#0087FF] focus-within:ring-2 focus-within:ring-blue-100 focus-within:bg-white transition"
          >
            {/* Hidden File Input for Receipt OCR */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleReceiptFileSelect}
              accept="image/*"
              className="hidden"
            />
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingReceipt || loading}
              title="Pindai Struk Kas"
              className="h-10 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80 font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 disabled:opacity-50 shrink-0 shadow-xs"
            >
              {uploadingReceipt ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#0087FF]" />
              ) : (
                <>
                  <Camera className="w-4 h-4 text-slate-600" />
                  <span className="hidden sm:inline font-semibold">Scan Struk</span>
                </>
              )}
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              rows={1}
              placeholder="Tanyakan sesuatu, draf laporan, atau bikin agenda..."
              className="flex-1 max-h-32 min-h-[40px] px-2 py-2 text-xs sm:text-sm text-slate-900 bg-transparent border-0 focus:outline-hidden resize-none transition"
            />

            <button
              type="submit"
              disabled={!input.trim() || loading || uploadingReceipt}
              className="h-10 px-4 bg-[#0087FF] hover:bg-blue-600 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none shrink-0 shadow-xs"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Kirim</span>
            </button>
          </form>
          <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-400">
            <span>Tekan <b>Enter</b> untuk kirim, <b>Shift+Enter</b> baris baru</span>
          </div>
        </div>

      </div>
    </div>
  )
}
