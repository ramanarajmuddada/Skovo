-- Seed data for new master dropdown types
-- Run this once after deploying the new fields

-- Task Type
INSERT IGNORE INTO masters (id, type, value, label, sort_order, is_active) VALUES
  (UUID(), 'task_type', 'assignment',   'Assignment',    1, 1),
  (UUID(), 'task_type', 'quiz',         'Quiz',          2, 1),
  (UUID(), 'task_type', 'project',      'Project',       3, 1),
  (UUID(), 'task_type', 'presentation', 'Presentation',  4, 1),
  (UUID(), 'task_type', 'live_session', 'Live Session',  5, 1),
  (UUID(), 'task_type', 'case_study',   'Case Study',    6, 1);

-- Task Submission Type
INSERT IGNORE INTO masters (id, type, value, label, sort_order, is_active) VALUES
  (UUID(), 'task_submission_type', 'url_link',    'URL / Link',    1, 1),
  (UUID(), 'task_submission_type', 'file_upload', 'File Upload',   2, 1),
  (UUID(), 'task_submission_type', 'text_only',   'Text Response', 3, 1),
  (UUID(), 'task_submission_type', 'github_repo', 'GitHub Repo',   4, 1),
  (UUID(), 'task_submission_type', 'video_link',  'Video Link',    5, 1);

-- Experience Level (for Opportunities)
INSERT IGNORE INTO masters (id, type, value, label, sort_order, is_active) VALUES
  (UUID(), 'experience_level', 'fresher',   'Fresher (0 yrs)',   1, 1),
  (UUID(), 'experience_level', 'junior',    'Junior (1–2 yrs)',  2, 1),
  (UUID(), 'experience_level', 'mid_level', 'Mid Level (3–5 yrs)',3, 1),
  (UUID(), 'experience_level', 'senior',    'Senior (5+ yrs)',   4, 1),
  (UUID(), 'experience_level', 'any',       'Any Level',         5, 1);

-- Exam Mode (for Entrance Exams)
INSERT IGNORE INTO masters (id, type, value, label, sort_order, is_active) VALUES
  (UUID(), 'exam_mode', 'online',  'Online (CBT)',      1, 1),
  (UUID(), 'exam_mode', 'offline', 'Offline (Pen-Paper)',2, 1),
  (UUID(), 'exam_mode', 'hybrid',  'Hybrid',            3, 1);

-- Scholarship Mode
INSERT IGNORE INTO masters (id, type, value, label, sort_order, is_active) VALUES
  (UUID(), 'scholarship_mode', 'merit',            'Merit Based',           1, 1),
  (UUID(), 'scholarship_mode', 'need_based',       'Need Based',            2, 1),
  (UUID(), 'scholarship_mode', 'merit_cum_need',   'Merit-cum-Need',        3, 1),
  (UUID(), 'scholarship_mode', 'sports',           'Sports Quota',          4, 1),
  (UUID(), 'scholarship_mode', 'disability',       'Disability / PH',       5, 1),
  (UUID(), 'scholarship_mode', 'minority',         'Minority Community',    6, 1);
