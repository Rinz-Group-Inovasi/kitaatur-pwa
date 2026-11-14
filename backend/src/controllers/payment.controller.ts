import { Request, Response } from 'express'
import { prisma } from '../config/db'

export async function createCheckout(req: Request, res: Response) {
  const { planType, amount, baseAmount, userId, voucherCode } = req.body

  if (!planType || !userId) {
    return res.status(400).json({ error: 'Missing required parameters: planType or userId' })
  }

  try {
    const planLower = String(planType || '').toLowerCase()
    const isYearly = planLower.includes('yearly')

    // Tentukan harga dasar paket (sebelum PPN dan biaya layanan)
    let basePrice = Number(baseAmount) || 0
    if (basePrice <= 0) {
      if (planLower.includes('family')) {
        basePrice = isYearly ? 2500000 : 250000
      } else if (planLower.includes('pro')) {
        basePrice = isYearly ? 1100000 : 110000
      } else {
        basePrice = isYearly ? 400000 : 40000
      }
    }

    let discountAmount = 0
    let appliedVoucher: any = null

    // 1. Validasi voucher jika disertakan (HANYA mendiskon harga dasar)
    if (voucherCode && typeof voucherCode === 'string' && voucherCode.trim()) {
      const cleanCode = voucherCode.trim().toUpperCase()
      const vouchers = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM public.vouchers WHERE UPPER(code) = $1 AND is_active = true LIMIT 1`,
        cleanCode
      )

      if (vouchers && vouchers.length > 0) {
        const v = vouchers[0]
        const now = new Date()
        const isNotExpired = (!v.starts_at || new Date(v.starts_at) <= now) && (!v.expires_at || new Date(v.expires_at) >= now)
        const isUnderLimit = v.usage_limit === null || v.usage_limit === undefined || Number(v.used_count) < Number(v.usage_limit)
        const meetsMinPurchase = basePrice >= (Number(v.min_purchase_amount) || 0)

        const appPlans = (v.applicable_plans || 'all').trim().toLowerCase()
        const planAllowed = appPlans === 'all' || appPlans.split(',').some((p: string) => planLower.includes(p.trim()))

        if (isNotExpired && isUnderLimit && meetsMinPurchase && planAllowed) {
          const discountVal = Number(v.discount_value) || 0
          if (v.discount_type === 'percentage') {
            const rawDiscount = (basePrice * discountVal) / 100
            const maxDiscount = v.max_discount_amount ? Number(v.max_discount_amount) : null
            discountAmount = maxDiscount ? Math.min(rawDiscount, maxDiscount) : rawDiscount
          } else {
            discountAmount = Math.min(discountVal, basePrice)
          }

          discountAmount = Math.round(discountAmount)
          // Voucher HANYA mendiskon harga dasar (maksimal sampai harga dasar habis)
          discountAmount = Math.min(discountAmount, basePrice)
          appliedVoucher = v
        }
      }
    }

    // Harga dasar setelah diskon voucher (Dasar Pengenaan Pajak)
    const discountedBasePrice = Math.max(0, basePrice - discountAmount)

    // PPN 11% mengikuti hitungan dasar dari harga paket (setelah dipotong diskon)
    const ppn = Math.round(discountedBasePrice * 0.11)

    // Subtotal bersih yang ditagihkan: Harga dasar setelah diskon + PPN 11%
    const netSubtotal = discountedBasePrice + ppn

    const durationDays = isYearly ? 365 : 30
    const subscriptionExpiry = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)

    // 2. Jika netSubtotal === 0 (hanya bila benar-benar 100% bebas biaya)
    if (netSubtotal <= 0) {
      const robustOrderId = `free_${planType}_${userId}_${Date.now()}`
      const createdSub = await prisma.$queryRawUnsafe<any[]>(
        `
        INSERT INTO public.subscriptions (
          profile_id,
          status,
          plan_type,
          amount_paid,
          starts_at,
          expires_at,
          payment_url,
          voucher_code,
          discount_amount,
          original_amount
        ) VALUES ($1::uuid, 'active', $2, 0, timezone('utc'::text, now()), $3::timestamptz, 'FREE_VOUCHER_100', $4, $5, $6)
        RETURNING id
        `,
        userId,
        planType,
        subscriptionExpiry,
        appliedVoucher?.code || null,
        discountAmount,
        basePrice + ppn
      )

      if (appliedVoucher) {
        await prisma.$executeRawUnsafe(
          `UPDATE public.vouchers SET used_count = used_count + 1 WHERE id = $1::uuid`,
          appliedVoucher.id
        )
      }

      return res.status(200).json({
        success: true,
        isFree: true,
        orderId: robustOrderId,
        subscriptionId: createdSub[0]?.id,
        discountAmount,
        finalAmount: 0,
        message: 'Selamat! Langganan Anda langsung aktif dengan voucher diskon 100%!'
      })
    }

    // 3. Jika berbayar (> 0), buat transaksi di KitaPay
    const merchantId = process.env.KITAPAY_MERCHANT_ID
    const apiKey = process.env.KITAPAY_API_KEY
    const targetWebhookUrl = process.env.KITAPAY_WEBHOOK_URL || 'https://kitaatur-sept-production.up.railway.app/api/webhooks/kitapay'
    
    if (!merchantId || !apiKey) {
      console.error('KITAPAY_MERCHANT_ID or KITAPAY_API_KEY is not defined in .env')
      return res.status(500).json({ error: 'Payment gateway is not configured properly' })
    }

    const userProfile = await prisma.profiles.findUnique({
      where: { id: userId }
    })
    const realEmail = userProfile?.email || "user@kitaatur.com"
    const robustOrderId = `sub_${planType}_${userId}_${Date.now()}`

    const baseUrl = process.env.KITAPAY_API_URL || 'http://localhost:4000'
    const response = await fetch(`${baseUrl}/api/payments/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merchantId,
        amount: Number(netSubtotal),
        chargeFeeToCustomer: true,
        externalId: robustOrderId,
        targetWebhookUrl,
        customerEmail: realEmail,
        customerWhatsapp: "081234567890",
        paymentMethod: "qris"
      })
    })

    const result: any = await response.json()

    if (!response.ok || !result.success || !result.transactionId) {
      console.error('KitaPay Error:', result)
      throw new Error('Gagal mendapatkan respon pembayaran dari KitaPay')
    }

    const { transactionId, qrisString: qrString, amount: resultAmount } = result

    // Biaya Layanan KitaPay resmi: <= 100k: Rp 1.500 flat, > 100k: 1.5% (Math.ceil(amount / 0.985) - amount)
    const expectedFee = netSubtotal <= 100000 ? 1500 : Math.ceil(netSubtotal / 0.985) - netSubtotal
    const chargedAmount = Number(resultAmount || (netSubtotal + expectedFee))

    const createdSub = await prisma.$queryRawUnsafe<any[]>(
      `
      INSERT INTO public.subscriptions (
        profile_id,
        kitapay_transaction_id,
        status,
        plan_type,
        amount_paid,
        starts_at,
        expires_at,
        payment_url,
        voucher_code,
        discount_amount,
        original_amount
      ) VALUES ($1::uuid, $2, 'unpaid', $3, $4, timezone('utc'::text, now()), $5::timestamptz, $6, $7, $8, $9)
      RETURNING id
      `,
      userId,
      transactionId,
      planType,
      chargedAmount,
      subscriptionExpiry,
      qrString || '',
      appliedVoucher?.code || null,
      discountAmount,
      basePrice + ppn
    )

    if (appliedVoucher) {
      await prisma.$executeRawUnsafe(
        `UPDATE public.vouchers SET used_count = used_count + 1 WHERE id = $1::uuid`,
        appliedVoucher.id
      )
    }

    return res.status(200).json({ 
      success: true, 
      transactionId,
      orderId: robustOrderId,
      subscriptionId: createdSub[0]?.id,
      discountAmount,
      subtotalAmount: netSubtotal,
      paymentFee: chargedAmount - netSubtotal,
      finalAmount: chargedAmount
    })

  } catch (err: any) {
    console.error('Error creating checkout:', err.message || err)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
}
