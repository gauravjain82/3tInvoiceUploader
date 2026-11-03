# Unload receipt IE-mode inspector

Separate from the invoice uploader. Uses Selenium + IEDriver; it does not use the invoice bot's edge-profile or change its dependencies. Login is manual. Automatic menu/plant navigation is available through the launcher below. No automated report submissions or downloads yet.

## Automatic navigation after login

Run `run-unload-receipt.cmd` or `node unload-receipts/inspect.js --navigate` from C:\InvoiceBot. Log in manually and let Home load. The bot opens Delivery Queries, clicks the plant button matching the **first row** of `unload-plants.csv`, opens Supply: Unload Number Wise Receipt Report, verifies the plant code/name and stops. It does not fill or submit the report. Use the date-range exporter below for multiple plants and dates.

`inspect-unload-receipt.cmd` remains the separate manual-navigation inspector.

## Date-range Excel report export

Edit `C:\InvoiceBot\unload-requests.csv` in Excel or a text editor, preserving these columns:

```csv
CompCode,FromDate,ToDate,VendorCode,SRVType
02,01-OCT-2026,31-OCT-2026,R487,Both
```

Dates use DD-MON-YYYY. Every date between FromDate and ToDate is included, including both ends. SRVType accepts Both, OE or Spares (case insensitive). Both performs separate OE and Spares queries, so the example makes 62 requests. SRV Number is always ALL. Overlapping duplicate requests are processed once per run.

CompName and the full plant name are read from the portal's plant buttons using CompCode; no guessed plant-name mapping is used. VendorCode must be offered by the portal for the logged-in user. Add more CSV rows for additional plants, vendors or date ranges.

Double-click `download-unload-receipts.cmd`, then log in manually when required. The bot selects the plant, fills the form, submits each report query and exports its table. The old invoice uploader is untouched. The existing `run-unload-receipt.cmd` still only navigates to the form and stops.

Each run creates `C:\InvoiceBot\unload-reports\<timestamp>\` with:

- `receipts.xlsx`: one worksheet per plant, containing only MSIL's original report headers and rows in their original order. Results from all dates, vendors and SRV types for that plant append to its worksheet. No metadata, status columns or artificial no-data rows are added. Long plant names are shortened to Excel's 31-character limit; for example, MANESAR POWERTRAIN - ENGINE. Full plant names remain in the separate query log. All identifiers are stored as text to preserve leading zeroes and long numbers.
- `query-status.csv`: one row per attempted date/type, including record count, outcome and details folder.
- `requests.json`: the complete expanded query plan for the run; requests without a status row were not attempted if the batch stopped.
- A folder per query containing page text, captured tables/links and a screenshot.

SUCCESS means table rows were exported. NO_DATA means the portal explicitly returned No Data Found; it is recorded only in the separate query-status.csv, without adding a row to the workbook. A plant with no data has an empty worksheet. FAILED includes the reason in the separate query log. Unknown layouts, merged rows, pagination or changed columns within a plant stop the run rather than exporting incomplete data. Such cases need inspection before enabling support. The workbook and query log are updated after each query. Every run uses a new folder and does not overwrite previous runs. Protect these local reports because they can contain business data.

Useful terminal commands from C:\InvoiceBot:

```powershell
node unload-receipts/run.js --plan
node unload-receipts/run.js --first
node unload-receipts/run.js
node unload-receipts/run.js --csv "C:\InvoiceBot\another-requests.csv"
node --test unload-receipts/navigation.test.js unload-receipts/report.test.js unload-receipts/workbook.test.js
```

`--plan` validates the input CSV and displays the expanded schedule without opening Edge. `--first` runs one date/type query. Ctrl+C stops the bot; completed workbook rows remain saved. A new run re-queries its configured dates; it does not automatically resume an earlier folder.

To convert a previously saved run to Excel without querying MSIL again:

```powershell
node unload-receipts/rebuild-workbook.js "C:\InvoiceBot\unload-reports\<saved-run-folder>"
```

`node unload-receipts/run.js --until-data` checks the configured dates in order and stops after exporting the first non-empty report. Dates after that are intentionally left unprocessed. This is useful when testing the report layout for a new plant.

From C:\InvoiceBot, run `inspect-unload-receipt.cmd` or `node unload-receipts/inspect.js`. Optional: `--home-url "https://your-working-home-url/"`.

Dependencies: `npm ci --prefix unload-receipts`. Selenium 4.29.0 supports this project's Node 22.16.0.

Place the official Selenium IEDriverServer.exe in `unload-receipts/drivers/`, or set UNLOAD_IE_DRIVER to its full path. The official 32-bit IEDriver 4.14.0 works on 64-bit Windows too.

Microsoft guide: https://learn.microsoft.com/en-us/microsoft-edge/webdriver/ie-mode

IEDriver requirements: https://www.selenium.dev/documentation/ie_driver_server/#required-configuration

If launch reports that Protected Mode settings differ between Internet zones, configure them consistently according to your organization's policy and Selenium's guide. The inspector does not bypass this check or change Windows security settings. IE browser zoom must be 100%. Report the exact error before changing any machine settings.

Captured controls, menu links, text and screenshots are saved under `logs/unload-receipt-inspection/<timestamp>/`. Login forms with visible password fields are skipped; keep logs private since authenticated pages can contain business data. URL query values other than plant CompCode/CompName are redacted.

The older `unload-receipt-inspect.js` is retained for reference; the launcher now uses this IE-mode inspector.
