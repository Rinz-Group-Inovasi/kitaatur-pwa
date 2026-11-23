import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireOrgRole } from '../middleware/role.middleware'
import {
  getLetters,
  getLetterById,
  createLetter,
  updateLetter,
  deleteLetter,
  generateLetterNumberAI
} from '../controllers/letter.controller'

const router = Router()

router.use(requireAuth)

// 1. Ambil daftar surat (Semua anggota bisa melihat arsip)
router.get('/:orgIdOrSlug', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara', 'member', 'auditor']), getLetters)

// 2. Ambil detail satu surat
router.get('/:orgIdOrSlug/detail/:letterId', requireOrgRole(['head', 'vice_head', 'sekretaris', 'bendahara', 'member', 'auditor']), getLetterById)

// 3. Tambah surat baru (Ketua, Wakil, Sekretaris)
router.post('/:orgIdOrSlug', requireOrgRole(['head', 'vice_head', 'sekretaris']), createLetter)

// 4. Update surat (Ketua, Wakil, Sekretaris)
router.put('/:orgIdOrSlug/:letterId', requireOrgRole(['head', 'vice_head', 'sekretaris']), updateLetter)

// 5. Hapus surat (Ketua, Wakil, Sekretaris)
router.delete('/:orgIdOrSlug/:letterId', requireOrgRole(['head', 'vice_head', 'sekretaris']), deleteLetter)

// 6. AI Auto-Numbering generator
router.post('/:orgIdOrSlug/generate-number', requireOrgRole(['head', 'vice_head', 'sekretaris']), generateLetterNumberAI)

export default router
