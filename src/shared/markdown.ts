const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

export const table = (
  headings: readonly string[],
  rows: readonly (readonly string[])[],
): string[] => [row(headings), row(headings.map(() => '---')), ...rows.map(row)];
