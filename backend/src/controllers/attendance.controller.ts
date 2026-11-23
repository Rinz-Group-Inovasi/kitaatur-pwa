import { Request, Response } from 'express'
import { prisma } from '../config/db'
import { sendPushNotification } from './notification.controller'
import { ensureTodayScheduledSessions } from '../jobs/session.job'
import { sendAttendanceNotification, normalizePhoneNumber } from '../services/whatsapp.service'

// Helper function to calculate distance using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI/180;
  const phi2 = lat2 * Math.PI/180;
  const dPhi = (lat2-lat1) * Math.PI/180;
  const dLambda = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(dPhi/2) * Math.sin(dPhi/2) +
          Math.cos(phi1) * Math.cos(phi2) *
          Math.sin(dLambda/2) * Math.sin(dLambda/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

export async function createSession(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const userId = req.user?.id;
  const { title, session_type, start_time, end_time, late_time, checkout_start_time, latitude, longitude, radius_meters, invitedOrgs } = req.body;

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang bisa membuka sesi presensi' });
  }

  const safeLat = latitude != null ? Number(latitude) : 0;
  const safeLon = longitude != null ? Number(longitude) : 0;

  if (!start_time || !end_time) {
    return res.status(400).json({ error: 'Waktu mulai dan selesai wajib disertakan' });
  }

  const startDt = new Date(start_time);
  const endDt = new Date(end_time);

  if (endDt <= startDt) {
    return res.status(400).json({ error: 'Waktu Selesai harus lebih besar dari Waktu Mulai' });
  }

  if (late_time) {
    const lateDt = new Date(late_time);
    if (lateDt <= startDt || lateDt >= endDt) {
      return res.status(400).json({ error: 'Batas keterlambatan harus berada di antara Waktu Mulai dan Waktu Selesai' });
    }
  }

  if (session_type === 'in_out' && checkout_start_time) {
    const checkoutDt = new Date(checkout_start_time);
    if (checkoutDt <= startDt || checkoutDt >= endDt) {
      return res.status(400).json({ error: 'Waktu mulai absen pulang harus di antara Waktu Mulai dan Waktu Selesai' });
    }
  }

  try {
    // Generate random 4-digit PIN
    const pin_code = Math.floor(1000 + Math.random() * 9000).toString();
    const checkout_pin_code = session_type === 'in_out' ? Math.floor(1000 + Math.random() * 9000).toString() : null;

    // Auto-share dengan cabang/induk yang berada dalam keluarga organisasi yang sama
    const currentOrg = await prisma.organizations.findUnique({
      where: { id: orgMemberContext.organizationId },
      select: { id: true, parent_id: true }
    });

    const rootParentId = currentOrg?.parent_id || currentOrg?.id;
    let familyOrgIds: string[] = [];
    if (rootParentId) {
      const familyOrgs = await prisma.organizations.findMany({
        where: {
          OR: [
            { id: rootParentId },
            { parent_id: rootParentId }
          ]
        },
        select: { id: true }
      });
      familyOrgIds = familyOrgs.map(o => o.id);
    }

    const autoSharedOrgs: string[] = [];
    const pending_shared_orgs: string[] = [];

    if (Array.isArray(invitedOrgs)) {
      for (const id of invitedOrgs) {
        if (typeof id === 'string') {
          // Jika organisasi yang diundang adalah keluarga resmi (cabang / induk), langsung masuk ke shared_with_orgs
          if (familyOrgIds.includes(id)) {
            autoSharedOrgs.push(id);
          } else {
            pending_shared_orgs.push(id);
          }
        }
      }
    }

    const newSession = await prisma.attendance_sessions.create({
      data: {
        organization_id: orgMemberContext.organizationId,
        created_by: userId,
        title: title || 'Sesi Presensi',
        session_type: session_type || 'in_only',
        start_time: new Date(start_time),
        end_time: new Date(end_time),
        late_time: late_time ? new Date(late_time) : null,
        checkout_start_time: checkout_start_time ? new Date(checkout_start_time) : null,
        pin_code,
        checkout_pin_code,
        latitude: safeLat,
        longitude: safeLon,
        radius_meters: radius_meters || 50,
        is_active: true,
        shared_with_orgs: autoSharedOrgs,
        pending_shared_orgs
      } as any
    });

    
    const org = await prisma.organizations.findUnique({ where: { id: orgMemberContext.organizationId } });
    if (org) {
      const members = await prisma.organization_members.findMany({ where: { organization_id: org.id, role: { not: 'auditor' as any } } });
      for (const m of members) {
        if (m.profile_id !== userId) {
          sendPushNotification(m.profile_id, 'Sesi Presensi Dibuka!', `Sesi "${newSession.title}" di ${org.name} telah dibuka. Segera lakukan presensi!`, `/org/${org.slug}/attendance/scan`);
        }
      }

      // Notify auto-shared family orgs
      if (autoSharedOrgs.length > 0) {
        for (const sharedOrgId of autoSharedOrgs) {
          const sharedOrg = await prisma.organizations.findUnique({ where: { id: sharedOrgId } });
          if (sharedOrg) {
            const members = await prisma.organization_members.findMany({
              where: { organization_id: sharedOrgId, role: { not: 'auditor' as any } }
            });
            for (const m of members) {
              if (m.profile_id !== userId) {
                sendPushNotification(m.profile_id, 'Presensi Gabungan Dibuka!', `Sesi "${newSession.title}" gabungan dengan ${org.name} telah dibuka.`, `/org/${sharedOrg.slug}/attendance/scan`);
              }
            }
          }
        }
      }

      // Notify invited orgs
      if (pending_shared_orgs.length > 0) {
        for (const invitedOrgId of pending_shared_orgs) {
          const invitedOrg = await prisma.organizations.findUnique({ where: { id: invitedOrgId } });
          if (invitedOrg) {
            const heads = await prisma.organization_members.findMany({
              where: {
                organization_id: invitedOrgId,
                role: { in: ['head', 'vice_head', 'sekretaris'] }
              }
            });
            for (const h of heads) {
              sendPushNotification(h.profile_id, 'Undangan Kolaborasi Agenda', `${org.name} mengundang ${invitedOrg.name} untuk berkolaborasi di agenda "${newSession.title}".`, `/org/${invitedOrg.slug}/attendance`);
            }
          }
        }
      }
    }
    return res.status(201).json(newSession);
  } catch (err) {
    console.error('Error creating session:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1B. Get All Sessions (Upcoming, Ongoing, Past)
export async function getSessions(req: any, res: Response) {
  const orgMemberContext = req.orgMember;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    // Jalankan pemeriksaan jadwal otomatis di background secara non-blocking
    ensureTodayScheduledSessions(orgMemberContext.organizationId).catch(err => {
      console.error('[SessionJob Background Error]:', err);
    });

    // Otomatis tandai sesi kadaluarsa di background secara non-blocking
    prisma.attendance_sessions.updateMany({
      where: {
        organization_id: orgMemberContext.organizationId,
        is_active: true,
        end_time: { lt: new Date() }
      },
      data: { is_active: false }
    }).catch(err => {
      console.error('[SessionExpire Background Error]:', err);
    });

    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const sessions = await prisma.attendance_sessions.findMany({
      where: {
        OR: [
          { organization_id: orgMemberContext.organizationId },
          { shared_with_orgs: { has: orgMemberContext.organizationId } }
        ]
      },
      orderBy: {
        start_time: 'desc'
      },
      take: limitParam ? Math.min(limitParam, 200) : 100
    });

    return res.status(200).json(sessions);
  } catch (err) {
    console.error('Error getting sessions:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1C. Get Pending Collaborations
export async function getPendingCollaborations(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  if (!orgMemberContext) return res.status(403).json({ error: 'Akses ditolak' });

  try {
    const pendingSessions = await prisma.attendance_sessions.findMany({
      where: {
        pending_shared_orgs: { has: orgMemberContext.organizationId }
      },
      include: {
        organization: { select: { id: true, name: true, logo_url: true } }
      }
    });
    return res.status(200).json(pendingSessions);
  } catch (err) {
    console.error('Error getting pending collabs:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1D. Accept Collaboration
export async function acceptCollaboration(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;

  try {
    const session = await prisma.attendance_sessions.findFirst({ where: { id: sessionId.length === 36 ? sessionId : undefined } });
    if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

    if (!session.pending_shared_orgs.includes(orgMemberContext.organizationId)) {
      return res.status(400).json({ error: 'Tidak ada undangan kolaborasi untuk organisasi ini' });
    }

    const updatedSession = await prisma.attendance_sessions.update({
      where: { id: sessionId.length === 36 ? sessionId : undefined },
      data: {
        pending_shared_orgs: session.pending_shared_orgs.filter(id => id !== orgMemberContext.organizationId),
        shared_with_orgs: { push: orgMemberContext.organizationId }
      }
    });
    return res.status(200).json({ success: true, session: updatedSession });
  } catch (err) {
    console.error('Error accepting collab:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1E. Reject Collaboration
export async function rejectCollaboration(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;

  try {
    const session = await prisma.attendance_sessions.findFirst({ where: { id: sessionId.length === 36 ? sessionId : undefined } });
    if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

    if (!session.pending_shared_orgs.includes(orgMemberContext.organizationId)) {
      return res.status(400).json({ error: 'Tidak ada undangan kolaborasi untuk organisasi ini' });
    }

    const updatedSession = await prisma.attendance_sessions.update({
      where: { id: sessionId.length === 36 ? sessionId : undefined },
      data: {
        pending_shared_orgs: session.pending_shared_orgs.filter(id => id !== orgMemberContext.organizationId)
      }
    });
    return res.status(200).json({ success: true, session: updatedSession });
  } catch (err) {
    console.error('Error rejecting collab:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 1F. Get Session Members (For Bantu Absen Collab)
export async function getSessionMembers(req: any, res: Response) {
  const { sessionId } = req.params;

  try {
    const session = await prisma.attendance_sessions.findFirst({
      where: { id: sessionId.length === 36 ? sessionId : undefined },
      select: { id: true, organization_id: true, shared_with_orgs: true }
    });
    if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

    // Cek authorization: harus head, sekretaris, atau memiliki custom_data.can_take_attendance = true
    const callerMembership = await prisma.organization_members.findUnique({
      where: {
        organization_id_profile_id: {
          organization_id: req.orgMember.organizationId,
          profile_id: req.user.id
        }
      },
      select: { role: true, custom_data: true }
    });

    const customData = callerMembership?.custom_data as any;
    const canDelegate = customData?.can_take_attendance === true;

    if (callerMembership?.role !== 'head' && callerMembership?.role !== 'vice_head' && callerMembership?.role !== 'sekretaris' && !canDelegate) {
      return res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki wewenang untuk mengambil presensi' });
    }

    const validOrgs = [session.organization_id, ...(session.shared_with_orgs || [])];

    const members = await prisma.organization_members.findMany({
      where: { organization_id: { in: validOrgs }, role: { not: 'auditor' as any } },
      include: {
        profile: { select: { full_name: true, email: true, avatar_url: true } },
        organization: { select: { name: true } }
      }
    });

    members.sort((a: any, b: any) => {
      const nameA = (a.profile?.full_name || a.profile?.email || '').toLowerCase();
      const nameB = (b.profile?.full_name || b.profile?.email || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    // Ambil data absensi untuk sesi ini
    const attendances = await prisma.attendance.findMany({
      where: { session_id: sessionId }
    });

    const attendanceMap = new Map<string, any>();
    for (const att of attendances) {
      attendanceMap.set(att.profile_id, att);
    }

    // Petakan semua member dengan data absensi terkini di sesi ini
    const mappedMembers = members.map(member => {
      const attendance = attendanceMap.get(member.profile_id);
      return {
        ...member,
        attendance: attendance ? {
          id: attendance.id,
          status: attendance.status, // 'present' | 'late' | 'excused' | 'sick' | 'absent'
          check_in_time: attendance.check_in_time,
          check_out_time: attendance.check_out_time,
          notes: attendance.notes
        } : null
      };
    });

    return res.status(200).json(mappedMembers);
  } catch (err) {
    console.error('Error fetching session members:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 8. Update Attendance Status (e.g. Reject to Absent)
export async function updateAttendanceStatus(req: any, res: Response) {
  const { orgIdOrSlug, attendanceId } = req.params;
  const { status } = req.body;
  const orgMemberContext = req.orgMember;

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang bisa mengubah status absen' });
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: {
        OR: [
          { id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined },
          { slug: orgIdOrSlug }
        ]
      }
    });

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' });
    }

    const updated = await prisma.attendance.update({
      where: { 
        id: attendanceId,
        organization_id: org.id 
      },
      data: { status }
    });

    res.json({ message: 'Status absen berhasil diubah', data: updated });
  } catch (error) {
    console.error('Error updating attendance status:', error);
    res.status(500).json({ error: 'Terjadi kesalahan saat mengubah status absen' });
  }
}

// 8b. Approve/Validate Attendance
export async function validateAttendance(req: any, res: Response) {
  const { orgIdOrSlug, attendanceId } = req.params;
  const orgMemberContext = req.orgMember;

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang bisa menyetujui izin' });
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: {
        OR: [
          { id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined },
          { slug: orgIdOrSlug }
        ]
      }
    });

    if (!org) {
      return res.status(404).json({ error: 'Organisasi tidak ditemukan' });
    }

    const existing = await prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!existing) {
      return res.status(404).json({ error: 'Data presensi tidak ditemukan' });
    }

    const newNotes = existing.notes ? (existing.notes.includes('[VALIDATED]') ? existing.notes : `${existing.notes} [VALIDATED]`) : '[VALIDATED]';

    const updated = await prisma.attendance.update({
      where: { 
        id: attendanceId,
        organization_id: org.id 
      },
      data: { notes: newNotes }
    });

    res.json({ message: 'Izin/Sakit berhasil disetujui (divalidasi)', data: updated });
  } catch (error) {
    console.error('Error getting session members:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
}

// ========================
// Guest Attendance
// ========================

export const getGuests = async (req: Request, res: Response) => {
  const { orgIdOrSlug } = req.params;
  const { sessionId } = req.query;
  const orgMemberContext = (req as any).orgMember;

  try {
    const orgId = orgMemberContext?.organizationId;
    if (!orgId) {
      const org = await prisma.organizations.findFirst({
        where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
      });
      if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });
    }
    const targetOrgId = orgId || orgIdOrSlug;

    let targetSessionId = sessionId && sessionId !== 'null' ? String(sessionId) : null;
    let targetSession = null;

    if (targetSessionId) {
      targetSession = await prisma.attendance_sessions.findUnique({
        where: { id: targetSessionId },
        select: { id: true, start_time: true }
      });
    }

    if (!targetSession) {
      const now = new Date();
      // Only auto-pick sessions that are active and not older than 24 hours to prevent abandoned sessions from showing up
      targetSession = await prisma.attendance_sessions.findFirst({
        where: {
          organization_id: targetOrgId,
          is_active: true,
          start_time: { lte: now },
          end_time: { gte: now }
        },
        orderBy: { start_time: 'desc' },
        select: { id: true, start_time: true }
      });
      if (targetSession) {
        targetSessionId = targetSession.id;
      }
    }

    // Fetch guests with attendance and only leaves for targetSessionId (indexed)
    const guests = await prisma.org_guests.findMany({
      where: { organization_id: targetOrgId },
      orderBy: { name: 'asc' },
      include: targetSessionId ? ({
        guest_attendance: {
          where: { session_id: targetSessionId },
          select: { check_in_time: true, status: true }
        },
        guest_leaves: {
          where: { session_id: targetSessionId },
          select: { session_id: true, type: true, proof_url: true, created_at: true }
        }
      } as any) : undefined
    });
    
    let sessionDateStr = targetSession ? targetSession.start_time.toISOString().split('T')[0] : null;

    const formattedGuests = guests.map((guest: any) => {
      let finalStatus = guest.guest_attendance?.[0]?.status || null; // 'present' or 'late'

      if (targetSession && !finalStatus) {
        // Find if they have leave for this session
        const leave = (guest as any).guest_leaves?.find((l: any) => l.session_id === targetSession.id);
        if (leave) {
          finalStatus = leave.type; // 'izin' or 'sakit'
          if (finalStatus === 'sakit' && !leave.proof_url) {
             const ageHours = (Date.now() - new Date(leave.created_at).getTime()) / (1000 * 60 * 60);
             if (ageHours > 24) finalStatus = 'izin';
          }
        } else {
           // check if guest was created before or at session start
           if (targetSession.start_time >= guest.created_at) {
             finalStatus = 'alpha';
           }
        }
      }

      return {
        ...guest,
        check_in_time: guest.guest_attendance?.[0]?.check_in_time || null,
        status: finalStatus,
        kelas: (guest.custom_data && (guest.custom_data as any).kelas) ? (guest.custom_data as any).kelas : null,
        nfc_uid: (guest.custom_data && (guest.custom_data as any).nfc_uid) ? (guest.custom_data as any).nfc_uid : null,
        parent_phone: (guest.custom_data && (guest.custom_data as any).parent_phone) ? (guest.custom_data as any).parent_phone : null,
        parent_name: (guest.custom_data && (guest.custom_data as any).parent_name) ? (guest.custom_data as any).parent_name : null,
        gender: (guest.custom_data && (guest.custom_data as any).gender) ? (guest.custom_data as any).gender : null,
        nisn: (guest.custom_data && (guest.custom_data as any).nisn) ? (guest.custom_data as any).nisn : null,
        sekolah_asal: (guest.custom_data && (guest.custom_data as any).sekolah_asal) ? (guest.custom_data as any).sekolah_asal : null
      };
    });

    res.json(formattedGuests);
  } catch (error) {
    console.error('Error getting guests:', error);
    res.status(500).json({ error: 'Terjadi kesalahan saat memuat data tamu.' });
  }
};

export const uploadGuests = async (req: Request, res: Response) => {
  const { orgIdOrSlug } = req.params;
  const { guests } = req.body; // Array of { name, identifier }

  if (!guests || !Array.isArray(guests)) {
    return res.status(400).json({ error: 'Data tamu tidak valid.' });
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const validGuests = guests.filter(g => g.name && g.identifier);
    if (validGuests.length === 0) {
      return res.status(400).json({ error: 'Tidak ada data tamu yang valid.' });
    }

    // Deduplicate incoming payload by identifier (primary) or identifier + name
    const uniqueGuestsMap = new Map();
    validGuests.forEach(g => {
      const rawWa = (g as any).parent_phone || (g as any).no_wa_ortu || (g as any).wa_ortu || (g as any).parent_wa || (g as any).telepon_ortu || (g as any).wa;
      const cleanWa = rawWa ? normalizePhoneNumber(String(rawWa)) : null;
      const dedupeKey = `${String(g.identifier).trim().toLowerCase()}_${String(g.name).trim().toLowerCase()}`;
      uniqueGuestsMap.set(dedupeKey, { 
        name: String(g.name).trim(), 
        identifier: String(g.identifier).trim(),
        kelas: g.kelas ? String(g.kelas).trim() : null,
        nfc_uid: (g.nfc_uid || (g as any).nfc || (g as any).uid) ? String(g.nfc_uid || (g as any).nfc || (g as any).uid).trim() : null,
        parent_phone: cleanWa,
        parent_name: ((g as any).parent_name || (g as any).nama_ortu) ? String((g as any).parent_name || (g as any).nama_ortu).trim() : null,
        gender: (g as any).gender || (g as any).jk || null,
        nisn: (g as any).nisn || null,
        sekolah_asal: (g as any).sekolah_asal || null
      });
    });
    const uniqueGuests = Array.from(uniqueGuestsMap.values());

    const existingGuests = await prisma.org_guests.findMany({
      where: { organization_id: org.id },
      select: { identifier: true, name: true, id: true, custom_data: true }
    });
    
    const existingByIdentifier = new Map(existingGuests.map(g => [g.identifier.toLowerCase(), g]));
    const existingByName = new Map(existingGuests.map(g => [g.name.toLowerCase(), g]));

    const ops = uniqueGuests.map(g => {
      const existingGuest = existingByIdentifier.get(g.identifier.toLowerCase()) || existingByName.get(g.name.toLowerCase());
      
      if (existingGuest) {
        const prevCustomData = (existingGuest.custom_data as any) || {};
        const mergedCustomData = {
          ...prevCustomData,
          ...(g.kelas ? { kelas: g.kelas } : {}),
          ...(g.nfc_uid ? { nfc_uid: g.nfc_uid } : {}),
          ...(g.parent_phone ? { parent_phone: g.parent_phone } : {}),
          ...(g.parent_name ? { parent_name: g.parent_name } : {}),
          ...(g.gender ? { gender: g.gender } : {}),
          ...(g.nisn ? { nisn: g.nisn } : {}),
          ...(g.sekolah_asal ? { sekolah_asal: g.sekolah_asal } : {})
        };
        return prisma.org_guests.update({
          where: { id: existingGuest.id },
          data: { 
            name: g.name,
            identifier: g.identifier,
            custom_data: mergedCustomData
          }
        });
      } else {
        const customData: any = {};
        if (g.kelas) customData.kelas = g.kelas;
        if (g.nfc_uid) customData.nfc_uid = g.nfc_uid;
        if (g.parent_phone) customData.parent_phone = g.parent_phone;
        if (g.parent_name) customData.parent_name = g.parent_name;
        if (g.gender) customData.gender = g.gender;
        if (g.nisn) customData.nisn = g.nisn;
        if (g.sekolah_asal) customData.sekolah_asal = g.sekolah_asal;
        return prisma.org_guests.create({
          data: {
            organization_id: org.id,
            name: g.name,
            identifier: g.identifier,
            custom_data: Object.keys(customData).length > 0 ? customData : {}
          }
        });
      }
    });

    const createdGuests = await prisma.$transaction(ops);

    res.status(201).json({ message: `${createdGuests.length} data siswa/tamu berhasil disimpan.`, data: createdGuests });
  } catch (error) {
    console.error('Error uploading guests:', error);
    res.status(500).json({ error: 'Terjadi kesalahan saat menyimpan data tamu.' });
  }
};

// Hapus satu data tamu / siswa
export const deleteGuest = async (req: Request, res: Response) => {
  const { orgIdOrSlug, guestId } = req.params;

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const guest = await prisma.org_guests.findFirst({
      where: { id: guestId, organization_id: org.id }
    });
    if (!guest) return res.status(404).json({ error: 'Data siswa/tamu tidak ditemukan' });

    await prisma.org_guests.delete({
      where: { id: guest.id }
    });

    return res.json({ success: true, message: `Data siswa ${guest.name} berhasil dihapus.` });
  } catch (error) {
    console.error('Error deleting guest:', error);
    return res.status(500).json({ error: 'Gagal menghapus data siswa.' });
  }
};

// Hapus massal data tamu / siswa (semua, berdasarkan kelas, filter kartu, atau pilihan ID)
export const bulkDeleteGuests = async (req: Request, res: Response) => {
  const { orgIdOrSlug } = req.params;
  const { guestIds, deleteAll, kelas, onlyUnlinkedNfc } = req.body;

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    // Skenario 1: Hapus SEMUA data siswa di organisasi ini
    if (deleteAll === true) {
      const result = await prisma.org_guests.deleteMany({
        where: { organization_id: org.id }
      });
      return res.json({
        success: true,
        count: result.count,
        message: `Berhasil menghapus seluruh ${result.count} data siswa.`
      });
    }

    // Skenario 2: Hapus berdasarkan kelas tertentu
    if (kelas && typeof kelas === 'string') {
      const allGuests = await prisma.org_guests.findMany({
        where: { organization_id: org.id },
        select: { id: true, custom_data: true }
      });
      const matchingIds = allGuests
        .filter(g => (g.custom_data as any)?.kelas?.toLowerCase() === kelas.toLowerCase())
        .map(g => g.id);

      if (matchingIds.length === 0) {
        return res.json({ success: true, count: 0, message: `Tidak ditemukan siswa di kelas ${kelas}.` });
      }

      const result = await prisma.org_guests.deleteMany({
        where: { id: { in: matchingIds }, organization_id: org.id }
      });
      return res.json({
        success: true,
        count: result.count,
        message: `Berhasil menghapus ${result.count} data siswa di kelas ${kelas}.`
      });
    }

    // Skenario 3: Hapus siswa yang BELUM memiliki kartu NFC
    if (onlyUnlinkedNfc === true) {
      const allGuests = await prisma.org_guests.findMany({
        where: { organization_id: org.id },
        select: { id: true, custom_data: true }
      });
      const unlinkedIds = allGuests
        .filter(g => !(g.custom_data as any)?.nfc_uid)
        .map(g => g.id);

      if (unlinkedIds.length === 0) {
        return res.json({ success: true, count: 0, message: 'Semua siswa sudah memiliki kartu NFC.' });
      }

      const result = await prisma.org_guests.deleteMany({
        where: { id: { in: unlinkedIds }, organization_id: org.id }
      });
      return res.json({
        success: true,
        count: result.count,
        message: `Berhasil menghapus ${result.count} data siswa yang belum memiliki kartu NFC.`
      });
    }

    // Skenario 4: Hapus daftar ID siswa yang dipilih
    if (Array.isArray(guestIds) && guestIds.length > 0) {
      const result = await prisma.org_guests.deleteMany({
        where: { id: { in: guestIds }, organization_id: org.id }
      });
      return res.json({
        success: true,
        count: result.count,
        message: `Berhasil menghapus ${result.count} data siswa yang dipilih.`
      });
    }

    return res.status(400).json({ error: 'Parameter penghapusan tidak valid.' });
  } catch (error) {
    console.error('Error bulk deleting guests:', error);
    return res.status(500).json({ error: 'Gagal melakukan penghapusan massal data siswa.' });
  }
};

export const scanGuestQR = async (req: Request, res: Response) => {
  const { orgIdOrSlug, sessionId } = req.params;
  const { qrToken } = req.body;

  if (!qrToken) {
    return res.status(400).json({ error: 'QR Token wajib diisi.' });
  }

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const session = await prisma.attendance_sessions.findUnique({
      where: { id: sessionId.length === 36 ? sessionId : undefined }
    });

    if (!session || !session.is_active) {
      return res.status(400).json({ error: 'Sesi absen sudah tidak aktif atau tidak ditemukan.' });
    }

    const now = new Date();

    // 1. Cek apakah ini QR Anggota (Member)
    let targetProfileId: string | null = null;
    if (typeof qrToken === 'string') {
      const trimmed = qrToken.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.profileId || parsed.profile_id) {
            targetProfileId = parsed.profileId || parsed.profile_id;
          }
        } catch (e) {}
      }
      if (!targetProfileId && trimmed.toLowerCase().includes('member:')) {
        const parts = trimmed.split(':');
        targetProfileId = parts[parts.length - 1];
      }
      if (!targetProfileId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        targetProfileId = trimmed;
      }
    }

    if (targetProfileId) {
      const member = await prisma.organization_members.findFirst({
        where: {
          organization_id: org.id,
          profile_id: targetProfileId
        },
        include: {
          profile: true
        }
      });

      if (member) {
        const memberName = member.profile?.full_name || member.profile?.email || 'Anggota';
        const existingRecord = await prisma.attendance.findFirst({
          where: {
            session_id: session.id,
            profile_id: member.profile_id
          }
        });

        const hasAttendedIncoming = existingRecord && (existingRecord.status === 'present' || existingRecord.status === 'late');

        // 1. Sesi in_out: Jika sudah absen datang tapi belum absen pulang -> Catat Pulang
        if (session.session_type === 'in_out' && hasAttendedIncoming && !existingRecord.check_out_time) {
          const updated = await prisma.attendance.update({
            where: { id: existingRecord.id },
            data: {
              check_out_time: now,
              notes: existingRecord.notes ? `${existingRecord.notes} [SCAN_QR PULANG]` : '[SCAN_QR PULANG]'
            } as any
          });
          return res.status(200).json({
            message: `Absen Pulang berhasil dicatat untuk ${memberName}!`,
            data: updated,
            attendeeType: 'member',
            isCheckOut: true,
            status: 'checkout',
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        }

        // 2. Sesi in_out: Jika sudah menyelesaikan datang dan pulang
        if (session.session_type === 'in_out' && existingRecord?.check_out_time) {
          return res.status(200).json({
            message: `${memberName} sudah menyelesaikan presensi Datang & Pulang.`,
            data: existingRecord,
            attendeeType: 'member',
            alreadyRecorded: true,
            isCheckOut: true,
            status: 'checkout',
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        }

        // Tentukan status Datang (Hadir atau Terlambat)
        let status: 'present' | 'late' = 'present';
        if (session.late_time && now > new Date(session.late_time)) {
          status = 'late';
        }

        // 3. Jika sebelumnya tercatat Alpa (absent) atau Izin/Sakit, sekarang siswa hadir scan kartu -> Update ke Hadir/Telat
        if (existingRecord && (existingRecord.status === 'absent' || existingRecord.status === 'excused' || existingRecord.status === 'sick')) {
          const prevStatus = existingRecord.status;
          const updated = await prisma.attendance.update({
            where: { id: existingRecord.id },
            data: {
              status,
              check_in_time: now,
              notes: existingRecord.notes ? `${existingRecord.notes} [SCAN_QR HADIR (DARI ${prevStatus.toUpperCase()})]` : `[SCAN_QR HADIR (DARI ${prevStatus.toUpperCase()})]`
            } as any
          });
          return res.status(200).json({
            message: `Presensi berhasil: ${memberName} (${status === 'late' ? 'Terlambat' : 'Hadir'}) - status diperbarui dari ${prevStatus}`,
            data: updated,
            attendeeType: 'member',
            isCheckIn: true,
            status,
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        }

        // 4. Jika sudah tercatat Hadir / Terlambat sebelumnya (lewat roll call manual atau scan lain)
        if (existingRecord && (existingRecord.status === 'present' || existingRecord.status === 'late')) {
          const timeStr = existingRecord.check_in_time ? new Date(existingRecord.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
          return res.status(200).json({
            message: `${memberName} sudah tercatat ${existingRecord.status === 'late' ? 'Terlambat' : 'Hadir'} sebelumnya (Pukul ${timeStr} WIB).`,
            data: existingRecord,
            attendeeType: 'member',
            alreadyRecorded: true,
            status: existingRecord.status,
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        }

        // 5. Belum ada data presensi sama sekali -> Buat baru (Create)
        try {
          const newRecord = await prisma.attendance.create({
            data: {
              organization_id: org.id,
              profile_id: member.profile_id,
              session_id: session.id,
              status,
              check_in_time: now,
              notes: '[SCAN_QR DATANG]'
            } as any
          });

          return res.status(200).json({
            message: `Presensi berhasil: ${memberName} (${status === 'late' ? 'Terlambat' : 'Hadir'})`,
            data: newRecord,
            attendeeType: 'member',
            isCheckIn: true,
            status,
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        } catch (createErr: any) {
          // Jika terjadi race condition konkuren, ambil data yang sudah dibuat
          const existingAfter = await prisma.attendance.findFirst({
            where: { session_id: session.id, profile_id: member.profile_id }
          });
          return res.status(200).json({
            message: `${memberName} sudah tercatat hadir.`,
            data: existingAfter,
            attendeeType: 'member',
            alreadyRecorded: true,
            status: existingAfter?.status || status,
            member: {
              id: member.id,
              name: memberName,
              role: member.role
            }
          });
        }
      }
    }

    // 2. Jika bukan QR Anggota, proses sebagai Tamu / Siswa Luar
    let guest = null;
    if (qrToken.length === 36) {
      guest = await prisma.org_guests.findFirst({
        where: {
          organization_id: org.id,
          OR: [{ qr_token: qrToken }, { identifier: qrToken }]
        }
      });
    } else {
      guest = await prisma.org_guests.findFirst({
        where: {
          organization_id: org.id,
          identifier: qrToken
        }
      });
    }

    // Jika tidak ditemukan dengan exact match, coba cari substring (ID ada di dalam raw string QR)
    if (!guest) {
      const allGuests = await prisma.org_guests.findMany({
        where: { organization_id: org.id },
        select: { id: true, identifier: true, qr_token: true }
      });
      
      // Sort berdasarkan panjang identifier (terpanjang lebih dulu) untuk menghindari partial match ID pendek
      allGuests.sort((a, b) => b.identifier.length - a.identifier.length);

      const matchedPartial = allGuests.find(g => qrToken.includes(g.identifier));
      if (matchedPartial) {
        guest = await prisma.org_guests.findUnique({ where: { id: matchedPartial.id } });
      }
    }

    if (!guest) {
      return res.status(404).json({ error: 'QR Code tidak terdaftar sebagai Anggota maupun Tamu organisasi ini.' });
    }

    const existingCheckin = await prisma.guest_attendance.findFirst({
      where: {
        session_id: sessionId,
        guest_id: guest.id
      }
    });

    if (existingCheckin) {
      return res.status(200).json({
        message: `${guest.name} (Tamu) sudah tercatat check-in sebelumnya.`,
        data: existingCheckin,
        attendeeType: 'guest',
        alreadyRecorded: true,
        status: existingCheckin.status
      });
    }

    try {
      const updatedGuest = await prisma.guest_attendance.create({
        data: {
          session_id: sessionId,
          guest_id: guest.id,
          status: 'present',
          check_in_time: now
        }
      });

      // Notifikasi WA Orang Tua (asinkron non-blocking)
      sendAttendanceNotification(
        org.id,
        {
          id: guest.id,
          name: guest.name,
          identifier: guest.identifier,
          parentPhone: (guest.custom_data as any)?.parent_phone,
          kelas: (guest.custom_data as any)?.kelas
        },
        'masuk',
        'Tepat Waktu',
        now
      ).catch(e => console.error('[WA QR notify error]', e));

      return res.status(200).json({ 
        message: `Berhasil check-in: ${guest.name} (Tamu/Peserta)`, 
        data: updatedGuest,
        attendeeType: 'guest'
      });
    } catch (guestErr: any) {
      return res.status(200).json({ 
        message: `${guest.name} (Tamu) sudah tercatat check-in sebelumnya.`, 
        data: existingCheckin,
        attendeeType: 'guest',
        alreadyRecorded: true
      });
    }
  } catch (error) {
    console.error('Error scanning attendance QR:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan saat scan QR.' });
  }
};
export const getGuestStats = async (req: Request, res: Response) => {
  const { orgIdOrSlug, sessionId } = req.params;

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const session = await prisma.attendance_sessions.findUnique({
      where: { id: sessionId }
    });
    if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

    // Total guests in this organization
    const totalGuests = await prisma.org_guests.count({
      where: { organization_id: org.id }
    });

    // Count present and late guests for this session
    const guestAttendance = await prisma.guest_attendance.groupBy({
      by: ['status'],
      where: { session_id: sessionId },
      _count: { status: true }
    });

    let tepatCount = 0;
    let terlambatCount = 0;

    guestAttendance.forEach(item => {
      if (item.status === 'present') tepatCount += item._count.status;
      if (item.status === 'late') terlambatCount += item._count.status;
    });

    const alphaCount = Math.max(0, totalGuests - tepatCount - terlambatCount);
    const presentPercentage = totalGuests > 0 ? Math.round(((tepatCount + terlambatCount) / totalGuests) * 100) : 0;

    return res.json({
      sessionTitle: session.title,
      stats: {
        total: totalGuests,
        tepat: tepatCount,
        terlambat: terlambatCount,
        alpha: alphaCount,
        percentage: presentPercentage
      }
    });

  } catch (error) {
    console.error('Error getting guest stats:', error);
    res.status(500).json({ error: 'Gagal memuat statistik tamu' });
  }
};

export const getGuestAnalytics = async (req: Request, res: Response) => {
  const { orgIdOrSlug } = req.params;

  try {
    const org = await prisma.organizations.findFirst({
      where: { OR: [{ id: orgIdOrSlug.length === 36 ? orgIdOrSlug : undefined }, { slug: orgIdOrSlug }] }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    // 1. Total Guests
    const totalGuests = await prisma.org_guests.count({
      where: { organization_id: org.id }
    });

    // 2. Fetch all sessions to calculate applicable sessions per guest
    const allSessions = await prisma.attendance_sessions.findMany({
      where: { organization_id: org.id },
      select: { id: true, start_time: true }
    });
    const totalSessions = allSessions.length;

    // 3. Guest Stats per Guest
    const allGuests = await prisma.org_guests.findMany({
      where: { organization_id: org.id },
      include: ({
        guest_attendance: {
          select: { status: true, session_id: true }
        },
        guest_leaves: true
      } as any),
      orderBy: { name: 'asc' }
    });

    let overallTepat = 0;
    let overallTerlambat = 0;
    let overallIzin = 0;
    let overallSakit = 0;
    let overallAlpha = 0;

    const guestList = allGuests.map(guest => {
      let tepat = 0;
      let terlambat = 0;
      const attendedSessionIds = new Set<string>();
      
      (guest as any).guest_attendance.forEach((att: any) => {
        if (att.status === 'present') {
          tepat++;
          attendedSessionIds.add(att.session_id);
        }
        if (att.status === 'late') {
          terlambat++;
          attendedSessionIds.add(att.session_id);
        }
      });

      const now = new Date();
      const applicableSessions = allSessions.filter(s => s.start_time <= now && s.start_time >= guest.created_at);
      
      let izin = 0;
      let sakit = 0;
      const leavesBySession = new Map<string, any>();
      (guest as any).guest_leaves.forEach((leave: any) => leavesBySession.set(leave.session_id, leave));

      applicableSessions.forEach((session: any) => {
        if (!attendedSessionIds.has(session.id)) {
          const leave = leavesBySession.get(session.id);
          if (leave) {
            let finalType = leave.type;
            if (finalType === 'sakit' && !leave.proof_url) {
              const ageHours = (Date.now() - new Date(leave.created_at).getTime()) / (1000 * 60 * 60);
              if (ageHours > 24) finalType = 'izin';
            }
            if (finalType === 'sakit') sakit++;
            else izin++;
          }
        }
      });

      const totalLeaves = izin + sakit;

      overallTepat += tepat;
      overallTerlambat += terlambat;
      overallIzin += izin;
      overallSakit += sakit;

      const alpha = Math.max(0, applicableSessions.length - (tepat + terlambat + totalLeaves));
      
      let percentage = 0;
      if (applicableSessions.length > 0) {
        percentage = Math.min(100, Math.round(((tepat + terlambat) / applicableSessions.length) * 100));
      }
      
      overallAlpha += alpha;

      return {
        id: guest.id,
        name: guest.name,
        identifier: guest.identifier,
        kelas: ((guest as any).custom_data && (guest as any).custom_data.kelas) ? (guest as any).custom_data.kelas : null,
        stats: { tepat, terlambat, izin, sakit, alpha, percentage }
      };
    });

    // 4. Daily Trend (last 7 days of guest_attendance)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAttendance = await prisma.guest_attendance.findMany({
      where: {
        session: { organization_id: org.id },
        created_at: { gte: sevenDaysAgo }
      },
      select: {
        status: true,
        created_at: true
      }
    });

    // Group by date (YYYY-MM-DD)
    const dailyData: Record<string, { tepat: number, terlambat: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dailyData[dateStr] = { tepat: 0, terlambat: 0 };
    }

    recentAttendance.forEach(att => {
      const dateStr = att.created_at.toISOString().split('T')[0];
      if (dailyData[dateStr]) {
        if (att.status === 'present') dailyData[dateStr].tepat++;
        if (att.status === 'late') dailyData[dateStr].terlambat++;
      }
    });

    const dailyTrend = Object.keys(dailyData).map(date => ({
      date,
      tepat: dailyData[date].tepat,
      terlambat: dailyData[date].terlambat
    }));

    return res.json({
      overall: {
        totalGuests,
        totalSessions,
        tepat: overallTepat,
        terlambat: overallTerlambat,
        izin: overallIzin,
        sakit: overallSakit,
        alpha: overallAlpha
      },
      dailyTrend,
      guestList
    });

  } catch (error) {
    console.error('Error getting guest analytics:', error);
    res.status(500).json({ error: 'Gagal memuat analitik tamu' });
  }
};

// 2. Get Active Session (We define active as is_active=true AND now() < end_time)
export async function getActiveSession(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    let session = null;
    if (sessionId && sessionId !== 'null') {
      session = await prisma.attendance_sessions.findFirst({
        where: { id: sessionId.length === 36 ? sessionId : undefined }
      });
    } else {
      // Find the first currently ongoing session
      const now = new Date();
      session = await prisma.attendance_sessions.findFirst({
        where: {
          organization_id: orgMemberContext.organizationId,
          is_active: true,
          start_time: { lte: now },
          end_time: { gte: now }
        },
        orderBy: { start_time: 'asc' }
      });
    }

    return res.status(200).json(session);
  } catch (err) {
    console.error('Error getting active session:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 3. Close Session
export async function closeSession(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    const session = await prisma.attendance_sessions.update({
      where: { id: sessionId.length === 36 ? sessionId : undefined },
      data: {
        is_active: false,
        closed_at: new Date()
      }
    });

    return res.status(200).json(session);
  } catch (err) {
    console.error('Error closing session:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 3B. Delete Session (Hapus agenda agar tidak dihitung alpa bila salah buat)
export async function deleteSession(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang bisa menghapus sesi agenda presensi' });
  }

  try {
    const session = await prisma.attendance_sessions.findFirst({
      where: {
        id: sessionId.length === 36 ? sessionId : undefined,
        organization_id: orgMemberContext.organizationId
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Sesi agenda presensi tidak ditemukan atau bukan milik organisasi ini' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.guest_leaves.deleteMany({ where: { session_id: session.id } });
      await tx.guest_attendance.deleteMany({ where: { session_id: session.id } });
      await tx.meeting_minutes.deleteMany({ where: { session_id: session.id } });
      await tx.attendance.deleteMany({ where: { session_id: session.id } });
      await tx.attendance_sessions.delete({ where: { id: session.id } });
    });

    return res.status(200).json({
      success: true,
      message: `Sesi "${session.title}" berhasil dihapus. Data alpa anggota telah dihitung ulang.`
    });
  } catch (err: any) {
    console.error('Error deleting session:', err);
    return res.status(500).json({ error: 'Gagal menghapus sesi agenda presensi' });
  }
}

// 4. Check-In (and Check-Out) with GPS and PIN
export async function checkIn(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const userId = req.user?.id;
  let { pin, latitude, longitude, accuracy, status, proof_url, notes } = req.body;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    let activeSession: any = null;

    if (status === 'present') {
      activeSession = await prisma.attendance_sessions.findFirst({
        where: {
          AND: [
            {
              OR: [
                { organization_id: orgMemberContext.organizationId },
                { shared_with_orgs: { has: orgMemberContext.organizationId } }
              ]
            },
            {
              OR: [
                { pin_code: pin },
                { checkout_pin_code: pin }
              ]
            }
          ],
          is_active: true
        }
      });
      if (!activeSession) {
        return res.status(404).json({ error: 'Sesi presensi tidak ditemukan atau sudah ditutup (atau PIN salah)' });
      }
    } else {
      if (!req.body.session_id) {
         return res.status(400).json({ error: 'Pilih agenda/sesi terlebih dahulu' });
      }
      activeSession = await prisma.attendance_sessions.findFirst({
        where: {
          id: req.body.session_id,
          OR: [
            { organization_id: orgMemberContext.organizationId },
            { shared_with_orgs: { has: orgMemberContext.organizationId } }
          ]
        }
      });
      if (!activeSession) {
        return res.status(404).json({ error: 'Agenda tidak ditemukan' });
      }
    }

    const now = new Date();

    if (now > activeSession.end_time) {
      return res.status(400).json({ error: 'Sesi presensi ini sudah berakhir' });
    }

    if (status === 'present' && now < activeSession.start_time) {
      return res.status(400).json({ error: 'Sesi presensi ini belum dimulai' });
    }

    const isCheckOutAttempt = Boolean(pin) && activeSession.checkout_pin_code === pin;

    if (isCheckOutAttempt && activeSession.session_type !== 'in_out') {
      return res.status(400).json({ error: 'PIN tidak valid untuk sesi ini' });
    }

    const existing: any = await prisma.attendance.findFirst({
      where: {
        session_id: activeSession.id,
        profile_id: userId
      }
    });

    let distance_meters = null;
    let finalStatus = status || 'present';

    // --- LOGIKA ABSEN PULANG ---
    if (isCheckOutAttempt) {
      if (activeSession.checkout_start_time && now < activeSession.checkout_start_time) {
        return res.status(400).json({ error: 'Waktu absen pulang belum dimulai. Silakan coba lagi nanti.' });
      }

      if (!existing) {
        return res.status(400).json({ error: 'Anda belum absen datang. Silakan absen datang terlebih dahulu.' });
      }
      if (existing.check_out_time) {
        return res.status(200).json({
          message: 'Anda sudah melakukan absen pulang sebelumnya.',
          record: existing,
          alreadyRecorded: true,
          isCheckOut: true
        });
      }

      // Validasi GPS untuk Pulang (Sekarang Opsional)
      if (latitude != null && longitude != null) {
        distance_meters = calculateDistance(activeSession.latitude, activeSession.longitude, latitude, longitude);
      }

      const updatedRecord = await prisma.attendance.update({
        where: { id: existing.id },
        data: { check_out_time: now } as any
      });
      
      return res.status(200).json({ message: 'Absen pulang berhasil dicatat', record: updatedRecord, isCheckOut: true });
    } 
    
    // --- LOGIKA ABSEN DATANG ---
    else {
      if (existing) {
        // 1. Jika sudah tercatat hadir atau terlambat sebelumnya
        if (existing.status === 'present' || existing.status === 'late') {
          const timeStr = existing.check_in_time ? new Date(existing.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
          return res.status(200).json({
            message: `Anda sudah tercatat ${existing.status === 'late' ? 'Terlambat' : 'Hadir'} sebelumnya (Pukul ${timeStr} WIB).`,
            record: existing,
            alreadyRecorded: true,
            status: existing.status
          });
        }

        // 2. Jika sebelumnya tercatat Alpa (absent) dan sekarang member absen datang dengan PIN valid
        if (finalStatus === 'present' && existing.status === 'absent') {
          if (latitude != null && longitude != null) {
            distance_meters = calculateDistance(activeSession.latitude, activeSession.longitude, latitude, longitude);
          }
          if (activeSession.late_time && now > activeSession.late_time) {
            finalStatus = 'late';
          }
          const updatedRecord = await prisma.attendance.update({
            where: { id: existing.id },
            data: {
              status: finalStatus,
              check_in_time: now,
              latitude: latitude || null,
              longitude: longitude || null,
              distance_meters,
              notes: existing.notes ? `${existing.notes} [CHECKIN_MEMBER: Transisi dari alpa]` : `[CHECKIN_MEMBER: Transisi dari alpa]`
            } as any
          });
          return res.status(200).json({
            message: `Presensi berhasil diperbarui menjadi ${finalStatus === 'late' ? 'Terlambat' : 'Hadir'}.`,
            record: updatedRecord,
            status: finalStatus
          });
        }

        // 3. Jika tercatat sakit/izin dan mencoba check-in biasa
        if (existing.status === 'excused' || existing.status === 'sick') {
          return res.status(400).json({
            error: `Anda sudah tercatat ${existing.status === 'excused' ? 'Izin' : 'Sakit'}. Hubungi ketua/sekretaris jika hadir langsung.`
          });
        }

        return res.status(400).json({ error: 'Anda sudah melakukan absen/izin untuk sesi ini.' });
      }

      if (finalStatus === 'present') {
        // Validasi GPS untuk Datang (Sekarang Opsional)
        if (latitude != null && longitude != null) {
          distance_meters = calculateDistance(activeSession.latitude, activeSession.longitude, latitude, longitude);
        }
        
        if (activeSession.late_time && now > activeSession.late_time) {
          finalStatus = 'late';
        }
      } else if (finalStatus === 'sick') {
        // Anggota bisa mengajukan sakit tanpa surat dengan batas susulan 1x24 jam
        if (!proof_url && !notes) {
          notes = 'Sakit (Menunggu surat dokter maks 1x24 jam)';
        }
      } else if (finalStatus === 'excused') {
        if (!proof_url && !notes) {
          notes = 'Izin';
        }
      }

      try {
        const record = await prisma.attendance.create({
          data: {
            organization_id: orgMemberContext.organizationId,
            profile_id: userId,
            session_id: activeSession.id,
            status: finalStatus as any,
            notes: notes || null,
            proof_url: proof_url || null,
            latitude: latitude || null,
            longitude: longitude || null,
            distance_meters
          } as any
        });

        const successMsg = (finalStatus === 'sick' || finalStatus === 'excused')
          ? 'Data izin/sakit berhasil dikirim'
          : 'Absen datang berhasil dicatat';

        return res.status(201).json({ message: successMsg, record, status: finalStatus });
      } catch (createErr: any) {
        // Proteksi race-condition jika record dibuat di detik yang persis sama lewat scan QR pengurus
        if (createErr.code === 'P2002') {
          const recordAfter = await prisma.attendance.findFirst({
            where: { session_id: activeSession.id, profile_id: userId }
          });
          return res.status(200).json({
            message: `Anda sudah tercatat pada sesi ini.`,
            record: recordAfter,
            alreadyRecorded: true,
            status: recordAfter?.status || finalStatus
          });
        }
        throw createErr;
      }
    }

  } catch (err) {
    console.error('Error checking in/out:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 5. Mengambil Daftar Rekam Jejak Kehadiran (Akses: Semua Anggota)
export async function getAttendanceRecords(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
    const { sessionId, status } = req.query;

    if (!orgMemberContext) {
      return res.status(403).json({ error: 'Akses organisasi dibatasi' });
    }

    try {
      // Jalankan sweep status di background secara non-blocking
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma.attendance.updateMany({
        where: {
          organization_id: orgMemberContext.organizationId,
          status: 'sick',
          proof_url: null,
          check_in_time: { lte: twentyFourHoursAgo }
        },
        data: {
          status: 'excused'
        }
      }).catch(err => console.error('[AttendanceSweep Background Error]:', err));

      const whereClause: any = {
        organization_id: orgMemberContext.organizationId
      };

      if (sessionId) {
        whereClause.session_id = sessionId;
      }

      if (status) {
        if (typeof status === 'string' && status.includes(',')) {
          whereClause.status = { in: status.split(',').map((s: string) => s.trim()) };
        } else {
          whereClause.status = status;
        }
      }

    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const records = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        profile: {
          select: { full_name: true, email: true }
        },
        session: {
          select: { session_type: true, title: true }
        }
      },
      orderBy: {
        check_in_time: 'desc'
      },
      take: limitParam ? Math.min(limitParam, 500) : 200
    });

    return res.status(200).json(records);
  } catch (err) {
    console.error('Error fetching attendance records:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 6. Get Attendance Stats (For Secretary Dashboard)
export async function getAttendanceStats(req: any, res: Response) {
  const orgMemberContext = req.orgMember;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' });
  }

  try {
    const totalSessions = await prisma.attendance_sessions.count({
      where: { organization_id: orgMemberContext.organizationId }
    });

    // Leaderboard (Present) & Zona Merah (Absent or Late)
    const [attendanceStats, redZoneStats] = await Promise.all([
      prisma.attendance.groupBy({
        by: ['profile_id'],
        where: { 
          organization_id: orgMemberContext.organizationId,
          status: 'present'
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      }),
      prisma.attendance.groupBy({
        by: ['profile_id'],
        where: { 
          organization_id: orgMemberContext.organizationId,
          status: { in: ['absent', 'late'] }
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10
      })
    ]);

    // Batch query seluruh profil sekaligus (Eliminasi N+1 roundtrips)
    const profileIds = Array.from(new Set([
      ...attendanceStats.map(s => s.profile_id),
      ...redZoneStats.map(s => s.profile_id)
    ]));

    const profiles = profileIds.length > 0 ? await prisma.profiles.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, full_name: true, email: true }
    }) : [];

    const profileMap = new Map(profiles.map(p => [p.id, p]));

    const enrichedStats = attendanceStats.map(stat => ({
      ...stat,
      profile: profileMap.get(stat.profile_id) || { full_name: 'Anggota', email: '' }
    }));

    const enrichedRedZone = redZoneStats.map(stat => ({
      ...stat,
      profile: profileMap.get(stat.profile_id) || { full_name: 'Anggota', email: '' }
    }));

    return res.status(200).json({ 
      totalSessions, 
      leaderboard: enrichedStats,
      red_zone: enrichedRedZone 
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 9. Get Agenda (Active & Upcoming sessions for Members)
export async function getAgenda(req: any, res: Response) {
  const orgMemberContext = req.orgMember;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' });
  }

  try {
    // Jalankan pemeriksaan jadwal otomatis di background secara non-blocking
    ensureTodayScheduledSessions(orgMemberContext.organizationId).catch(err => {
      console.error('[SessionSync Background Error]:', err);
    });

    const now = new Date();
    // Get ongoing or upcoming active sessions
    const sessions = await prisma.attendance_sessions.findMany({
      where: {
        is_active: true,
        OR: [
          { organization_id: orgMemberContext.organizationId },
          { shared_with_orgs: { has: orgMemberContext.organizationId } }
        ],
        AND: [
          {
            OR: [
              { start_time: { gte: now } },
              { end_time: { gte: now } }
            ]
          }
        ]
      },
      orderBy: { start_time: 'asc' }
    });

    return res.status(200).json(sessions);
  } catch (err) {
    console.error('Error fetching agenda:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 10. Get Personal Attendance History (Akses: Semua Anggota)
export async function getMyAttendanceHistory(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const userId = req.user?.id;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' });
  }

  try {
    // Sweep status sakit pribadi tanpa surat yang melewati 1x24 jam secara non-blocking di background
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.attendance.updateMany({
      where: {
        organization_id: orgMemberContext.organizationId,
        profile_id: userId,
        status: 'sick',
        proof_url: null,
        check_in_time: { lte: twentyFourHoursAgo }
      },
      data: {
        status: 'excused'
      }
    }).catch(err => {
      console.error('[PersonalSickSweep Error]:', err);
    });

    const records = await prisma.attendance.findMany({
      where: {
        organization_id: orgMemberContext.organizationId,
        profile_id: userId
      },
      include: {
        session: {
          select: { 
            title: true,
            start_time: true,
            end_time: true,
            session_type: true 
          }
        }
      },
      orderBy: {
        check_in_time: 'desc'
      }
    });

    // Hitung statistik
    let stats = {
      present: 0,
      late: 0,
      absent: 0,
      sick: 0,
      excused: 0
    };

    records.forEach(record => {
      if (record.status === 'present') stats.present++;
      else if (record.status === 'late') stats.late++;
      else if (record.status === 'absent') stats.absent++;
      else if ((record.status as string) === 'sick') stats.sick++;
      else if ((record.status as string) === 'excused') stats.excused++;
    });

    return res.status(200).json({ records, stats });
  } catch (err) {
    console.error('Error fetching personal attendance history:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// 10b. Update Bukti Surat Susulan (Misal: Surat Sakit dalam batas 1x24 jam)
export async function updateAttendanceProof(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const userId = req.user?.id;
  const { attendanceId } = req.params;
  const { proof_url, notes } = req.body;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' });
  }

  if (!proof_url) {
    return res.status(400).json({ error: 'File bukti surat keterangan wajib diunggah' });
  }

  try {
    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { session: true }
    });

    if (!attendance) {
      return res.status(404).json({ error: 'Data kehadiran tidak ditemukan' });
    }

    const isOwner = attendance.profile_id === userId;
    const isAdmin = ['head', 'vice_head', 'sekretaris'].includes(orgMemberContext.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Anda hanya dapat mengunggah bukti untuk presensi Anda sendiri' });
    }

    const now = new Date();
    const rawTime = attendance.check_in_time || attendance.created_at;
    const checkInTime = rawTime ? new Date(rawTime) : now;
    const ageHours = (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);

    let updatedStatus = attendance.status;

    // Jika status sakit atau sebelumnya terkonversi ke izin karena batas waktu:
    // Kembalikan ke status 'sick' asalkan dalam 24 jam atau dibantu oleh admin
    if (attendance.status === 'sick' || (attendance.status === 'excused' && attendance.notes?.includes('CONVERTED_TO_EXCUSED'))) {
      if (ageHours <= 24 || isAdmin) {
        updatedStatus = 'sick';
      }
    }

    let cleanNotes = (attendance.notes || '')
      .replace(/\[MENUNGGU_SURAT_24JAM\]/g, '')
      .replace(/\[CONVERTED_TO_EXCUSED[^\]]*\]/g, '')
      .replace(/Sakit \(Menunggu surat dokter maks 1x24 jam\)/g, 'Sakit')
      .trim();

    if (notes && notes.trim()) {
      cleanNotes = cleanNotes ? `${cleanNotes} - ${notes.trim()}` : notes.trim();
    }

    const updated = await prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        proof_url,
        status: updatedStatus,
        notes: cleanNotes || null
      }
    });

    return res.status(200).json({
      message: 'Surat bukti berhasil diunggah',
      data: updated
    });
  } catch (err) {
    console.error('Error updating attendance proof:', err);
    return res.status(500).json({ error: 'Gagal memperbarui bukti kehadiran' });
  }
}

// 11. Manual Bulk Check-In (Bantu Absen oleh Head/Sekretaris/Delegasi)
export async function manualBulkCheckIn(req: any, res: Response) {
  const orgMemberContext = req.orgMember;
  const { sessionId } = req.params;
  const { profileIds, pin } = req.body;

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    // Cek authorization: harus head, sekretaris, atau memiliki custom_data.can_take_attendance = true
    const callerMembership = await prisma.organization_members.findUnique({
      where: {
        organization_id_profile_id: {
          organization_id: orgMemberContext.organizationId,
          profile_id: req.user.id
        }
      }
    });

    const customData = callerMembership?.custom_data as any;
    const canDelegate = customData?.can_take_attendance === true;

    if (callerMembership?.role !== 'head' && callerMembership?.role !== 'vice_head' && callerMembership?.role !== 'sekretaris' && !canDelegate) {
      return res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki wewenang untuk mengambil presensi' });
    }

    if (!profileIds || !Array.isArray(profileIds) || profileIds.length === 0) {
      return res.status(400).json({ error: 'Daftar anggota yang akan dipresensikan kosong' });
    }

    const session = await prisma.attendance_sessions.findUnique({
      where: { id: sessionId.length === 36 ? sessionId : undefined }
    });

    if (!session) {
      return res.status(404).json({ error: 'Sesi presensi tidak ditemukan' });
    }

    const validOrgs = [session.organization_id, ...(session.shared_with_orgs || [])];
    if (!validOrgs.includes(orgMemberContext.organizationId)) {
      return res.status(403).json({ error: 'Akses ditolak: Anda bukan bagian dari sesi presensi ini' });
    }

    // Handle Revoke / Cabut Kehadiran (Kembalikan ke status Belum Hadir)
    if (req.body.action === 'revoke' || req.body.status === 'unmarked') {
      const deleteResult = await prisma.attendance.deleteMany({
        where: {
          session_id: session.id,
          profile_id: { in: profileIds }
        }
      });
      return res.status(200).json({
        message: `Kehadiran ${deleteResult.count} anggota berhasil dicabut.`,
        action: 'revoke',
        revokedCount: deleteResult.count,
        profileIds
      });
    }

    const isExcusedOrSick = req.body.status === 'excused' || req.body.status === 'sick' || req.body.status === 'absent';
    let isCheckOut = req.body.isCheckOut === true || req.body.type === 'checkout';

    // Jika admin menyertakan PIN, kita tetap validasi apakah ini check-out
    if (pin && session.session_type === 'in_out' && session.checkout_pin_code === pin) {
      isCheckOut = true;
    }

    const now = new Date();
    
    // Tentukan status: jika dicatat hadir, sistem mengecek batas waktu telat sesi secara otomatis (kalau lewat, otomatis Telat)
    let computedStatus: 'present' | 'late' | 'excused' | 'sick' | 'absent' = 'present';
    if (req.body.status === 'present' || !req.body.status) {
      if (session.late_time && now > new Date(session.late_time)) {
        computedStatus = 'late';
      } else {
        computedStatus = 'present';
      }
    } else if (['late', 'excused', 'sick', 'absent'].includes(req.body.status)) {
      computedStatus = req.body.status;
    }

    const adminIdentifier = req.user?.email || req.user?.id || 'admin';
    const auditNote = `[MANUAL_BY_ADMIN: ${adminIdentifier}]`;
      
    const results = [];
    let failedCount = 0;
    let lockedCount = 0;

    for (const pid of profileIds) {
      // Cari asal organisasi member ini (di antara validOrgs)
      const memberOrg = await prisma.organization_members.findFirst({
        where: {
          profile_id: pid,
          organization_id: { in: validOrgs }
        }
      });
      const memberOrgId = memberOrg ? memberOrg.organization_id : orgMemberContext.organizationId;

      const existing = await prisma.attendance.findFirst({
        where: { session_id: session.id, profile_id: pid }
      });

      // Proteksi anggota yang izin atau sakit secara mandiri (terkunci otomatis), kecuali jika admin menentukan status eksplisit
      if (existing && (existing.status === 'excused' || existing.status === 'sick') && !req.body.status) {
        lockedCount++;
        continue;
      }

      if (isCheckOut) {
        // Harus sudah absen datang dulu
        if (!existing) {
          failedCount++;
          continue;
        }
        // Kalau sudah absen pulang, lewati
        if (existing.check_out_time) {
          continue;
        }
        const updated = await prisma.attendance.update({
          where: { id: existing.id },
          data: { 
            check_out_time: now, 
            notes: existing.notes ? `${existing.notes} [PULANG BY ADMIN: ${adminIdentifier}]` : `[PULANG BY ADMIN: ${adminIdentifier}]` 
          } as any
        });
        results.push(updated);
      } else {
        // Absen Datang / Update Status
        if (!existing) {
          try {
            const record = await prisma.attendance.create({
              data: {
                organization_id: memberOrgId,
                profile_id: pid,
                session_id: session.id,
                status: computedStatus,
                notes: auditNote,
                check_in_time: now
              } as any
            });
            results.push(record);
          } catch (createErr: any) {
            if (createErr.code === 'P2002') {
              const conflictExisting = await prisma.attendance.findFirst({
                where: { session_id: session.id, profile_id: pid }
              });
              if (conflictExisting) {
                const updated = await prisma.attendance.update({
                  where: { id: conflictExisting.id },
                  data: {
                    status: computedStatus,
                    notes: conflictExisting.notes ? `${conflictExisting.notes} ${auditNote}` : auditNote
                  } as any
                });
                results.push(updated);
              }
            } else {
              throw createErr;
            }
          }
        } else {
          // Update status oleh admin
          const updated = await prisma.attendance.update({
            where: { id: existing.id },
            data: {
              status: computedStatus,
              notes: existing.notes ? `${existing.notes} ${auditNote}` : auditNote,
              check_in_time: existing.check_in_time || now
            } as any
          });
          results.push(updated);
        }
      }
    }

    const statusLabel = computedStatus === 'excused' ? 'Izin' : computedStatus === 'sick' ? 'Sakit' : computedStatus === 'late' ? 'Telat' : computedStatus === 'absent' ? 'Alpa' : 'Hadir';
    let msg = `Berhasil mencatat ${results.length} anggota (${statusLabel}).`;
    if (lockedCount > 0) {
      msg += ` ${lockedCount} anggota dilewati karena Izin/Sakit.`;
    }
    if (failedCount > 0) {
      msg += ` ${failedCount} gagal karena belum absen datang.`;
    }

    return res.status(200).json({ 
      message: msg, 
      records: results,
      computedStatus,
      isCheckOut,
      lockedCount
    });
  } catch (err) {
    console.error('Error manual bulk check-in:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// ==========================================
// SISTEM PRESENSI NFC & KIOSK GERBANG SEKOLAH
// ==========================================

// 1. Tautkan Kartu NFC ke Siswa (org_guests) atau Anggota (organization_members)
export async function linkNfcCard(req: any, res: Response) {
  const { orgIdOrSlug } = req.params;
  const rawUid = req.body.nfcUid || req.body.nfc_uid || req.body.uid;
  const rawTargetType = req.body.targetType || (req.body.guest_id || req.body.guestId ? 'guest' : req.body.member_id || req.body.memberId ? 'member' : undefined);
  const rawTargetId = req.body.targetId || req.body.guest_id || req.body.guestId || req.body.member_id || req.body.memberId;
  const force = Boolean(req.body.force);

  if (!rawUid || typeof rawUid !== 'string' || !rawUid.trim()) {
    return res.status(400).json({ error: 'Nomor UID kartu NFC wajib diisi.' });
  }
  if (!rawTargetId || !rawTargetType) {
    return res.status(400).json({ error: 'Target siswa/anggota wajib dipilih.' });
  }

  const cleanUid = String(rawUid).trim();
  const targetId = String(rawTargetId).trim();
  const targetType = String(rawTargetType).trim();

  try {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const org = await prisma.organizations.findFirst({
      where: isId ? { id: orgIdOrSlug } : { slug: orgIdOrSlug },
      select: { id: true, name: true }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    // Cek apakah UID sudah digunakan oleh siswa lain di organisasi ini
    const guests = await prisma.org_guests.findMany({
      where: { organization_id: org.id },
      select: { id: true, name: true, custom_data: true }
    });
    const conflictGuest = guests.find((g: any) => {
      if (targetType === 'guest' && g.id === targetId) return false;
      const cd = (g.custom_data as any) || {};
      return cd.nfc_uid && String(cd.nfc_uid).toLowerCase() === cleanUid.toLowerCase();
    });

    const members = await prisma.organization_members.findMany({
      where: { organization_id: org.id },
      select: { id: true, profile: { select: { full_name: true } }, custom_data: true }
    });
    const conflictMember = members.find((m: any) => {
      if (targetType === 'member' && m.id === targetId) return false;
      const cd = (m.custom_data as any) || {};
      return cd.nfc_uid && String(cd.nfc_uid).toLowerCase() === cleanUid.toLowerCase();
    });

    if ((conflictGuest || conflictMember) && !force) {
      const conflictName = conflictGuest ? conflictGuest.name : conflictMember?.profile?.full_name || 'Pengguna lain';
      return res.status(409).json({
        conflict: true,
        conflictName,
        assigned_to: conflictName,
        message: `Kartu ini (${cleanUid}) sudah tertaut ke: ${conflictName}. Apakah Anda ingin memindahkannya ke siswa ini?`
      });
    }

    // Jika force = true dan ada conflict, lepaskan dari pemilik sebelumnya
    if (conflictGuest) {
      const cd = (conflictGuest.custom_data as any) || {};
      delete cd.nfc_uid;
      delete cd.nfc_linked_at;
      await prisma.org_guests.update({
        where: { id: conflictGuest.id },
        data: { custom_data: cd }
      });
    }
    if (conflictMember) {
      const cd = (conflictMember.custom_data as any) || {};
      delete cd.nfc_uid;
      delete cd.nfc_linked_at;
      await prisma.organization_members.update({
        where: { id: conflictMember.id },
        data: { custom_data: cd }
      });
    }

    // Tautkan kartu ke target
    let studentName = '';
    if (targetType === 'guest') {
      const targetGuest = await prisma.org_guests.findUnique({ where: { id: targetId } });
      if (!targetGuest) return res.status(404).json({ error: 'Data siswa tidak ditemukan' });
      studentName = targetGuest.name;
      const cd = (targetGuest.custom_data as any) || {};
      cd.nfc_uid = cleanUid;
      cd.nfc_linked_at = new Date().toISOString();
      await prisma.org_guests.update({
        where: { id: targetId },
        data: { custom_data: cd }
      });
    } else {
      const targetMem = await prisma.organization_members.findUnique({
        where: { id: targetId },
        include: { profile: { select: { full_name: true } } }
      });
      if (!targetMem) return res.status(404).json({ error: 'Data anggota tidak ditemukan' });
      studentName = targetMem.profile?.full_name || 'Anggota';
      const cd = (targetMem.custom_data as any) || {};
      cd.nfc_uid = cleanUid;
      cd.nfc_linked_at = new Date().toISOString();
      await prisma.organization_members.update({
        where: { id: targetId },
        data: { custom_data: cd }
      });
    }

    return res.status(200).json({
      success: true,
      message: `Kartu NFC (${cleanUid}) berhasil ditautkan ke ${studentName}.`,
      nfcUid: cleanUid,
      nfc_uid: cleanUid,
      studentName,
      targetId,
      targetType
    });
  } catch (err) {
    console.error('Error linking NFC card:', err);
    return res.status(500).json({ error: 'Gagal menautkan kartu NFC' });
  }
}

// 2. Putuskan Tautan Kartu NFC dari Siswa
export async function unlinkNfcCard(req: any, res: Response) {
  const { orgIdOrSlug } = req.params;
  const rawTargetType = req.body.targetType || (req.body.guest_id || req.body.guestId ? 'guest' : req.body.member_id || req.body.memberId ? 'member' : 'guest');
  const rawTargetId = req.body.targetId || req.body.guest_id || req.body.guestId || req.body.member_id || req.body.memberId;

  if (!rawTargetId) {
    return res.status(400).json({ error: 'Target ID wajib disertakan.' });
  }

  const targetId = String(rawTargetId).trim();
  const targetType = String(rawTargetType).trim();

  try {
    if (targetType === 'guest') {
      const g = await prisma.org_guests.findUnique({ where: { id: targetId } });
      if (g) {
        const cd = (g.custom_data as any) || {};
        delete cd.nfc_uid;
        delete cd.nfc_linked_at;
        await prisma.org_guests.update({ where: { id: targetId }, data: { custom_data: cd } });
      }
    } else {
      const m = await prisma.organization_members.findUnique({ where: { id: targetId } });
      if (m) {
        const cd = (m.custom_data as any) || {};
        delete cd.nfc_uid;
        delete cd.nfc_linked_at;
        await prisma.organization_members.update({ where: { id: targetId }, data: { custom_data: cd } });
      }
    }
    return res.status(200).json({ success: true, message: 'Tautan kartu NFC berhasil dilepas.' });
  } catch (err) {
    console.error('Error unlinking NFC card:', err);
    return res.status(500).json({ error: 'Gagal melepas kartu NFC' });
  }
}

// 3. Proses Tap Kartu NFC di Kiosk Presensi Gerbang (Super Cepat < 100ms)
export async function processNfcTap(req: any, res: Response) {
  const { orgIdOrSlug } = req.params;
  const rawUid = req.body.nfcUid || req.body.nfc_uid || req.body.uid;
  const rawSessionId = req.body.sessionId || req.body.session_id;

  if (!rawUid || typeof rawUid !== 'string' || !rawUid.trim()) {
    return res.status(400).json({ error: 'UID kartu tidak terbaca dengan jelas.' });
  }

  const cleanUid = rawUid.trim();
  const sessionId = rawSessionId ? String(rawSessionId).trim() : undefined;

  try {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const org = await prisma.organizations.findFirst({
      where: isId ? { id: orgIdOrSlug } : { slug: orgIdOrSlug },
      select: { id: true, name: true, slug: true }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    // Cari siswa (org_guests) terlebih dahulu
    const guests = await prisma.org_guests.findMany({
      where: { organization_id: org.id },
      select: { id: true, name: true, identifier: true, custom_data: true }
    });
    const matchedGuest = guests.find((g: any) => {
      const cd = (g.custom_data as any) || {};
      return (cd.nfc_uid && String(cd.nfc_uid).toLowerCase() === cleanUid.toLowerCase())
        || (g.identifier && String(g.identifier).toLowerCase() === cleanUid.toLowerCase());
    });

    let matchedMember: any = null;
    if (!matchedGuest) {
      const members = await prisma.organization_members.findMany({
        where: { organization_id: org.id },
        include: { profile: { select: { id: true, full_name: true, email: true, avatar_url: true } } }
      });
      matchedMember = members.find((m: any) => {
        const cd = (m.custom_data as any) || {};
        return (cd.nfc_uid && String(cd.nfc_uid).toLowerCase() === cleanUid.toLowerCase())
          || (m.profile_id && String(m.profile_id).toLowerCase() === cleanUid.toLowerCase());
      });
    }

    if (!matchedGuest && !matchedMember) {
      return res.status(404).json({
        error: `Kartu NFC (${cleanUid}) belum terdaftar pada siswa mana pun.`,
        unregistered: true,
        nfcUid: cleanUid
      });
    }

    const now = new Date();

    // Tentukan sesi presensi yang relevan
    let session = null;
    if (sessionId && sessionId.length === 36) {
      session = await prisma.attendance_sessions.findUnique({
        where: { id: sessionId }
      });
    }

    if (!session || !session.is_active) {
      // Cari sesi yang aktif saat ini (berjalan hari ini)
      session = await prisma.attendance_sessions.findFirst({
        where: {
          organization_id: org.id,
          is_active: true,
          end_time: { gte: now }
        },
        orderBy: { start_time: 'desc' }
      });
    }

    if (!session) {
      return res.status(404).json({
        error: 'Tidak ada sesi presensi yang sedang aktif untuk saat ini. Buka sesi presensi terlebih dahulu.',
        noSession: true
      });
    }

    // Tentukan status kehadiran (present vs late)
    let status: 'present' | 'late' = 'present';
    if (session.late_time && now > new Date(session.late_time)) {
      status = 'late';
    }

    // Cek rentang absen pulang jika sesi bertipe in_out
    const isCheckOutWindow = Boolean(
      session.session_type === 'in_out' &&
      session.checkout_start_time &&
      now >= new Date(session.checkout_start_time)
    );

    const studentInfo = matchedGuest ? {
      id: matchedGuest.id,
      name: matchedGuest.name,
      identifier: matchedGuest.identifier,
      kelas: (matchedGuest.custom_data as any)?.kelas || null,
      type: 'guest',
      avatar_url: null
    } : {
      id: matchedMember.id,
      name: matchedMember.profile?.full_name || 'Anggota',
      identifier: (matchedMember.custom_data as any)?.nis || matchedMember.profile?.email,
      kelas: (matchedMember.custom_data as any)?.kelas || null,
      type: 'member',
      avatar_url: matchedMember.profile?.avatar_url || null
    };

    // Skenario A: Siswa Tamu / Edu Guest
    if (matchedGuest) {
      const existing = await prisma.guest_attendance.findFirst({
        where: { session_id: session.id, guest_id: matchedGuest.id }
      });

      if (isCheckOutWindow && existing) {
        if ((existing as any).check_out_time) {
          return res.status(200).json({
            success: true,
            alreadyRecorded: true,
            isCheckOut: true,
            student: studentInfo,
            status: existing.status,
            checkInTime: (existing as any).check_out_time,
            message: `${studentInfo.name} sudah absen pulang sebelumnya.`
          });
        }
        await prisma.guest_attendance.update({
          where: { id: existing.id },
          data: { check_out_time: now } as any
        });

        const guestParentPhone = (matchedGuest.custom_data as any)?.parent_phone || (matchedGuest.custom_data as any)?.no_wa_ortu;
        if (guestParentPhone) {
          sendAttendanceNotification(
            org.id,
            {
              id: matchedGuest.id,
              name: matchedGuest.name,
              identifier: matchedGuest.identifier,
              parentPhone: guestParentPhone,
              kelas: (matchedGuest.custom_data as any)?.kelas
            },
            'pulang',
            'Selesai Kegiatan Belajar',
            now
          ).catch(e => console.error('[WA tap notify error]', e));
        }

        return res.status(200).json({
          success: true,
          isCheckOut: true,
          student: studentInfo,
          status: existing.status,
          checkInTime: now,
          message: `Absen Pulang Berhasil: ${studentInfo.name}`,
          waNotification: guestParentPhone
            ? { sent: true, recipient: guestParentPhone }
            : { sent: false, reason: 'Nomor WA orang tua belum ditautkan' }
        });
      }

      if (existing) {
        const timeDiffSeconds = (now.getTime() - new Date(existing.created_at).getTime()) / 1000;
        // Debounce: jika kartu baru saja di-tap dalam 15 detik terakhir
        if (timeDiffSeconds < 15) {
          return res.status(200).json({
            success: true,
            alreadyRecorded: true,
            student: studentInfo,
            status: existing.status,
            checkInTime: existing.check_in_time,
            message: `${studentInfo.name} sudah tercatat hadir barusan.`
          });
        }

        return res.status(200).json({
          success: true,
          alreadyRecorded: true,
          student: studentInfo,
          status: existing.status,
          checkInTime: existing.check_in_time,
          message: `${studentInfo.name} sudah tercatat ${existing.status === 'late' ? 'Terlambat' : 'Hadir'} sebelumnya.`
        });
      }

      // Catat kehadiran baru
      const record = await prisma.guest_attendance.create({
        data: {
          session_id: session.id,
          guest_id: matchedGuest.id,
          status,
          check_in_time: now
        }
      });

      const guestParentPhone = (matchedGuest.custom_data as any)?.parent_phone || (matchedGuest.custom_data as any)?.no_wa_ortu;
      if (guestParentPhone) {
        sendAttendanceNotification(
          org.id,
          {
            id: matchedGuest.id,
            name: matchedGuest.name,
            identifier: matchedGuest.identifier,
            parentPhone: guestParentPhone,
            kelas: (matchedGuest.custom_data as any)?.kelas
          },
          'masuk',
          status === 'late' ? 'Terlambat' : 'Tepat Waktu',
          now
        ).catch(e => console.error('[WA tap notify error]', e));
      }

      return res.status(200).json({
        success: true,
        student: studentInfo,
        status,
        checkInTime: now,
        isCheckOut: false,
        message: `Presensi Berhasil: ${studentInfo.name} (${status === 'late' ? 'Terlambat' : 'Hadir Tepat Waktu'})`,
        waNotification: guestParentPhone
          ? { sent: true, recipient: guestParentPhone }
          : { sent: false, reason: 'Nomor WA orang tua belum ditautkan' }
      });
    }

    // Skenario B: Siswa Terdaftar (Member)
    if (matchedMember) {
      const existing = await prisma.attendance.findFirst({
        where: { session_id: session.id, profile_id: matchedMember.profile_id }
      });

      if (isCheckOutWindow && existing) {
        if ((existing as any).check_out_time) {
          return res.status(200).json({
            success: true,
            alreadyRecorded: true,
            isCheckOut: true,
            student: studentInfo,
            status: existing.status,
            checkInTime: (existing as any).check_out_time,
            message: `${studentInfo.name} sudah absen pulang sebelumnya.`
          });
        }
        await prisma.attendance.update({
          where: { id: existing.id },
          data: { check_out_time: now } as any
        });
        return res.status(200).json({
          success: true,
          isCheckOut: true,
          student: studentInfo,
          status: existing.status,
          checkInTime: now,
          message: `Absen Pulang Berhasil: ${studentInfo.name}`
        });
      }

      if (existing) {
        return res.status(200).json({
          success: true,
          alreadyRecorded: true,
          student: studentInfo,
          status: existing.status,
          checkInTime: existing.check_in_time,
          message: `${studentInfo.name} sudah tercatat hadir sebelumnya.`
        });
      }

      await prisma.attendance.create({
        data: {
          organization_id: org.id,
          profile_id: matchedMember.profile_id,
          session_id: session.id,
          status,
          check_in_time: now,
          notes: '[TAP_NFC_KIOSK]'
        } as any
      });

      return res.status(200).json({
        success: true,
        student: studentInfo,
        status,
        checkInTime: now,
        isCheckOut: false,
        message: `Presensi Berhasil: ${studentInfo.name} (${status === 'late' ? 'Terlambat' : 'Hadir Tepat Waktu'})`
      });
    }
  } catch (err) {
    console.error('Error processing NFC tap:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan saat memproses tap kartu' });
  }
}

// 4. Informasi Sesi & Statistik Kiosk Real-Time
export async function getNfcKioskInfo(req: any, res: Response) {
  const { orgIdOrSlug } = req.params;
  const { sessionId } = req.query;

  try {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const org = await prisma.organizations.findFirst({
      where: isId ? { id: orgIdOrSlug } : { slug: orgIdOrSlug },
      select: { id: true, name: true, slug: true, logo_url: true, is_edu: true }
    });
    if (!org) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const now = new Date();

    // Sesi aktif
    let session: any = null;
    if (sessionId && typeof sessionId === 'string' && sessionId.length === 36) {
      session = await prisma.attendance_sessions.findUnique({ where: { id: sessionId } });
    }

    if (!session || !session.is_active) {
      session = await prisma.attendance_sessions.findFirst({
        where: {
          organization_id: org.id,
          is_active: true,
          end_time: { gte: now }
        },
        orderBy: { start_time: 'desc' }
      });
    }

    // Hitung total siswa (guests + members)
    const [totalGuests, totalMembers] = await Promise.all([
      prisma.org_guests.count({ where: { organization_id: org.id } }),
      prisma.organization_members.count({ where: { organization_id: org.id, role: { not: 'auditor' as any } } })
    ]);
    const totalStudents = totalGuests > 0 ? totalGuests : totalMembers;

    let presentCount = 0;
    let lateCount = 0;
    let recentTaps: any[] = [];

    if (session) {
      const [guestRecords, memberRecords] = await Promise.all([
        prisma.guest_attendance.findMany({
          where: { session_id: session.id },
          include: { guest: { select: { id: true, name: true, identifier: true, custom_data: true } } },
          orderBy: { check_in_time: 'desc' },
          take: 15
        }),
        prisma.attendance.findMany({
          where: { session_id: session.id },
          include: { profile: { select: { id: true, full_name: true, email: true, avatar_url: true } } },
          orderBy: { check_in_time: 'desc' },
          take: 15
        })
      ]);

      // Gabungkan recent taps
      const mappedGuests = guestRecords.map((r: any) => ({
        id: r.id,
        name: r.guest?.name || 'Siswa',
        identifier: r.guest?.identifier || '-',
        kelas: (r.guest?.custom_data as any)?.kelas || null,
        status: r.status,
        checkInTime: r.check_in_time,
        type: 'guest'
      }));

      const mappedMembers = memberRecords.map((r: any) => ({
        id: r.id,
        name: r.profile?.full_name || 'Anggota',
        identifier: r.profile?.email || '-',
        kelas: null,
        status: r.status,
        checkInTime: r.check_in_time,
        type: 'member'
      }));

      recentTaps = [...mappedGuests, ...mappedMembers]
        .sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime())
        .slice(0, 10);

      // Hitung total hadir & telat
      const [gPresent, gLate, mPresent, mLate] = await Promise.all([
        prisma.guest_attendance.count({ where: { session_id: session.id, status: 'present' } }),
        prisma.guest_attendance.count({ where: { session_id: session.id, status: 'late' } }),
        prisma.attendance.count({ where: { session_id: session.id, status: 'present' } }),
        prisma.attendance.count({ where: { session_id: session.id, status: 'late' } })
      ]);

      presentCount = gPresent + mPresent;
      lateCount = gLate + mLate;
    }

    const totalAttended = presentCount + lateCount;
    const notYetCount = Math.max(0, totalStudents - totalAttended);

    return res.status(200).json({
      organization: org,
      session,
      stats: {
        totalStudents,
        presentCount,
        lateCount,
        notYetCount,
        totalAttended
      },
      recentTaps
    });
  } catch (err) {
    console.error('Error fetching NFC kiosk info:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

