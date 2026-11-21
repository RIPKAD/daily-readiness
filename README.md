# Daily readiness

Morning check-in for Kaden. He logs resting heart rate, HRV, weight, and a few subjective scores from his phone. The app scores the morning against his own rolling baseline and suggests whether the day should stay easy, stay on plan, or grow a little. The priority is aerobic work below LT1, with the week’s kilojoules protected.

The site is a static Vite build. Asset URLs are relative, so it can be hosted on GitHub Pages at a project path such as `/daily-readiness/`.

## Run it locally

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (port 45931). `npm run build` writes the static site to `dist/`. `npm run preview` serves that folder.

## Where the API key lives

Settings → API key. The key is stored only in this browser, under the localStorage entry `dr.intervalsApiKey`. It is not in the source, not in the JSON backup, and not sent anywhere except `intervals.icu`.

The app calls `https://intervals.icu/api/v1/athlete/0/` with HTTP Basic auth. The username is the literal `API_KEY` and the password is the key from intervals.icu → Settings → Developer Settings. Paste the key only. Using athlete id `0` means “the athlete who owns this key.”

A direct check against the API showed that `/api/v1/` allows browser calls. The response included `Access-Control-Allow-Origin` set to the page’s origin, and the preflight allowed `GET` and `PUT` with `Authorization` and `Content-Type`. If a later call fails, the check-in is still saved on the phone.

What gets written with `PUT wellness/{date}`:

- `restingHR`
- `hrv` (rMSSD)
- `hrvSDNN`
- `weight`, converted from pounds with `1 kg = 2.20462 lb`

Sleep quality, soreness, stress, mood, and overall feeling are **not** written. intervals.icu uses different scales (sleep and mood are 1–4 with 1 best; soreness, fatigue, and stress are 0–4). Kaden’s scales do not map onto those, so copying the numbers would mean the wrong thing. Those answers stay in the local log.

Workout quality is stored on the phone and can be linked to an activity id and name. It is not written onto the activity, because 1 / 3 / 5 / 7 / 9 is not an intervals.icu field.

CTL, ATL, and sleep hours can be read and shown. They are not part of the score, and they are not written back.

## HRV4Training CSV

There is no Dropbox API. Export the CSV from HRV4Training, then on Today or Settings use **Choose CSV**. On a phone, the Files app can open the Dropbox copy.

The parser looks for a date column (`date`, `local`, `timestamp`, and similar) and for rMSSD and SDNN under messy headers (`rMSSD`, `rMSSD (ms)`, `rMSSD_lying`, `HRV`, `SDNN`, `hrvSDNN`). `lnRMSSD` is ignored because it is a different number. `0` is treated as missing. You get a preview, and nothing is saved until you confirm. Saving updates the local log only. It does not upload the rows to intervals.icu.

Android exports have used `YYYY-DD-MM`. If any date has a middle number above 12, the file is read that way and the preview says so. If every date is valid either way, it is read as `YYYY-MM-DD` and a warning is shown.

## Score

For each metric with at least 7 values in the previous window (default 42 days, not including the morning being scored):

1. z-score against that personal baseline, using the sample standard deviation.
2. Flip the sign when lower is better: resting HR, soreness, stress.
3. Multiply by the weight. rMSSD and overall feeling start as the heaviest.
4. Take the weighted mean of those z-scores.
5. `score = clamp(50 + 15 × weighted mean z, 0, 100)`.

Green is 65 and up, amber is 40–64.9, red is below 40. The bars under the score are each metric’s signed points. They add up to `score − 50` before the clamp.

**Suggest weights** needs about 40 days that have both a check-in and a workout quality for that same date. It correlates each readiness-oriented metric with that quality and proposes weights. Nothing is applied until you press the button.

## Backup

Settings can download JSON (check-ins, workouts, benchmarks, score settings) and CSV. Import merges by date or id. The API key is never included. A second copy of the log is kept in localStorage (`dr.backup.v1`) as well as IndexedDB, so a failed intervals write does not drop the morning.

Weight in the form and in exports is pounds.

## Deploy to GitHub Pages

The expected URL is [https://ripkad.github.io/daily-readiness/](https://ripkad.github.io/daily-readiness/).

1. Push `main`.
2. In the repo, open Settings → Pages → Build and deployment, and choose **GitHub Actions** (not “Deploy from a branch”).
3. The workflow in `.github/workflows/pages.yml` runs the tests, builds `dist/`, and deploys it. The site root is the project path `/daily-readiness/`. Built asset paths are relative (`./assets/...`), so the same `dist/` also works if you open it from a local preview.

Hash routes (`#today`, `#workout`, `#history`, `#settings`) avoid needing a server rewrite.

## Decisions still open

- The spec file with the original dropdown sentences was not in the project. Workout quality uses the requested labels: 1 Very weak, 3 Weak, 5 Normal, 7 Strong, 9 Very strong. Sleep, stress, and mood use the TrainingPeaks labels, which match the requested lengths (7, 7, and 3). Soreness and overall feeling are 8-step lists written in `src/scales.ts`. Change that file if the paper form uses different words. Stored values are the numbers, so a label edit does not rewrite history.
- Benchmark tests are a free-form log (date, name, result, notes). The definitions are still TBD.
- The weekly kJ target is optional and blank until it is set. The week is Monday–Sunday. The total is mechanical work from intervals.icu `icu_joules`, not calories.
- Suggest-weights pairs a morning with workout quality logged for the same calendar date. Two sessions that day are averaged.
- Deleting a morning removes it from this phone only. It does not clear the intervals.icu wellness record.
