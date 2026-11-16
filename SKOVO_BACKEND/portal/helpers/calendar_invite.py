"""
Build .ics calendar invites so booked sessions land in the student's calendar
(Google/Apple/Outlook). Pure-Python, no dependencies.

Usage:
    ics = build_ics(uid, "1-on-1 with Priya", start_dt, end_dt,
                    description="Career mentoring session", url=join_link,
                    organizer_email="noreply@skovo.in", attendee_email=student.email)
    send_email(student.email, subject, html, attachments=[ics_attachment(ics)])
"""
import datetime as _dt


def _fmt(dt):
    # All times treated as UTC (the app stores naive-UTC) -> emit with Z suffix.
    return dt.strftime('%Y%m%dT%H%M%SZ')


def _esc(text):
    return (str(text or '')
            .replace('\\', '\\\\').replace(';', '\\;')
            .replace(',', '\\,').replace('\n', '\\n'))


def build_ics(uid, summary, start_dt, end_dt, description='', url='',
              organizer_email='noreply@skovo.in', attendee_email='', method='REQUEST'):
    """Return an RFC-5545 VCALENDAR string for a single event."""
    now = _dt.datetime.utcnow()
    desc = description
    if url:
        desc = (desc + '\\n\\n' if desc else '') + f'Join: {url}'
    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SKOVO//Sessions//EN',
        'CALSCALE:GREGORIAN',
        f'METHOD:{method}',
        'BEGIN:VEVENT',
        f'UID:{uid}@skovo.in',
        f'DTSTAMP:{_fmt(now)}',
        f'DTSTART:{_fmt(start_dt)}',
        f'DTEND:{_fmt(end_dt)}',
        f'SUMMARY:{_esc(summary)}',
        f'DESCRIPTION:{_esc(desc)}',
    ]
    if url:
        lines.append(f'URL:{_esc(url)}')
        lines.append(f'LOCATION:{_esc(url)}')
    lines.append(f'ORGANIZER:mailto:{organizer_email}')
    if attendee_email:
        lines.append(f'ATTENDEE;RSVP=TRUE:mailto:{attendee_email}')
    lines += [
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
    ]
    return '\r\n'.join(lines)


def ics_attachment(ics_str, filename='invite.ics'):
    """Shape an .ics string into the attachment dict send_email() expects."""
    return {'filename': filename, 'content': ics_str, 'mimetype': 'text/calendar'}
