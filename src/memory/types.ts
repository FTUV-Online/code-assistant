export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export type MemoryEntry = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  filePath: string;
};

export type MemorySummary = {
  name: string;
  description: string;
  type: MemoryType;
};
