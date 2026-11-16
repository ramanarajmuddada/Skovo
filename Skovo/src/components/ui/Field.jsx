import React from 'react';

/**
 * The two pieces every form control wraps itself in.
 *
 * They live in their own module rather than in `ui/index.jsx` so that
 * `FormSelect` can use them while `ui/index.jsx` re-exports `FormSelect` —
 * putting them in index would make that a cycle.
 */

/* One place decides what a required field looks like. Input, Textarea,
   FormSelect, DatePicker and the chip pickers all render this, so the red
   asterisk can never drift between them. */
export function FieldLabel({ htmlFor, children, required, className = '' }) {
  if (!children) return null;
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-semibold text-slate-700 mb-1.5 ${className}`}>
      {children}
      {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
    </label>
  );
}

/* The line under a control. Error wins over hint — showing both stacks two
   messages and buries the one the user has to act on.

   `id` is not decoration: the control points at this element with
   aria-describedby, which is the only thing that makes an error *belong* to a
   field rather than float somewhere near it. A sighted user infers the pairing
   from position; a screen-reader user gets it from this attribute or not at
   all. `role="alert"` makes a newly-rendered error announce itself — without it
   the message appears silently and the person is left on a form that simply
   will not submit. */
export function FieldNote({ error, hint, id }) {
  if (error) {
    // No ✕ glyph in front of the text. It added nothing the red already says,
    // and as a bare character it rendered at whatever weight and baseline the
    // font gave it rather than matching the message -- which is why it read as
    // a stray mark next to the sentence instead of part of it. The colour, the
    // red field border and role="alert" all still mark this as an error.
    return (
      <p id={id} role="alert" className="mt-1 text-xs text-red-600">
        {error}
      </p>
    );
  }
  if (hint) return <p id={id} className="mt-1 text-xs text-slate-400">{hint}</p>;
  return null;
}
