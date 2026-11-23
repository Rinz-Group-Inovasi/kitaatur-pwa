import { Request, Response } from 'express';
import { prisma } from '../config/db';
import {
  getSessionStatus,
  startWhatsAppSession,
  disconnectWhatsAppSession,
  sendWhatsAppMessage,
  normalizePhoneNumber
} from '../services/whatsapp.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOrgId(orgIdOrSlug: string): Promise<string | null> {
  const isId = UUID_REGEX.test(orgIdOrSlug);
  const org = isId
    ? await prisma.organizations.findUnique({ where: { id: orgIdOrSlug } })
    : await prisma.organizations.findFirst({ where: { slug: { equals: orgIdOrSlug, mode: 'insensitive' } } });
  return org?.id || null;
}

export async function getStatus(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const status = await getSessionStatus(orgId);
    return res.json(status);
  } catch (err: any) {
    console.error('Error getting WhatsApp status:', err);
    return res.status(500).json({ error: 'Gagal memeriksa status WhatsApp', details: err.message });
  }
}

export async function startSession(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const status = await startWhatsAppSession(orgId);
    return res.json({ success: true, ...status });
  } catch (err: any) {
    console.error('Error starting WhatsApp session:', err);
    return res.status(500).json({ error: 'Gagal memulai sesi WhatsApp', details: err.message });
  }
}

export async function disconnectSession(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const result = await disconnectWhatsAppSession(orgId);
    return res.json(result);
  } catch (err: any) {
    console.error('Error disconnecting WhatsApp session:', err);
    return res.status(500).json({ error: 'Gagal memutuskan sesi WhatsApp', details: err.message });
  }
}

export async function sendTestMessage(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const { targetPhone, message } = req.body;

    if (!targetPhone) {
      return res.status(400).json({ error: 'Nomor telepon tujuan wajib diisi' });
    }

    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const testText = message || `Halo! Ini adalah pesan uji coba dari Bot WhatsApp Sekolah KitaAtur pada ${new Date().toLocaleString('id-ID')}. Koneksi berhasil dan aktif!`;

    const sent = await sendWhatsAppMessage(orgId, targetPhone, testText);
    if (!sent) {
      return res.status(500).json({ error: 'Gagal mengirim pesan uji coba. Pastikan bot WhatsApp sudah terhubung.' });
    }

    return res.json({ success: true, message: `Pesan uji coba berhasil dikirim ke ${targetPhone}` });
  } catch (err: any) {
    console.error('Error sending test WhatsApp message:', err);
    return res.status(500).json({ error: 'Gagal mengirim pesan uji coba', details: err.message });
  }
}

// Pairing nomor WA orang tua secara manual dari admin/guru BK
export async function pairParentManual(req: Request, res: Response) {
  try {
    const { orgIdOrSlug } = req.params;
    const { guestId, parentPhone, parentName } = req.body;

    if (!guestId || !parentPhone) {
      return res.status(400).json({ error: 'guestId dan parentPhone wajib diisi' });
    }

    const orgId = await resolveOrgId(orgIdOrSlug);
    if (!orgId) return res.status(404).json({ error: 'Organisasi tidak ditemukan' });

    const guest = await prisma.org_guests.findFirst({
      where: { id: guestId, organization_id: orgId }
    });

    if (!guest) {
      return res.status(404).json({ error: 'Data siswa tidak ditemukan' });
    }

    const normalized = normalizePhoneNumber(parentPhone);
    const prevCustomData = (guest.custom_data as any) || {};

    const updated = await prisma.org_guests.update({
      where: { id: guest.id },
      data: {
        custom_data: {
          ...prevCustomData,
          parent_phone: normalized,
          ...(parentName ? { parent_name: parentName } : {}),
          parent_wa_paired_at: new Date().toISOString()
        }
      }
    });

    return res.json({
      success: true,
      message: `Nomor WhatsApp orang tua berhasil ditautkan ke ${guest.name}`,
      data: updated
    });
  } catch (err: any) {
    console.error('Error pairing parent phone:', err);
    return res.status(500).json({ error: 'Gagal menautkan nomor WhatsApp', details: err.message });
  }
}

