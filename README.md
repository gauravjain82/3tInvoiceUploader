# InvoiceBot client setup

Final Save is enabled. The bot processes PDFs in company subfolders of `pending`. Billing company is chosen only from the folder-name mapping in `billing-company.csv`; PDF contents are not parsed. It uses the vendor ID entered at startup and reads invoice numbers from MSIL's preview when available. It confirms the preview popup, clicks final Save, and waits for MSIL's `Data saved successfully.` message. Verified uploads move to `uploaded\<company folder>`; invoice-specific failures move to `failed\<company folder>`. Browser, login or network failures stop the batch without moving affected or remaining PDFs. If Save was attempted but the result is uncertain, check MSIL before retrying; the bot does not automatically retry Save.

## Install on a client Windows PC

If you cloned this Git repository, first copy the `*.example.csv` files to their local config filenames and edit them as described in [GIT-SETUP.md](GIT-SETUP.md). The private invoice folders, browser profile, reports and real config files are excluded from Git. For the separate unload receipt bot and Excel exports, see [unload-receipts/README.md](unload-receipts/README.md).

1. Install Node.js **22 or newer** with npm from [nodejs.org](https://nodejs.org/en/download). The included setup accepts newer major versions, including Node 24; this project was tested locally with Node.js 22.16.0.
2. Install Microsoft Edge if it is not already installed. This project uses the installed Edge browser through Playwright's `msedge` channel; no separate Chromium download is needed. See [Playwright browser documentation](https://playwright.dev/docs/browsers).
3. Clone this repository or extract `InvoiceBot-client.zip` to `C:\InvoiceBot`. The directory should directly contain `bot.js`, `package.json`, and `setup-client.cmd`.
4. Double-click **setup-client.cmd**. It runs `npm ci` to install the versions in `package-lock.json` and creates the working directories. Internet or access to the company's npm registry is required during installation. See [npm ci documentation](https://docs.npmjs.com/cli/commands/npm-ci/).
5. Check `billing-company.csv`. Map each direct company subfolder name to its MSIL billing company code using the header `FolderName,BillingCompanyCode`. One-digit codes such as `2` become `02`. Folder names are compared without case sensitivity. Never infer a company from a PDF, GSTIN, or filename.
6. Confirm the client PC can open this page manually in Edge while connected to the same office network or approved VPN:

   ```text
   http://192.168.1.249/MSILInvoice/Digital_Invoice_Upload.aspx?Vendors=YOUR_VENDOR_ID
   ```

Replace `YOUR_VENDOR_ID` with the vendor ID associated with the MSIL user, for example `R487`. The client needs its working security pen drive and normal MSIL login setup. Log in manually when requested. The bot creates its own `edge-profile` on the client; a login in a regular Edge window is separate. The client ZIP contains no saved login, invoices, or historical logs.

## Run the bot

Temporary upload/preview timeouts and connection errors before final Save receive up to **3 retries after the initial attempt** (4 attempts total), with waits of 5, 10 and 15 seconds. Each retry opens a clean upload form and rechecks the vendor/company. The final report records one outcome per invoice and includes the attempt count when retries occurred. The PDF is moved only after the final outcome. GSTIN mismatches, duplicates, invalid data, login/vendor problems and a closed browser are not retried. Once final Save is attempted, the bot never retries that invoice automatically; verify an uncertain result in MSIL before retrying manually. Exhausted network failures stop the batch with affected and remaining PDFs in pending.

Example `billing-company.csv`:

```csv
FolderName,BillingCompanyCode
Manesar Vehicle,02
```

Matching folders:

```text
C:\InvoiceBot\pending\Manesar Vehicle\invoice.pdf
```

Add another row and corresponding folder for each additional company, using your verified company codes. PDFs directly in `pending` or under an unmapped folder are logged as errors and are not uploaded. Only PDFs directly inside each company subfolder are processed; deeper folders, symbolic links and non-PDF files are ignored. Empty company folders are retained.

1. Copy the PDFs into the appropriate mapped subfolders of `C:\InvoiceBot\pending`.
2. Insert the security pen drive.
3. Double-click **run-bot.cmd**. Enter the vendor ID associated with the MSIL user when prompted. The bot builds the upload URL using that ID; there is no fixed `R487` vendor in the application URL.
4. Log in inside the Edge window opened by the bot if needed, then open Digital Invoice Uploading. The bot checks that the entered vendor is available in the current login's dropdown. The same entered vendor is used for all folders in the run. MSIL validates the document's GSTIN and other invoice details.
5. Review the report tab after the batch. Close the bot's Edge window before starting another run; keep only one bot instance running.

To check folder mappings without opening MSIL, reading PDF contents or moving files, open Command Prompt:

```bat
cd /d C:\InvoiceBot
node bot.js --dry-run
```

To run normally from Command Prompt:

```bat
cd /d C:\InvoiceBot
node bot.js
```

To supply the vendor ID without the startup prompt (replace the example with the client's ID):

```bat
node bot.js --vendor R487
```

Offline `--dry-run` checks do not require a vendor ID because they only validate the folder mappings.

To run the full flow for only the first PDF in folder/filename order, including final Save:

```bat
node bot.js --first
```

Enter the vendor ID when prompted, or supply it directly, for example `node bot.js --first --vendor A893`. The bot stops after that one invoice even if it fails; all other pending PDFs stay untouched. Use `--first --dry-run` to check only the first file's folder mapping without submitting it. Use the exact portal vendor ID, such as `A893`, for the URL and dropdown. No vendor is extracted from the PDF.

## View results

Double-click **open-report.cmd** to regenerate and open the report. Alternatively open `C:\InvoiceBot\logs\report.html` directly and click Refresh results after a run.

- Green Success: a verified saved upload.
- Red Error: a failed invoice, with a reason and available screenshot/details.
- Yellow Preview only: preview finished, final Save was not clicked, PDF stays in `pending`.
- Dry run: folder mapping check only; no PDF parsing, browser action or file movement.

Use the Show dropdown for All, Success, Error, or historical preview/dry-run results. Download CSV using the report links. New real runs perform final Save and record Success only after MSIL confirms the saved upload. Previous preview-only entries remain labelled as previews.

## Clear the report

After the batch finishes, double-click **clear-report.cmd**, or run:

```bat
cd /d C:\InvoiceBot
npm run clear-report
```

The command copies the current CSV history, report and referenced screenshots to a timestamped folder under `logs\archive`, then creates an empty active report and CSV files. It opens the cleared report when launched through `clear-report.cmd`. Invoice PDFs, the billing mapping and the saved Edge login are kept. Do this between batches, with CSV files closed in Excel.

The report's **Clear report...** button shows these instructions. The static HTML page cannot directly reset files on disk; the command performs the reset. To view older results, open `report.html` inside the appropriate archive folder.

## Files in logs

| File | Purpose |
| --- | --- |
| `invoices.csv` | Complete run history; preserve this file |
| `success.csv` | Saved-upload successes |
| `failed.csv` | Errors and reasons |
| `preview.csv` | Preview-only runs |
| `dry-run.csv` | Folder mapping checks |
| `skipped.csv` | Runs with no pending PDFs |
| `report.html` | Filterable coloured report |
| `*-error.png` | Screenshots referenced by error records |
| `archive\` | History and screenshots retained by the clear-report command |

The report and individual status CSVs can be regenerated from `invoices.csv` by running `node run-log.js`. Close CSV files in Excel before running the bot or rebuilding reports if Excel locks them.

## Common issues

- **Edge profile already in use:** close the Edge window from the previous bot run and stop the previous terminal run, then restart. Do not delete `edge-profile` to unlock it.
- **MSIL address does not open:** confirm office network/VPN access and that the same URL opens manually on the client. Ask the client's IT team about network or browser restrictions if it does not.
- **Folder not mapped:** add the exact folder name and company code to `billing-company.csv`, review the failure, and move the PDF from `failed\<folder>` back to `pending\<folder>` before retrying.
- **Invoice Document already exists:** check the existing invoice in MSIL before any retry.
- **Setup says to use the 22.x release line while Node 24 is installed:** replace the old setup scripts with the latest client ZIP. The updated setup accepts Node 22 or newer; a downgrade is not required by its version check.
- **Node/npm not found:** reopen the terminal after installing Node.js. The launchers check common installation locations before a bounded PATH lookup and use the detected executable directly. Run `setup-client.cmd --check-node` from Command Prompt to print the Node path/version and npm version without installing dependencies.
- **Node installed in a custom location:** set `INVOICEBOT_NODE` to the full `node.exe` path in Command Prompt, then run setup from that same window. For example, `set "INVOICEBOT_NODE=C:\Program Files\nodejs\node.exe"` followed by `setup-client.cmd`. npm must be installed alongside that Node installation.
- **Setup reaches step 2 and waits:** Node has already been found. This step runs npm and needs registry access; progress and network errors now appear in the setup window. Check the client's internet/proxy access if it cannot download dependencies.
- **Client cannot install npm dependencies:** installation requires access to the configured npm registry. Coordinate an approved installation method with client IT.

The bot uses its installation directory for files, so a different writable directory also works. The MSIL server address is configured in `bot.js` in both `UPLOAD_URL` and the page-detection check; change both if the client uses another server.
