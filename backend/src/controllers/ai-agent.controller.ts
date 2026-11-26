import { Request, Response } from 'express'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { prisma } from '../config/db'
import { sendPushNotification } from './notification.controller'
import { runAiDigestForOrg } from '../jobs/ai-digest.job'

const apiKey = process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(apiKey)

const MODEL_CANDIDATES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

async function generateWithFallback(prompt: string, history: Array<{ role: string; parts: string }> = []): Promise<string> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di server.')
  }

  let lastError: any = null
  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName })
      if (history.length > 0) {
        const chat = model.startChat({
          history: history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.parts }]
          }))
        })
        const result = await chat.sendMessage(prompt)
        return result.response.text()
      } else {
        const result = await model.generateContent(prompt)
        return result.response.text()
      }
    } catch (err: any) {
      console.warn(`[AI Agent] Model ${modelName} failed, trying next candidate. Error:`, err?.message || err)
      lastError = err
    }
  }

  throw lastError || new Error('Semua model Gemini gagal merespons.')
}

export async function chatWithAgent(req: any, res: Response) {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  const { message, orgSlug, mode = 'org', conversationHistory = [] } = req.body

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Pesan pengguna wajib diisi' })
  }

  try {
    let contextDataString = ''
    let orgData: any = null
    let userRole = 'member'

    // 1. Gather Context
    if (orgSlug && mode !== 'personal') {
      const org = await prisma.organizations.findFirst({
        where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] },
        include: {
          organization_members: {
            include: { profile: { select: { id: true, full_name: true, email: true } } }
          }
        }
      })

      if (!org) {
        return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
      }

      const member = org.organization_members.find((m: any) => m.profile_id === userId)
      if (!member) {
        return res.status(403).json({ error: 'Anda bukan anggota dari organisasi ini' })
      }
      userRole = member.role
      orgData = org

      // Fetch financial summary
      const now = new Date()
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const financials = await prisma.financial_records.findMany({
        where: {
          organization_id: org.id,
          transaction_date: { gte: last30Days }
        },
        orderBy: { transaction_date: 'desc' },
        take: 30
      })

      let monthlyIncome = 0
      let monthlyExpense = 0
      const categoryMap: { [cat: string]: number } = {}

      financials.forEach((f: any) => {
        const amt = parseFloat(f.amount.toString())
        if (new Date(f.transaction_date) >= firstDayOfMonth) {
          if (f.type === 'income') monthlyIncome += amt
          else {
            monthlyExpense += amt
            categoryMap[f.category] = (categoryMap[f.category] || 0) + amt
          }
        }
      })

      const topCategories = Object.entries(categoryMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat, val]) => `${cat}: Rp ${val.toLocaleString('id-ID')}`)
        .join(', ')

      // Fetch attendance & sessions
      const sessions = await prisma.attendance_sessions.findMany({
        where: { organization_id: org.id },
        orderBy: { start_time: 'desc' },
        take: 5,
        include: {
          _count: { select: { attendance: true } }
        }
      })

      // Fetch recent meeting minutes
      const minutes = await prisma.meeting_minutes.findMany({
        where: { organization_id: org.id },
        orderBy: { created_at: 'desc' },
        take: 3
      })

      // Fetch active goals
      const goals = await prisma.goals.findMany({
        where: { organization_id: org.id, status: 'active' },
        take: 3
      })

      // Fetch letters summary
      const letters = await prisma.org_letters.findMany({
        where: { organization_id: org.id },
        orderBy: { letter_date: 'desc' },
        take: 5
      }).catch(() => [])
      const letterCount = await prisma.org_letters.count({ where: { organization_id: org.id } }).catch(() => 0)

      // Fetch inventory summary
      const inventoryItems = await prisma.org_inventory.findMany({
        where: { organization_id: org.id },
        include: { loans: { where: { status: 'borrowed' } } }
      }).catch(() => [])
      const totalInventoryItems = inventoryItems.reduce((acc: number, item: any) => acc + item.quantity, 0)
      const totalAvailableItems = inventoryItems.reduce((acc: number, item: any) => acc + item.available_quantity, 0)
      const activeLoansCount = inventoryItems.reduce((acc: number, item: any) => acc + item.loans.length, 0)

      contextDataString = `
[DATA ORGANISASI AKTIF]
- Nama: ${org.name} (${org.slug})
- Peran Pengguna yang Chat: ${userRole.toUpperCase()}
- Total Anggota Terdaftar: ${org.organization_members.length} orang
- Saldo Kas Bulan Berjalan: Rp ${(monthlyIncome - monthlyExpense).toLocaleString('id-ID')}
  * Total Pemasukan Bulan Ini: Rp ${monthlyIncome.toLocaleString('id-ID')}
  * Total Pengeluaran Bulan Ini: Rp ${monthlyExpense.toLocaleString('id-ID')}
  * Pengeluaran Tertinggi Berdasarkan Kategori: ${topCategories || 'Belum ada pengeluaran'}
  * 5 Transaksi Terakhir: ${financials.slice(0, 5).map((f: any) => `[${f.type.toUpperCase()}] Rp ${parseFloat(f.amount).toLocaleString('id-ID')} (${f.category} - ${f.description || '-'}) pada ${new Date(f.transaction_date).toLocaleDateString('id-ID')}`).join('; ') || 'Belum ada'}

- Agenda & Sesi Presensi Terakhir:
${sessions.map((s: any) => `  * "${s.title}" (${new Date(s.start_time).toLocaleString('id-ID')}) - Tipe: ${s.session_type}, Hadir: ${s._count.attendance} orang`).join('\n') || '  * Belum ada sesi'}

- Notulensi Terakhir:
${minutes.map((m: any) => `  * "${m.title}": ${m.ai_summary ? m.ai_summary.slice(0, 150) + '...' : m.content.slice(0, 150) + '...'}`).join('\n') || '  * Belum ada notulensi'}

- Target/Goals Aktif:
${goals.map((g: any) => `  * "${g.title}": Target Rp ${parseFloat(g.target_amount?.toString() || '0').toLocaleString('id-ID')}, Terkumpul Rp ${parseFloat(g.current_amount?.toString() || '0').toLocaleString('id-ID')}`).join('\n') || '  * Belum ada goals'}

- Arsip Surat Organisasi (Total ${letterCount} surat):
${letters.map((l: any) => `  * [${l.letter_type === 'incoming' ? 'MASUK' : 'KELUAR'}] No: ${l.letter_number} | Perihal: ${l.title} | Pengirim: ${l.sender || '-'} | Penerima: ${l.recipient || '-'} (${new Date(l.letter_date).toLocaleDateString('id-ID')})`).join('\n') || '  * Belum ada arsip surat'}

- Inventaris & Aset Organisasi:
  * Total Unit Barang: ${totalInventoryItems} unit (${totalAvailableItems} siap pakai, ${totalInventoryItems - totalAvailableItems} sedang dipinjam)
  * Peminjaman Aktif: ${activeLoansCount} peminjaman
  * Daftar Barang Utama: ${inventoryItems.slice(0, 5).map((i: any) => `${i.name} (Tersedia ${i.available_quantity}/${i.quantity} ${i.unit})`).join(', ') || 'Belum ada aset'}
`
    } else {
      // Personal mode
      const profile = await prisma.profiles.findUnique({
        where: { id: userId },
        select: { full_name: true, email: true }
      })

      const now = new Date()
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const personalFinancials = await prisma.financial_records.findMany({
        where: { profile_id: userId, organization_id: null },
        orderBy: { transaction_date: 'desc' },
        take: 20
      })

      let pIncome = 0
      let pExpense = 0
      personalFinancials.forEach((f: any) => {
        const amt = parseFloat(f.amount.toString())
        if (new Date(f.transaction_date) >= firstDayOfMonth) {
          if (f.type === 'income') pIncome += amt
          else pExpense += amt
        }
      })

      const pGoals = await prisma.goals.findMany({
        where: { profile_id: userId, organization_id: null, status: 'active' },
        take: 5
      })

      contextDataString = `
[DATA PERSONAL AKTIF PENGGUNA]
- Nama Pengguna: ${profile?.full_name || 'User'} (${profile?.email || '-'})
- Arus Kas Pribadi Bulan Ini:
  * Pemasukan: Rp ${pIncome.toLocaleString('id-ID')}
  * Pengeluaran: Rp ${pExpense.toLocaleString('id-ID')}
  * Saldo Bersih: Rp ${(pIncome - pExpense).toLocaleString('id-ID')}
- Target Tabungan Pribadi:
${pGoals.map((g: any) => `  * "${g.title}": Target Rp ${parseFloat(g.target_amount?.toString() || '0').toLocaleString('id-ID')}, Terkumpul Rp ${parseFloat(g.current_amount?.toString() || '0').toLocaleString('id-ID')}`).join('\n') || '  * Belum ada'}
`
    }

    const systemPrompt = `Anda adalah "KitaAtur AI Agent" — asisten eksekutif cerdas dan copilot resmi di platform KitaAtur SaaS.
Anda bertugas membantu pengguna dalam 3 hal utama:
1. SETUP LAPORAN (Laporan Keuangan, Laporan Presensi, Laporan Kegiatan/Notulensi, atau Evaluasi Bulanan Komprehensif)
2. BIKIN AGENDA (Rundown Acara, Timeline Kegiatan, Rapat Kerja, Sesi Presensi Terjadwal)
3. NGE-ASISTENIN USER (Menjawab pertanyaan seputar data real-time, memberi saran strategis, draf pesan broadcast WhatsApp/pengumuman, dan solusi problem solving operasional).

PANDUAN EKSEKUSI TUGAS:
- Gunakan data real-time berikut sebagai dasar fakta. JANGAN merekayasa angka jika datanya ada di sini:
${contextDataString}

A. BILA PENGGUNA MEMINTA SETUP LAPORAN:
- Susun laporan resmi berstandar profesional dalam format Markdown rapi:
  1. Header Laporan (Judul, Periode, Nama Organisasi/User)
  2. Ringkasan Eksekutif (Highlight utama dalam 2-3 kalimat)
  3. Metrik & Angka Utama (Tabel atau bullet point pemasukan, pengeluaran, saldo, persentase kehadiran)
  4. Analisis & Temuan Kunci (Kategori pengeluaran terbesar, catatan defisit/surplus, kedisiplinan anggota)
  5. Rekomendasi Solusi & Rencana Tindak Lanjut (Action items konkret).
- Di akhir respon laporan, lampirkan blok tindakan format persis berikut:
<<<ACTION_REPORT:{"title": "Nama Laporan", "type": "financial|attendance|comprehensive", "period": "Bulan Ini"}>>>

B. BILA PENGGUNA MEMINTA BIKIN AGENDA / RUNDOWN:
- Rancang agenda kegiatan yang jelas dengan estimasi waktu, nama sesi/mata acara, PIC, dan rincian aktivitas.
- Jika pengguna ingin membuat agenda rapat atau sesi kegiatan yang bisa didaftarkan ke sistem KitaAtur, sediakan rancangan yang siap diterapkan dan sertakan blok tindakan persis berikut di akhir jawaban:
<<<ACTION_AGENDA:{"title": "Judul Agenda/Sesi", "session_type": "in_only", "suggested_date": "${new Date().toISOString().split('T')[0]}", "start_time": "09:00", "end_time": "11:30", "late_time": "09:15", "description": "Deskripsi singkat acara", "items": [{"time": "09:00 - 09:15", "activity": "Pembukaan & Doa", "pic": "Ketua"}, {"time": "09:15 - 10:30", "activity": "Pembahasan Inti", "pic": "Sekretaris"}]}>>>
(Catatan: session_type bisa "in_only" atau "in_out").

C. BILA PENGGUNA MEMINTA ASISTENSI / TANYA JAWAB / DRAF BROADCAST:
- Jawab secara ringkas, to the point, solutif, ramah, dan aplikatif.
- Jika diminta membuat draf pengumuman (WhatsApp / notifikasi / siaran), buatkan teks yang jelas.
  Jika pengumuman tersebut ditujukan untuk dikirimkan sebagai notifikasi push/siaran resmi ke seluruh anggota, sertakan tag tindakan ini di akhir:
<<<ACTION_BROADCAST:{"title": "Judul Notifikasi Singkat", "body": "Pesan singkat notifikasi (maksimal 150 karakter)", "full_announcement": "Teks lengkap pengumuman"}>>>

D. BILA PENGGUNA MEMINTA DOKUMEN RESMI (Surat Izin/Dispensasi, Proposal Kegiatan, LPJ):
- Susun naskah resmi standar organisasi Indonesia lengkap dengan Kop Surat (Nama Organisasi), Nomor Surat, Lampiran, Perihal, Salam Pembuka, Isi Surat, dan Blok Tanda Tangan (Ketua & Sekretaris/Bendahara).
- Sertakan tag tindakan ini di akhir:
<<<ACTION_DOCUMENT:{"title": "Nama Dokumen Resmi", "type": "surat_izin|lpj|proposal"}>>>

Format respons Anda harus natural, rapi dengan Markdown (bold, list, tabel jika relevan). Jangan gunakan format JSON kecuali di dalam tag <<<ACTION_...>>>.`

    // Prepare history
    const formattedHistory = (conversationHistory || []).slice(-8).map((msg: any) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      parts: msg.content || ''
    }))

    const fullPrompt = `${systemPrompt}\n\n[PESAN PENGGUNA TERBARU]:\n${message}`
    const rawReply = await generateWithFallback(fullPrompt, formattedHistory)

    // Extract structured action if present
    let cleanReply = rawReply
    let agendaAction: any = null
    let reportAction: any = null
    let broadcastAction: any = null
    let documentAction: any = null

    const agendaMatch = cleanReply.match(/<<<ACTION_AGENDA:([\s\S]*?)>>>/)
    if (agendaMatch && agendaMatch[1]) {
      try {
        agendaAction = JSON.parse(agendaMatch[1].trim())
        cleanReply = cleanReply.replace(agendaMatch[0], '').trim()
      } catch (e) {
        console.warn('[AI Agent] Failed to parse agenda action JSON:', e)
      }
    }

    const reportMatch = cleanReply.match(/<<<ACTION_REPORT:([\s\S]*?)>>>/)
    if (reportMatch && reportMatch[1]) {
      try {
        reportAction = JSON.parse(reportMatch[1].trim())
        cleanReply = cleanReply.replace(reportMatch[0], '').trim()
      } catch (e) {
        console.warn('[AI Agent] Failed to parse report action JSON:', e)
      }
    }

    const broadcastMatch = cleanReply.match(/<<<ACTION_BROADCAST:([\s\S]*?)>>>/)
    if (broadcastMatch && broadcastMatch[1]) {
      try {
        broadcastAction = JSON.parse(broadcastMatch[1].trim())
        cleanReply = cleanReply.replace(broadcastMatch[0], '').trim()
      } catch (e) {
        console.warn('[AI Agent] Failed to parse broadcast action JSON:', e)
      }
    }

    const documentMatch = cleanReply.match(/<<<ACTION_DOCUMENT:([\s\S]*?)>>>/)
    if (documentMatch && documentMatch[1]) {
      try {
        documentAction = JSON.parse(documentMatch[1].trim())
        cleanReply = cleanReply.replace(documentMatch[0], '').trim()
      } catch (e) {
        console.warn('[AI Agent] Failed to parse document action JSON:', e)
      }
    }

    return res.json({
      reply: cleanReply,
      agendaAction,
      reportAction,
      broadcastAction,
      documentAction,
      context: {
        mode,
        orgName: orgData?.name || null,
        userRole,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('[AI Agent Error]:', error)
    return res.status(500).json({
      error: error.message || 'Terjadi kesalahan saat memproses permintaan AI Agent'
    })
  }
}

export async function applyAgentAgenda(req: any, res: Response) {
  const userId = req.user?.id
  const { orgSlug, title, session_type = 'in_only', date, start_time, end_time, late_time, latitude = 0, longitude = 0, radius_meters = 50 } = req.body

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  if (!orgSlug || !title || !start_time || !end_time) {
    return res.status(400).json({ error: 'Data agenda tidak lengkap (orgSlug, title, start_time, end_time wajib)' })
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] },
      include: { organization_members: true }
    })

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
    }

    const member = org.organization_members.find((m: any) => m.profile_id === userId)
    if (!member || (member.role !== 'head' && member.role !== 'vice_head' && member.role !== 'sekretaris')) {
      return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang dapat membuat sesi presensi/agenda' })
    }

    // Build ISO start and end timestamps
    const baseDate = date || new Date().toISOString().split('T')[0]
    const startIso = new Date(`${baseDate}T${start_time}:00`).toISOString()
    const endIso = new Date(`${baseDate}T${end_time}:00`).toISOString()
    const lateIso = late_time ? new Date(`${baseDate}T${late_time}:00`).toISOString() : null

    const pin_code = Math.floor(1000 + Math.random() * 9000).toString()
    const checkout_pin_code = session_type === 'in_out' ? Math.floor(1000 + Math.random() * 9000).toString() : null

    const newSession = await prisma.attendance_sessions.create({
      data: {
        organization_id: org.id,
        created_by: userId,
        title: title || 'Sesi Agenda',
        session_type: session_type || 'in_only',
        start_time: new Date(startIso),
        end_time: new Date(endIso),
        late_time: lateIso ? new Date(lateIso) : null,
        pin_code,
        checkout_pin_code,
        latitude: Number(latitude) || 0,
        longitude: Number(longitude) || 0,
        radius_meters: Number(radius_meters) || 50,
        is_active: true
      }
    })

    return res.status(201).json({
      message: `Sesi presensi agenda "${newSession.title}" berhasil dibuat!`,
      session: newSession,
      pin_code
    })
  } catch (error: any) {
    console.error('[AI Agent Apply Agenda Error]:', error)
    return res.status(500).json({ error: error.message || 'Gagal menerapkan agenda ke sistem' })
  }
}

export async function getAgentQuickPrompts(req: any, res: Response) {
  const { mode = 'org', orgSlug } = req.query

  if (mode === 'org' && orgSlug) {
    return res.json({
      prompts: [
        {
          id: 'report-finance',
          category: 'Laporan',
          label: 'Setup Laporan Kas Bulan Ini',
          prompt: 'Tolong buatkan draf Laporan Keuangan lengkap bulan ini berdasarkan kas yang tercatat, sertakan analisis defisit/surplus dan rekomendasi.'
        },
        {
          id: 'agenda-meeting',
          category: 'Agenda',
          label: 'Bikin Agenda Rapat Kerja',
          prompt: 'Bantu buatkan agenda dan rundown terstruktur untuk Rapat Evaluasi & Kerja organisasi minggu ini, lalu siapkan sesi presensinya.'
        },
        {
          id: 'assistant-discipline',
          category: 'Asisten',
          label: 'Analisis Kedisiplinan & Presensi',
          prompt: 'Bagaimana tren kedisiplinan dan absensi anggota dalam sesi-sesi terakhir? Berikan ringkasan dan evaluasi anggota yang rajin maupun bermasalah.'
        },
        {
          id: 'assistant-broadcast',
          category: 'Asisten',
          label: 'Draf Pesan Siaran WhatsApp',
          prompt: 'Buatkan draf pengumuman WhatsApp yang ramah dan menarik untuk mengingatkan anggota mengenai iuran kas dan agenda kegiatan berikutnya.'
        }
      ]
    })
  }

  return res.json({
    prompts: [
      {
        id: 'personal-report',
        category: 'Laporan',
        label: 'Ringkas Keuangan Pribadi',
        prompt: 'Tolong buatkan ringkasan arus kas keuangan pribadi saya bulan ini dan evaluasi pengeluaran saya.'
      },
      {
        id: 'personal-agenda',
        category: 'Agenda',
        label: 'Rancang Jadwal Harian / Mingguan',
        prompt: 'Bantu saya menyusun agenda dan jadwal prioritas mingguan untuk mengelola kegiatan organisasi dan target pribadi saya.'
      },
      {
        id: 'personal-saving',
        category: 'Asisten',
        label: 'Tips Mencapai Target Tabungan',
        prompt: 'Berdasarkan target tabungan dan pemasukan saya saat ini, berikan strategi praktis agar target finansial saya tercapai tepat waktu.'
      }
    ]
  })
}

/**
 * 4. Autonomous / Agentic Push Broadcast
 * Sends an official notification & web-push to all organization members
 */
export async function broadcastAgenticNotification(req: any, res: Response) {
  const userId = req.user?.id
  const { orgSlug, title, body, url } = req.body

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  if (!orgSlug || !title || !body) {
    return res.status(400).json({ error: 'orgSlug, title, dan body notifikasi wajib diisi' })
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] },
      include: {
        organization_members: {
          select: { profile_id: true, role: true }
        }
      }
    })

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
    }

    const member = org.organization_members.find((m: any) => m.profile_id === userId)
    if (!member || (member.role !== 'head' && member.role !== 'vice_head' && member.role !== 'sekretaris' && member.role !== 'bendahara')) {
      return res.status(403).json({ error: 'Hanya Pengurus (Ketua, Wakil, Sekretaris, Bendahara) yang dapat menyiarkan notifikasi ke semua anggota' })
    }

    let sentCount = 0
    const targetUrl = url || `/org/${org.slug}/dashboard`

    for (const m of org.organization_members) {
      await sendPushNotification(
        m.profile_id,
        title,
        body,
        targetUrl,
        true
      )
      sentCount++
    }

    return res.json({
      message: `Notifikasi berhasil disiarkan ke ${sentCount} anggota organisasi!`,
      sentCount
    })
  } catch (error: any) {
    console.error('[AI Agent Broadcast Error]:', error)
    return res.status(500).json({ error: error.message || 'Gagal menyiarkan notifikasi' })
  }
}

/**
 * 5. Autonomous Health Check & Early Warning System
 * Proactively flags financial deficit, discipline anomalies, and empty schedules.
 */
export async function getAgenticHealthAndWarnings(req: any, res: Response) {
  const userId = req.user?.id
  const { orgSlug } = req.params

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] },
      include: {
        organization_members: {
          include: { profile: { select: { full_name: true } } }
        }
      }
    })

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
    }

    const now = new Date()
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    // Financial analysis
    const financials = await prisma.financial_records.findMany({
      where: {
        organization_id: org.id,
        transaction_date: { gte: firstDayOfMonth }
      }
    })

    let income = 0
    let expense = 0
    financials.forEach((f: any) => {
      const amt = parseFloat(f.amount.toString())
      if (f.type === 'income') income += amt
      else expense += amt
    })
    const balance = income - expense

    // Upcoming agendas
    const upcomingSessions = await prisma.attendance_sessions.findMany({
      where: {
        organization_id: org.id,
        is_active: true,
        start_time: { gte: now, lte: sevenDaysAhead }
      }
    })

    // Discipline anomalies (past 14 days)
    const recentAbsences = await prisma.attendance.findMany({
      where: {
        organization_id: org.id,
        status: { in: ['absent', 'late'] },
        created_at: { gte: fourteenDaysAgo }
      },
      include: { profile: { select: { full_name: true } } }
    })

    const absenceMap: { [name: string]: number } = {}
    recentAbsences.forEach((a: any) => {
      const name = a.profile?.full_name || 'Anggota'
      absenceMap[name] = (absenceMap[name] || 0) + 1
    })

    const redZoneMembers = Object.entries(absenceMap)
      .filter(([_, count]) => count >= 2)
      .map(([name, count]) => ({ name, count }))

    // Build Early Warnings list & calculate Score
    const warnings: Array<{
      id: string
      severity: 'critical' | 'warning' | 'info'
      title: string
      description: string
      actionPrompt: string
    }> = []

    let healthScore = 100

    if (balance < 0) {
      healthScore -= 25
      warnings.push({
        id: 'warn-deficit',
        severity: 'critical',
        title: 'Defisit Kas Bulan Berjalan',
        description: `Pengeluaran bulan ini (Rp ${expense.toLocaleString('id-ID')}) melebihi pemasukan (Rp ${income.toLocaleString('id-ID')}) dengan selisih defisit Rp ${Math.abs(balance).toLocaleString('id-ID')}.`,
        actionPrompt: 'Analisis defisit kas bulan ini dan berikan rekomendasi penghematan atau penagihan iuran.'
      })
    }

    if (redZoneMembers.length > 0) {
      healthScore -= Math.min(30, redZoneMembers.length * 10)
      warnings.push({
        id: 'warn-absenteeism',
        severity: 'warning',
        title: `${redZoneMembers.length} Anggota Masuk Zona Merah Presensi`,
        description: `Terdeteksi anggota sering terlambat atau alpa dalam 14 hari terakhir: ${redZoneMembers.map(m => `${m.name} (${m.count}x)`).join(', ')}.`,
        actionPrompt: 'Buatkan evaluasi pembinaan untuk anggota yang masuk zona merah presensi dan draf surat peringatan/pengingat.'
      })
    }

    if (upcomingSessions.length === 0) {
      healthScore -= 10
      warnings.push({
        id: 'warn-no-agenda',
        severity: 'info',
        title: 'Belum Ada Agenda Terjadwal Minggu Ini',
        description: 'Tidak ada sesi rapat atau agenda kegiatan yang terdaftar untuk 7 hari ke depan.',
        actionPrompt: 'Bantu rancang agenda kegiatan dan rapat kerja untuk minggu ini.'
      })
    }

    healthScore = Math.max(10, Math.min(100, healthScore))

    return res.json({
      healthScore,
      healthStatus: healthScore >= 80 ? 'Prima' : healthScore >= 60 ? 'Waspada' : 'Kritis',
      warnings,
      summary: {
        income,
        expense,
        balance,
        upcomingAgendasCount: upcomingSessions.length,
        redZoneCount: redZoneMembers.length,
        totalMembers: org.organization_members.length
      }
    })
  } catch (error: any) {
    console.error('[AI Agent Health Warnings Error]:', error)
    return res.status(500).json({ error: error.message || 'Gagal memuat early warning status' })
  }
}

/**
 * 6. On-demand Trigger for AI Weekly Digest
 */
export async function triggerAiDigestNow(req: any, res: Response) {
  const userId = req.user?.id
  const { orgSlug } = req.params

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] }
    })

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
    }

    const result = await runAiDigestForOrg(org.id)
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Gagal menjalankan digest' })
    }

    return res.json({
      message: 'Autonomous AI Digest berhasil dijalankan dan dikirimkan ke pengurus!',
      summary: result.summary
    })
  } catch (error: any) {
    console.error('[Trigger AI Digest Error]:', error)
    return res.status(500).json({ error: error.message || 'Gagal memicu digest' })
  }
}

/**
 * 7. Multimodal AI Receipt / Struk OCR Scanner (Quick-Win)
 * Extracts amount, date, category, and vendor from uploaded receipt image.
 */
export async function scanReceiptWithAI(req: any, res: Response) {
  const userId = req.user?.id
  const { imageUrl, imageBase64, mimeType = 'image/jpeg' } = req.body

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Gambar struk (imageUrl atau imageBase64) wajib disertakan' })
  }

  try {
    let base64Data = imageBase64
    let detectedMime = mimeType

    if (imageUrl && !imageBase64) {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) {
        return res.status(400).json({ error: 'Gagal mengunduh gambar struk dari URL' })
      }
      const arrayBuf = await imgRes.arrayBuffer()
      base64Data = Buffer.from(arrayBuf).toString('base64')
      detectedMime = imgRes.headers.get('content-type') || mimeType
    }

    const prompt = `Anda adalah asisten OCR cerdas pembaca struk/nota kas organisasi.
Analisis gambar struk/nota belanja ini dan ekstrak informasi keuangannya secara akurat.
Kembalikan HANYA format JSON murni TANPA pembungkus markdown block (\`\`\`json):
{
  "amount": 150000,
  "type": "expense",
  "category": "Konsumsi",
  "description": "Pembelian Snack Rapat - Toko/Merchant",
  "transaction_date": "${new Date().toISOString().split('T')[0]}",
  "merchant": "Nama Toko / Tempat",
  "confidence": "Tinggi"
}
Kategori yang disarankan: Konsumsi, Operasional, Logistik, Transport, Perlengkapan, Administrasi, Biaya Acara, atau Lain-lain.
Gunakan format tanggal YYYY-MM-DD. Jika tanggal struk tidak terlihat, gunakan tanggal hari ini.`

    let result
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: detectedMime } }
      ])
    } catch (e1) {
      const modelFallback = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      result = await modelFallback.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: detectedMime } }
      ])
    }

    const text = result.response.text()
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleanJson)

    return res.json({
      success: true,
      data: {
        ...parsed,
        receipt_url: imageUrl || null
      }
    })
  } catch (err: any) {
    console.error('[AI Receipt OCR Error]:', err)
    return res.status(500).json({ error: err.message || 'Gagal memindai gambar struk dengan AI' })
  }
}

/**
 * 8. Save Scanned Receipt Transaction into financial_records (1-Click Save)
 */
export async function saveAgentTransaction(req: any, res: Response) {
  const userId = req.user?.id
  const { orgSlug, mode = 'org', amount, type = 'expense', category, description, transaction_date, receipt_url } = req.body

  if (!userId) {
    return res.status(401).json({ error: 'Autentikasi diperlukan' })
  }

  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Nominal amount valid wajib diisi' })
  }

  try {
    if (mode === 'org' && orgSlug) {
      const org = await prisma.organizations.findFirst({
        where: { OR: [{ slug: orgSlug }, { id: orgSlug.length === 36 ? orgSlug : undefined }] },
        include: { organization_members: true }
      })

      if (!org) {
        return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
      }

      const member = org.organization_members.find((m: any) => m.profile_id === userId)
      if (!member || (member.role !== 'head' && member.role !== 'vice_head' && member.role !== 'bendahara')) {
        return res.status(403).json({ error: 'Hanya Bendahara atau Ketua yang dapat menyimpan catatan kas organisasi' })
      }

      const record = await prisma.financial_records.create({
        data: {
          organization_id: org.id,
          amount: parseFloat(amount),
          type: (type === 'income' ? 'income' : 'expense') as any,
          category: category || 'Lain-lain',
          description: description || null,
          receipt_url: receipt_url || null,
          transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
          created_by: userId
        }
      })

      return res.status(201).json({
        message: `Transaksi kas sebesar Rp ${parseFloat(amount).toLocaleString('id-ID')} berhasil dicatat ke buku kas organisasi!`,
        record
      })
    } else {
      // Personal space
      const record = await prisma.financial_records.create({
        data: {
          profile_id: userId,
          amount: parseFloat(amount),
          type: (type === 'income' ? 'income' : 'expense') as any,
          category: category || 'Lain-lain',
          description: description || null,
          receipt_url: receipt_url || null,
          transaction_date: transaction_date ? new Date(transaction_date) : new Date()
        }
      })

      return res.status(201).json({
        message: `Transaksi kas pribadi sebesar Rp ${parseFloat(amount).toLocaleString('id-ID')} berhasil dicatat!`,
        record
      })
    }
  } catch (error: any) {
    console.error('[AI Save Transaction Error]:', error)
    return res.status(500).json({ error: error.message || 'Gagal menyimpan transaksi kas' })
  }
}

