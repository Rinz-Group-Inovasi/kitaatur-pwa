'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { 
  Wallet, 
  Target, 
  House, 
  UserCircle, 
  SquaresFour,
  Buildings, 
  QrCode, 
  CaretRight, 
  GearSix, 
  Package, 
  X, 
  TreeStructure, 
  CaretDown,
  Users,
  IdentificationCard,
  Sparkle,
  EnvelopeSimple,
  ShieldWarning
} from '@phosphor-icons/react'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useDashboardStore } from '@/lib/dashboard-store'
import { dispatchNativeNotification } from '@/components/ui/NativeNotificationBanner'
import AiAgentFloatingButton from '@/components/ai/AiAgentFloatingButton'

interface DashboardShellProps {
  children: React.ReactNode
}

export default function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname()
  const store = useDashboardStore()
  const [isNavigating, setIsNavigating] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)

  const currentPath = pathname
  const isPersonal = currentPath?.startsWith('/personal') || false
  const isOrg = currentPath?.startsWith('/org') && !currentPath?.startsWith('/org/create')
  const orgMatch = currentPath?.match(/\/org\/([^\/]+)/)
  const currentOrgSlug = orgMatch ? orgMatch[1] : ''

  // Reset navigation indicator and mobile drawer when navigation to the new route completes
  useEffect(() => {
    setIsNavigating(false)
    setShowMobileMenu(false)
  }, [pathname])

  // Safety fallback in case navigation is interrupted
  useEffect(() => {
    if (isNavigating) {
      const timer = setTimeout(() => setIsNavigating(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isNavigating])

  // Show instant top progress bar indicator on internal link clicks
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return

      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor || !anchor.href) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return

      try {
        const url = new URL(anchor.href, window.location.origin)
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          setIsNavigating(true)
        }
      } catch (err) {}
    }

    const handleDocumentMouseOver = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor || !anchor.href) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#')) return

      if (currentOrgSlug) {
        if (href.endsWith('/dashboard')) {
          api.get(`/org/${currentOrgSlug}/overview`).catch(() => {})
        } else if (href.endsWith('/financial')) {
          api.get(`/org-financial/${currentOrgSlug}/summary`).catch(() => {})
        } else if (href.endsWith('/attendance')) {
          api.get(`/org-attendance/${currentOrgSlug}/agenda`).catch(() => {})
        } else if (href.endsWith('/members')) {
          api.get(`/org/${currentOrgSlug}/members`).catch(() => {})
        }
      } else if (href.startsWith('/personal')) {
        if (href.endsWith('/dashboard')) {
          api.get('/personal/summary').catch(() => {})
        } else if (href.endsWith('/targets')) {
          api.get('/personal/goals').catch(() => {})
        }
      }
    }

    document.addEventListener('click', handleDocumentClick, true)
    document.addEventListener('mouseover', handleDocumentMouseOver, { passive: true })
    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
      document.removeEventListener('mouseover', handleDocumentMouseOver)
    }
  }, [currentOrgSlug])

  const [activeAnnouncement, setActiveAnnouncement] = useState<any>(null)

  // Fetch members for current org when navigating to org pages
  useEffect(() => {
    if (currentOrgSlug) {
      // Only fetch if not already cached in the store
      if (!store.getMembersForOrg(currentOrgSlug)) {
        store.refreshMembers(currentOrgSlug)
      }
    }
  }, [currentOrgSlug])

  // Fetch active announcement (hanya muncul SEKALI per pengumuman)
  useEffect(() => {
    api.get('/admin/announcements/active')
      .then(res => {
        if (res.data && res.data.length > 0) {
          const ann = res.data[0]
          if (!ann?.id) return

          try {
            const seenKey = `kitaatur_announcement_seen_${ann.id}`
            const hasSeen = localStorage.getItem(seenKey)
            if (!hasSeen) {
              setActiveAnnouncement(ann)

              // Tampilkan in-app native notification banner SEKALI saja
              dispatchNativeNotification({
                id: `announcement-${ann.id}`,
                title: `[Pengumuman] ${ann.title}`,
                body: ann.content,
                url: '/notifications',
                duration: 8000
              })

              // Tandai pengumuman sudah muncul agar tidak berulang setiap kali reload
              localStorage.setItem(seenKey, 'true')
            }
          } catch (e) {
            setActiveAnnouncement(ann)
          }
        }
      })
      .catch(() => {})
  }, [])

  // Derive data from store instead of independent API calls
  const currentUserRole = store.getCurrentRole(currentOrgSlug)
  const currentUserInfo = store.user

  // Direct org fallback (for vanish mode admin, deep links, or fast cache)
  const [directOrgInfo, setDirectOrgInfo] = useState<any>(null)
  const [isSchoolCached, setIsSchoolCached] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && currentOrgSlug) {
      try {
        const cached = localStorage.getItem(`kitaatur_org_meta_${currentOrgSlug}`)
        if (cached) setDirectOrgInfo(JSON.parse(cached))
        setIsSchoolCached(localStorage.getItem(`kitaatur_is_school_${currentOrgSlug}`) === 'true')
      } catch (e) {}
    } else {
      setDirectOrgInfo(null)
      setIsSchoolCached(false)
    }
  }, [currentOrgSlug])

  const currentOrgInfo = (currentOrgSlug ? store.orgs.find(o => o.slug === currentOrgSlug) : null) || directOrgInfo

  const isCurrentSchool = currentOrgInfo
    ? Boolean(currentOrgInfo.is_edu || ((currentOrgInfo._count?.school_links_as_school || 0) > 0))
    : isSchoolCached

  useEffect(() => {
    if (currentOrgSlug && currentOrgInfo) {
      const isSchool = Boolean(currentOrgInfo.is_edu || ((currentOrgInfo._count?.school_links_as_school || 0) > 0))
      setIsSchoolCached(isSchool)
      try {
        if (isSchool) {
          localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'true')
        } else {
          localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'false')
          localStorage.removeItem(`kitaatur_is_school_${currentOrgSlug}`)
        }
      } catch (e) {}
    }
  }, [currentOrgSlug, currentOrgInfo])

  // Fetch org metadata if not in store to ensure consistent school branding & navigation
  useEffect(() => {
    if (!currentOrgSlug) {
      setDirectOrgInfo(null)
      return
    }

    const fromStore = store.orgs.find(o => o.slug === currentOrgSlug)
    if (fromStore) {
      setDirectOrgInfo(fromStore)
      const isSchool = Boolean(fromStore.is_edu || ((fromStore._count?.school_links_as_school || 0) > 0))
      setIsSchoolCached(isSchool)
      try {
        localStorage.setItem(`kitaatur_org_meta_${currentOrgSlug}`, JSON.stringify(fromStore))
        if (isSchool) {
          localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'true')
        } else {
          localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'false')
          localStorage.removeItem(`kitaatur_is_school_${currentOrgSlug}`)
        }
      } catch (e) {}
      return
    }

    // Fallback: fetch from overview or settings
    api.get(`/org/${currentOrgSlug}/overview`)
      .then(res => {
        if (res.data?.org) {
          const org = res.data.org
          setDirectOrgInfo(org)
          const isSchool = Boolean(org.is_edu || ((org._count?.school_links_as_school || 0) > 0))
          setIsSchoolCached(isSchool)
          try {
            localStorage.setItem(`kitaatur_org_meta_${currentOrgSlug}`, JSON.stringify(org))
            if (isSchool) {
              localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'true')
            } else {
              localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'false')
              localStorage.removeItem(`kitaatur_is_school_${currentOrgSlug}`)
            }
          } catch (e) {}
        }
      })
      .catch(() => {
        api.get(`/org/${currentOrgSlug}/settings`)
          .then(res => {
            if (res.data) {
              const isSchool = Boolean(res.data.is_edu || ((res.data.school_links_as_school || 0) > 0))
              const meta = {
                name: res.data.name || currentOrgSlug,
                slug: currentOrgSlug,
                logo_url: res.data.logo_url || null,
                is_edu: Boolean(res.data.is_edu),
                _count: { school_links_as_school: res.data.school_links_as_school || 0 }
              }
              setDirectOrgInfo(meta)
              setIsSchoolCached(isSchool)
              try {
                localStorage.setItem(`kitaatur_org_meta_${currentOrgSlug}`, JSON.stringify(meta))
                if (isSchool) {
                  localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'true')
                } else {
                  localStorage.setItem(`kitaatur_is_school_${currentOrgSlug}`, 'false')
                  localStorage.removeItem(`kitaatur_is_school_${currentOrgSlug}`)
                }
              } catch (e) {}
            }
          })
          .catch(() => {})
      })
  }, [currentOrgSlug, store.orgs])

  // Simpan last active org hanya jika user memang merupakan anggota terdaftar dari organisasi tersebut
  useEffect(() => {
    if (currentOrgSlug && store.orgs.some(o => o.slug === currentOrgSlug)) {
      localStorage.setItem('kitaatur_last_active_org', currentOrgSlug)
      document.cookie = `kitaatur_last_org=${currentOrgSlug}; path=/; max-age=31536000; SameSite=Lax`
    }
  }, [currentOrgSlug, store.orgs])

  const [lastOrgSlug, setLastOrgSlug] = useState<string | null>(null)
  useEffect(() => {
    const cached = localStorage.getItem('kitaatur_last_active_org')
    if (cached) setLastOrgSlug(cached)
  }, [currentOrgSlug])

  const [familyBranches, setFamilyBranches] = useState<any[]>([])
  const [showFamilyDropdown, setShowFamilyDropdown] = useState(false)

  // Fetch family branches for fast switching
  useEffect(() => {
    if (isOrg && currentOrgSlug) {
      api.get(`/org/${currentOrgSlug}/family/branches`)
        .then(res => {
          if (res.data?.is_family && res.data?.branches?.length > 1) {
            setFamilyBranches(res.data.branches)
          } else {
            setFamilyBranches([])
          }
        })
        .catch(() => setFamilyBranches([]))
    } else {
      setFamilyBranches([])
    }
    setShowFamilyDropdown(false)
  }, [isOrg, currentOrgSlug])

  const primaryOrgSlug = currentOrgSlug || lastOrgSlug || (store.orgs.length > 0 ? store.orgs[0].slug : null)
  const primaryOrgInfo = (primaryOrgSlug ? store.orgs.find(o => o.slug === primaryOrgSlug) : null) || (primaryOrgSlug === currentOrgSlug ? directOrgInfo : null)
  const isPrimarySchool = primaryOrgInfo
    ? Boolean(primaryOrgInfo.is_edu || ((primaryOrgInfo._count?.school_links_as_school || 0) > 0))
    : (primaryOrgSlug === currentOrgSlug ? isSchoolCached : false)

  // Menentukan nav item berdasarkan konteks
  const personalNavItems = [
    { name: 'Ringkasan', href: '/personal/dashboard', icon: House },
    { name: 'AI Copilot', href: '/personal/assistant', icon: Sparkle },
    primaryOrgSlug 
      ? { 
          name: isPrimarySchool ? 'Dasbor Eksekutif' : 'Organisasi', 
          href: isPrimarySchool ? `/org/${primaryOrgSlug}/executive` : `/org/${primaryOrgSlug}/dashboard`, 
          icon: Buildings 
        }
      : { name: 'Target', href: '/personal/targets', icon: Target },
    { name: 'Dompet', href: '/personal/wallet', icon: Wallet },
    { name: 'Profil', href: '/settings', icon: UserCircle },
  ]

  const schoolNavItems = currentOrgSlug ? [
    { name: 'Dashboard', href: `/org/${currentOrgSlug}/executive`, icon: Buildings },
    { name: 'AI Copilot', href: `/org/${currentOrgSlug}/assistant`, icon: Sparkle },
    { name: 'Presensi', href: `/org/${currentOrgSlug}/attendance`, icon: QrCode },
    { name: 'Siswa & NFC', href: `/org/${currentOrgSlug}/attendance/guests`, icon: IdentificationCard },
    { name: 'Pelanggaran & BK', href: `/org/${currentOrgSlug}/violations`, icon: ShieldWarning },
    { name: 'Arsip Surat', href: `/org/${currentOrgSlug}/letters`, icon: EnvelopeSimple },
    { name: 'Inventaris', href: `/org/${currentOrgSlug}/inventory`, icon: Package },
    { name: 'Guru & Staf', href: `/org/${currentOrgSlug}/members`, icon: Users },
    { name: 'Pengaturan', href: `/org/${currentOrgSlug}/settings`, icon: GearSix },
  ] : []

  const regularOrgNavItems = currentOrgSlug ? [
    { name: 'Org Dashboard', href: `/org/${currentOrgSlug}/dashboard`, icon: Buildings },
    { name: 'AI Copilot', href: `/org/${currentOrgSlug}/assistant`, icon: Sparkle },
    { name: 'Presensi', href: `/org/${currentOrgSlug}/attendance`, icon: QrCode },
    { name: 'Keuangan', href: `/org/${currentOrgSlug}/financial`, icon: Wallet },
    { name: 'Arsip Surat', href: `/org/${currentOrgSlug}/letters`, icon: EnvelopeSimple },
    { name: 'Inventaris', href: `/org/${currentOrgSlug}/inventory`, icon: Package },
    { name: 'Pengaturan', href: `/org/${currentOrgSlug}/settings`, icon: GearSix },
  ] : []

  const orgNavItems = isCurrentSchool ? schoolNavItems : regularOrgNavItems

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'generalrino@gmail.com').split(',').map((e) => e.trim().toLowerCase())
  if (currentUserInfo?.email && adminEmails.includes(currentUserInfo.email.toLowerCase())) {
    personalNavItems.push({ 
      name: 'Admin Panel', 
      href: '/admin', 
      icon: Package 
    })
  }


  // Render Sidebar items conditionally based on active mode
  let activeSidebarItems = []
  if (isOrg) {
    activeSidebarItems = [
      { 
        section: isCurrentSchool ? 'RUANG EKSEKUTIF SEKOLAH' : 'ORGANIZATION SPACE', 
        items: isCurrentSchool 
          ? schoolNavItems
          : regularOrgNavItems 
      },
      { section: 'PERSONAL SPACE', items: [{ name: 'Keuangan Pribadi', href: '/personal/dashboard', icon: House }] }
    ]
  } else {
    // Default to Personal Space
    activeSidebarItems = [
      { section: 'PERSONAL SPACE', items: personalNavItems },
      ...(primaryOrgSlug ? [{ 
        section: isPrimarySchool ? 'RUANG EKSEKUTIF SEKOLAH' : 'ORGANIZATION SPACE', 
        items: [
          { 
            name: isPrimarySchool ? 'Dasbor Eksekutif' : 'Dasbor Organisasi', 
            href: isPrimarySchool ? `/org/${primaryOrgSlug}/executive` : `/org/${primaryOrgSlug}/dashboard`, 
            icon: Buildings 
          },
          ...(isPrimarySchool ? [
            { name: 'Pengaturan Sekolah', href: `/org/${primaryOrgSlug}/settings`, icon: GearSix }
          ] : [
            { name: 'Presensi Organisasi', href: `/org/${primaryOrgSlug}/attendance`, icon: QrCode }
          ])
        ] 
      }] : [])
    ]
  }

  // Mobile dock items: 4 main shortcuts (with Settings prioritized on the right) + Center Menu & AI sheet
  const activeBottomNavItems = isOrg ? orgNavItems : personalNavItems
  const mobileLeftItems = isOrg && currentOrgSlug
    ? [
        { name: 'Dashboard', href: isCurrentSchool ? `/org/${currentOrgSlug}/executive` : `/org/${currentOrgSlug}/dashboard`, icon: Buildings },
        { name: 'Presensi', href: `/org/${currentOrgSlug}/attendance`, icon: QrCode },
      ]
    : [
        { name: 'Ringkasan', href: '/personal/dashboard', icon: House },
        { name: 'Dompet', href: '/personal/wallet', icon: Wallet },
      ]

  const mobileRightItems = isOrg && currentOrgSlug
    ? [
        isCurrentSchool
          ? { name: 'Siswa', href: `/org/${currentOrgSlug}/attendance/guests`, icon: IdentificationCard }
          : { name: 'Keuangan', href: `/org/${currentOrgSlug}/financial`, icon: Wallet },
        { name: 'Pengaturan', href: `/org/${currentOrgSlug}/settings`, icon: GearSix },
      ]
    : [
        primaryOrgSlug
          ? { name: isPrimarySchool ? 'Sekolah' : 'Organisasi', href: isPrimarySchool ? `/org/${primaryOrgSlug}/executive` : `/org/${primaryOrgSlug}/dashboard`, icon: Buildings }
          : { name: 'Target', href: '/personal/targets', icon: Target },
        { name: 'Pengaturan', href: '/settings', icon: GearSix },
      ]

  const aiAssistantHref = isOrg && currentOrgSlug ? `/org/${currentOrgSlug}/assistant` : '/personal/assistant'

  const isKiosk = Boolean(pathname?.includes('/attendance/kiosk'))
  const noShellPaths = ['/org/create']
  if (pathname && (noShellPaths.includes(pathname) || isKiosk)) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      
      <aside className={`hidden md:flex flex-col w-64 bg-white border-r border-slate-200 shadow-sm transition-all duration-300 z-30`}>
        <div className="p-6 flex items-center justify-center border-b border-slate-100">
          {isOrg && (currentOrgInfo || currentOrgSlug) ? (
            <Link href={isCurrentSchool ? `/org/${currentOrgSlug}/executive` : `/org/${currentOrgSlug}/dashboard`} className="flex items-center gap-2.5">
              {currentOrgInfo?.logo_url ? (
                <img 
                  src={currentOrgInfo.logo_url} 
                  alt={currentOrgInfo.name || currentOrgSlug} 
                  className="w-8 h-8 sm:w-9 sm:h-9 object-contain shrink-0" 
                />
              ) : (
                <div suppressHydrationWarning className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg shrink-0">
                  {(currentOrgInfo?.name || currentOrgSlug).charAt(0).toUpperCase()}
                </div>
              )}
              <span suppressHydrationWarning className="text-lg font-extrabold tracking-tight text-slate-900 truncate max-w-[150px]">
                {currentOrgInfo?.name || (isCurrentSchool ? 'Sekolah' : currentOrgSlug)}
              </span>
            </Link>
          ) : (
            <Link href="/personal/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white shadow-lg flex items-center justify-center p-1">
                <img src="/logo.png" alt="KitaAtur" className="w-full h-full object-contain" />
              </div>
              <span className="text-xl font-extrabold tracking-tight text-slate-900">KitaAtur</span>
            </Link>
          )}
        </div>

        {/* Family Fast Switcher */}
        {familyBranches.length > 1 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 relative">
            <button
              onClick={() => setShowFamilyDropdown(!showFamilyDropdown)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-xs font-bold text-slate-700 transition-colors shadow-2xs"
            >
              <span className="flex items-center gap-2 truncate">
                <TreeStructure size={15} weight="duotone" className="text-blue-600 shrink-0" />
                <span className="truncate">Ganti Cabang ({familyBranches.length})</span>
              </span>
              <CaretDown size={14} weight="bold" className={`text-slate-400 shrink-0 transition-transform ${showFamilyDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showFamilyDropdown && (
              <div className="absolute left-4 right-4 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 py-1.5 max-h-64 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  Keluarga Organisasi
                </div>
                {familyBranches.map((branch) => (
                  <Link
                    key={branch.id}
                    href={`/org/${branch.slug}/dashboard`}
                    onClick={() => setShowFamilyDropdown(false)}
                    className={`flex items-center justify-between px-3 py-2.5 text-xs font-medium hover:bg-slate-50 transition-colors ${
                      branch.is_current ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${branch.is_parent ? 'bg-blue-600' : 'bg-indigo-400'}`} />
                      <span className="truncate">{branch.name}</span>
                    </span>
                    {branch.is_parent && (
                      <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">Induk</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          {activeSidebarItems.map((group, idx) => (
            <div key={idx}>
              <h3 className="px-3 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                {group.section}
              </h3>
              <nav className="space-y-1">
                {group.items.map((item) => {
                  const isActive = currentPath === item.href || 
                    (item.href.includes('/executive') && currentPath?.includes('/executive'))
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      prefetch={true}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                        isActive
                          ? 'bg-[#E0F4FE]/80 text-[#007AE6] font-bold shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <item.icon size={22} weight={isActive ? 'duotone' : 'regular'} className={`transition-all ${isActive ? 'text-[#0087FF]' : 'text-slate-400 group-hover:text-slate-700'}`} />
                      {item.name}
                      {isActive && <CaretRight size={15} weight="bold" className="ml-auto text-[#0087FF] opacity-70" />}
                    </Link>
                  )
                })}
              </nav>
            </div>
          ))}
        </div>

      </aside>

      {/* Top instant progress bar indicator */}
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0087FF] via-[#01C4FB] to-[#0087FF] animate-pulse z-50 pointer-events-none" />
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 min-w-0 flex flex-col h-full relative overflow-y-auto overflow-x-hidden w-full md:w-[calc(100%-16rem)]">
        {/* Announcement Banner */}
        {activeAnnouncement && (
          <div className={`px-4 py-3 relative z-50 shadow-sm flex items-start md:items-center justify-between gap-4 ${
            activeAnnouncement.type === 'error' ? 'bg-rose-600 text-white' : 
            activeAnnouncement.type === 'warning' ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
          }`}>
            <div className="flex-1 text-sm">
              <strong className="mr-2">{activeAnnouncement.title}:</strong>
              {activeAnnouncement.content}
            </div>
            <button 
              onClick={() => {
                if (activeAnnouncement?.id) {
                  try {
                    localStorage.setItem(`kitaatur_announcement_seen_${activeAnnouncement.id}`, 'true')
                  } catch (e) {}
                }
                setActiveAnnouncement(null)
              }} 
              className="p-1 hover:bg-white/20 rounded-full transition-colors shrink-0"
              title="Tutup pengumuman"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="w-full min-w-0 flex-1 flex flex-col">
          {children}
        </div>
        {/* Spacer untuk memastikan bottom nav tidak menutupi konten paling bawah di mobile */}
        <div className="h-32 md:h-8 shrink-0 w-full" aria-hidden="true" />
      </main>

      {/* Mobile Center Menu & AI Sheet */}
      {showMobileMenu && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-slate-900/35 backdrop-blur-[2px] animate-in fade-in duration-150"
            onClick={() => setShowMobileMenu(false)}
          />
          <div className="relative z-50 mx-3 mb-24 bg-white rounded-3xl border border-slate-200 shadow-2xl p-4 space-y-4 max-h-[70vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                {isOrg ? (isCurrentSchool ? 'Menu Sekolah' : 'Menu Organisasi') : 'Menu Personal'}
              </span>
              <button
                onClick={() => setShowMobileMenu(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                aria-label="Tutup menu"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Featured AI Copilot */}
            <Link
              href={aiAssistantHref}
              prefetch={true}
              className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all active:scale-[0.99] ${
                currentPath?.includes('/assistant')
                  ? 'bg-[#E0F4FE] border-[#0087FF]/40 text-[#007AE6]'
                  : 'bg-gradient-to-r from-blue-50 to-sky-50 border-blue-200/80 text-slate-800 hover:border-blue-300'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-[#0087FF] text-white flex items-center justify-center shrink-0 shadow-sm">
                <Sparkle size={22} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-slate-900">KitaAtur AI Copilot</div>
                <div className="text-[11px] text-slate-500 truncate">Asisten cerdas laporan, agenda & data</div>
              </div>
              <CaretRight size={16} weight="bold" className="text-[#0087FF] shrink-0" />
            </Link>

            {/* All Functional Menu Grid */}
            <div className="grid grid-cols-3 gap-2">
              {activeBottomNavItems
                .filter((item) => !item.href.includes('/assistant'))
                .map((item) => {
                  const isActive = currentPath === item.href || (item.href.includes('/executive') && currentPath?.includes('/executive'))
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      prefetch={true}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-center transition-all active:scale-95 ${
                        isActive
                          ? 'bg-[#E0F4FE]/80 border-[#0087FF]/30 text-[#007AE6]'
                          : 'bg-slate-50/70 border-slate-100 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <item.icon size={22} weight={isActive ? 'duotone' : 'regular'} className={isActive ? 'text-[#0087FF]' : 'text-slate-500'} />
                      <span className="text-[11px] font-bold leading-tight line-clamp-2">{item.name}</span>
                    </Link>
                  )
                })}
            </div>

            {/* Space Switcher & Family Branches */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              {isOrg ? (
                <Link
                  href="/personal/dashboard"
                  prefetch={true}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
                >
                  <span className="flex items-center gap-2">
                    <House size={18} weight="duotone" className="text-slate-500" />
                    Beralih ke Keuangan Pribadi
                  </span>
                  <CaretRight size={14} weight="bold" className="text-slate-400" />
                </Link>
              ) : primaryOrgSlug ? (
                <Link
                  href={isPrimarySchool ? `/org/${primaryOrgSlug}/executive` : `/org/${primaryOrgSlug}/dashboard`}
                  prefetch={true}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
                >
                  <span className="flex items-center gap-2">
                    <Buildings size={18} weight="duotone" className="text-[#0087FF]" />
                    Beralih ke {isPrimarySchool ? 'Ruang Sekolah' : 'Organisasi'}
                  </span>
                  <CaretRight size={14} weight="bold" className="text-slate-400" />
                </Link>
              ) : null}

              {familyBranches.length > 1 && (
                <div className="space-y-1 pt-1">
                  <div className="px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cabang Organisasi</div>
                  <div className="flex flex-wrap gap-1.5">
                    {familyBranches.map((branch) => (
                      <Link
                        key={branch.id}
                        href={`/org/${branch.slug}/dashboard`}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                          branch.is_current
                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        {branch.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. MOBILE BOTTOM NAVIGATION (Clean 5-Slot Dock: Setting Diutamakan, Menu & AI di Tengah) */}
      <nav className="md:hidden fixed bottom-3 left-3 right-3 bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-xl shadow-slate-300/40 rounded-2xl z-50">
        <div className="grid grid-cols-5 items-center px-2 py-2">
          {mobileLeftItems.map((item) => {
            const isActive = currentPath === item.href || (item.href.includes('/executive') && currentPath?.includes('/executive'))
            return (
              <Link
                key={item.name}
                href={item.href}
                prefetch={true}
                title={item.name}
                aria-label={item.name}
                className={`flex items-center justify-center py-2.5 rounded-xl transition-all ${
                  isActive ? 'bg-[#E0F4FE]/80 text-[#0087FF]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <item.icon size={23} weight={isActive ? 'duotone' : 'regular'} />
              </Link>
            )
          })}

          {/* Center Button: Menu & AI (Pengganti tombol +) */}
          <button
            type="button"
            onClick={() => setShowMobileMenu((prev) => !prev)}
            title="AI & Menu"
            aria-label="Menu & AI Copilot"
            className={`flex items-center justify-center py-2.5 rounded-xl transition-all ${
              showMobileMenu || currentPath?.includes('/assistant')
                ? 'bg-[#0087FF] text-white shadow-md shadow-blue-500/25'
                : 'bg-blue-50 text-[#0087FF] hover:bg-blue-100'
            }`}
          >
            <div className="flex items-center gap-1">
              <Sparkle size={20} weight="fill" />
              <SquaresFour size={20} weight="duotone" />
            </div>
          </button>

          {mobileRightItems.map((item) => {
            const isActive = currentPath === item.href || (item.href.includes('/executive') && currentPath?.includes('/executive'))
            return (
              <Link
                key={item.name}
                href={item.href}
                prefetch={true}
                title={item.name}
                aria-label={item.name}
                className={`flex items-center justify-center py-2.5 rounded-xl transition-all ${
                  isActive ? 'bg-[#E0F4FE]/80 text-[#0087FF]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <item.icon size={23} weight={isActive ? 'duotone' : 'regular'} />
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Floating AI Copilot Assistant Button */}
      <AiAgentFloatingButton />

    </div>
  )
}
