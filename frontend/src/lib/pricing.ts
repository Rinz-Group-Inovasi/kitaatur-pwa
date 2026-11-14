/**
 * Perhitungan Biaya Langganan & Biaya Layanan Pembayaran KitaPay
 * Sesuai Ketentuan Bisnis & Dokumentasi Resmi KitaPay:
 * - Voucher HANYA mendiskon Harga Dasar paket (tidak mendiskon PPN maupun Layanan KitaPay)
 * - PPN: 11% dari harga dasar paket (tetap ada dan tidak didiskon oleh voucher)
 * - Biaya Layanan Pembayaran KitaPay (chargeFeeToCustomer):
 *   * Tier 1 (Nominal <= Rp 100.000): Rp 1.500 (Flat)
 *   * Tier 2 (Nominal > Rp 100.000): 1,5% transaksi (formula: Math.ceil(amount / 0.985) - amount)
 */

export interface PricingBreakdown {
  basePrice: number
  discountAmount: number
  discountedBasePrice: number
  ppn: number
  netSubtotal: number // discountedBasePrice + ppn
  paymentFee: number
  totalPayable: number // netSubtotal + paymentFee
  feeTier: 'Tier 1' | 'Tier 2' | 'None'
  feeLabel: string
  isFree: boolean
}

export function calculateSubscriptionPrice(
  basePrice: number,
  rawDiscount: number = 0
): PricingBreakdown {
  // 1. Voucher HANYA mendiskon harga dasar (maksimal senilai harga dasar)
  const discountAmount = Math.min(Math.max(0, Math.round(rawDiscount)), basePrice)
  const discountedBasePrice = Math.max(0, basePrice - discountAmount)

  // 2. PPN 11% dihitung dari harga dasar paket dan TIDAK didiskon oleh voucher
  const ppn = Math.round(basePrice * 0.11)

  // 3. Subtotal bersih yang harus dibayar sebelum biaya layanan (Harga dasar terdiskon + PPN)
  const netSubtotal = discountedBasePrice + ppn

  if (netSubtotal <= 0) {
    return {
      basePrice,
      discountAmount,
      discountedBasePrice: 0,
      ppn: 0,
      netSubtotal: 0,
      paymentFee: 0,
      totalPayable: 0,
      feeTier: 'None',
      feeLabel: 'Gratis',
      isFree: true
    }
  }

  // 4. Biaya Layanan Pembayaran KitaPay dihitung dari netSubtotal (TIDAK didiskon oleh voucher)
  let paymentFee = 0
  let totalPayable = netSubtotal
  let feeTier: 'Tier 1' | 'Tier 2' = 'Tier 1'
  let feeLabel = 'Rp 1.500 (Flat)'

  if (netSubtotal <= 100000) {
    paymentFee = 1500
    totalPayable = netSubtotal + 1500
    feeTier = 'Tier 1'
    feeLabel = 'Rp 1.500 (Flat)'
  } else {
    // Formula resmi KitaPay untuk chargeFeeToCustomer: Math.ceil(amount / 0.985)
    totalPayable = Math.ceil(netSubtotal / 0.985)
    paymentFee = totalPayable - netSubtotal
    feeTier = 'Tier 2'
    feeLabel = '1,5%'
  }

  return {
    basePrice,
    discountAmount,
    discountedBasePrice,
    ppn,
    netSubtotal,
    paymentFee,
    totalPayable,
    feeTier,
    feeLabel,
    isFree: false
  }
}
