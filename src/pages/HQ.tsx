import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, BriefcaseBusiness, Check, ChevronRight, ExternalLink, FileText, FolderOpen, Globe2, Image, Layers3, LayoutDashboard, Palette, Play, Search, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api';
import { useMe } from '../hooks';
import type { HqLink, HqProject, HqTab, LibraryAsset } from '../lib/hq';

const TAB_ITEMS: { id: HqTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'app', label: 'App', icon: Smartphone },
  { id: 'website', label: 'Website', icon: Globe2 },
  { id: 'library', label: 'Creative library', icon: Image },
  { id: 'launch', label: 'Launch kit', icon: Play },
  { id: 'brand', label: 'Brand', icon: Palette },
  { id: 'studios', label: 'Studios', icon: BriefcaseBusiness },
  { id: 'docs', label: 'Source files', icon: FolderOpen },
];

export function HqCatalog() {
  const [params] = useSearchParams();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['hq-config'], queryFn: api.hqConfig });
  const artifactId = params.get('artifact');
  const projects = Object.entries(data?.projects ?? {}).filter(([, p]) => p.boundary === me?.lens);
  return (
    <div className="page hq-page">
      <div className="hq-topline"><span className="eyebrow">Brad OS · Project directory</span><span className="glass-pill"><ShieldCheck size={14} /> Private workspace</span></div>
      <div className="hq-directory-hero glass-panel"><div className="hq-directory-monogram">B<span>OS</span></div><div><div className="eyebrow">Project source map</div><h1 className="display">Every project, <em>one home.</em></h1><p>Open a project HQ for its app, website, creative, brand brain and working files.</p></div></div>
      {isLoading ? <div className="muted">Loading project directory…</div> : <div className="hq-project-grid">{projects.map(([slug, p]) => <ProjectTile key={slug} slug={slug} p={p} />)}</div>}
      {artifactId && <div className="hq-legacy-notice glass-panel"><ShieldCheck size={16} /><span>This older workspace link (<code>{artifactId}</code>) now opens Brad OS. Choose its project home above to find the current source files.</span></div>}
      {!artifactId && <div className="hq-legacy-notice glass-panel"><ShieldCheck size={16} /><span>Project links now open their Railway HQ page. Use each project home for its current app, website, brand sources and creative.</span></div>}
    </div>
  );
}

export function HQ() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAssets, setShowAssets] = useState(false);
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['hq-config'], queryFn: api.hqConfig });
  const project = data?.projects[slug];
  const tabValue = searchParams.get('tab') as HqTab | null;
  const activeTab: HqTab = tabValue && TAB_ITEMS.some((t) => t.id === tabValue) ? tabValue : 'overview';
  const selectTab = (tab: HqTab) => setSearchParams((current) => { const next = new URLSearchParams(current); if (tab === 'overview') next.delete('tab'); else next.set('tab', tab); return next; });

  if (isLoading) return <div className="page hq-page muted">Loading project HQ…</div>;
  if (!project) return <HqCatalog />;
  if (project.boundary !== me?.lens) return <div className="page"><div className="glass-panel hq-access-card"><ShieldCheck /><h2>Switch spaces to open this HQ</h2><p>Use the space switcher in the sidebar, then open the project again.</p></div></div>;
  const isRunnit = slug === 'runnit';
  const tabItems = isRunnit ? TAB_ITEMS : TAB_ITEMS.filter((t) => ['overview', 'library', 'brand', 'docs'].includes(t.id));
  return (
    <div className="page hq-page" style={{ ['--hq-accent' as string]: project.accent }}>
      <div className="hq-topline"><Link to="/projects" className="hq-back"><ArrowLeft size={14} /> Projects</Link><span className="glass-pill"><ShieldCheck size={14} /> Private · Brad OS</span></div>
      <header className="hq-hero glass-panel">
        <div className="hq-logo-preview">{project.logoPreview ? <img src={project.logoPreview} alt={`${project.title} logo preview`} /> : <span>{project.title.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>}</div>
        <div className="hq-hero-copy"><div className="eyebrow">{project.eyebrow}</div><h1>{project.title}<span> HQ</span></h1><p className="hq-tagline">{project.summary}</p><p className="hq-subtitle">{project.subtitle}</p><div className="hq-hero-meta"><span className="live-dot" />{project.status}<span className="meta-divider" />Source links stay attached to their files</div></div>
        <div className="hq-hero-actions">{project.driveUrl && <a className="btn" href={project.driveUrl} target="_blank" rel="noopener noreferrer"><FolderOpen size={15} /> Open Drive <ExternalLink size={12} /></a>}{project.websiteUrl && <a className="btn primary" href={project.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe2 size={15} /> Open live site <ArrowUpRight size={14} /></a>}</div>
      </header>
      <nav className="hq-tabs" aria-label={`${project.title} sections`}>{tabItems.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? 'on' : ''} onClick={() => selectTab(id)}><Icon size={15} />{label}</button>)}</nav>
      {isRunnit ? <>
        {activeTab === 'overview' && <RunnitOverview project={project} onTab={selectTab} />}
        {activeTab === 'app' && <RunnitApp project={project} />}
        {activeTab === 'website' && <RunnitWebsite project={project} />}
        {activeTab === 'library' && <Library project={project} onViewAll={() => setShowAssets(true)} />}
        {activeTab === 'launch' && <LaunchKit project={project} />}
        {activeTab === 'brand' && <BrandSection project={project} />}
        {activeTab === 'studios' && <StudiosSection project={project} />}
        {activeTab === 'docs' && <SourceFiles project={project} />}
      </> : <GenericProject project={project} />}
      {showAssets && <AssetBrowser project={project} onClose={() => setShowAssets(false)} />}
    </div>
  );
}

function ProjectTile({ slug, p }: { slug: string; p: HqProject }) {
  return <Link to={`/hq/${slug}`} className="hq-project-tile glass-panel" style={{ ['--hq-accent' as string]: p.accent }}><div className="hq-project-logo">{p.logoPreview ? <img src={p.logoPreview} alt="" /> : p.title.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</div><div className="hq-project-copy"><span className="eyebrow">{p.eyebrow.split(' · ')[0]}</span><h2>{p.title}</h2><p>{p.summary}</p></div><ChevronRight size={18} /></Link>;
}

function RunnitOverview({ project, onTab }: { project: HqProject; onTab: (tab: HqTab) => void }) {
  const videos = project.assets.filter((a) => a.type === 'video').length;
  const images = project.assets.filter((a) => a.type === 'image').length;
  return <>
    <div className="hq-metric-row"><div className="glass-panel hq-metric"><b>{project.assets.length}</b><span>linked source assets</span></div><div className="glass-panel hq-metric"><b>{images}</b><span>images &amp; app screens</span></div><div className="glass-panel hq-metric"><b>{videos}</b><span>videos to review</span></div><div className="glass-panel hq-metric"><b>Live</b><span>{project.status}</span></div></div>
    <div className="hq-overview-grid">
      <Feature title={`${project.title} app`} eyebrow="Product" icon={Smartphone} text="Live product, product screens and current access notes." onClick={() => onTab('app')} />
      <Feature title={`${project.title} website`} eyebrow="Current Railway site" icon={Globe2} text="The active product website. This HQ links to it; its code is managed separately." onClick={() => onTab('website')} />
      <Feature title="Creative library" eyebrow="Asset library" icon={Layers3} text="Brand assets, app screens, launch ads and the video files." onClick={() => onTab('library')} />
      <Feature title="Launch kit" eyebrow="Campaign workspace" icon={Play} text="A refreshed plan built from the current brand source and library files." onClick={() => onTab('launch')} />
    </div>
    <div className="hq-two-col"><section className="glass-panel hq-callout"><div className="eyebrow">Current product truth</div><h2>{project.productTruth?.title ?? 'Keep the product promise current.'}</h2><p>{project.productTruth?.text ?? project.summary}</p><p className="hq-caution"><ShieldCheck size={16} /> {project.productTruth?.accessNote ?? project.status}</p></section><section className="glass-panel hq-callout"><div className="eyebrow">Files that ground the work</div><h2>Brand and content, linked to source.</h2><p>Brand notes, product screens, ads and videos stay attached to their source folders. This page gives them one searchable home.</p><div className="hq-inline-links">{project.links.filter((l) => ['brand', 'library'].includes(l.type)).slice(0, 3).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <ArrowUpRight size={13} /></a>)}</div></section></div>
  </>;
}

function Feature({ title, eyebrow, icon: Icon, text, onClick }: { title: string; eyebrow: string; icon: typeof Smartphone; text: string; onClick: () => void }) {
  return <button className="hq-feature-card glass-panel" onClick={onClick}><span className="hq-feature-icon"><Icon /></span><span className="eyebrow">{eyebrow}</span><b>{title}</b><small>{text}</small><span className="hq-card-link">Open section <ArrowUpRight size={14} /></span></button>;
}

function RunnitApp({ project }: { project: HqProject }) {
  const links = project.links.filter((l) => l.type === 'app');
  const screens = project.assets.filter((a) => a.category === 'App screens');
  return <section className="hq-section"><SectionHead eyebrow="Product home" title={`${project.title} app`} text="Product material and the current live access point."/><div className="hq-notice"><ShieldCheck size={17} /><span>{project.productTruth?.accessNote ?? project.status}. This HQ only links to the live app; it does not administer or change it.</span></div><div className="hq-note-grid">{links.map((link) => <LinkCard key={link.label} link={link} />)}<div className="glass-panel hq-note-card"><span className="eyebrow">Access status</span><h3>{project.status}</h3><p>{project.productTruth?.text ?? project.summary}</p></div></div><AssetGrid assets={screens} /></section>;
}

function RunnitWebsite({ project }: { project: HqProject }) {
  const loop = project.assets.find((a) => /website hero/i.test(a.name));
  return <section className="hq-section"><SectionHead eyebrow="Current website · Railway" title={`${project.title} website`} text="The active site. Website changes are managed in the other working chat."/><div className="hq-website-card glass-panel"><div className="hq-website-orbit">{project.logoPreview ? <img src={project.logoPreview} alt={`${project.title} logo preview`} /> : <Globe2 />}</div><div><span className="eyebrow">Published site</span><h3>{project.summary}</h3><p>Open the live site for the current product page and demo flow.</p>{project.websiteUrl && <a className="btn primary" href={project.websiteUrl} target="_blank" rel="noopener noreferrer">Open live website <ArrowUpRight size={14} /></a>}</div></div><div className="hq-two-col">{loop && <AssetCard asset={loop} />}<LinkList links={project.links.filter((l) => l.type === 'website')} /></div></section>;
}

function Library({ project, onViewAll }: { project: HqProject; onViewAll: () => void }) {
  const featured = project.assets.filter((a) => ['New videos', 'Brand source', 'App screens'].includes(a.category)).slice(0, 8);
  return <section className="hq-section"><SectionHead eyebrow="Runnit · linked source of truth" title="Creative library" text={`${project.assets.length} Drive assets grouped by brand, product, launch and review status.`} action={<button className="btn primary" onClick={onViewAll}><Search size={15} /> Browse all assets</button>} /><FolderLinks links={project.links.filter((l) => ['library', 'brand'].includes(l.type))} /><div className="hq-library-callout"><ShieldCheck size={17} /><span><b>Review flag is intentional.</b> Check names, screenshots, prices, product claims and visual direction before sharing uploaded promo videos publicly.</span></div><AssetGrid assets={featured} /></section>;
}

function AssetBrowser({ project, onClose }: { project: HqProject; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const cats = ['All', ...Array.from(new Set(project.assets.map((a) => a.category)))];
  const assets = project.assets.filter((a) => (category === 'All' || a.category === category) && `${a.name} ${a.status} ${a.note}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="hq-modal-backdrop" role="presentation" onClick={onClose}><section className="hq-modal glass-panel" role="dialog" aria-modal="true" aria-label={`${project.title} creative library`} onClick={(e) => e.stopPropagation()}><div className="hq-modal-head"><div><div className="eyebrow">{project.title} · source assets</div><h2>Creative library</h2></div><button className="btn sm" onClick={onClose}>Close</button></div><div className="hq-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a logo, screen, ad or video…" /></div><div className="hq-filter-row">{cats.map((c) => <button key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div><AssetGrid assets={assets} /></section></div>;
}

function AssetGrid({ assets }: { assets: LibraryAsset[] }) {
  if (!assets.length) return <div className="hq-empty">No matching assets.</div>;
  return <div className="hq-asset-grid">{assets.map((a) => <AssetCard key={a.key} asset={a} />)}</div>;
}

function AssetCard({ asset: a }: { asset: LibraryAsset }) {
  return <article className="hq-asset-card glass-panel"><div className={`hq-asset-preview ${a.type === 'video' ? 'video' : ''}`}>
    {a.type === 'video' && a.previewUrl ? <iframe loading="lazy" src={a.previewUrl} title={a.name} allow="autoplay" /> : a.type === 'document' ? <a className="hq-asset-document" href={a.url} target="_blank" rel="noopener noreferrer"><FileText size={30} /><span>Open reference</span></a> : <a href={a.url} target="_blank" rel="noopener noreferrer">{a.thumbnailUrl ? <img loading="lazy" src={a.thumbnailUrl} alt={a.name} /> : <Image />}</a>}
    <a className="hq-asset-open" href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.name}`}><ArrowUpRight size={13} /></a>
  </div><div className="hq-asset-meta"><span className="hq-asset-category">{a.category}</span><h3>{a.name}</h3><span className="hq-asset-status">{a.status}</span><p>{a.note}</p><a className="hq-asset-link" href={a.url} target="_blank" rel="noopener noreferrer">Open original <ExternalLink size={12} /></a></div></article>;
}

function LaunchKit({ project }: { project: HqProject }) {
  const picked = project.assets.filter((a) => a.launchPick);
  const launch = project.launch;
  return <section className="hq-section"><SectionHead eyebrow={`${project.title} · launch kit · revised`} title="A clear launch story." text="A practical launch kit built from the current brand source and linked library files." action={<LinkPill links={project.links.filter((l) => l.type === 'brand')} />} /><div className="hq-launch-banner glass-panel"><div className="eyebrow">One sentence to keep true</div><h3>{launch?.statement ?? project.summary}</h3><p>{launch?.description ?? 'Use current product screens and verified product behavior.'}</p></div><div className="hq-launch-grid">{(launch?.steps ?? []).map((step, i) => <Step key={step.title} n={String(i + 1).padStart(2, '0')} eyebrow={step.eyebrow} title={step.title} text={step.text} />)}</div>{launch?.caption && <div className="hq-caption-card glass-panel"><div className="eyebrow">Starter caption · review before publishing</div><p>{launch.caption}</p><div className="hq-caption-note"><Check size={14} /> {launch.guardrail}</div></div>}<div className="hq-section-head hq-picked-head"><div><div className="eyebrow">Picked from the library</div><h2>Use these source files first</h2></div></div><AssetGrid assets={picked} /><div className="hq-launch-foot"><ShieldCheck size={16} /> Internal working kit. Nothing is scheduled or published from Brad OS. Review assets before using them in public.</div></section>;
}

function BrandSection({ project }: { project: HqProject }) {
  const brandAssets = project.assets.filter((a) => a.category === 'Brand source');
  const brand = project.brand;
  return <section className="hq-section"><SectionHead eyebrow={`${project.title} · brand system`} title="Keep the brand unmistakable." text="Use the linked brand source as the canonical reference for creative and AI tools." action={<LinkPill links={project.links.filter((l) => l.type === 'brand')} />} />{project.logoPreview && <div className="hq-brand-panel glass-panel"><div className="hq-wordmark"><img src={project.logoPreview} alt={`${project.title} wordmark preview`} /></div><div className="hq-brand-rules"><span className="eyebrow">Visual rules</span><h3>{brand?.ruleTitle ?? project.summary}</h3><p>{brand?.ruleText ?? 'Use verified source material and keep the project voice consistent.'} {brand?.typography}</p></div></div>}{!!brand?.colors.length && <div className="hq-color-row">{brand.colors.map(([name, hex]) => <div className="glass-panel hq-color-chip" key={name}><i style={{ background: hex }} /><span>{name}</span><code>{hex}</code></div>)}</div>}<AssetGrid assets={brandAssets} /></section>;
}

function StudiosSection({ project }: { project: HqProject }) {
  const links = project.links.filter((l) => l.type === 'studios');
  return <section className="hq-section"><SectionHead eyebrow="Studio workspaces" title="One route per studio." text="Send each studio its own page and demo link." action={<LinkPill links={links.slice(0, 1)} />} /><div className="hq-notice"><ShieldCheck size={17} /><span>{project.productTruth?.accessNote ?? project.status}</span></div><LinkList links={links} /></section>;
}

function SourceFiles({ project }: { project: HqProject }) {
  return <section className="hq-section"><SectionHead eyebrow="Project references" title="Source files and folders" text="The source files stay in their canonical location; this page gives them one easy-to-find home." /><LinkList links={project.links} /></section>;
}

function GenericProject({ project }: { project: HqProject }) {
  return <section className="hq-section"><SectionHead eyebrow={project.eyebrow} title={project.subtitle} text="This Railway page is the project landing page. Source files open from their current Drive or live product location." /><div className="hq-two-col"><div className="glass-panel hq-note-card"><span className="eyebrow">Project home</span><h3>{project.summary}</h3><p>{project.status}</p>{project.driveUrl && <a href={project.driveUrl} target="_blank" rel="noopener noreferrer">Open project Drive <ArrowUpRight size={13} /></a>}</div>{project.logoPreview && <div className="glass-panel hq-logo-card"><img src={project.logoPreview} alt={`${project.title} preview`} /></div>}</div><LinkList links={project.links} /><AssetGrid assets={project.assets} /></section>;
}

function LinkList({ links }: { links: HqLink[] }) {
  if (!links.length) return <div className="hq-empty">No source links have been added to this project yet.</div>;
  return <div className="hq-doc-list">{links.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" className="glass-panel hq-doc-row"><span className="hq-doc-icon"><FileText size={17} /></span><span><b>{link.label}</b><small>{link.detail ?? link.type}</small></span><ArrowUpRight size={15} /></a>)}</div>;
}

function LinkCard({ link }: { link: HqLink }) {
  return <a className="glass-panel hq-note-card" href={link.url} target="_blank" rel="noopener noreferrer"><span className="eyebrow">{link.type}</span><h3>{link.label}</h3><p>{link.detail ?? 'Project source link.'}</p><span className="hq-card-link">Open source <ArrowUpRight size={13} /></span></a>;
}

function FolderLinks({ links }: { links: HqLink[] }) {
  return <div className="hq-library-folders">{links.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer"><FolderOpen />{link.label}<ArrowUpRight size={13} /></a>)}</div>;
}

function LinkPill({ links }: { links: HqLink[] }) {
  const link = links[0];
  return link ? <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer"><BookOpen size={15} /> {link.label} <ArrowUpRight size={13} /></a> : null;
}

function SectionHead({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="hq-section-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{text}</p></div>{action}</div>;
}

function Step({ n, eyebrow, title, text }: { n: string; eyebrow: string; title: string; text: string }) {
  return <article className="glass-panel hq-step"><span>{n}</span><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3><p>{text}</p></div></article>;
}
