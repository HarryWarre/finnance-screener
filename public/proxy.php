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

// cURL fetcher with a persistent cookie jar (for Cloudflare/session gated endpoints).
function fetchUrlWithCookieJar($url, $cookieJarPath, $extraHeaders = [], $postFields = null) {
    if (!function_exists('curl_init')) {
        return ['body' => null, 'code' => 0, 'error' => 'cURL extension is not enabled on this host'];
    }
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_ENCODING, '');
    if (defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($ch, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }
    if (defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    // Cookie jar
    curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieJarPath);
    curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieJarPath);
    if ($postFields !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    }
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

function readDotEnvKey($key) {
    $k = strtoupper(trim($key));
    // Prefer environment variables if available.
    $env = getenv($k);
    if ($env !== false && $env !== null && trim($env) !== '') return trim($env);
    if (isset($_ENV[$k]) && trim(strval($_ENV[$k])) !== '') return trim(strval($_ENV[$k]));

    // Best-effort: read from project root .env (useful on shared hosting).
    $rootEnvPath = dirname(__DIR__) . "/.env";
    if (!file_exists($rootEnvPath)) return '';
    $raw = @file_get_contents($rootEnvPath);
    if ($raw === false || $raw === '') return '';
    $lines = preg_split("/\\r?\\n/", $raw);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) continue;
        $pos = strpos($line, '=');
        if ($pos === false) continue;
        $lk = strtoupper(trim(substr($line, 0, $pos)));
        if ($lk !== $k) continue;
        $val = trim(substr($line, $pos + 1));
        $val = trim($val, " \t\n\r\0\x0B\"'");
        return $val;
    }
    return '';
}

// ── health: basic endpoint health check ─────────────────────────────────────
if ($action === 'health') {
    header("Content-Type: application/json; charset=utf-8");
    echo json_encode([
        "ok" => true,
        "ts" => time(),
        "php" => PHP_VERSION,
        "curl" => function_exists('curl_init'),
    ]);
    exit();
}

// ── te_calendar: Economic calendar via TradingEconomics API (JSON) ──────────
if ($action === 'te_calendar') {
    header("Content-Type: application/json; charset=utf-8");

    $dateFrom = isset($_GET['dateFrom']) ? trim($_GET['dateFrom']) : '';
    $dateTo = isset($_GET['dateTo']) ? trim($_GET['dateTo']) : '';
    $importance = isset($_GET['importance']) ? trim($_GET['importance']) : ''; // optional
    if ($dateFrom === '' || $dateTo === '') respondJson(["error" => "Missing dateFrom/dateTo"], 400);
    if (!preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateFrom) || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateTo)) {
        respondJson(["error" => "Invalid dateFrom/dateTo format. Use YYYY-MM-DD."], 400);
    }

    $apiKey = readDotEnvKey("TE_API_KEY");
    if ($apiKey === '') {
        respondJson(["error" => "Missing TE_API_KEY on server (env or .env)."], 401);
    }

    // Only request countries that map into our supported macro universe.
    $countries = "united%20states,euro%20area,united%20kingdom,japan,switzerland,canada,australia,new%20zealand,china,hong%20kong";
    $url = "https://api.tradingeconomics.com/calendar/country/" . $countries . "/" . rawurlencode($dateFrom) . "/" . rawurlencode($dateTo) . "?c=" . rawurlencode($apiKey) . "&f=json";
    if ($importance !== '' && preg_match('/^[0-3]$/', $importance)) {
        $url .= "&importance=" . rawurlencode($importance);
    }

    $ttl = 15 * 60; // 15 minutes
    $cacheKey = "te_calendar_" . $dateFrom . "_" . $dateTo . "_imp" . ($importance !== '' ? $importance : 'all');
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "TradingEconomics calendar failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

    // Pass through, but normalize to our proxy response shape.
    $json = json_decode($res['body'], true);
    if (!is_array($json)) {
        respondJson(["error" => "TradingEconomics calendar invalid JSON"], 502);
    }

    $out = json_encode([
        "dateFrom" => $dateFrom,
        "dateTo" => $dateTo,
        "events" => $json,
        "source" => "tradingeconomics_api",
    ]);
    writeCache($cacheKey, $out);
    echo $out;
    exit();
}

// ── finnhub_calendar: Economic calendar via Finnhub (JSON) ──────────────────
if ($action === 'finnhub_calendar') {
    header("Content-Type: application/json; charset=utf-8");

    $dateFrom = isset($_GET['dateFrom']) ? trim($_GET['dateFrom']) : '';
    $dateTo = isset($_GET['dateTo']) ? trim($_GET['dateTo']) : '';
    if ($dateFrom === '' || $dateTo === '') respondJson(["error" => "Missing dateFrom/dateTo"], 400);
    if (!preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateFrom) || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateTo)) {
        respondJson(["error" => "Invalid dateFrom/dateTo format. Use YYYY-MM-DD."], 400);
    }

    $apiKey = readDotEnvKey("FINNHUB_API_KEY");
    if ($apiKey === '') {
        respondJson(["error" => "Missing FINNHUB_API_KEY on server (env or .env)."], 401);
    }

    $ttl = 15 * 60; // 15 minutes
    $cacheKey = "finnhub_calendar_" . $dateFrom . "_" . $dateTo;
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://finnhub.io/api/v1/calendar/economic?from=" . rawurlencode($dateFrom) . "&to=" . rawurlencode($dateTo) . "&token=" . rawurlencode($apiKey);
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "Finnhub calendar failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

    $json = json_decode($res['body'], true);
    if (!is_array($json)) {
        respondJson(["error" => "Finnhub calendar invalid JSON"], 502);
    }

    $events = [];
    if (isset($json['economicCalendar']) && is_array($json['economicCalendar'])) {
        $events = $json['economicCalendar'];
    }

    $out = json_encode([
        "dateFrom" => $dateFrom,
        "dateTo" => $dateTo,
        "events" => $events,
        "source" => "finnhub_calendar",
    ]);
    writeCache($cacheKey, $out);
    echo $out;
    exit();
}

// ── fxstreet_calendar: Economic calendar via FXStreet API (OAuth2 v2) ───────
if ($action === 'fxstreet_calendar') {
    header("Content-Type: application/json; charset=utf-8");

    $dateFrom = isset($_GET['dateFrom']) ? trim($_GET['dateFrom']) : '';
    $dateTo = isset($_GET['dateTo']) ? trim($_GET['dateTo']) : '';
    $culture = isset($_GET['culture']) ? trim($_GET['culture']) : 'en';
    $apiVersion = isset($_GET['apiVersion']) ? trim($_GET['apiVersion']) : 'v1';
    $countriesRaw = isset($_GET['countries']) ? trim($_GET['countries']) : 'US,EMU,UK,JP,CH,CA,AU,NZ,CN,HK';

    if ($dateFrom === '' || $dateTo === '') respondJson(["error" => "Missing dateFrom/dateTo"], 400);
    if (!preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateFrom) || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateTo)) {
        respondJson(["error" => "Invalid dateFrom/dateTo format. Use YYYY-MM-DD."], 400);
    }
    if (!preg_match('/^[a-z]{2,10}$/i', $culture)) $culture = 'en';
    if (!preg_match('/^v\\d+$/i', $apiVersion)) $apiVersion = 'v1';

    $clientId = readDotEnvKey("FXS_CLIENT_ID");
    $clientSecret = readDotEnvKey("FXS_CLIENT_SECRET");
    if ($clientId === '' || $clientSecret === '') {
        respondJson(["error" => "Missing FXS_CLIENT_ID/FXS_CLIENT_SECRET on server (env or .env)."], 401);
    }

    // Token cache (separate from generic cache TTL)
    $tokenCacheKey = "fxstreet_oauth2_v2_token_calendar";
    $tokenRaw = readCache($tokenCacheKey, 23 * 60 * 60); // best-effort (token is typically long-lived)
    $token = '';
    $tokenType = 'Bearer';
    $tokenExpiresAt = 0;
    if ($tokenRaw !== null) {
        $cached = json_decode($tokenRaw, true);
        if (is_array($cached) && isset($cached['access_token']) && isset($cached['expiresAt'])) {
            $t = strval($cached['access_token']);
            $expiresAt = intval($cached['expiresAt']);
            if ($t !== '' && $expiresAt > time() + 60) {
                $token = $t;
                $tokenType = isset($cached['token_type']) ? strval($cached['token_type']) : 'Bearer';
                $tokenExpiresAt = $expiresAt;
            }
        }
    }

    if ($token === '') {
        if (!is_dir(__DIR__ . "/cache")) {
            @mkdir(__DIR__ . "/cache", 0755, true);
        }
        $cookieJar = __DIR__ . "/cache/fxstreet_cookiejar.txt";
        $postFields = http_build_query([
            "grant_type" => "client_credentials",
            "client_id" => $clientId,
            "client_secret" => $clientSecret,
            "scope" => "calendar",
        ]);
        $tok = fetchUrlWithCookieJar(
            "https://authorization.fxstreet.com/v2/token",
            $cookieJar,
            [
                "Accept: application/json",
                "Content-Type: application/x-www-form-urlencoded",
            ],
            $postFields
        );
        if (!($tok['code'] == 200 && $tok['body'])) {
            respondJson(["error" => "FXStreet token fetch failed", "code" => $tok['code'], "detail" => $tok['error']], 502);
        }
        $tj = json_decode($tok['body'], true);
        if (!is_array($tj) || !isset($tj['access_token'])) {
            respondJson(["error" => "FXStreet token invalid JSON"], 502);
        }
        $token = strval($tj['access_token']);
        $tokenType = isset($tj['token_type']) ? strval($tj['token_type']) : 'Bearer';
        $expiresIn = isset($tj['expires_in']) ? intval($tj['expires_in']) : 3600;
        $tokenExpiresAt = time() + max(60, $expiresIn - 60);
        writeCache($tokenCacheKey, json_encode(["access_token" => $token, "token_type" => $tokenType, "expiresAt" => $tokenExpiresAt]));
    }

    $fromParam = $dateFrom . "T00:00:00Z";
    $toParam = $dateTo . "T23:59:59Z";

    $countries = array_values(array_filter(array_map(function ($s) { return strtoupper(trim($s)); }, preg_split('/\\s*,\\s*/', $countriesRaw))));
    // Basic allowlist (FXStreet uses e.g. US, EMU, UK, JP, CH, CA, AU, NZ, CN, HK)
    $countries = array_values(array_filter($countries, function ($c) { return preg_match('/^[A-Z]{2,3}$/', $c); }));

    $qs = [];
    foreach ($countries as $c) $qs[] = "countries=" . rawurlencode($c);
    $query = count($qs) ? ("?" . implode("&", $qs)) : "";

    $base = readDotEnvKey("FXS_CALENDAR_API_BASE");
    if ($base === '') $base = "https://calendar-api.fxstreet.com";
    $base = rtrim($base, "/");

    $url = $base . "/" . rawurlencode($culture) . "/api/" . rawurlencode(strtolower($apiVersion)) . "/eventDates/" . rawurlencode($fromParam) . "/" . rawurlencode($toParam) . $query;

    $ttl = 10 * 60; // 10 minutes
    $cacheKey = "fxstreet_calendar_" . $dateFrom . "_" . $dateTo . "_v" . strtolower($apiVersion) . "_c" . $culture . "_cty" . md5($countriesRaw);
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $res = fetchUrlWithFallback($url, ['Accept: application/json', "Authorization: " . $tokenType . " " . $token]);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "FXStreet calendar fetch failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

    $parsed = json_decode($res['body'], true);
    if (!is_array($parsed)) {
        respondJson(["error" => "FXStreet calendar invalid JSON"], 502);
    }

    $out = json_encode([
        "dateFrom" => $dateFrom,
        "dateTo" => $dateTo,
        "culture" => $culture,
        "apiVersion" => strtolower($apiVersion),
        "events" => $parsed,
        "source" => "fxstreet_api",
    ]);
    writeCache($cacheKey, $out);
    echo $out;
    exit();
}

// ── investing_calendar: Economic calendar events (structured JSON) ──────────
if ($action === 'investing_calendar') {
    header("Content-Type: application/json; charset=utf-8");

    $dateFrom = isset($_GET['dateFrom']) ? trim($_GET['dateFrom']) : '';
    $dateTo = isset($_GET['dateTo']) ? trim($_GET['dateTo']) : '';
    $timeZone = isset($_GET['timeZone']) ? intval($_GET['timeZone']) : 8;

    if ($dateFrom === '' || $dateTo === '') {
        respondJson(["error" => "Missing dateFrom/dateTo"], 400);
    }
    if (!preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateFrom) || !preg_match('/^\\d{4}-\\d{2}-\\d{2}$/', $dateTo)) {
        respondJson(["error" => "Invalid dateFrom/dateTo format. Use YYYY-MM-DD."], 400);
    }

    $ttl = 10 * 60; // 10 minutes
    $cacheKey = "investing_calendar_" . $dateFrom . "_" . $dateTo . "_tz" . strval($timeZone);
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $cookieJar = __DIR__ . "/cache/investing_cookiejar.txt";
    if (!is_dir(__DIR__ . "/cache")) {
        @mkdir(__DIR__ . "/cache", 0755, true);
    }

    // Warm up cookies (best-effort).
    $warm = fetchUrlWithCookieJar(
        "https://www.investing.com/economic-calendar/",
        $cookieJar,
        [
            "Accept: text/html, */*",
            "Accept-Language: en-US,en;q=0.9",
            "Connection: keep-alive",
        ]
    );
    if (!($warm['code'] == 200 && $warm['body'])) {
        $payload = ["error" => "Investing warmup failed", "code" => $warm['code'], "detail" => $warm['error']];
        if (isDebugEnabled() && isset($warm['info'])) $payload['info'] = $warm['info'];
        respondJson($payload, 502);
    }

    $postFields = http_build_query([
        "dateFrom" => $dateFrom,
        "dateTo" => $dateTo,
        "timeZone" => $timeZone,
    ]);

    $res = fetchUrlWithCookieJar(
        "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData",
        $cookieJar,
        [
            "Accept: */*",
            "Accept-Language: en-US,en;q=0.9",
            "Content-Type: application/x-www-form-urlencoded",
            "Origin: https://www.investing.com",
            "Referer: https://www.investing.com/economic-calendar/",
            "X-Requested-With: XMLHttpRequest",
        ],
        $postFields
    );
    if (!($res['code'] == 200 && $res['body'])) {
        $payload = ["error" => "Investing calendar fetch failed", "code" => $res['code'], "detail" => $res['error']];
        if (isDebugEnabled() && isset($res['info'])) $payload['info'] = $res['info'];
        respondJson($payload, 502);
    }

    $parsed = json_decode($res['body'], true);
    $html = is_array($parsed) && isset($parsed['data']) ? strval($parsed['data']) : '';
    if ($html === '') {
        // Cloudflare challenge often returns HTML (not JSON); return a soft payload so the app can fall back.
        $looksLikeCf = (strpos($res['body'], 'Just a moment') !== false) || (strpos($res['body'], 'challenges.cloudflare.com') !== false);
        if ($looksLikeCf) {
            $jsonOut = json_encode([
                "dateFrom" => $dateFrom,
                "dateTo" => $dateTo,
                "timeZone" => $timeZone,
                "events" => [],
                "source" => "investing_blocked_cloudflare",
                "blocked" => true,
                "message" => "Investing.com is blocked by Cloudflare challenge on this host.",
            ]);
            writeCache($cacheKey, $jsonOut);
            echo $jsonOut;
            exit();
        }
        respondJson(["error" => "Investing response missing data"], 502);
    }

    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML('<?xml encoding="utf-8" ?><table><tbody>' . $html . '</tbody></table>');
    $xpath = new DOMXPath($dom);
    $rows = $xpath->query("//tr[contains(concat(' ', normalize-space(@class), ' '), ' js-event-item ')]");

    $clean = function ($text) {
        $t = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $t = str_replace("\xC2\xA0", " ", $t); // NBSP
        $t = preg_replace('/\\s+/', ' ', $t);
        return trim($t);
    };

    $events = [];
    foreach ($rows as $tr) {
        /** @var DOMElement $tr */
        $dt = $clean($tr->getAttribute("data-event-datetime"));
        if ($dt === '') continue;

        $idRaw = $tr->getAttribute("id");
        $idNum = 0;
        if (preg_match('/eventRowId_(\\d+)/', $idRaw, $m)) $idNum = intval($m[1]);

        $tds = $xpath->query("./td", $tr);
        if ($tds->length < 4) continue;

        $currencyCell = $tds->item(1);
        $currencyText = $clean($currencyCell ? $currencyCell->textContent : '');
        $currency = '';
        if (preg_match('/\\b([A-Z]{3})\\b$/', $currencyText, $m)) $currency = $m[1];

        $country = '';
        $flagSpan = $currencyCell ? $xpath->query(".//span[@title]", $currencyCell)->item(0) : null;
        if ($flagSpan instanceof DOMElement) {
            $country = $clean($flagSpan->getAttribute("title"));
        }

        $importanceCell = $tds->item(2);
        $importanceKey = $importanceCell instanceof DOMElement ? $importanceCell->getAttribute("data-img_key") : '';
        $importance = 0;
        if (preg_match('/bull(\\d+)/', $importanceKey, $m)) $importance = intval($m[1]);

        $eventCell = $tds->item(3);
        $title = $clean($eventCell ? $eventCell->textContent : '');
        $url = '';
        $a = $eventCell ? $xpath->query(".//a[@href]", $eventCell)->item(0) : null;
        if ($a instanceof DOMElement) {
            $href = $clean($a->getAttribute("href"));
            if ($href !== '') $url = (strpos($href, 'http') === 0) ? $href : ("https://www.investing.com" . $href);
        }

        $actual = $clean($tds->item(4) ? $tds->item(4)->textContent : '');
        $forecast = $clean($tds->item(5) ? $tds->item(5)->textContent : '');
        $previous = $clean($tds->item(6) ? $tds->item(6)->textContent : '');

        $events[] = [
            "id" => $idNum,
            "datetime" => $dt,
            "currency" => $currency,
            "country" => $country,
            "importance" => $importance,
            "title" => $title,
            "actual" => $actual,
            "forecast" => $forecast,
            "previous" => $previous,
            "url" => $url,
        ];
    }

    $out = [
        "dateFrom" => $dateFrom,
        "dateTo" => $dateTo,
        "timeZone" => $timeZone,
        "events" => $events,
        "source" => "investing_getCalendarFilteredData",
    ];
    $jsonOut = json_encode($out);
    writeCache($cacheKey, $jsonOut);
    echo $jsonOut;
    exit();
}

// ── forexfactory_thisweek: ForexFactory "this week" feed via faireconomy.media ─
// Note: This is the only reliably reachable free endpoint (forexfactory.com is often Cloudflare-blocked).
// Caveat: Feed usually does NOT include `actual`. We expose as-is so the app can degrade gracefully.
if ($action === 'forexfactory_thisweek') {
    header("Content-Type: application/json; charset=utf-8");

    $format = isset($_GET['format']) ? strtolower(trim($_GET['format'])) : 'json';
    if (!in_array($format, ['json', 'csv', 'xml'], true)) $format = 'json';

    $url = "https://nfs.faireconomy.media/ff_calendar_thisweek." . $format;
    $ttl = 10 * 60; // 10 minutes
    $cacheKey = "ff_thisweek_" . $format;
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $res = fetchUrlWithFallback($url, ['Accept: */*']);
    if (!($res['code'] == 200 && $res['body'])) {
        respondJson(["error" => "ForexFactory thisweek feed failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

    // Normalize response shape
    $body = $res['body'];
    if ($format === 'json') {
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) respondJson(["error" => "ForexFactory thisweek invalid JSON"], 502);
        $out = json_encode([
            "events" => $decoded,
            "source" => "forexfactory_thisweek",
        ]);
        writeCache($cacheKey, $out);
        echo $out;
        exit();
    }

    // csv/xml passthrough wrapped
    $out = json_encode([
        "raw" => $body,
        "format" => $format,
        "source" => "forexfactory_thisweek",
    ]);
    writeCache($cacheKey, $out);
    echo $out;
    exit();
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

// ── cg_markets: CoinGecko Top Market Cap ───────────────────────────────────
} elseif ($action === 'cg_markets') {
    header("Content-Type: application/json; charset=utf-8");
    $vs = isset($_GET['vs_currency']) ? strtolower(trim($_GET['vs_currency'])) : 'usd';
    if (empty($vs)) $vs = 'usd';
    $order = isset($_GET['order']) ? trim($_GET['order']) : 'market_cap_desc';
    if ($order !== 'market_cap_desc' && $order !== 'volume_desc') $order = 'market_cap_desc';
    $perPage = isset($_GET['per_page']) ? intval($_GET['per_page']) : 100;
    if ($perPage < 1) $perPage = 1;
    if ($perPage > 250) $perPage = 250;
    $page = isset($_GET['page']) ? intval($_GET['page']) : 1;
    if ($page < 1) $page = 1;
    if ($page > 40) $page = 40;
    $sparkline = isset($_GET['sparkline']) ? strtolower(trim($_GET['sparkline'])) : 'false';
    $sparkline = ($sparkline === '1' || $sparkline === 'true') ? 'true' : 'false';
    $ids = isset($_GET['ids']) ? trim($_GET['ids']) : '';
    // allow a comma-separated ids list (CoinGecko IDs)
    if (!empty($ids)) {
        // basic safety: keep only expected chars
        $ids = preg_replace('/[^a-zA-Z0-9_\\-\\,]/', '', $ids);
    }

    $ttl = 120; // 2 minutes
    $cacheKey = "cg_markets_" . $vs . "_" . $order . "_" . $perPage . "_" . $page . "_" . $sparkline . "_" . ($ids ? ("ids_" . md5($ids)) : "noids");
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=" . rawurlencode($vs)
         . "&order=" . rawurlencode($order)
         . "&per_page=" . rawurlencode(strval($perPage))
         . "&page=" . rawurlencode(strval($page))
         . "&sparkline=" . rawurlencode($sparkline);
    if (!empty($ids)) $url .= "&ids=" . rawurlencode($ids);
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if ($res['code'] == 200 && $res['body']) {
        $json = $res['body'];
        writeCache($cacheKey, $json);
        echo $json;
    } else {
        respondJson(["error" => "CoinGecko markets failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

// ── cg_market_chart: CoinGecko price series ────────────────────────────────
} elseif ($action === 'cg_market_chart') {
    header("Content-Type: application/json; charset=utf-8");
    $id = isset($_GET['id']) ? trim($_GET['id']) : '';
    if (empty($id)) respondJson(["error" => "Missing id"], 400);
    $vs = isset($_GET['vs_currency']) ? strtolower(trim($_GET['vs_currency'])) : 'usd';
    if (empty($vs)) $vs = 'usd';
    $days = isset($_GET['days']) ? intval($_GET['days']) : 120;
    if ($days < 1) $days = 1;
    if ($days > 3650) $days = 3650;
    $interval = isset($_GET['interval']) ? strtolower(trim($_GET['interval'])) : '';
    if ($interval !== 'hourly' && $interval !== 'daily' && $interval !== '') $interval = '';

    // Cache by horizon
    $ttl = 6 * 60 * 60; // default 6h
    if ($days <= 1) $ttl = 60;
    else if ($days <= 7) $ttl = 5 * 60;
    else if ($days <= 90) $ttl = 30 * 60;

    $cacheKey = "cg_chart_" . $id . "_" . $vs . "_" . $days . "_" . ($interval ? $interval : 'auto');
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://api.coingecko.com/api/v3/coins/" . rawurlencode($id) . "/market_chart?vs_currency=" . rawurlencode($vs)
         . "&days=" . rawurlencode(strval($days));
    if (!empty($interval)) $url .= "&interval=" . rawurlencode($interval);
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if ($res['code'] == 200 && $res['body']) {
        $json = $res['body'];
        writeCache($cacheKey, $json);
        echo $json;
    } else {
        respondJson(["error" => "CoinGecko market_chart failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

// ── binance_exchangeInfo: Binance spot symbols ─────────────────────────────
} elseif ($action === 'binance_exchangeInfo') {
    header("Content-Type: application/json; charset=utf-8");
    $ttl = 6 * 60 * 60; // 6h
    $cacheKey = "binance_exchangeInfo";
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://api.binance.com/api/v3/exchangeInfo";
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if ($res['code'] == 200 && $res['body']) {
        $json = $res['body'];
        writeCache($cacheKey, $json);
        echo $json;
    } else {
        respondJson(["error" => "Binance exchangeInfo failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

// ── binance_ticker24hr: Binance 24h tickers (for top by volume) ────────────
} elseif ($action === 'binance_ticker24hr') {
    header("Content-Type: application/json; charset=utf-8");
    $ttl = 15; // 15s (UI freshness; still reduces repeated hits)
    $cacheKey = "binance_ticker24hr";
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://api.binance.com/api/v3/ticker/24hr";
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if ($res['code'] == 200 && $res['body']) {
        $json = $res['body'];
        writeCache($cacheKey, $json);
        echo $json;
    } else {
        respondJson(["error" => "Binance ticker24hr failed", "code" => $res['code'], "detail" => $res['error']], 502);
    }

// ── binance_klines: Binance OHLCV by symbol ────────────────────────────────
} elseif ($action === 'binance_klines') {
    header("Content-Type: application/json; charset=utf-8");
    $symbol = isset($_GET['symbol']) ? strtoupper(trim($_GET['symbol'])) : '';
    if (empty($symbol)) respondJson(["error" => "Missing symbol"], 400);
    // Allowed intervals (Binance spot)
    $interval = isset($_GET['interval']) ? trim($_GET['interval']) : '1d';
    $allowedIntervals = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
    if (!in_array($interval, $allowedIntervals, true)) $interval = '1d';
    $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 500;
    if ($limit < 1) $limit = 1;
    if ($limit > 1000) $limit = 1000;
    $startTime = isset($_GET['startTime']) ? trim($_GET['startTime']) : '';
    $endTime = isset($_GET['endTime']) ? trim($_GET['endTime']) : '';

    $ttl = 60; // 1 min
    $cacheKey = "binance_klines_" . $symbol . "_" . $interval . "_" . $limit . "_" . ($startTime ? $startTime : "na") . "_" . ($endTime ? $endTime : "na");
    $cached = readCache($cacheKey, $ttl);
    if ($cached !== null) {
        echo $cached;
        exit();
    }

    $url = "https://api.binance.com/api/v3/klines?symbol=" . rawurlencode($symbol)
         . "&interval=" . rawurlencode($interval)
         . "&limit=" . rawurlencode(strval($limit));
    if (!empty($startTime)) $url .= "&startTime=" . rawurlencode($startTime);
    if (!empty($endTime)) $url .= "&endTime=" . rawurlencode($endTime);
    $res = fetchUrlWithFallback($url, ['Accept: application/json']);
    if ($res['code'] == 200 && $res['body']) {
        $json = $res['body'];
        writeCache($cacheKey, $json);
        echo $json;
    } else {
        respondJson(["error" => "Binance klines failed", "code" => $res['code'], "detail" => $res['error']], 502);
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
