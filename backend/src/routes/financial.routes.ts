import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireOrgRole } from '../middleware/role.middleware'
import { requireActiveOrgSubscription } from '../middleware/subscription.middleware'
import {
  getOrgFinancialRecords,
  getOrgFinancialSummary,
  createOrgFinancialRecord,
  deleteOrgFinancialRecord,
  getOrgFinancialRecordById,
  getPublicInvoiceById
} from '../controllers/financial.controller'
import { generateFinancialInsight } from '../controllers/ai.controller'

const router = Router()

// PUBLIC ROUTE: Ambil invoice tanpa login
router.get('/public/invoice/:recordId', getPublicInvoiceById)

// Seluruh rute keuangan di bawah ini memerlukan otentikasi JWT
router.use(requireAuth)

// A. Ambil riwayat kas organisasi (Semua role pengurus & anggota - READ-ONLY TETAP BISA DIAKSES SAAT KADALUWARSA)
router.get('/:orgIdOrSlug', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getOrgFinancialRecords)

// B. Ambil summary & data grafik bulanan (Semua role pengurus & anggota - READ-ONLY TETAP BISA DIAKSES SAAT KADALUWARSA)
router.get('/:orgIdOrSlug/summary', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getOrgFinancialSummary)

// Hanya Bendahara yang bisa mencatat dan menghapus kas (Wajib Langganan Aktif)
router.post('/:orgIdOrSlug', requireOrgRole(['bendahara']), requireActiveOrgSubscription, createOrgFinancialRecord)
router.delete('/:orgIdOrSlug/:recordId', requireOrgRole(['bendahara']), requireActiveOrgSubscription, deleteOrgFinancialRecord)

// E. Ambil satu transaksi (Semua anggota bisa melihat)
router.get('/:orgIdOrSlug/record/:recordId', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getOrgFinancialRecordById)

// F. Generate AI Insight (Wajib Langganan Aktif)
router.post('/:orgIdOrSlug/ai-insight', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), requireActiveOrgSubscription, generateFinancialInsight)

export default router
