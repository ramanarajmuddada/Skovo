"""Auto-checked cohort quizzes (feature-updates.md §5), end to end through the API."""
import pytest
from sqlalchemy import text

from tests.test_cohort_task_flow import (  # noqa: F401  (fixtures)
    client, student_auth, achiever_auth, rows, assign, body, ACHIEVER_TASKS, TASKS,
)

Q = '/api/achievers/portal/tasks'


def _q_url(task_id, suffix=''):
    return f"{ACHIEVER_TASKS.rstrip('/')}/{task_id}/questions{suffix}"


@pytest.fixture
def quiz(client, rows, assign, achiever_auth, db):
    """A live cohort, one enrolled student, a 3-question auto quiz (2 marks each)."""
    ach = rows.achiever()
    cohort = rows.cohort(ach, starts_minutes_ago=10, status='live')
    student = rows.student()
    rows.enroll(student, cohort)
    code, d = assign(ach, cohort, title='Quadratics quiz', task_type='quiz')
    assert code == 201, d
    tid = d['response']['task_id']
    h = achiever_auth(ach)
    qs = [
        {'question_type': 'mcq', 'text': 'Roots of x²−5x+6=0?', 'marks': 2,
         'options': [{'value': '2, 3'}, {'value': '1, 6'}, {'value': '-2, -3'}], 'correct_answer': 'A'},
        {'question_type': 'true_false', 'text': 'EAPCET has negative marking.', 'marks': 2, 'correct_answer': 'false'},
        {'question_type': 'fill_blank', 'text': 'SI unit of force is ___', 'marks': 2,
         'accepted': ['newton', 'న్యూటన్'], 'lang': 'te'},
    ]
    ids = []
    for q in qs:
        r = body(client.post(_q_url(tid), json=q, headers=h))
        assert r['status'] == 201, r
        ids.append(r['response']['question']['id'])
    s = body(client.put(f"{ACHIEVER_TASKS.rstrip('/')}/{tid}/settings",
                        json={'grading_mode': 'auto', 'max_attempts': 1, 'pass_percent': 60,
                              'review_after': 'submit', 'time_limit_minutes': 10}, headers=h))
    assert s['status'] == 200, s
    yield {'task': tid, 'student': student, 'achiever': ach, 'qids': ids, 'cohort': cohort}
    db.session.execute(text("DELETE FROM task_questions WHERE task_id = :t"), {'t': tid})
    db.session.execute(text("DELETE FROM quiz_attempts WHERE task_id = :t"), {'t': tid})
    db.session.execute(text("DELETE FROM score_events WHERE user_id = :u"), {'u': student})
    db.session.execute(text("DELETE FROM readiness_scores WHERE user_id = :u"), {'u': student})
    db.session.commit()


def test_achiever_cannot_set_a_points_field(client, quiz, achiever_auth):
    r = body(client.get(f"{ACHIEVER_TASKS.rstrip('/')}/{quiz['task']}/settings",
                        headers=achiever_auth(quiz['achiever'])))
    assert 'points' not in str(r['response']['settings']).lower()


def test_invalid_mcq_is_refused(client, quiz, achiever_auth):
    r = body(client.post(_q_url(quiz['task']), json={'question_type': 'mcq', 'text': 'x', 'options': [{'value': 'a'}],
                                                    'correct_answer': 'A'}, headers=achiever_auth(quiz['achiever'])))
    assert r['status'] == 400


def test_student_sees_quiz_in_task_list(client, quiz, student_auth):
    tasks = body(client.get(f'{TASKS}/', headers=student_auth(quiz['student'])))['response']['tasks']
    t = next(t for t in tasks if t['id'] == quiz['task'])
    assert t['is_quiz'] and t['quiz']['questions'] == 3


def test_start_hides_answers_and_submit_grades(client, quiz, student_auth):
    h = student_auth(quiz['student'])
    start = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))
    assert start['status'] == 201, start
    p = start['response']
    assert p['seconds_left'] and p['seconds_left'] <= 600
    assert all('correct_answer' not in q and 'accepted' not in q for q in p['questions'])
    a1, a2, a3 = quiz['qids']
    answers = {a1: 'A', a2: 'true', a3: '  NEWTON '}          # 2 right, 1 wrong
    sv = body(client.put(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}", json={'answers': answers}, headers=h))
    assert sv['response']['saved'] is True
    res = body(client.post(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}/submit", json={'answers': answers}, headers=h))
    assert res['status'] == 200, res
    assert (res['response']['score'], res['response']['total']) == (4.0, 6.0)
    assert res['response']['can_review'] is True

    rv = body(client.get(f"{TASKS}/{quiz['task']}/quiz/review", headers=h))['response']
    assert [q['correct'] for q in sorted(rv['questions'], key=lambda q: quiz['qids'].index(q['id']))] == [True, False, True]


def test_telugu_fill_blank_accepted(client, quiz, student_auth):
    h = student_auth(quiz['student'])
    p = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))['response']
    res = body(client.post(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}/submit",
                           json={'answers': {quiz['qids'][2]: 'న్యూటన్'}}, headers=h))['response']
    assert res['score'] == 2.0


def test_attempt_limit(client, quiz, student_auth):
    h = student_auth(quiz['student'])
    p = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))['response']
    body(client.post(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}/submit", json={'answers': {}}, headers=h))
    again = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))
    assert again['status'] == 409


def test_submission_is_auto_approved_and_pays_nothing_by_default(client, quiz, student_auth, db):
    h = student_auth(quiz['student'])
    p = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))['response']
    body(client.post(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}/submit",
                     json={'answers': {quiz['qids'][0]: 'A'}}, headers=h))
    row = db.session.execute(text(
        "SELECT status, review_state, auto_score FROM task_submissions WHERE task_id = :t AND user_id = :u"),
        {'t': quiz['task'], 'u': quiz['student']}).mappings().first()
    assert row['status'] == 'approved' and row['review_state'] == 'auto_approved'
    paid = db.session.execute(text(
        "SELECT IFNULL(SUM(points), 0) FROM score_events WHERE user_id = :u AND event_type LIKE 'quiz_%'"),
        {'u': quiz['student']}).scalar()
    assert float(paid) == 0                                 # quiz rules are inactive until admin prices them


def test_another_student_cannot_start(client, quiz, student_auth, rows):
    stranger = rows.student()
    r = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=student_auth(stranger)))
    assert r['status'] == 404


def test_results_for_achiever(client, quiz, student_auth, achiever_auth):
    h = student_auth(quiz['student'])
    p = body(client.post(f"{TASKS}/{quiz['task']}/quiz/start", headers=h))['response']
    body(client.post(f"{TASKS}/{quiz['task']}/quiz/{p['attempt_id']}/submit",
                     json={'answers': {quiz['qids'][0]: 'B'}}, headers=h))
    r = body(client.get(f"{ACHIEVER_TASKS.rstrip('/')}/{quiz['task']}/results",
                        headers=achiever_auth(quiz['achiever'])))['response']
    assert r['submitted'] == 1 and r['enrolled'] == 1
    assert r['questions'][0]['correct_percent'] is not None


def test_grader_unit():
    from portal.helpers import quiz as QZ
    qs = [{'id': 'a', 'question_type': 'numeric', 'correct_answer': '5', 'tolerance': 0.01, 'marks': 2},
          {'id': 'b', 'question_type': 'mcq', 'correct_answer': 'C',
           'options_json': '[{"key":"A","value":"x"},{"key":"B","value":"y"},{"key":"C","value":"z"}]', 'marks': 1}]
    assert QZ.grade(qs, {'a': '5.005', 'b': 'C'}, 0)[0] == 3.0
    assert QZ.grade(qs, {'a': '4', 'b': 'A'}, 0.5)[0] == 0.0          # never below 0
    assert QZ.identical_pattern({'1': 'A', '2': 'B', '3': 'C'}, [('u', {'1': 'A', '2': 'B', '3': 'C'})]) == ['u']
    ids, order = QZ.build_attempt([{'id': str(i), 'question_type': 'true_false'} for i in range(10)], True, 4)
    assert len(ids) == 4
