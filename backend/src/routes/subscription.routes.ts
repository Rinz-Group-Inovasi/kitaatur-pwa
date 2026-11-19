import { Router } from 'express'
import { getMySubscriptions, getSubscriptionById } from '../controllers/subscription.controller'
import { requireAuth } from '../middleware/auth.middleware'

const router = Router()

// 1. Protected endpoint: My subscriptions (harus sebelum /:id agar 'me' tidak dianggap sebagai :id)
router.get('/me', requireAuth, getMySubscriptions)

// 2. Public invoice lookup by subscription ID or transaction ID (for QRIS payment page & status verification)
router.get('/:id', getSubscriptionById)

export default router
