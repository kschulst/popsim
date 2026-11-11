export const APP_NAME = 'popsim';
/**
 * Version number of this code. On main it is the next version to be frozen (one above the latest
 * tag); export files record it.
 */
export const VERSION = 5;

/**
 * True for builds of main (the site's /dev/, built with VITE_CHANNEL=dev) and the local dev
 * server. Tagged releases are built without it and show vN.
 */
export const IS_DEV = import.meta.env.DEV || import.meta.env.VITE_CHANNEL === 'dev';

/** Version name shown in the UI. */
export const VERSION_LABEL = IS_DEV ? 'dev' : `v${VERSION}`;
