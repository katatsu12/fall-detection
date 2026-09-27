/**
 * Home's date line, e.g. "Sat, Sep 26" — pure JavaScript, tested in Node.
 *
 * It takes the watch's own numbering from @zos/sensor Time, which is not
 * JavaScript's Date: getDay() is 1–7 starting on Monday, getMonth() is 1–12.
 * The names and the word order come from page/i18n, so another language only
 * needs its own .po file.
 */

/**
 * @param {string} template e.g. "{weekday}, {month} {day}"
 * @param {string[]} weekdays seven names, Monday first
 * @param {string[]} months twelve names, January first
 * @param {{ weekday: number, day: number, month: number }} t Time.getDay(), getDate(), getMonth()
 */
export function formatDate(template, weekdays, months, { weekday, day, month }) {
  return template
    .replace('{weekday}', weekdays[weekday - 1] || '')
    .replace('{month}', months[month - 1] || '')
    .replace('{day}', String(day))
}
