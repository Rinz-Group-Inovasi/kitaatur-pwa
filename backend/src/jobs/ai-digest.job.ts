import cron from 'node-cron'
import { prisma } from '../config/db'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sendPushNotification } from '../controllers/notification.controller'

const apiKey = process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(apiKey)

/**
 * AI Autonomous Watchdog & Weekly Digest Job
 * Proactively analyzes organization financial health, discipline anomalies,
 * and upcoming agendas, then dispatches autonomous briefings to leaders.
 */
export async function runAiDigestForOrg(orgId: string): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    const org = await prisma.organizations.findUnique({
      where: { id: orgId },
      include: {
        organization_members: {
          where: { role: { in: ['head', 'vice_head', 'bendahara', 'sekretaris'] } },
          select: { profile_id: true, role: true }
        }
      }
    })

    if (!org || org.organization_members.length === 0) {
      return { success: false, error: 'Organisasi tidak memiliki pengurus untuk dikirimi digest' }
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // 1. Financial stats in past 7 days
    const recentFinancials = await prisma.financial_records.findMany({
      where: {
        organization_id: org.id,
        transaction_date: { gte: sevenDaysAgo }
      }
    })

    let weeklyIncome = 0
    let weeklyExpense = 0
    recentFinancials.forEach((f: any) => {
      const amt = parseFloat(f.amount.toString())
      if (f.type === 'income') weeklyIncome += amt
      else weeklyExpense += amt
    })

    // 2. Upcoming agendas/sessions in next 7 days
    const upcomingSessions = await prisma.attendance_sessions.findMany({
      where: {
        organization_id: org.id,
        is_active: true,
        start_time: { gte: now, lte: sevenDaysAhead }
      },
      select: { title: true, start_time: true }
    })

    // 3. Discipline check (absence in past 14 days)
    const recentAbsences = await prisma.attendance.findMany({
      where: {
        organization_id: org.id,
        status: { in: ['absent', 'late'] },
        created_at: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) }
      },
      include: { profile: { select: { full_name: true } } }
    })

    // Count absences per profile
    const absenceCounts: { [name: string]: number } = {}
    recentAbsences.forEach((a: any) => {
      const name = a.profile?.full_name || 'Anggota'
      absenceCounts[name] = (absenceCounts[name] || 0) + 1
    })
    const highAbsenceList = Object.entries(absenceCounts)
      .filter(([_, count]) => count >= 2)
      .map(([name, count]) => `${name} (${count}x bermasalah)`)
      .slice(0, 3)

    let summaryText = ''
    if (apiKey) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
        const prompt = `Anda adalah asisten AI eksekutif otonom untuk organisasi "${org.name}".
Buat ringkasan eksekutif mingguan super padat dalam 2-3 kalimat santai tapi profesional untuk Ketua & Pengurus:
- Pemasukan 7 hari terakhir: Rp ${weeklyIncome.toLocaleString('id-ID')}
- Pengeluaran 7 hari terakhir: Rp ${weeklyExpense.toLocaleString('id-ID')} (Selisih: Rp ${(weeklyIncome - weeklyExpense).toLocaleString('id-ID')})
- Agenda/Sesi 7 hari ke depan: ${upcomingSessions.map(s => `"${s.title}"`).join(', ') || 'Belum ada agenda'}
- Anggota sering terlambat/absen: ${highAbsenceList.join(', ') || 'Semua tertib'}

Berikan 1 highlight finansial, 1 pengingat agenda, dan 1 rekomendasi tindakan. Hindari formatting markdown tebal ganda berlebihan.`

        const result = await model.generateContent(prompt)
        summaryText = result.response.text().trim()
      } catch (aiErr) {
        summaryText = `Arus kas minggu ini: Pemasukan Rp ${weeklyIncome.toLocaleString('id-ID')}, Pengeluaran Rp ${weeklyExpense.toLocaleString('id-ID')}. Ada ${upcomingSessions.length} agenda terdekat. Tetap jaga kedisiplinan dan pantau kas organisasi.`
      }
    } else {
      summaryText = `Pemasukan 7 hari: Rp ${weeklyIncome.toLocaleString('id-ID')}, Pengeluaran: Rp ${weeklyExpense.toLocaleString('id-ID')}. Terdapat ${upcomingSessions.length} agenda aktif ke depan.`
    }

    // 4. Autonomous Notification Dispatch to Leaders
    const title = `🤖 AI Weekly Digest: ${org.name}`
    for (const leader of org.organization_members) {
      await sendPushNotification(
        leader.profile_id,
        title,
        summaryText,
        `/org/${org.slug}/assistant`,
        true
      )
    }

    return { success: true, summary: summaryText }
  } catch (err: any) {
    console.error(`[AI Digest Error Org ${orgId}]:`, err)
    return { success: false, error: err.message || 'Failed to run AI digest' }
  }
}

/**
 * Initializes the Autonomous AI Digest Cron Job
 * Runs every Monday at 07:00 AM (WIB / server time)
 */
export function initAiDigestJob() {
  // Setiap Senin jam 07:00 pagi
  cron.schedule('0 7 * * 1', async () => {
    console.log('[AI Watchdog Cron] Memulai Autonomous Weekly AI Digest...')
    try {
      const orgs = await prisma.organizations.findMany({
        select: { id: true, name: true }
      })

      for (const org of orgs) {
        await runAiDigestForOrg(org.id)
      }
      console.log(`[AI Watchdog Cron] Selesai mengirim digest ke ${orgs.length} organisasi.`)
    } catch (e) {
      console.error('[AI Watchdog Cron Failed]:', e)
    }
  })
}
