"""
Merge automated results into SKOVO_v1_Test_Cases.xlsx.

Reads whatever the two runners left in automation/results/ and writes a COPY of
the workbook with Status and "Actual result" filled in for every case an
automated test claimed. The source workbook is never modified — manual testers
own it, and an automated run must not silently overwrite a status a person set
by hand.

    ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe report_to_workbook.py

Inputs   automation/results/playwright-cases.json   (case-reporter.js)
         automation/results/pytest-cases.json       (tests/conftest.py hooks)
Output   SKOVO_v1_Test_Cases_Results.xlsx           (--out to change)

A case with no automated test keeps whatever Status it already had, so a
manually-verified Pass survives every subsequent run. Only claimed cases are
touched, and each one records which test claimed it — a Pass you cannot trace
back to a test is worse than a "Not run", because it looks like evidence.
"""
import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = Path(__file__).resolve().parent / 'results'
SOURCE = ROOT / 'SKOVO_v1_Test_Cases.xlsx'
DEFAULT_OUT = ROOT / 'SKOVO_v1_Test_Cases_Results.xlsx'

# Both runners' vocabularies collapse onto the three words the workbook uses.
STATUS = {
    'passed': 'Pass',
    'failed': 'Fail',
    'timedOut': 'Fail',
    'interrupted': 'Fail',
    'error': 'Fail',
    'skipped': 'Skipped',
}
# Worst wins across runners too, not just within one — the same case may be
# claimed by a pytest test and a Playwright test.
RANK = {'Pass': 0, 'Skipped': 1, 'Fail': 2}


def load_results():
    merged, sources = {}, []
    for name in ('playwright-cases.json', 'pytest-cases.json'):
        path = RESULTS_DIR / name
        if not path.exists():
            print(f'  ! {name} not found — skipping')
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        sources.append(f"{data.get('runner', name)} "
                       f"({len(data.get('cases', []))} cases, "
                       f"{data.get('untagged_tests', data.get('untaggedTests', 0))} untagged)")
        for case in data.get('cases', []):
            status = STATUS.get(case['status'], 'Fail')
            prev = merged.get(case['id'])
            if prev and RANK[prev['status']] >= RANK[status]:
                continue
            merged[case['id']] = {
                'status': status,
                'runner': data.get('runner', name),
                'title': case.get('title', ''),
                'file': case.get('file', ''),
                'error': case.get('error'),
            }
    return merged, sources


# Playwright colours its failure messages, so the JSON carries raw ANSI escape
# sequences. openpyxl refuses any control character outright (IllegalCharacterError)
# and takes the whole merge down with it — one coloured assertion aborts the run
# and the workbook is never written.
_ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def clean(text):
    """Strip ANSI colour and control characters so a cell can hold the message."""
    return _CONTROL.sub('', _ANSI.sub('', str(text or ''))).strip()


def actual_text(r):
    where = f"{r['runner']}: {clean(r['file'])}"
    if r['status'] == 'Pass':
        return f"Automated pass — {where}"
    if r['status'] == 'Skipped':
        return f"Skipped — {where}"
    return f"FAILED — {where}\n{clean(r['error']) or 'no message captured'}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--source', type=Path, default=SOURCE)
    args = ap.parse_args()

    print(f'Reading results from {RESULTS_DIR}')
    results, sources = load_results()
    if not results:
        raise SystemExit('No results found. Run the suites first.')
    for s in sources:
        print(f'  + {s}')

    wb = openpyxl.load_workbook(args.source)
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    per_sheet, seen = {}, set()

    for ws in wb.worksheets:
        if ws.title == 'README':
            continue
        header = [str(c.value or '') for c in ws[1]]
        try:
            c_id = header.index('Test ID') + 1
            c_status = header.index('Status') + 1
            c_actual = header.index('Actual result') + 1
        except ValueError:
            continue

        tally = Counter()
        for row in range(2, ws.max_row + 1):
            case_id = str(ws.cell(row, c_id).value or '').strip()
            if not case_id:
                continue
            tally['total'] += 1
            hit = results.get(case_id)
            if not hit:
                tally['unclaimed'] += 1
                continue
            seen.add(case_id)
            ws.cell(row, c_status).value = hit['status']
            ws.cell(row, c_actual).value = f"[{stamp}] {actual_text(hit)}"
            tally[hit['status']] += 1
        per_sheet[ws.title] = tally

    wb.save(args.out)

    print(f'\n{"sheet":34} {"total":>6} {"pass":>6} {"fail":>6} {"skip":>6} {"none":>6}')
    grand = Counter()
    for name, t in per_sheet.items():
        grand.update(t)
        print(f'{name:34} {t["total"]:>6} {t["Pass"]:>6} {t["Fail"]:>6} '
              f'{t["Skipped"]:>6} {t["unclaimed"]:>6}')
    print(f'{"TOTAL":34} {grand["total"]:>6} {grand["Pass"]:>6} {grand["Fail"]:>6} '
          f'{grand["Skipped"]:>6} {grand["unclaimed"]:>6}')

    covered = grand['total'] - grand['unclaimed']
    pct = (covered / grand['total'] * 100) if grand['total'] else 0
    print(f'\nAutomated coverage: {covered}/{grand["total"]} cases ({pct:.1f}%)')

    orphans = sorted(set(results) - seen)
    if orphans:
        print(f'\n! {len(orphans)} claimed ids are not in the workbook '
              f'(typo in a test title?): {", ".join(orphans[:10])}')
    print(f'\nWrote {args.out}')


if __name__ == '__main__':
    main()
