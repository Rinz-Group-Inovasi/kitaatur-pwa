import { Request, Response } from 'express'
import { prisma } from '../config/db'

const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false
  const env = process.env.ADMIN_EMAIL || 'generalrino@gmail.com'
  const list = env.split(',').map((e) => e.trim().toLowerCase())
  return list.includes(email.toLowerCase())
}

export async function getMySubscriptions(req: Request, res: Response) {
  const userId = (req as any).user?.id
  const userEmail = (req as any).user?.email

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized user' })
  }

  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    // 0. Auto-expire unpaid checkouts whose QRIS payment window has passed
    await prisma.subscriptions.updateMany({
      where: {
        status: 'unpaid',
        OR: [
          { expires_at: { lt: now } },
          { created_at: { lt: oneHourAgo } }
        ]
      },
      data: {
        status: 'past_due'
      }
    })

    // 1. Direct subscriptions owned by this user
    const directSubs = await prisma.subscriptions.findMany({
      where: { profile_id: userId },
      orderBy: { created_at: 'desc' }
    })

    // 2. Also find organizations owned by this user or where user is member
    const userOrgs = await prisma.organizations.findMany({
      where: {
        OR: [
          { owner_id: userId },
          { organization_members: { some: { profile_id: userId } } }
        ]
      },
      include: {
        owner: true,
        organization_members: {
          include: {
            profile: {
              include: {
                subscriptions: {
                  where: { status: 'active' },
                  orderBy: { created_at: 'desc' }
                }
              }
            }
          }
        }
      }
    })

    const memberSubs: any[] = []
    for (const org of userOrgs) {
      for (const m of org.organization_members) {
        if (m.profile_id !== userId && m.profile?.subscriptions) {
          for (const s of m.profile.subscriptions) {
            memberSubs.push({
              ...s,
              organization_name: org.name,
              organization_slug: org.slug,
              purchased_by: {
                name: m.profile.full_name,
                email: m.profile.email,
                role: m.role
              }
            })
          }
        }
      }
    }

    const existingIds = new Set(directSubs.map(s => s.id))
    const allSubs = [
      ...directSubs.map(s => {
        const relatedOrg = userOrgs.find(o => o.owner_id === userId) || userOrgs[0]
        return {
          ...s,
          organization_name: relatedOrg?.name || null,
          organization_slug: relatedOrg?.slug || null
        }
      }),
      ...memberSubs.filter(s => !existingIds.has(s.id))
    ]

    // Consolidate subscriptions: exactly ONE card per organization or unique plan
    const groups = new Map<string, any[]>()
    for (const s of allSubs) {
      const key = s.organization_slug
        ? `org:${s.organization_slug}`
        : s.organization_name
        ? `org_name:${s.organization_name}`
        : `plan:${s.plan_type || 'personal'}`

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }

    const consolidated: any[] = []
    for (const [, group] of groups.entries()) {
      // 1. If there's an active sub, prioritize it
      const activeSub = group.find((s) => {
        const isNotExpired = s.expires_at ? new Date(s.expires_at) >= now : false
        return s.status === 'active' && isNotExpired
      })
      if (activeSub) {
        consolidated.push(activeSub)
        continue
      }

      // 2. Otherwise pick the best inactive/expired sub (real payment first, then latest expiry/creation)
      const sorted = [...group].sort((a, b) => {
        const aPaid = (Number(a.amount_paid) || 0) > 0 ? 1 : 0
        const bPaid = (Number(b.amount_paid) || 0) > 0 ? 1 : 0
        if (aPaid !== bPaid) return bPaid - aPaid

        const aExp = a.expires_at ? new Date(a.expires_at).getTime() : 0
        const bExp = b.expires_at ? new Date(b.expires_at).getTime() : 0
        if (aExp !== bExp) return bExp - aExp

        const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0
        const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0
        return bCreated - aCreated
      })
      consolidated.push(sorted[0])
    }

    // Jika user adalah Superadmin / God Mode, sematkan langganan aktif tanpa batas di paling atas
    const isAdmin = isSuperAdminEmail(userEmail)
    if (isAdmin) {
      const adminSub = {
        id: 'superadmin-unlimited-bypass',
        profile_id: userId,
        plan_type: 'KitaAtur Enterprise (Unlimited Admin)',
        status: 'active',
        amount_paid: 0,
        starts_at: '2024-01-01T00:00:00.000Z',
        expires_at: '2099-12-31T23:59:59.999Z',
        created_at: '2024-01-01T00:00:00.000Z',
        organization_name: 'Semua Organisasi (Bypass Penuh)',
        organization_slug: 'all-unlimited',
        is_admin_bypass: true
      }
      consolidated.unshift(adminSub)
    }

    return res.status(200).json(consolidated)
  } catch (err: any) {
    console.error('Error fetching subscriptions:', err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

export async function getSubscriptionById(req: Request, res: Response) {
  const { id } = req.params

  if (!id) {
    return res.status(400).json({ error: 'Subscription ID is required' })
  }

  // Handle case where 'me' reaches here
  if (id === 'me') {
    return getMySubscriptions(req, res)
  }

  // Handle virtual superadmin subscription ID
  if (id === 'superadmin-unlimited-bypass') {
    return res.status(200).json({
      id: 'superadmin-unlimited-bypass',
      plan_type: 'KitaAtur Enterprise (Unlimited Admin)',
      status: 'active',
      amount_paid: 0,
      original_amount: 0,
      discount_amount: 0,
      starts_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2099-12-31T23:59:59.999Z',
      created_at: '2024-01-01T00:00:00.000Z',
      organization_name: 'Semua Organisasi (Bypass Penuh)',
      organization_slug: 'all-unlimited',
      is_admin_bypass: true
    })
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    
    let sub: any = null

    // 1. Prisma lookup by ID (if UUID) or by KitaPay Transaction ID
    if (isUuid) {
      sub = await prisma.subscriptions.findFirst({
        where: {
          OR: [
            { id },
            { kitapay_transaction_id: id }
          ]
        }
      })
    } else {
      sub = await prisma.subscriptions.findFirst({
        where: {
          kitapay_transaction_id: id
        }
      })
    }

    // 2. Fallback using robust string-matching SQL query
    if (!sub) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM public.subscriptions WHERE id::text = $1 OR LOWER(kitapay_transaction_id) = LOWER($1) LIMIT 1`,
        id
      )
      sub = rows[0]
    }
    
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found' })
    }

    return res.status(200).json({
      ...sub,
      amount_paid: sub.amount_paid != null ? Number(sub.amount_paid) : 0,
      original_amount: sub.original_amount != null ? Number(sub.original_amount) : 0,
      discount_amount: sub.discount_amount != null ? Number(sub.discount_amount) : 0
    })
  } catch (err: any) {
    console.error('Error fetching subscription:', err?.message || err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
