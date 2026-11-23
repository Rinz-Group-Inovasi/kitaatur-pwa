import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOrgRole } from '../middleware/role.middleware';
import {
  getStatus,
  startSession,
  disconnectSession,
  sendTestMessage,
  pairParentManual
} from '../controllers/whatsapp.controller';

const router = Router();

router.get(
  '/:orgIdOrSlug/status',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk', 'sekretaris']),
  getStatus
);

router.post(
  '/:orgIdOrSlug/start',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk', 'sekretaris']),
  startSession
);

router.post(
  '/:orgIdOrSlug/disconnect',
  requireAuth,
  requireOrgRole(['head', 'vice_head']),
  disconnectSession
);

router.post(
  '/:orgIdOrSlug/test',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk']),
  sendTestMessage
);

router.post(
  '/:orgIdOrSlug/pair-parent',
  requireAuth,
  requireOrgRole(['head', 'vice_head', 'bk', 'sekretaris']),
  pairParentManual
);

export default router;

