# How to publish these pages to the GitHub Wiki

These 6 wiki pages (+ Home, sidebar, footer) live here in the repo so they're version-controlled and
reviewable. GitHub's **Wiki** is a *separate* git repository (`<repo>.wiki.git`) that only exists **after**
you enable the wiki and create the first page in the web UI. Two ways to publish:

---

## Option A — One-time setup, then push (recommended)

1. **Enable the wiki:** GitHub → repo **Settings** → *Features* → tick **Wikis**.
2. **Create the first page:** open the **Wiki** tab → **Create the first page** → Save (any content — it'll
   be overwritten). This step *creates* the `climatwin-india.wiki.git` repo so it can be pushed to.
3. **Run the publish script** from the repo root:

   ```bash
   bash wiki/publish.sh
   ```

   It clones the now-existing wiki repo, copies every page from `wiki/`, commits, and pushes. Re-run it any
   time you edit a page here to re-sync.

---

## Option B — Manual copy-paste

Open the **Wiki** tab → **New Page** for each file below, paste the contents, and name the page with the
title in the right column (GitHub turns spaces into hyphens to match the filenames).

| File | Wiki page name |
|---|---|
| `Home.md` | Home |
| `Research-Foundations.md` | Research Foundations |
| `Data-Sources-and-Provenance.md` | Data Sources and Provenance |
| `Model-Architecture-and-Approach.md` | Model Architecture and Approach |
| `Low-Latency-Engineering.md` | Low Latency Engineering |
| `Real-time-Roadmap-and-the-Best-Model.md` | Real-time Roadmap and the Best Model |
| `Future-Scope.md` | Future Scope |
| `_Sidebar.md` | _Sidebar (navigation) |
| `_Footer.md` | _Footer |

---

### Notes

- Internal links use `[[Page Title]]` syntax — GitHub Wiki resolves these automatically once the pages exist.
- Images are **real, official-source** URLs: dashboard screenshots via `raw.githubusercontent.com` and
  external logos/satellite imagery via **Wikimedia Commons** `Special:FilePath` (both render through GitHub's
  image proxy).
- The pages here are the **source of truth** — edit them in the repo, then re-run `publish.sh`.
