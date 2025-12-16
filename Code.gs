/***************************************
 * Brixeon - Gmail Report Phishing Add-on (ES5 / Rhino-safe)
 * Goal: Register "Reported" event in campaign results (RID-based)
 
 * Template marker recommended:
 *   BRIXEON_REPORT_URL:{{.BaseUrl}}/report?rid={{.RId}}
 ***************************************/

function onGmailMessageOpen(e) {
  var subject = safeGet_(e, ["gmail", "messageSubject"], "Message");

  var header = CardService.newCardHeader()
    .setTitle("Brixeon")
    .setSubtitle(subject);

  var reportBtn = CardService.newTextButton()
    .setText("Report Phishing")
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(
      CardService.newAction()
        .setFunctionName("reportPhish_")
        .setParameters({})
    );

  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        "Think this message is suspicious? Report it so your security team can review it."
      )
    )
    .addWidget(reportBtn);

  return CardService.newCardBuilder()
    .setHeader(header)
    .addSection(section)
    .build();
}

function reportPhish_(e) {
  try {
    var messageId = safeGet_(e, ["gmail", "messageId"], "");
    if (!messageId) return notify_("No message detected. Reopen the email.");

    var msg = GmailApp.getMessageById(messageId);

    // 1) Resolve the report URL (marker first, then fallback)
    var reportUrl = resolveReportUrl_(msg);

    if (!reportUrl) {
      console.log("REPORT: Could not resolve report URL from message.");
      return notify_("We couldn’t find a report link in this message. Ask your admin to add the BRIXEON_REPORT_URL marker to the email template.");
    }

    // 2) Call the report URL
    var hit = hitReportEndpoint_(reportUrl);
    if (!hit.ok) {
      console.log("REPORT: failed code=" + hit.code + " url=" + reportUrl + " body=" + hit.body);
      return notify_("Report failed (" + hit.code + "). Please try again, or contact your administrator.");
    }

    console.log("REPORT: success code=" + hit.code + " url=" + reportUrl);
    return notify_("Reported. Thanks for helping keep your organization safe. ✅");
  } catch (err) {
    console.log("reportPhish_ error: " + err);
    return notify_("Report failed. Check Apps Script Executions log.");
  }
}

/**
 * Resolve /report?rid=... URL without hardcoding the phish domain.
 *
 * Priority:
 *  1) Template marker: BRIXEON_REPORT_URL:...  OR  BRIXEON_REPORT_URL=...
 *  2) Find any URL that contains /report?rid=..., decode wrappers
 *  3) Find rid in body + base URL from any rid link, then build: <base>/report?rid=<rid>
 */
function resolveReportUrl_(msg) {
  var combined = getMessageCombinedBody_(msg);

  // (1) Marker (supports ":" or "=")
  var marker = extractMarkerUrlAny_(combined, "BRIXEON_REPORT_URL");
  if (marker) {
    var cleanedMarker = normalizeReportUrl_(marker);
    if (cleanedMarker) return cleanedMarker;
  }

  // (2) Direct report link anywhere (decode wrappers)
  var reportLink = findFirstUrlContaining_(combined, "/report?rid=");
  if (reportLink) {
    var cleanedReport = normalizeReportUrl_(extractDirectUrl_(reportLink));
    if (cleanedReport) return cleanedReport;
  }

  // (3) Fallback: extract rid + base from any rid link, then build /report
  var rid = extractRidFromText_(combined);
  if (!rid) return "";

  var ridLink = findFirstUrlContainingRid_(combined);
  if (!ridLink) return "";

  var cleanRidLink = extractDirectUrl_(ridLink);
  var base = getBaseUrl_(cleanRidLink);
  if (!base) return "";

  return base.replace(/\/+$/, "") + "/report?rid=" + encodeURIComponent(rid);
}

/* ----------------- helpers ----------------- */

function getMessageCombinedBody_(msg) {
  var html = "";
  var plain = "";
  try { html = msg.getBody() || ""; } catch (e) {}
  try { plain = msg.getPlainBody() || ""; } catch (e) {}
  return String(html) + "\n" + String(plain);
}

/**
 * Extract marker URL with either:
 *   BRIXEON_REPORT_URL: https://...
 *   BRIXEON_REPORT_URL=https://...
 * Also works if quoted:
 *   BRIXEON_REPORT_URL="https://..."
 */
function extractMarkerUrlAny_(text, key) {
  var s = String(text || "");

  // Colon variant (more reliable)
  var reColon = new RegExp("\\b" + key + "\\s*:\\s*([\"']?)(https?:\\/\\/[^\"'\\s<>]+)\\1", "i");
  var m1 = s.match(reColon);
  if (m1 && m1.length >= 3) return String(m1[2] || "");

  // Equals variant
  var reEq = new RegExp("\\b" + key + "\\s*=\\s*([\"']?)(https?:\\/\\/[^\"'\\s<>]+)\\1", "i");
  var m2 = s.match(reEq);
  if (m2 && m2.length >= 3) return String(m2[2] || "");

  return "";
}

/**
 * Normalizes + validates that it is a real /report?rid=... URL.
 */
function normalizeReportUrl_(u) {
  var url = trim_(String(u || ""));
  if (!url) return "";

  // Decode wrapped links (google/outlook)
  url = extractDirectUrl_(url);

  // Remove trailing punctuation
  url = url.replace(/[)\].,;]+$/, "");

  // Fix accidental double slashes (but keep https://)
  url = url.replace(/([^:])\/{2,}/g, "$1/");

  // Must be http(s)
  if (!/^https?:\/\/.+/i.test(url)) return "";

  // Must look like report endpoint with rid
  if (!/\/report\?rid=/i.test(url)) return "";

  return url;
}

/**
 * Finds first URL that contains a substring, including wrapped redirect URLs.
 */
function findFirstUrlContaining_(text, needle) {
  var urls = extractAllUrls_(text);
  for (var i = 0; i < urls.length; i++) {
    var u = urls[i];
    if (String(u).indexOf(needle) !== -1) return u;
  }
  return "";
}

function findFirstUrlContainingRid_(text) {
  var urls = extractAllUrls_(text);
  for (var i = 0; i < urls.length; i++) {
    if (/\brid=/.test(urls[i])) return urls[i];
  }
  return "";
}

/**
 * Extract all http(s) URLs from text
 */
function extractAllUrls_(text) {
  var s = String(text || "");
  var re = /https?:\/\/[^\s"'<>]+/ig;
  var out = [];
  var m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/**
 * If URL is a wrapper (google/outlook safelinks), decode to the final destination.
 * Supports:
 *  - https://www.google.com/url?q=<dest>
 *  - ...?url=<dest>
 */
function extractDirectUrl_(u) {
  var url = String(u || "");
  url = url.replace(/[)\].,;]+$/, ""); // trim trailing punctuation

  // Try to decode wrapper query param url= or q=
  var inner = getQueryParam_(url, "url");
  if (!inner) inner = getQueryParam_(url, "q");

  if (inner) {
    try { inner = decodeURIComponent(inner); } catch (e) {}
    // Sometimes nested encoding happens twice
    if (/^https?%3A%2F%2F/i.test(inner)) {
      try { inner = decodeURIComponent(inner); } catch (e2) {}
    }
    return inner;
  }

  return url;
}

function getQueryParam_(url, key) {
  try {
    var qIndex = url.indexOf("?");
    if (qIndex === -1) return "";
    var query = url.substring(qIndex + 1);
    var parts = query.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv.length < 2) continue;
      if (String(kv[0]).toLowerCase() === String(key).toLowerCase()) {
        return kv.slice(1).join("=");
      }
    }
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * Extract rid from general text (not only links)
 */
function extractRidFromText_(text) {
  var s = String(text || "");
  var m = s.match(/\brid=([^&"'<> \n\r\t]+)/i);
  if (!m || m.length < 2) return "";
  var raw = String(m[1] || "");
  raw = raw.replace(/[)\].,;]+$/, "");
  try { raw = decodeURIComponent(raw); } catch (e) {}
  raw = trim_(raw);
  if (!/[A-Za-z0-9]/.test(raw)) return "";
  return raw;
}

function getBaseUrl_(url) {
  var u = String(url || "");
  var m = u.match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

/**
 * Calls the phishing server report endpoint.
 * Typically returns 204 on success, but accept 200/302 too.
 */
function hitReportEndpoint_(url) {
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: "get",
      followRedirects: true,
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    var body = resp.getContentText() || "";

    var ok = (code === 204 || code === 200 || code === 302);
    return { ok: ok, code: code, body: body };
  } catch (e) {
    console.log("hitReportEndpoint_ error: " + e);
    return { ok: false, code: 0, body: String(e) };
  }
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function safeGet_(obj, path, fallback) {
  try {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (!cur || typeof cur !== "object") return fallback;
      cur = cur[path[i]];
    }
    return (cur === undefined || cur === null) ? fallback : cur;
  } catch (e) {
    return fallback;
  }
}

function trim_(s) {
  return String(s).replace(/^\s+|\s+$/g, "");
}
