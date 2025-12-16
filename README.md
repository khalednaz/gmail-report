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

## 4. Deployment (Microsoft 365 Admin Console)

### Centralized Deployment

Follow these steps to deploy the add-in organization-wide via the Microsoft 365 Admin Center  
(**administrator privileges are required**):

1. Open the **Microsoft 365 Admin Center**: https://admin.microsoft.com
   
   <img width="1899" height="940" alt="Screenshot 2025-12-16 144219" src="https://github.com/user-attachments/assets/cc00984c-7fdc-41df-a545-ebafb890590e" />


2. Go to **Settings** → **Integrated apps**.
   
   <img width="1917" height="935" alt="Screenshot 2025-12-16 144504" src="https://github.com/user-attachments/assets/05a42468-14c5-4102-b5d2-f444a9339243" />

   
3. Select **Upload Custom Apps**.
   
   <img width="1911" height="937" alt="Screenshot 2025-12-16 144802" src="https://github.com/user-attachments/assets/c582038a-f8d0-40e4-b9ef-2659567a9528" />

   
4. Select **App Type** as **Office Add-in**.
   
   <img width="1907" height="941" alt="Screenshot 2025-12-16 144854" src="https://github.com/user-attachments/assets/1c0106f3-9408-4d0a-a1d2-f2b32c495a83" />


5. Upload the provided `manifest.xml` file and click next.
   
   <img width="1902" height="938" alt="Screenshot 2025-12-16 150132" src="https://github.com/user-attachments/assets/6cb7fe6a-6ff3-4570-8b95-dd52b3d557ab" />


6. Select **Entire organization** and click next.
    
   <img width="1913" height="942" alt="Screenshot 2025-12-16 150249" src="https://github.com/user-attachments/assets/cc3107df-a826-40fb-bb1a-713eb594e44e" />


7. Accept permissions requests by clicking next and then click finish to deploy in the next step.
    
   <img width="1913" height="937" alt="Screenshot 2025-12-16 151746" src="https://github.com/user-attachments/assets/dd945fb8-8563-4cce-814c-e68bb068ef76" />



**Availability** Organization-wide deployment can take up to **24 hours**; users may need to restart **Gmail Desktop** or refresh **Gmail Web** to see the add-in.

## Add-in File Structure

- **manifest.xml** – Defines the add-in identity, permissions, supported hosts, UI buttons, icons, and which pages/scripts Gmail should load.
- **commands.html** – Lightweight loader page that loads Office.js and the command logic when the user clicks the add-in button.
- **commands.js** – Core logic that reads the email content, extracts the report URL, calls the phishing system, and shows success or failure messages.
- **taskpane.html** – Minimal task pane/read surface referenced by the manifest, mainly to satisfy Gmail UI requirements.
- **assets/** – Contains icon images used for the toolbar button and add-in listing (16/32/80/128 px).

**Note:** All add-in files are hosted over HTTPS at **https://brixeon.com/Gmail-addin/**.





