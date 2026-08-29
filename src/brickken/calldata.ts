/** Whether Brickken read a whole-token figure as whole tokens or took the digits literally. */
export type AmountWord = 'scaled' | 'unscaled' | 'absent';

export interface Figures {
  whole: bigint;
  scaled: bigint;
}

const word = (value: bigint): string => value.toString(16).padStart(64, '0');

export function amountWord(
  transactions: readonly { data: string }[],
  figures: Figures,
): AmountWord {
  const calldata = transactions
    .map((transaction) => transaction.data)
    .join('')
    .toLowerCase();
  if (calldata.includes(word(figures.scaled))) return 'scaled';
  if (calldata.includes(word(figures.whole))) return 'unscaled';
  return 'absent';
}

const SELECTOR_LENGTH = 10;

export const selectorOf = (data: string): string =>
  data.length < SELECTOR_LENGTH ? data : data.slice(0, SELECTOR_LENGTH);
