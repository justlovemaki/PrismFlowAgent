export const STAGE_ONE_TASK_WRAPPER = 'Task: Produce one structured draft from SOURCE_MATERIAL_JSON according to the trusted editorial policy in the system persona.'
export const STAGE_TWO_TASK_WRAPPER = 'Task: Produce the final structured draft by reviewing STAGE_ONE_DRAFT_JSON against SOURCE_MATERIAL_JSON according to the trusted editorial policy in the system persona.'

const MAX_PERSONA_CHARS = 10_000

function effectivePersona(persona, legacyInstruction, fixedWrapper, stage) {
  const value = legacyInstruction === fixedWrapper ? persona : `${persona}\n\n${legacyInstruction}`
  if (value.length > MAX_PERSONA_CHARS) {
    throw new Error(`Stored legacy ${stage} prompt projects to ${value.length} persona characters; the migration limit is ${MAX_PERSONA_CHARS}`)
  }
  return value
}

export function projectEffectiveStageOnePersona(snapshot) {
  return effectivePersona(snapshot.persona, snapshot.instruction, STAGE_ONE_TASK_WRAPPER, 'stage-one')
}

export function projectEffectiveStageTwoPersona(snapshot) {
  return effectivePersona(snapshot.reviewPersona, snapshot.reviewInstruction, STAGE_TWO_TASK_WRAPPER, 'stage-two')
}

/**
 * Deterministically projects the retained four-field schema into the two
 * system personas used by current execution. No retained row is rewritten.
 */
export function projectEffectivePersonas(snapshot) {
  return {
    persona: projectEffectiveStageOnePersona(snapshot),
    reviewPersona: projectEffectiveStageTwoPersona(snapshot),
  }
}

/** Converts deployment defaults into the full immutable schema written by new stores. */
export function personaOnlySnapshot(persona, instruction, reviewPersona, reviewInstruction) {
  const effective = projectEffectivePersonas({ persona, instruction, reviewPersona, reviewInstruction })
  return {
    ...effective,
    instruction: STAGE_ONE_TASK_WRAPPER,
    reviewInstruction: STAGE_TWO_TASK_WRAPPER,
  }
}
