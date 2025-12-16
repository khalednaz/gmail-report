# Brixeon Gmail Report Phishing Add-in

This document explains how the Brixeon Gmail Report Phishing add-in integrates with the phishing system, how users report emails, how email templates must be configured, and how the add-in is deployed organization-wide in Google Workplace (**1. Logic**, **2. Usage**, **3. Email Template Requirements**, **4. Google Workplace Deployment**)

## 1. How the logic works with the phishing system

### Flow

1. A user opens an email in Gmail.
2. The user clicks **Report Phishing** from the Brixeon Gmail add-in.
3. The add-in scans the email body and extracts a reporting URL:
 ```js
/report?rid=<RID>
```
4. The add-in sends a request to the phishing system:
 ```js
GET https://<BASE_URL>/report?rid=<RID>
```

5. The phishing system:
- Resolves the RID
- Loads the correct campaign result
- Marks the email as **Reported**

### Gmail add-in: extracting the report URL (no hardcoded domain)

The Gmail add-in extractes the reporting URL using multiple fallback strategies to support different environments and template formats.
**Code.gs**
```js
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
```

Once the URL is resolved, the add-in calls the endpoint:
**Code.gs**
```js
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

```

### Phishing system: how /report?rid=... is processed

When the phishing system receives the /report request:

- The rid parameter is extracted from the query string
- The system loads:
  - The related campaign
  - The recipient
  - The campaign result
- A Reported event is created
- The result status is updated and saved
**controllers/phish.go**
```js
func ReportHandler(w http.ResponseWriter, r *http.Request) {
  r, err := setupContext(r)

  details := ctx.Get(r, "details").(EventDetails)
  err = result.HandleEmailReport(details)

  w.WriteHeader(http.StatusNoContent)
}
```
**controllers/result.go**
```js
func (r *Result) HandleEmailReport(details EventDetails) error {
  event, err := r.createEvent(EventReported, details)
  r.Reported = true
  r.ModifiedDate = event.Time
  return db.Save(r).Error
}
```
End result

The campaign results dashboard shows the email as Reported.

## 2. How a User Reports an Email (Usage)
### User Steps (Gmail)
1. Open the suspicious email in Gmail.
   
   <img width="1914" height="936" alt="Screenshot 2025-12-16 163212" src="https://github.com/user-attachments/assets/59012946-6f43-4a50-848a-58f965e328be" />

   
2. Click the "Brixeon Icon" on the side menu.
   
   <img width="1914" height="936" alt="Screenshot 2025-12-16 163212" src="https://github.com/user-attachments/assets/59012946-6f43-4a50-848a-58f965e328be" />

   
3. Click the "Report Phishing" Button.
   
   <img width="1918" height="940" alt="Screenshot 2025-12-16 163224" src="https://github.com/user-attachments/assets/ece7482f-3ea4-4f48-98ed-165f49355a36" />
   

4. Wait for the add-in to process:

    - Scans the email body for the report URL.
    - Contacts the phishing system.
    - Displays immediate feedback.

### User Feedback Notifications
The add-in provides a clear message upon completion:

<img width="1912" height="937" alt="Screenshot 2025-12-16 163819" src="https://github.com/user-attachments/assets/7c7b09ec-2665-4e80-9eba-2847e138a879" />


**Note:** On failure, a message will appear saying “Couldn’t find a report link”. This usually means the email template is missing the required reporting marker.


## 3. Email Template Requirement
### Required Marker
Every phishing email template must include the following hidden marker to be compatible with the add-in (Similar to hidden image tracker):

```html
<div style="display:none; font-size:0; line-height:0; max-height:0; overflow:hidden;">
  BRIXEON_REPORT_URL:{{.BaseURL}}/report?rid={{.RId}}
</div>
```

### Why {{.BaseURL}} is Required
✅ Correct Usage ({{.BaseURL}}): Contains only the scheme + host.

Result: https://example.com/report?rid=abc123

❌ Incorrect Usage ({{.URL}}): Includes existing paths and query strings.

Result: https://example.com/login?rid=abc123/report?rid=abc123 (Invalid)

## 4. Test Deployment (Gmail)


Follow these steps to test this add-in

1. Open the **Google scripts**: (https://script.google.com/)
   
   <img width="1915" height="940" alt="Screenshot 2025-12-16 165437" src="https://github.com/user-attachments/assets/4eeced5d-83b1-4f69-9810-981df240361c" />


2. Click on **New Project**.
   
  <img width="1919" height="943" alt="Screenshot 2025-12-16 165617" src="https://github.com/user-attachments/assets/c099f208-4ab4-4cfe-bad1-5d83f606c5a1" />

   
3. Paste the content of Code.js in this respo to opened Code.js, and create a new file called appsscript.json and paste the content of this respo's appsscript.json.
   
   <img width="1919" height="942" alt="Screenshot 2025-12-16 165810" src="https://github.com/user-attachments/assets/b9f640d7-dd42-49a7-a351-7f21c071ccd8" />
   

4. Click on **deploy** Button on the top right then choose on test deployement, then click on install .
   
  <img width="1915" height="942" alt="Screenshot 2025-12-16 170059" src="https://github.com/user-attachments/assets/ae4edc3e-6f9c-415e-aa3f-1ca361d4e002" />


## 4. Real Deployment (Google workplace)
**Note:** We are waiting for google to approve our app in google market place.



## Main Functions in Code.gs

- **onGmailMessageOpen(e)** – Builds the add-on card UI when an email is opened (header + “Report Phishing” button that triggers `reportPhish_`).
- **reportPhish_(e)** – Runs on button click: loads the opened message, resolves the `/report?rid=...` URL, calls the report endpoint, then shows success/fail notification.
- **resolveReportUrl_(msg)** – Resolves the correct `https://.../report?rid=...` link without hardcoding a domain (marker → direct link → rid+base fallback).






