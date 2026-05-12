# TODO – Agri CTA Seasonal System

Mục tiêu: nâng tab `🌾 Nông sản` từ “context dashboard” lên hệ thống nghiên cứu CTA mùa vụ có **overview → drilldown → rulebook → signal prototype → backtest**.

## 1) Data (còn thiếu / cần chuẩn hoá)

### 1.1 WASDE / Balance sheet (Grains)
- [ ] Ổn định nguồn `Stocks-to-Use` cho `corn/soybean/wheat` (US + Global).
- [ ] Parse đúng series theo **market year** hiện tại, tránh chọn nhầm year trong CSV.
- [ ] Thêm percentile (5y/10y) cho `stocksToUse` để tạo “regime: tight/normal/loose”.
- [ ] Add MoM change + “surprise” proxy (revision vs tháng trước).
- [ ] Cache strategy:
  - `wasde_<commodity>_<scope>.json` TTL 24h (on-demand, không cron).
  - Fallback: snapshot local nếu upstream bị block.

### 1.2 Term structure / Spreads
- [ ] Lấy dữ liệu theo **contract month** (front, next, deferred) thay vì chỉ continuous ticker.
- [ ] Implement calendar spreads chuẩn:
  - Corn: `Jul–Dec`, `Dec–Mar` (tuỳ rule).
  - Soybeans: `Jul–Nov`.
  - Wheat: `Jul–Sep`, `Dec–Mar`…
- [ ] Term-structure score (contango/backwardation) và carry proxy.
- [ ] Roll rule minh bạch (ngày roll / volume/oi heuristic).

### 1.3 Weather / ENSO (macro overlay)
- [ ] ENSO đã có (ONI); bổ sung:
  - Regional weather anomalies (rain/temp/soil moisture).
  - Mapping vùng trồng theo commodity (US Midwest, Brazil, Argentina, Vietnam…).
- [ ] “Weather risk score” theo crop stage.

### 1.4 Softs fundamentals (Cocoa/Coffee/OJ)
- [ ] Nguồn tồn kho/warehouse stocks (ICE) hoặc proxy tương đương.
- [ ] Xuất khẩu/shipments theo nước chủ lực (Brazil/Vietnam/West Africa).
- [ ] Event calendar: frost risk (coffee), rainy season/flowering, harvest windows.

### 1.5 COT (Positioning)
- [ ] Hiện dùng mirror `cotdata.net` (latest). Nâng cấp:
  - Lấy full history để tự tính z-score 3y/5y + COT index.
  - Mapping cftc code chuẩn cho từng commodity + exchange variants.
- [ ] Fail-safe: nếu COT không có → UI không kẹt, hiển thị `N/A`.

## 2) UI/UX – Overview & Drilldown

### 2.1 Overview table (Agri)
- [x] Cho phép sort theo từng cột (Seasonal, Vol, COT, Confidence…).
- [ ] “Signal/Context” filter:
  - [x] Only show `Seasonal mạnh`
  - [x] Only show `Crowded`
  - [x] Hide high vol
- [x] Thêm `Confidence` (0–100) hiển thị rõ thang điểm.
- [x] Thêm cột `Tóm tắt` (BUY/SELL/WAIT) + tooltip lý do.
- [ ] Export CSV snapshot (overview) để lưu nghiên cứu.

### 2.2 Detail modal (Agri)
- [ ] Thêm chart seasonality (12 tháng hoặc week-of-year curve):
  - median, 25/75 percentile, sample size.
- [ ] Thêm volatility regime chart (vol 20d rolling).
- [ ] Thêm panel COT (net + zscore + extreme flags).
- [ ] Thêm panel WASDE (stocks/use trend + percentile).
- [ ] Thêm “Playbook” theo commodity (rules + windows).
 - [x] Modal giới hạn chiều cao + scroll nội dung.

## 3) Signal prototype (không auto-trade)
- [ ] Tạo “Signal card” theo commodity:
  - Setup: Seasonal + COT + Regime + Vol
  - Bias: BUY/SELL/WAIT
  - Entry idea: breakout/pullback + invalidation
  - Risk: stop distance (ATR), suggested size scale
- [ ] Log giải thích (rõ ràng, audit-able) cho từng signal.

## 4) Backtest (phase sau)
- [ ] Backtest theo cửa sổ mùa vụ (walk-forward):
  - baseline seasonal-only
  - seasonal + COT filter
  - seasonal + structure
  - seasonal + ENSO/weather
- [ ] Metrics: win-rate, avg, worst-year, max DD, turnover.

## 5) Infra (cPanel friendly)
- [ ] File cache hygiene (size limit, prune policy).
- [ ] Endpoint health check: `proxy.php?action=health`.
- [ ] Optional cron later (refresh cache) – không bắt buộc.
