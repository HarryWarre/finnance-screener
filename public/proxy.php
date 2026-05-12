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
    $url = "https://query1.finance.yahoo.com/v8/finance/chart/" . rawurlencode($symbol) . "?interval=1d&range=1y";
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

// ── unknown action ───────────────────────────────────────────────────────────
} else {
    http_response_code(400);
    header("Content-Type: application/json");
    echo json_encode(["error" => "Invalid action: $action"]);
}
?>
