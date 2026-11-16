"""Auto-checked quizzes (feature-updates.md §5).

One grader for cohort quizzes and mock tests. Question types:
    mcq         correct_answer = option key ("B"), or the option text
    true_false  correct_answer = "true" / "false"
    numeric     correct_answer = number, tolerance = allowed difference
    fill_blank  accepted_json = ["newton", "Newton", "న్యూటన్"]  (case / space / NFC-insensitive)

Points never come from here: the caller awards admin score rules
(quiz_submitted / quiz_passed / quiz_perfect), all 0 and inactive by default.
"""
import datetime
import json
import random
import unicodedata

TYPES = ('mcq', 'true_false', 'numeric', 'fill_blank')
TRUE_WORDS = {'true', 't', 'yes', 'y', '1', 'సరైనది', 'అవును'}
FALSE_WORDS = {'false', 'f', 'no', 'n', '0', 'తప్పు', 'కాదు'}


def _norm(s):
    """Case-, space- and Unicode-form-insensitive text (Telugu-safe)."""
    s = unicodedata.normalize('NFC', str(s or ''))
    return ' '.join(s.casefold().split())


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return list(v)
    try:
        x = json.loads(v)
        return x if isinstance(x, list) else [x]
    except (TypeError, ValueError):
        return [v]


def options_of(q):
    """Options as [{'key': 'A', 'value': '...'}]."""
    out = []
    for i, o in enumerate(_as_list(q.get('options_json'))):
        if isinstance(o, dict):
            out.append({'key': str(o.get('key') or chr(65 + i)), 'value': str(o.get('value') or '')})
        else:
            out.append({'key': chr(65 + i), 'value': str(o)})
    return out


def is_correct(q, given):
    if given is None or str(given).strip() == '':
        return None                                   # unanswered
    t = q.get('question_type') or 'mcq'
    correct = q.get('correct_answer')
    if t == 'numeric':
        try:
            return abs(float(str(given).replace(',', '')) - float(correct)) <= float(q.get('tolerance') or 0)
        except (TypeError, ValueError):
            return False
    if t == 'fill_blank':
        accepted = {_norm(a) for a in _as_list(q.get('accepted_json'))}
        if correct:
            accepted.add(_norm(correct))
        return _norm(given) in accepted
    if t == 'true_false':
        g = _norm(given)
        want_true = _norm(correct) in TRUE_WORDS
        return (g in TRUE_WORDS) if want_true else (g in FALSE_WORDS)
    # mcq: match the key, or the option text when correct_answer stored the text
    g = _norm(given)
    if g == _norm(correct):
        return True
    for o in options_of(q):
        if _norm(o['key']) == g and _norm(o['value']) == _norm(correct):
            return True
    return False


def grade(questions, answers, negative_marks=0):
    """-> (score, total, per_question). Wrong answers cost `negative_marks`
    each; the score never goes below 0."""
    answers = answers or {}
    score, total, detail = 0.0, 0.0, []
    for q in questions:
        marks = float(q.get('marks') or 1)
        total += marks
        given = answers.get(str(q['id']))
        ok = is_correct(q, given)
        if ok:
            score += marks
        elif ok is False and negative_marks:
            score -= float(negative_marks)
        detail.append({'id': q['id'], 'given': given, 'correct': ok})
    return max(0.0, round(score, 2)), round(total, 2), detail


def build_attempt(questions, shuffle=True, pool_size=None, rng=None):
    """Pick and order the questions for one attempt. Returns (question_ids,
    option_order {qid: [keys]}). Option order is fixed per attempt so a reload
    shows the same paper."""
    rng = rng or random.Random()
    qs = list(questions)
    if pool_size and 0 < pool_size < len(qs):
        qs = rng.sample(qs, pool_size)
    if shuffle:
        rng.shuffle(qs)
    order = {}
    for q in qs:
        if (q.get('question_type') or 'mcq') == 'mcq':
            keys = [o['key'] for o in options_of(q)]
            if shuffle:
                rng.shuffle(keys)
            order[str(q['id'])] = keys
    return [str(q['id']) for q in qs], order


def student_view(q, option_order=None):
    """A question as the student sees it: never the answer."""
    opts = options_of(q)
    keys = (option_order or {}).get(str(q['id']))
    if keys:
        by_key = {o['key']: o for o in opts}
        opts = [by_key[k] for k in keys if k in by_key]
    return {
        'id': q['id'], 'type': q.get('question_type') or 'mcq', 'text': q.get('text'),
        'options': opts if (q.get('question_type') or 'mcq') == 'mcq' else
                   ([{'key': 'true', 'value': 'True'}, {'key': 'false', 'value': 'False'}]
                    if q.get('question_type') == 'true_false' else []),
        'marks': float(q.get('marks') or 1), 'lang': q.get('lang') or 'en',
    }


def review_view(q, given, ok):
    v = student_view(q)
    v.update({'your_answer': given, 'correct': ok, 'correct_answer': q.get('correct_answer'),
              'accepted': _as_list(q.get('accepted_json')), 'explanation': q.get('explanation')})
    return v


def can_review(task, now=None):
    mode = task.get('review_after') or 'deadline'
    if mode == 'never':
        return False
    if mode == 'submit':
        return True
    due = task.get('due_date')
    return bool(due is None or (now or datetime.datetime.utcnow()) >= due)


def identical_pattern(mine, others, min_wrong=3, ratio=0.8):
    """User ids whose WRONG answers match mine on >= ratio of my wrong answers.
    Matching right answers prove nothing; matching wrong ones are the signal."""
    wrong = {k: v for k, v in (mine or {}).items() if v is not None}
    if len(wrong) < min_wrong:
        return []
    hits = []
    for uid, theirs in others:
        theirs = theirs if isinstance(theirs, dict) else json.loads(theirs or '{}')
        same = sum(1 for k, v in wrong.items() if theirs.get(k) == v)
        if same / len(wrong) >= ratio:
            hits.append(uid)
    return hits


def validate_question(d):
    """Achiever input -> (clean dict, error)."""
    t = (d.get('question_type') or d.get('type') or 'mcq').strip()
    if t not in TYPES:
        return None, f"Question type must be one of: {', '.join(TYPES)}."
    text_ = (d.get('text') or '').strip()
    if not text_ or len(text_) > 5000:
        return None, 'Write the question (up to 5000 characters).'
    try:
        marks = float(d.get('marks') if d.get('marks') not in (None, '') else 1)
    except (TypeError, ValueError):
        return None, 'Marks must be a number.'
    if not (0 < marks <= 100):
        return None, 'Marks must be more than 0 and at most 100.'
    options, correct, accepted, tol = None, d.get('correct_answer'), None, 0
    if t == 'mcq':
        raw = d.get('options') or []
        options = []
        for o in raw:
            val = str((o.get('value') if isinstance(o, dict) else o) or '').strip()
            if val:
                options.append({'key': chr(65 + len(options)), 'value': val[:500]})
        if not (2 <= len(options) <= 6):
            return None, 'An MCQ needs 2 to 6 options.'
        keys = {o['key'] for o in options}
        if str(correct or '').strip().upper() not in keys:
            return None, 'Tick the correct option.'
        correct = str(correct).strip().upper()
    elif t == 'true_false':
        if _norm(correct) not in TRUE_WORDS | FALSE_WORDS:
            return None, 'Choose True or False as the answer.'
        correct = 'true' if _norm(correct) in TRUE_WORDS else 'false'
    elif t == 'numeric':
        try:
            float(str(correct).replace(',', ''))
        except (TypeError, ValueError):
            return None, 'Enter the correct number.'
        try:
            tol = abs(float(d.get('tolerance') or 0))
        except (TypeError, ValueError):
            return None, 'Tolerance must be a number.'
    elif t == 'fill_blank':
        accepted = [str(a).strip()[:200] for a in (d.get('accepted') or []) if str(a).strip()]
        if correct and str(correct).strip():
            accepted = [str(correct).strip()] + [a for a in accepted if a != str(correct).strip()]
        if not accepted:
            return None, 'Enter at least one accepted answer.'
        correct = accepted[0]
    lang = (d.get('lang') or 'en').strip()[:5]
    return {
        'question_type': t, 'text': text_, 'options_json': json.dumps(options, ensure_ascii=False) if options else None,
        'correct_answer': str(correct)[:500] if correct is not None else None,
        'accepted_json': json.dumps(accepted, ensure_ascii=False) if accepted else None,
        'tolerance': tol, 'marks': marks, 'explanation': (d.get('explanation') or '').strip()[:5000] or None,
        'lang': lang if lang in ('en', 'te', 'hi') else 'en', 'topic': (d.get('topic') or '').strip()[:120] or None,
    }, None


def question_args(c):
    return (c['question_type'], c['text'], c['options_json'], c['correct_answer'], c['accepted_json'],
            c['tolerance'], c['marks'], c['explanation'], c['lang'], c['topic'])


def achiever_question(q):
    """Full question for the achiever who owns it (includes the answer)."""
    return {'id': q['id'], 'position': q.get('position'), 'question_type': q.get('question_type'),
            'text': q.get('text'), 'options': options_of(q), 'correct_answer': q.get('correct_answer'),
            'accepted': _as_list(q.get('accepted_json')), 'tolerance': float(q.get('tolerance') or 0),
            'marks': float(q.get('marks') or 1), 'explanation': q.get('explanation'),
            'lang': q.get('lang'), 'topic': q.get('topic')}
