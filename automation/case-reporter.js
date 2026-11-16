// Playwright reporter that maps test results back to SKOVO_v1_Test_Cases.xlsx.
//
// WHY
//   The workbook holds 1047 manual cases and nothing connected them to the 608
//   automated tests, so "which cases actually pass" could only be answered by a
//   person re-reading both. A test claims a case by naming its Test ID anywhere
//   in the title:
//
//       test('X04-003 over-long full name is a 400, not a 500', ...)
//       test('ST04-012 ST04-013 joined badge comes from one batched call', ...)
//
//   One test may claim several ids (the second form) and several tests may claim
//   the same id — a case is only Pass when EVERY test claiming it passed. That
//   rule matters: UI02 cases are usually one id per viewport, and a case that
//   passes at 1440 and fails at 390 is a fail, not a coin toss over which test
//   the reporter happened to record last.
//
// OUTPUT
//   automation/results/playwright-cases.json — merged into the workbook by
//   report_to_workbook.py, which also reads the pytest equivalent.
//
// Untagged tests are NOT an error. Most of the existing suite predates the
// workbook; they still run and still report, they just claim no case. The
// summary prints how many ran untagged so the gap stays visible.
const fs = require('fs');
const path = require('path');

const CASE_RE = /\b([A-Z]{1,2}\d{2}-\d{3})\b/g;

// Worst wins: a case claimed by several tests is only as good as its weakest
// result. Ordered least-to-most severe.
const RANK = { passed: 0, skipped: 1, timedOut: 2, interrupted: 3, failed: 4 };

class CaseReporter {
  constructor(options = {}) {
    this.outFile = options.outputFile
      || path.join(__dirname, 'results', 'playwright-cases.json');
    this.cases = new Map();
    this.untagged = 0;
    this.totalTests = 0;
  }

  onTestEnd(test, result) {
    this.totalTests++;
    const ids = [...new Set(test.title.match(CASE_RE) || [])];
    if (!ids.length) { this.untagged++; return; }

    for (const id of ids) {
      const prev = this.cases.get(id);
      const next = {
        id,
        status: result.status,
        title: test.title,
        file: path.relative(__dirname, test.location.file).replace(/\\/g, '/'),
        line: test.location.line,
        durationMs: result.duration,
        // First line only. The workbook's "Actual result" is a cell someone
        // reads, not a stack trace; the HTML report keeps the full failure.
        error: result.error
          ? String(result.error.message || result.error).split('\n')[0].slice(0, 300)
          : null,
        claimedBy: (prev ? prev.claimedBy : 0) + 1,
      };
      if (!prev || RANK[result.status] > RANK[prev.status]) {
        this.cases.set(id, next);
      } else {
        prev.claimedBy = next.claimedBy;
      }
    }
  }

  async onEnd(result) {
    fs.mkdirSync(path.dirname(this.outFile), { recursive: true });
    const cases = [...this.cases.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(this.outFile, JSON.stringify({
      runner: 'playwright',
      finishedAt: new Date().toISOString(),
      runStatus: result.status,
      totalTests: this.totalTests,
      untaggedTests: this.untagged,
      cases,
    }, null, 2));

    const by = (s) => cases.filter((c) => c.status === s).length;
    console.log(
      `\n[case-reporter] ${cases.length} workbook cases claimed `
      + `(${by('passed')} pass, ${by('failed') + by('timedOut')} fail, ${by('skipped')} skipped) `
      + `· ${this.untagged}/${this.totalTests} tests ran untagged`
      + `\n[case-reporter] wrote ${path.relative(process.cwd(), this.outFile)}`);
  }
}

module.exports = CaseReporter;
