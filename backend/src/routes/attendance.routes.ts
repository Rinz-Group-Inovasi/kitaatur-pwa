import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware'
import { requireOrgRole } from '../middleware/role.middleware'
import { requireActiveOrgSubscription } from '../middleware/subscription.middleware'
import {
  createSession,
  getActiveSession,
  closeSession,
  deleteSession,
  checkIn,
  getAttendanceRecords,
  getAttendanceStats,
  getSessions,
  updateAttendanceStatus,
  getAgenda,
  validateAttendance,
  getMyAttendanceHistory,
  updateAttendanceProof,
  manualBulkCheckIn,
  getPendingCollaborations,
  acceptCollaboration,
  rejectCollaboration,
  getSessionMembers,
  linkNfcCard,
  unlinkNfcCard,
  processNfcTap,
  getNfcKioskInfo
} from '../controllers/attendance.controller'

import {
  generateAttendanceInsight,
  validateProofWithAI
} from '../controllers/ai.controller'

const router = Router()

router.use(requireAuth)

// ========================
// Attendance Sessions
// ========================

// Pending collaborations
router.get('/:orgIdOrSlug/pending-collaborations', requireOrgRole(['head', 'sekretaris']), getPendingCollaborations)

// Merespons kolaborasi
router.post('/:orgIdOrSlug/sessions/:sessionId/collaborate/accept', requireOrgRole(['head', 'sekretaris']), acceptCollaboration)
router.post('/:orgIdOrSlug/sessions/:sessionId/collaborate/reject', requireOrgRole(['head', 'sekretaris']), rejectCollaboration)

// Buka sesi absensi baru terjadwal (Head & Sekretaris - Wajib Langganan Aktif)
router.post('/:orgIdOrSlug/sessions', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, createSession)

// Ambil daftar semua sesi absensi (Semua Anggota untuk keperluan filter riwayat - READ-ONLY BISA DIAKSES)
router.get('/:orgIdOrSlug/sessions', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getSessions)

// Ambil sesi absensi yang sedang aktif (Semua Anggota)
router.get('/:orgIdOrSlug/sessions/active', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getActiveSession)

// Ambil anggota yang valid untuk suatu sesi (Bantu Absen)
router.get('/:orgIdOrSlug/sessions/:sessionId/members', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getSessionMembers)

// Ambil active/upcoming agenda untuk Member
router.get('/:orgIdOrSlug/agenda', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getAgenda)

// Ambil sesi absensi spesifik
router.get('/:orgIdOrSlug/sessions/active/:sessionId', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getActiveSession)

// Tutup sesi absensi (Head & Sekretaris)
router.put('/:orgIdOrSlug/sessions/:sessionId/close', requireOrgRole(['head', 'sekretaris']), closeSession)

// Hapus sesi absensi / agenda lampau/salah buat (Head, Vice Head & Sekretaris)
router.delete('/:orgIdOrSlug/sessions/:sessionId', requireOrgRole(['head', 'vice_head', 'sekretaris']), deleteSession)

// Manual Bulk Check-in (Untuk Head/Sekretaris/Delegasi - Wajib Langganan Aktif)
router.post('/:orgIdOrSlug/sessions/:sessionId/manual-checkin', requireOrgRole(['head', 'sekretaris', 'member']), requireActiveOrgSubscription, manualBulkCheckIn)


// ========================
// Member Check-in (Wajib Langganan Aktif)
// ========================

// Check-in dengan PIN dan GPS (Semua Anggota - Wajib Langganan Aktif)
router.post('/:orgIdOrSlug/scan', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member']), requireActiveOrgSubscription, checkIn)


// ========================
// Guest Attendance (QR Code)
// ========================
import { getGuests, uploadGuests, deleteGuest, bulkDeleteGuests, scanGuestQR, getGuestStats, getGuestAnalytics } from '../controllers/attendance.controller'

router.get('/:orgIdOrSlug/guests', requireOrgRole(['head', 'sekretaris', 'member']), getGuests)
router.post('/:orgIdOrSlug/guests', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, uploadGuests)
router.delete('/:orgIdOrSlug/guests/:guestId', requireOrgRole(['head', 'sekretaris']), deleteGuest)
router.post('/:orgIdOrSlug/guests/bulk-delete', requireOrgRole(['head', 'sekretaris']), bulkDeleteGuests)
router.get('/:orgIdOrSlug/guests/analytics', requireOrgRole(['head', 'sekretaris', 'member']), getGuestAnalytics)
router.post('/:orgIdOrSlug/sessions/:sessionId/guests/scan', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, scanGuestQR)
router.post('/:orgIdOrSlug/sessions/:sessionId/members/scan', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, scanGuestQR)
router.post('/:orgIdOrSlug/sessions/:sessionId/scan', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, scanGuestQR)
router.get('/:orgIdOrSlug/sessions/:sessionId/guests/stats', requireOrgRole(['head', 'sekretaris', 'member']), getGuestStats)

// ========================
// NFC Attendance & Kiosk Tap
// ========================
router.post('/:orgIdOrSlug/nfc/link', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, linkNfcCard)
router.post('/:orgIdOrSlug/nfc/unlink', requireOrgRole(['head', 'sekretaris']), requireActiveOrgSubscription, unlinkNfcCard)
router.post('/:orgIdOrSlug/nfc/tap', requireOrgRole(['head', 'sekretaris', 'member']), requireActiveOrgSubscription, processNfcTap)
router.get('/:orgIdOrSlug/nfc/kiosk-info', requireOrgRole(['head', 'sekretaris', 'member', 'auditor']), getNfcKioskInfo)


// ========================
// Stats & History (READ-ONLY TETAP BISA DIAKSES SAAT KADALUWARSA)
// ========================

// Ambil statistik absensi untuk Dashboard Sekretaris
router.get('/:orgIdOrSlug/stats', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getAttendanceStats)

// Ambil riwayat absensi (Semua untuk Head/Sekretaris)
router.get('/:orgIdOrSlug', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getAttendanceRecords)

// Ambil riwayat absensi pribadi (Untuk Pengguna Aktif)
router.get('/:orgIdOrSlug/me/history', requireOrgRole(['head', 'bendahara', 'sekretaris', 'member', 'auditor']), getMyAttendanceHistory)

// Upload Bukti Surat Susulan (Untuk Anggota & Admin)
router.put('/:orgIdOrSlug/attendance/:attendanceId/proof', requireOrgRole(['head', 'vice_head', 'bendahara', 'sekretaris', 'member']), updateAttendanceProof)

// Update status absen (Sekretaris & Head) - Untuk menolak bukti
router.put('/:orgIdOrSlug/attendance/:attendanceId/status', requireOrgRole(['head', 'vice_head', 'sekretaris']), updateAttendanceStatus)

// Approve manual (Sekretaris & Head)
router.put('/:orgIdOrSlug/attendance/:attendanceId/validate', requireOrgRole(['head', 'vice_head', 'sekretaris']), validateAttendance)

// ========================
// AI Analysis
// ========================
router.post('/:orgIdOrSlug/ai-insight', requireOrgRole(['head', 'vice_head', 'sekretaris']), requireActiveOrgSubscription, generateAttendanceInsight)
router.post('/:orgIdOrSlug/validate-proof', requireOrgRole(['head', 'vice_head', 'sekretaris']), requireActiveOrgSubscription, validateProofWithAI)

export default router
