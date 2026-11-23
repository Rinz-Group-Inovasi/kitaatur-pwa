import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/db';

const activeSockets = new Map<string, WASocket>();
const qrDataUrls = new Map<string, string>();
const reconnectTimeouts = new Map<string, NodeJS.Timeout>();

export function normalizePhoneNumber(rawPhone: string): string {
  let cleaned = rawPhone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

function getSessionDir(organizationId: string): string {
  const baseDir = path.join(process.cwd(), 'storage', 'whatsapp_sessions', organizationId);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

export async function getSessionStatus(organizationId: string) {
  const dbSession = await prisma.school_whatsapp_sessions.findUnique({
    where: { organization_id: organizationId }
  });

  const liveSocket = activeSockets.get(organizationId);
  const liveQr = qrDataUrls.get(organizationId);

  return {
    status: dbSession?.status || 'disconnected',
    phoneNumber: dbSession?.phone_number || null,
    qrCode: liveQr || dbSession?.qr_code || null,
    lastActiveAt: dbSession?.last_active_at || null,
    isConnected: !!(liveSocket && dbSession?.status === 'connected')
  };
}

export async function startWhatsAppSession(organizationId: string) {
  const existingSocket = activeSockets.get(organizationId);
  if (existingSocket) {
    const currentStatus = await getSessionStatus(organizationId);
    if (currentStatus.isConnected) {
      return currentStatus;
    }
  }

  const sessionDir = getSessionDir(organizationId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });

  activeSockets.set(organizationId, sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrUrl = await QRCode.toDataURL(qr);
        qrDataUrls.set(organizationId, qrUrl);
        await prisma.school_whatsapp_sessions.upsert({
          where: { organization_id: organizationId },
          create: {
            organization_id: organizationId,
            status: 'qr_ready',
            qr_code: qrUrl
          },
          update: {
            status: 'qr_ready',
            qr_code: qrUrl
          }
        });
      } catch (err) {
        console.error('Error generating QR code data URL:', err);
      }
    }

    if (connection === 'open') {
      const jid = sock.user?.id || '';
      const rawNumber = jid.split(':')[0] || jid.split('@')[0];
      qrDataUrls.delete(organizationId);

      await prisma.school_whatsapp_sessions.upsert({
        where: { organization_id: organizationId },
        create: {
          organization_id: organizationId,
          status: 'connected',
          phone_number: rawNumber,
          qr_code: null,
          last_active_at: new Date()
        },
        update: {
          status: 'connected',
          phone_number: rawNumber,
          qr_code: null,
          last_active_at: new Date()
        }
      });
      console.log(`[WhatsApp] School ${organizationId} connected successfully with ${rawNumber}`);
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      qrDataUrls.delete(organizationId);
      activeSockets.delete(organizationId);

      if (statusCode === DisconnectReason.loggedOut) {
        // Hapus folder credential jika logout
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {}

        await prisma.school_whatsapp_sessions.upsert({
          where: { organization_id: organizationId },
          create: {
            organization_id: organizationId,
            status: 'disconnected',
            phone_number: null,
            qr_code: null
          },
          update: {
            status: 'disconnected',
            phone_number: null,
            qr_code: null
          }
        });
        console.log(`[WhatsApp] School ${organizationId} logged out`);
      } else if (shouldReconnect) {
        await prisma.school_whatsapp_sessions.upsert({
          where: { organization_id: organizationId },
          create: { organization_id: organizationId, status: 'connecting' },
          update: { status: 'connecting' }
        });
        
        // Reconnect after 5 seconds
        if (!reconnectTimeouts.has(organizationId)) {
          const timeout = setTimeout(() => {
            reconnectTimeouts.delete(organizationId);
            startWhatsAppSession(organizationId).catch(console.error);
          }, 5000);
          reconnectTimeouts.set(organizationId, timeout);
        }
      }
    }
  });

  // Listener pesan masuk dari orang tua
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const senderJid = msg.key.remoteJid;
      if (!senderJid || !senderJid.endsWith('@s.whatsapp.net')) continue;

      const rawText = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || '';
      const text = rawText.trim();
      const senderPhone = normalizePhoneNumber(senderJid.split('@')[0]);

      if (!text) continue;

      const upperText = text.toUpperCase();

      try {
        // Skenario 1: Pairing Mandiri: DAFTAR <NIS> atau PAIR <NIS>
        if (upperText.startsWith('DAFTAR ') || upperText.startsWith('PAIR ')) {
          const nis = text.split(/\s+/)[1]?.trim();
          if (!nis) {
            await sock.sendMessage(senderJid, {
              text: '⚠️ Format salah. Untuk menautkan nomor WA ke data siswa, kirim pesan dengan format:\n*DAFTAR <NIS>*\nContoh: *DAFTAR 10A-12345*'
            });
            continue;
          }

          const guest = await prisma.org_guests.findFirst({
            where: {
              organization_id: organizationId,
              identifier: { equals: nis, mode: 'insensitive' }
            }
          });

          if (!guest) {
            await sock.sendMessage(senderJid, {
              text: `❌ Nomor Induk Siswa (NIS) *${nis}* tidak ditemukan di data sekolah ini. Pastikan NIS yang Anda ketik sudah benar.`
            });
            continue;
          }

          const currentCustomData = (guest.custom_data as any) || {};
          const updatedCustomData = {
            ...currentCustomData,
            parent_phone: senderPhone,
            parent_wa_paired_at: new Date().toISOString()
          };

          await prisma.org_guests.update({
            where: { id: guest.id },
            data: { custom_data: updatedCustomData }
          });

          const studentClass = currentCustomData.kelas ? ` Kelas ${currentCustomData.kelas}` : '';
          await sock.sendMessage(senderJid, {
            text: `✅ *NOMOR BERHASIL DITAUTKAN!*\n\nHalo Ayah/Bunda! Nomor WhatsApp Anda telah berhasil dihubungkan dengan data:\n👤 *Nama Siswa:* ${guest.name}\n🏷️ *NIS:* ${guest.identifier}${studentClass}\n\nAnda akan otomatis menerima notifikasi presensi saat ananda tap kartu di gerbang sekolah.\n\nKetik *CEK* kapan saja untuk memeriksa status presensi dan poin siswa.`
          });
          continue;
        }

        // Skenario 2: Cek Status & Poin Pelanggaran: CEK / STATUS / POIN
        if (upperText === 'CEK' || upperText === 'STATUS' || upperText === 'POIN') {
          // Cari siswa yang nomor WA ortunya cocok dengan senderPhone
          const guests = await prisma.org_guests.findMany({
            where: { organization_id: organizationId }
          });

          const matchedGuests = guests.filter((g: any) => {
            const cd = (g.custom_data as any) || {};
            const parentPhone = cd.parent_phone ? normalizePhoneNumber(String(cd.parent_phone)) : '';
            return parentPhone === senderPhone;
          });

          if (matchedGuests.length === 0) {
            await sock.sendMessage(senderJid, {
              text: `⚠️ Nomor WhatsApp Anda belum terdaftar pada siswa mana pun di sekolah ini.\n\nUntuk mendaftar, kirim:\n*DAFTAR <NIS>*\nContoh: *DAFTAR 10A-12345*`
            });
            continue;
          }

          for (const student of matchedGuests) {
            const cd = (student.custom_data as any) || {};
            
            // Cek presensi hari ini
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const attendanceToday = await prisma.guest_attendance.findFirst({
              where: {
                guest_id: student.id,
                created_at: { gte: today, lt: tomorrow }
              },
              orderBy: { created_at: 'desc' }
            });

            // Cek pelanggaran siswa
            const violations = await prisma.student_violations.findMany({
              where: { guest_id: student.id },
              orderBy: { occurred_at: 'desc' },
              take: 5
            });

            const totalPoints = await prisma.student_violations.aggregate({
              where: { guest_id: student.id },
              _sum: { points: true }
            });

            const pointsSum = totalPoints._sum.points || 0;

            let attStatusText = 'Belum Ada Catatan Kehadiran';
            if (attendanceToday) {
              const jamMasuk = new Date(attendanceToday.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              const jamPulang = attendanceToday.check_out_time 
                ? new Date(attendanceToday.check_out_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-';
              attStatusText = `Hadir (Masuk: ${jamMasuk} WIB | Pulang: ${jamPulang})`;
              if (attendanceToday.status === 'late') {
                attStatusText = `Terlambat (Masuk: ${jamMasuk} WIB | Pulang: ${jamPulang})`;
              }
            }

            let violationListText = 'Tidak ada catatan pelanggaran aktif. Pertahankan!';
            if (violations.length > 0) {
              violationListText = violations.map((v, i) => {
                const dateStr = new Date(v.occurred_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                return `${i + 1}. [${dateStr}] *${v.title}* (+${v.points} poin) - ${v.category.toUpperCase()}`;
              }).join('\n');
            }

            const responseMsg = `📋 *LAPORAN SISWA - KITAATUR SCHOOL*\n----------------------------------------\n👤 *Nama:* ${student.name}\n🏷️ *NIS:* ${student.identifier} ${cd.kelas ? `(${cd.kelas})` : ''}\n\n📍 *Presensi Hari Ini:*\n${attStatusText}\n\n⚠️ *Total Poin Pelanggaran: ${pointsSum} Poin*\n${violationListText}\n\n----------------------------------------\n_Ketik *MENU* untuk opsi perintah lainnya._`;

            await sock.sendMessage(senderJid, { text: responseMsg });
          }
          continue;
        }

        // Default: Panduan / Menu
        await sock.sendMessage(senderJid, {
          text: `👋 *Halo! Selamat Datang di Layanan WhatsApp Sekolah*\n\nBerikut perintah yang dapat Anda gunakan:\n\n1️⃣ *DAFTAR <NIS>*\nMenautkan nomor Anda ke data siswa agar menerima notifikasi otomatis saat ananda hadir di sekolah.\n_Contoh: DAFTAR 10A-12345_\n\n2️⃣ *CEK*\nMelihat status kehadiran hari ini dan rekap poin pelanggaran siswa.\n\n3️⃣ *BANTUAN*\nMenampilkan petunjuk penggunaan bot ini.`
        });
      } catch (err) {
        console.error('[WhatsApp Bot] Error processing message:', err);
      }
    }
  });

  return getSessionStatus(organizationId);
}

export async function disconnectWhatsAppSession(organizationId: string) {
  const timeout = reconnectTimeouts.get(organizationId);
  if (timeout) {
    clearTimeout(timeout);
    reconnectTimeouts.delete(organizationId);
  }

  const sock = activeSockets.get(organizationId);
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {}
    try {
      sock.end(undefined);
    } catch (e) {}
    activeSockets.delete(organizationId);
  }

  qrDataUrls.delete(organizationId);

  const sessionDir = path.join(process.cwd(), 'storage', 'whatsapp_sessions', organizationId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {}

  await prisma.school_whatsapp_sessions.upsert({
    where: { organization_id: organizationId },
    create: {
      organization_id: organizationId,
      status: 'disconnected',
      phone_number: null,
      qr_code: null
    },
    update: {
      status: 'disconnected',
      phone_number: null,
      qr_code: null
    }
  });

  return { success: true, message: 'WhatsApp session disconnected' };
}

// Pengiriman Pesan Mandiri (General)
export async function sendWhatsAppMessage(organizationId: string, toPhone: string, text: string): Promise<boolean> {
  const sock = activeSockets.get(organizationId);
  if (!sock) return false;

  const normalized = normalizePhoneNumber(toPhone);
  const jid = `${normalized}@s.whatsapp.net`;

  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch (err) {
    console.error(`[WhatsApp] Failed to send message to ${jid}:`, err);
    return false;
  }
}

// Notifikasi Presensi Siswa Otomatis ke Orang Tua
export async function sendAttendanceNotification(
  organizationId: string,
  student: {
    id: string;
    name: string;
    identifier: string;
    parentPhone?: string | null;
    kelas?: string | null;
  },
  type: 'masuk' | 'pulang' | 'izin' | 'sakit',
  statusText: string,
  time: Date = new Date()
) {
  try {
    let parentPhone = student.parentPhone;

    // Jika belum ada di payload, cari di DB
    if (!parentPhone) {
      const guest = await prisma.org_guests.findUnique({
        where: { id: student.id }
      });
      const cd = (guest?.custom_data as any) || {};
      parentPhone = cd.parent_phone || null;
    }

    if (!parentPhone) {
      // Siswa belum ditautkan nomor WA orang tua
      return false;
    }

    const sock = activeSockets.get(organizationId);
    if (!sock) {
      // Bot sekolah belum aktif/terhubung
      return false;
    }

    const dateFormatted = time.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const timeFormatted = time.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });

    let actionLabel = 'Telah Masuk Sekolah';
    let icon = '🔔';

    if (type === 'pulang') {
      actionLabel = 'Telah Selesai & Absen Pulang';
      icon = '🏠';
    } else if (type === 'izin') {
      actionLabel = 'Tercatat Permohonan Izin';
      icon = '📝';
    } else if (type === 'sakit') {
      actionLabel = 'Tercatat Keterangan Sakit';
      icon = '🏥';
    }

    const kelasInfo = student.kelas ? `\n🏫 *Kelas:* ${student.kelas}` : '';

    const message = `${icon} *NOTIFIKASI KEHADIRAN SISWA*\n----------------------------------------\nYth. Orang Tua / Wali dari:\n👤 *Nama:* ${student.name}\n🏷️ *NIS:* ${student.identifier}${kelasInfo}\n\n📅 *Hari / Tanggal:* ${dateFormatted}\n⏰ *Waktu:* ${timeFormatted} WIB\n📍 *Status:* ${actionLabel} (${statusText})\n\n----------------------------------------\n_Pesan otomatis ini dikirimkan langsung oleh Sistem Presensi Gerbang KitaAtur School._\n_Ketik *CEK* untuk info detail kehadiran & poin ananda._`;

    return await sendWhatsAppMessage(organizationId, parentPhone, message);
  } catch (err) {
    console.error('[WhatsApp Notification] Error sending attendance notification:', err);
    return false;
  }
}

// Notifikasi Pelanggaran Siswa ke Orang Tua
export async function sendViolationNotification(
  organizationId: string,
  student: {
    id: string;
    name: string;
    identifier: string;
    parentPhone?: string | null;
    kelas?: string | null;
  },
  violation: {
    title: string;
    category: string;
    points: number;
    action_taken?: string | null;
    notes?: string | null;
  }
) {
  try {
    let parentPhone = student.parentPhone;

    if (!parentPhone) {
      const guest = await prisma.org_guests.findUnique({
        where: { id: student.id }
      });
      const cd = (guest?.custom_data as any) || {};
      parentPhone = cd.parent_phone || null;
    }

    if (!parentPhone) return false;

    const sock = activeSockets.get(organizationId);
    if (!sock) return false;

    const totalPoints = await prisma.student_violations.aggregate({
      where: { guest_id: student.id },
      _sum: { points: true }
    });
    const total = totalPoints._sum.points || 0;

    const kelasInfo = student.kelas ? `\n🏫 *Kelas:* ${student.kelas}` : '';
    const tindakan = violation.action_taken ? `\n🛠️ *Tindakan BK:* ${violation.action_taken}` : '';
    const catatan = violation.notes ? `\n📝 *Catatan:* ${violation.notes}` : '';

    const message = `⚠️ *PEMBERITAHUAN PELANGGARAN SISWA*\n----------------------------------------\nYth. Orang Tua / Wali dari:\n👤 *Nama:* ${student.name}\n🏷️ *NIS:* ${student.identifier}${kelasInfo}\n\nAnanda baru saja dicatat melakukan pelanggaran tata tertib sekolah:\n📌 *Pelanggaran:* ${violation.title}\n📊 *Kategori:* ${violation.category.toUpperCase()} (+${violation.points} Poin)${tindakan}${catatan}\n\n⚠️ *Total Akumulasi Poin Pelanggaran:* ${total} Poin\n\n----------------------------------------\n_Mohon bimbingan dan perhatian orang tua di rumah. Jika ada pertanyaan atau butuh klarifikasi, silakan berkonsultasi dengan Guru Bimbingan Konseling (BK) di sekolah._`;

    return await sendWhatsAppMessage(organizationId, parentPhone, message);
  } catch (err) {
    console.error('[WhatsApp Notification] Error sending violation notification:', err);
    return false;
  }
}

// Inisialisasi sesi WA yang aktif saat backend baru dinyalakan
export async function initActiveWhatsAppSessions() {
  try {
    const sessions = await prisma.school_whatsapp_sessions.findMany({
      where: {
        status: { in: ['connected', 'qr_ready', 'connecting'] }
      }
    });

    console.log(`[WhatsApp] Restoring ${sessions.length} active school sessions...`);
    for (const session of sessions) {
      startWhatsAppSession(session.organization_id).catch((err) => {
        console.error(`[WhatsApp] Failed to restore session for org ${session.organization_id}:`, err);
      });
    }
  } catch (err) {
    console.error('[WhatsApp] Error initializing active sessions:', err);
  }
}
