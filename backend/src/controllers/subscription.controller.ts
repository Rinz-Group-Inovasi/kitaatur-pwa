import { Request, Response } from 'express'
import { prisma } from '../config/db'

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

    return res.status(200).json(allSubs)
  } catch (err: any) {
    console.error('Error fetching subscriptions:', err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}

export async function getSubscriptionById(req: Request, res: Response) {
  const userId = (req as any).user?.id
  const { id } = req.params

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized user' })
  }

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM public.subscriptions WHERE id = $1 LIMIT 1`,
      id
    )
    const sub = rows[0]
    
    if (!sub || sub.profile_id !== userId) {
      return res.status(404).json({ error: 'Subscription not found' })
    }

    return res.status(200).json(sub)
  } catch (err: any) {
    console.error('Error fetching subscription:', err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
