'use client'

import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkle } from '@phosphor-icons/react'
import AiAgentModal from './AiAgentModal'

export default function AiAgentFloatingButton() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  // Do not render in kiosk, assistant page, or public landing pages
  if (!pathname || pathname === '/' || pathname.includes('/attendance/kiosk') || pathname.includes('/assistant') || pathname.startsWith('/auth') || pathname.startsWith('/admin')) {
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
          className="w-12 h-12 sm:w-14 sm:h-14 bg-[#0087FF] hover:bg-blue-600 active:scale-95 text-white rounded-full shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/40 flex items-center justify-center transition-all duration-200 cursor-pointer border border-blue-400/30"
          aria-label="Buka KitaAtur Copilot"
          title="KitaAtur Copilot"
        >
          <Sparkle className="w-6 h-6 sm:w-7 sm:h-7 text-white" weight="fill" />
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

