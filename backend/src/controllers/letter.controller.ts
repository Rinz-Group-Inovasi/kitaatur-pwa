import { Request, Response } from 'express'
import { prisma } from '../config/db'
import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = process.env.GEMINI_API_KEY || ''
const genAI = new GoogleGenerativeAI(apiKey)

export async function getLetters(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' })
  }

  const { type, category, status, search } = req.query

  try {
    const where: any = {
      organization_id: orgMemberContext.organizationId
    }

    if (type && type !== 'all') {
      where.letter_type = type
    }
    if (category && category !== 'all') {
      where.category = category
    }
    if (status && status !== 'all') {
      where.status = status
    }
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { letter_number: { contains: String(search), mode: 'insensitive' } },
        { sender: { contains: String(search), mode: 'insensitive' } },
        { recipient: { contains: String(search), mode: 'insensitive' } }
      ]
    }

    const letters = await prisma.org_letters.findMany({
      where,
      include: {
        creator: { select: { full_name: true, email: true } }
      },
      orderBy: { letter_date: 'desc' }
    })

    const incomingCount = await prisma.org_letters.count({
      where: { organization_id: orgMemberContext.organizationId, letter_type: 'incoming' }
    })
    const outgoingCount = await prisma.org_letters.count({
      where: { organization_id: orgMemberContext.organizationId, letter_type: 'outgoing' }
    })

    return res.json({
      letters,
      summary: {
        total: letters.length,
        incomingCount,
        outgoingCount
      }
    })
  } catch (err: any) {
    console.error('Error fetching letters:', err)
    return res.status(500).json({ error: 'Gagal memuat arsip surat' })
  }
}

export async function getLetterById(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { letterId } = req.params

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' })
  }

  try {
    const letter = await prisma.org_letters.findFirst({
      where: {
        id: letterId,
        organization_id: orgMemberContext.organizationId
      },
      include: {
        creator: { select: { full_name: true, email: true } }
      }
    })

    if (!letter) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' })
    }

    return res.json(letter)
  } catch (err: any) {
    console.error('Error fetching letter detail:', err)
    return res.status(500).json({ error: 'Gagal memuat detail surat' })
  }
}

export async function createLetter(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const userId = req.user?.id
  const {
    letter_type,
    letter_number,
    title,
    sender,
    recipient,
    letter_date,
    received_date,
    status = 'archived',
    category,
    description,
    file_url
  } = req.body

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang dapat mengelola arsip surat' })
  }

  if (!letter_type || !letter_number || !title) {
    return res.status(400).json({ error: 'Tipe surat, nomor surat, dan judul/perihal surat wajib diisi' })
  }

  try {
    const letter = await prisma.org_letters.create({
      data: {
        organization_id: orgMemberContext.organizationId,
        letter_type,
        letter_number: letter_number.trim(),
        title: title.trim(),
        sender: sender?.trim() || null,
        recipient: recipient?.trim() || null,
        letter_date: letter_date ? new Date(letter_date) : new Date(),
        received_date: received_date ? new Date(received_date) : null,
        status,
        category: category || 'Lainnya',
        description: description?.trim() || null,
        file_url: file_url || null,
        created_by: userId
      }
    })

    return res.status(201).json({
      message: `${letter_type === 'incoming' ? 'Surat Masuk' : 'Surat Keluar'} berhasil diarsipkan!`,
      letter
    })
  } catch (err: any) {
    console.error('Error creating letter:', err)
    return res.status(500).json({ error: err.message || 'Gagal menyimpan arsip surat' })
  }
}

export async function updateLetter(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { letterId } = req.params
  const {
    letter_type,
    letter_number,
    title,
    sender,
    recipient,
    letter_date,
    received_date,
    status,
    category,
    description,
    file_url
  } = req.body

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang dapat memperbarui arsip surat' })
  }

  try {
    const existing = await prisma.org_letters.findFirst({
      where: { id: letterId, organization_id: orgMemberContext.organizationId }
    })

    if (!existing) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' })
    }

    const updated = await prisma.org_letters.update({
      where: { id: letterId },
      data: {
        letter_type: letter_type || existing.letter_type,
        letter_number: letter_number ? letter_number.trim() : existing.letter_number,
        title: title ? title.trim() : existing.title,
        sender: sender !== undefined ? sender?.trim() : existing.sender,
        recipient: recipient !== undefined ? recipient?.trim() : existing.recipient,
        letter_date: letter_date ? new Date(letter_date) : existing.letter_date,
        received_date: received_date ? new Date(received_date) : existing.received_date,
        status: status || existing.status,
        category: category || existing.category,
        description: description !== undefined ? description?.trim() : existing.description,
        file_url: file_url !== undefined ? file_url : existing.file_url
      }
    })

    return res.json({ message: 'Arsip surat berhasil diperbarui', letter: updated })
  } catch (err: any) {
    console.error('Error updating letter:', err)
    return res.status(500).json({ error: 'Gagal memperbarui arsip surat' })
  }
}

export async function deleteLetter(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { letterId } = req.params

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris')) {
    return res.status(403).json({ error: 'Hanya Ketua, Wakil Ketua, dan Sekretaris yang dapat menghapus arsip surat' })
  }

  try {
    const existing = await prisma.org_letters.findFirst({
      where: { id: letterId, organization_id: orgMemberContext.organizationId }
    })

    if (!existing) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' })
    }

    await prisma.org_letters.delete({
      where: { id: letterId }
    })

    return res.json({ message: 'Arsip surat berhasil dihapus' })
  } catch (err: any) {
    console.error('Error deleting letter:', err)
    return res.status(500).json({ error: 'Gagal menghapus arsip surat' })
  }
}

export async function generateLetterNumberAI(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { category = 'Undangan', title = '' } = req.body

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses ditolak' })
  }

  try {
    const org = await prisma.organizations.findUnique({
      where: { id: orgMemberContext.organizationId }
    })

    const currentCount = await prisma.org_letters.count({
      where: { organization_id: orgMemberContext.organizationId, letter_type: 'outgoing' }
    })

    const nextIndex = String(currentCount + 1).padStart(3, '0')
    const now = new Date()
    const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
    const romanMonth = romanMonths[now.getMonth()]
    const year = now.getFullYear()
    const orgCode = (org?.slug || 'ORG').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)

    const defaultFormat = `${nextIndex}/${orgCode}/${category.toUpperCase().slice(0, 3)}/${romanMonth}/${year}`

    return res.json({
      suggested_number: defaultFormat,
      index: currentCount + 1,
      org_code: orgCode
    })
  } catch (err: any) {
    return res.status(500).json({ error: 'Gagal men-generate nomor surat' })
  }
}
