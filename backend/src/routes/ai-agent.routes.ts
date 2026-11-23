import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import {
  chatWithAgent,
  applyAgentAgenda,
  getAgentQuickPrompts,
  broadcastAgenticNotification,
  getAgenticHealthAndWarnings,
  triggerAiDigestNow,
  scanReceiptWithAI,
  saveAgentTransaction
} from '../controllers/ai-agent.controller'

const router = Router()

// All AI Agent routes require authentication
router.use(requireAuth)

// 1. Interactive Chat & Copilot Action (Setup Laporan, Bikin Agenda, Asisten)
router.post('/agent/chat', chatWithAgent)

// 2. 1-Click Action to create actual Attendance Session / Agenda in DB
router.post('/agent/apply-agenda', applyAgentAgenda)

// 3. Contextual Quick Action Suggestions
router.get('/agent/quick-prompts', getAgentQuickPrompts)

// 4. Agentic Broadcast: Push Notification to all org members
router.post('/agent/broadcast', broadcastAgenticNotification)

// 5. Agentic Watchdog: Health Score & Early Warnings
router.get('/agent/:orgSlug/warnings', getAgenticHealthAndWarnings)

// 6. Agentic Digest: Trigger Weekly AI Digest on-demand
router.post('/agent/:orgSlug/trigger-digest', triggerAiDigestNow)

// 7. Quick-Win: Multimodal Receipt/Struk OCR Scanner
router.post('/agent/scan-receipt', scanReceiptWithAI)

// 8. Quick-Win: 1-Click Save Scanned Transaction to financial_records
router.post('/agent/save-transaction', saveAgentTransaction)

export default router
