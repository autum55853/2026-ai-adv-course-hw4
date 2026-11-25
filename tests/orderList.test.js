const { app, request, registerUser } = require('./setup');

async function placeOrders(token, count) {
  const prodRes = await request(app).get('/api/products');
  const productId = prodRes.body.data.products[0].id;
  for (let i = 0; i < count; i++) {
    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 1 });
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientName: '測試收件人',
        recipientEmail: 'recipient@example.com',
        recipientAddress: '台北市測試路 123 號',
        shippingMethod: 'home_delivery',
        isRemoteArea: false,
        isExpress: false,
      });
    expect(res.status).toBe(201);
  }
}

const list = (token, query = '') =>
  request(app).get(`/api/orders${query}`).set('Authorization', `Bearer ${token}`);

describe('GET /api/orders 篩選與分頁（邊界）', () => {
  let token;

  beforeAll(async () => {
    ({ token } = await registerUser());
    await placeOrders(token, 3);
  });

  it('page 超出範圍時回傳空陣列，total 與 totalPages 仍正確', async () => {
    const res = await list(token, '?page=9&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toEqual([]);
    expect(res.body.data.pagination).toEqual({ page: 9, limit: 2, total: 3, totalPages: 2 });
  });

  it('沒有符合 status 的訂單時回傳空陣列與 totalPages 0', async () => {
    const res = await list(token, '?status=failed');
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toEqual([]);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it.each([
    '?page=abc',
    '?page=1.5',
    '?limit=0',
    '?limit=3abc',
    '?status=',
    '?status=paid&status=pending',
    '?page=1&page=2',
  ])('非法參數 %s 回傳 400 VALIDATION_ERROR 且 data 為 null', async query => {
    const res = await list(token, query);
    expect(res.status).toBe(400);
    expect(res.body.data).toBeNull();
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('未帶 token 回傳 401', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });
});
