/**
 * A learned skill — a strategy that worked (or failed) which the agent
 * records so it can recall and reuse it in future sessions.
 *
 * Inspired by Voyager's ever-growing skill library (Wang et al. 2023):
 * successful approaches are stored with a natural-language description and
 * retrieved by relevance when a similar task comes up. Instead of executable
 * code + embeddings, OpenRoost stores natural-language strategies with
 * keyword-scored retrieval — the LLM is the executor, so prose is the
 * right representation and keeps core dependency-free.
 */
export interface Skill {
  /** Unique identifier, e.g. "branch-mine-diamonds". */
  name: string;
  /** One-line summary of when this skill applies. */
  description: string;
  /** The step-by-step strategy that worked. */
  strategy: string;
  /** Free-form tags for retrieval, e.g. ["mining", "diamonds", "safety"]. */
  tags: string[];
  /** How many times the skill has been saved/reused. */
  timesUsed: number;
  /** Number of times the skill led to success. */
  successes: number;
  /** Number of times the skill failed (strategy needs refinement). */
  failures: number;
  /** Lessons appended over time (most recent last, capped). */
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

/** Input for saving or updating a skill. */
export interface SkillInput {
  name: string;
  description?: string;
  strategy?: string;
  tags?: string[];
  /** Outcome of the attempt that prompted this save. */
  outcome?: "success" | "failure";
  /** A lesson learned to append to the skill's notes. */
  note?: string;
}

/** A recalled skill with its relevance score. */
export interface ScoredSkill {
  skill: Skill;
  score: number;
}

const MAX_SKILLS = 200;
const MAX_NOTES = 10;

/**
 * Persistent library of learned strategies with keyword-scored retrieval.
 * Game-agnostic: any OpenRoost game package can attach one to its bot manager.
 */
export class SkillLibrary {
  private skills = new Map<string, Skill>();

  /** Number of skills currently stored. */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Save a new skill or update an existing one (matched by name).
   * Updates only the provided fields; records the outcome in the stats.
   * Returns the stored skill.
   */
  save(input: SkillInput): Skill {
    const now = new Date().toISOString();
    const existing = this.skills.get(input.name);

    const skill: Skill = existing ?? {
      name: input.name,
      description: "",
      strategy: "",
      tags: [],
      timesUsed: 0,
      successes: 0,
      failures: 0,
      notes: [],
      createdAt: now,
      updatedAt: now,
    };

    if (input.description !== undefined) skill.description = input.description;
    if (input.strategy !== undefined) skill.strategy = input.strategy;
    if (input.tags !== undefined) skill.tags = input.tags;
    if (input.note) {
      skill.notes.push(input.note);
      if (skill.notes.length > MAX_NOTES) {
        skill.notes = skill.notes.slice(-MAX_NOTES);
      }
    }

    skill.timesUsed += 1;
    if (input.outcome === "success") skill.successes += 1;
    if (input.outcome === "failure") skill.failures += 1;
    skill.updatedAt = now;

    this.skills.set(skill.name, skill);
    this.evictIfNeeded();
    return skill;
  }

  /** Get a skill by exact name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Remove a skill by name. Returns true if it existed. */
  remove(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Recall the most relevant skills for a task description.
   * Keyword scoring: name and tag matches weigh most, then description,
   * then strategy text. Proven skills (high success rate, frequently used)
   * rank above unproven ones on equal keyword score.
   */
  recall(query: string, limit = 5): ScoredSkill[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const scored: ScoredSkill[] = [];
    for (const skill of this.skills.values()) {
      const nameTokens = new Set(tokenize(skill.name));
      const tagTokens = new Set(skill.tags.flatMap(tokenize));
      const descTokens = new Set(tokenize(skill.description));
      const bodyTokens = new Set([
        ...tokenize(skill.strategy),
        ...skill.notes.flatMap(tokenize),
      ]);

      let score = 0;
      for (const term of terms) {
        if (nameTokens.has(term)) score += 4;
        if (tagTokens.has(term)) score += 4;
        if (descTokens.has(term)) score += 2;
        if (bodyTokens.has(term)) score += 1;
      }
      if (score === 0) continue;

      // Reliability bonus: proven skills float up, failing ones sink.
      const attempts = skill.successes + skill.failures;
      if (attempts > 0) {
        score += (skill.successes - skill.failures) / attempts;
      }

      scored.push({ skill, score });
    }

    scored.sort(
      (a, b) => b.score - a.score || b.skill.timesUsed - a.skill.timesUsed
    );
    return scored.slice(0, limit);
  }

  /** All skills as brief summaries (for listing/resources). */
  list(): Array<{
    name: string;
    description: string;
    tags: string[];
    timesUsed: number;
    successes: number;
    failures: number;
  }> {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
      tags: s.tags,
      timesUsed: s.timesUsed,
      successes: s.successes,
      failures: s.failures,
    }));
  }

  /** Export all skills for persistence. */
  exportSkills(): Skill[] {
    return [...this.skills.values()];
  }

  /** Import skills from persistence (replaces current contents). */
  importSkills(skills: Skill[]): void {
    this.skills.clear();
    for (const s of skills) {
      if (s && typeof s.name === "string" && s.name.length > 0) {
        this.skills.set(s.name, {
          ...s,
          tags: Array.isArray(s.tags) ? s.tags : [],
          notes: Array.isArray(s.notes) ? s.notes : [],
        });
      }
    }
  }

  /** Evict the least valuable skills when over capacity. */
  private evictIfNeeded(): void {
    if (this.skills.size <= MAX_SKILLS) return;
    const ranked = [...this.skills.values()].sort(
      (a, b) =>
        a.successes - a.failures - (b.successes - b.failures) ||
        a.timesUsed - b.timesUsed ||
        a.updatedAt.localeCompare(b.updatedAt)
    );
    while (this.skills.size > MAX_SKILLS && ranked.length > 0) {
      this.skills.delete(ranked.shift()!.name);
    }
  }
}

/** Lowercase word tokens of length ≥ 2, with common filler words dropped. */
function tokenize(text: string): string[] {
  const STOP = new Set([
    "the", "and", "for", "with", "how", "what", "when", "where",
    "then", "them", "this", "that", "from", "into", "onto", "are",
  ]);
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 2 && !STOP.has(t)
  );
}
