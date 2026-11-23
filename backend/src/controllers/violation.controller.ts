import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { sendViolationNotification } from '../services/whatsapp.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOrgId(orgIdOrSlug: string): Promise<string | null> {
  const isId = UUID_REGEX.test(orgIdOrSlug);
  const org = isId
    ? await prisma.organizations.findUnique({ where: { id: orgIdOrSlug } })
    : await prisma.organizations.findFirst({ where: { slug: { equals: orgIdOrSlug, mode: 'insensitive' } } });
  return org?.id || null;
}

// 1. List Pelanggaran Siswa
export async function getViolations(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const { category, status, search, page = '1', limit = '20' } = req.query;

    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * take;

    const where: any = { organization_id: orgId };

    if (category && category !== 'all') {
      where.category = String(category).toLowerCase();
    }
    if (status && status !== 'all') {
      where.status = String(status).toLowerCase();
    }
    if (search) {
      const q = String(search).trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { guest: { name: { contains: q, mode: 'insensitive' } } },
        { guest: { identifier: { contains: q, mode: 'insensitive' } } }
      ];
    }

    const [violations, total] = await Promise.all([
      prisma.student_violations.findMany({
        where,
        include: {
          guest: {
            select: {
              id: true,
              name: true,
              identifier: true,
              custom_data: true
            }
          },
          reporter: {
            select: {
              id: true,
              full_name: true,
              avatar_url: true
            }
          }
        },
        orderBy: { occurred_at: 'desc' },
        skip,
        take
      }),
      prisma.student_violations.count({ where })
    ]);

    return res.json({
      data: violations,
      pagination: {
        page: pageNum,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (err: any) {
    console.error('Error fetching student violations:', err);
    return res.status(500).json({ error: 'Gagal mengambil data pelanggaran', details: err.message });
  }
}

// 2. Ringkasan Statistik Pelanggaran & Poin untuk BK
export async function getViolationsSummary(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const [totalRecords, pointsAgg, byCategory, topStudents] = await Promise.all([
      prisma.student_violations.count({ where: { organization_id: orgId } }),
      prisma.student_violations.aggregate({
        where: { organization_id: orgId },
        _sum: { points: true }
      }),
      prisma.student_violations.groupBy({
        by: ['category'],
        where: { organization_id: orgId },
        _count: { id: true }
      }),
      prisma.student_violations.groupBy({
        by: ['guest_id'],
        where: { organization_id: orgId },
        _sum: { points: true },
        _count: { id: true },
        orderBy: {
          _sum: {
            points: 'desc'
          }
        },
        take: 10
      })
    ]);

    // Ambil info nama siswa untuk top students
    const guestIds = topStudents.map((t) => t.guest_id);
    const guests = await prisma.org_guests.findMany({
      where: { id: { in: guestIds } },
      select: { id: true, name: true, identifier: true, custom_data: true }
    });

    const guestMap = new Map(guests.map((g) => [g.id, g]));

    const enrichedTopStudents = topStudents.map((item) => {
      const g = guestMap.get(item.guest_id);
      return {
        guestId: item.guest_id,
        name: g?.name || 'Siswa',
        identifier: g?.identifier || '-',
        kelas: (g?.custom_data as any)?.kelas || null,
        parentPhone: (g?.custom_data as any)?.parent_phone || null,
        totalPoints: item._sum.points || 0,
        violationCount: item._count.id
      };
    });

    const categoryCounts: Record<string, number> = {
      ringan: 0,
      sedang: 0,
      berat: 0
    };
    byCategory.forEach((c) => {
      categoryCounts[c.category.toLowerCase()] = c._count.id;
    });

    return res.json({
      totalViolations: totalRecords,
      totalPoints: pointsAgg._sum.points || 0,
      categoryCounts,
      topStudents: enrichedTopStudents
    });
  } catch (err: any) {
    console.error('Error fetching violations summary:', err);
    return res.status(500).json({ error: 'Gagal mengambil ringkasan pelanggaran', details: err.message });
  }
}

// 3. Catat Pelanggaran Siswa Baru (Oleh Guru BK / Admin)
export async function createViolation(req: any, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const { guestId, title, category = 'ringan', points = 5, actionTaken, notes, occurredAt, notifyParent = true } = req.body;

    if (!guestId || !title) {
      return res.status(400).json({ error: 'guestId dan judul pelanggaran wajib diisi' });
    }

    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const student = await prisma.org_guests.findFirst({
      where: { id: guestId, organization_id: orgId }
    });

    if (!student) {
      return res.status(404).json({ error: 'Data siswa tidak ditemukan' });
    }

    const reporterId = req.user?.id || null;

    const violation = await prisma.student_violations.create({
      data: {
        organization_id: orgId,
        guest_id: guestId,
        reported_by: reporterId,
        title: String(title).trim(),
        category: String(category).toLowerCase(),
        points: Math.max(0, parseInt(points, 10) || 5),
        action_taken: actionTaken ? String(actionTaken).trim() : null,
        notes: notes ? String(notes).trim() : null,
        occurred_at: occurredAt ? new Date(occurredAt) : new Date(),
        status: 'recorded'
      },
      include: {
        guest: {
          select: {
            id: true,
            name: true,
            identifier: true,
            custom_data: true
          }
        }
      }
    });

    // Kirim notifikasi WhatsApp ke orang tua secara asinkron
    if (notifyParent) {
      const cd = (student.custom_data as any) || {};
      sendViolationNotification(
        orgId,
        {
          id: student.id,
          name: student.name,
          identifier: student.identifier,
          parentPhone: cd.parent_phone,
          kelas: cd.kelas
        },
        {
          title: violation.title,
          category: violation.category,
          points: violation.points,
          action_taken: violation.action_taken,
          notes: violation.notes
        }
      ).catch((e) => console.error('[WhatsApp Violation Notify Error]', e));
    }

    return res.status(201).json({
      success: true,
      message: 'Catatan pelanggaran siswa berhasil disimpan',
      data: violation
    });
  } catch (err: any) {
    console.error('Error creating student violation:', err);
    return res.status(500).json({ error: 'Gagal mencatat pelanggaran siswa', details: err.message });
  }
}

// 4. Update Pelanggaran (Status / Tindakan BK)
export async function updateViolation(req: Request, res: Response) {
  try {
    const { orgIdOrSlug, id } = req.params;
    const { title, category, points, actionTaken, notes, status } = req.body;

    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const existing = await prisma.student_violations.findFirst({
      where: { id, organization_id: orgId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Catatan pelanggaran tidak ditemukan' });
    }

    const data: any = {};
    if (title !== undefined) data.title = String(title).trim();
    if (category !== undefined) data.category = String(category).toLowerCase();
    if (points !== undefined) data.points = Math.max(0, parseInt(points, 10) || 0);
    if (actionTaken !== undefined) data.action_taken = actionTaken;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = String(status).toLowerCase();

    const updated = await prisma.student_violations.update({
      where: { id },
      data,
      include: {
        guest: {
          select: {
            id: true,
            name: true,
            identifier: true,
            custom_data: true
          }
        }
      }
    });

    return res.json({
      success: true,
      message: 'Catatan pelanggaran berhasil diperbarui',
      data: updated
    });
  } catch (err: any) {
    console.error('Error updating student violation:', err);
    return res.status(500).json({ error: 'Gagal memperbarui catatan pelanggaran', details: err.message });
  }
}

// 5. Hapus Pelanggaran
export async function deleteViolation(req: Request, res: Response) {
  try {
    const { orgIdOrSlug, id } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    await prisma.student_violations.deleteMany({
      where: { id, organization_id: orgId }
    });

    return res.json({ success: true, message: 'Catatan pelanggaran berhasil dihapus' });
  } catch (err: any) {
    console.error('Error deleting student violation:', err);
    return res.status(500).json({ error: 'Gagal menghapus catatan pelanggaran', details: err.message });
  }
}

// 6. Riwayat Pelanggaran & Poin untuk Satu Siswa (Bisa diakses Ortu / BK)
export async function getStudentViolations(req: Request, res: Response) {
  try {
    const { orgIdOrSlug, guestId } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const student = await prisma.org_guests.findFirst({
      where: { id: guestId, organization_id: orgId }
    });

    if (!student) {
      return res.status(404).json({ error: 'Data siswa tidak ditemukan' });
    }

    const [violations, pointsAgg] = await Promise.all([
      prisma.student_violations.findMany({
        where: { guest_id: guestId },
        orderBy: { occurred_at: 'desc' }
      }),
      prisma.student_violations.aggregate({
        where: { guest_id: guestId },
        _sum: { points: true }
      })
    ]);

    return res.json({
      student: {
        id: student.id,
        name: student.name,
        identifier: student.identifier,
        custom_data: student.custom_data
      },
      totalPoints: pointsAgg._sum.points || 0,
      violations
    });
  } catch (err: any) {
    console.error('Error fetching student violations history:', err);
    return res.status(500).json({ error: 'Gagal mengambil riwayat pelanggaran siswa', details: err.message });
  }
}
