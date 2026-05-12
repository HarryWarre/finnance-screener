# TODO – Agri CTA Seasonal System

Mục tiêu: nâng tab `🌾 Nông sản` từ “context dashboard” lên hệ thống nghiên cứu CTA mùa vụ có **overview → drilldown → rulebook → signal prototype → backtest**.

Ghi chú quan trọng:
- Ưu tiên **chạy được local dev** trước (Vite) rồi mới deploy cPanel.
- Không dùng cron ở phase này → cache theo kiểu “user vào trang thì fetch + cache”.
- Bất kỳ upstream nào hay bị block/DNS → phải có **timeout + fallback + không kẹt loading**.

## Roadmap ưu tiên (dễ → khó)
1) UI “giải thích + trực quan hoá” (không đụng data source mới)
2) Export/Import & lưu snapshot nghiên cứu
3) “Playbook” theo commodity (rulebook tĩnh + links)
4) Cải thiện COT (history + indicators)
5) WASDE/stocks-to-use ổn định (hay bị lỗi nhất)
6) Term structure / spreads (khó, cần nhiều ticker)
7) Weather chi tiết / crop-stage model (khó, nhiều mapping)
8) Backtest (phase sau, cần time & thiết kế)

## 1) Data (còn thiếu / cần chuẩn hoá)

### 1.1 WASDE / Balance sheet (Grains)
- [ ] Ổn định nguồn `Stocks-to-Use` cho `corn/soybean/wheat` (US + Global).
- [ ] Parse đúng series theo **market year** hiện tại, tránh chọn nhầm year trong CSV.
- [ ] Thêm percentile (5y/10y) cho `stocksToUse` để tạo “regime: tight/normal/loose”.
- [ ] Add MoM change + “surprise” proxy (revision vs tháng trước).
- [ ] Cache strategy:
  - `wasde_<commodity>_<scope>.json` TTL 24h (on-demand, không cron).
  - Fallback: snapshot local nếu upstream bị block.
 - Acceptance:
   - Không kẹt UI > 8s (timeout).
   - Có status “Nguồn WASDE bị chặn” + gợi ý bật VPN / deploy lên domain.

### 1.2 Term structure / Spreads
- [ ] Lấy dữ liệu theo **contract month** (front, next, deferred) thay vì chỉ continuous ticker.
- [ ] Implement calendar spreads chuẩn:
  - Corn: `Jul–Dec`, `Dec–Mar` (tuỳ rule).
  - Soybeans: `Jul–Nov`.
  - Wheat: `Jul–Sep`, `Dec–Mar`…
- [ ] Term-structure score (contango/backwardation) và carry proxy.
- [ ] Roll rule minh bạch (ngày roll / volume/oi heuristic).
 - Acceptance:
   - Modal hiển thị “front vs next” + score contango/backwardation.
   - Ghi rõ contract đang dùng (tháng nào) để tránh hiểu nhầm.

### 1.3 Weather / ENSO (macro overlay)
- [ ] ENSO đã có (ONI); bổ sung:
  - Regional weather anomalies (rain/temp/soil moisture).
  - Mapping vùng trồng theo commodity (US Midwest, Brazil, Argentina, Vietnam…).
- [ ] “Weather risk score” theo crop stage.
 - Acceptance:
   - Tối thiểu có “macro overlay” 1 dòng: La Nina/El Nino + diễn giải.

### 1.4 Softs fundamentals (Cocoa/Coffee/OJ)
- [ ] Nguồn tồn kho/warehouse stocks (ICE) hoặc proxy tương đương.
- [ ] Xuất khẩu/shipments theo nước chủ lực (Brazil/Vietnam/West Africa).
- [ ] Event calendar: frost risk (coffee), rainy season/flowering, harvest windows.
 - Acceptance:
   - Modal có section “Fundamental events” theo tháng (static OK).

### 1.5 COT (Positioning)
- [ ] Hiện dùng mirror `cotdata.net` (latest). Nâng cấp:
  - Lấy full history để tự tính z-score 3y/5y + COT index.
  - Mapping cftc code chuẩn cho từng commodity + exchange variants.
- [ ] Fail-safe: nếu COT không có → UI không kẹt, hiển thị `N/A`.
 - Acceptance:
   - Có “COT Index 0–100” + label (Crowded Long/Short/Neutral).
   - Tooltip giải thích `Non-commercial` là gì (không bắt user thuộc).

## 2) UI/UX – Overview & Drilldown

### 2.1 Overview table (Agri)
- [x] Cho phép sort theo từng cột (Seasonal, Vol, COT, Confidence…).
- [ ] “Signal/Context” filter:
  - [x] Only show `Seasonal mạnh`
  - [x] Only show `Crowded`
  - [x] Hide high vol
- [x] Thêm `Confidence` (0–100) hiển thị rõ thang điểm.
- [x] Thêm cột `Tóm tắt` (BUY/SELL/WAIT) + tooltip lý do.
- [x] Export CSV snapshot (overview) để lưu nghiên cứu.
- [x] Add “pinned row / watchlist” (star) lưu vào localStorage.
- [x] Add “search symbol” (fetch riêng ngoài list) nhưng **không phá table**.
- [ ] Table UX:
  - sticky header (thead) khi scroll
  - freeze 1–2 cột trái (Commodity, Symbol) (optional)
  - responsive: hide bớt cột khi màn nhỏ
 - Acceptance:
   - Trên laptop 1366px vẫn đọc được, không đè chữ.

### 2.2 Detail modal (Agri)
- [x] Thêm chart seasonality (12 tháng hoặc week-of-year curve):
  - median, 25/75 percentile, sample size.
- [ ] Thêm volatility regime chart (vol 20d rolling).
- [ ] Thêm panel COT (net + zscore + extreme flags).
- [ ] Thêm panel WASDE (stocks/use trend + percentile).
- [ ] Thêm “Playbook” theo commodity (rules + windows).
 - [x] Modal giới hạn chiều cao + scroll nội dung.
- [ ] Modal UX:
  - [x] “Copy summary” button (copy text)
  - [x] “Open on TradingView” button
  - “Explain like I’m busy” 3 dòng (auto)
 - Acceptance:
   - Modal không overflow ngang (mobile & desktop).

## 3) Signal prototype (không auto-trade)
- [ ] Tạo “Signal card” theo commodity:
  - Setup: Seasonal + COT + Regime + Vol
  - Bias: BUY/SELL/WAIT
  - Entry idea: breakout/pullback + invalidation
  - Risk: stop distance (ATR), suggested size scale
- [ ] Log giải thích (rõ ràng, audit-able) cho từng signal.
 - [ ] “Rule toggles” (checklist) để user bật/tắt điều kiện:
   - Require seasonal strong?
   - Require COT extreme?
   - Avoid high vol?
   - Trend alignment?
 - Acceptance:
   - Khi toggle thay đổi → Confidence & Summary update ngay (client-side).

## 4) Backtest (phase sau)
- [ ] Backtest theo cửa sổ mùa vụ (walk-forward):
  - baseline seasonal-only
  - seasonal + COT filter
  - seasonal + structure
  - seasonal + ENSO/weather
- [ ] Metrics: win-rate, avg, worst-year, max DD, turnover.
 - [ ] Export backtest results CSV/JSON.
 - [ ] “Replay mode” theo năm (calendar).

## 5) Infra (cPanel friendly)
- [ ] File cache hygiene (size limit, prune policy).
- [ ] Endpoint health check: `proxy.php?action=health`.
- [ ] Optional cron later (refresh cache) – không bắt buộc.
 - [ ] Local/Prod config:
   - `VITE_PROXY_BASE` hoặc auto-detect base URL
   - Clear cache button (debug)
 - [ ] Observability:
   - Debug panel (toggle) show fetch timings + which sources failed
   - Log rate-limit / 403/400 mapping rõ ràng

## 6) Nội dung “Playbook” (UI text – làm được ngay, rất hữu ích)
Mục tiêu: user không cần thuộc, chỉ cần đọc UI.
- [ ] Tạo `src/lib/agriPlaybook.ts`:
  - Per commodity: planting/growing/harvest/storage windows (US + key regions)
  - “Typical bias windows” (ví dụ: Corn spring risk premium, harvest low…)
  - Key risks (frost/too-wet/too-hot, export shocks)
  - Checklist before trade (COT, seasonal, vol, trend, ENSO)
- [ ] Modal section “Playbook nhanh” hiển thị bullet ngắn.
- [ ] Link docs: WASDE / COT / ENSO / contract specs (CME/ICE).

## 7) Những việc dễ làm tiếp theo (pick 1)
1) Seasonality chart trong modal (12 tháng, median + win-rate)
2) Export CSV overview + “Save snapshot” (localStorage)
3) Watchlist (star) + filter “Watchlist only”
4) Sticky header + responsive columns
