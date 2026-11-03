# Repository setup

Source code, tests, launchers, dependency manifests and example config files belong in this repository. Invoice PDFs, reports, logs, downloaded drivers, browser profiles, dependencies and real local config files are ignored.

After cloning, copy the examples to local config files and edit them:

```powershell
Copy-Item billing-company.example.csv billing-company.csv
Copy-Item unload-plants.example.csv unload-plants.csv
Copy-Item unload-requests.example.csv unload-requests.csv
```

Follow README.md for invoice setup and unload-receipts/README.md for receipt bot dependencies and IEDriver setup. Install dependencies separately in each folder with `npm ci`.

Review the files for your first commit:

```powershell
git status --short
git add .
git diff --cached --stat
git commit -m "Initial invoice and unload receipt automation"
```

To publish, create an empty private repository on your Git hosting service, then use its repository URL:

```powershell
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

Do not force-add ignored files containing invoices or browser login data.
