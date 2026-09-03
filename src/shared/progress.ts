export const STAGES = ['reading', 'model', 'intent', 'guard', 'layers', 'recorded'] as const;

export type StageName = (typeof STAGES)[number];

export interface Stage {
  stage: StageName;
  ms: number;
}

export interface Progress {
  reached: (stage: StageName) => void;
}

/** Each step is timed as it lands, so a page showing the wait is never estimating it. */
export function trackProgress(report: (stage: Stage) => void, now = Date.now): Progress {
  let since = now();
  return {
    reached: (stage) => {
      const at = now();
      report({ stage, ms: at - since });
      since = at;
    },
  };
}
