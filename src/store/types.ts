/** Properties-editor tabs, one icon in the right-hand rail. Identity and data share `object`. */
export type PropTab = 'object' | 'material' | 'simulator' | 'pattern' | 'transform' | 'render' | 'project';

/** Catalogue tabs of the left-hand asset panel. */
export type AssetTab = 'pattern' | 'model' | 'fabric' | 'trim' | 'environment';

/** How the viewport area divides between panes. */
export type ViewLayout = 'split3d2d' | 'split2d3d' | '2d' | '3d';

/** Id of one viewport pane. */
export type PaneId = '2d' | '3d';
