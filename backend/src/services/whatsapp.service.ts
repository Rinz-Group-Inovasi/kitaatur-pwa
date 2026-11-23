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
import crypto from 'crypto';
import { prisma } from '../config/db';

const db = prisma as any;

const activeSockets = new Map<string, WASocket>();
const qrDataUrls = new Map<string, string>();
const reconnectTimeouts = new Map<string, NodeJS.Timeout>();

// ==========================================
// ANTI-BAN & SPAM-PREVENTION ENGINE
// ==========================================
interface QueueItem {
  toPhone: string;
  text: string;
  resolve: (val: boolean) => void;
}

// In-memory queue per sekolah agar pengiriman terurut (tidak meledak serempak)
const outboundQueues = new Map<string, QueueItem[]>();
const isProcessingQueue = new Map<string, boolean>();

// Deduplikasi notifikasi agar orang tua tidak di-spam berulang dalam 5 menit
const dedupCache = new Map<string, number>();

// Jitter delay acak untuk mensimulasikan jeda ketik alami manusia (1500 - 3500ms)
const randomJitter = (minMs = 1500, maxMs = 3500) => {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Variasi sapaan agar pesan tidak terdeteksi sebagai broadcast template yang identik
function getRandomGreeting(): string {
  const greetings = [
    'Yth. Bapak/Ibu Orang Tua / Wali dari:',
    'Yth. Orang Tua / Wali dari:',
    'Halo Ayah/Bunda dari ananda:',
    'Assalamu’alaikum Wr. Wb. Yth. Wali dari:',
    'Selamat pagi/siang Bapak/Ibu Wali dari:'
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function getRandomClosing(): string {
  const closings = [
    'Semoga ananda menjalani hari belajar yang berkah dan produktif.',
    'Terima kasih atas kerja sama dan bimbingan Ayah/Bunda di rumah.',
    'Semoga sehat dan sukses selalu untuk keluarga tercinta.',
    'Salam hangat dari keluarga besar sekolah.',
    'Mari bersama mendampingi tumbuh kembang ananda tercinta.'
  ];
  return closings[Math.floor(Math.random() * closings.length)];
}

// Signature hash acak unik di tiap pesan (Anti-Heuristic Meta Classifier)
function getMessageSignature(): string {
  const ref = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `_Ref: #${ref}_`;
}

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
  const dbSession = await db.school_whatsapp_sessions.findUnique({
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
        await db.school_whatsapp_sessions.upsert({
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

      await db.school_whatsapp_sessions.upsert({
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

        await db.school_whatsapp_sessions.upsert({
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
        await db.school_whatsapp_sessions.upsert({
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
            const violations = await db.student_violations.findMany({
              where: { guest_id: student.id },
              orderBy: { occurred_at: 'desc' },
              take: 5
            });

            const totalPoints = await db.student_violations.aggregate({
              where: { guest_id: student.id },
              _sum: { points: true }
            });

            const pointsSum = totalPoints._sum.points || 0;

            let attStatusText = 'Belum Ada Catatan Kehadiran';
            if (attendanceToday) {
              const att = attendanceToday as any;
              const jamMasuk = new Date(att.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              const jamPulang = att.check_out_time 
                ? new Date(att.check_out_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                : '-';
              attStatusText = `Hadir (Masuk: ${jamMasuk} WIB | Pulang: ${jamPulang})`;
              if (att.status === 'late') {
                attStatusText = `Terlambat (Masuk: ${jamMasuk} WIB | Pulang: ${jamPulang})`;
              }
            }

            let violationListText = 'Tidak ada catatan pelanggaran aktif. Pertahankan!';
            if (violations && violations.length > 0) {
              violationListText = violations.map((v: any, i: number) => {
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

  await db.school_whatsapp_sessions.upsert({
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

// Pemrosesan Antrean Terjadwal dengan Jitter & Human Typing (Anti-Ban Engine)
async function processOrgQueue(organizationId: string) {
  if (isProcessingQueue.get(organizationId)) return;

  isProcessingQueue.set(organizationId, true);
  const queue = outboundQueues.get(organizationId) || [];

  try {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const sock = activeSockets.get(organizationId);
      if (!sock) {
        item.resolve(false);
        continue;
      }

      const normalized = normalizePhoneNumber(item.toPhone);
      const jid = `${normalized}@s.whatsapp.net`;

      try {
        // 1. Kirim presence update 'composing' (simulasi mengetik)
        try {
          await sock.sendPresenceUpdate('composing', jid);
        } catch (e) {}

        // 2. Typing delay alami (600ms - 1400ms)
        await randomJitter(600, 1400);

        // 3. Kirim pesan ke WhatsApp
        await sock.sendMessage(jid, { text: item.text });

        // 4. Hentikan presence update
        try {
          await sock.sendPresenceUpdate('paused', jid);
        } catch (e) {}

        item.resolve(true);

        // 5. Anti-burst delay antar pesan berikutnya (1800ms - 3500ms)
        // Menjaga agar pengiriman tidak terdeteksi sebagai spam broadcast burst
        if (queue.length > 0) {
          await randomJitter(1800, 3500);
        }
      } catch (err: any) {
        console.error(`[WhatsApp Anti-Ban Queue] Failed sending to ${jid}:`, err);
        const isRateLimit = err?.output?.statusCode === 429 || err?.message?.includes('rate-limit');
        if (isRateLimit) {
          console.warn(`[WhatsApp Anti-Ban] Rate limit hit on org ${organizationId}. Cooling down 30s...`);
          await new Promise((r) => setTimeout(r, 30000));
        }
        item.resolve(false);
      }
    }
  } finally {
    isProcessingQueue.set(organizationId, false);
  }
}

// Pengiriman Pesan Mandiri (dengan Outbound Queue & Throttle)
export async function sendWhatsAppMessage(organizationId: string, toPhone: string, text: string): Promise<boolean> {
  const sock = activeSockets.get(organizationId);
  if (!sock) return false;

  if (!outboundQueues.has(organizationId)) {
    outboundQueues.set(organizationId, []);
  }

  const queue = outboundQueues.get(organizationId)!;
  // Batasi antrean maksimal 500 pesan agar memory tidak membengkak
  if (queue.length > 500) {
    console.warn(`[WhatsApp Queue] Queue overflow on org ${organizationId}, dropping message.`);
    return false;
  }

  return new Promise<boolean>((resolve) => {
    queue.push({ toPhone, text, resolve });
    processOrgQueue(organizationId).catch(console.error);
  });
}

// Notifikasi Presensi Siswa Otomatis ke Orang Tua (dengan Spintax & Dedup)
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
      return false;
    }

    const sock = activeSockets.get(organizationId);
    if (!sock) {
      return false;
    }

    // 1. Anti-Spam Deduplication: cegah duplikasi notifikasi identik untuk siswa yang sama dalam kurun waktu 5 menit
    const todayStr = time.toISOString().split('T')[0];
    const dedupKey = `${organizationId}:${student.id}:${type}:${todayStr}`;
    const nowMs = Date.now();
    const lastSent = dedupCache.get(dedupKey);

    if (lastSent && nowMs - lastSent < 5 * 60 * 1000) {
      console.log(`[WhatsApp Anti-Ban] Dropped duplicate ${type} notification for student ${student.name}`);
      return true;
    }
    dedupCache.set(dedupKey, nowMs);

    // Pembersihan berkala cache (memory leak prevention)
    if (dedupCache.size > 2000) {
      for (const [k, v] of dedupCache.entries()) {
        if (nowMs - v > 15 * 60 * 1000) dedupCache.delete(k);
      }
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
    const greeting = getRandomGreeting();
    const closing = getRandomClosing();
    const sig = getMessageSignature();

    // Pesan menggunakan Spintax acak + unique hash signature agar teks tidak dianggap copy-paste spam oleh Meta
    const message = `${icon} *NOTIFIKASI KEHADIRAN SISWA*\n----------------------------------------\n${greeting}\n👤 *Nama:* ${student.name}\n🏷️ *NIS:* ${student.identifier}${kelasInfo}\n\n📅 *Hari / Tanggal:* ${dateFormatted}\n⏰ *Waktu:* ${timeFormatted} WIB\n📍 *Status:* ${actionLabel} (${statusText})\n\n_${closing}_\n----------------------------------------\n_Pesan otomatis Sistem Presensi Gerbang KitaAtur School._\n_Ketik *CEK* untuk cek detail ananda._\n${sig}`;

    return await sendWhatsAppMessage(organizationId, parentPhone, message);
  } catch (err) {
    console.error('[WhatsApp Notification] Error sending attendance notification:', err);
    return false;
  }
}

// Notifikasi Pelanggaran Siswa ke Orang Tua (dengan Spintax & Anti-Burst)
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

    const totalPoints = await db.student_violations.aggregate({
      where: { guest_id: student.id },
      _sum: { points: true }
    });
    const total = totalPoints._sum.points || 0;

    const kelasInfo = student.kelas ? `\n🏫 *Kelas:* ${student.kelas}` : '';
    const tindakan = violation.action_taken ? `\n🛠️ *Tindakan BK:* ${violation.action_taken}` : '';
    const catatan = violation.notes ? `\n📝 *Catatan:* ${violation.notes}` : '';
    const greeting = getRandomGreeting();
    const sig = getMessageSignature();

    const message = `⚠️ *PEMBERITAHUAN PELANGGARAN SISWA*\n----------------------------------------\n${greeting}\n👤 *Nama:* ${student.name}\n🏷️ *NIS:* ${student.identifier}${kelasInfo}\n\nAnanda baru saja dicatat melakukan pelanggaran tata tertib sekolah:\n📌 *Pelanggaran:* ${violation.title}\n📊 *Kategori:* ${violation.category.toUpperCase()} (+${violation.points} Poin)${tindakan}${catatan}\n\n⚠️ *Total Akumulasi Poin Pelanggaran:* ${total} Poin\n\n----------------------------------------\n_Mohon bimbingan dan perhatian orang tua di rumah. Jika ada pertanyaan atau butuh klarifikasi, silakan berkonsultasi dengan Guru Bimbingan Konseling (BK) di sekolah._\n${sig}`;

    return await sendWhatsAppMessage(organizationId, parentPhone, message);
  } catch (err) {
    console.error('[WhatsApp Notification] Error sending violation notification:', err);
    return false;
  }
}

// Inisialisasi sesi WA yang aktif saat backend baru dinyalakan
export async function initActiveWhatsAppSessions() {
  try {
    const sessions = await db.school_whatsapp_sessions.findMany({
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

