const { createOrderFromCart, findInvalidQuantityItems } = require('../src/services/orderService');
const db = require('../src/database');

describe('orderService quantity guards', () => {
  const invalidQuantities = [0.125, 1.5, 0, -1, null, '2'];

  it.each(invalidQuantities)('createOrderFromCart rejects quantity %s', (quantity) => {
    expect(() => createOrderFromCart({
      userId: 'u',
      recipient: { name: 'n', email: 'e@example.com', address: 'a' },
      delivery: { method: 'home_delivery', isRemoteArea: false, isExpress: false },
      cartItems: [{ product_id: 'p', product_name: 'x', product_price: 100, quantity }],
      subtotal: 100,
      shipping: { shippingFee: 0, totalAmount: 100 }
    })).toThrow(TypeError);
  });

  it('findInvalidQuantityItems flags only non-positive-integer quantities', () => {
    const items = [{ quantity: 1 }, { quantity: 0.5 }, { quantity: 0 }, { quantity: 3 }];
    expect(findInvalidQuantityItems(items)).toEqual([{ quantity: 0.5 }, { quantity: 0 }]);
  });

  it('cart_items rejects fractional quantity on insert and update', () => {
    const product = db.prepare('SELECT id FROM products LIMIT 1').get();
    const insert = db.prepare(
      'INSERT INTO cart_items (id, session_id, product_id, quantity) VALUES (?, ?, ?, ?)'
    );

    expect(() => insert.run('frac-item', 'frac-session', product.id, 0.125))
      .toThrow('quantity must be a positive integer');

    insert.run('ok-item', 'frac-session', product.id, 1);
    expect(() => db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(1.5, 'ok-item'))
      .toThrow('quantity must be a positive integer');
    db.prepare('DELETE FROM cart_items WHERE id = ?').run('ok-item');
  });

  it('order_items rejects fractional quantity', () => {
    expect(() => db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('x', 'any-order', 'any-product', 'n', 100, 0.5)).toThrow('quantity must be a positive integer');
  });

  it('installs the quantity guard triggers', () => {
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%_quantity_%'"
    ).all().map(r => r.name).sort();
    expect(names).toEqual([
      'trg_cart_items_quantity_insert',
      'trg_cart_items_quantity_update',
      'trg_order_items_quantity_insert',
      'trg_order_items_quantity_update'
    ]);
  });
});
