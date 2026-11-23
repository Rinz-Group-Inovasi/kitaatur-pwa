import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireOrgRole } from '../middleware/role.middleware'
import {
  getInventory,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  createInventoryLoan,
  returnInventoryLoan,
  getInventoryLoans
} from '../controllers/inventory.controller'

const router = Router()

router.use(requireAuth)

// 1. Ambil daftar barang inventaris (Semua anggota bisa melihat)
router.get('/:orgIdOrSlug', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara', 'member', 'auditor']), getInventory)

// 2. Ambil riwayat peminjaman barang (Semua anggota bisa melihat)
router.get('/:orgIdOrSlug/loans', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara', 'member', 'auditor']), getInventoryLoans)

// 3. Ambil detail satu barang
router.get('/:orgIdOrSlug/detail/:itemId', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara', 'member', 'auditor']), getInventoryItemById)

// 4. Tambah barang baru (Ketua, Wakil, Sekretaris, Bendahara)
router.post('/:orgIdOrSlug', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara']), createInventoryItem)

// 5. Update barang (Ketua, Wakil, Sekretaris, Bendahara)
router.put('/:orgIdOrSlug/:itemId', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara']), updateInventoryItem)

// 6. Hapus barang (Ketua, Wakil, Sekretaris, Bendahara)
router.delete('/:orgIdOrSlug/:itemId', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara']), deleteInventoryItem)

// 7. Catat peminjaman barang (Ketua, Wakil, Sekretaris, Bendahara)
router.post('/:orgIdOrSlug/loans', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara']), createInventoryLoan)

// 8. Proses pengembalian barang (Ketua, Wakil, Sekretaris, Bendahara)
router.post('/:orgIdOrSlug/loans/:loanId/return', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara']), returnInventoryLoan)

export default router
