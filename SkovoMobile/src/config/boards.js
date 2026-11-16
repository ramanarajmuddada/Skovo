/**
 * Class 10 sees SSC boards, Class 11 / 12 see Inter boards; national boards
 * (CBSE, ICSE …) cover both. `level` comes from /auth/boards. Same rule as the
 * web's config/educationPathways.js boardsForStage — keep them in step.
 */
export function boardsForStage(boards, category) {
  const want = category === 'school_10th' ? 'school'
    : (category === 'school_11th' || category === 'school_12th' || category === 'dropper') ? 'intermediate'
      : null;
  if (!want) return boards;
  return boards.filter((b) => !b.level || b.level === 'all' || b.level === want);
}
