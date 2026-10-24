# HoD's Score Card 2025-26

Department of Computer Applications · School of Computing and Informatics · VFSTR

A shared web app where faculty enter Justification, Proof and Action plan against each
of the 114 scorecard metrics. Everything saves to one department database, so whoever
opens the link sees the current state.

Holds more than one academic year. Tabs at the top switch between them; each year keeps
its own responses, comments, justifications, proofs, action plans and uploaded files.

---

## What you need

Three free accounts:

| Service | What it holds | Sign up |
|---|---|---|
| Vercel | The app itself | vercel.com |
| Neon Postgres | Text entries, responses, edit history | added from inside Vercel |
| Cloudinary | Uploaded proof files | cloudinary.com |

---

## Deploy — step by step

### 1. Put the code on GitHub

Create an empty repository, then from this folder:

```bash
git init
git add .
git commit -m "HoD scorecard"
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

### 2. Import it into Vercel

On vercel.com, **Add New → Project**, pick the repository, and deploy.
No build settings to change — leave the framework as "Other".

### 3. Add the database

In your Vercel project: **Storage → Create Database → Neon (Postgres)**.

Vercel does not host databases itself; it provisions Neon through the Marketplace
and injects `DATABASE_URL` into your project automatically. You do not need to copy
anything by hand. Tables are created on first request.

### 4. Add Cloudinary

Sign up at cloudinary.com. On the dashboard, find **Cloud name**, **API Key** and
**API Secret** under Product Environment Credentials.

### 5. Set the environment variables

In Vercel: **Settings → Environment Variables**. Add these five
(`DATABASE_URL` is already there from step 3):

| Name | Value |
|---|---|
| `DEPT_USERNAME` | The shared username faculty type. Defaults to `213` if unset. |
| `DEPT_PASSWORD` | The shared password you give faculty. |
| `SESSION_SECRET` | Any long random string — run `openssl rand -base64 32` |
| `CLOUDINARY_CLOUD_NAME` | from the Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | from the Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | from the Cloudinary dashboard |

Then **Deployments → Redeploy**, so the new variables take effect.

### 6. Load the workbook figures (optional, once)

Copy `DATABASE_URL` from Vercel and run locally:

```bash
npm install
DATABASE_URL="paste-it-here" npm run seed
```

This writes the 114 original responses into the database. Skip it and the app still
works — it falls back to the figures in `data/metrics.json`.

### 7. Share the link

Send faculty the Vercel URL and the department password. They enter their name on
sign-in, and that name is stamped on everything they save.

---

## Academic years

Tabs under the banner switch year. The metrics, portfolios and the four band
thresholds are identical across years — only what faculty enter differs. The badge on
each tab counts how many of the 114 responses that year holds.

- **2025-26** opens with the figures imported from the workbook.
- **2026-27** starts completely empty and fills in as faculty enter it.

Both years stay editable, so a correction to last year is still possible. Nothing a
faculty member types in one year can affect the other: each metric is a separate
database row per year.

### Opening a further year

1. Add the id to `YEARS` in `api/_years.js`.
2. Add a matching entry to `meta.years` in `public/metrics.json` **and**
   `data/metrics.json`, with `"seeded": false` so its responses start empty.
3. Redeploy. No database work is needed — the new year's rows appear as they are saved.

Both lists must agree: `_years.js` guards the API, `metrics.json` builds the tabs.

### Upgrading an existing deployment

The first request after deploying migrates the database automatically: it adds a `year`
column to `entries`, `attachments` and `history`, stamps every existing row `2025-26`,
and changes the `entries` primary key from `metric_no` to `(year, metric_no)`. Existing
entries, uploads and edit history are preserved exactly. The migration runs once and is
skipped on every later request.

## How it behaves

**Switching year.** The tabs reload that year from the database. The page never carries
one year's typing into another.

**Signing in.** One shared username and password for the whole department, plus the
person's own name. The name is what appears in "Last saved by", so faculty should use
their real one. If left blank it falls back to the username.

**Editing.** Response and Comments are editable directly in the sheet and save
automatically about a second after typing stops. Clicking a row opens that metric's
own page for Justification, Proof, Action plan and file uploads, which save when
**Save** is pressed.

**Two people, one metric.** Each metric is a separate database row, so different
metrics never collide. If two people edit the *same* metric, the second save is held
back and shows what the other person wrote, with a choice: replace theirs, or load
theirs. Nobody's work disappears silently.

**Staying current.** The sheet refreshes from the database every 45 seconds, and
there is a **Refresh** button. An indicator beside the toolbar reads Saved, Saving,
or Offline.

**Proof files.** PDF, images, Word, Excel and PowerPoint up to 10 MB. Files go
straight from the browser to Cloudinary using a short-lived signature, so the API
secret stays on the server and large files never pass through a Vercel function.

**Bands.** Computed from the threshold columns in the sheet, not stored. Direction is
read from the Beginning cell: `< 85` means higher is better, `> 24` means lower is
better. Change a response and the band, comment, totals, donut and section bars all
update at once.

**CSV.** Exports the year currently on screen — every column plus Justification, Proof,
Action plan, file links and who last saved each row, ready to paste back into the
workbook. The file is named for its year.

**Links.** `#2026-27` opens that year, `#2026-27/m45` opens metric 45 within it, so a
specific row can be sent to a colleague.

---

## Files

```
api/            serverless functions
  _years.js     the academic years the API accepts
  _db.js        Neon connection, schema, migration, helpers
  _auth.js      signed session cookie
  login.js      password check, throttled per IP
  state.js      all saved entries and attachments
  entry.js      save one metric, with conflict detection
  upload-sign.js  short-lived Cloudinary signature
  attachment.js   record and delete uploaded files
  history.js    who changed what and when
public/         the front end
  index.html    markup
  app.css       styling, university band colours
  app.js        scoring engine, sheet, detail pages, uploads
  metrics.json  the 114 metrics and their thresholds
data/           seed copy of metrics.json
scripts/seed.mjs  one-off import of workbook responses
```

## Notes

- Every change is written to a `history` table — metric, field, old value, new
  value, who, when. Nothing entered is lost, even if later overwritten.
  `GET /api/history?metricNo=45` returns the log for one metric.
- Change `DEPT_PASSWORD` when the review cycle ends; existing sessions expire after
  12 hours regardless.
- The app is marked `noindex`, but a shared password is a shared password. It is
  appropriate for internal departmental data, not for anything confidential.
- To correct a metric's wording or thresholds, edit `public/metrics.json` and
  redeploy. Saved entries are keyed by year and metric number and are unaffected.
- Every change is recorded per year, so `GET /api/history?year=2026-27&metricNo=45`
  returns that metric's log for that year alone.
