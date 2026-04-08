import type { LocalStore } from '../LocalStore.js';
import type { SkillEntry } from '../../types/skill.js';
import type { SkillService } from './SkillService.js';

export interface SkillSyncResult {
  added: number;
  removed: number;
  updated: number;
  unchanged: number;
  scanned: number;
}

function normalizeFiles(files: string[] = []): string[] {
  return [...files].sort((a, b) => a.localeCompare(b));
}

function areSameSkillRecord(existing: any, next: any): boolean {
  const existingFiles = normalizeFiles(existing.files || []);
  const nextFiles = normalizeFiles(next.files || []);

  return existing.name === next.name &&
    existing.description === next.description &&
    existing.instructions === next.instructions &&
    existing.dirPath === next.dirPath &&
    Boolean(existing.isBuiltin) === Boolean(next.isBuiltin) &&
    existingFiles.length === nextFiles.length &&
    existingFiles.every((file, index) => file === nextFiles[index]);
}

function toStoredSkill(existing: any, skill: SkillEntry) {
  return {
    ...existing,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    files: normalizeFiles(skill.files),
    dirPath: skill.dirPath,
    isBuiltin: Boolean(skill.isBuiltin)
  };
}

export async function syncSkillsFromFilesystem(store: LocalStore, skillService: SkillService): Promise<SkillSyncResult> {
  await skillService.refreshSkills();

  const existingSkills = await store.listSkills();
  const existingById = new Map(existingSkills.map(skill => [skill.id, skill]));
  const fsSkills = skillService.listSkills();
  const fsSkillIds = new Set(fsSkills.map(skill => skill.id));

  let added = 0;
  let removed = 0;
  let updated = 0;
  let unchanged = 0;

  for (const fsSkill of fsSkills) {
    const existing = existingById.get(fsSkill.id);
    const next = toStoredSkill(existing, fsSkill);

    if (!existing) {
      await store.saveSkill(next);
      added += 1;
      continue;
    }

    if (!areSameSkillRecord(existing, next)) {
      await store.saveSkill(next);
      updated += 1;
      continue;
    }

    unchanged += 1;
  }

  for (const existingSkill of existingSkills) {
    if (existingSkill.isBuiltin && !fsSkillIds.has(existingSkill.id)) {
      await store.deleteSkill(existingSkill.id);
      removed += 1;
    }
  }

  return {
    added,
    removed,
    updated,
    unchanged,
    scanned: fsSkills.length
  };
}
