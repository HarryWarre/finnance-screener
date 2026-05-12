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

// Generic cURL fetcher
function fetchUrl($url, $extraHeaders = []) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    if (!empty($extraHeaders)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $extraHeaders);
    }
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    return ['body' => $result, 'code' => $httpCode, 'error' => $error];
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

// ── rss: Fetch any RSS/XML feed ─────────────────────────────────────────────
} elseif ($action === 'rss') {
    $rssUrl = isset($_GET['url']) ? trim($_GET['url']) : '';
    if (empty($rssUrl)) {
        http_response_code(400);
        header("Content-Type: application/json");
        echo json_encode(["error" => "Missing url for rss action"]);
        exit();
    }
    $res = fetchUrl($rssUrl, ['Accept: application/rss+xml, text/xml, */*']);
    if ($res['code'] == 200 && $res['body']) {
        header("Content-Type: text/xml; charset=utf-8");
        echo $res['body'];
    } else {
        header("Content-Type: application/json");
        http_response_code(502);
        echo json_encode(["error" => "RSS fetch failed", "code" => $res['code'], "curl_error" => $res['error']]);
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
