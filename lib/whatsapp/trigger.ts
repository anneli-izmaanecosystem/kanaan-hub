/**
 * The public words that opt a guest into (or restart) the booking conversation.
 *
 * "nii" is the printed keyword on the room cards; the greetings are what guests type
 * anyway. Exact matches only, so an ordinary message that merely contains one of these
 * words does not reset a booking that is already under way.
 */
const START_WORDS = new Set(['nii', 'hi', 'hello', 'hey', 'hallo', 'start', 'book', 'book a car', 'car', 'taxi'])

export function isStartKeyword(text: string): boolean {
  return START_WORDS.has(text.trim().toLocaleLowerCase('en').replace(/[!.?]+$/, ''))
}
