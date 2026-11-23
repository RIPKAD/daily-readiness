# Daily readiness

The app is a static site. Data stays on the phone (IndexedDB, with a localStorage copy) and in JSON backups. Nothing about food or lifting is sent to intervals.icu. The only theme is dark gray (`#121212` pages, `#1e1e1e` cards, light text).

## Readiness

A morning check-in scores resting HR, HRV, and subjective scales against a personal baseline. Lower resting HR, soreness, fatigue, and stress raise readiness. Suggest-weights uses the main workout of a day: the log marked Main, otherwise the most kilojoules, then the longest moving time, then the most recently updated log. Strength sessions are not workout logs and never become that main workout.

## Food

`public/foods.json` is an array of `{ id, name, serving, kcal, protein, carbs, fat }` per serving. The phone updates a shared food when the id matches, unless that food was edited locally. Swipe a common food left, or hold it, to hide it. Hidden ids stay on the phone, so the next foods.json merge does not bring that food back. User-added foods can be deleted. Logged rows keep their own name and macros. Settings has a Hidden foods list to unhide.

`public/targets.json` is fetched with `cache: 'no-cache'` when the Food tab opens and when the app regains focus:

```json
{
  "updated": "ISO timestamp",
  "days": {
    "YYYY-MM-DD": {
      "kcal": 2291,
      "protein": 149,
      "carbs": 139,
      "fat": 126,
      "day_type": "easy",
      "planned_kj": 406,
      "actual_kj": null,
      "revised": false,
      "note": "short text"
    }
  }
}
```

The file holds about the last 14 days plus tomorrow. A number saved on the phone for that date wins over the file. If the day is missing, the tab says `No target yet` and the four boxes are a manual target. Bars show logged versus target. Going over uses a muted gold, not red. The line under the bars shows the day type, planned or actual kJ, and `revised after workout` when `revised` is true.

## Strength

Two session types, Lower and Upper. Tapping one starts a session copied from the last saved session of that type. If there is none, it copies the template.

Seeded templates:

- Lower: Deadlift. Warm-up sets at 45, 75, 95, and 115 lb, 5 reps, collapsed. Working sets 3 x 3 @ 165 lb.
- Upper, five sets each: incline bench press 6 @ 95 lb, cable face-pull 10 @ 25 lb, chest fly machine 10 @ 100 lb, lat pulldown 10 @ 100 lb.

Weights step by 5 lb and reps by 1. A set can be completed or marked missed. Under each exercise, the last session’s top set and the best-ever top set are the heaviest completed working weight, then the most reps at that weight.

If both of the previous two sessions of that exercise finished every working set at or above the prescribed reps, the screen says `Try +5 lb`. One tap adds 5 lb to the working sets only.

RPE is optional, 1–10. Duration defaults to 45 minutes. Estimated kcal is `durationMin × 4.5` (202.5 kcal at 45 minutes) and is stored on the session. Date defaults to today. Past sessions can be edited or deleted. Exercises can be added or removed in a session. Templates are edited in the Templates section on the Strength tab.

History shows `Lift: Lower` and `Lift: Upper` on that date.

The strength CSV is one row per set: `date, session_type, exercise, set_number, warmup, weight_lb, reps, completed, rpe, duration_min, est_kcal`.
