const { COUPONS, CouponError, applyCoupon } = require('../src/utils/coupon');

describe('Coupon module', () => {
  describe('FLOWER100', () => {
    it('小計 800 元可使用，折抵 100 元', () => {
      expect(applyCoupon({ subtotal: 800, couponCode: 'FLOWER100' })).toMatchObject({
        couponCode: 'FLOWER100',
        discount: 100,
        discountedSubtotal: 700
      });
    });

    it('小計 799 元未達門檻，丟出 CouponError', () => {
      expect(() => applyCoupon({ subtotal: 799, couponCode: 'FLOWER100' })).toThrow(CouponError);
    });
  });

  describe('SPRING10', () => {
    it.each([
      [1000, 100],
      [1234, 123],
      [1235, 124],
      [5, 1],
      [4, 0],
      [3000, 300],
      [3500, 300]
    ])('小計 %i 元折抵 %i 元（四捨五入、上限 300）', (subtotal, discount) => {
      const result = applyCoupon({ subtotal, couponCode: 'SPRING10' });

      expect(result.discount).toBe(discount);
      expect(result.discountedSubtotal).toBe(subtotal - discount);
    });

    it('無門檻：小計 0 元也可使用，折抵 0 元', () => {
      expect(applyCoupon({ subtotal: 0, couponCode: 'SPRING10' }).discount).toBe(0);
    });
  });

  describe('無效優惠碼', () => {
    it('SUMMER50 已失效', () => {
      expect(() => applyCoupon({ subtotal: 1000, couponCode: 'SUMMER50' })).toThrow('已失效');
    });

    it.each(['NOT-A-COUPON', 'constructor', '__proto__', 'toString'])('未知優惠碼 %s 回 CouponError', (code) => {
      expect(() => applyCoupon({ subtotal: 1000, couponCode: code })).toThrow(CouponError);
    });

    it.each([['空字串', ''], ['空白', '   '], ['數字', 100], ['物件', {}], ['陣列', ['FLOWER100']]])(
      '格式不正確（%s）回 CouponError',
      (_label, code) => {
        expect(() => applyCoupon({ subtotal: 1000, couponCode: code })).toThrow(CouponError);
      }
    );
  });

  describe('正規化', () => {
    it('不分大小寫並去除前後空白，回傳大寫代碼', () => {
      expect(applyCoupon({ subtotal: 800, couponCode: ' flower100 ' }).couponCode).toBe('FLOWER100');
      expect(applyCoupon({ subtotal: 1000, couponCode: 'Spring10' }).couponCode).toBe('SPRING10');
    });
  });

  describe('輸入防護', () => {
    it.each([-1, NaN, Infinity, '800', null, undefined])('subtotal %s 丟出 TypeError', (subtotal) => {
      expect(() => applyCoupon({ subtotal, couponCode: 'SPRING10' })).toThrow(TypeError);
    });

    it('優惠碼表為凍結物件，無法被改寫', () => {
      expect(Object.isFrozen(COUPONS)).toBe(true);
    });
  });
});
