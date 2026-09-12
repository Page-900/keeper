const NOT_A_SEND = /\b(not|don't|do not|never|stop|cancel|hold|wait|without|unless)\b/i;

const A_QUESTION = /\?\s*$/;

const FILLER =
  /^(?:(?:yes|yeah|yep|ok|okay|sure|right|fine|now|then|and|so|also|please|kindly|just|go on and|go and)[,:!]?\s+)+/i;

const VERB = [
  'execute[sd]?',
  'executing',
  'sends?',
  'sending',
  'delivers?',
  'delivered',
  'delivering',
  'proceed(?:ing)?',
  'settle[sd]?',
  'settling',
  'sell',
  'transfers?|transferring',
  'confirm(?:s|ed|ing)?',
  'approve[sd]?',
].join('|');

const AN_INSTRUCTION = new RegExp(
  `^(?:(?:${VERB})\\b|do it|go ahead|go for it|ship it|move it|make (?:the|that|this) (?:transfer|sale|delivery|trade)|put it (?:on|through)\\b)`,
  'i',
);

const AGREEMENT = /^(?:yes|yeah|yep|ok|okay|sure|agreed|confirmed|approved|go)[.!]?$/i;

const clauses = (text: string): string[] =>
  text
    .split(/[\n.;!]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');

const instructing = (clause: string): boolean => {
  const words = clause.replace(FILLER, '').trim();
  return AN_INSTRUCTION.test(words) || AGREEMENT.test(words);
};

/** An instruction opens with its verb, so a document saying we may proceed is not one. */
export function asksToSend(text: string): boolean {
  return clauses(text).some(
    (clause) => !A_QUESTION.test(clause) && !NOT_A_SEND.test(clause) && instructing(clause),
  );
}
