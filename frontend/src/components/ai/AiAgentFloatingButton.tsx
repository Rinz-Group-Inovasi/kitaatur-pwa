'use client'

import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, Bot } from 'lucide-react'
import AiAgentModal from './AiAgentModal'

export default function AiAgentFloatingButton() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  // Do not render in kiosk or public landing pages
  if (!pathname || pathname === '/' || pathname.includes('/attendance/kiosk') || pathname.startsWith('/auth') || pathname.startsWith('/admin')) {
    return null
  }

  const isPersonal = pathname.startsWith('/personal')
  const orgMatch = pathname.match(/\/org\/([^\/]+)/)
  const currentOrgSlug = orgMatch ? orgMatch[1] : undefined
  const mode = isPersonal ? 'personal' : 'org'

  return (
    <>
      <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40">
        <button
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 hover:from-sky-900 hover:to-blue-900 text-white rounded-full shadow-lg shadow-sky-950/30 border border-sky-400/40 hover:border-sky-300 transition-all duration-300 active:scale-95 cursor-pointer"
          aria-label="Buka KitaAtur AI Copilot"
        >
          {/* Animated Glow Halo */}
          <span className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-sky-500 to-cyan-400 opacity-40 blur-xs group-hover:opacity-75 transition duration-300 -z-10" />

          <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0 border border-sky-400/50">
            <Sparkles className="w-3.5 h-3.5 text-sky-300 animate-pulse" />
          </div>

          <div className="flex flex-col text-left">
            <span className="text-xs font-bold tracking-wide leading-tight text-white flex items-center gap-1">
              AI Copilot
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[10px] text-sky-200 hidden sm:inline leading-none">
              Setup Laporan & Agenda
            </span>
          </div>
        </button>
      </div>

      <AiAgentModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        orgSlug={currentOrgSlug}
        mode={mode}
      />
    </>
  )
}
