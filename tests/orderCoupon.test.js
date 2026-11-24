const { app, request, getAdminToken, registerUser } = require('./setup');

const ORDER_BODY = {
  recipientName: '測試收件人',
  recipientEmail: 'recipient@example.com',
  recipientAddress: '台北市測試路 123 號',
  shippingMethod: 'home_delivery',
  isRemoteArea: false,
  isExpress: false,
};

describe('Orders API - coupon', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  async function cartWithPrice(price, quantity = 1) {
    const { token } = await registerUser();
    const created = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `優惠碼測試商品 ${Date.now()}-${Math.random()}`, price, stock: 20 });
    const product = created.body.data;
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: product.id, quantity });
    return { token, product };
  }

  function placeOrder(token, extra = {}) {
    return request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...ORDER_BODY, ...extra });
  }

  it('未帶 couponCode 時 discount 為 0、coupon_code 為 null', async () => {
    const { token } = await cartWithPrice(500);
    const res = await placeOrder(token);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ discount: 0, coupon_code: null, total_amount: 620 });
  });

  it('couponCode 為 null 視同未使用', async () => {
    const { token } = await cartWithPrice(500);
    const res = await placeOrder(token, { couponCode: null });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ discount: 0, coupon_code: null });
  });

  it('小寫優惠碼以大寫記錄，訂單列表與詳情皆回傳折扣', async () => {
    const { token } = await cartWithPrice(1000);
    const res = await placeOrder(token, { couponCode: 'spring10' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ discount: 100, coupon_code: 'SPRING10', total_amount: 1020 });

    const list = await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.orders[0]).toMatchObject({ discount: 100, coupon_code: 'SPRING10' });

    const detail = await request(app)
      .get(`/api/orders/${res.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data).toMatchObject({ discount: 100, coupon_code: 'SPRING10', total_amount: 1020 });
  });

  it('優惠碼折抵不含運費：超商 + 偏遠 + 急件附加費照收', async () => {
    const { token } = await cartWithPrice(1000);
    const res = await placeOrder(token, {
      couponCode: 'FLOWER100',
      shippingMethod: 'convenience_store',
      isRemoteArea: true,
      isExpress: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subtotal: 1000, discount: 100, shipping_fee: 510, total_amount: 1410 });
  });

  it.each([
    ['數字', 100],
    ['布林', true],
    ['物件', { code: 'FLOWER100' }],
    ['空字串', ''],
  ])('couponCode 型別或格式錯誤（%s）回 400 COUPON_INVALID', async (_label, couponCode) => {
    const { token } = await cartWithPrice(1000);
    const res = await placeOrder(token, { couponCode });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ data: null, error: 'COUPON_INVALID' });
  });

  it('優惠碼無效時，不建立訂單、不扣庫存、不清空購物車', async () => {
    const { token, product } = await cartWithPrice(1000, 2);
    const res = await placeOrder(token, { couponCode: 'SUMMER50' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ data: null, error: 'COUPON_INVALID' });

    const orders = await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`);
    expect(orders.body.data.orders).toHaveLength(0);

    const stock = await request(app).get(`/api/products/${product.id}`);
    expect(stock.body.data.stock).toBe(20);

    const cart = await request(app).get('/api/cart').set('Authorization', `Bearer ${token}`);
    expect(cart.body.data.items).toHaveLength(1);
  });

  it('後台訂單詳情可看到優惠碼與折扣', async () => {
    const { token } = await cartWithPrice(800);
    const created = await placeOrder(token, { couponCode: 'FLOWER100' });

    const res = await request(app)
      .get(`/api/admin/orders/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ discount: 100, coupon_code: 'FLOWER100' });
  });
});
