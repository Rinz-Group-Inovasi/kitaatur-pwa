import { Router } from 'express'
import { getMySubscriptions, getSubscriptionById } from '../controllers/subscription.controller'
import { requireAuth } from '../middleware/auth.middleware'

const router = Router()

// Public invoice lookup by subscription ID (for QRIS payment page & status verification)
router.get('/:id', getSubscriptionById)

// Protected endpoints
router.use(requireAuth)
router.get('/me', getMySubscriptions)

export default router
