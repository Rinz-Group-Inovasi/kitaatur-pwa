import { Response, NextFunction } from 'express'
import { OrganizationRequest } from './role.middleware'
import { prisma } from '../config/db'

// Short in-memory cache for org active subscription status (valid 30s)
const subCache = new Map<string, { active: boolean; expiresAt: number; planType?: string }>()

export function clearSubCache(orgId?: string) {
  if (orgId) {
    subCache.delete(orgId)
  } else {
    subCache.clear()
  }
}

const getAdminEmails = (): string[] => {
  const env = process.env.ADMIN_EMAIL || 'generalrino@gmail.com'
  return env.split(',').map((e) => e.trim().toLowerCase())
}

const isSuperAdmin = (email?: string | null): boolean => {
  if (!email) return false
  return getAdminEmails().includes(email.trim().toLowerCase())
}

/**
 * Validates that an organization has an active (non-expired) subscription.
 * Implements "Opsi 1: Read-Only Policy for Expired Subscriptions":
 * - GET requests (viewing data, history, members, saldo, reports) remain accessible.
 * - Mutating actions (creating attendance sessions, scanning, recording transactions, adding members)
 *   are locked with HTTP 403 { code: 'SUBSCRIPTION_EXPIRED', requiresRenewal: true }.
 */
export async function requireActiveOrgSubscription(
  req: OrganizationRequest,
  res: Response,
  next: NextFunction
) {
  const user = req.user
  const orgMember = req.orgMember
  const orgIdOrSlug = req.params.orgIdOrSlug

  // 1. Superadmin bypass (God mode)
  if (user?.email && isSuperAdmin(user.email)) {
    return next()
  }

  try {
    let orgId = orgMember?.organizationId

    // If orgId not populated by role.middleware, lookup by orgIdOrSlug
    if (!orgId && orgIdOrSlug) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug)
      const found = await prisma.organizations.findFirst({
        where: isUuid ? { id: orgIdOrSlug } : { slug: orgIdOrSlug },
        select: { id: true }
      })
      if (found) orgId = found.id
    }

    if (!orgId) {
      return res.status(400).json({ error: 'Informasi organisasi tidak valid' })
    }

    const now = Date.now()
    const cached = subCache.get(orgId)
    if (cached && cached.expiresAt > now) {
      if (cached.active) {
        return next()
      } else {
        return res.status(403).json({
          error: 'Masa aktif langganan organisasi Anda telah berakhir. Silakan perpanjang langganan untuk mencatat data atau membuka sesi baru.',
          code: 'SUBSCRIPTION_EXPIRED',
          requiresRenewal: true
        })
      }
    }

    // Lookup organization details
    const org = await prisma.organizations.findUnique({
      where: { id: orgId },
      include: {
        parent: {
          select: {
            id: true,
            owner_id: true,
            is_edu: true
          }
        }
      }
    })

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' })
    }

    const currentDate = new Date()

    // 2. Check owner subscriptions (including parent school owner if linked)
    const ownerIds = [org.owner_id, org.parent?.owner_id].filter(Boolean) as string[]
    let activeSub = null

    if (ownerIds.length > 0) {
      activeSub = await prisma.subscriptions.findFirst({
        where: {
          profile_id: { in: ownerIds },
          status: 'active',
          expires_at: { gt: currentDate }
        },
        orderBy: { expires_at: 'desc' }
      })
    }

    // 3. Fallback: check if an organization member purchased an active subscription
    if (!activeSub) {
      const memberSub = await prisma.organization_members.findFirst({
        where: {
          organization_id: org.id,
          profile: {
            subscriptions: {
              some: {
                status: 'active',
                expires_at: { gt: currentDate }
              }
            }
          }
        },
        include: {
          profile: {
            include: {
              subscriptions: {
                where: { status: 'active', expires_at: { gt: currentDate } },
                orderBy: { expires_at: 'desc' },
                take: 1
              }
            }
          }
        }
      })

      if (memberSub?.profile?.subscriptions?.[0]) {
        activeSub = memberSub.profile.subscriptions[0]
      }
    }

    // 3B. Fallback Keluarga: jika ini cabang, cek apakah pengurus induk memiliki langganan aktif
    if (!activeSub && org.parent_id) {
      const parentMemberSub = await prisma.organization_members.findFirst({
        where: {
          organization_id: org.parent_id,
          role: { in: ['head', 'vice_head'] },
          profile: {
            subscriptions: {
              some: {
                status: 'active',
                expires_at: { gt: currentDate }
              }
            }
          }
        },
        include: {
          profile: {
            include: {
              subscriptions: {
                where: { status: 'active', expires_at: { gt: currentDate } },
                orderBy: { expires_at: 'desc' },
                take: 1
              }
            }
          }
        }
      })

      if (parentMemberSub?.profile?.subscriptions?.[0]) {
        activeSub = parentMemberSub.profile.subscriptions[0]
      }
    }

    if (activeSub) {
      subCache.set(orgId, {
        active: true,
        expiresAt: now + 30000,
        planType: activeSub.plan_type
      })
      return next()
    }

    // Organization subscription is expired or nonexistent (Free / Expired)
    subCache.set(orgId, {
      active: false,
      expiresAt: now + 15000
    })

    return res.status(403).json({
      error: 'Masa aktif langganan organisasi Anda telah berakhir. Silakan perpanjang langganan untuk mencatat data atau membuka sesi baru.',
      code: 'SUBSCRIPTION_EXPIRED',
      requiresRenewal: true
    })
  } catch (err: any) {
    console.error('Subscription validation middleware error:', err)
    return res.status(500).json({ error: 'Gagal memvalidasi status langganan organisasi' })
  }
}

