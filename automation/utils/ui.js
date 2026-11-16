// Shared UI drivers for the app's own components.
//
// The app has ONE dropdown — `components/ui/FormSelect.jsx` — and it is not a
// native `<select>`. It renders a `<button aria-haspopup="listbox">` plus a
// `role="listbox"` popup of `role="option"` buttons, with a search box once the
// list is long enough.
//
// Tests written before that migration used `page.locator('select')`, which now
// matches nothing: one of them timed out and two more silently skipped
// (`test.skip(!(await select.count()))`) — passing while testing nothing.
// Drive dropdowns through these helpers instead of guessing at the markup.

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Any control this helper knows how to drive. */
const CONTROL = 'select, button[aria-haspopup="listbox"]';

/**
 * Resolve a field's control from its visible label.
 *
 * Two markup styles are in use and both have to work:
 *   · `<FormSelect label="Category">` renders `<label for={id}>` + the trigger
 *     button, so getByLabel resolves it;
 *   · AdminScoreRules wraps a label-less FormSelect in a plain
 *     `<label>Cap window <FormSelect/></label>`. A wrapping <label> does not
 *     name a <button>, so getByLabel finds nothing — fall back to searching
 *     inside the label element itself.
 */
async function fieldByLabel(page, label, scope) {
  const root = scope || page;
  const re = label instanceof RegExp ? label : new RegExp(`^\\s*${escapeRe(label)}`, 'i');

  const labelled = root.getByLabel(re).first();
  if (await labelled.count()) return labelled;

  return root.locator('label').filter({ hasText: re }).first().locator(CONTROL).first();
}

/**
 * Pick an option from a dropdown by its label, whichever kind it is.
 *
 * Works with FormSelect (the app's custom listbox) and with a native <select>,
 * so a field that changes component type does not silently stop being tested.
 *
 *   await chooseOption(page, 'Category', 'Productivity');
 *   await chooseOption(page, 'Cap window', /weekly/i, { scope: modal });
 */
async function chooseOption(page, label, option, { scope, timeout = 10_000 } = {}) {
  const control = await fieldByLabel(page, label, scope);
  await control.waitFor({ state: 'visible', timeout });

  const tag = await control.evaluate((el) => el.tagName.toLowerCase());

  if (tag === 'select') {
    await control.selectOption(
      option instanceof RegExp ? { label: option } : String(option));
    return;
  }

  // FormSelect: open the listbox, then click the option.
  await control.click();
  const listbox = (scope || page).getByRole('listbox').first();
  await listbox.waitFor({ state: 'visible', timeout });

  const opt = listbox.getByRole('option', {
    name: option instanceof RegExp ? option : new RegExp(escapeRe(option), 'i'),
  }).first();
  await opt.click({ timeout });
}

/** The value a dropdown currently shows — its selected option's label. */
async function selectedOption(page, label, { scope } = {}) {
  const control = await fieldByLabel(page, label, scope);
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    return control.evaluate((el) => el.selectedOptions[0]?.textContent?.trim() ?? '');
  }
  // The trigger button's first span holds the selected label (or the placeholder).
  return (await control.locator('span').first().innerText()).trim();
}

/** How many options a dropdown offers. Leaves the listbox open. */
async function openOptions(page, label, { scope, timeout = 10_000 } = {}) {
  const control = await fieldByLabel(page, label, scope);
  await control.waitFor({ state: 'visible', timeout });
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') return control.locator('option');
  await control.click();
  const listbox = (scope || page).getByRole('listbox').first();
  await listbox.waitFor({ state: 'visible', timeout });
  return listbox.getByRole('option');
}

module.exports = { chooseOption, selectedOption, openOptions, fieldByLabel };
