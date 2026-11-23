import { Request, Response } from 'express'
import { prisma } from '../config/db'

export async function getInventory(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' })
  }

  const { category, condition, search } = req.query

  try {
    const where: any = {
      organization_id: orgMemberContext.organizationId
    }

    if (category && category !== 'all') {
      where.category = category
    }
    if (condition && condition !== 'all') {
      where.condition = condition
    }
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { item_code: { contains: String(search), mode: 'insensitive' } },
        { location: { contains: String(search), mode: 'insensitive' } }
      ]
    }

    const items = await prisma.org_inventory.findMany({
      where,
      include: {
        creator: { select: { full_name: true, email: true } },
        loans: {
          where: { status: 'borrowed' },
          select: { id: true, borrower_name: true, quantity: true, loan_date: true, return_due_date: true }
        }
      },
      orderBy: { created_at: 'desc' }
    })

    // Compute summary stats
    let totalItems = 0
    let totalAvailable = 0
    let damagedCount = 0

    items.forEach((item: any) => {
      totalItems += item.quantity
      totalAvailable += item.available_quantity
      if (item.condition === 'damaged' || item.condition === 'slightly_damaged') {
        damagedCount += item.quantity
      }
    })

    const activeLoansCount = await prisma.org_inventory_loans.count({
      where: { organization_id: orgMemberContext.organizationId, status: 'borrowed' }
    })

    return res.json({
      items,
      summary: {
        totalItemTypes: items.length,
        totalItems,
        totalAvailable,
        totalBorrowed: totalItems - totalAvailable,
        damagedCount,
        activeLoansCount
      }
    })
  } catch (err: any) {
    console.error('Error fetching inventory:', err)
    return res.status(500).json({ error: 'Gagal memuat data inventaris' })
  }
}

export async function getInventoryItemById(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { itemId } = req.params

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' })
  }

  try {
    const item = await prisma.org_inventory.findFirst({
      where: { id: itemId, organization_id: orgMemberContext.organizationId },
      include: {
        creator: { select: { full_name: true, email: true } },
        loans: {
          orderBy: { loan_date: 'desc' }
        }
      }
    })

    if (!item) {
      return res.status(404).json({ error: 'Barang tidak ditemukan' })
    }

    return res.json(item)
  } catch (err: any) {
    console.error('Error fetching inventory item:', err)
    return res.status(500).json({ error: 'Gagal memuat detail barang' })
  }
}

export async function createInventoryItem(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const userId = req.user?.id
  const {
    name,
    item_code,
    category = 'Perlengkapan',
    quantity = 1,
    unit = 'unit',
    condition = 'good',
    location,
    purchase_date,
    purchase_price,
    notes,
    image_url
  } = req.body

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris' && orgMemberContext.role !== 'bendahara')) {
    return res.status(403).json({ error: 'Hanya Pengurus yang dapat menambah inventaris barang' })
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama barang wajib diisi' })
  }

  const qty = parseInt(quantity) || 1
  if (qty < 0) {
    return res.status(400).json({ error: 'Jumlah barang tidak boleh negatif' })
  }

  try {
    const item = await prisma.org_inventory.create({
      data: {
        organization_id: orgMemberContext.organizationId,
        name: name.trim(),
        item_code: item_code ? item_code.trim() : null,
        category,
        quantity: qty,
        available_quantity: qty,
        unit: unit || 'unit',
        condition: condition || 'good',
        location: location ? location.trim() : null,
        purchase_date: purchase_date ? new Date(purchase_date) : null,
        purchase_price: purchase_price ? parseFloat(purchase_price) : null,
        notes: notes ? notes.trim() : null,
        image_url: image_url || null,
        created_by: userId
      }
    })

    return res.status(201).json({
      message: `Barang "${item.name}" berhasil dicatat ke inventaris!`,
      item
    })
  } catch (err: any) {
    console.error('Error creating inventory item:', err)
    return res.status(500).json({ error: err.message || 'Gagal menyimpan barang ke inventaris' })
  }
}

export async function updateInventoryItem(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { itemId } = req.params
  const {
    name,
    item_code,
    category,
    quantity,
    unit,
    condition,
    location,
    purchase_date,
    purchase_price,
    notes,
    image_url
  } = req.body

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris' && orgMemberContext.role !== 'bendahara')) {
    return res.status(403).json({ error: 'Hanya Pengurus yang dapat mengedit barang inventaris' })
  }

  try {
    const existing = await prisma.org_inventory.findFirst({
      where: { id: itemId, organization_id: orgMemberContext.organizationId }
    })

    if (!existing) {
      return res.status(404).json({ error: 'Barang tidak ditemukan' })
    }

    let newQty = existing.quantity
    let newAvailable = existing.available_quantity

    if (quantity !== undefined) {
      const parsedQty = parseInt(quantity) || 0
      const diff = parsedQty - existing.quantity
      newQty = parsedQty
      newAvailable = Math.max(0, existing.available_quantity + diff)
    }

    const updated = await prisma.org_inventory.update({
      where: { id: itemId },
      data: {
        name: name ? name.trim() : existing.name,
        item_code: item_code !== undefined ? item_code?.trim() : existing.item_code,
        category: category || existing.category,
        quantity: newQty,
        available_quantity: newAvailable,
        unit: unit || existing.unit,
        condition: condition || existing.condition,
        location: location !== undefined ? location?.trim() : existing.location,
        purchase_date: purchase_date ? new Date(purchase_date) : existing.purchase_date,
        purchase_price: purchase_price !== undefined ? (purchase_price ? parseFloat(purchase_price) : null) : existing.purchase_price,
        notes: notes !== undefined ? notes?.trim() : existing.notes,
        image_url: image_url !== undefined ? image_url : existing.image_url
      }
    })

    return res.json({ message: 'Barang berhasil diperbarui', item: updated })
  } catch (err: any) {
    console.error('Error updating inventory item:', err)
    return res.status(500).json({ error: 'Gagal memperbarui barang' })
  }
}

export async function deleteInventoryItem(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { itemId } = req.params

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris' && orgMemberContext.role !== 'bendahara')) {
    return res.status(403).json({ error: 'Hanya Pengurus yang dapat menghapus barang inventaris' })
  }

  try {
    const existing = await prisma.org_inventory.findFirst({
      where: { id: itemId, organization_id: orgMemberContext.organizationId }
    })

    if (!existing) {
      return res.status(404).json({ error: 'Barang tidak ditemukan' })
    }

    await prisma.org_inventory.delete({
      where: { id: itemId }
    })

    return res.json({ message: 'Barang berhasil dihapus dari inventaris' })
  } catch (err: any) {
    console.error('Error deleting inventory item:', err)
    return res.status(500).json({ error: 'Gagal menghapus barang' })
  }
}

export async function createInventoryLoan(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const userId = req.user?.id
  const {
    inventory_id,
    borrower_name,
    borrower_contact,
    quantity = 1,
    loan_date,
    return_due_date,
    notes
  } = req.body

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris' && orgMemberContext.role !== 'bendahara')) {
    return res.status(403).json({ error: 'Hanya Pengurus yang dapat mencatat peminjaman barang' })
  }

  if (!inventory_id || !borrower_name) {
    return res.status(400).json({ error: 'Barang dan nama peminjam wajib diisi' })
  }

  const loanQty = parseInt(quantity) || 1
  if (loanQty <= 0) {
    return res.status(400).json({ error: 'Jumlah pinjam minimal 1' })
  }

  try {
    const item = await prisma.org_inventory.findFirst({
      where: { id: inventory_id, organization_id: orgMemberContext.organizationId }
    })

    if (!item) {
      return res.status(404).json({ error: 'Barang tidak ditemukan' })
    }

    if (item.available_quantity < loanQty) {
      return res.status(400).json({
        error: `Stok barang tidak mencukupi. Tersedia: ${item.available_quantity} ${item.unit}, diminta: ${loanQty} ${item.unit}`
      })
    }

    // Atomic transaction: create loan and decrement available quantity
    const [loan, updatedItem] = await prisma.$transaction([
      prisma.org_inventory_loans.create({
        data: {
          organization_id: orgMemberContext.organizationId,
          inventory_id,
          borrower_name: borrower_name.trim(),
          borrower_contact: borrower_contact ? borrower_contact.trim() : null,
          quantity: loanQty,
          loan_date: loan_date ? new Date(loan_date) : new Date(),
          return_due_date: return_due_date ? new Date(return_due_date) : null,
          status: 'borrowed',
          notes: notes ? notes.trim() : null,
          created_by: userId
        }
      }),
      prisma.org_inventory.update({
        where: { id: inventory_id },
        data: { available_quantity: item.available_quantity - loanQty }
      })
    ])

    return res.status(201).json({
      message: `Peminjaman ${loanQty} ${item.unit} "${item.name}" oleh "${borrower_name}" berhasil dicatat!`,
      loan,
      item: updatedItem
    })
  } catch (err: any) {
    console.error('Error creating inventory loan:', err)
    return res.status(500).json({ error: err.message || 'Gagal mencatat peminjaman' })
  }
}

export async function returnInventoryLoan(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { loanId } = req.params

  if (!orgMemberContext || (orgMemberContext.role !== 'head' && orgMemberContext.role !== 'vice_head' && orgMemberContext.role !== 'sekretaris' && orgMemberContext.role !== 'bendahara')) {
    return res.status(403).json({ error: 'Hanya Pengurus yang dapat memproses pengembalian barang' })
  }

  try {
    const loan = await prisma.org_inventory_loans.findFirst({
      where: { id: loanId, organization_id: orgMemberContext.organizationId },
      include: { inventory: true }
    })

    if (!loan) {
      return res.status(404).json({ error: 'Catatan peminjaman tidak ditemukan' })
    }

    if (loan.status === 'returned') {
      return res.status(400).json({ error: 'Barang sudah tercatat dikembalikan sebelumnya' })
    }

    // Atomic transaction: update loan status and restore item available quantity
    const [updatedLoan, updatedItem] = await prisma.$transaction([
      prisma.org_inventory_loans.update({
        where: { id: loanId },
        data: {
          status: 'returned',
          returned_date: new Date()
        }
      }),
      prisma.org_inventory.update({
        where: { id: loan.inventory_id },
        data: {
          available_quantity: {
            increment: loan.quantity
          }
        }
      })
    ])

    return res.json({
      message: `Barang "${loan.inventory.name}" berhasil dikembalikan oleh "${loan.borrower_name}"!`,
      loan: updatedLoan,
      item: updatedItem
    })
  } catch (err: any) {
    console.error('Error returning inventory loan:', err)
    return res.status(500).json({ error: 'Gagal memproses pengembalian barang' })
  }
}

export async function getInventoryLoans(req: any, res: Response) {
  const orgMemberContext = req.orgMember
  const { status = 'all' } = req.query

  if (!orgMemberContext) {
    return res.status(403).json({ error: 'Akses organisasi dibatasi' })
  }

  try {
    const where: any = { organization_id: orgMemberContext.organizationId }
    if (status !== 'all') {
      where.status = status
    }

    const loans = await prisma.org_inventory_loans.findMany({
      where,
      include: {
        inventory: { select: { id: true, name: true, item_code: true, unit: true, location: true } }
      },
      orderBy: { loan_date: 'desc' }
    })

    return res.json(loans)
  } catch (err: any) {
    console.error('Error getting inventory loans:', err)
    return res.status(500).json({ error: 'Gagal memuat data peminjaman' })
  }
}
