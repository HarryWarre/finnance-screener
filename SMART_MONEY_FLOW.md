# Smart Money Flow Window (Bản thiết kế)

Mục tiêu: gom nhiều “dòng tiền thông minh” (flow/positioning/liquidity) vào **một cửa sổ thời gian** (1D/7D/30D/90D…), chuẩn hoá bằng **z‑score theo lịch sử**, rồi tạo **composite score** để đọc nhanh Accumulation vs Distribution.

## Bộ chỉ số cốt lõi (ví dụ)

| Chỉ số | Ý nghĩa |
|---|---|
| ETF inflow | nhu cầu tổ chức (qua ETF/vehicle) |
| Stablecoin inflow | “tiền mua” đi vào hệ sinh thái (crypto) |
| Exchange net outflow | hành vi nắm giữ (rút khỏi sàn nhiều hơn nạp vào) |
| Whale accumulation | cá voi/tay to tăng vị thế |
| COT managed money net (Δ) | thay đổi vị thế nhóm managed money (CFTC COT) |
| Open interest (Δ) | vị thế mới/đòn bẩy đi vào thị trường (regime) |
| Options skew / risk reversal | nhu cầu phòng hộ / thiên lệch call-put |
| Inventory draw (Δ) | tồn kho giảm → thị trường vật chất “thắt chặt” |

## Mapping theo loại tài sản (gợi ý)

- Crypto: `ETF inflow`, `Stablecoin inflow`, `Exchange net outflow`, `Whale accumulation`, `Open interest (Δ)`, `Options skew`
- Stocks: `ETF inflow`, `Insider buying`, `Buyback intensity`, `Dark pool share`, `Options skew`
- Forex: `COT managed money net (Δ)`, `Options risk reversal`, `FX reserve change (Δ)` (tuỳ cặp/đồng tiền)
- Futures/Commodities/Agriculture: `COT managed money net (Δ)`, `Open interest (Δ)`, `Inventory draw (Δ)`, `ETF inflow` (nếu có), `Options skew`

## Nguồn dữ liệu (khi làm thật)

- ETF flows: website nhà phát hành/ sàn, Farside/issuer (crypto ETFs), Bloomberg/Refinitiv (trả phí)
- On-chain: Glassnode/CryptoQuant/Santiment/Nansen/Arkham (thường trả phí)
- COT: CFTC Commitments of Traders (miễn phí)
- Open interest: CME/ICE, các sàn phái sinh crypto
- Inventory: EIA (năng lượng), USDA (nông sản), kho sàn (kim loại)

## Trong repo hiện tại

- UI demo: tab `💸 Smart Money Flow` (mock data) để bạn thay thế bằng data thật.
- Model: `src/lib/smartMoney.ts` (danh mục metric + cách tính window + scoring).
