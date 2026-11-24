const COUPONS = Object.freeze({
  FLOWER100: Object.freeze({ type: 'fixed', amount: 100, minSubtotal: 800 }),
  SPRING10: Object.freeze({ type: 'percent', percent: 10, maxDiscount: 300 }),
  SUMMER50: Object.freeze({ type: 'fixed', amount: 50, expired: true })
});

class CouponError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'CouponError';
  }
}

function assertValidSubtotal(subtotal) {
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new TypeError('subtotal 必須為非負有限數');
  }
}

function calculateDiscount(coupon, subtotal) {
  if (coupon.type === 'percent') {
    // Integer math keeps .5 boundaries exact (e.g. 1245 * 10 / 100 = 124.5)
    return Math.min(Math.round(subtotal * coupon.percent / 100), coupon.maxDiscount);
  }
  return coupon.amount;
}

/**
 * Validate a coupon against the product subtotal and return the discount.
 * Codes are case-insensitive; the result always carries the uppercase code.
 * Throws CouponError for unknown, expired or below-threshold coupons.
 */
function applyCoupon({ subtotal, couponCode }) {
  assertValidSubtotal(subtotal);

  if (typeof couponCode !== 'string' || couponCode.trim() === '') {
    throw new CouponError('優惠碼格式不正確');
  }

  const code = couponCode.trim().toUpperCase();
  const coupon = Object.prototype.hasOwnProperty.call(COUPONS, code) ? COUPONS[code] : null;

  if (!coupon) {
    throw new CouponError('優惠碼無效');
  }

  if (coupon.expired) {
    throw new CouponError('優惠碼已失效');
  }

  if (coupon.minSubtotal !== undefined && subtotal < coupon.minSubtotal) {
    throw new CouponError(`商品小計需滿 ${coupon.minSubtotal} 元才可使用此優惠碼`);
  }

  const discount = Math.min(calculateDiscount(coupon, subtotal), subtotal);

  return Object.freeze({
    couponCode: code,
    discount,
    discountedSubtotal: subtotal - discount
  });
}

module.exports = {
  COUPONS,
  CouponError,
  applyCoupon
};
