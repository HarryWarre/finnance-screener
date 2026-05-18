<?php
/**
 * StatArb PHP Proxy — Yahoo Finance + RSS
 * Bypasses CORS on cPanel hosting.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$action = isset($_GET['action']) ? trim($_GET['action']) : '';

if (empty($action)) {
    http_response_code(400);
    header("Content-Type: application/json");
    echo json_encode(["error" => "Missing action"]);
    exit();
}

// Optional mirror base for COT ZIPs when CFTC domains are blocked.
// Example: upload `fut_disagg_txt_2026.zip` to `https://your-domain.com/cot-mirror/`
$COT_MIRROR_BASE_URL = ''; // no trailing slash

// Generic cURL fetcher
function fetchUrl($url, $extraHeaders = []) {
    if (!function_exists('curl_init')) {
        return ['body' => null, 'code' => 0, 'error' => 'cURL extension is not enabled on this host'];
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    // Many upstream endpoints respond with gzip/br. Enable transparent decompression when supported.
    curl_setopt($ch, CURLOPT_ENCODING, '');
    // Shared hosting libcurl+HTTP/2 can be flaky for some upstreams (FRED/FF/etc).
    // Force HTTP/1.1 to avoid errors like: "HTTP/2 stream ... INTERNAL_ERROR".
    if (defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($ch, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }
    // Some hosts have broken IPv6 routing; prefer IPv4 to avoid long stalls with 0 bytes received.
    if (defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    // Avoid hanging too long on slow upstreams; allow slightly longer than client AbortController.
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    if (!empty($extraHeaders)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $extraHeaders);
    }
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $info = curl_getinfo($ch);
    $error = curl_error($ch);
    curl_close($ch);
    return ['body' => $result, 'code' => $httpCode, 'error' => $error, 'info' => $info];
}

// Simple file-based cache (cPanel-friendly). Cache directory: public/cache/
function cachePath($key) {
    $safe = preg_replace('/[^a-zA-Z0-9_\\-\\.]/', '_', $key);
    return __DIR__ . "/cache/" . $safe . ".json";
}

function readCache($key, $ttlSeconds) {
    $path = cachePath($key);
    if (!file_exists($path)) return null;
    $age = time() - filemtime($path);
    if ($age > $ttlSeconds) return null;
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') return null;
    return $raw;
}

function writeCache($key, $json) {
    $dir = __DIR__ . "/cache";
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $path = cachePath($key);
    @file_put_contents($path, $json);
}

function fetchUrlWithFallback($url, $extraHeaders = []) {
    $res = fetchUrl($url, $extraHeaders);
    if (($res['code'] == 200 && $res['body']) || ($res['code'] && $res['code'] != 0)) {
        return $res;
    }

    // Fallback: some shared hosts cannot reach certain upstreams reliably. Try via a public fetch relay.
    // This is best-effort and only used when the direct request fails with code=0 / network error.
    $relay = "https://api.allorigins.win/raw?url=" . rawurlencode($url);
    $relayHeaders = array_merge($extraHeaders, ['User-Agent: Mozilla/5.0', 'Accept: */*']);
    $fallback = fetchUrl($relay, $relayHeaders);
    // Annotate for debugging.
    $fallback['fallback_via'] = 'allorigins';
    $fallback['original_error'] = $res['error'] ?? null;
    return $fallback;
}

function respondJson($obj, $statusCode = 200) {
    http_response_code($statusCode);
    header("Content-Type: application/json; charset=utf-8");
    echo json_encode($obj);
    exit();
}

function isDebugEnabled() {
    return isset($_GET['debug']) && ($_GET['debug'] === '1' || strtolower($_GET['debug']) === 'true');
}

// ── chart: Yahoo Finance OHLCV ──────────────────────────────────────────────
if ($action === 'chart') {
    header("Content-Type: application/json");
    $symbol = isset($_GET['symbol']) ? trim($_GET['symbol']) : '';
    if (empty($symbol)) {
        http_response_code(400);
        echo json_encode(["error" => "Missing symbol"]);
        exit();
    }
    $interval = isset($_GET['interval']) ? trim($_GET['interval']) : '1d';
    $range = isset($_GET['range']) ? trim($_GET['range']) : '1y';

    // Whitelist to avoid unexpected values
    $allowedIntervals = ['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo'];
    $allowedRanges = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max'];
    if (!in_array($interval, $allowedIntervals, true)) $interval = '1d';
    if (!in_array($range, $allowedRanges, true)) $range = '1y';

    $url = "https://query1.finance.yahoo.com/v8/finance/chart/" . rawurlencode($symbol) . "?interval=" . rawurlencode($interval) . "&range=" . rawurlencode($range);
    $res = fetchUrl($url);
    if ($res['code'] == 200 && $res['body']) {
        echo $res['body'];
    } else {
        http_response_code(502);
        echo json_encode(["error" => "Yahoo chart failed", "code" => $res['code']]);
    }

// ── quote: Yahoo Finance Fundamentals ───────────────────────────────────────
} elseif ($action === 'quote') {
    header("Content-Type: application/json");
    $symbol = isset($_GET['symbol']) ? trim($_GET['symbol']) : '';
    if (empty($symbol)) {
        http_response_code(400);
        echo json_encode(["error" => "Missing symbol"]);
        exit();
    }
    $url = "https://query1.finance.yahoo.com/v11/finance/quoteSummary/" . rawurlencode($symbol) . "?modules=summaryDetail,financialData";
    $res = fetchUrl($url);
    if ($res['code'] == 200 && $res['body']) {
        echo $res['body'];
    } else {
        http_response_code(502);
        echo json_encode(["error" => "Yahoo quote failed", "code" => $res['code']]);
    }

// ── cot: Mirror via cotdata.net free API (latest only) ──────────────────────
} elseif ($action === 'cot') {
    $instrument = isset($_GET['instrument']) ? trim($_GET['instrument']) : '';
    $q = isset($_GET['q']) ? strtoupper(trim($_GET['q'])) : '';
    if (empty($instrument) && !empty($q)) {
        $map = [
            "CORN" => "002602",
            "SOYBEANS" => "005602",
            "WHEAT" => "001602",
            "COFFEE" => "083731",
            "COCOA" => "073732",
            "ORANGE JUICE" => "040701",
        ];
        if (isset($map[$q])) $instrument = $map[$q];
    }
    if (empty($instrument)) respondJson(["error" => "Missing instrument"], 400);

    $ttl = 6 * 60 * 60; // 6h
    $cacheKey = "cot_" . $instrument;
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        header("Content-Type: application/json; charset=utf-8");
        echo $cached;
        exit();
    }

    // Free tier: latest report only (no auth)
    $url = "https://cotdata.net/api/cot?instrument=" . rawurlencode($instrument);
    $res = fetchUrl($url, ['Accept: application/json']);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "COT mirror fetch failed", "code" => $res['code']], 502);
    }
    $json = $res['body'];
    writeCache($cacheKey, $json);
    header("Content-Type: application/json; charset=utf-8");
    echo $json;
    exit();

// ── enso: NOAA CPC ONI v5 ───────────────────────────────────────────────────
} elseif ($action === 'enso') {
    $ttl = 24 * 60 * 60; // 24h
    $cacheKey = "enso_oni_v5";
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        header("Content-Type: application/json; charset=utf-8");
        echo $cached;
        exit();
    }

    $url = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php";
    $res = fetchUrl($url, ['Accept: text/html, */*']);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "ENSO fetch failed", "code" => $res['code']], 502);
    }

    $html = $res['body'];
    $lines = preg_split("/\\r\\n|\\n|\\r/", $html);
    $text = strip_tags(join("\n", $lines));
    $text = preg_replace('/\\s+/', ' ', $text);

    // Extract table rows like: 1950 -1.5 -1.3 ...
    preg_match_all('/\\b(19\\d{2}|20\\d{2})\\b((?:\\s+-?\\d+\\.\\d){6,})/', $text, $matches, PREG_SET_ORDER);
    $values = [];
    foreach ($matches as $m) {
        $year = intval($m[1]);
        $nums = preg_split('/\\s+/', trim($m[2]));
        // Seasons order: DJF JFM FMA MAM AMJ MJJ JJA JAS ASO SON OND NDJ (12)
        $seasons = ["DJF","JFM","FMA","MAM","AMJ","MJJ","JJA","JAS","ASO","SON","OND","NDJ"];
        for ($i = 0; $i < min(12, count($nums)); $i++) {
            $values[] = ["season" => $seasons[$i], "year" => $year, "oni" => floatval($nums[$i])];
        }
    }
    if (count($values) === 0) respondJson(["error" => "ENSO parse failed"], 502);

    // Determine latest (last element)
    $latest = $values[count($values) - 1];
    $oni = $latest["oni"];
    $state = $oni >= 0.5 ? "El Nino" : ($oni <= -0.5 ? "La Nina" : "Neutral");

    $out = [
        "asOf" => $latest["year"] . " " . $latest["season"],
        "oni" => $oni,
        "state" => $state,
        "series" => array_slice($values, -180), // keep recent ~15y
        "source" => "noaa_cpc_oni_v5"
    ];
    $json = json_encode($out);
    writeCache($cacheKey, $json);
    header("Content-Type: application/json; charset=utf-8");
    echo $json;
    exit();

// ── wasde: USDA WASDE historical report data (latest month) ─────────────────
} elseif ($action === 'wasde') {
    $commodity = isset($_GET['commodity']) ? strtolower(trim($_GET['commodity'])) : '';
    $scope = isset($_GET['scope']) ? strtolower(trim($_GET['scope'])) : 'us';
    if (!in_array($commodity, ['corn', 'soybean', 'wheat'], true)) {
        respondJson(["error" => "Invalid commodity"], 400);
    }
    if ($scope !== 'us') {
        respondJson(["error" => "Only scope=us supported for now"], 400);
    }

    $ttl = 24 * 60 * 60; // 24h
    $cacheKey = "wasde_" . $commodity . "_" . $scope;
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        header("Content-Type: application/json; charset=utf-8");
        echo $cached;
        exit();
    }

    // Try USDA monthly CSV first; if blocked/unavailable, fallback to ERS machine-readable files.
    $dt = new DateTime('now', new DateTimeZone('UTC'));
    $csvBody = null;
    $reportMonth = null;
    for ($i = 0; $i < 18; $i++) {
        $ym = $dt->format('Y-m');
        $url = "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-" . $ym . ".csv";
        $res = fetchUrl($url, ['Accept: text/csv, */*']);
        if ($res['code'] == 200 && $res['body']) {
            $csvBody = $res['body'];
            $reportMonth = $ym;
            break;
        }
        $dt->modify('-1 month');
    }

    $fallbackSource = null;
    if ($csvBody === null) {
        // ERS fallback URLs (stable "media" links from ERS site):
        // - Corn: Feed Grains Yearbook Tables - All years (CSV)
        // - Soybean: Oil Crops Yearbook - All Tables (CSV)
        // - Wheat: Wheat Data-All Years (ZIP) (best-effort; may not include CSV)
        $ersUrl = null;
        if ($commodity === 'corn') {
            $ersUrl = "https://www.ers.usda.gov/media/5766/feed-grains-yearbook-tables-all-years.csv";
        } elseif ($commodity === 'soybean') {
            $ersUrl = "https://www.ers.usda.gov/media/5218/all-tables-oil-crops-yearbook.csv";
        } elseif ($commodity === 'wheat') {
            $ersUrl = "https://www.ers.usda.gov/media/5709/wheat-data-all-years.zip";
        }

        if ($ersUrl) {
            $res = fetchUrl($ersUrl, ['Accept: */*']);
            if ($res['code'] == 200 && $res['body']) {
                $fallbackSource = $ersUrl;
                if ($commodity === 'wheat') {
                    // Try extract first CSV from ZIP; if none, fail.
                    if (!class_exists('ZipArchive')) {
                        respondJson(["error" => "ZipArchive not available for wheat fallback"], 500);
                    }
                    $tmpZip = tempnam(sys_get_temp_dir(), "wasde_wheat_");
                    @file_put_contents($tmpZip, $res['body']);
                    $zip = new ZipArchive();
                    if ($zip->open($tmpZip) !== true) {
                        @unlink($tmpZip);
                        respondJson(["error" => "Wheat ZIP open failed"], 502);
                    }
                    $bestName = null;
                    for ($i = 0; $i < $zip->numFiles; $i++) {
                        $stat = $zip->statIndex($i);
                        if (!$stat) continue;
                        $name = $stat['name'];
                        if (preg_match('/\\.csv$/i', $name)) { $bestName = $name; break; }
                    }
                    if ($bestName) {
                        $csvBody = $zip->getFromName($bestName);
                    }
                    $zip->close();
                    @unlink($tmpZip);
                    if (!$csvBody) respondJson(["error" => "Wheat fallback ZIP contains no CSV"], 502);
                    $reportMonth = "ers";
                } else {
                    $csvBody = $res['body'];
                    $reportMonth = "ers";
                }
            }
        }
    }

    if ($csvBody === null) {
        respondJson(["error" => "WASDE fetch failed"], 502);
    }

    // Parse CSV into rows (assoc by header)
    $fp = fopen('php://temp', 'r+');
    fwrite($fp, $csvBody);
    rewind($fp);

    $header = fgetcsv($fp);
    if (!$header || !is_array($header)) {
        fclose($fp);
        respondJson(["error" => "WASDE CSV parse failed"], 502);
    }

    $keys = array_map(function($h) { return strtolower(trim($h)); }, $header);
    $idx = [];
    foreach ($keys as $i => $k) $idx[$k] = $i;

    $colValue = $idx['value'] ?? $idx['amount'] ?? null;
    $colItem = $idx['item'] ?? $idx['commodity'] ?? $idx['product'] ?? null;
    $colAttribute = $idx['attribute'] ?? $idx['attribute_desc'] ?? $idx['variable'] ?? $idx['category'] ?? $idx['series'] ?? null;
    $colCountry = $idx['country'] ?? $idx['geography_desc'] ?? $idx['region'] ?? $idx['area'] ?? null;
    $colMarketYear = $idx['market_year'] ?? $idx['marketing_year'] ?? $idx['market year'] ?? $idx['year'] ?? null;
    $colUnit = $idx['unit'] ?? null;

    // Heuristic matching
    $targets = [
        'corn' => 'corn',
        'soybean' => 'soybeans',
        'wheat' => 'wheat',
    ];
    $itemNeedle = $targets[$commodity];

    $bestYear = null;
    $endingStocks = null;
    $totalUse = null;

    while (($row = fgetcsv($fp)) !== false) {
        $item = $colItem !== null ? strtolower(trim($row[$colItem] ?? '')) : '';
        $attr = $colAttribute !== null ? strtolower(trim($row[$colAttribute] ?? '')) : '';
        $country = $colCountry !== null ? strtolower(trim($row[$colCountry] ?? '')) : '';
        $valRaw = $colValue !== null ? trim($row[$colValue] ?? '') : '';
        if ($valRaw === '' || $valRaw === 'NA') continue;

        // If this is ERS oil crops yearbook CSV, fields differ (Commodity / Geography_Desc / Attribute_Desc / Amount).
        if ($fallbackSource !== null) {
            // Map to ERS oil crops feed grains CSV layout if possible
            // We already mapped header via candidates above; just use the same checks.
        }

        if ($itemNeedle && strpos($item, $itemNeedle) === false) continue;
        if ($scope === 'us' && $country !== '' && strpos($country, 'united states') === false && strpos($country, 'u.s.') === false && strpos($country, 'us') !== 0) {
            // if country column exists, require US match
            continue;
        }

        $year = $colMarketYear !== null ? trim($row[$colMarketYear] ?? '') : '';
        if ($year !== '') {
            // prefer latest numeric year in string
            if ($bestYear === null || strcmp($year, $bestYear) > 0) {
                $bestYear = $year;
                $endingStocks = null;
                $totalUse = null;
            }
            if ($bestYear !== $year) continue;
        }

        $val = floatval(str_replace([','], [''], $valRaw));
        // Identify series
        if ($endingStocks === null && (strpos($attr, 'ending stocks') !== false || strpos($attr, 'ending stock') !== false)) {
            $endingStocks = $val;
        } elseif ($totalUse === null && (strpos($attr, 'total use') !== false || strpos($attr, 'use, total') !== false)) {
            $totalUse = $val;
        }
    }
    fclose($fp);

    $stocksToUse = null;
    if ($endingStocks !== null && $totalUse !== null && $totalUse != 0) {
        $stocksToUse = ($endingStocks / $totalUse) * 100.0;
    }

    $out = [
        "commodity" => $commodity,
        "scope" => $scope,
        "reportMonth" => $reportMonth,
        "marketYear" => $bestYear,
        "endingStocks" => $endingStocks,
        "totalUse" => $totalUse,
        "stocksToUse" => $stocksToUse,
        "source" => $fallbackSource ? $fallbackSource : "usda_historical_wasde_report_data_csv"
    ];
    $json = json_encode($out);
    writeCache($cacheKey, $json);
    header("Content-Type: application/json; charset=utf-8");
    echo $json;
    exit();

// ── rss: Fetch any RSS/XML feed ─────────────────────────────────────────────
} elseif ($action === 'rss') {
    $rssUrl = isset($_GET['url']) ? trim($_GET['url']) : '';
    if (empty($rssUrl)) {
        http_response_code(400);
        header("Content-Type: application/json");
        echo json_encode(["error" => "Missing url for rss action"]);
        exit();
    }
    $res = fetchUrlWithFallback($rssUrl, ['Accept: application/rss+xml, text/xml, */*']);
    if ($res['code'] == 200 && $res['body']) {
        header("Content-Type: text/xml; charset=utf-8");
        echo $res['body'];
    } else {
        header("Content-Type: application/json");
        http_response_code(502);
        $payload = ["error" => "RSS fetch failed", "code" => $res['code'], "curl_error" => $res['error']];
        if (isset($res['fallback_via'])) $payload['fallback_via'] = $res['fallback_via'];
        if (isset($res['original_error'])) $payload['original_error'] = $res['original_error'];
        if (isDebugEnabled() && isset($res['info'])) {
            $payload["url"] = $rssUrl;
            // Return only safe/compact timing diagnostics.
            $payload["timings"] = [
                "namelookup_time" => $res['info']['namelookup_time'] ?? null,
                "connect_time" => $res['info']['connect_time'] ?? null,
                "appconnect_time" => $res['info']['appconnect_time'] ?? null,
                "pretransfer_time" => $res['info']['pretransfer_time'] ?? null,
                "starttransfer_time" => $res['info']['starttransfer_time'] ?? null,
                "total_time" => $res['info']['total_time'] ?? null,
                "primary_ip" => $res['info']['primary_ip'] ?? null,
                "primary_port" => $res['info']['primary_port'] ?? null,
                "http_version" => $res['info']['http_version'] ?? null,
            ];
        }
        echo json_encode($payload);
    }

// ── sp500: Fetch S&P 500 constituents from Wikipedia ────────────────────────
} elseif ($action === 'sp500') {
    header("Content-Type: application/json; charset=utf-8");

    $url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
    $res = fetchUrl($url, ['Accept: text/html, */*']);
    if (!($res['code'] == 200 && $res['body'])) {
        http_response_code(502);
        echo json_encode(["error" => "Wikipedia fetch failed", "code" => $res['code']]);
        exit();
    }

    $html = $res['body'];
    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML($html);
    $xpath = new DOMXPath($dom);

    // First wikitable is typically the constituents table (Symbol / Security / Sector / ...)
    $table = $xpath->query("//table[contains(concat(' ', normalize-space(@class), ' '), ' wikitable ')]")->item(0);
    if (!$table) {
        http_response_code(502);
        echo json_encode(["error" => "Could not locate constituents table"]);
        exit();
    }

    $rows = $xpath->query(".//tr", $table);
    $constituents = [];
    $symbols = [];
    foreach ($rows as $idx => $tr) {
        if ($idx === 0) continue; // header
        $cells = $xpath->query("./td", $tr);
        if ($cells->length < 3) continue;
        $sym = strtoupper(trim($cells->item(0)->textContent));
        if ($sym === '') continue;
        $sector = trim($cells->item(2)->textContent);
        if ($sector === '') $sector = 'Unknown';

        // Normalize to Yahoo Finance tickers
        if ($sym === 'BRK.B') $sym = 'BRK-B';
        if ($sym === 'BF.B') $sym = 'BF-B';
        if (preg_match('/^[A-Z]{1,5}\\.[A-Z]$/', $sym)) {
            $sym = str_replace('.', '-', $sym);
        }

        $symbols[] = $sym;
        $constituents[] = ["symbol" => $sym, "sector" => $sector];
    }

    $symbols = array_values(array_unique($symbols));
    echo json_encode([
        "symbols" => $symbols, // backward-compat
        "constituents" => $constituents,
        "source" => "wikipedia"
    ]);

// ── unknown action ───────────────────────────────────────────────────────────
} else {
    http_response_code(400);
    header("Content-Type: application/json");
    echo json_encode(["error" => "Invalid action: $action"]);
}
?>
