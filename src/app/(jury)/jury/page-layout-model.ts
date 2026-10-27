/** I-086: pure breadcrumb rules for PageHeader (no CSS so node tests can import it). */
export type Crumb = { label: string; href?: string };

/** A single crumb that just repeats the page title (e.g. 홈 on the home page) adds nothing, so it is not rendered. */
export function shouldShowBreadcrumb(crumbs: readonly Crumb[], title: unknown): boolean {
  if (crumbs.length === 0) return false;
  return !(crumbs.length === 1 && typeof title === 'string' && crumbs[0].label === title);
}
