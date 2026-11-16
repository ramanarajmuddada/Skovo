"""
Build the handover report for the manual test team from the merged workbook.

Reads SKOVO_v1_Test_Cases_Results.xlsx — the copy report_to_workbook.py writes,
never the source — and produces a Markdown summary that answers the three
questions a tester actually opens a report to ask:

    1. What is covered, and by what?
    2. What is red, and is it the product or the test?
    3. What must I check by hand, and why can a machine not do it?

The third list is the important one. A case a machine cannot decide is not a
gap in the work; it is the part of the work that needs a person, and saying so
plainly is more useful than a green tick that nobody earned.

    ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe build_final_report.py
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'SKOVO_v1_Test_Cases_Results.xlsx'
OUT = ROOT / 'SKOVO_v1_Final_Test_Report.md'

# Cases that cannot be decided by a machine, with the reason a tester needs.
# Kept here rather than inferred, because "why" is the whole value of the list.
MANUAL = {
    'UI04-019': 'A screen reader has to actually speak. The automated check verifies '
                'the accessibility tree those readers consume (every control has a '
                'role and a name, every journey a named heading) — it cannot tell you '
                'whether what NVDA/VoiceOver announced made sense. Run it by hand.',
    'X01-021': 'This one is about the CONTENTS of a production table, not about code. '
               '`error_logs` held 137 rows: 86 injected by the suite itself to prove '
               'capture_error works, and 51 for bugs since fixed. Every one is '
               'accounted for and the delete is scripted and dry-run verified — '
               '`automation/clear_resolved_error_logs.py --dry-run`, then `--apply` — '
               'but the write is blocked for the assistant by the permission '
               'classifier. Someone with the permission has to run it.',
}
PARTIAL = {
    'UI05-013': 'Frame timing was measured on the real cohort list under 4x CPU '
                'throttling, but that list holds about a dozen rows here, not the '
                '500 the case names — the database is small. The frame budget is '
                'genuinely covered; "smooth at 500 rows" is not. Re-run against a '
                'full list, or after virtualisation, before relying on it.',
}
APPROXIMATED = {
    f'UI03-{n:03d}': 'Run on Chromium/Blink with the Samsung Internet user-agent and a '
                     'Galaxy S9+ profile. That covers the engine, the viewport and any '
                     'UA-sniffing. It does NOT cover Samsung\'s own UI chrome, its '
                     'release lag behind Chromium, or its built-in ad blocker — those '
                     'need a real device.'
    for n in range(49, 57)
}
EXTERNAL_BLOCKERS = [
    ('Cashfree checkout', 'The account cannot complete an order and the launching domain '
     'is not whitelisted. Both are dashboard settings, not code. Every checkout case '
     'asserts the app up to the gateway call and its handling of the refusal.'),
    ('SES email delivery', 'Still sandboxed, and production access was refused once. No '
     'test in this suite sends mail: OTP rows are written directly and the code posted, '
     'because a dozen messages to addresses that do not exist is a dozen hard bounces.'),
    ('colleges catalogue', 'The table is empty in production. Two fixture colleges are '
     'seeded for the run and removed afterwards, so the college cases execute — but the '
     'screens are genuinely empty for real users until the catalogue is filled.'),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', type=Path, default=RESULTS)
    ap.add_argument('--out', type=Path, default=OUT)
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.source, read_only=True)
    sheets, rows_by_status = {}, defaultdict(list)
    grand = Counter()

    for ws in wb.worksheets:
        if ws.title == 'README':
            continue
        rows = ws.iter_rows(values_only=True)
        header = [str(h or '') for h in next(rows)]
        try:
            i_id = header.index('Test ID')
            i_pri = header.index('Priority')
            i_scn = header.index('Scenario')
            i_st = header.index('Status')
            i_act = header.index('Actual result')
        except ValueError:
            continue

        tally = Counter()
        for r in rows:
            cid = str(r[i_id] or '').strip()
            if not cid:
                continue
            status = str(r[i_st] or 'Not run').strip()
            tally[status] += 1
            tally['total'] += 1
            grand[status] += 1
            grand['total'] += 1
            if status in ('Fail', 'Skipped', 'Not run'):
                rows_by_status[status].append(
                    (cid, str(r[i_pri] or ''), ws.title, str(r[i_scn] or '')[:70],
                     str(r[i_act] or '')[:200]))
        sheets[ws.title] = tally

    passed = grand['Pass']
    total = grand['total']
    covered = total - grand['Not run']
    stamp = datetime.now(timezone.utc).strftime('%d %B %Y, %H:%M UTC')

    L = []
    a = L.append
    a('# SKOVO v1 — Test Execution Report')
    a('')
    a(f'_Generated {stamp} from `SKOVO_v1_Test_Cases_Results.xlsx`._')
    a('')
    a('## Summary')
    a('')
    a('| | Cases | Share |')
    a('|---|---:|---:|')
    a(f'| **Pass** | {passed} | {passed / total * 100:.1f}% |')
    a(f'| Fail | {grand["Fail"]} | {grand["Fail"] / total * 100:.1f}% |')
    a(f'| Skipped | {grand["Skipped"]} | {grand["Skipped"] / total * 100:.1f}% |')
    a(f'| Not covered | {grand["Not run"]} | {grand["Not run"] / total * 100:.1f}% |')
    a(f'| **Total** | **{total}** | |')
    a('')
    a(f'Automated coverage: **{covered} of {total}** cases ({covered / total * 100:.1f}%).')
    a('')

    a('## By sheet')
    a('')
    a('| Sheet | Total | Pass | Fail | Skipped | Not covered |')
    a('|---|---:|---:|---:|---:|---:|')
    for name, t in sheets.items():
        a(f'| {name} | {t["total"]} | {t["Pass"]} | {t["Fail"]} | '
          f'{t["Skipped"]} | {t["Not run"]} |')
    a(f'| **TOTAL** | **{total}** | **{passed}** | **{grand["Fail"]}** | '
      f'**{grand["Skipped"]}** | **{grand["Not run"]}** |')
    a('')

    for status, heading, blurb in (
        ('Fail', 'Failing cases', 'Each one is a real defect or a stated limitation — '
         'the "Actual result" column in the workbook carries the message.'),
        ('Skipped', 'Skipped cases', 'Skipped means the test ran but could not reach the '
         'thing it asserts, usually for want of data. The reason is recorded per case.'),
        ('Not run', 'Cases with no automated test', 'These need a manual pass.'),
    ):
        items = rows_by_status.get(status, [])
        if not items:
            continue
        a(f'## {heading} ({len(items)})')
        a('')
        a(blurb)
        a('')
        a('| Case | Pri | Sheet | Scenario | Detail |')
        a('|---|---|---|---|---|')
        for cid, pri, sheet, scn, act in items:
            detail = act.replace('|', '\\|').replace('\n', ' ')[:150]
            a(f'| {cid} | {pri} | {sheet} | {scn.replace("|", chr(92) + "|")} | {detail} |')
        a('')

    a('## Cases that need a person, and why')
    a('')
    a('These are not gaps in the automation — they are the parts of the plan a machine '
      'cannot honestly decide. Please cover them by hand.')
    a('')
    for cid, why in sorted(MANUAL.items()):
        a(f'- **{cid}** — {why}')
    a('')
    a(f'- **UI03-049 … UI03-056 ({len(APPROXIMATED)} cases)** — '
      + next(iter(APPROXIMATED.values())))
    a('')
    a('## Cases that pass with a stated limit')
    a('')
    a('These are green, and the annotation on each says what the run did **not** '
      'reach. Read them before treating the tick as complete coverage.')
    a('')
    for cid, why in sorted(PARTIAL.items()):
        a(f'- **{cid}** — {why}')
    a('')

    a('## What changed to get here')
    a('')
    a('This run is not just a measurement: the suite found real defects and they were '
      'fixed rather than asserted around. The full account — what was wrong, what was '
      'decided, and what was deliberately left — is the change log at the end of '
      '`CLAUDE.md`, one row per decision. The short version:')
    a('')
    a('- **Dialogs were not dialogs.** No `role`, no `aria-modal`, no focus management '
      'anywhere, so Tab walked out of every modal onto controls hidden under the '
      'backdrop. Fixed in the shared `Modal`, in `ConfirmModal`, and in the hand-rolled '
      'overlays on the screens under test.')
    a('- **Toasts were silent to screen readers** while the layout carried a comment '
      'saying they were announced.')
    a('- **A failed cohort fetch said "No cohorts found. Try a different search"** — '
      'advice that cannot work, with no way to retry.')
    a('- **My Tasks showed deadlines with no time**, and had no To-do / Submitted / '
      'Approved filter at all.')
    a('- **The upload fallback destroyed the file it was recovering** — boto3 closes '
      'the stream it is handed, so the S3-to-disk fallback raised and the upload '
      'answered 500. That is the whole of the 13 `/v1/upload/` rows in `error_logs`.')
    a('- **An admin could post an opportunity and never see who applied.** No endpoint '
      'existed; one was added.')
    a('- **The API advertised a safeguarding badge with no data behind it** '
      '(`teaches_minors` read a dropped column and was false for everyone, while the '
      'filter keyed on something else).')
    a("- **A test was blocking a real colleague's admin account** against production. "
      "It now uses a disposable seeded one.")
    a('- **Razorpay was removed** — a dependency nothing imported, three dead keys in '
      '`.env.example`, and four specs signing fake Razorpay payments. The gateway is '
      'Cashfree.')
    a('- **Five shipped screens had no test at all** — student `/payments` and '
      '`/colleges/predictor`, super-admin `/admin-approvals` and `/business`, and the '
      'achiever `/tasks` screen. Found by reconciling the route contract in both '
      'directions; all five are covered now.')
    a('')

    a('## External blockers')
    a('')
    a('None of these are code defects, and no amount of testing moves them.')
    a('')
    for name, why in EXTERNAL_BLOCKERS:
        a(f'- **{name}** — {why}')
    a('')

    a('## Before this can be deployed')
    a('')
    a('A green suite is necessary, not sufficient. These are open regardless of the '
      'numbers above:')
    a('')
    a('1. **The four dev shortcuts in CLAUDE.md §5 are still live.** `dev_otp` is '
      'returned in auth responses and its guard *fails open* '
      "(`os.getenv('Backend', 'DEV')`), so anyone who can submit an email address can "
      'read the OTP out of the JSON and take the account. `debug=True` is the Werkzeug '
      'debugger (remote code execution) and `CORS_ORIGINS` defaults to `*`.')
    a('2. **Rotate the 5 exposed credentials.**')
    a('3. **Cashfree domain whitelisting** — checkout will not render until it is done.')
    a('4. **`error_logs` still holds rows for bugs already fixed.** The table is meant to '
      'show what is broken now; stale rows send the next person chasing something that '
      'no longer exists. Run `automation/clear_resolved_error_logs.py --dry-run` to see '
      'the classification, then `--apply`. It archives every deleted row to '
      '`automation/results/error_logs_cleared.json` first, and it refuses to delete a '
      '"table does not exist" row unless that table now exists.')
    a('5. **The UI-05 performance numbers were measured against a production build** '
      '(`npx vite build` + `npx vite preview --port 4173`), not the dev server, with 4G '
      'network shaping applied through CDP. Re-measure after any change to chunking — '
      'the whiteboard is a 1.75 MB lazy chunk and must stay out of the main bundle.')
    a('')

    a('## How to re-run this')
    a('')
    a('```')
    a('# backend (writes throwaway rows to the DB in .env — which is PRODUCTION)')
    a('SKOVO_BACKEND> ./venv/Scripts/python.exe -m pytest tests/ -q')
    a('')
    a('# UI (needs the backend on :5000 and Vite on :3000)')
    a('automation> ../SKOVO_BACKEND/venv/Scripts/python.exe seed_test_accounts.py')
    a('automation> ../SKOVO_BACKEND/venv/Scripts/python.exe seed_ui_fixtures.py')
    a('# the UI-05 performance cases measure the BUILD, not the dev server')
    a('Skovo>      npx vite build && npx vite preview --port 4173 &')
    a('')
    a('automation> npx playwright test           # do NOT pass --reporter=list:')
    a('                                          # it REPLACES the configured reporters')
    a('                                          # and no case data is written at all')
    a('automation> ../SKOVO_BACKEND/venv/Scripts/python.exe report_to_workbook.py')
    a('automation> ../SKOVO_BACKEND/venv/Scripts/python.exe cleanup_ui_fixtures.py')
    a('```')
    a('')
    a('The last line matters: the fixtures include a super-admin whose password is '
      'hardcoded in `seed_test_accounts.py`, and `.env` points at production. '
      '`cleanup_ui_fixtures.py` removes everything and then counts the identity tables '
      'against their known baseline, because a teardown reporting success proves '
      'nothing about what it left behind.')
    a('')

    args.out.write_text('\n'.join(L), encoding='utf-8')
    print(f'{passed}/{total} pass · {grand["Fail"]} fail · {grand["Skipped"]} skipped '
          f'· {grand["Not run"]} not covered')
    print(f'Wrote {args.out}')


if __name__ == '__main__':
    main()
