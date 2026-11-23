'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { Sparkle } from '@phosphor-icons/react'
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  FileText, 
  Calendar, 
  Copy, 
  Download, 
  RotateCcw, 
  ArrowLeft, 
  Loader2,
  Wallet,
  Target,
  ChevronRight
} from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agendaAction?: any
  reportAction?: any
  timestamp: string
}

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

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true
      listItems.push(
        <li key={index} className="text-xs sm:text-sm text-slate-700 leading-relaxed">
          {formatInline(trimmed.replace(/^[-*]\s+/, ''))}
        </li>
      )
      return
    }

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

    if (!trimmed) {
      elements.push(<div key={index} className="h-2" />)
      return
    }

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
  const parts = str.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      )
    }
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

export default function PersonalAiAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Halo! Saya **KitaAtur AI Copilot** untuk Personal Space Anda.
Saya siap membantu Anda:
- 📊 **Setup Laporan Keuangan Pribadi**: Evaluasi pemasukan, pengeluaran, dan tren tabungan bulan ini.
- 📅 **Bikin Agenda Pribadi**: Menyusun jadwal harian/mingguan dan prioritas kegiatan.
- 💡 **Konsultasi Finansial & Produktivitas**: Rekomendasi mencapai target tabungan dan mengatur waktu.

Apa yang bisa saya bantu hari ini?`,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }
  ])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt || input).trim()
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
        mode: 'personal',
        conversationHistory
      })

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: res.data.reply,
        agendaAction: res.data.agendaAction || null,
        reportAction: res.data.reportAction || null,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      }

      setMessages(prev => [...prev, botMsg])
    } catch (error: any) {
      console.error('Chat error:', error)
      const errorMsg = error?.response?.data?.error || 'Gagal memproses permintaan dengan AI Agent'
      toast.error(errorMsg)
      setMessages(prev => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Gagal:** ${errorMsg}`,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleCopyText = (content: string, label = 'Teks') => {
    navigator.clipboard.writeText(content)
    toast.success(`${label} berhasil disalin!`)
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

  const handleReset = () => {
    setMessages([
      {
        id: 'reset',
        role: 'assistant',
        content: 'Percakapan baru telah dimulai. Ada yang ingin Anda tanyakan atau buatkan?',
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      }
    ])
    toast('Percakapan direset', { icon: '🔄' })
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto flex flex-col gap-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Link href="/personal/dashboard" className="hover:text-slate-900 flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard Pribadi
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-medium">Personal AI Copilot</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0087FF] border border-blue-100 flex items-center justify-center font-bold shadow-2xs">
              <Sparkle className="w-5 h-5 text-[#0087FF]" weight="fill" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
                Personal Copilot
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Membantu keuangan pribadi, target tabungan, dan agenda kegiatan Anda.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset Obrolan
        </button>
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        <div 
          onClick={() => handleSendMessage('Buatkan ringkasan dan analisis pengeluaran pribadi saya bulan ini, serta saran penghematannya.')}
          className="group p-4 bg-white hover:bg-sky-50/50 border border-slate-200 hover:border-sky-300 rounded-2xl shadow-xs transition cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition">
              <Wallet className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Ringkasan Kas Pribadi</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Analisis pemasukan, pengeluaran terbesar, dan sisa saldo tabungan bulan ini.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-emerald-600 group-hover:translate-x-1 transition">
            Lihat Analisis <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>

        <div 
          onClick={() => handleSendMessage('Bagaimana progres target tabungan saya saat ini dan apa strategi agar target saya tercapai lebih cepat?')}
          className="group p-4 bg-white hover:bg-sky-50/50 border border-slate-200 hover:border-sky-300 rounded-2xl shadow-xs transition cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition">
              <Target className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Evaluasi Target Finansial</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Cek progres impian tabungan Anda dan dapatkan tips alokasi dana harian.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-sky-600 group-hover:translate-x-1 transition">
            Evaluasi Target <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>

        <div 
          onClick={() => handleSendMessage('Bantu saya menyusun agenda dan jadwal mingguan untuk membagi waktu antara pekerjaan/organisasi dan target pribadi.')}
          className="group p-4 bg-white hover:bg-sky-50/50 border border-slate-200 hover:border-sky-300 rounded-2xl shadow-xs transition cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center mb-2.5 group-hover:scale-105 transition">
              <Calendar className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Bikin Agenda Mingguan</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Susun timeline kegiatan dan jadwal prioritas yang teratur dan seimbang.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-indigo-600 group-hover:translate-x-1 transition">
            Rancang Agenda <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Main Chat Interface */}
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-h-[500px]">
        {/* Chat Stream */}
        <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[600px] bg-slate-50/40">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#0087FF] border border-blue-100 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                  <Sparkle className="w-4 h-4 text-[#0087FF]" weight="fill" />
                </div>
              )}

              <div className={`max-w-[85%] sm:max-w-[80%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-3 shadow-2xs ${
                    msg.role === 'user'
                      ? 'bg-[#0087FF] text-white rounded-br-none'
                      : 'bg-white text-slate-800 border border-slate-200/90 rounded-bl-none'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div>{renderFormattedMarkdown(msg.content)}</div>
                  )}
                </div>

                {msg.reportAction && (
                  <div className="mt-3 w-full bg-white border border-emerald-200 rounded-xl p-3 sm:p-4 shadow-sm bg-gradient-to-b from-emerald-50/40 to-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                        <FileText className="w-5 h-5" />
                      </span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900">{msg.reportAction.title || 'Laporan Finansial Pribadi'}</h4>
                        <span className="text-[11px] text-emerald-600 font-medium">Periode: {msg.reportAction.period || 'Bulan Berjalan'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyText(msg.content, 'Laporan Lengkap')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl shadow-xs transition"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-500" /> Salin
                      </button>
                      <button
                        onClick={() => handleDownloadReport(msg.reportAction.title || 'Laporan_Pribadi', msg.content)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition"
                      >
                        <Download className="w-3.5 h-3.5" /> Unduh .md
                      </button>
                    </div>
                  </div>
                )}

                <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                  <User className="w-4 h-4 text-slate-600" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl rounded-bl-none px-4 py-3 shadow-2xs flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-[#0087FF] animate-spin" />
                <span className="text-xs text-slate-500 font-medium">Menganalisis data...</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-slate-200">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendMessage()
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              rows={2}
              placeholder="Tanyakan analisis keuangan pribadi, susun agenda, atau strategi tabungan..."
              className="flex-1 max-h-36 px-4 py-2.5 text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#0087FF] focus:bg-white resize-none transition"
            />

            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="h-[48px] px-5 bg-[#0087FF] hover:bg-blue-600 active:scale-95 text-white font-medium text-sm rounded-xl shadow-xs flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Kirim</span>
            </button>
          </form>
          <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-400">
            <span>Tekan <strong>Enter</strong> untuk mengirim, <strong>Shift+Enter</strong> untuk baris baru</span>
            <span>Personal Copilot</span>
          </div>
        </div>
      </div>

    </div>
  )
}
