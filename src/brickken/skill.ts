import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KeeperError } from '../shared/errors.js';
import { appendRecord, readRecords } from '../shared/jsonl.js';
import { CLI_PACKAGE, npx } from './cli.js';
import { EVIDENCE_FILE, recorded } from './log.js';

export const SKILL_INSTALLS = fileURLToPath(
  new URL('../../evidence/skill-installs.jsonl', import.meta.url),
);

/** Git-ignored: their licence is unstated, so the artifact is installed and never redistributed. */
export const SKILLS_DIRECTORY = fileURLToPath(new URL('../../vendor', import.meta.url));

const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));

export const SKILL_NAME = 'brickken';
const MANIFEST = 'SKILL.md';
const INSTALL = 'skill install';
const DECLARED = /^(name|description):\s*(.+?)\s*$/;

export interface SkillFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface SkillArtifact {
  artifact: string;
  declares: Record<string, string>;
  files: SkillFile[];
}

export interface SkillRecord extends SkillArtifact {
  at: string;
  command: string;
}

function declaredIn(manifest: string): Record<string, string> {
  const lines = manifest.split(/\r?\n/);
  const closes = lines.indexOf('---', 1);
  if (lines[0]?.trim() !== '---' || closes < 0) return {};
  const found: Record<string, string> = {};
  for (const line of lines.slice(1, closes)) {
    const [, field, value] = DECLARED.exec(line) ?? [];
    if (field !== undefined && value !== undefined) found[field] = value;
  }
  return found;
}

const namesUnder = (directory: string, prefix = ''): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const child = join(directory, entry);
    return statSync(child).isDirectory()
      ? namesUnder(child, `${prefix}${entry}/`)
      : [`${prefix}${entry}`];
  });

/** The hash is what makes the entry checkable, so it is taken from the bytes on disk every time. */
export function describeSkill(root = SKILLS_DIRECTORY): SkillArtifact {
  const directory = join(root, SKILL_NAME);
  if (!existsSync(join(directory, MANIFEST)))
    throw new KeeperError('skillUnverified', `${MANIFEST} is not in ${directory}`);
  const files = namesUnder(directory)
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(directory, name));
      return {
        name,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    });
  return {
    artifact: SKILL_NAME,
    declares: declaredIn(readFileSync(join(directory, MANIFEST), 'utf8')),
    files,
  };
}

export const installArguments = (root: string): string[] => [
  'skill',
  'install',
  '--path',
  root.replaceAll(sep, '/'),
  '--force',
];

/** Recorded relative to the repository, so the entry is not a path off one machine. */
const here = (root: string): string => `./${relative(REPOSITORY, root)}`;

export interface SkillRun {
  file?: string;
  installs?: string;
  root?: string;
  run?: (args: string[]) => Promise<string>;
}

/** Reading the artifact sits inside the record, so an install that left nothing is a failure. */
export async function installSkill({
  file = EVIDENCE_FILE,
  installs = SKILL_INSTALLS,
  root = SKILLS_DIRECTORY,
  run = npx,
}: SkillRun = {}): Promise<SkillRecord> {
  const args = installArguments(root);
  const found = await recorded(
    file,
    { surface: 'skill', method: INSTALL, path: CLI_PACKAGE },
    async (): Promise<SkillArtifact> => {
      await run(args);
      return describeSkill(root);
    },
  );
  const record: SkillRecord = {
    at: new Date().toISOString(),
    artifact: found.artifact,
    command: `npx -y ${CLI_PACKAGE} ${installArguments(here(root)).join(' ')}`,
    declares: found.declares,
    files: found.files,
  };
  appendRecord(installs, record);
  return record;
}

const asArtifact = ({ artifact, declares, files }: SkillArtifact): string =>
  JSON.stringify({ artifact, declares, files });

export interface SkillCheck {
  installs?: string;
  root?: string;
}

export function confirmSkill({
  installs = SKILL_INSTALLS,
  root = SKILLS_DIRECTORY,
}: SkillCheck = {}): SkillRecord {
  const last = readRecords<SkillRecord>(installs).at(-1);
  if (last === undefined)
    throw new KeeperError('skillUnverified', `${installs} records no install`);
  if (asArtifact(describeSkill(root)) !== asArtifact(last))
    throw new KeeperError('skillUnverified', `${root} holds something else than was recorded`);
  return last;
}
