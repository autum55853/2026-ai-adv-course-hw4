# AI Review：訂單、付款、運費、購物車

> 審查日期：2026-11-16　分支：`AI`　狀態：**H1~H3 已修復（見各節「修復狀態」），M/L 項目尚未處理**
> 審查者：security-reviewer、code-reviewer（唯讀）、test-runner
> 範圍：`src/routes/{orderRoutes,cartRoutes,pageRoutes,adminOrderRoutes}.js`、`src/services/*`、`src/utils/{ecpay,shipping}.js`、`src/database.js`、相關 `tests/`

## 1. 測試執行結果（test-runner）

> **H1~H3 修復後（沙箱外執行，exit code 0）**：`test:unit` 8 files、70 passed、0 skipped；`test:integration` 1 file、10 passed。以下為修復前的審查基準。

| 指令 | 檔案 | 結果 |
|---|---|---|
| `npm run test:unit` | 7 files | 54 passed、**1 skipped** |
| `npm run test:integration` | 1 file | 10 passed |

- 兩次 exit code 皆為 1，原因**不是測試失敗**：vitest 寫快取 `node_modules/.vite/vitest/results.json` 時被沙箱擋下（`EROFS: read-only file system`）。尚未在沙箱外重跑確認 exit code。
- 唯一 skip：`tests/shipping.test.js:29` `it.skip('商品小計 1,500 元時免基本運費')`，與下方 H2 直接相關。
- 全專案無 `.only` / `.todo` / `xit`。未跑 e2e 與 acceptance（acceptance 對應 cancel、coupon、order-filter 尚未實作，屬預期紅燈）。

## 2. 問題總表

| ID | 嚴重度 | 位置 | 問題 | 來源 |
|---|---|---|---|---|
| H1 ✅ | HIGH | `cartRoutes.js:296-315` | PATCH 數量未驗證正整數：小數數量可低價下單；`0`/`-1`/`null` 回 500 | 兩者 |
| H2 ✅ | HIGH | `shipping.js:40`、`tests/shipping.test.js:29` | 免運門檻 `>` 應為 `>=`（規格「滿 1,500」），對應測試被 `it.skip` | code |
| H3 ✅ | MEDIUM~HIGH | `orderRoutes.js:350-364` | `GET /api/orders/:id` 無擁有者檢查（IDOR），洩漏收件人 PII | 兩者 |
| M1 | MEDIUM | `ecpay.js:4-6` | 綠界憑證寫死 fallback，違反全域規則（應 fail-fast） | 兩者 |
| M2 | MEDIUM | `database.js:116-117` | 預設管理員 `admin@hexschool.com` / `12345678`，production 漏設環境變數即可被登入 | security |
| M3 | MEDIUM | `orderService.js:67-112`、`orderRoutes.js:113-217` | 下單即扣庫存，無逾時釋放／取消機制，可被惡意佔光庫存 | security |
| M4 | MEDIUM | `paymentService.js:15` | 缺少 `CheckMacValue` 時跳過簽章驗證 | 兩者 |
| M5 | MEDIUM | `orderService.js:67-112`、`orderRoutes.js:157-195` | 庫存檢查在 transaction 外、扣庫存無 `AND stock >= ?`；失敗回 500 而非 400 `STOCK_INSUFFICIENT` | code |
| M6 | MEDIUM | `orderRoutes.js:496-545` | check-payment 冪等／併發缺測試，未檢查 `markOrderPaid` 回傳值 | code |
| L1 | LOW | `pageRoutes.js:61-72` | `GET /ecpay/payment/:orderId` 不需認證、不驗擁有者 | security |
| L2 | LOW | `orderService.js:4-11` | 訂單編號僅 5 碼 hex 亂碼，撞號時 UNIQUE 失敗回 500；`merchant_trade_no` 無 UNIQUE 索引 | code |
| L3 | LOW | `orderRoutes.js:433-470` | mock pay `fail` 不回補庫存（僅 test 環境） | code |
| L4 | LOW | `database.js:66` | `orders.status` CHECK 不含 `cancelled`，實作 Issue B 時需同步改 | code |
| L5 | INFO | `ecpay.js:114` | ReturnURL 指向 `/ecpay/notify`，但無此路由；上線前須實作（含簽章驗證、金額比對、冪等） | 兩者 |

## 3. 問題細節

### H1. PATCH 購物車數量未驗證（`cartRoutes.js:296-315`）
- 只檢查 `Number.isNaN` 與 `qty > stock`；POST 已用 `parsePositiveInteger`，PATCH 沒沿用。規格要求「quantity 必須為正整數」，錯誤應為 400 `VALIDATION_ERROR`。
- **已用 in-memory DB + supertest 重現**：1680 元商品 PATCH `quantity: 0.125` → 200；下單 201，subtotal=210、運費 60、total=270，`order_items.quantity=0.125`，庫存 30 → 29.875，綠界 `TotalAmount=270`，付 270 即可成交。
- `0`、`-1`、`null` 觸發 DB `CHECK(quantity>0)` → 500 INTERNAL_ERROR。`1.5` 回 200。
- 修法：PATCH 改用 `parsePositiveInteger`；`createOrderFromCart` / `getCheckoutItems` 加 `Number.isInteger` 檢查；DB 可加 `CHECK(quantity = CAST(quantity AS INTEGER))`。
- 測試缺口：無任何 PATCH 非法數量測試（0、-1、1.5、"abc"、null、超過庫存）。
- **修復狀態：✅ 已修復**
  - `cartRoutes.js` PATCH 改用 `parsePositiveInteger`，非法值回 400 `VALIDATION_ERROR`。
  - `POST /api/orders` 以 `findInvalidQuantityItems` 擋下購物車內的非法數量（400）；`createOrderFromCart` 在 transaction 前加 `Number.isInteger` 檢查（拋 `TypeError`）。
  - DB 防線採 idempotent trigger（`cart_items`、`order_items` 的 INSERT / `UPDATE OF quantity`），而非 `CHECK`：`CREATE TABLE IF NOT EXISTS` 不會改既有資料表，重建表又會讓歷史小數資料搬不過去。trigger 新舊 DB 皆生效，已用舊 schema DB 驗證且可重複執行。
  - 新增測試：`tests/cart.test.js`（PATCH 非法數量、超過庫存回 400 `STOCK_INSUFFICIENT`、剛好等於庫存回 200）、`tests/orderService.test.js`（服務層防線、trigger）。
  - 殘餘風險：舊 DB 內既有的小數資料不會被清除，僅不再新增。

### H2. 免運門檻邊界錯誤（`shipping.js:40`）
- `qualifiesForFreeShipping` 用 `subtotal > 1500`；`docs/FEATURES.md:232`、`ARCHITECTURE.md:420` 寫「滿 1,500 元」，應為 `>=`。
- `it.skip(...1,500 元時免基本運費)` 正是在測這個邊界：**測試是對的、實作是錯的，卻用 skip 讓測試過關**。
- `tests/orders.test.js:48` 期望值寫 `productPrice >= 1500`，與實作 `>` 矛盾；它在測試內重算實作邏輯，且 API 層沒有 1500 邊界測試。
- 修法：`>` 改 `>=`、移除 `.skip`；新增「小計剛好 1500」的訂單測試，用固定數字斷言。
- **修復狀態：✅ 已修復**：`shipping.js` 改 `>=`，`tests/shipping.test.js` 移除 `.skip` 並通過。`tests/orders.test.js` 已補 API 層邊界測試（小計 1499 → 運費 120、總額 1619；小計 1500 → 運費 0、總額 1500，固定數字斷言）；第一個建立訂單測試（行 48）仍在測試內重算 `productPrice >= 1500`，未改動。

### H3. 訂單詳情 IDOR（`orderRoutes.js:350-364`）
- 使用 `findOrderById(req.params.id)`，未帶 `user_id`；`docs/FEATURES.md` 規定他人訂單視為 404。同檔 `/pay`、`/check-payment` 已正確用 `findOrderForUser`。
- **已重現**：會員 B 以 A 的訂單 id 查詢回 200，含 `recipient_email`、姓名、地址與品項。
- 限制：訂單 id 為 UUIDv4 不可猜，但會出現在網址、綠界 ClientBackURL、瀏覽器歷史與 Referer。
- 修法：改 `findOrderForUser(req.params.id, req.user.userId)`，找不到回 404。
- 測試缺口：`tests/orders.test.js` 只測「不存在的訂單 404」（行 132），沒測他人訂單。
- **修復狀態：✅ 已修復**：改用 `findOrderForUser(req.params.id, req.user.userId)`，他人訂單回 404；`tests/orders.test.js` 新增他人訂單測試。

### M1. 綠界憑證 fallback（`ecpay.js:4-6`）
- `ECPAY_MERCHANT_ID || '3002607'`、`ECPAY_HASH_KEY || '…'`、`ECPAY_HASH_IV || '…'`，`ECPAY_ENV` 預設 staging。違反全域規則（憑證不得有 fallback，即使是公開測試值）。
- 後果：production 漏設環境變數時靜默使用公開金鑰，任何人可偽造 `CheckMacValue`。
- 修法：啟動時檢查缺少的 env 並 throw。測試環境已由 `tests/setup/testEnvironment.js` 提供，不受影響。

### M2. 預設管理員帳密（`database.js:116-117`）
- 未設 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 時使用 `admin@hexschool.com` / `12345678`。未設則視同 HIGH。
- 修法：production 缺值即 fail-fast，且密碼須自訂並達強度要求。

### M3. 庫存佔用無釋放機制（`orderService.js:67-112`）
- 攻擊：註冊帳號 → 每項商品加到庫存上限 → 下單不付款，庫存被扣光。專案中找不到取消或逾時釋放程式（grep 無結果）。
- 修法：pending 訂單逾時自動轉 failed 並回補庫存；限制每人 pending 訂單數；註冊與下單加速率限制。

### M4. CheckMacValue 驗證可被跳過（`paymentService.js:15`）
- `tradeInfo.CheckMacValue && !verify…`：回應無該欄位時略過驗證，只要 `TradeStatus=1`、`MerchantTradeNo` 與金額吻合就標記已付款。目前資料來自後端直連綠界 HTTPS，屬縱深防禦缺口，但日後若來源可被外部控制（如補 `/ecpay/notify`）即成偽造付款。
- 修法：`TradeStatus='1'` 時缺 `CheckMacValue` 一律 throw。
- 測試缺口：`tests/integration/order-checkout.integration.test.js:421-455` 只測簽章竄改與金額不符，未測「無 CheckMacValue」與「MerchantTradeNo 不符」。

### M5. 庫存檢查與扣庫存（`orderService.js:67-112`）
- 單一 Node 行程內為同步程式，現況無真 race。但多行程部署或購物車出現同商品重複列時，`UPDATE` 會觸發 `CHECK(stock>=0)`，transaction 雖正確回滾，卻回 500 而非 400。
- 修法：檢查移入 transaction，`UPDATE … WHERE id=? AND stock>=?`，檢查 `changes===1`，失敗拋可辨識錯誤並在路由轉 400。

### M6. check-payment 冪等測試缺口（`orderRoutes.js:496-545`）
- `WHERE status='pending'` 保護與非 pending 直接回傳狀態的邏輯正確，但整合測試未涵蓋：重複呼叫不重複打綠界（`fetch` 僅一次）、paid 後再查仍 paid、他人訂單 404、無 `merchant_trade_no` 回 400 `NO_TRADE_NO`、failed 訂單再查。
- 建議：`markOrderPaid()` 回 false 時重新讀取訂單狀態。

### L1–L5（摘要）
- **L1**：付款頁任何人拿到訂單 UUID 即可取得含簽章的付款表單（金額、品項）。修法：驗證擁有者或改以 JWT／一次性 token 取得。
- **L2**：加長亂碼或撞號重試；`merchant_trade_no` 補 UNIQUE 索引。
- **L3**：僅 test 環境；可於文件註明，或隨取消訂單功能（Issue B）一併處理。
- **L4**：實作 `cancelled` 時同步改 CHECK（`tests/acceptance/cancel-order.test.js` 已預期該狀態）。
- **L5**：功能缺口非漏洞；補 notify 時須做 CheckMacValue 驗證、金額比對、冪等。

## 4. 其他測試品質問題（code-reviewer）
- `tests/orders.test.js:78-80`：空購物車只斷言 400 與 `data: null`，未斷言 `error: 'CART_EMPTY'`。
- `tests/orders.test.js`：共用 `orderId`、測試順序相依、依賴 `products[0]` 價格；建議每個測試自建資料。
- 缺少情境：重複提交（連點兩次）、超過庫存、非法 `shippingMethod`、非 boolean 旗標、Email 格式錯誤、運費與總額精確值。
- PATCH 數量非法值（見 H1）、他人訂單（見 H3）、免運邊界（見 H2）皆無測試。

## 5. 已確認無問題
- SQL 全數參數化；`cartRoutes` 動態拼接的 `${owner.field}` 僅來自程式內固定值。
- 運費與總額由後端依 DB 價格計算，前端無法竄改；附加費在免運時仍收取，符合規格。
- 建立訂單 transaction 原子性有整合測試證明（以 trigger 強制失敗，訂單、品項、庫存、購物車皆回滾）。
- 付款狀態僅 `pending → paid/failed`，不可逆；mock pay 非 test 環境回 404。
- JWT 固定 HS256 並驗證使用者存在；購物車 itemId 操作有擁有者條件，session 與 user 購物車隔離。
- API 回應維持 `{ data, error, message }`；測試使用 `:memory:` 且有 guard 確認 `database.sqlite` 未被改動。
- 未發現測試被刪除或放寬（唯一例外為 H2 的 `it.skip`）。

## 6. 建議修復順序
1. ✅ 已完成：H1（先寫失敗測試重現）→ H2（改 `>=`、移除 skip）→ H3（補測試後改 `findOrderForUser`）
2. M1、M2（fail-fast）→ M4（必驗簽章）→ M5（transaction 內扣庫存）
3. M3、M6、L1–L4
4. L5 於實作 `/ecpay/notify` 時一併處理

## 7. 範圍外備註
- auth 與 admin 路由無登入速率限制；CORS 為單一來源，本次未深入。
- 沙箱外重跑 `npm run test:unit` / `test:integration` 可確認 exit code 是否為 0（目前 1 僅因 EROFS）。
