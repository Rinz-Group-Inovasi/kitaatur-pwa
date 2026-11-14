/**
 * Perhitungan Biaya Langganan & Biaya Layanan Pembayaran KitaPay
 * Sesuai Dokumen Resmi & Implementasi KitaPay:
 * - PPN: 11% dari harga dasar paket
 * - Biaya Layanan Pembayaran KitaPay (chargeFeeToCustomer):
 *   * Tier 1 (Nominal <= Rp 100.000): Rp 1.500 (Flat)
 *   * Tier 2 (Nominal > Rp 100.000): 1,5% transaksi (formula: Math.ceil(amount / 0.985) - amount)
 */

export interface PricingBreakdown {
  basePrice: number
  ppn: number
  subtotalWithTax: number
  discountAmount: number
  subtotalAfterDiscount: number
  paymentFee: number
  totalPayable: number
  feeTier: 'Tier 1' | 'Tier 2' | 'None'
  feeLabel: string
  isFree: boolean
}

export function calculateSubscriptionPrice(
  basePrice: number,
  discountAmount: number = 0
): PricingBreakdown {
  const ppn = Math.round(basePrice * 0.11)
  const subtotalWithTax = basePrice + ppn
  const subtotalAfterDiscount = Math.max(0, subtotalWithTax - discountAmount)

  if (subtotalAfterDiscount <= 0) {
    return {
      basePrice,
      ppn,
      subtotalWithTax,
      discountAmount,
      subtotalAfterDiscount: 0,
      paymentFee: 0,
      totalPayable: 0,
      feeTier: 'None',
      feeLabel: 'Gratis',
      isFree: true
    }
  }

  let paymentFee = 0
  let totalPayable = subtotalAfterDiscount
  let feeTier: 'Tier 1' | 'Tier 2' = 'Tier 1'
  let feeLabel = 'Rp 1.500'

  if (subtotalAfterDiscount <= 100000) {
    paymentFee = 1500
    totalPayable = subtotalAfterDiscount + 1500
    feeTier = 'Tier 1'
    feeLabel = 'Rp 1.500 (Flat)'
  } else {
    // Formula resmi KitaPay untuk chargeFeeToCustomer: Math.ceil(amount / 0.985)
    totalPayable = Math.ceil(subtotalAfterDiscount / 0.985)
    paymentFee = totalPayable - subtotalAfterDiscount
    feeTier = 'Tier 2'
    feeLabel = '1,5%'
  }

  return {
    basePrice,
    ppn,
    subtotalWithTax,
    discountAmount,
    subtotalAfterDiscount,
    paymentFee,
    totalPayable,
    feeTier,
    feeLabel,
    isFree: false
  }
}
