import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/role.middleware';
import {
  getViolations,
  getViolationsSummary,
  createViolation,
  updateViolation,
  deleteViolation,
  getStudentViolations
} from '../controllers/violation.controller';

const router = Router();

// Endpoint Publik / Siswa / Ortu untuk melihat riwayat poin siswa dengan guestId
router.get('/:orgIdOrSlug/student/:guestId', getStudentViolations);

// Endpoints Manajemen BK & Admin
router.get(
  '/:orgIdOrSlug',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk', 'sekretaris']),
  getViolations
);

router.get(
  '/:orgIdOrSlug/summary',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk', 'sekretaris']),
  getViolationsSummary
);

router.post(
  '/:orgIdOrSlug',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk']),
  createViolation
);

router.put(
  '/:orgIdOrSlug/:id',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk']),
  updateViolation
);

router.delete(
  '/:orgIdOrSlug/:id',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk']),
  deleteViolation
);

export default router;
