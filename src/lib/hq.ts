export type HqTab = 'overview' | 'app' | 'website' | 'library' | 'launch' | 'brand' | 'studios' | 'docs';

export type LibraryAsset = {
  key: string;
  name: string;
  type: 'image' | 'video' | 'document';
  category: string;
  status: string;
  note: string;
  url: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  launchPick?: boolean;
};

export type HqLink = { label: string; url: string; type: HqTab | 'source'; detail?: string };
export type HqStep = { eyebrow: string; title: string; text: string };
export type HqProductTruth = { title: string; text: string; accessNote: string };
export type HqLaunch = { statement: string; description: string; steps: HqStep[]; caption: string; guardrail: string };
export type HqBrand = { ruleTitle: string; ruleText: string; typography: string; colors: [string, string][] };

export type HqProject = {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  subtitle: string;
  accent: string;
  status: string;
  boundary: 'work' | 'family';
  logoPreview?: string;
  driveUrl?: string;
  websiteUrl?: string;
  links: HqLink[];
  assets: LibraryAsset[];
  productTruth?: HqProductTruth;
  launch?: HqLaunch;
  brand?: HqBrand;
};

export type HqConfig = { projects: Record<string, HqProject> };

export function projectHq(title: string): string | null {
  const t = title.toLowerCase();
  if (/runnit|city ink/.test(t)) return '/hq/runnit';
  if (/softr/.test(t)) return '/hq/softr';
  if (/encapsulator/.test(t)) return '/hq/encapsulator';
  if (/five ?eights|58s/.test(t)) return '/hq/five-eights';
  if (/yumi|crew/.test(t)) return '/hq/yumi';
  if (/hope cartel/.test(t)) return '/hq/hope-cartel';
  if (/brad|agency|cel-x/.test(t)) return '/hq/brad-hq';
  return null;
}

export function projectHref(title: string, id: string): string {
  return projectHq(title) ?? `/projects/${id}`;
}
