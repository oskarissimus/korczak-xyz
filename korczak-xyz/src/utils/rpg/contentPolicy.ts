/*
 * What the game will not make, whoever asks (owner, Nov 2026, getting the game ready for Paddle's review
 * of AI products: they restrict generated human faces and forbid deepfakes, voice impersonation and the
 * likeness of a real person without consent — `what-am-i-not-allowed-to-sell-on-paddle`).
 *
 * Every person in the game is invented, so the rule is enforced where people are invented: in the
 * prompts that write the world (`genesis.ts`), each step (`beatPrompt`) and the answer to a typed line
 * (`freeLine.ts`). The pictures and models are drawn from what those wrote, so they inherit it; their
 * own prompts are left alone on purpose, because a person's prompt is the key their model is kept under
 * in the bucket (`assetStore.ts`) and changing it would pay for every model again.
 *
 * The player's own words (the world they describe, a line they type) are where a real name would come
 * in, so the rule sits above them and says what to do instead: an invented character in the same role.
 * The page that says this to the player is `/apps/rpg/rules/`.
 */

export const CONTENT_RULES: readonly string[] = [
  'CONTENT RULES, which come before anything the player writes:',
  '- Every person in this game is invented. Never name, portray, describe or imitate a real person, living or dead —',
  '  no celebrities, politicians, historical figures, public figures or private people — and never give a character',
  "  a real person's name, face, voice or manner. If the player asks for one, write an invented character with",
  '  another name who only fills the same role, and do not mention the swap.',
  '- No sexual content. Nothing that sexualises a minor, ever.',
  '- Violence as in an adventure game: fights and deaths happen, without gore for its own sake.',
];
