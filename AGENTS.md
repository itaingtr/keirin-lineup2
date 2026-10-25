# Public keirin-lineup2

- Canonical website: https://itaingtr.github.io/keirin-lineup2/ . It is publicly readable without ChatGPT login.
- Generate public/index.html and the requested public/lineYYYYMMDD.html with identical HTML using scripts/export_pages.py. Preserve all old cards and numeric values. Root and date files use /keirin-lineup2/data/YYYYMMDD/ for data and /keirin-lineup2/ for shared assets.
- Keep the original layout, side-by-side exacta tables, AI marks and previous meeting results. Results, video and live links open the original WINTICKET HTTPS page in the same tab, preserving playerIds. GitHub Pages has no /open-web backend.
- Collect next-day WINTICKET public S-class cards at 21:00 and 23:30 Asia/Tokyo. Missing lineups omit the whole meeting; empty/invalid/network-failed collections preserve the working page. Nightly cards do not collect odds.
- Collect odds for the published card on its race day every hour from 09:00 through 20:00 Asia/Tokyo. Keep original observation times and last successful quotes. Append immutable runs in odds-diagnostics, and update only public display pointers. Do not write raw pages, user comments, tokens or database backups to Git.
- No Supabase writes, schema changes, credential extraction, stored-data overwrite or deletion for publication. Existing client-side comments use their existing publishable key and RLS; backend data and authentication policies remain unchanged.
- scripts/update_publication.py uses the repository's normal GITHUB_TOKEN. The default-branch workflow publishes Pages itself after its bot commit. No human approval is part of a scheduled update.
- Validate Python source/export tests and tests/test_pages.cjs with actual saved display odds. After publication, scripts/verify_pages.py verifies anonymous HTTP access and exact bytes for root, current date and assets. Verify saved feed commits directly to avoid a temporarily stale raw branch CDN response.
- Keep the original itaingtr/keirin-lineup site and all its stored data intact. Stop the old fallback schedulers only after this new public deployment and its automatic writer have passed.
