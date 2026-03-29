export interface Project {
  id: string;
  userId: string;
  title: string | null;
  previewUrl?: string | null;
  vercelProjectId?: string | null;
  customDomain?: string | null;
  supabaseProjectId?: string | null;
  supabaseProjectUrl?: string | null;
  supabaseAnonKey?: string | null;
  supabaseConnectedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  version: number;
  title: string | null;
  files: Record<string, string>;
  createdAt: string;
}
