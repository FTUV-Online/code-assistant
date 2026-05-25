export type Skill = {
  name: string;
  description: string;
  body: string;
  filePath: string;
  source: 'workspace';
};

export type SkillSummary = {
  name: string;
  description: string;
  filePath: string;
};
